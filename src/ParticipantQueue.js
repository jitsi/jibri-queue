// @flow

import JibriPool, { BUSY, FREE } from './JibriPool';
import Queue from './Queue';
import XMPPConnection from './XMPPConnection';
import { safeDecrease, getToken } from './functions';

/**
 * A class that handles the whole logic around the queue with participants.
 */
export default class ParticipantQueue {
    _pendingUsers: number;
    _participantQueue: Queue<string>;
    _connection: XMPPConnection;
    _timeoutQueue: Queue<TimeoutID>;
    _jibriPool: JibriPool;
    _jwtConfig: Object;

    /**
     * Creates a new ParticipantQueue instance.
     *
     * @param {XMPPConnection} connection - The XMPPConnection instance that will be used for communication.
     * @param {JibriPool} jibriPool - The Jibri Pool instance that will be used to monitor the status of the jibris.
     * @param {Object} options - Options objects.
     * @param {Array<string>} optional.elements - Optional arrays with jids of users in the queue for initialization.
     * Currently not used. May be usefull if we start using DB for the users in the queue.
     * @param {Object} options.jwtConfig - JWT config options.
     */
    constructor(connection: XMPPConnection, jibriPool: JibriPool, {
        elements,
        jwtConfig
    }: Object) {
        // NOTE: If we want to restore the state from a DB or something in the future,
        // we need to store _pendingUsers and _participantQueue there!
        this._pendingUsers = 0;
        this._participantQueue = new Queue(elements);

        this._connection = connection;
        this._timeoutQueue = new Queue();
        this._jibriPool = jibriPool;
        this._jwtConfig = jwtConfig;

        this._haveAvailableJibri = this._haveAvailableJibri.bind(this);
        this._onJibriJoined = this._onJibriJoined.bind(this);
        this._onJibriStatusChanged = this._onJibriStatusChanged.bind(this);
        this._onUserJoined = this._onUserJoined.bind(this);

        jibriPool.on('joined', this._onJibriJoined);
        jibriPool.on('status-changed', this._onJibriStatusChanged);


        // User leaves the queue
        connection.on('user-left', address => {
            this.remove(address);
        });


        connection.on('user-joined', this._onUserJoined);
    }

    _onJibriJoined: () => void;

    /**
     * Jibri joined handler.
     *
     * @returns {void}
     */
    _onJibriJoined() {
        if (this._haveAvailableJibri()) {
            this._sendTokenToUser();
        }
    }

    _onJibriStatusChanged: string => void;

    /**
     * Jibri status changed handler.
     *
     * @param {string} status - The new jibri status.
     * @returns {void}
     */
    _onJibriStatusChanged(status: string) {
        switch (status) {
        case BUSY:
            if (this._pendingUsers > 0) {
                // We assume a pending user has used his token to start a jibri session.
                // We can remove the user from _pendingUsers.
                this._pendingUsers = safeDecrease(this._pendingUsers);

                // NOTE: It is important to remove the oldest timeout in order to make sure that _pendingUsers
                // is not decreased too early and we send more tokens than the number of jibris we have available
                // at the moment! Removing the oldest timeout guarantees that there will be available jibri the
                // next time we send token.
                clearTimeout(this._timeoutQueue.head);
                this._timeoutQueue.removeAt(0);
            } else {
                // This should not happen. We don't have pending users but somehow a jibri session was started!
                // This can indicate a bug somwhere on our side!
                console.warn('A jibri session was started but _pendingUsers = 0!!!');
            }

            break;
        case FREE:
            if (this._haveAvailableJibri()) {
                this._sendTokenToUser();
            }
            break;
        default:

            // This shouldn't happen!
        }
    }

    _haveAvailableJibri: () => number;

    /**
     * Checks if there is available jibri.
     *
     * @returns {boolean} - True if there is available jibri and false otherwise.
     */
    _haveAvailableJibri() {
        return this._jibriPool.freeJibris - this._pendingUsers > 0;
    }

