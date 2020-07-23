import { Request, Response } from 'express';
import { JibriTracker, JibriState } from './jibri_tracker';
import { RequestTracker, RecorderRequest } from './request_tracker';

class Handlers {
    private jibriTracker: JibriTracker;
    private requestTracker: RequestTracker;

    constructor(requestTracker: RequestTracker, jibriTracker: JibriTracker) {
        this.requestRecordingJob = this.requestRecordingJob.bind(this);
        this.cancelRecordingJob = this.cancelRecordingJob.bind(this);
        this.jibriStateWebhook = this.jibriStateWebhook.bind(this);

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

        await this.jibriTracker.track(status);
        res.sendStatus(200);
    }
}

export default Handlers;
