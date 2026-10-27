// Entrada de citas desde servicios externos: Cal.com (webhook nativo) y Make / Canva / Zapier / Notion
// (formato genérico). Protegido con el secreto WEBHOOK_SECRET.
import { formatMoney, round2 } from '../../shared/domain';
import { formatDateShort, formatTime, isValidTimeZone, zonedToUtc } from '../../shared/time';
import type { AppointmentStatus, Platform, Settings } from '../../shared/types';
import type { Env } from '../env';
import { HttpError, json, nowIso, type Ctx } from '../http';
import { reminderStatements } from '../reminders';
import { loadSettings } from '../settings';
import { broadcast, pushConfigured } from '../webpush';
import { fetchAppointment, PLATFORMS } from './appointments';

type HookEvent = 'created' | 'rescheduled' | 'cancelled';

/** Datos normalizados de una reserva externa. */
export interface ExternalBooking {
  event: HookEvent;
  source: string;
  external_id: string;
  previous_external_id?: string | null;
  client_name: string;
  phone?: string | null;
  email?: string | null;
  instagram?: string | null;
  messenger?: string | null;
  start: Date;
  end: Date | null;
  duration_min?: number | null;
  services: string[];
  platform?: Platform | null;
  contact?: string | null;
  price?: number | null;
  currency?: 'MXN' | 'USD' | null;
  paid_amount?: number | null;
  notes?: string | null;
  status?: AppointmentStatus | null;
}

const enc = new TextEncoder();

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function authorized(req: Request, url: URL, secret: string, raw: string): Promise<boolean> {
  const token = url.searchParams.get('token') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (token && timingSafeEqual(token, secret)) return true;
  const sig = req.headers.get('x-cal-signature-256');
  if (sig) return timingSafeEqual(sig.toLowerCase(), await hmacHex(secret, raw));
  return false;
}

// ---------- Interpretación de fechas ----------

/** Acepta ISO con zona ("2026-10-28T15:00:00-06:00", "...Z") o sin zona (se toma la zona configurada). */
export function parseWhen(value: unknown, tz: string, time?: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const hm = to24h(String(time ?? '00:00'));
    return hm ? zonedToUtc(s, hm, tz) : null;
  }
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})(:\d{2}(\.\d+)?)?$/.exec(s);
  if (m) return zonedToUtc(m[1], m[2].padStart(5, '0'), tz);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "3:30 PM", "15:30", "3 pm" → "15:30". */
