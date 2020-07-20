import { Request, Response } from 'express';
import { Logger } from 'winston';
import { JibriTracker, JibriState } from './jibri_tracker';
import { RequestTracker, RecorderRequest } from './request_tracker';

class Handlers {
    private logger: Logger;
    private jibriTracker: JibriTracker;
    private requestTracker: RequestTracker;

    constructor(logger: Logger, requestTracker: RequestTracker, jibriTracker: JibriTracker) {
        this.requestRecordingJob = this.requestRecordingJob.bind(this);
        this.cancelRecordingJob = this.cancelRecordingJob.bind(this);
        this.jibriStateWebhook = this.jibriStateWebhook.bind(this);

        this.logger = logger;
        this.requestTracker = requestTracker;
        this.jibriTracker = jibriTracker;
    }

    async requestRecordingJob(req: Request, res: Response): Promise<void> {
        await this.requestTracker.request(req.body);
        res.sendStatus(200);
    }

    async cancelRecordingJob(req: Request, res: Response): Promise<void> {
        await this.requestTracker.cancel(req.body.id);
        res.sendStatus(200);
    }

    async jibriStateWebhook(req: Request, res: Response): Promise<void> {
        const status: JibriState = req.body;
        if (!status.status) {
            res.sendStatus(400);
            return;
        }
        if (!status.jibriId) {
            res.sendStatus(400);
            return;
        }

        this.logger.debug(
            `webhook state for ${status.jibriId}-${status.status.health.healthStatus}-${status.status.busyStatus}`,
        );
        await this.jibriTracker.track(status);
        res.sendStatus(200);
    }
}

export default Handlers;
