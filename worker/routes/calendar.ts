// Calendario privado en formato ICS con las citas de la agenda.
// Cal.com (app "ICS Feed") lo lee para no ofrecer horarios que ya ocupaste con citas registradas a mano,
// y también puede suscribirse en Google Calendar o en el Calendario del iPhone.
import { b64url } from '../auth';
import { calcomConfigured, reconcileCalcom } from '../calcom';
import type { Env } from '../env';
import { HttpError, json, type Ctx } from '../http';
import { PLATFORM_LABELS } from '../../shared/domain';
import type { Platform } from '../../shared/types';

const enc = new TextEncoder();

/** Clave del calendario derivada de WEBHOOK_SECRET (cambiar ese secreto invalida el enlace anterior). */
export async function feedToken(env: Env): Promise<string | null> {
  if (!env.WEBHOOK_SECRET) return null;
  const key = await crypto.subtle.importKey('raw', enc.encode(env.WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode('astrobloomx-ics-feed'))).slice(0, 32);
}

const icsDate = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Corta líneas a 75 bytes como pide el estándar iCalendar (RFC 5545). */
function fold(line: string): string {
  const bytes = enc.encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let curLen = 0;
  for (const ch of line) {
    const len = enc.encode(ch).length;
    if (curLen + len > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      curLen = 0;
    }
    cur += ch;
    curLen += len;
  }
  out.push(cur);
  return out.join('\r\n ');
}

interface FeedRow {
  id: number;
  client_name: string;
  start_at: string;
  end_at: string;
  status: string;
  platform: Platform;
  updated_at: string;
  services: string | null;
}

export async function icsFeed({ env, params, url }: Ctx) {
  const token = await feedToken(env);
  if (!token || params.token !== token) throw new HttpError(404, 'Calendario no encontrado.');
  const includeAll = url.searchParams.get('todas') === '1';
  let hasLinks = true;
  try {
    await env.DB.prepare('SELECT 1 FROM external_bookings LIMIT 1').first();
  } catch {
    hasLinks = false;
  }
  // Por defecto se omiten las citas que vinieron de Cal.com (Cal.com y Google Calendar ya las tienen) y los rituales (no ocupan una hora fija).
  const excludeCalcom = !includeAll && hasLinks
    ? "AND NOT EXISTS (SELECT 1 FROM external_bookings e WHERE e.appointment_id = a.id AND e.source = 'calcom')"
    : '';
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.client_name, a.start_at, a.end_at, a.status, a.platform, a.updated_at,
       (SELECT group_concat(name, ' + ') FROM appointment_services s WHERE s.appointment_id = a.id) AS services
     FROM appointments a
     WHERE a.status NOT IN ('cancelled','no_show') AND a.end_at > ? AND a.start_at < ? ${excludeCalcom}
       AND NOT (EXISTS (SELECT 1 FROM appointment_services r WHERE r.appointment_id = a.id)
                AND NOT EXISTS (SELECT 1 FROM appointment_services r WHERE r.appointment_id = a.id AND (r.category IS NULL OR r.category NOT LIKE '%itual%')))
     ORDER BY a.start_at LIMIT 2000`,
  )
    .bind(new Date(Date.now() - 30 * 86400_000).toISOString(), new Date(Date.now() + 365 * 86400_000).toISOString())
    .all<FeedRow>();

  const host = url.hostname;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AstroBloomx//Agenda//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:AstroBloomx Agenda',
    'X-PUBLISHED-TTL:PT15M',
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
  ];
  for (const r of results) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:cita-${r.id}@${host}`,
      `DTSTAMP:${icsDate(new Date(r.updated_at).toISOString())}`,
      `DTSTART:${icsDate(r.start_at)}`,
      `DTEND:${icsDate(r.end_at)}`,
      `SUMMARY:${esc(`🌙 ${r.client_name}${r.services ? ` · ${r.services}` : ''}`)}`,
      `DESCRIPTION:${esc(`${PLATFORM_LABELS[r.platform] ?? ''} · https://${host}/citas/${r.id}`)}`,
      `URL:https://${host}/citas/${r.id}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.map(fold).join('\r\n') + '\r\n', {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'private, max-age=300',
      'content-disposition': 'inline; filename="astrobloomx-agenda.ics"',
    },
  });
}

/** Datos para "Configuración → Integraciones" (solo con sesión iniciada). */
export async function integrationsInfo({ env, url }: Ctx) {
  const token = await feedToken(env);
  const last = await env.DB.prepare("SELECT value FROM settings WHERE key = 'calcom_last_sync'").first<{ value: string }>();
  return json({
    configured: !!env.WEBHOOK_SECRET,
    url: env.WEBHOOK_SECRET ? `${url.origin}/api/hooks/booking?token=${encodeURIComponent(env.WEBHOOK_SECRET)}` : null,
    base: `${url.origin}/api/hooks/booking`,
    ics_url: token ? `${url.origin}/api/feed/${token}/agenda.ics` : null,
    calcom_api: calcomConfigured(env),
    calcom_last_sync: last ? JSON.parse(last.value) : null,
  });
}

export async function syncCalcomNow({ env, exec }: Ctx) {
  if (!calcomConfigured(env)) throw new HttpError(400, 'Falta el secreto CALCOM_API_KEY en Cloudflare.');
  return json(await reconcileCalcom(env, exec));
}
