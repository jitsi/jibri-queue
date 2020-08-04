#!/bin/sh

set -e

# pre-run.sh is intended to include environment specific
# setup such as env var injection of secrets.
if [ -f /usr/jitsi/pre-run.sh ]; then
    . /usr/jitsi/pre-run.sh
fi

node /usr/src/app/app.js
