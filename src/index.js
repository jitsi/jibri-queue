// @flow
/* global process */

import fs from 'fs';
import path from 'path';

import JibriPool from './JibriPool';
import ParticipantQueue from './ParticipantQueue';
import XMPPConnection from './XMPPConnection';

// FIXME: Maybe handle failures to read the files.

const config = fs.readFileSync(path.resolve(process.argv[2]));
const {
    debug: enableDebug = false,
    service,
    domain,
    username,
    password,
    resource,
    jibriMUC = {},
    jwt: jwtConfig = {}
} = JSON.parse(config.toString());
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
// eslint-disable-next-line no-unused-vars
const participantQueue = new ParticipantQueue(connection, jibriPool, {
    jwtConfig: {
        ...jwtConfig,
        privateKey
    }
});
