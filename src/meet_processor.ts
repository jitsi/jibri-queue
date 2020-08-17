import * as dotenv from 'dotenv';
import envalid from 'envalid';
import got from 'got';
import NodeCache from 'node-cache';
import { sign } from 'jsonwebtoken';
import { RecorderRequestMeta, Update, RecorderRequest } from './request_tracker';
import { JibriTracker } from './jibri_tracker';
import { recorderToken } from './token';
import { Context } from './context';
import Redis from 'ioredis';

dotenv.config();

const env = envalid.cleanEnv(process.env, {
    ASAP_PUB_KEY_TTL: envalid.num({ default: 3600 }),
    RECORDER_TOKEN_TTL_SECONDS: envalid.num({ default: 30 }),
    ASAP_PUB_KEY_BASE_URL: envalid.str(),
    ASAP_JWT_ISS: envalid.str(),
    ASAP_JWT_KID: envalid.str(),
    ASAP_JWT_AUD: envalid.str(),
    ASAP_JWT_ACCEPTED_AUD: envalid.str(),
    ASAP_JWT_ACCEPTED_ISS: envalid.str(),
    ASAP_JWT_ACCEPTED_HOOK_ISS: envalid.str(),
    TOKEN_SIGNING_KEY_FILE: envalid.str(),
});

export const AsapPubKeyTTL = env.ASAP_PUB_KEY_TTL;
export const RecorderTokenExpSeconds = env.RECORDER_TOKEN_TTL_SECONDS;
export const AsapPubKeyBaseUrl = env.ASAP_PUB_KEY_BASE_URL;
export const AsapJwtIss = env.ASAP_JWT_ISS;
export const AsapJwtKid = env.ASAP_JWT_KID;
export const AsapJwtAud = env.ASAP_JWT_AUD;
export const AsapJwtAcceptedAud = env.ASAP_JWT_ACCEPTED_AUD;
export const AsapJwtAcceptedIss = env.ASAP_JWT_ACCEPTED_ISS;
export const AsapJwtAcceptedHookIss = env.ASAP_JWT_ACCEPTED_HOOK_ISS;
export const TokenSigningKeyFile = env.TOKEN_SIGNING_KEY_FILE;

export interface MeetProcessorOptions {
    jibriTracker: JibriTracker;
    signingKey: Buffer;
}

interface TokenResponse extends RecorderRequest {
    token: string;
}

export class MeetProcessor {
    private jibriTracker: JibriTracker;
    private signingKey: Buffer;
    private asapCache: NodeCache;
    private redisClient: Redis.Redis;

    constructor(options: MeetProcessorOptions) {
        this.jibriTracker = options.jibriTracker;
        this.signingKey = options.signingKey;
        this.asapCache = new NodeCache({ stdTTL: 60 * 45 }); // TTL of 45 minutes
        this.requestProcessor = this.requestProcessor.bind(this);
        this.updateProcessor = this.updateProcessor.bind(this);
    }

    authToken(): string {
        const cachedAuth: string = this.asapCache.get('asap');
        if (cachedAuth) {
            return cachedAuth;
        }

        const auth = sign({}, this.signingKey, {
            issuer: AsapJwtIss,
            audience: AsapJwtAud,
            algorithm: 'RS256',
            keyid: AsapJwtKid,
            expiresIn: 60 * 60, // 1 hour
        });

        this.asapCache.set('asap', auth);
        return auth;
    }

    async requestProcessor(ctx: Context, req: RecorderRequestMeta): Promise<boolean> {
        try {
            await this.jibriTracker.nextAvailable(ctx);
        } catch (err) {
            if (err.name === 'RecorderUnavailableError') {
                ctx.logger.debug('no recorders');
                return false;
            }
            throw err;
        }

        const token = recorderToken(
            {
                issuer: AsapJwtIss,
                audience: 'jitsi',
                subject: '*',
                algorithm: 'RS256',
                keyid: AsapJwtKid,
                expiresIn: RecorderTokenExpSeconds,
            },
            this.signingKey,
        );

        const recorderResponse: TokenResponse = {
            conference: req.conference,
            roomParam: req.roomParam,
            externalApiUrl: req.externalApiUrl,
            eventType: 'QueueUpdate',
            participant: req.participant,
            requestId: req.requestId,
            token: token,
        };

        ctx.logger.debug('sending response to signal api');
        const response = await got.post(req.externalApiUrl, {
            throwHttpErrors: false,
            searchParams: { room: req.roomParam },
            headers: {
                Authorization: `Bearer ${this.authToken()}`,
            },
            json: recorderResponse,
        });

        switch (response.statusCode) {
            case 200: {
                return true;
            }
            case 404: {
                // conference no longer exists
                ctx.logger.debug(`conference for ${req.requestId} no longer exists`);
                const err = new Error('conference canceled');
                err.name = 'CanceledError';
                throw err;
            }
            default: {
                ctx.logger.error(`unexpected response from signal api ${response.statusCode} - ${response.body}`);
                throw new Error('unexpected response from token response api');
            }
        }
    }

    async updateProcessor(ctx: Context, req: RecorderRequestMeta, position: number): Promise<boolean> {
        const now = Date.now();
        const created = parseInt(req.created, 10);
        const diffTime = Math.trunc(Math.abs((now - created) / 1000));

        if (diffTime < 2) {
            // Not processing updates unless the request is older than 2 seconds.
            return true;
        }

        ctx.logger.debug(`request update ${req.requestId} position: ${position} time: ${diffTime}`);
        const update: Update = {
            conference: req.conference,
            roomParam: req.roomParam,
            externalApiUrl: req.externalApiUrl,
            eventType: 'QueueUpdate',
            participant: req.participant,
            requestId: req.requestId,
            position: position,
            time: diffTime,
        };

        // TODO: metrics, retry
        const response = await got.post(req.externalApiUrl, {
            throwHttpErrors: false,
            searchParams: { room: req.roomParam },
            headers: {
                Authorization: `Bearer ${this.authToken()}`,
            },
            json: update,
        });

        switch (response.statusCode) {
            case 200: {
                return true;
            }
            case 404: {
                // conference no longer exists
                ctx.logger.debug(`conference for ${req.requestId} no longer exists`);
                const err = new Error('conference canceled');
                err.name = 'CanceledError';
                throw err;
            }
            default: {
                if (response.statusCode != 200) {
                    throw new Error('non-200 response from token response api');
                }
            }
        }
    }
}
