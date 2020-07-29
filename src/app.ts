import bodyParser from 'body-parser';
import * as context from './context';
import fs from 'fs';
import config from './config';
import express from 'express';
import Handlers from './handlers';
import Redis from 'ioredis';
import logger from './logger';
import ASAPPubKeyFetcher from './asap';
import jwt from 'express-jwt';
import { JibriTracker } from './jibri_tracker';
import { RequestTracker } from './request_tracker';
import * as meet from './meet_processor';

const jwtSigningKey = fs.readFileSync(meet.TokenSigningKeyFile);
const app = express();

app.use(context.injectContext);
app.use(context.accessLogger);
app.use(bodyParser.json());

// TODO: Add custom error handler for express that handles jwt 401/403
// TODO: Add prometheus stating middleware for each http
// TODO: metrics overview

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
const jibriTracker = new JibriTracker(logger, redisClient);
const requestTracker = new RequestTracker(logger, redisClient);
const h = new Handlers(requestTracker, jibriTracker);

if (config.ProtectedApi === 'false') {
    logger.warn('starting in unprotected api mode');
}

const asapFetcher = new ASAPPubKeyFetcher(logger, meet.AsapPubKeyBaseUrl, meet.AsapPubKeyTTL);
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
    await requestTracker.processNextRequest(meetProcessor.requestProcessor);
    setTimeout(pollForRecorderReqs, 1000);
}
pollForRecorderReqs();

async function pollForRequestUpdates() {
    await requestTracker.processUpdates(meetProcessor.updateProcessor);
    setTimeout(pollForRequestUpdates, 3000);
}
pollForRequestUpdates();

app.listen(config.HTTPServerPort, () => {
    logger.info(`...listening on :${config.HTTPServerPort}`);
});
