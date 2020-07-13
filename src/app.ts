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
    try {
        const jibriID = await jibriTracker.nextAvailable();
        logger.debug(`job ${job.id} reserved with lock ${jibriID}`);
    } catch (err) {
        logger.error('');
    }
}
recorderMeter.start(jobProcessor);

app.listen(config.HTTPServerPort, () => {
    logger.info(`...listening on :${config.HTTPServerPort}`);
});
