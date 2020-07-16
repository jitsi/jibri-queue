import { Logger } from 'winston';
import Redis from 'ioredis';
import Redlock from 'redlock';

export interface RecorderRequest {
    id: string;
    created: Date;
}

interface RecorderRequestJSON {
    id: string;
    created: string;
}

function decodeRecorderRequest(json: RecorderRequestJSON): RecorderRequest {
    return Object.assign({}, json, {
        created: new Date(json.created),
    });
}

export type Processor = (req: RecorderRequest) => Promise<boolean>;

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

    async request(id: string): Promise<void> {
        const req: RecorderRequest = {
            id: id,
            created: new Date(Date.now()),
        };
        const reqStr = JSON.stringify(req);
        await this.redisClient.rpush(RequestTracker.listKey, reqStr);
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
            const r = await this.redisClient.lindex(RequestTracker.listKey, 0);
            if (r != null) {
                const request = decodeRecorderRequest(<RecorderRequestJSON>JSON.parse(r));
                this.logger.debug(`servicing req ${request.id}`);
                result = await processor(request);
                if (result) {
                    await this.redisClient.lpop(RequestTracker.listKey);
                }
            }
        } finally {
            lock.unlock();
        }
        return result;
    }

    async processUpdates(): Promise<void> {
        const allJobs = await this.redisClient.lrange(RequestTracker.listKey, 0, -1);
        allJobs.forEach((each: string, index: number) => {
            const now = Date.now();
            const req = decodeRecorderRequest(<RecorderRequestJSON>JSON.parse(each));
            const diffTime = Math.trunc(Math.abs(now - req.created.getTime()) / 1000);
            if (diffTime >= RequestTracker.updateDelay) {
                this.logger.debug(`request ${req.id} is in position ${index}`);
                this.logger.debug(`request ${req.id} in queue for ${diffTime} seconds`);
            }
        });
    }
}
