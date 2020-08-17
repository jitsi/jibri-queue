import logger from './logger';
import Redlock from 'redlock';
import Redis from 'ioredis';
import { Context } from './context';

export enum JibriStatusState {
    Idle = 'IDLE',
    Busy = 'BUSY',
}

export enum JibriHealthState {
    Healthy = 'HEALTHY',
    Unhealthy = 'UNHEALTHY',
}

export interface JibriStatus {
    busyStatus: JibriStatusState;
    health: JibriHealth;
}

export interface JibriHealth {
    healthStatus: JibriHealthState;
}

export interface JibriState {
    jibriId: string;
    status: JibriStatus;
}

export class JibriTracker {
    private redisClient: Redis.Redis;
    private pendingLock: Redlock;

    static readonly idleTTL = 90; // seconds
    static readonly pendingTTL = 10000; // milliseconds

    constructor(redisClient: Redis.Redis) {
        this.redisClient = redisClient;
        this.pendingLock = new Redlock(
            // TODO: you should have one client for each independent redis node or cluster
            [this.redisClient],
            {
                driftFactor: 0.01, // time in ms
                retryCount: 3,
                retryDelay: 200, // time in ms
                retryJitter: 200, // time in ms
            },
        );
        this.pendingLock.on('clientError', (err) => {
            logger.error('A pendingLock redis error has occurred:', err);
        });
    }

    async track(ctx: Context, state: JibriState): Promise<boolean> {
        const key = `jibri:idle:${state.jibriId}`;
        if (
            state.status.busyStatus === JibriStatusState.Idle &&
            state.status.health.healthStatus === JibriHealthState.Healthy
        ) {
            const result = await this.redisClient.set(key, 1, 'ex', JibriTracker.idleTTL);
            if (result !== 'OK') {
                ctx.logger.error(`unable to set ${key}`);
                throw new Error(`unable to set ${key}`);
            }
            ctx.logger.debug(`setting ${key}`);
            return true;
        }
        ctx.logger.debug(`deleting ${key}`);
        await this.redisClient.del(key);
        return false;
    }

    async setPending(ctx: Context, key: string): Promise<boolean> {
        try {
            ctx.logger.debug(`attempting lock of ${key}`);
            await this.pendingLock.lock(key, JibriTracker.pendingTTL);
            return true;
        } catch (err) {
            ctx.logger.warn(`error obtaining lock for ${key} - ${err}`);
            return false;
        }
    }

    async nextAvailable(ctx: Context): Promise<string> {
        const idle: Array<string> = [];
        let cursor = '0';
        do {
            const result = await this.redisClient.scan(cursor, 'match', 'jibri:idle:*');
            cursor = result[0];
            idle.push(...result[1]);
        } while (cursor != '0');
        ctx.logger.debug(`idle jibri: ${idle}`);

        for (const value of idle) {
            const id: string = value.split(':')[2];
            const pendingKey = `jibri:pending:${id}`;
            const locked = await this.setPending(ctx, pendingKey);
            if (locked) {
                ctx.logger.debug(`${id} is now pending`);
                return id;
            } else {
                continue;
            }
        }
        const err = new Error('no recorders available');
        err.name = 'RecorderUnavailableError';
        throw err;
    }
}
