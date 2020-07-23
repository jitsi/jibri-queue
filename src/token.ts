import { sign, SignOptions } from 'jsonwebtoken';

export function recorderToken(options: SignOptions, privateKey: Buffer): string {
    const payload = {
        room: '*',
    };
    return sign(payload, privateKey, options);
}
