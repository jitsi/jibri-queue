import * as dotenv from 'dotenv';

dotenv.config();

export default {
    HTTPServerPort: process.env.PORT || 3000,
    LogLevel: process.env.LOG_LEVEL || "info"
}