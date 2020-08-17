import * as dotenv from 'dotenv';
import envalid from 'envalid';

dotenv.config();

const env = envalid.cleanEnv(process.env, {
    PORT: envalid.num({ default: 8080 }),
    LOG_LEVEL: envalid.str({ default: 'info' }),
    REDIS_HOST: envalid.str({ default: '127.0.0.1' }),
    REDIS_PORT: envalid.num({ default: 6379 }),
    REDIS_PASSWORD: envalid.str(),
    REDIS_TLS_ENABLED: envalid.bool({ default: true }),
    PROTECTED_API: envalid.bool({ default: true }),
});

export default {
    HTTPServerPort: env.PORT,
    LogLevel: env.LOG_LEVEL,
    RedisHost: env.REDIS_HOST,
    RedisPort: env.REDIS_PORT,
    RedisPassword: env.REDIS_PASSWORD,
    RedisTlsEnabled: env.REDIS_TLS_ENABLED,
    ProtectedApi: env.PROTECTED_API,
};
