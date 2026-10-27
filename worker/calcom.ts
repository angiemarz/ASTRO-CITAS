// Sincronización en ambos sentidos con Cal.com usando su API v2 (opcional: requiere el secreto CALCOM_API_KEY).
// - Agenda → Cal.com: si cancelas o reprogramas en la agenda una cita que vino de Cal.com, se refleja allá
//   (y Cal.com avisa a la clienta por correo).
// - Cal.com → Agenda: cada 30 minutos se revisan las reservas para recuperar avisos (webhooks) perdidos.
import { parseWhen, splitServices, applyBooking, ensureTable, type ExternalBooking } from './routes/hooks';
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
      "SELECT external_id FROM external_bookings WHERE source = 'calcom' AND appointment_id = ? ORDER BY rowid DESC LIMIT 1",
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
    const row = await env.DB.prepare('SELECT source FROM external_bookings WHERE appointment_id = ? ORDER BY rowid DESC LIMIT 1')
      .bind(appointmentId)
      .first<{ source: string }>();
    return row?.source ?? null;
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
  const phone = pickResp(r, 'attendeePhoneNumber') || pickResp(r, 'phone') || attendee.phoneNumber || null;
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
