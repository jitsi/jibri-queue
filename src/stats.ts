import express from 'express';
import * as promClient from 'prom-client';

promClient.collectDefaultMetrics();

const requestsInFlight = new promClient.Gauge({
    name: 'http_server_requests_in_flight',
    help: 'Gague for requests currently being processed',
    labelNames: ['method'],
});

const requestsTotal = new promClient.Counter({
    name: 'http_server_requests_total',
    help: 'Counter for total requests',
    labelNames: ['method', 'code', 'uri'],
});

const requestDuration = new promClient.Histogram({
    name: 'http_server_request_duration_seconds',
    help: 'duration histogram of http responses',
    labelNames: ['method', 'uri'],
    buckets: [0.003, 0.01, 0.05, 0.1, 0.3, 1.0, 2.5, 10],
});

export function middleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
    const method = req.method.toLowerCase();
    const uri = req.path;

    const end = requestDuration.startTimer({ method, uri });
    requestsInFlight.inc({ method });

    let statted = false;
    const stat = () => {
        if (!statted) {
            statted = true;
            end();
            const code = res.statusCode;
            requestsTotal.inc({ method, code, uri });
            requestsInFlight.dec({ method });
        }
    };
    res.on('finish', stat);
    res.on('close', stat);
    next();
}
