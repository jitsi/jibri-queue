#!/bin/bash

# pre-run.sh is intended to include environment specific
# setup such as env var injection of secrets.
if [ -f /usr/bin/pre-run.sh ]; then
    . /usr/bin/pre-run.sh
fi

node /usr/src/app/app.js
