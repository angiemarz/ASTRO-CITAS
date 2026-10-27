// Programación y envío de recordatorios push (ejecutado por el Cron Trigger cada 5 minutos).
import { formatMoney, PLATFORM_LABELS } from '../shared/domain';
import { dayRangeUtc, formatTime, todayYmd, toHm } from '../shared/time';
import type { AppointmentStatus, Platform, Settings } from '../shared/types';
import type { Env } from './env';
import { nowIso } from './http';
import { loadSettings } from './settings';
import { broadcast, pushConfigured } from './webpush';

const FINAL: AppointmentStatus[] = ['completed', 'cancelled', 'no_show'];

export function reminderStatements(
  env: Env,
  appt: { id: number; start_at: string; end_at: string; status: AppointmentStatus },
  settings: Settings,
): D1PreparedStatement[] {
  const stmts = [env.DB.prepare('DELETE FROM reminders WHERE appointment_id = ? AND sent_at IS NULL').bind(appt.id)];
  if (FINAL.includes(appt.status)) return stmts;
  const now = Date.now();
  const start = new Date(appt.start_at).getTime();
  const end = new Date(appt.end_at).getTime();
  const insert = 'INSERT INTO reminders (appointment_id, kind, offset_min, remind_at) VALUES (?, ?, ?, ?)';
  if (appt.status !== 'in_progress') {
    for (const off of settings.reminder_offsets) {
      const at = start - off * 60_000;
      if (at > now - 60_000) stmts.push(env.DB.prepare(insert).bind(appt.id, 'before', off, new Date(at).toISOString()));
    }
  }
  if (settings.overdue_reminder) {
    const at = end + settings.overdue_after_min * 60_000;
    if (at > now - 60_000) stmts.push(env.DB.prepare(insert).bind(appt.id, 'overdue', settings.overdue_after_min, new Date(at).toISOString()));
  }
  return stmts;
}

