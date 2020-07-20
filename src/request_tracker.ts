import { Logger } from 'winston';
import Redis from 'ioredis';
import Redlock from 'redlock';

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

export type Processor = (req: RecorderRequestMeta) => Promise<boolean>;

export class RequestTracker {
    private logger: Logger;
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

    constructor(logger: Logger, redisClient: Redis.Redis) {
        this.logger = logger;
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
            this.logger.error('A reqLock redis error has occured:', err);
        });
    }

    metaKey(id: string): string {
        return `${RequestTracker.requestKeyPre}${id}`;
    }

    async request(req: RecorderRequest): Promise<void> {
        const created = Date.now();
        const metaKey = this.metaKey(req.requestId);
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
                throw each[0];
            }
        }
    }

    async cancel(id: string): Promise<void> {
        const ret = await this.redisClient.multi().lrem(RequestTracker.listKey, 0, id).del(this.metaKey(id)).exec();
        for (const each of ret) {
            if (each[0]) {
                throw each[0];
            }
        }
    }

    async processNextRequest(processor: Processor): Promise<boolean> {
        let lock: Redlock.Lock = undefined;
        try {
            lock = await this.reqLock.lock(RequestTracker.processingKey, RequestTracker.processingTTL);
        } catch (err) {
            this.logger.error(`error obtaining lock ${err}`);
            return false;
        }

        const result = false;
        try {
            const reqId = await this.redisClient.lindex(RequestTracker.listKey, 0);
            if (reqId != null) {
                const m = await this.redisClient.hgetall(this.metaKey(reqId));
                if (!m) {
                    this.logger.warn(`no meta for ${reqId} - skipping processing`);
                    return false;
                }
                const meta = <RecorderRequestMeta>(<unknown>m);
                this.logger.debug(`servicing req ${meta.requestId}`);
                const result = await processor(meta);
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
            }
        } finally {
            lock.unlock();
        }
        return result;
    }

    async processUpdates(): Promise<void> {
        const allJobs = await this.redisClient.lrange(RequestTracker.listKey, 0, -1);
        const now = Date.now();
        allJobs.forEach(async (reqId: string, index: number) => {
            const c = await this.redisClient.hget(this.metaKey(reqId), 'created');
            const created = parseInt(c, 10);
            now - created;
            const diffTime = Math.trunc(Math.abs((now - created) / 1000));
            if (diffTime >= RequestTracker.updateDelay) {
                this.logger.debug(`request update ${reqId} position: ${index} time: ${diffTime}`);
            }
        });
    }
}
