// Panel de inicio, estadísticas, notificaciones push y respaldo.
import { addDaysYmd, dayRangeUtc, todayYmd, toYmd as todayYmdOf, zonedToUtc } from '../../shared/time';
import type { DashboardStats } from '../../shared/types';
import { HttpError, isoDate, json, nowIso, readJson, str, type Ctx } from '../http';
import { rescheduleAllFutureReminders } from '../reminders';
import { loadSettings } from '../settings';
import { broadcast, pushConfigured } from '../webpush';
import { APPT_SELECT, mapAppointment } from './appointments';

const PAID = 'COALESCE((SELECT SUM(amount) FROM payments p WHERE p.appointment_id = a.id), 0)';

function byCurrency(rows: { currency: string; total: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) if (r.total) out[r.currency] = Math.round(r.total * 100) / 100;
  return out;
}

export async function dashboard({ env }: Ctx) {
  const settings = await loadSettings(env);
  const tz = settings.timezone;
  const today = todayYmd(tz);
  const { start, end } = dayRangeUtc(today, tz);
  const monthStart = zonedToUtc(`${today.slice(0, 7)}-01`, '00:00', tz).toISOString();
  const now = nowIso();
  const s = start.toISOString();
  const e = end.toISOString();

  const [todayRows, nextRow, counts, collected, pending, monthCounts] = await env.DB.batch([
    env.DB.prepare(`${APPT_SELECT} WHERE a.start_at >= ? AND a.start_at < ? ORDER BY a.start_at`).bind(s, e),
    env.DB.prepare(
      `${APPT_SELECT} WHERE a.start_at >= ? AND a.status IN ('scheduled','confirmed') ORDER BY a.start_at LIMIT 1`,
    ).bind(now),
    env.DB.prepare(
      `SELECT
         SUM(CASE WHEN start_at >= ? AND start_at < ? AND status NOT IN ('cancelled','no_show') THEN 1 ELSE 0 END) AS today_count,
         SUM(CASE WHEN status IN ('scheduled','confirmed','in_progress') AND end_at >= ? THEN 1 ELSE 0 END) AS pending_count,
         SUM(CASE WHEN status IN ('scheduled','confirmed','in_progress') AND end_at < ? THEN 1 ELSE 0 END) AS overdue_count,
         SUM(CASE WHEN status NOT IN ('cancelled','no_show') AND final_price > 0
                  AND ${PAID.replace(/a\.id/g, 'appointments.id')} < final_price - 0.004 THEN 1 ELSE 0 END) AS unpaid_count
       FROM appointments`,
    ).bind(s, e, now, now),
    env.DB.prepare(
      `SELECT a.currency, SUM(p.amount) AS total FROM payments p JOIN appointments a ON a.id = p.appointment_id
       WHERE p.paid_at >= ? AND p.paid_at < ? GROUP BY a.currency`,
    ).bind(s, e),
    env.DB.prepare(
      `SELECT a.currency, SUM(MAX(a.final_price - ${PAID}, 0)) AS total FROM appointments a
       WHERE a.status NOT IN ('cancelled','no_show') GROUP BY a.currency`,
    ),
    env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
         SUM(CASE WHEN status IN ('cancelled','no_show') THEN 1 ELSE 0 END) AS cancelled_count
       FROM appointments WHERE start_at >= ? AND start_at < ?`,
    ).bind(monthStart, e > now ? e : now),
  ]);

  const c = counts.results[0] as Record<string, number | null>;
  const m = monthCounts.results[0] as Record<string, number | null>;
  const stats: DashboardStats = {
    today_count: c.today_count ?? 0,
    pending_count: c.pending_count ?? 0,
    overdue_count: c.overdue_count ?? 0,
    unpaid_count: c.unpaid_count ?? 0,
    completed_count: m.completed_count ?? 0,
    cancelled_count: m.cancelled_count ?? 0,
    collected_today: byCurrency(collected.results as never),
    pending_amount: byCurrency(pending.results as never),
    next: nextRow.results[0] ? mapAppointment(nextRow.results[0] as never) : null,
    today: (todayRows.results as never[]).map(mapAppointment),
  };
  return json(stats);
}

export async function stats({ env, url }: Ctx) {
  const settings = await loadSettings(env);
  const tz = settings.timezone;
  const today = todayYmd(tz);
  const from = url.searchParams.get('from')
    ? isoDate(url.searchParams.get('from'), 'from')
    : zonedToUtc(`${today.slice(0, 7)}-01`, '00:00', tz).toISOString();
  const to = url.searchParams.get('to') ? isoDate(url.searchParams.get('to'), 'to') : dayRangeUtc(today, tz).end.toISOString();
  const yearAgo = zonedToUtc(`${addDaysYmd(today, -365).slice(0, 7)}-01`, '00:00', tz).toISOString();

  const [income, billed, statusCounts, byService, byPlatform, byMethod, monthlyPayments, topClients, owing, promoUse] =
    await env.DB.batch([
      env.DB.prepare(
        `SELECT a.currency, SUM(p.amount) AS total, COUNT(*) AS n FROM payments p JOIN appointments a ON a.id = p.appointment_id
         WHERE p.paid_at >= ? AND p.paid_at < ? GROUP BY a.currency`,
      ).bind(from, to),
      env.DB.prepare(
        `SELECT currency, SUM(final_price) AS total, SUM(discount) AS discounts, COUNT(*) AS n FROM appointments
         WHERE start_at >= ? AND start_at < ? AND status NOT IN ('cancelled','no_show') GROUP BY currency`,
      ).bind(from, to),
      env.DB.prepare('SELECT status, COUNT(*) AS n FROM appointments WHERE start_at >= ? AND start_at < ? GROUP BY status').bind(from, to),
      env.DB.prepare(
        `SELECT s.name, a.currency, COUNT(*) AS n, SUM(s.price) AS catalog_total FROM appointment_services s
         JOIN appointments a ON a.id = s.appointment_id
         WHERE a.start_at >= ? AND a.start_at < ? AND a.status NOT IN ('cancelled','no_show')
         GROUP BY s.name, a.currency ORDER BY n DESC LIMIT 15`,
      ).bind(from, to),
      env.DB.prepare(
        `SELECT platform, COUNT(*) AS n FROM appointments WHERE start_at >= ? AND start_at < ? AND status NOT IN ('cancelled','no_show')
         GROUP BY platform ORDER BY n DESC`,
      ).bind(from, to),
      env.DB.prepare(
        `SELECT p.method, a.currency, SUM(p.amount) AS total, COUNT(*) AS n FROM payments p JOIN appointments a ON a.id = p.appointment_id
         WHERE p.paid_at >= ? AND p.paid_at < ? GROUP BY p.method, a.currency ORDER BY total DESC`,
      ).bind(from, to),
      env.DB.prepare(
        `SELECT p.paid_at, p.amount, a.currency FROM payments p JOIN appointments a ON a.id = p.appointment_id WHERE p.paid_at >= ?`,
      ).bind(yearAgo),
      env.DB.prepare(
        `SELECT a.client_name, a.client_id, a.currency, COUNT(*) AS n, SUM(a.final_price) AS total FROM appointments a
         WHERE a.start_at >= ? AND a.start_at < ? AND a.status NOT IN ('cancelled','no_show')
         GROUP BY a.client_id, a.client_name, a.currency ORDER BY n DESC, total DESC LIMIT 10`,
      ).bind(from, to),
      env.DB.prepare(
        `${APPT_SELECT} WHERE a.status NOT IN ('cancelled','no_show') AND ${PAID} < a.final_price - 0.004 ORDER BY a.start_at LIMIT 200`,
      ),
      env.DB.prepare(
        `SELECT pr.name, COUNT(*) AS n, SUM(pr.savings) AS savings, a.currency FROM appointment_promotions pr
         JOIN appointments a ON a.id = pr.appointment_id WHERE a.start_at >= ? AND a.start_at < ? GROUP BY pr.name, a.currency ORDER BY n DESC`,
      ).bind(from, to),
    ]);

  // Agrupa pagos por mes en la zona horaria configurada
  const monthly: Record<string, Record<string, number>> = {};
  for (const p of monthlyPayments.results as { paid_at: string; amount: number; currency: string }[]) {
    const ym = todayYmdOf(p.paid_at, tz).slice(0, 7);
    monthly[ym] ??= {};
    monthly[ym][p.currency] = Math.round(((monthly[ym][p.currency] ?? 0) + p.amount) * 100) / 100;
  }

  return json({
    from,
    to,
    income: income.results,
    billed: billed.results,
    status_counts: statusCounts.results,
    by_service: byService.results,
    by_platform: byPlatform.results,
    by_method: byMethod.results,
    monthly,
    top_clients: topClients.results,
    owing: (owing.results as never[]).map(mapAppointment),
    promotions: promoUse.results,
  });
}

// ---------- Push ----------

export async function pushInfo({ env }: Ctx) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{ n: number }>();
  return json({ configured: pushConfigured(env), publicKey: env.VAPID_PUBLIC_KEY ?? null, devices: row?.n ?? 0 });
}

export async function pushSubscribe({ req, env }: Ctx) {
  const body = await readJson<{ endpoint?: string; keys?: { p256dh?: string; auth?: string } }>(req);
  const endpoint = str(body.endpoint, 1000);
  const p256dh = str(body.keys?.p256dh, 200);
  const auth = str(body.keys?.auth, 100);
  if (!endpoint || !p256dh || !auth || !/^https:\/\//.test(endpoint)) throw new HttpError(400, 'Suscripción inválida.');
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent`,
  )
    .bind(endpoint, p256dh, auth, (req.headers.get('user-agent') || '').slice(0, 300), nowIso())
    .run();
  return json({ ok: true });
}

export async function pushUnsubscribe({ req, env }: Ctx) {
  const body = await readJson<{ endpoint?: string }>(req);
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(String(body.endpoint ?? '')).run();
  return json({ ok: true });
}

export async function pushTest({ env }: Ctx) {
  if (!pushConfigured(env)) throw new HttpError(503, 'Faltan las llaves VAPID en Cloudflare (ver README).');
  const result = await broadcast(env, {
    title: '✨ AstroBloomx Agenda',
    body: 'Las notificaciones funcionan correctamente. ¡Tus recordatorios están listos! 🌙',
    url: '/',
    tag: 'test',
  });
  return json(result);
}

// ---------- Respaldo ----------

const BACKUP_TABLES = [
  'settings',
  'clients',
  'services',
  'promotions',
  'promotion_services',
  'appointments',
  'appointment_services',
  'appointment_promotions',
  'payments',
  'appointment_history',
];

export async function exportData({ env }: Ctx) {
  const results = await env.DB.batch(BACKUP_TABLES.map((t) => env.DB.prepare(`SELECT * FROM ${t}`)));
  const data: Record<string, unknown[]> = {};
  BACKUP_TABLES.forEach((t, i) => (data[t] = results[i].results));
  return json(
    { app: 'astrobloomx-agenda', version: 1, exported_at: nowIso(), data },
    200,
    { 'content-disposition': `attachment; filename="astrobloomx-respaldo-${nowIso().slice(0, 10)}.json"` },
  );
}

/** Restaura un respaldo JSON reemplazando toda la información (excepto la contraseña y los dispositivos). */
export async function importData({ req, env }: Ctx) {
  const body = await readJson<{ confirm?: string; backup?: { app?: string; data?: Record<string, Record<string, unknown>[]> } }>(req);
  if (body.confirm !== 'RESTAURAR') throw new HttpError(400, 'Confirma escribiendo RESTAURAR.');
  const data = body.backup?.data;
  if (body.backup?.app !== 'astrobloomx-agenda' || !data) throw new HttpError(400, 'El archivo no es un respaldo de AstroBloomx Agenda.');
  const stmts: D1PreparedStatement[] = [env.DB.prepare('DELETE FROM reminders')];
  for (const t of [...BACKUP_TABLES].reverse()) stmts.push(env.DB.prepare(`DELETE FROM ${t}`));
  for (const t of BACKUP_TABLES) {
    for (const row of data[t] ?? []) {
      const cols = Object.keys(row).filter((c) => /^[a-z_]+$/.test(c));
      if (!cols.length) continue;
      stmts.push(
        env.DB.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).bind(
          ...cols.map((c) => (row[c] === undefined ? null : row[c])),
        ),
      );
    }
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  await rescheduleAllFutureReminders(env, await loadSettings(env));
  return json({ ok: true });
}
