import { Request, Response } from "express";
import { Logger } from "winston";

/**
 * POST /job/recording
 * Create a new recording job to begin the
 * process of obtaining a recording access JWT.
 */

 class Handlers {
    logger: Logger;
    // some sort of queue object TBD

    constructor(logger: Logger) {
        this.logger = logger;
    }

    requestRecordingJob(req: Request, res: Response) {
        // Add some sort of json parsing middleware and then use
        // a request body to enqueue the job using the queue instance
        res.sendStatus(200);
    }
 }

export default Handlers