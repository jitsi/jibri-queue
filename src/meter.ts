import { Logger } from "winston";
import { Queue, Worker, Job } from "bullmq";
import Redlock from "redlock";
import Redis from "ioredis";

export type RecorderMeterConfig = {
    redisHost: string;
    redisPort: number;
    redisPassword: string;
    logger: Logger;
}

export type RecorderRequest = {
    id: string
}

export class RecorderMeter {
    private cfg: RecorderMeterConfig;
    private requestQueue: Queue;
    private availableQueue: Queue;
    private requestWorker: Worker;
    private sharedLock: Redlock;

    static readonly reqQueueName = "recorderRequests";

    constructor(cfg: RecorderMeterConfig) {
        this.addRequest = this.addRequest.bind(this);
        this.handleRecorderRequestJob = this.handleRecorderRequestJob.bind(this);

        this.cfg = cfg;

        this.requestQueue = new Queue(RecorderMeter.reqQueueName, {
            connection: {
                host: cfg.redisHost,
                port: cfg.redisPort,
                password: cfg.redisPassword,
            }
        });

        const redis = new Redis({
            port: cfg.redisPort,
            host: cfg.redisHost,
            password: cfg.redisPassword,
        })
        this.sharedLock = new Redlock(
            [redis],
            {
                // the expected clock drift; for more details
                // see http://redis.io/topics/distlock
                driftFactor: 0.01, // time in ms
                // the max number of times Redlock will attempt
                // to lock a resource before erroring
                retryCount:  10,

                // the time in ms between attempts
                retryDelay:  200, // time in ms

                // the max time in ms randomly added to retries
                // to improve performance under high contention
                // see https://www.awsarchitectureblog.com/2015/03/backoff.html
                retryJitter:  200 // time in ms
            }
        );
        this.sharedLock.on("clientError", (err) => {
            cfg.logger.error("A lock redis conn error has occured: ", err);
        });
    }

    addRequest(name: string, req: RecorderRequest): void {
        this.cfg.logger.debug(`recorder request ${name} added: ${JSON.stringify(req)}`);
        this.requestQueue.add(name, req);
    }

    start(): void {
        this.requestWorker = new Worker(
            RecorderMeter.reqQueueName,
            this.handleRecorderRequestJob,
            { connection: {
                host: this.cfg.redisHost,
                port: this.cfg.redisPort,
                password: this.cfg.redisPassword,
            }}
        );
    }

    async handleRecorderRequestJob(job: Job): Promise<void> {
        this.cfg.logger.info(`processing req job ${job.name}`);
        try {
            const recorder = await this.obtainRecorder();
            this.cfg.logger.debug(`obtained recorder ${recorder}`);
        } catch (err) {
            this.cfg.logger.error("error obtaining recorder ", err);
        }
    }

    // We need to somehow get available recorders and provide one and lock it for some
    // reserved amount of time. This time should be at least the length of the JWT
    // provided the user. This will can be used to prevent that recorder from being
    // reserved again until this time.
    async obtainRecorder(): Promise<string> {
        /**
         * Grab a list of recorders that are in the state where we can use them.
         *
         * Iterate through the list of recorders and try to obtain a distributed
         * lock with a TTL. The intention is that the lock will be held for the time delta
         * between when an access JWT is provided to a user and the user grabs a recorder.
         *
         * Note that the user does *not* need to grab the recorder that is locked. Assigning
         * a user a particular recorder is not a supported feature. However, it is of no consequence
         * if they grab the locked one or another available server because the available count of
         * servers will be the same regardless. It's just easier, or as easy to lock a unique server name IMO
         * then an atomic count and it would support more features in the future.
         */
        this.cfg.logger.debug("requesting a recorder");
        const recorder = "recorder one";

        try {
            await this.sharedLock.lock(recorder, 10000);
            this.cfg.logger.debug(`locking recorder ${recorder}`);
        } catch (err) {
            this.cfg.logger.error(`error obtaining shared lock ${err}`);
        }

        return recorder;
    }
}