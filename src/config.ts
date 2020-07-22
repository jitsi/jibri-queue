import * as dotenv from 'dotenv';

dotenv.config();

export default {
    HTTPServerPort: process.env.PORT || 3000,
    LogLevel: process.env.LOG_LEVEL || 'info',
    RedisHost: process.env.REDIS_HOST || '127.0.0.1',
    RedisPort: process.env.REDIS_PORT || 6379,
    RedisPassword: process.env.REDIS_PASSWORD,
    ASAPDisabled: process.env.ASAP_DISABLED || false,
    ASAPPubKeyTTL: process.env.ASAP_PUB_KEY_TTL || 3600,
    ASAPPubKeyBaseUrl: process.env.ASAP_PUB_KEY_BASE_URL,
    ASAPJwtIssuer: process.env.ASAP_JWT_ISS || 'jibri-queue',
    ASAPJwtAudience: process.env.ASAP_JWT_AUD || 'jibri-queue',
    ASAPJwtAcceptedIss: process.env.ASAP_JWT_ACCEPTED_ISS || 'jitsi',
    ASAPJwtAcceptedHookIss: process.env.ASAP_JWT_ACCEPTED_HOOK_ISS || 'jibri',
};
