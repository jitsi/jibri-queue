import { Request, Response } from "express";
import { Logger } from "winston";
import { RecorderMeter } from "./meter";
import { JibriTracker, JibriState } from "./jibri_tracker";

class Handlers {
    private logger: Logger;
    private meter: RecorderMeter;
    private tracker: JibriTracker;

    constructor(logger: Logger, meter: RecorderMeter, tracker: JibriTracker) {
        this.requestRecordingJob = this.requestRecordingJob.bind(this);
        this.jibriStateWebhook = this.jibriStateWebhook.bind(this);

        this.logger = logger;
        this.meter = meter;
        this.tracker = tracker;
    }

    async requestRecordingJob(req: Request, res: Response): Promise<void> {
        // TODO: make a type to convert the body to like we do with
        // the webhook.
        await this.meter.addRequest(req.body.id, req.body);
        res.sendStatus(200);
    }

    async jibriStateWebhook(req: Request, res: Response): Promise<void> {
        const status: JibriState = req.body;
        if (!status.status) {
            res.sendStatus(400);
            return
        }
        if (!status.jibriId) {
            res.sendStatus(400);
            return
        }

        this.logger.debug(`webhook state for ${status.jibriId}-${status.status.health.healthStatus}-${status.status.busyStatus}`);
        await this.tracker.track(status)
        res.sendStatus(200);
    }
 }

export default Handlers