export function to24h(t: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?$/i.exec(t.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const str = (v: unknown, max = 300): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(typeof v === 'object' && v && 'value' in (v as object) ? (v as { value: unknown }).value : v).trim();
  return s ? s.slice(0, max) : null;
};

function inferPlatform(location: string | null, phone: string | null): { platform: Platform; contact: string | null } {
  const loc = (location || '').toLowerCase();
  if (/meet|zoom|teams|daily|video|https?:\/\//.test(loc)) {
    return { platform: 'video', contact: /^https?:\/\//.test(location || '') ? location : null };
  }
  if (/whatsapp/.test(loc)) return { platform: 'whatsapp', contact: phone };
  if (/instagram/.test(loc)) return { platform: 'instagram', contact: null };
  if (/messenger|facebook/.test(loc)) return { platform: 'messenger', contact: null };
  if (/phone|tel|llamada/.test(loc)) return { platform: 'phone', contact: phone || location };
  return phone ? { platform: 'whatsapp', contact: phone } : { platform: 'other', contact: location };
}

// ---------- Formato Cal.com ----------

export function fromCalcom(body: any, tz: string): ExternalBooking | 'ping' | null {
  const trigger = String(body?.triggerEvent || '');
  if (trigger === 'PING') return 'ping';
  const map: Record<string, HookEvent> = {
    BOOKING_CREATED: 'created',
    BOOKING_REQUESTED: 'created',
    BOOKING_RESCHEDULED: 'rescheduled',
    BOOKING_CANCELLED: 'cancelled',
    BOOKING_REJECTED: 'cancelled',
  };
  const event = map[trigger];
  if (!event) return null;
  const p = body.payload || {};
  const r = p.responses || {};
  const attendee = (p.attendees || [])[0] || {};
  const phone = str(r.attendeePhoneNumber) || str(r.phone) || str(attendee.phoneNumber) || str(p.smsReminderNumber);
  const location = str(p.videoCallData?.url) || str(p.metadata?.videoCallUrl) || str(r.location?.value?.optionValue) || str(p.location);
  const { platform, contact } = inferPlatform(location, phone);
  const start = parseWhen(p.startTime, tz);
  if (!start) throw new HttpError(400, 'La reserva de Cal.com no tiene hora de inicio.');
  // Datos extra que la página de reservas (Canva) envía en el enlace de Cal.com como metadata[...]
  // o como preguntas de reserva: servicios elegidos, total, ubicación de la clienta y número de cita.
  const md = { ...(p.metadata || {}) } as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = str(md[k], 1000) || str(r[k], 1000);
      if (v) return v;
    }
    return null;
  };
  const selected = splitServices(pick('servicios', 'services', 'servicio'));
  const citaNum = /^(\d+)\s*(?:de|\/)\s*\d+/i.exec(pick('cita', 'cita_numero') ?? '');
  // En paquetes de 2 sesiones el precio se cobra en la primera; las siguientes van en $0.
  const laterSession = !!citaNum && Number(citaNum[1]) > 1;
  const total = laterSession ? 0 : Number(String(pick('total', 'precio', 'price') ?? '').replace(/[^\d.]/g, ''));
  const extra = [
    pick('ubicacion', 'ubicación', 'ciudad', 'location_city') && `Vive en: ${pick('ubicacion', 'ubicación', 'ciudad', 'location_city')}`,
    pick('cita', 'cita_numero') && `Cita ${pick('cita', 'cita_numero')}${laterSession ? ' (el precio se registró en la primera cita)' : ''}`,
    pick('descuento', 'discount') && `Descuento: ${pick('descuento', 'discount')}`,
    pick('resumen', 'summary'),
  ].filter(Boolean);
  return {
    event,
    source: 'calcom',
    external_id: String(p.uid || p.bookingId || ''),
    previous_external_id: str(p.rescheduleUid) || str(p.fromReschedule) || str(p.rescheduledFromUid),
    client_name: str(r.name) || str(attendee.name) || 'Clienta de Cal.com',
    phone,
    email: str(r.email) || str(attendee.email),
    start,
    end: parseWhen(p.endTime, tz),
    services: selected.length ? selected : ([str(p.eventTitle) || str(p.type) || str(p.title)].filter(Boolean) as string[]),
    platform,
    contact,
    price: laterSession ? 0 : total > 0 ? total : p.price ? Number(p.price) / (Number(p.price) > 10000 ? 100 : 1) : null,
    currency: String(p.currency || '').toUpperCase() === 'USD' ? 'USD' : null,
    notes: [...extra, str(r.notes), str(p.additionalNotes), str(p.description), str(p.cancellationReason) && `Motivo: ${str(p.cancellationReason)}`]
      .filter(Boolean)
      .join('\n') || null,
    status: trigger === 'BOOKING_REQUESTED' ? 'scheduled' : 'confirmed',
  };
}

/** "Lectura general | Revolución solar" → ["Lectura general", "Revolución solar"]. También acepta comas o saltos de línea. */
export function splitServices(v: string | null): string[] {
  if (!v) return [];
  const sep = v.includes('|') ? /\s*\|\s*/ : /\s*[,\n]\s*/;
  return v.split(sep).map((s) => s.trim()).filter(Boolean).slice(0, 30);
}

// ---------- Formato genérico (Make, Canva, Zapier, Notion…) ----------

const EVENT_ALIASES: Record<string, HookEvent> = {
  created: 'created', create: 'created', new: 'created', nueva: 'created', agendada: 'created', booked: 'created',
  rescheduled: 'rescheduled', reschedule: 'rescheduled', updated: 'rescheduled', reprogramada: 'rescheduled', update: 'rescheduled',
  cancelled: 'cancelled', canceled: 'cancelled', cancel: 'cancelled', cancelada: 'cancelled', deleted: 'cancelled',
};

