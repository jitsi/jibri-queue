/** @jsx xml */

import EventEmitter from 'events';
import { xml } from '@xmpp/client'

import { safeDecrease } from './functions';

/**
 * The busy status string that jibri reports.
 */
export const BUSY = 'busy';

/**
 * The free status string that jibri reports.
 */
export const FREE = 'idle';

/**
 * Class that handles the jibri status updates.
 */
export default class JibriPool extends EventEmitter {
    /**
     * Creates new JibriPool instance.
     *
     * @param {Object} client - The @xmpp/client object.
     * @param {Object} config - Config options.
     * @param {string} config.domain - The domain of the MUC component of the brewery of jibris.
     * @param {string} config.room - The room name of the jibri brewery which we need to join to
     * listen for jibri status updates.
     */
    constructor(client, config = {}) {
        super();
        this._config = config;
        this._xmpp = client;
        this._jibris = new Map();
        this._freeJibris = 0;
        this._busyJibris = 0;
        this._onError = this._onError.bind(this);
        this._onStanza = this._onStanza.bind(this);
        this.toString = this.toString.bind(this);
        this._startPing = this._startPing.bind(this);
        this._stopPing = this._stopPing.bind(this);
        this._onMUCJoined = this._onMUCJoined.bind(this);

        this._xmpp.on("error", this._onError);
        this._xmpp.on("stanza", this._onStanza);
        this._xmpp.on('online', jid => {
            this._jid = jid;
            this._join();
        });


        this._roomNick = 'jibri-queue';
        const { domain, room } = this._config;
        this._mucJID = `${room}@${domain}/${this._roomNick}`;
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
     * XMPP stanza handler. Handles the status updates from the jibris.
     *
     * @param {Object} stanza - The stanza that is received.
     * @returns {void}
     */
    _onStanza(stanza) {
        this.emit('stanza', stanza);
        if (!stanza.is('presence')) {
            return;
        }

        // FIXME: Make sure to handle presences only from the brewery MUC.

        const type = stanza.attrs.type;
        const from = stanza.attrs.from;
        const isNewJibri = !this._jibris.has(from);
        const oldStatus = this._jibris.get(from);

        if (type === 'unavailable') {
            if (isNewJibri) { // probably non-jibri participant left.
                return;
            }

            this._jibris.delete(from);

            switch (oldStatus) {
            case BUSY:
                safeDecrease(this._busyJibris);
                break;
            case FREE:
                safeDecrease(this._freeJibris);
                break;
            default:
                console.warn('A jibri with unknown status left', oldStatus);
            }

            console.log('jibri left');
            this.emit('left');
            return;
        }


        const statusNode = stanza.getChild('jibri-status');

        if (!statusNode) {
            // if there isn't jibri-status node this is probably the presence for a non-jibri participant.
            return;
        }

        const busyStatusNode = statusNode.getChild('busy-status');

        if (!busyStatusNode) {
            // This shouldn't happen.
            console.warn('Can\'t find busy-status node in jibri presence!');
            return;
        }

        const newStatus = busyStatusNode.attrs.status;

        if (isNewJibri) {
            switch (newStatus) {
            case BUSY:
                this._busyJibris++;
                break;
            case FREE:
                this._freeJibris++;
                break;
            default:
                console.warn('A jibri with unknown status joined', newStatus);
                return;
            }
            this._jibris.set(from, newStatus);
            console.log('jibri joined', newStatus);
            this.emit('joined', newStatus);
            return;
        }

        if (oldStatus === newStatus) {
            return;
        }

        switch (newStatus) {
        case BUSY:
            this._busyJibris++;
            safeDecrease(this._freeJibris);
            break;
        case FREE:
            this._freeJibris++;
            safeDecrease(this._busyJibris);
            break;
        default:
            console.warn('A jibri changed its status to an unknown one', newStatus);
            return;
        }

        this._jibris.set(from, newStatus);

        this.emit('status-changed', newStatus);

        console.log('jibri status changed', newStatus);
    }

    /**
     * Returns the number of free jibris.
     *
     * @returns {number} - The number of free jibris.
     */
    get freeJibris() {
        return this._freeJibris;
    }

    /**
     * Returns the number of busy jibris.
     *
     * @returns {number} - The number of busy jibris.
     */
    get busyJibris() {
        return this._busyJibris;
    }

    /**
     * Joins the jibri brewery MUC.
     *
     * @returns {void}
     */
    async _join() {
        try {
            await this._xmpp.send(<presence
                to = { this._mucJID }
                xmlns="jabber:client">
                    <x xmlns="http://jabber.org/protocol/muc"/>
                </presence>);
        } catch (error) {
            console.error(error);
        }
    }

    /**
     * MUC joined handler.
     *
     * @returns {void}
     */
    _onMUCJoined() {
        try {
            this._startPing();
        } catch (error) {
            console.error(`${this} error:`, error);
        }
    }

    /**
     * Creates a text representation of a JibriPool instance.
     *
     * @returns {string}
     */
    toString() {
        return '[JibriMUCParticipant]';
    }

    /**
     * Starts the ping interval in order to keep the MUC connection alive.
     *
     * @returns {void}
     */
    _startPing() {
        this._pingInterval = setInterval(() => {
            try {
                this._xmpp.iqCaller.request(<iq  to={this._config.domain} type="get" xmlns="jabber:client">
                    <ping xmlns="urn:xmpp:ping"/>
                </iq>, 30000);
            } catch(error) {
                console.error(error);
            }
        }, 10000);
    }

    /**
     * Stops the ping interval.
     *
     * @returns {void}
     */
    _stopPing() {
        clearInterval(this._pingInterval);
    }

    /**
     * Leaves the jibri brewery.
     *
     * @returns {void}
     */
    async disconnect() {
        console.log(`${this} is disconnecting`);
        this._stopPing();
        try {
            await this._xmpp.send(<presence from = { this._jid } to={ this._mucJID } type = 'unavailable'/>);
        } catch (error) {
            console.error(error);
        }
    }

}
