import express from "express";
import config from "./config";
import logger from "./logger";
import Handlers from "./handlers";
import { RecorderQueue } from "./queue";
import { QueueOptions } from "bullmq";

const app = express();

// TODO: Add prometheus stating middleware for each http
// TODO: Add http logging middleware

//recorderQueue.addRequest("hello", {info: "good bye"})

app.get("/health", (req: express.Request, res: express.Response) => {
    res.send("healthy!");
});

const recorderQueue = new RecorderQueue(logger, { connection: {
    host: config.RedisHost,
    port: Number(config.RedisPort),
    password: config.RedisPassword,
}});

const h = new Handlers(logger, recorderQueue);

app.post("/job/recording", h.requestRecordingJob);

app.listen(config.HTTPServerPort, () => {
    logger.info(`...listening on :${config.HTTPServerPort}`)
});