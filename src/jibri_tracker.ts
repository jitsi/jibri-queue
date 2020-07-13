import { Logger } from 'winston';
import Redis from 'ioredis';

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
    private logger: Logger;

    static readonly idleTTL = 90; // seconds
    static readonly pendingTTL = 10; // seconds

    constructor(logger: Logger, redisClient: Redis.Redis) {
        this.logger = logger;
        this.redisClient = redisClient;
    }

    async track(state: JibriState): Promise<boolean> {
        const key = `jibri:idle:${state.jibriId}`;
        if (
            state.status.busyStatus === JibriStatusState.Idle &&
            state.status.health.healthStatus === JibriHealthState.Healthy
        ) {
            const result = await this.redisClient.set(key, 1, 'ex', JibriTracker.idleTTL);
            if (result !== 'OK') {
                throw new Error(`unable to set ${key}`);
            }
            return true;
        }
        await this.redisClient.del(key);
        return false;
    }

    async setPending(jibriID: string): Promise<void> {
        const key = `jibri:pending:${jibriID}`;
        const result = await this.redisClient.set(key, 1, 'ex', JibriTracker.pendingTTL);
        if (result !== 'OK') {
            throw new Error(`unable to set ${key}`);
        }
    }

    async nextAvailable(): Promise<string> {
        const idle: Array<string> = [];
        let cursor = '0';
        do {
            const result = await this.redisClient.scan(cursor, 'match', 'jibri:idle:*');
            cursor = result[0];
            idle.push(...result[1]);
        } while (cursor != '0');

        this.logger.debug(`idle jibri: ${idle}`);

        const pending: Array<string> = [];
        cursor = '0';
        do {
            const result = await this.redisClient.scan(cursor, 'match', 'jibri:pending:*');
            cursor = result[0];
            pending.push(...result[1]);
        } while (cursor != '0');

        this.logger.debug(`pending jibri: ${pending}`);

        for (const value of idle) {
            const id: string = value.split(':')[2];
            const pendingKey = `jibri:pending:${id}`;
            this.logger.debug(`checking pending ${pendingKey}`);
            if (!pending.includes(pendingKey)) {
                this.logger.debug(`${id} is not pending; will reserve`);
                await this.setPending(id);
                return id;
            }
        }
        throw new Error('no recorders available');
    }
}
