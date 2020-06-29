import { Request, Response } from "express";
import { Logger } from "winston";
import { RecorderQueue } from "./queue";

class Handlers {
    private logger: Logger;
    private queue: RecorderQueue;

    constructor(logger: Logger, queue: RecorderQueue) {
        this.logger = logger;
        this.queue = queue;
    }

    requestRecordingJob = (req: Request, res: Response) => {
        // Add some sort of json parsing middleware and then use
        // a request body to enqueue the job using the queue instance
        this.queue.addRequest("hello", {info: "good bye"}
        res.sendStatus(200);
    }
 }

export default Handlers