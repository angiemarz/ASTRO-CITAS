// Citas de solo rituales: no ocupan una hora fija. Se cuentan como "por realizar" hasta que vence su plazo
// (una semana y dos días desde la fecha de la cita), no hasta que termina su horario.
import { ritualDeadline } from '../shared/domain';
import type { Env } from './env';

/** Condición SQL (alias `a`): todos los servicios de la cita son rituales. */
export const RITUAL_ONLY_SQL = `(EXISTS (SELECT 1 FROM appointment_services rs WHERE rs.appointment_id = a.id)
  AND NOT EXISTS (SELECT 1 FROM appointment_services rs WHERE rs.appointment_id = a.id AND (rs.category IS NULL OR rs.category NOT LIKE '%itual%')))`;

const OPEN = `('scheduled','confirmed','in_progress')`;

/** Citas abiertas: por atender (en tiempo) y atrasadas, con el plazo especial de los rituales. */
export async function openCounts(env: Env, tz: string, now: Date = new Date()): Promise<{ pending: number; overdue: number }> {
  const iso = now.toISOString();
  const [regular, rituals] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COALESCE(SUM(CASE WHEN a.end_at >= ? THEN 1 ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN a.end_at < ? THEN 1 ELSE 0 END), 0) AS overdue
       FROM appointments a WHERE a.status IN ${OPEN} AND NOT ${RITUAL_ONLY_SQL}`,
    ).bind(iso, iso),
    env.DB.prepare(`SELECT a.start_at FROM appointments a WHERE a.status IN ${OPEN} AND ${RITUAL_ONLY_SQL}`),
  ]);
  const r = regular.results[0] as { pending: number; overdue: number };
  let pending = r.pending;
  let overdue = r.overdue;
  for (const row of rituals.results as { start_at: string }[]) {
    if (ritualDeadline(row.start_at, tz, now).overdue) overdue++;
    else pending++;
  }
  return { pending, overdue };
}