    /**
     * Sends a token to the user from the queue.
     *
     * @returns {void}
     */
    async _sendTokenToUser() {
        if (this._participantQueue.size === 0) { // nobody wait's for jibri!
            return;
        }

        // NOTE: If we want to restore the state from a DB or something in the future,
        // the next 2 operations need to be atomic! Also the removed user should be stored
        // somewhere else in the DB until we actually send the token. This way if the
        // process dies before we actually send the token, when we restart the app, we will
        // be able to generate a new token and send it to the user.
        this._pendingUsers++;
        const user = this._participantQueue.removeAt(0);

        let token;

        try {
            token = await getToken(this._jwtConfig);
        } catch (e) {
            console.error('Error while generating the token!', e);

            // FIXME: What to do in this case! Maybe inform the users and exit with error!
            return;
        }

        // $FlowIssue: on the first line we check for the size of the queue.
        const success = await this._connection.sendJWT(user, token);

        if (success) {
            const tokenTimeout = this._jwtConfig.expiresIn * 1000;

            // We need to wait for tokenTimeout ms and if a jibri haven't switched states we can remove 1 from
            // _pendingUsers because the token will expire anyway and the user won't be able to use a jibri.
            this._timeoutQueue.push(setTimeout(() => {
                this._pendingUsers = safeDecrease(this._pendingUsers);
            }, tokenTimeout));
        } else {
            // FIXME: Maybe check if this is client error and mark as pending. If a malicious client replies with error
            // and in the same time uses the token our pending logic will brake and we may issue more tokens then
            // the number of available jibris at the moment.
            this._pendingUsers = safeDecrease(this._pendingUsers);
        }
    }

    _onUserJoined: string => void;

    /**
     * Handles new users joining the queue.
     *
     * @param {string} jid - The jid of the user.
     * @returns {void}
     */
    _onUserJoined(jid: string) {
        if (this._participantQueue.has(jid)) {
            return;
        }

        this._participantQueue.push(jid);
        console.log('new user joined the queue');

        // Update user's info (position and estimated time) in the queue.
        // TODO: it will be good if we can include this in the result IQ if possible.
        this._updateUserInfoFrom(this._participantQueue.size - 1)
            .catch(e => {
                // We don't expect any errors. But I'm adding catch just in case!
                console.error(e);
            });

        if (this._haveAvailableJibri()) {
            this._sendTokenToUser();
        }
    }

    /**
     * Updates the user info for all users starting from the passed index.
     *
     * @param {number} index - The starting index.
     * @returns {void}
     */
    async _updateUserInfoFrom(index: number = 0) {
        const size = this._participantQueue.size;
        let participantToBeRemoved;

        for (let i = index; i < size; i++) {
            const user = this._participantQueue.getAt(i);

            if (typeof user !== 'string') {
                // since _updateUserInfoFrom is async, probably in meantime an element was removed.
                break;
            }
            const success = await !this._connection.sendUserInfo(user, {
                position: i + 1,
                time: 0 // FIXME: time estimation
            });

            if (!success) {
                // Error while sending the user info. We assume the user left.
                participantToBeRemoved = i;
                break;
            }
        }

        if (typeof participantToBeRemoved !== 'undefined') {
            this.removeAt(participantToBeRemoved);
        }
    }

    /**
     * Removes a user from the queue at the passed index.
     *
     * @param {number} index - The index of the user to be removed.
     * @returns {string} - The jid of the user.
     */
    removeAt(index: number) {
        const user = this._participantQueue.removeAt(index);

        if (typeof user !== 'undefined') { // Makes sure we actually removed an user!
            // NOTE: We don't want to use await here because the update of the user info sent to every user
            // should be a side task that doesn't prevent the caller of removeAt and remove to continue its
            // work. This is especially important for _sendTokenToUser function because we want to remove
            // the user from the queue in case in mean time we are able to start processing the next user
            // in line and in the same time we want to send the token as fast as possible. If we use await here
            // we'll  have to wait for _updateUserInfoFrom to finish before actually sending the token.
            this._updateUserInfoFrom(index)
                .catch(e => {
                    // We don't expect any errors. But I'm adding catch just in case!
                    console.error(e);
                });
        }

        return user;
    }

    /**
     * Removes a user from the queue based on the passed jid.
     *
     * @param {string} jid - The jid of the user.
     * @returns {void}
     */
    remove(jid: string) {
        const index = this._participantQueue.remove(jid);

        if (typeof index === 'number') {
            this._updateUserInfoFrom(index)
                .catch(e => {
                    // We don't expect any errors. But I'm adding catch just in case!
                    console.error(e);
                });
        }

        // else {} // no elements were removed.
    }
}
