import util from 'util';
import fs from 'fs';
import * as dotenv from 'dotenv';
import { RecorderRequestMeta } from './request_tracker';
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
const TokenSigningKeyFile: string = process.env.TOKEN_SIGNING_KEY_FILE;

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

let jwtSigningKey: Buffer = undefined;
const readFile = util.promisify(fs.readFile);
readFile(TokenSigningKeyFile).then((buff) => {
    jwtSigningKey = buff;
});

export class MeetProcessor {
    private jibriTracker: JibriTracker;

    constructor(jibriTracker: JibriTracker) {
        this.jibriTracker = jibriTracker;
        this.requestProcessor = this.requestProcessor.bind(this);
    }

    async requestProcessor(req: RecorderRequestMeta): Promise<boolean> {
        try {
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
                jwtSigningKey,
            );
        } catch (err) {
            logger.error(`unable to process request ${err}`);
            return false;
        }
        return true;
    }

    async updateProcessor(req: RecorderRequestMeta, position: number): Promise<boolean> {
        const now = Date.now();
        const created = parseInt(req.created, 10);
        const diffTime = Math.trunc(Math.abs((now - created) / 1000));
        if (diffTime >= 2) {
            logger.debug(`request update ${req.requestId} position: ${position} time: ${diffTime}`);
        }
        return true;
    }
}