export async function rescheduleAllFutureReminders(env: Env, settings: Settings) {
  const { results } = await env.DB.prepare(
    `SELECT id, start_at, end_at, status FROM appointments
     WHERE end_at > ? AND status NOT IN ('completed','cancelled','no_show')`,
  )
    .bind(new Date(Date.now() - 24 * 3600_000).toISOString())
    .all<{ id: number; start_at: string; end_at: string; status: AppointmentStatus }>();
  const stmts = results.flatMap((a) => reminderStatements(env, a, settings));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

function beforeLabel(min: number): string {
  if (min === 0) return 'Comienza ahora';
  if (min < 60) return `Comienza en ${min} min`;
  if (min < 1440) return `Comienza en ${Math.round(min / 60)} h`;
  const d = Math.round(min / 1440);
  return d === 1 ? 'Es mañana' : `Faltan ${d} días`;
}

export async function runReminders(env: Env): Promise<{ sent: number }> {
  if (!pushConfigured(env)) return { sent: 0 };
  const settings = await loadSettings(env);
  const use24 = settings.time_format === '24h';
  const now = new Date();
  const staleLimit = new Date(now.getTime() - 6 * 3600_000).toISOString();

  const { results } = await env.DB.prepare(
    `SELECT r.id AS rid, r.kind, r.offset_min, a.id, a.client_name, a.start_at, a.end_at, a.status, a.platform,
            (SELECT group_concat(name, ', ') FROM appointment_services s WHERE s.appointment_id = a.id) AS services
     FROM reminders r JOIN appointments a ON a.id = r.appointment_id
     WHERE r.sent_at IS NULL AND r.remind_at <= ?
     ORDER BY r.remind_at LIMIT 25`,
  )
    .bind(now.toISOString())
    .all<{
      rid: number;
      kind: string;
      offset_min: number;
      id: number;
      client_name: string;
      start_at: string;
      end_at: string;
      status: AppointmentStatus;
      platform: Platform;
      services: string | null;
    }>();

  let sent = 0;
  for (const r of results) {
    // Marca primero para no duplicar si la ejecución se interrumpe.
    await env.DB.prepare('UPDATE reminders SET sent_at = ? WHERE id = ?').bind(nowIso(), r.rid).run();
    if (FINAL.includes(r.status)) continue;
    if (r.kind === 'before' && r.status === 'in_progress') continue;
    const time = formatTime(r.start_at, settings.timezone, use24);
    const svc = r.services ? ` · ${r.services}` : '';
    if (r.kind === 'before') {
      if (new Date(r.start_at).getTime() < now.getTime() - 30 * 60_000) continue; // ya pasó, no avisar tarde
      await broadcast(env, {
        title: `🌙 ${beforeLabel(r.offset_min)}: ${r.client_name}`,
        body: `${time}${svc} · ${PLATFORM_LABELS[r.platform] ?? ''}`,
        url: `/citas/${r.id}`,
        tag: `appt-${r.id}`,
      });
    } else {
      if (new Date(r.end_at) > now) continue; // la cita se extendió o reprogramó
      await broadcast(env, {
        title: `⏰ ¿Atendiste a ${r.client_name}?`,
        body: `La cita de las ${time}${svc} terminó y sigue sin marcarse como atendida.`,
        url: `/citas/${r.id}`,
        tag: `overdue-${r.id}`,
      });
    }
    sent++;
  }

  // Limpieza de recordatorios viejos no enviados (por ejemplo, si el cron estuvo inactivo)
  await env.DB.prepare('DELETE FROM reminders WHERE sent_at IS NULL AND remind_at < ?').bind(staleLimit).run();
  await env.DB.prepare('DELETE FROM reminders WHERE sent_at IS NOT NULL AND sent_at < ?')
    .bind(new Date(now.getTime() - 30 * 86400_000).toISOString())
    .run();

  if (settings.daily_summary) sent += await maybeDailySummary(env, settings, now);
  return { sent };
}

async function maybeDailySummary(env: Env, settings: Settings, now: Date): Promise<number> {
  const today = todayYmd(settings.timezone);
  if (toHm(now, settings.timezone) < settings.daily_summary_time) return 0;
  const last = await env.DB.prepare("SELECT value FROM settings WHERE key = 'last_daily_summary'").first<{ value: string }>();
  if (last && JSON.parse(last.value) === today) return 0;
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('last_daily_summary', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  )
    .bind(JSON.stringify(today))
    .run();

  const { start, end } = dayRangeUtc(today, settings.timezone);
  const { results } = await env.DB.prepare(
    `SELECT client_name, start_at FROM appointments
     WHERE start_at >= ? AND start_at < ? AND status NOT IN ('cancelled','no_show') ORDER BY start_at`,
  )
    .bind(start.toISOString(), end.toISOString())
    .all<{ client_name: string; start_at: string }>();
  const overdue = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM appointments WHERE end_at < ? AND status IN ('scheduled','confirmed','in_progress')`,
  )
    .bind(now.toISOString())
    .first<{ n: number }>();
  const pending = await env.DB.prepare(
    `SELECT a.currency, SUM(a.final_price - COALESCE((SELECT SUM(amount) FROM payments p WHERE p.appointment_id = a.id), 0)) AS bal
     FROM appointments a WHERE a.status NOT IN ('cancelled','no_show') GROUP BY a.currency`,
  ).all<{ currency: string; bal: number }>();

  if (!results.length && !overdue?.n) return 0;
  const use24 = settings.time_format === '24h';
  const list = results
    .slice(0, 6)
    .map((r) => `${formatTime(r.start_at, settings.timezone, use24)} ${r.client_name}`)
    .join(' · ');
  const extra: string[] = [];
  if (overdue?.n) extra.push(`${overdue.n} atrasada(s) sin marcar`);
  const owed = pending.results.filter((p) => p.bal > 0.009).map((p) => formatMoney(p.bal, p.currency));
  if (owed.length) extra.push(`por cobrar ${owed.join(' + ')}`);
  await broadcast(env, {
    title: results.length ? `✨ Hoy tienes ${results.length} cita(s)` : '✨ Resumen del día',
    body: [list, extra.join(' · ')].filter(Boolean).join('\n'),
    url: '/',
    tag: 'daily-summary',
  });
  return 1;
}
