import Redis from 'ioredis';
import Redlock from 'redlock';
import logger from './logger';
import { Context } from './context';

export interface RecorderRequest {
    conference: string;
    roomParam: string;
    externalApiUrl: string;
    eventType: string;
    participant: string;
    requestId: string;
}

export type LeaveRequest = RecorderRequest;

export interface RecorderRequestMeta extends RecorderRequest {
    created: string;
}

export interface Update extends RecorderRequest {
    position: number;
    time: number;
}

export type Processor = (ctx: Context, req: RecorderRequestMeta) => Promise<boolean>;
export type UpdateProcessor = (ctx: Context, req: RecorderRequest, position: number) => Promise<boolean>;

export class RequestTracker {
    private redisClient: Redis.Redis;
    private reqLock: Redlock;

    // processingKey is the name of the key used for
    // redis-based distributed lock.
    static readonly processingKey = 'processLockKey';
    // processingTTL is the ttl for the lock. See redlock docs.
    static readonly processingTTL = 1000; // time in ms
    // listKey is the key used for storing list of requests.
    static readonly listKey = 'jibri:request:pending';
    // requestKeyPre is the prefix for storing request metadata.
    static readonly requestKeyPre = 'jibri:request:';
    // updateDelay is the amount of time a request must be in
    // the list before updates will be provided to requestor.
    static readonly updateDelay = 1; // time in seconds

    constructor(redisClient: Redis.Redis) {
        this.redisClient = redisClient;
        this.reqLock = new Redlock(
            // TODO: you should have one client for each independent redis node or cluster
            [this.redisClient],
            {
                driftFactor: 0.01, // time in ms
                retryCount: 3,
                retryDelay: 200, // time in ms
                retryJitter: 200, // time in ms
            },
        );
        this.reqLock.on('clientError', (err) => {
            logger.error(`A reqLock redis error has occured: ${err}`);
        });
    }

    metaKey(id: string): string {
        return `${RequestTracker.requestKeyPre}${id}`;
    }

    async request(ctx: Context, req: RecorderRequest): Promise<void> {
        const created = Date.now();
        const metaKey = this.metaKey(req.requestId);
        ctx.logger.debug(`setting request data in redis ${metaKey} and ${RequestTracker.listKey}`);
        const ret = await this.redisClient
            .multi()
            .rpush(RequestTracker.listKey, req.requestId)
            .hset(metaKey, 'conference', req.conference)
            .hset(metaKey, 'roomParam', req.roomParam)
            .hset(metaKey, 'externalApiUrl', req.externalApiUrl)
            .hset(metaKey, 'participant', req.participant)
            .hset(metaKey, 'requestId', req.requestId)
            .hset(metaKey, 'created', created.toString())
            .expire(metaKey, 86400) // ttl of one day
            .exec();
        for (const each of ret) {
            if (each[0]) {
                ctx.logger.error(`setting request multi metadata: ${each[0]}`);
                throw each[0];
            }
        }
    }

    async cancel(ctx: Context, id: string): Promise<void> {
        const metaKey = this.metaKey(id);
        const ret = await this.redisClient.multi().lrem(RequestTracker.listKey, 0, id).del(metaKey).exec();
        ctx.logger.debug(`removing request data in redis ${metaKey} and ${RequestTracker.listKey}`);
        for (const each of ret) {
            if (each[0]) {
                ctx.logger.error(`cancel redis multi: ${each[0]}`);
                throw each[0];
            }
        }
    }

    async processNextRequest(ctx: Context, processor: Processor): Promise<boolean> {
        ctx.logger.debug('obtaining request lock in redis');
        let lock: Redlock.Lock = undefined;
        try {
            lock = await this.reqLock.lock(RequestTracker.processingKey, RequestTracker.processingTTL);
            ctx.logger.debug('lock obtained');
        } catch (err) {
            ctx.logger.error(`error obtaining lock ${err}`);
            return false;
        }

        let result = false;
        try {
            ctx.logger.debug('obtaining next job id');
            const reqId = await this.redisClient.lindex(RequestTracker.listKey, 0);
            if (reqId != null) {
                ctx.logger.debug(`processing req id ${reqId}`);
                const m = await this.redisClient.hgetall(this.metaKey(reqId));
                if (!m) {
                    ctx.logger.warn(`no meta for ${reqId} - skipping processing`);
                    return false;
                }
                const meta = <RecorderRequestMeta>(<unknown>m);
                ctx.logger.debug(`servicing req ${meta.requestId}`);
                result = await processor(ctx, meta);
                if (result) {
                    const ret = await this.redisClient
                        .multi()
                        .lpop(RequestTracker.listKey)
                        .del(this.metaKey(reqId))
                        .exec();
                    for (const each of ret) {
                        if (each[0]) {
                            throw each[0];
                        }
                    }
                }
            } else {
                ctx.logger.debug('no requests pending');
            }
        } catch (err) {
            ctx.logger.error(`processing request ${err}`);
        } finally {
            lock.unlock();
        }
        return result;
    }

    async processUpdates(ctx: Context, processor: UpdateProcessor): Promise<void> {
        const allJobs = await this.redisClient.lrange(RequestTracker.listKey, 0, -1);
        if (allJobs.length == 0) {
            ctx.logger.debug('no updates to process');
            return;
        }
        allJobs.forEach(async (reqId: string, index: number) => {
            try {
                const m = await this.redisClient.hgetall(this.metaKey(reqId));
                if (!m) {
                    ctx.logger.warn(`no meta for ${reqId} - update skipped`);
                    return false;
                }
                const meta = <RecorderRequest>(<unknown>m);
                await processor(ctx, meta, index);
            } catch (err) {
                ctx.logger.error(`processing update ${err}`);
            }
        });
    }
}
