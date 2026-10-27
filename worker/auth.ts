// Autenticación de un solo usuario: contraseña con PBKDF2-SHA256 y sesiones en D1
// con cookie HttpOnly + Secure + SameSite=Strict.
import type { Env } from './env';
import { HttpError, json, nowIso, readJson, type Ctx } from './http';

const SESSION_COOKIE = 'abx_session';
const SESSION_DAYS = 60;
// 50 000 iteraciones mantiene el inicio de sesión dentro del límite de CPU del plan gratuito
// de Workers; el bloqueo por intentos fallidos evita ataques de fuerza bruta.
const PBKDF2_ITERATIONS = 50_000;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const enc = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256(s: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return b64url(bits);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'local';
}

function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function sessionCookie(token: string, req: Request, maxAge: number): string {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function validatePassword(pw: unknown): string {
  const s = typeof pw === 'string' ? pw : '';
  if (s.length < 10) throw new HttpError(400, 'La contraseña debe tener al menos 10 caracteres.');
  if (s.length > 200) throw new HttpError(400, 'La contraseña es demasiado larga.');
  return s;
}

async function hasOwner(env: Env): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 FROM owner WHERE id = 1').first();
  return !!row;
}

async function createSession(env: Env, req: Request): Promise<string> {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400_000);
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(await sha256(token), now.toISOString(), expires.toISOString(), now.toISOString(), (req.headers.get('user-agent') || '').slice(0, 300))
    .run();
  return token;
}

/** Devuelve true si la petición trae una sesión válida. Renueva la sesión de forma deslizante. */
export async function isAuthenticated(req: Request, env: Env, exec?: ExecutionContext): Promise<boolean> {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return false;
  const hash = await sha256(token);
  const row = await env.DB.prepare('SELECT expires_at, last_seen_at FROM sessions WHERE token_hash = ?')
    .bind(hash)
    .first<{ expires_at: string; last_seen_at: string }>();
  if (!row) return false;
  const now = Date.now();
  if (new Date(row.expires_at).getTime() < now) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
    return false;
  }
  // Actualiza como máximo una vez por hora para ahorrar escrituras.
  if (now - new Date(row.last_seen_at).getTime() > 3600_000) {
    const p = env.DB.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
      .bind(new Date(now).toISOString(), new Date(now + SESSION_DAYS * 86400_000).toISOString(), hash)
      .run();
    exec ? exec.waitUntil(p) : await p;
  }
  return true;
}

/** Protección CSRF adicional: las peticiones que modifican datos deben venir del mismo origen. */
export function checkSameOrigin(req: Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.get('origin');
  if (!origin) return true; // Safari en algunas peticiones same-origin no envía Origin; SameSite=Strict protege
  return origin === new URL(req.url).origin;
}

// ---------- Handlers ----------

export async function authStatus({ req, env }: Ctx) {
  const [configured, authenticated] = await Promise.all([hasOwner(env), isAuthenticated(req, env)]);
  return json({ configured, authenticated, setupCodeRequired: true, setupAvailable: !!env.SETUP_CODE });
}

export async function setup({ req, env }: Ctx) {
  if (await hasOwner(env)) throw new HttpError(409, 'La agenda ya fue configurada. Inicia sesión.');
  if (!env.SETUP_CODE) {
    throw new HttpError(503, 'Falta configurar el secreto SETUP_CODE en Cloudflare (ver README).');
  }
  const body = await readJson<{ setup_code?: string; password?: string }>(req);
  if (!timingSafeEqual(String(body.setup_code ?? ''), env.SETUP_CODE)) {
    await logAttempt(env, req, false);
    throw new HttpError(403, 'El código de configuración no es correcto.');
  }
  const password = validatePassword(body.password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  const now = nowIso();
  await env.DB.prepare(
    'INSERT INTO owner (id, password_hash, salt, iterations, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)',
  )
    .bind(hash, b64url(salt), PBKDF2_ITERATIONS, now, now)
    .run();
  const token = await createSession(env, req);
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token, req, SESSION_DAYS * 86400) });
}

