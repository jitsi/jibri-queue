import * as dotenv from 'dotenv';
import got from 'got';
import NodeCache from 'node-cache';
import { sign } from 'jsonwebtoken';
import { RecorderRequestMeta, Update, RecorderRequest } from './request_tracker';
import { JibriTracker } from './jibri_tracker';
import { recorderToken } from './token';
import logger from './logger';

dotenv.config();

export const AsapPubKeyTTL: number = Number(process.env.ASAP_PUB_KEY_TTL) || 3600;
export const RecorderTokenExpSeconds: number = Number(process.env.RECORDER_TOKEN_TTL_SECONDS) || 30;
export const AsapPubKeyBaseUrl: string = process.env.ASAP_PUB_KEY_BASE_URL;
export const AsapJwtIss: string = process.env.ASAP_JWT_ISS;
export const AsapJwtKid: string = process.env.ASAP_JWT_KID;
export const AsapJwtAcceptedAud: string = process.env.ASAP_JWT_AUD;
export const AsapJwtAcceptedIss: string = process.env.ASAP_JWT_ACCEPTED_ISS;
export const AsapJwtAcceptedHookIss: string = process.env.ASAP_JWT_ACCEPTED_HOOK_ISS;
export const TokenSigningKeyFile: string = process.env.TOKEN_SIGNING_KEY_FILE;

const requiredConfig: Array<number | string> = [
    AsapPubKeyBaseUrl,
    AsapJwtIss,
    AsapJwtKid,
    AsapJwtAcceptedAud,
    AsapJwtAcceptedIss,
    AsapJwtAcceptedHookIss,
    TokenSigningKeyFile,
];

requiredConfig.forEach((val, i) => {
    if (!val) {
        throw new Error(`required meet processor config is messing - index:${i}`);
    }
});

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
            audience: 'jitsi',
            algorithm: 'RS256',
            keyid: AsapJwtKid,
            expiresIn: 60 * 60, // 1 hour
        });

        this.asapCache.set('asap', auth);
        return auth;
    }

    async requestProcessor(req: RecorderRequestMeta): Promise<boolean> {
        const jibriId = await this.jibriTracker.nextAvailable();
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

        const response = await got.post(req.externalApiUrl, {
            searchParams: { room: req.roomParam },
            headers: {
                Authorization: `Bearer ${this.authToken()}`,
            },
            json: recorderResponse,
        });

        if (response.statusCode != 200) {
            throw new Error('non-200 response from token response api');
        }

        return true;
    }

    async updateProcessor(req: RecorderRequestMeta, position: number): Promise<boolean> {
        const now = Date.now();
        const created = parseInt(req.created, 10);
        const diffTime = Math.trunc(Math.abs((now - created) / 1000));
        if (diffTime >= 2) {
            logger.debug(`request update ${req.requestId} position: ${position} time: ${diffTime}`);
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
                searchParams: { room: req.roomParam },
                headers: {
                    Authorization: `Bearer ${this.authToken()}`,
                },
                json: update,
            });

            if (response.statusCode != 200) {
                throw new Error('non-200 response from token response api');
            }
        }
        return true;
    }
}
