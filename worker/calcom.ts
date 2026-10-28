// Sincronización en ambos sentidos con Cal.com usando su API v2 (opcional: requiere el secreto CALCOM_API_KEY).
// - Agenda → Cal.com: si cancelas o reprogramas en la agenda una cita que vino de Cal.com, se refleja allá
//   (y Cal.com avisa a la clienta por correo).
// - Cal.com → Agenda: cada 30 minutos se revisan las reservas para recuperar avisos (webhooks) perdidos.
import { looksLikePhone, parseWhen, splitServices, applyBooking, ensureTable, type ExternalBooking } from './routes/hooks';
import { isRitualOnly, normalizePhoneForWa } from '../shared/domain';
import type { Appointment, Settings } from '../shared/types';
import type { Env } from './env';
import { nowIso } from './http';
import { loadSettings } from './settings';

const API = 'https://api.cal.com/v2';
const API_VERSION = '2024-08-13';

export const calcomConfigured = (env: Env) => !!env.CALCOM_API_KEY;

async function calApi<T = any>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${env.CALCOM_API_BASE || API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.CALCOM_API_KEY}`,
      'cal-api-version': API_VERSION,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* respuesta no JSON */
  }
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
    throw new Error(`Cal.com respondió: ${String(msg).slice(0, 200)}`);
  }
  return data as T;
}

/** UID vigente de Cal.com para una cita (el más reciente, por si se reprogramó). */
export async function linkedCalcomUid(env: Env, appointmentId: number): Promise<string | null> {
  try {
    const row = await env.DB.prepare(
      "SELECT external_id FROM external_bookings WHERE source = 'calcom' AND appointment_id = ? AND external_id NOT LIKE 'pending-%' ORDER BY rowid DESC LIMIT 1",
    )
      .bind(appointmentId)
      .first<{ external_id: string }>();
    return row?.external_id ?? null;
  } catch {
    return null; // la tabla aún no existe: ninguna cita viene de integraciones
  }
}

/** Origen externo de una cita ("calcom", "canva"…), o null si la registraste a mano. */
export async function externalSource(env: Env, appointmentId: number): Promise<string | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT source, EXISTS (SELECT 1 FROM appointment_history h WHERE h.appointment_id = ? AND h.action = 'Agregada a Cal.com') AS pushed
       FROM external_bookings WHERE appointment_id = ? AND external_id NOT LIKE 'pending-%' ORDER BY rowid DESC LIMIT 1`,
    )
      .bind(appointmentId, appointmentId)
      .first<{ source: string; pushed: number }>();
    if (!row) return null;
    return row.pushed ? 'agenda-calcom' : row.source;
  } catch {
    return null;
  }
}

function historyStmt(env: Env, id: number, action: string, details: string | null) {
  return env.DB.prepare('INSERT INTO appointment_history (appointment_id, action, details, created_at) VALUES (?, ?, ?, ?)').bind(
    id,
    action,
    details,
    nowIso(),
  );
}

/**
 * Refleja en Cal.com un cambio hecho en la agenda. Nunca lanza error: deja constancia en el historial.
 * Devuelve un aviso para mostrar si la cita es de Cal.com pero no se pudo (o no se puede) sincronizar.
 */
