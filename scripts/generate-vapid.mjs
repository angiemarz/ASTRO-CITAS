// Genera un par de llaves VAPID (P-256) para las notificaciones push.
// Uso: npm run vapid
import { webcrypto as crypto } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicRaw = await crypto.subtle.exportKey('raw', keys.publicKey);
const privateJwk = await crypto.subtle.exportKey('jwk', keys.privateKey);

console.log('\nLlaves VAPID generadas ✨  Guárdalas como secretos del Worker:\n');
console.log(`VAPID_PUBLIC_KEY=${b64url(publicRaw)}`);
console.log(`VAPID_PRIVATE_KEY=${privateJwk.d}`);
console.log('\nComandos:');
console.log('  npx wrangler secret put VAPID_PUBLIC_KEY');
console.log('  npx wrangler secret put VAPID_PRIVATE_KEY\n');
console.log('Para desarrollo local, cópialas en el archivo .dev.vars\n');
