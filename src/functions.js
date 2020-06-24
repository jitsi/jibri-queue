// @flow

import jwt from 'jsonwebtoken';

/**
 * Generates new JWT token for jibri.
 *
 * @param {Object} options - The options used to generate the token.
 * @param {string} options.privateKey - The private key that will be used to sign the token.
 * @param {string} options.iss - The value of the iss claim.
 * @param {string} options.keyid - The kid claim value.
 * @param {number} options.expiresIn - The number of seconds in which the token will expire.
 * @returns {string} - The token.
 */
export function getToken(options: Object = {}) {
    const { privateKey, iss, keyid, expiresIn } = options;

    return jwt.sign({
        'iss': iss,
        'aud': 'jitsi',
        'sub': '*',
        'room': '*'
    }, privateKey, {
        algorithm: 'RS256',
        keyid,
        expiresIn
    });
}

/**
 * Utility function for descreasing a value. If the value becomes less then 0,
 * 0 will be returned.
 *
 * @param {number} number - The number to be decreased.
 * @param {number} withN - The number that will be substracted.
 * @returns {number} - The decreased number.
 */
export function safeDecrease(number: number, withN: number = 1) {
    const tmp = number - withN;

    return tmp < 0 ? 0 : tmp;
}