async function logAttempt(env: Env, req: Request, success: boolean) {
  await env.DB.prepare('INSERT INTO login_attempts (ip, success, created_at) VALUES (?, ?, ?)')
    .bind(clientIp(req), success ? 1 : 0, nowIso())
    .run();
}

async function assertNotLocked(env: Env, req: Request) {
  const since = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND success = 0 AND created_at > ?',
  )
    .bind(clientIp(req), since)
    .first<{ n: number }>();
  if ((row?.n ?? 0) >= MAX_FAILED) {
    throw new HttpError(429, `Demasiados intentos fallidos. Espera ${LOCK_MINUTES} minutos e inténtalo de nuevo.`);
  }
}

async function verifyOwnerPassword(env: Env, password: string): Promise<boolean> {
  const owner = await env.DB.prepare('SELECT password_hash, salt, iterations FROM owner WHERE id = 1').first<{
    password_hash: string;
    salt: string;
    iterations: number;
  }>();
  if (!owner) return false;
  const hash = await pbkdf2(password, fromB64url(owner.salt), owner.iterations);
  return timingSafeEqual(hash, owner.password_hash);
}

export async function login({ req, env }: Ctx) {
  if (!(await hasOwner(env))) throw new HttpError(409, 'Primero configura tu contraseña.');
  await assertNotLocked(env, req);
  const body = await readJson<{ password?: string }>(req);
  const ok = await verifyOwnerPassword(env, String(body.password ?? ''));
  await logAttempt(env, req, ok);
  if (!ok) throw new HttpError(401, 'Contraseña incorrecta.');
  // Limpieza de registros viejos
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_attempts WHERE created_at < ?').bind(new Date(Date.now() - 7 * 86400_000).toISOString()),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(nowIso()),
  ]);
  const token = await createSession(env, req);
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token, req, SESSION_DAYS * 86400) });
}

export async function logout({ req, env }: Ctx) {
  const token = getCookie(req, SESSION_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', req, 0) });
}

export async function logoutAll({ req, env }: Ctx) {
  const token = getCookie(req, SESSION_COOKIE);
  const keep = token ? await sha256(token) : '';
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash != ?').bind(keep).run();
  return json({ ok: true });
}

export async function listSessions({ req, env }: Ctx) {
  const token = getCookie(req, SESSION_COOKIE);
  const current = token ? await sha256(token) : '';
  const { results } = await env.DB.prepare(
    'SELECT token_hash, created_at, last_seen_at, user_agent FROM sessions ORDER BY last_seen_at DESC',
  ).all<{ token_hash: string; created_at: string; last_seen_at: string; user_agent: string }>();
  return json(
    results.map((s) => ({
      created_at: s.created_at,
      last_seen_at: s.last_seen_at,
      user_agent: s.user_agent,
      current: s.token_hash === current,
    })),
  );
}

export async function changePassword({ req, env }: Ctx) {
  await assertNotLocked(env, req);
  const body = await readJson<{ current_password?: string; new_password?: string }>(req);
  const ok = await verifyOwnerPassword(env, String(body.current_password ?? ''));
  if (!ok) {
    await logAttempt(env, req, false);
    throw new HttpError(401, 'La contraseña actual no es correcta.');
  }
  const password = validatePassword(body.new_password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  await env.DB.prepare('UPDATE owner SET password_hash = ?, salt = ?, iterations = ?, updated_at = ? WHERE id = 1')
    .bind(hash, b64url(salt), PBKDF2_ITERATIONS, nowIso())
    .run();
  // Cierra todas las demás sesiones
  const token = getCookie(req, SESSION_COOKIE);
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash != ?').bind(token ? await sha256(token) : '').run();
  return json({ ok: true });
}
