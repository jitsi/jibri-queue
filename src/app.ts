import bodyParser from 'body-parser';
import * as context from './context';
import fs from 'fs';
import config from './config';
import express from 'express';
import Handlers from './handlers';
import Redis from 'ioredis';
import logger from './logger';
import * as asap from './asap';
import shortid from 'shortid';
import jwt from 'express-jwt';
import { JibriTracker } from './jibri_tracker';
import { RequestTracker } from './request_tracker';
import * as meet from './meet_processor';

const jwtSigningKey = fs.readFileSync(meet.TokenSigningKeyFile);
const app = express();
const loggedPaths = ['/job/recording', 'job/recording/cancel', 'hook/v1/status'];

app.use(loggedPaths, context.injectContext);
app.use(loggedPaths, context.accessLogger);
app.use(loggedPaths, asap.unauthErrMiddleware);
app.use(loggedPaths, bodyParser.json());

// TODO: Add prometheus stating middleware for each http
// TODO: retry and metrics on outgoing http requests.

// TODO: unittesting
// TODO: doc strings???
// TODO: readme updates and docker compose allthethings

app.get('/health', (req: express.Request, res: express.Response) => {
    res.send('healthy!');
});

const redisClient = new Redis({
    host: config.RedisHost,
    port: Number(config.RedisPort),
    password: config.RedisPassword,
});
const jibriTracker = new JibriTracker(redisClient);
const requestTracker = new RequestTracker(redisClient);
const h = new Handlers(requestTracker, jibriTracker);

if (config.ProtectedApi === 'false') {
    logger.warn('starting in unprotected api mode');
}

const asapFetcher = new asap.ASAPPubKeyFetcher(logger, meet.AsapPubKeyBaseUrl, meet.AsapPubKeyTTL);
app.post(
    '/job/recording',
    jwt({
        secret: asapFetcher.pubKeyCallback,
        audience: meet.AsapJwtAcceptedAud,
        issuer: meet.AsapJwtAcceptedIss,
        algorithms: ['RS256'],
    }).unless(() => {
        return config.ProtectedApi === 'false';
    }),
    async (req, res, next) => {
        try {
            await h.requestRecordingJob(req, res);
        } catch (err) {
            next(err);
        }
    },
);
app.post(
    '/job/recording/cancel',
    jwt({
        secret: asapFetcher.pubKeyCallback,
        audience: meet.AsapJwtAcceptedAud,
        issuer: meet.AsapJwtAcceptedIss,
        algorithms: ['RS256'],
    }).unless(() => {
        return config.ProtectedApi === 'false';
    }),
    async (req, res, next) => {
        try {
            await h.cancelRecordingJob(req, res);
        } catch (err) {
            next(err);
        }
    },
);
app.post(
    '/hook/v1/status',
    jwt({
        secret: asapFetcher.pubKeyCallback,
        audience: meet.AsapJwtAcceptedAud,
        issuer: meet.AsapJwtAcceptedHookIss,
        algorithms: ['RS256'],
    }).unless(() => {
        return config.ProtectedApi === 'false';
    }),
    async (req, res, next) => {
        try {
            await h.jibriStateWebhook(req, res);
        } catch (err) {
            next(err);
        }
    },
);

const meetProcessor = new meet.MeetProcessor({
    jibriTracker: jibriTracker,
    signingKey: jwtSigningKey,
});

async function pollForRecorderReqs() {
    const start = Date.now();
    const pollId = shortid.generate();
    const pollLogger = logger.child({
        id: pollId,
    });
    const ctx = new context.Context(pollLogger, start, pollId);
    await requestTracker.processNextRequest(ctx, meetProcessor.requestProcessor);
    setTimeout(pollForRecorderReqs, 1000);
}
pollForRecorderReqs();

async function pollForRequestUpdates() {
    const start = Date.now();
    const pollId = shortid.generate();
    const pollLogger = logger.child({
        id: pollId,
    });
    const ctx = new context.Context(pollLogger, start, pollId);
    await requestTracker.processUpdates(ctx, meetProcessor.updateProcessor);
    setTimeout(pollForRequestUpdates, 3000);
}
pollForRequestUpdates();

app.listen(config.HTTPServerPort, () => {
    logger.info(`...listening on :${config.HTTPServerPort}`);
});
