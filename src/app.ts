import bodyParser from 'body-parser';
import config from './config';
import express from 'express';
import Handlers from './handlers';
import Redis from 'ioredis';
import logger from './logger';
import { Job } from 'bullmq';
import * as meter from './meter';
import * as tracker from './jibri_tracker';

const app = express();
app.use(bodyParser.json());

// TODO: Add prometheus stating middleware for each http
// TODO: Add http logging middleware
// TODO: Add an error handler middleware for handlers that throw

app.get('/health', (req: express.Request, res: express.Response) => {
    res.send('healthy!');
});

const redisClient = new Redis({
    host: config.RedisHost,
    port: Number(config.RedisPort),
    password: config.RedisPassword,
});

const recorderMeter = new meter.RecorderMeter({
    redisHost: config.RedisHost,
    redisPort: Number(config.RedisPort),
    redisPassword: config.RedisPassword,
    logger: logger,
});
const jibriTracker = new tracker.JibriTracker(logger, redisClient);
const h = new Handlers(logger, recorderMeter, jibriTracker);

app.post('/job/recording', h.requestRecordingJob);
app.post('/hook/v1/status', h.jibriStateWebhook);

async function jobProcessor(job: Job): Promise<void> {
    // Our job should have some data we need to provide a response

    // get a recorder
    try {
        await jibriTracker.nextAvailable();
        // TODO: trigger a call to the lua module http api.
    } catch (err) {
        logger.info('no recorders here');
        /**
         * TODO: what do we do with a job that fails to be handled?
         *
         * If there are no recorders available then re-enqueue the job with a delay and priority.
         *
         * One possibility is that the failed event is triggered and the job
         * is added back on the queue with high priority. If it is event based then
         * we don't need to catch??
         *
         * https://docs.bullmq.io/guide/jobs/proritized
         * https://docs.bullmq.io/guide/events
         *
         */
    }
}
recorderMeter.start(jobProcessor);

app.listen(config.HTTPServerPort, () => {
    logger.info(`...listening on :${config.HTTPServerPort}`);
});
