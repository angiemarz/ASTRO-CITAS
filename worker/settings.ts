import { DEFAULT_PAYMENT_METHODS } from '../shared/domain';
import { isValidTimeZone } from '../shared/time';
import type { Settings } from '../shared/types';
import type { Env } from './env';
import { HttpError, json, readJson, type Ctx } from './http';
import { rescheduleAllFutureReminders } from './reminders';

export const DEFAULT_SETTINGS: Settings = {
  timezone: 'America/Monterrey',
  time_format: '12h',
  default_currency: 'MXN',
  default_duration_min: 60,
  reminder_offsets: [1440, 60, 15],
  overdue_reminder: true,
  overdue_after_min: 15,
  daily_summary: true,
  daily_summary_time: '08:00',
  business_name: 'AstroBloomx',
  logo: null,
  payment_methods: DEFAULT_PAYMENT_METHODS,
  week_starts_monday: true,
  calendar_start_hour: 7,
  calendar_end_hour: 23,
};

export async function loadSettings(env: Env): Promise<Settings> {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of results) {
    if (!(r.key in DEFAULT_SETTINGS)) continue;
    try {
      s[r.key] = JSON.parse(r.value);
    } catch {
      /* ignora valores corruptos */
    }
  }
  return s as unknown as Settings;
}

function sanitize(patch: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (patch.timezone !== undefined) {
    if (!isValidTimeZone(String(patch.timezone))) throw new HttpError(400, 'Zona horaria inválida.');
    out.timezone = String(patch.timezone);
  }
  if (patch.time_format !== undefined) out.time_format = patch.time_format === '24h' ? '24h' : '12h';
  if (patch.default_currency !== undefined) out.default_currency = patch.default_currency === 'USD' ? 'USD' : 'MXN';
  if (patch.default_duration_min !== undefined)
    out.default_duration_min = Math.min(720, Math.max(5, Math.round(Number(patch.default_duration_min) || 60)));
  if (patch.reminder_offsets !== undefined) {
    if (!Array.isArray(patch.reminder_offsets)) throw new HttpError(400, 'Recordatorios inválidos.');
    out.reminder_offsets = [...new Set(patch.reminder_offsets.map((n) => Math.round(Number(n))))]
      .filter((n) => n >= 0 && n <= 60 * 24 * 14)
      .sort((a, b) => b - a)
      .slice(0, 6);
  }
  if (patch.overdue_reminder !== undefined) out.overdue_reminder = !!patch.overdue_reminder;
  if (patch.overdue_after_min !== undefined)
    out.overdue_after_min = Math.min(720, Math.max(0, Math.round(Number(patch.overdue_after_min) || 0)));
  if (patch.daily_summary !== undefined) out.daily_summary = !!patch.daily_summary;
  if (patch.daily_summary_time !== undefined) {
    if (!/^\d{2}:\d{2}$/.test(String(patch.daily_summary_time))) throw new HttpError(400, 'Hora inválida.');
    out.daily_summary_time = String(patch.daily_summary_time);
  }
  if (patch.business_name !== undefined) out.business_name = String(patch.business_name).slice(0, 80) || 'AstroBloomx';
  if (patch.logo !== undefined) {
    if (patch.logo === null || patch.logo === '') out.logo = null;
    else {
      const logo = String(patch.logo);
      if (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(logo)) throw new HttpError(400, 'Formato de logotipo no válido.');
      if (logo.length > 700_000) throw new HttpError(400, 'El logotipo es demasiado pesado (máx. ~500 KB).');
      out.logo = logo;
    }
  }
  if (patch.payment_methods !== undefined) {
    if (!Array.isArray(patch.payment_methods)) throw new HttpError(400, 'Métodos de pago inválidos.');
    out.payment_methods = patch.payment_methods.map((m) => String(m).trim().slice(0, 40)).filter(Boolean).slice(0, 20);
  }
  if (patch.week_starts_monday !== undefined) out.week_starts_monday = !!patch.week_starts_monday;
  if (patch.calendar_start_hour !== undefined)
    out.calendar_start_hour = Math.min(23, Math.max(0, Math.round(Number(patch.calendar_start_hour))));
  if (patch.calendar_end_hour !== undefined)
    out.calendar_end_hour = Math.min(24, Math.max(1, Math.round(Number(patch.calendar_end_hour))));
  return out;
}

export async function getSettings({ env }: Ctx) {
  return json(await loadSettings(env));
}

export async function updateSettings({ req, env }: Ctx) {
  const patch = sanitize(await readJson<Partial<Settings>>(req));
  const stmts = Object.entries(patch).map(([k, v]) =>
    env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(
      k,
      JSON.stringify(v),
    ),
  );
  if (stmts.length) await env.DB.batch(stmts);
  const settings = await loadSettings(env);
  if (patch.reminder_offsets || patch.overdue_reminder !== undefined || patch.overdue_after_min !== undefined) {
    await rescheduleAllFutureReminders(env, settings);
  }
  return json(settings);
}
