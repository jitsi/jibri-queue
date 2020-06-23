import path from 'path';
import fs from 'fs';

import XMPPConnection from './XMPPConnection';
import JibriPool from './JibriPool';
import ParticipantQueue from './ParticipantQueue';
import Queue from './Queue';

// FIXME: Maybe handle failures to read the files.
const {
    debug: enableDebug = false,
    service,
    domain,
    username,
    password,
    resource,
    jibriMUC = {},
    jwt: jwtConfig = {}
} = JSON.parse(fs.readFileSync(path.resolve(process.argv[2])));
const privateKey = fs.readFileSync(path.resolve(jwtConfig.privateKeyPath));

const connection = new XMPPConnection({
    resource,
    service,
    domain,
    username,
    password,
    enableDebug
});
const jibriPool = new JibriPool(connection.nodeXmppClient, jibriMUC);
const participantQueue = new ParticipantQueue(connection, jibriPool, {
    jwtConfig: {
        ...jwtConfig,
        privateKey
    }
});
