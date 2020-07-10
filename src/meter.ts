import { Logger } from "winston";
import { Queue, Worker, Job, Processor } from "bullmq";

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
    private requestWorker: Worker;

    static readonly reqQueueName = "recorderRequests";

    constructor(cfg: RecorderMeterConfig) {
        this.addRequest = this.addRequest.bind(this);
        this.cfg = cfg;

        this.requestQueue = new Queue(RecorderMeter.reqQueueName, {
            connection: {
                host: cfg.redisHost,
                port: cfg.redisPort,
                password: cfg.redisPassword,
            }
        });
    }

    addRequest(name: string, req: RecorderRequest): Promise<Job<any, any>> {
        this.cfg.logger.debug(`recorder request ${name} added: ${JSON.stringify(req)}`);
        return this.requestQueue.add(name, req);
    }

    start(processor: Processor): void {
        this.requestWorker = new Worker(
            RecorderMeter.reqQueueName,
            processor,
            { connection: {
                host: this.cfg.redisHost,
                port: this.cfg.redisPort,
                password: this.cfg.redisPassword,
            }}
        );
        // TODO: handle graceful shutdown and closing of job and queue?
    }
}