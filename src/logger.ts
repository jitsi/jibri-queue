import winston from 'winston';
import config from './config';

const logFormat = winston.format.combine(winston.format.json(), winston.format.timestamp());

const options: winston.LoggerOptions = {
    format: logFormat,
    transports: [
        new winston.transports.Console({
            level: config.LogLevel,
        }),
    ],
};

const logger = winston.createLogger(options);

export default logger;
