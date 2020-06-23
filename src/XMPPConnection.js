/** @jsx xml */

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
    constructor(config = {}) {
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
        this._client.on("error", this._onError);
        this._client.on("offline", this._onOffline);
        this._client.on("stanza", this._onStanza);
        this._client.on("online", this._onOnline);

        this._client.start().catch(this._onError);
    }

    /**
     * Returns the underlying @xmpp/client instance.
     *
     * @return {Object}
     */
    get nodeXmppClient() {
        return this._client;
    }

    /**
     * XMPP error handler.
     *
     * @param {Object} error - The error.
     * @returns {void}
     */
    _onError(error) {
        console.error(`${this} error:`, error);
        this.emit('error', error);
    }

    /**
     * XMPP offline handler.
     *
     * @returns {void}
     */
    _onOffline() {
        console.log(`${this} is offline!`);
        this.emit('offline');
    }

    /**
     * XMPP online handler.
     *
     * @param {Object} address - Our jid.
     * @returns {void}
     */
    _onOnline(address) {
        console.log(`${this} is online!`);
        this.emit('online', address);
    }

    /**
     * XMPP stanza handler.
     *
     * @param {Object} stanza - The stanza that is received.
     * @returns {void}
     */
    _onStanza(stanza) {
        this.emit('stanza', stanza);
    }

    /**
     * Jibri-queue IQ handler.
     *
     * @param {Object} ctx - Contains the stanza and also the jibri-queue element.
     * @returns {void}
     */
    _onIQReceived(ctx) {
        const { element, stanza } = ctx;
        const { attrs } = element;
        const { action } = attrs;

        switch (action){
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
                <bad-request xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/>
            </error>);
    }

    /**
     * Send a token to an user with given jid.
     * @param {string} jid - The jid of the user.
     * @param {string} token - The token.
     * @returns {boolean} - True on success and false otherwise.
     */
    async sendJWT(jid, token) {
        try {
            await this._client.iqCaller.set(<jibri-queue xmlns = 'http://jitsi.org/protocol/jibri-queue' action = 'token' value = { token } />, jid, IQ_TIMEOUT);
            return true;
        } catch (error) {
            // we've resceived error responce or the timeout expired.
            console.error(`${this} error:`, error);
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
    async sendUserInfo(jid, { position, time}) {
        try {
            await this._client.iqCaller.set(
                <jibri-queue xmlns = 'http://jitsi.org/protocol/jibri-queue' action = 'info'>
                    <position>{ position }</position>
                    <time>{ time }</time>
                </jibri-queue>,
                jid,
                IQ_TIMEOUT);

            return true;
        } catch (error) {
            // we've resceived error responce or the timeout expired.
            console.error(`${this} error:`, error);

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
        console.log(`${this} is disconnecting`);
        try {
            await this._xmpp.send(<presence type = "unavailable" />);
        } catch (error) {
            console.error(`${this} error:`, error);
        }
        try {
            await this._xmpp.stop();
        } catch(error) {
            console.error(`${this} error:`, error);
        }
    }
}