export function fromGeneric(b: any, tz: string): ExternalBooking {
  const event = EVENT_ALIASES[String(b.event ?? b.evento ?? 'created').toLowerCase()];
  if (!event) throw new HttpError(400, 'El campo "event" debe ser created, rescheduled o cancelled.');
  const start = parseWhen(b.start ?? b.inicio ?? b.start_at ?? b.date ?? b.fecha, tz, b.time ?? b.hora);
  const externalId = str(b.external_id ?? b.id ?? b.booking_id, 200);
  if (!start && event !== 'cancelled') throw new HttpError(400, 'Falta la fecha/hora de inicio ("start").');
  if (!externalId && event !== 'created') throw new HttpError(400, 'Para reprogramar o cancelar se necesita "external_id".');
  const services = Array.isArray(b.services ?? b.servicios)
    ? (b.services ?? b.servicios).map((s: unknown) => str(typeof s === 'object' && s ? (s as { name?: unknown }).name : s, 150)).filter(Boolean)
    : String(b.service ?? b.servicio ?? '')
        .split(/\s*[+,]\s*/)
        .map((s) => s.trim())
        .filter(Boolean);
  const phone = str(b.phone ?? b.telefono, 40);
  const platformRaw = String(b.platform ?? b.plataforma ?? '').toLowerCase();
  const platform = PLATFORMS.includes(platformRaw as Platform)
    ? (platformRaw as Platform)
    : inferPlatform(str(b.location ?? b.platform ?? b.plataforma), phone).platform;
  const num = (v: unknown) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  return {
    event,
    source: (str(b.source ?? b.origen, 30) || 'externa').toLowerCase(),
    external_id: externalId || `auto-${crypto.randomUUID()}`,
    client_name: str(b.client_name ?? b.name ?? b.nombre, 150) || 'Clienta',
    phone,
    email: str(b.email ?? b.correo, 150),
    instagram: str(b.instagram, 100),
    messenger: str(b.messenger, 150),
    start: start ?? new Date(),
    end: parseWhen(b.end ?? b.fin ?? b.end_at, tz),
    duration_min: num(b.duration_min ?? b.duracion),
    services: services as string[],
    platform,
    contact: str(b.contact ?? b.contacto ?? b.meeting_url ?? b.link, 500),
    price: num(b.price ?? b.precio),
    currency: String(b.currency ?? b.moneda ?? '').toUpperCase() === 'USD' ? 'USD' : String(b.currency ?? b.moneda ?? '').toUpperCase() === 'MXN' ? 'MXN' : null,
    paid_amount: num(b.paid_amount ?? b.abono ?? b.pagado),
    notes: str(b.notes ?? b.notas, 5000),
    status: b.status === 'confirmed' || b.confirmada ? 'confirmed' : null,
  };
}

// ---------- Guardado ----------

const SOURCE_LABEL: Record<string, string> = { calcom: 'Cal.com', make: 'Make', canva: 'Canva', notion: 'Notion', zapier: 'Zapier', google: 'Google Calendar' };
const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s;

