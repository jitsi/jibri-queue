import express from "express";
import config from "./config";
import logger from "./logger";
import Handlers from "./handlers";

const app = express();

// TODO: Add prometheus stating middleware for each http
// TODO: Add http logging middleware

app.get("/health", (req: express.Request, res: express.Response) => {
    res.send("healthy!");
});

const h = new Handlers(logger);
app.post("/job/recording", h.requestRecordingJob);

app.listen(config.HTTPServerPort, () => {
    logger.info(`...listening on :${config.HTTPServerPort}`)
});