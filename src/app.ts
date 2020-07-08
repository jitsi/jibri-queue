import bodyParser from "body-parser";
import config from "./config";
import express from "express";
import Handlers from "./handlers";
import logger from "./logger";
import * as meter from "./meter";
//import * as IORedis from "ioredis";
//import Redlock from "redlock";

const app = express();
app.use(bodyParser.json());

// TODO: Add prometheus stating middleware for each http
// TODO: Add http logging middleware

app.get("/health", (req: express.Request, res: express.Response) => {
    res.send("healthy!");
});

const recorderMeter = new meter.RecorderMeter({
    redisHost: config.RedisHost,
    redisPort: Number(config.RedisPort),
    redisPassword: config.RedisPassword,
    logger: logger,
});

const h = new Handlers(logger, recorderMeter);
app.post("/job/recording", h.requestRecordingJob);

recorderMeter.start();

app.listen(config.HTTPServerPort, () => {
    logger.info(`...listening on :${config.HTTPServerPort}`)
});