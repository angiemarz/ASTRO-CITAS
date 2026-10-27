// Implementación de Web Push (RFC 8291 aes128gcm + VAPID RFC 8292) usando únicamente WebCrypto.
// La librería "web-push" de npm depende de módulos de Node (crypto, https) que no existen en
// Cloudflare Workers, por eso se implementa aquí directamente.
import { b64url, fromB64url } from './auth';
import type { Env } from './env';

export interface PushSubscriptionRecord {
  id?: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

const enc = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

let vapidKeyCache: { pub: string; key: CryptoKey } | null = null;

async function vapidPrivateKey(publicKeyB64: string, privateKeyB64: string): Promise<CryptoKey> {
  if (vapidKeyCache && vapidKeyCache.pub === publicKeyB64) return vapidKeyCache.key;
  const pub = fromB64url(publicKeyB64);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY inválida');
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: b64url(pub.slice(1, 33)),
    y: b64url(pub.slice(33, 65)),
    d: privateKeyB64,
    ext: true,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  vapidKeyCache = { pub: publicKeyB64, key };
  return key;
}

async function vapidJwt(endpoint: string, subject: string, key: CryptoKey): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64url(
    enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })),
  );
  const unsigned = `${header}.${payload}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned));
  return `${unsigned}.${b64url(sig)}`;
}

/** Cifra el contenido según RFC 8291 (Content-Encoding: aes128gcm). */
export async function encryptPayload(sub: PushSubscriptionRecord, plaintext: Uint8Array): Promise<Uint8Array> {
  const uaPublic = fromB64url(sub.p256dh);
  const authSecret = fromB64url(sub.auth);

  const asKeys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', asKeys.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, asKeys.privateKey, 256),
  );

  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const padded = concat(plaintext, new Uint8Array([2])); // delimitador del último registro
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

export function pushConfigured(env: Env): boolean {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

/** Envía una notificación. Devuelve el código HTTP del servicio de push. */
export async function sendPush(env: Env, sub: PushSubscriptionRecord, msg: PushMessage): Promise<number> {
  if (!pushConfigured(env)) throw new Error('Las llaves VAPID no están configuradas');
  const key = await vapidPrivateKey(env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
  const jwt = await vapidJwt(sub.endpoint, env.VAPID_SUBJECT || 'mailto:astrobloomx@example.com', key);
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(msg)));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high',
      ...(msg.tag ? { Topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}),
    },
    body,
  });
  return res.status;
}

/** Envía a todos los dispositivos registrados y elimina suscripciones vencidas. */
export async function broadcast(env: Env, msg: PushMessage): Promise<{ sent: number; failed: number }> {
  const { results } = await env.DB.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions').all<
    PushSubscriptionRecord & { id: number }
  >();
  let sent = 0;
  let failed = 0;
  for (const sub of results) {
    try {
      const status = await sendPush(env, sub, msg);
      if (status === 404 || status === 410) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run();
        failed++;
      } else if (status >= 200 && status < 300) sent++;
      else {
        console.warn('push status', status, new URL(sub.endpoint).host);
        failed++;
      }
    } catch (e) {
      console.error('push error', e);
      failed++;
    }
  }
  return { sent, failed };
}
