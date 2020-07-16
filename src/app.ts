import bodyParser from 'body-parser';
import config from './config';
import express from 'express';
import Handlers from './handlers';
import Redis from 'ioredis';
import logger from './logger';
import { JibriTracker } from './jibri_tracker';
import { RequestTracker, RecorderRequest } from './request_tracker';

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

const jibriTracker = new JibriTracker(logger, redisClient);
const requestTracker = new RequestTracker(logger, redisClient);
const h = new Handlers(logger, requestTracker, jibriTracker);

app.post('/job/recording', h.requestRecordingJob);
app.post('/hook/v1/status', h.jibriStateWebhook);

async function processor(req: RecorderRequest): Promise<boolean> {
    try {
        const jibriId = await jibriTracker.nextAvailable();
        logger.debug(`obtained ${jibriId} for ${req.id}`);
    } catch (err) {
        logger.info(`recorder not available: ${err}`);
        return false;
    }
    return true;
}

async function pollForRecorderReqs() {
    await requestTracker.processNextRequest(processor);
    setTimeout(pollForRecorderReqs, 1000);
}
pollForRecorderReqs();

async function pollForRequestUpdates() {
    await requestTracker.processUpdates();
    setTimeout(pollForRequestUpdates, 3000);
}
pollForRequestUpdates();

app.listen(config.HTTPServerPort, () => {
    logger.info(`...listening on :${config.HTTPServerPort}`);
});