export async function pushToCalcom(
  env: Env,
  appointmentId: number,
  change: { type: 'cancel'; reason?: string | null } | { type: 'reschedule'; start: string; reason?: string | null },
): Promise<string | null> {
  const uid = await linkedCalcomUid(env, appointmentId);
  if (!uid) return null;
  if (!calcomConfigured(env)) {
    const warning = 'Esta cita viene de Cal.com: haz el mismo cambio allá para que la clienta reciba el aviso y se libere el horario.';
    await historyStmt(env, appointmentId, 'Pendiente en Cal.com', warning).run();
    return warning;
  }
  try {
    if (change.type === 'cancel') {
      await calApi(env, `/bookings/${encodeURIComponent(uid)}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ cancellationReason: change.reason || 'Cancelada desde la agenda' }),
      });
      await historyStmt(env, appointmentId, 'Cancelada también en Cal.com', 'Cal.com avisó a la clienta por correo.').run();
    } else {
      const res = await calApi<{ data?: { uid?: string } }>(env, `/bookings/${encodeURIComponent(uid)}/reschedule`, {
        method: 'POST',
        body: JSON.stringify({ start: change.start, reschedulingReason: change.reason || 'Reprogramada desde la agenda' }),
      });
      const now = nowIso();
      const stmts = [historyStmt(env, appointmentId, 'Reprogramada también en Cal.com', 'Cal.com avisó a la clienta por correo.')];
      if (res?.data?.uid && res.data.uid !== uid) {
        stmts.push(
          env.DB.prepare(
            "INSERT INTO external_bookings (source, external_id, appointment_id, created_at, updated_at) VALUES ('calcom', ?, ?, ?, ?) ON CONFLICT DO NOTHING",
          ).bind(res.data.uid, appointmentId, now, now),
        );
      }
      await env.DB.batch(stmts);
    }
    return null;
  } catch (e) {
    const warning = `No se pudo actualizar en Cal.com (${(e as Error).message}). Hazlo manualmente allá.`;
    await historyStmt(env, appointmentId, '⚠️ Error con Cal.com', warning).run();
    return warning;
  }
}

/** "https://cal.com/usuario/evento" → { username, eventTypeSlug } (o teamSlug para eventos de equipo). */
export function parseEventUrl(url: string | null): { username?: string; teamSlug?: string; eventTypeSlug: string } | null {
  if (!url) return null;
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (parts[0] === 'team' && parts.length >= 3) return { teamSlug: parts[1], eventTypeSlug: parts[2] };
    if (parts.length >= 2) return { username: parts[0], eventTypeSlug: parts[1] };
  } catch {
    /* enlace inválido */
  }
  return null;
}

/** Correo de asistente para Cal.com: alias +cita en Gmail para que cada reserva sea distinta y llegue a tu bandeja. */
export function attendeeEmail(base: string | null | undefined, appointmentId: number): string | null {
  const email = (base || '').trim().replace(/^mailto:/i, '');
  const m = /^([^@\s+]+)(?:\+[^@]*)?@(gmail\.com|googlemail\.com)$/i.exec(email);
  if (m) return `${m[1]}+cita${appointmentId}@${m[2]}`;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

// ---------- Formulario del evento en Cal.com ----------

export interface BookingField {
  type?: string;
  slug?: string;
  label?: string;
  required?: boolean;
  hidden?: boolean;
  options?: ({ value?: string; label?: string } | string)[];
}

/** Campos que Cal.com llena por otras vías (asistente, ubicación, notas…): no se envían como respuestas extra. */
const SYSTEM_FIELDS = new Set(['name', 'email', 'title', 'location', 'notes', 'guests', 'rescheduleReason', 'attendeePhoneNumber', 'smsReminderNumber']);

const formCache = new Map<string, { at: number; fields: BookingField[]; locations: any[] }>();

/** Lee los campos y ubicaciones del evento. Si falla, se sigue sin ellos (Cal.com dirá qué falta). */
export async function eventForm(env: Env, event: { username?: string; teamSlug?: string; eventTypeSlug: string }) {
  const key = `${event.username ?? event.teamSlug}/${event.eventTypeSlug}`;
  const hit = formCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit;
  const empty = { at: Date.now(), fields: [] as BookingField[], locations: [] as any[] };
  try {
    const qs = new URLSearchParams({ eventSlug: event.eventTypeSlug });
    if (event.username) qs.set('username', event.username);
    const res = await calApi<any>(env, `/event-types?${qs}`, { headers: { 'cal-api-version': '2024-06-14' } });
    const list = Array.isArray(res?.data) ? res.data : res?.data ? [res.data] : [];
    const et = list.find((e: any) => e?.slug === event.eventTypeSlug) ?? list[0];
    if (!et) return empty;
    const out = { at: Date.now(), fields: (et.bookingFields ?? []) as BookingField[], locations: (et.locations ?? []) as any[] };
    formCache.set(key, out);
    return out;
  } catch {
    return empty;
  }
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Respuesta para cada campo obligatorio que Cal.com pide y la agenda no envía por otra vía. */
export function fillRequiredFields(
  fields: BookingField[],
  d: { phone: string | null; contact: string | null; notes?: string; name: string; services: string },
): Record<string, string | boolean | number> {
  const out: Record<string, string | boolean | number> = {};
  for (const f of fields) {
    if (!f.slug || !f.required || f.hidden || SYSTEM_FIELDS.has(f.slug)) continue;
    const label = norm(`${f.slug} ${f.label ?? ''}`);
    const optionValue = (o: BookingField['options'] extends (infer T)[] | undefined ? T : never) => (typeof o === 'string' ? o : (o?.value ?? o?.label ?? ''));
    switch (f.type) {
      case 'phone':
        if (d.phone) out[f.slug] = d.phone;
        break;
      case 'email':
        break;
      case 'select':
      case 'radio':
      case 'radioInput': {
        const first = f.options?.map(optionValue).find(Boolean);
        if (first) out[f.slug] = first;
        break;
      }
      case 'multiselect':
      case 'checkbox':
        break;
      case 'boolean':
        out[f.slug] = true;
        break;
      case 'number':
        out[f.slug] = 0;
        break;
      default:
        // text, textarea…
        if (/contact|whatsapp|tel|phone|celular|numero|numero/.test(label)) out[f.slug] = d.contact || d.phone || d.name;
        else if (/servicio|service|consulta|lectura/.test(label)) out[f.slug] = d.services || d.notes || 'Cita registrada desde la agenda';
        else if (/ciudad|ubicacion|donde|city|location/.test(label)) out[f.slug] = 'No indicada';
        else out[f.slug] = d.notes || 'Cita registrada desde la agenda';
    }
  }
  return out;
}

/** Ubicación de la reserva solo si el evento la admite; si no, se omite para que Cal.com use la del evento. */
export function bookingLocation(locations: any[], phone: string | null, contact: string | null): Record<string, unknown> {
  const types = new Set(locations.map((l) => l?.type));
  if (phone && types.has('attendeePhone')) return { location: { type: 'attendeePhone', phone } };
  if (types.has('attendeeDefined')) return { location: { type: 'attendeeDefined', location: contact || 'WhatsApp' } };
  return {};
}

/**
 * Crea la reserva. Si Cal.com pide un campo obligatorio que no se pudo leer del evento
 * ("Missing required booking field response: Contacto"), se reintenta una vez con ese campo lleno.
 */
async function createBooking(env: Env, body: Record<string, any>, d: { contact: string; notes?: string }) {
  try {
    return await calApi<{ data?: any }>(env, '/bookings', { method: 'POST', body: JSON.stringify(body) });
  } catch (e) {
    const m = /Missing required booking field response: (.+?) - it is required/i.exec((e as Error).message);
    if (!m) throw e;
    const label = m[1].trim();
    const slug = norm(label).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const value = /contact|whatsapp|tel|phone|celular|numero/.test(norm(label)) ? d.contact : d.notes || 'Cita registrada desde la agenda';
    const retry = { ...body, bookingFieldsResponses: { ...body.bookingFieldsResponses, [slug]: value, [label]: value } };
    return await calApi<{ data?: any }>(env, '/bookings', { method: 'POST', body: JSON.stringify(retry) });
  }
}

/**
 * Crea en Cal.com una cita registrada en la agenda, para que Cal.com la ponga en Google Calendar al instante.
 * Mientras se crea, la cita se marca como "pendiente" para que el calendario ICS no la muestre y Cal.com no la vea
 * como un choque consigo misma. Devuelve un aviso si no se pudo.
 */
export async function pushCreateToCalcom(env: Env, appt: Appointment, settings: Settings): Promise<string | null> {
  if (!calcomConfigured(env) || !settings.calcom_push_manual) return null;
  const event = parseEventUrl(settings.calcom_event_url);
  if (!event) return null;
  if (['cancelled', 'no_show', 'completed'].includes(appt.status)) return null;
  if (isRitualOnly(appt)) return null; // los rituales no ocupan una hora: no se mandan a Cal.com
  if (new Date(appt.start_at).getTime() < Date.now()) return null;

  const email = attendeeEmail(settings.calcom_attendee_email || env.VAPID_SUBJECT, appt.id);
  if (!email) return 'No se agregó a Cal.com: falta el correo para citas registradas a mano (Configuración → Integraciones).';

  const client = await env.DB.prepare('SELECT phone FROM clients WHERE id = ?').bind(appt.client_id ?? -1).first<{ phone: string | null }>();
  const rawPhone = appt.platform === 'whatsapp' || appt.platform === 'phone' ? appt.contact_value || client?.phone : client?.phone;
  const digits = rawPhone ? normalizePhoneForWa(rawPhone) : '';
  const phone = digits.length >= 10 ? `+${digits}` : null;

  await ensureTable(env);
  const now = nowIso();
  const pending = `pending-${appt.id}`;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO external_bookings (source, external_id, appointment_id, created_at, updated_at) VALUES ('calcom', ?, ?, ?, ?)",
  )
    .bind(pending, appt.id, now, now)
    .run();

  const services = appt.services.map((s) => s.name).join(' | ');
  const notes = [services && `Servicios: ${services}`, appt.notes].filter(Boolean).join('\n') || undefined;
  const contact = phone || appt.contact_value || client?.phone || null;
  // Los campos obligatorios del formulario de TU evento (p. ej. "Contacto") se leen de Cal.com y se llenan solos.
  const form = await eventForm(env, event);
  const extra = fillRequiredFields(form.fields, { phone, contact, notes, name: appt.client_name, services });
  const body: Record<string, unknown> = {
    start: new Date(appt.start_at).toISOString(),
    ...event,
    attendee: { name: appt.client_name, email, timeZone: settings.timezone, language: 'es', ...(phone ? { phoneNumber: phone } : {}) },
    bookingFieldsResponses: {
      ...(phone ? { attendeePhoneNumber: phone } : {}),
      notes,
      ...extra,
    },
    ...bookingLocation(form.locations, phone, contact),
    metadata: { astrobloomx_id: String(appt.id), origen: 'agenda', ...(services ? { servicios: services } : {}) },
  };

  try {
    const res = await createBooking(env, body, { contact: contact || appt.client_name, notes });
    const data = Array.isArray(res?.data) ? res.data[0] : res?.data;
    const uid = data?.uid ? String(data.uid) : null;
    const stmts = [env.DB.prepare('DELETE FROM external_bookings WHERE external_id = ?').bind(pending)];
    if (uid) {
      stmts.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO external_bookings (source, external_id, appointment_id, created_at, updated_at) VALUES ('calcom', ?, ?, ?, ?)",
        ).bind(uid, appt.id, now, now),
      );
    }
    const minutes = Math.round((new Date(appt.end_at).getTime() - new Date(appt.start_at).getTime()) / 60000);
    const end = data?.end ? new Date(data.end).getTime() : null;
    const calMinutes = end ? Math.round((end - new Date(appt.start_at).getTime()) / 60000) : null;
    stmts.push(
      historyStmt(
        env,
        appt.id,
        'Agregada a Cal.com',
        `Cal.com la puso en tu Google Calendar.${calMinutes && calMinutes !== minutes ? ` En Cal.com dura ${calMinutes} min (la duración de tu evento).` : ''}`,
      ),
    );
    await env.DB.batch(stmts);
    return null;
  } catch (e) {
    await env.DB.prepare('DELETE FROM external_bookings WHERE external_id = ?').bind(pending).run();
    const warning = `Se guardó en tu agenda, pero Cal.com no la aceptó (${(e as Error).message}). El horario sigue bloqueado en Cal.com por tu calendario.`;
    await historyStmt(env, appt.id, '⚠️ No se agregó a Cal.com', warning).run();
    return warning;
  }
}

/** Antes de borrar una cita: recuerda sus reservas externas para no recrearlas y la cancela en Cal.com. */
export async function beforeDelete(env: Env, appointmentId: number): Promise<string | null> {
  try {
    await ensureTable(env);
    await env.DB.prepare(
      'INSERT OR IGNORE INTO external_ignored (source, external_id, created_at) SELECT source, external_id, ? FROM external_bookings WHERE appointment_id = ?',
    )
      .bind(nowIso(), appointmentId)
      .run();
  } catch {
    /* sin integraciones */
  }
  const appt = await env.DB.prepare('SELECT status FROM appointments WHERE id = ?').bind(appointmentId).first<{ status: string }>();
  if (appt && appt.status !== 'cancelled') return pushToCalcom(env, appointmentId, { type: 'cancel', reason: 'Cita eliminada de la agenda' });
  return null;
}

// ---------- Cal.com → Agenda (reconciliación periódica) ----------

const pickResp = (r: Record<string, any>, k: string) => {
  const v = r?.[k];
  if (v === undefined || v === null) return null;
  const s = typeof v === 'object' ? (v.value ?? v.optionValue ?? '') : v;
  return String(s).trim() || null;
};

/** Convierte una reserva de la API v2 de Cal.com al formato del webhook. */
export function fromCalcomApi(b: any, tz: string): ExternalBooking | null {
  const startRaw = b?.start ?? b?.startTime;
  if (!b?.uid || !startRaw) return null;
  // Las reservas viejas de una reprogramación aparecen como canceladas: no deben cancelar la cita nueva.
  if (b.rescheduled === true || b.rescheduledToUid) return null;
  const status = String(b.status || '').toLowerCase();
  const event = status === 'cancelled' || status === 'rejected' ? 'cancelled' : 'created';
  const r = b.bookingFieldsResponses || b.responses || {};
  const md = b.metadata || {};
  const attendee = (b.attendees || [])[0] || {};
  const loc = pickResp(r, 'location') || (typeof b.location === 'string' ? b.location : null);
  const phone = pickResp(r, 'attendeePhoneNumber') || pickResp(r, 'phone') || attendee.phoneNumber || (looksLikePhone(loc) ? loc : null);
  const services = splitServices(String(md.servicios ?? md.services ?? '') || null);
  const cita = /^(\d+)\s*(?:de|\/)\s*\d+/i.exec(String(md.cita ?? ''));
  const followup = !!cita && Number(cita[1]) > 1;
  const total = Number(String(md.total ?? '').replace(/[^\d.]/g, ''));
  const meeting = b.meetingUrl || (typeof b.location === 'string' && /^https?:\/\//.test(b.location) ? b.location : null);
  const start = parseWhen(startRaw, tz);
  if (!start) return null;
  return {
    event,
    source: 'calcom',
    external_id: String(b.uid),
    previous_external_id: b.rescheduledFromUid ? String(b.rescheduledFromUid) : null,
    client_name: pickResp(r, 'name') || attendee.name || 'Clienta de Cal.com',
    phone,
    email: pickResp(r, 'email') || attendee.email || null,
    start,
    end: parseWhen(b.end ?? b.endTime, tz),
    services: services.length ? services : [String(b.eventType?.title || b.title || '').trim()].filter(Boolean),
    platform: meeting ? 'video' : phone ? 'whatsapp' : 'other',
    contact: meeting || phone,
    price: followup ? 0 : total > 0 ? total : null,
    currency: null,
    notes:
      [md.ubicacion && `Vive en: ${md.ubicacion}`, md.cita && `Cita ${md.cita}`, md.descuento && `Descuento: ${md.descuento}`, pickResp(r, 'notes')]
        .filter(Boolean)
        .join('\n') || null,
    status: status === 'pending' || status === 'unconfirmed' ? 'scheduled' : 'confirmed',
    followup,
    agenda_id: Number(md.astrobloomx_id) || null,
  };
}

/** Recupera reservas de Cal.com que no hayan llegado por webhook (o cancelaciones perdidas). */
/** Lista de reservas sin importar la forma de la respuesta ({data: [...]}, {data: {bookings}}, {bookings}). */
export function bookingList(res: any): any[] {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.data?.bookings)) return res.data.bookings;
  if (Array.isArray(res?.bookings)) return res.bookings;
  return [];
}

export async function reconcileCalcom(
  env: Env,
  exec: ExecutionContext,
): Promise<{ checked: number; changed: number; received: number; error?: string }> {
  if (!calcomConfigured(env)) return { checked: 0, changed: 0, received: 0 };
  const settings = await loadSettings(env);
  let checked = 0;
  let changed = 0;
  let received = 0;
  let error: string | undefined;
  try {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    // Se piden por estado y también sin filtro, y se aceptan las distintas formas de respuesta de la API.
    const byUid = new Map<string, any>();
    for (const query of [
      `/bookings?status=upcoming,unconfirmed,cancelled&afterStart=${encodeURIComponent(since)}&take=100&sortStart=asc`,
      `/bookings?afterStart=${encodeURIComponent(since)}&take=100`,
    ]) {
      try {
        for (const raw of bookingList(await calApi(env, query))) if (raw?.uid) byUid.set(String(raw.uid), raw);
      } catch (e) {
        error ??= (e as Error).message;
      }
    }
    received = byUid.size;
    if (received) error = undefined;
    for (const raw of byUid.values()) {
      const booking = fromCalcomApi(raw, settings.timezone);
      if (!booking) continue;
      checked++;
      const r = await applyBooking(env, exec, booking, settings);
      if (r.action === 'created' || r.action === 'cancelled' || r.action === 'rescheduled') changed++;
    }
  } catch (e) {
    error = (e as Error).message;
    console.error('Sincronización Cal.com', error);
  }
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('calcom_last_sync', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  )
    .bind(JSON.stringify({ at: nowIso(), checked, changed, received, error: error ?? null }))
    .run();
  return { checked, changed, received, error };
}
