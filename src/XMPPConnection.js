// @flow

/** @jsx xml */

// We need xml for the jsx transformation.
// eslint-disable-next-line no-unused-vars
import { client, xml } from '@xmpp/client';
import debug from '@xmpp/debug';
import EventEmitter from 'events';

/**
 * The timeout for IQs.
 *
 * @type {number}
 */
const IQ_TIMEOUT = 30000; // 30s

/**
 * A class that handles the XMPP communication.
 */
export default class XMPPConnection extends EventEmitter {

    _config: Object;
    _client: Object;

    /**
     * Creates new XMPPConnection instance.
     *
     * @param {Object} config - The config options for the XMPP connection.
     * @param {string} config.username - The username used for the XMPP connection to be established.
     * @param {string} config.password - The password used for the XMPP connection to be established.
     * @param {string} config.resource - The resource used for the XMPP connection to be established.
     * @param {string} config.service - The service URL passed to @xmpp/client library.
     * @param {string} config.domain - The domain passed to @xmpp/client library.
     * @param {boolean} [config.enableDebug] - If true @xmpp/debug will be enabled for this XMPP connection.
     */
    constructor(config: Object = {}) {
        super();
        this._config = config;
        const { username, password, resource, service, domain, enableDebug = false } = this._config;

        this._client = client({
            service,
            domain,
            username,
            password,
            resource
        });

        if (enableDebug) {
            debug(this._client, true);
        }

        this._onError = this._onError.bind(this);
        this._onOffline = this._onOffline.bind(this);
        this._onStanza = this._onStanza.bind(this);
        this._onError = this._onError.bind(this);
        this._onOnline = this._onOnline.bind(this);
        this._onIQReceived = this._onIQReceived.bind(this);

        this._client.iqCallee.set('http://jitsi.org/protocol/jibri-queue', 'jibri-queue', this._onIQReceived);
        this._client.on('error', this._onError);
        this._client.on('offline', this._onOffline);
        this._client.on('stanza', this._onStanza);
        this._client.on('online', this._onOnline);

        this._client.start().catch(this._onError);
    }

    /**
     * Returns the underlying @xmpp/client instance.
     *
     * @returns {Object}
     */
    get nodeXmppClient() {
        return this._client;
    }

    _onError: Error => void;

    /**
     * XMPP error handler.
     *
     * @param {Object} error - The error.
     * @returns {void}
     */
    _onError(error: Error) {
        console.error(`${this.toString()} error:`, error);
        this.emit('error', error);
    }

    _onOffline: () => void;

    /**
     * XMPP offline handler.
     *
     * @returns {void}
     */
    _onOffline() {
        console.log(`${this.toString()} is offline!`);
        this.emit('offline');
    }

    _onOnline: string => void;

    /**
     * XMPP online handler.
     *
     * @param {Object} address - Our jid.
     * @returns {void}
     */
    _onOnline(address: string) {
        console.log(`${this.toString()} is online!`);
        this.emit('online', address);
    }

    _onStanza: Object => void;

    /**
     * XMPP stanza handler.
     *
     * @param {Object} stanza - The stanza that is received.
     * @returns {void}
     */
    _onStanza(stanza: Object) {
        this.emit('stanza', stanza);
    }

    _onIQReceived: Object => void;

    /**
     * Jibri-queue IQ handler.
     *
     * @param {Object} ctx - Contains the stanza and also the jibri-queue element.
     * @returns {void}
     */
    _onIQReceived(ctx: Object) {
        const { element, stanza } = ctx;
        const { attrs } = element;
        const { action } = attrs;

        switch (action) {
        case 'join':
            console.log('user join', stanza.attrs.from);
            this.emit('user-joined', stanza.attrs.from);

            return true;
        case 'leave':
            this.emit('user-left', stanza.attrs.from);

            return true;
        }

        return (
            <error type = 'modify'>
                <bad-request xmlns = 'urn:ietf:params:xml:ns:xmpp-stanzas' />
            </error>);
    }

    /**
     * Send a token to an user with given jid.
     *
     * @param {string} jid - The jid of the user.
     * @param {string} token - The token.
     * @returns {boolean} - True on success and false otherwise.
     */
    async sendJWT(jid: string, token: string) {
        try {
            await this._client.iqCaller.set(
                <jibri-queue
                    action = 'token'
                    value = { token }
                    xmlns = 'http://jitsi.org/protocol/jibri-queue' />,
                jid,
                IQ_TIMEOUT);

            return true;
        } catch (error) {
            // we've resceived error responce or the timeout expired.
            console.error(`${this.toString()} error:`, error);

            return false;
        }
    }

    /**
     * Sends an user info IQ to an user with given jid.
     *
     * @param {string} jid - The jid of the user.
     * @param {Object} info - An object with information to be sent. Currently position and time.
     * @returns {boolean} - True on success and false otherwise.
     */
    async sendUserInfo(jid: string, { position, time }: Object) {
        try {
            await this._client.iqCaller.set(
                <jibri-queue
                    action = 'info'
                    xmlns = 'http://jitsi.org/protocol/jibri-queue' >
                    <position>{ position }</position>
                    <time>{ time }</time>
                </jibri-queue>,
                jid,
                IQ_TIMEOUT);

            return true;
        } catch (error) {
            // we've resceived error responce or the timeout expired.
            console.error(`${this.toString()} error:`, error);

            return false;
        }
    }

    /**
     * Creates a text representation of a XMPPConnection instance.
     *
     * @returns {string}
     */
    toString() {
        return '[XMPPConenction]';
    }

    /**
     * Disconnects from the XMPP server.
     *
     * @returns {void}
     */
    async disconnect() {
        console.log(`${this.toString()} is disconnecting`);
        try {
            await this._client.send(<presence type = 'unavailable' />);
        } catch (error) {
            console.error(`${this.toString()} error:`, error);
        }
        try {
            await this._client.stop();
        } catch (error) {
            console.error(`${this.toString()} error:`, error);
        }
    }
}

