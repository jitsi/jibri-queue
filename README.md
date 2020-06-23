# jibri-queue

## Building
```
npm install
npm run build
```

You can find the build in `dist/`. There's only one bundled file there - `main.js`.

## Runnning

```
npm start <path_to_config_json>
```

or

```
node dist/main.js <path_to_config_json>
```

### Config.json

You must specify the path to a `config.json` file as a first argument of the app. We read the following properties from there:
 - service - required. This will be a service URL to the xmpp server that we use.
 - domain - required. The domain of the xmpp server.
 - username - required. The username for the xmpp server connection.
 - password - required. The password for the xmpp server connection.
 - resource - required. The resource for the xmpp server connection.
 - jibriMUC - required. Configuration options for the jibri status MUC:
  - domain - required. The domain for the MUC component.
  - room - required. The name of the MUC with jibris.
 - jwt - required. Configuration options for the JWT generation.
  - privateKeyPath - required. The path to the private key.
  - keyid - required. The kid claim.
  - iss - required. The iss claim.
  - expiresIn - required. Period of time after which the JWT will expire.
 - debug - optional. Enable the debug log level.
