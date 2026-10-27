// Verifica que el cifrado RFC 8291 del Worker se pueda descifrar como lo haría el navegador.
import { describe, expect, it } from 'vitest';
import { b64url, fromB64url } from '../worker/auth';
import { encryptPayload } from '../worker/webpush';

const subtle = globalThis.crypto.subtle;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

describe('Web Push aes128gcm', () => {
  it('el contenido cifrado se descifra con las llaves del navegador', async () => {
    const ua = (await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const uaPublic = new Uint8Array(await subtle.exportKey('raw', ua.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const message = JSON.stringify({ title: '🌙 Cita', body: 'María a las 3:00 PM' });

    const body = await encryptPayload({ endpoint: 'https://example.com', p256dh: b64url(uaPublic), auth: b64url(auth) }, new TextEncoder().encode(message));

    const salt = body.slice(0, 16);
    const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
    const idlen = body[20];
    const asPublic = body.slice(21, 21 + idlen);
    const ciphertext = body.slice(21 + idlen);
    expect(rs).toBe(4096);
    expect(idlen).toBe(65);

    const asKey = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
    const enc = new TextEncoder();
    const keyInfo = new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
    const ikm = await hkdf(auth, shared, keyInfo, 32);
    const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    const aes = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, ciphertext));
    expect(plain[plain.length - 1]).toBe(2);
    expect(new TextDecoder().decode(plain.slice(0, -1))).toBe(message);
  });

  it('base64url ida y vuelta', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(33));
    expect(fromB64url(b64url(bytes))).toEqual(bytes);
  });
});