async function ensureTable(env: Env) {
  // Se crea aquí (además de en la migración 0002) para no requerir pasos manuales en la base de datos.
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS external_bookings (
       source TEXT NOT NULL, external_id TEXT NOT NULL,
       appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
       created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
       PRIMARY KEY (source, external_id))`,
  ).run();
}

async function findLinked(env: Env, source: string, ids: (string | null | undefined)[]): Promise<number | null> {
  for (const id of ids) {
    if (!id) continue;
    const row = await env.DB.prepare(
      'SELECT e.appointment_id FROM external_bookings e JOIN appointments a ON a.id = e.appointment_id WHERE e.source = ? AND e.external_id = ?',
    )
      .bind(source, id)
      .first<{ appointment_id: number }>();
    if (row) return row.appointment_id;
  }
  return null;
}

/** Devuelve [id, nombre guardado]: si la clienta ya existe se conserva el nombre de su ficha. */
async function findOrCreateClient(env: Env, b: ExternalBooking): Promise<[number, string]> {
  const now = nowIso();
  const digits = (b.phone || '').replace(/\D/g, '').slice(-10);
  let row: { id: number; full_name: string } | null = null;
  if (digits.length >= 8) {
    row = await env.DB.prepare(
      "SELECT id, full_name FROM clients WHERE substr(replace(replace(replace(replace(replace(phone,' ',''),'-',''),'+',''),'(',''),')',''), -10) = ? LIMIT 1",
    )
      .bind(digits)
      .first();
  }
  if (!row && b.instagram) {
    row = await env.DB.prepare("SELECT id, full_name FROM clients WHERE lower(replace(instagram,'@','')) = lower(?) LIMIT 1").bind(b.instagram.replace(/^@/, '')).first();
  }
  if (!row) row = await env.DB.prepare('SELECT id, full_name FROM clients WHERE full_name = ? COLLATE NOCASE LIMIT 1').bind(b.client_name).first();
  if (row) {
    await env.DB.prepare(
      'UPDATE clients SET phone = COALESCE(phone, ?), instagram = COALESCE(instagram, ?), messenger = COALESCE(messenger, ?), updated_at = ? WHERE id = ?',
    )
      .bind(b.phone ?? null, b.instagram ?? null, b.messenger ?? null, now, row.id)
      .run();
    return [row.id, row.full_name];
  }
  const created = await env.DB.prepare(
    'INSERT INTO clients (full_name, phone, instagram, messenger, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(b.client_name, b.phone ?? null, b.instagram ?? null, b.messenger ?? null, b.email ? `Correo: ${b.email}` : null, now, now)
    .first<{ id: number }>();
  return [created!.id, b.client_name];
}

async function matchServices(env: Env, names: string[]) {
  const { results } = await env.DB.prepare('SELECT id, name, category, price, currency, duration_min FROM services').all<{
    id: number;
    name: string;
    category: string;
    price: number;
    currency: string;
    duration_min: number | null;
  }>();
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  return names.map((n) => {
    const target = norm(n);
    const s =
      results.find((x) => norm(x.name) === target) ||
      // Coincidencia parcial solo con nombres largos, para no confundir "Dinero" con "Dinero y propósito"
      results.find((x) => norm(x.name).length >= 12 && target.length >= 12 && (target.includes(norm(x.name)) || norm(x.name).includes(target)));
    return s
      ? { service_id: s.id, name: s.name, category: s.category, price: s.price, duration_min: s.duration_min, currency: s.currency }
      : { service_id: null, name: n, category: null, price: 0, duration_min: null, currency: null };
  });
}

async function hasConflict(env: Env, start: string, end: string, excludeId = -1) {
  const r = await env.DB.prepare(
    "SELECT client_name FROM appointments WHERE status NOT IN ('cancelled','no_show') AND start_at < ? AND end_at > ? AND id != ? LIMIT 1",
  )
    .bind(end, start, excludeId)
    .first<{ client_name: string }>();
  return r?.client_name ?? null;
}

function history(env: Env, id: number | 'last', action: string, details: string | null) {
  return id === 'last'
    ? env.DB.prepare('INSERT INTO appointment_history (appointment_id, action, details, created_at) VALUES ((SELECT MAX(id) FROM appointments), ?, ?, ?)').bind(action, details, nowIso())
    : env.DB.prepare('INSERT INTO appointment_history (appointment_id, action, details, created_at) VALUES (?, ?, ?, ?)').bind(id, action, details, nowIso());
}

async function notify(env: Env, exec: ExecutionContext, title: string, body: string, url: string) {
  if (pushConfigured(env)) exec.waitUntil(broadcast(env, { title, body, url, tag: `hook-${url}` }).catch(() => undefined));
}

export async function applyBooking(env: Env, exec: ExecutionContext, b: ExternalBooking, settings: Settings) {
  await ensureTable(env);
  const tz = settings.timezone;
  const use24 = settings.time_format === '24h';
  const label = sourceLabel(b.source);
  const now = nowIso();
  const existingId = await findLinked(env, b.source, [b.external_id, b.previous_external_id]);

  const when = (d: Date | string) => `${formatDateShort(d, tz)} ${formatTime(d, tz, use24)}`;

  // ----- Cancelación -----
  if (b.event === 'cancelled') {
    if (!existingId) return { ok: true, action: 'ignored', reason: 'No se encontró la cita a cancelar.' };
    const appt = (await fetchAppointment(env, existingId))!;
    await env.DB.batch([
      env.DB.prepare("UPDATE appointments SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?").bind(now, now, existingId),
      history(env, existingId, `Cancelada desde ${label}`, b.notes ?? null),
    ]);
    const updated = (await fetchAppointment(env, existingId))!;
    await env.DB.batch(reminderStatements(env, updated, settings));
    await notify(env, exec, `❌ Cita cancelada: ${appt.client_name}`, `${when(appt.start_at)} · desde ${label}`, `/citas/${existingId}`);
    return { ok: true, action: 'cancelled', appointment_id: existingId };
  }

  const lines = await matchServices(env, b.services);
  const catalogDuration = lines.reduce((s, l) => s + (l.duration_min || 0), 0);
  const duration = b.duration_min || catalogDuration || settings.default_duration_min;
  const startIso = b.start.toISOString();
  const endIso = (b.end && b.end > b.start ? b.end : new Date(b.start.getTime() + duration * 60000)).toISOString();

  // ----- Reprogramación (o reenvío de una reserva ya registrada) -----
  if (existingId) {
    const before = (await fetchAppointment(env, existingId))!;
    const conflict = await hasConflict(env, startIso, endIso, existingId);
    const moved = before.start_at !== startIso || before.end_at !== endIso;
    const stmts = [
      env.DB.prepare(
        `UPDATE appointments SET start_at = ?, end_at = ?, updated_at = ?,
           status = CASE WHEN status IN ('cancelled','no_show') THEN 'scheduled' ELSE status END,
           cancelled_at = CASE WHEN status IN ('cancelled','no_show') THEN NULL ELSE cancelled_at END
         WHERE id = ?`,
      ).bind(startIso, endIso, now, existingId),
    ];
    if (b.previous_external_id && b.previous_external_id !== b.external_id) {
      stmts.push(
        env.DB.prepare(
          'INSERT INTO external_bookings (source, external_id, appointment_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
        ).bind(b.source, b.external_id, existingId, now, now),
      );
    }
    if (moved) stmts.push(history(env, existingId, `Reprogramada desde ${label}`, `${when(before.start_at)} → ${when(startIso)}${conflict ? ` · ⚠️ se empalma con ${conflict}` : ''}`));
    await env.DB.batch(stmts);
    const updated = (await fetchAppointment(env, existingId))!;
    await env.DB.batch(reminderStatements(env, updated, settings));
    if (moved) await notify(env, exec, `🔁 Cita reprogramada: ${before.client_name}`, `Ahora: ${when(startIso)} · desde ${label}`, `/citas/${existingId}`);
    return { ok: true, action: moved ? 'rescheduled' : 'unchanged', appointment_id: existingId };
  }

  // ----- Nueva cita -----
  const [clientId, clientName] = await findOrCreateClient(env, b);
  const subtotal = round2(lines.reduce((s, l) => s + (Number(l.price) || 0), 0));
  const finalPrice = b.price != null ? round2(b.price) : subtotal;
  const currency = b.currency || (lines.find((l) => l.currency)?.currency as 'MXN' | 'USD' | undefined) || settings.default_currency;
  const conflict = await hasConflict(env, startIso, endIso);
  const notes = [b.notes, b.email && `Correo: ${b.email}`].filter(Boolean).join('\n') || null;
  const status: AppointmentStatus = b.status || 'scheduled';
  const contact = b.contact || (b.platform === 'instagram' ? b.instagram : b.platform === 'messenger' ? b.messenger : b.phone) || null;

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO appointments (client_id, client_name, start_at, end_at, timezone, platform, contact_value, status, currency,
         original_price, discount, final_price, manual_price, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      clientId,
      clientName,
      startIso,
      endIso,
      tz,
      b.platform || 'other',
      contact,
      status,
      currency,
      Math.max(subtotal, finalPrice),
      round2(Math.max(0, subtotal - finalPrice)),
      finalPrice,
      b.price != null && finalPrice !== subtotal ? 1 : 0,
      notes,
      now,
      now,
    ),
    ...lines.map((l) =>
      env.DB.prepare(
        'INSERT INTO appointment_services (appointment_id, service_id, name, category, price, duration_min) VALUES ((SELECT MAX(id) FROM appointments), ?, ?, ?, ?, ?)',
      ).bind(l.service_id, l.name, l.category, l.price, l.duration_min),
    ),
    env.DB.prepare(
      'INSERT INTO external_bookings (source, external_id, appointment_id, created_at, updated_at) VALUES (?, ?, (SELECT MAX(id) FROM appointments), ?, ?)',
    ).bind(b.source, b.external_id, now, now),
    history(env, 'last', `Cita agendada desde ${label}`, conflict ? `⚠️ Se empalma con ${conflict}` : null),
  ];
  if (b.paid_amount && b.paid_amount > 0) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO payments (appointment_id, amount, method, paid_at, note, created_at) VALUES ((SELECT MAX(id) FROM appointments), ?, ?, ?, ?, ?)",
      ).bind(round2(b.paid_amount), label, now, `Pago registrado por ${label}`, now),
    );
  }
  await env.DB.batch(stmts);
  const created = await env.DB.prepare('SELECT MAX(id) AS id FROM appointments').first<{ id: number }>();
  const appt = (await fetchAppointment(env, created!.id))!;
  await env.DB.batch(reminderStatements(env, appt, settings));
  const svc = appt.services.map((s) => s.name).join(' + ');
  await notify(
    env,
    exec,
    `🌸 Nueva cita: ${appt.client_name}`,
    `${when(startIso)}${svc ? ` · ${svc}` : ''} · ${formatMoney(appt.final_price, appt.currency)}${conflict ? ` · ⚠️ se empalma con ${conflict}` : ''}`,
    `/citas/${appt.id}`,
  );
  return { ok: true, action: 'created', appointment_id: appt.id, conflict: conflict ?? undefined };
}

// ---------- Handlers ----------

export async function bookingHook({ req, env, url, exec }: Ctx) {
  if (!env.WEBHOOK_SECRET) throw new HttpError(503, 'Falta configurar el secreto WEBHOOK_SECRET en Cloudflare.');
  const raw = await req.text();
  if (raw.length > 200_000) throw new HttpError(413, 'Contenido demasiado grande.');
  if (!(await authorized(req, url, env.WEBHOOK_SECRET, raw))) throw new HttpError(401, 'Clave del webhook incorrecta.');
  let body: any;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    throw new HttpError(400, 'El contenido debe ser JSON.');
  }
  const settings = await loadSettings(env);
  const tz = isValidTimeZone(String(body.timezone || '')) ? String(body.timezone) : settings.timezone;
  const booking = body.triggerEvent ? fromCalcom(body, tz) : fromGeneric(body, tz);
  if (booking === 'ping') return json({ ok: true, message: 'Conexión con AstroBloomx Agenda lista ✨' });
  if (!booking) return json({ ok: true, action: 'ignored', reason: 'Evento no utilizado.' });
  if (!booking.external_id) throw new HttpError(400, 'La reserva no tiene identificador.');
  return json(await applyBooking(env, exec, booking, settings));
}

/** Datos para la sección "Integraciones" de Configuración (solo con sesión iniciada). */
export async function integrationsInfo({ env, url }: Ctx) {
  const base = `${url.origin}/api/hooks/booking`;
  return json({
    configured: !!env.WEBHOOK_SECRET,
    url: env.WEBHOOK_SECRET ? `${base}?token=${encodeURIComponent(env.WEBHOOK_SECRET)}` : null,
    base,
  });
}
