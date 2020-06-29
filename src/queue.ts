import { Queue, QueueOptions } from "bullmq";
import { Logger } from "winston";


export type RecorderRequest = {
    info: string
}

export class RecorderQueue {
    private logger: Logger;
    private queue: Queue;

    constructor(logger: Logger, cfg?: QueueOptions) {
        this.logger = logger;
        this.queue = new Queue('recorderRequests', cfg);
    }

    addRequest(name: string, req: RecorderRequest) {
        this.logger.debug(`recorder request ${name} added: ${req}`)
        this.queue.add(name, req)
    }
}

