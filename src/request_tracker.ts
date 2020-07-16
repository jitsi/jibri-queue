import { Logger } from 'winston';
import Redis from 'ioredis';
import Redlock from 'redlock';

export interface RecorderRequestMeta {
    id: string;
    created: Date;
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

    async request(id: string): Promise<void> {
        const created = new Date(Date.now());
        const meta: RecorderRequestMeta = {
            id: id,
            created: created,
        };

        const ret = await this.redisClient
            .multi()
            .rpush(RequestTracker.listKey, id)
            .set(this.metaKey(id), JSON.stringify(meta), 'ex', 86400) // ttl 1 day
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

        let result = false;
        try {
            const reqId = await this.redisClient.lindex(RequestTracker.listKey, 0);
            if (reqId != null) {
                const metaString = await this.redisClient.get(this.metaKey(reqId));
                if (!metaString) {
                    this.logger.warn(`no meta for ${reqId} - skipping processing`);
                    return false;
                }
                const meta: RecorderRequestMeta = JSON.parse(metaString, (key, value) => {
                    if (key === 'created') {
                        return new Date(value);
                    }
                    return value;
                });
                this.logger.debug(`servicing req ${reqId}`);
                result = await processor(meta);
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
        allJobs.forEach(async (reqId: string, index: number) => {
            const now = Date.now();
            const m = await this.redisClient.get(this.metaKey(reqId));
            const meta: RecorderRequestMeta = JSON.parse(m, (key, value) => {
                if (key === 'created') {
                    return new Date(value);
                }
                return value;
            });
            meta.created = new Date(meta.created);
            const diffTime = Math.trunc(Math.abs(now - meta.created.getTime()) / 1000);
            if (diffTime >= RequestTracker.updateDelay) {
                this.logger.debug(`request ${reqId} is in position ${index}`);
                this.logger.debug(`request ${reqId} in queue for ${diffTime} seconds`);
            }
        });
    }
}
