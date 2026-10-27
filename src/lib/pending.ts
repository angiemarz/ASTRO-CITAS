import { FINAL_STATUSES } from '../../shared/domain';
import { toYmd } from '../../shared/time';
import type { Appointment } from '../../shared/types';

export type PendingGroup = 'overdue' | 'in_progress' | 'today' | 'upcoming';

export const isOpen = (a: Appointment) => !FINAL_STATUSES.includes(a.status);

/** La cita terminó y no se ha marcado como completada, cancelada o no asistió. */
export const isOverdue = (a: Appointment, now = Date.now()) => isOpen(a) && new Date(a.end_at).getTime() < now;

export const isToday = (a: Appointment, tz: string, now = new Date()) => toYmd(a.start_at, tz) === toYmd(now, tz);

/** Momento de la cita respecto a "ahora" para la agenda del día. */
export function timePhase(a: Appointment, now = Date.now()): 'upcoming' | 'current' | 'past' {
  const s = new Date(a.start_at).getTime();
  const e = new Date(a.end_at).getTime();
  if (now < s) return 'upcoming';
  if (now <= e) return 'current';
  return 'past';
}

export function classifyPending(items: Appointment[], tz: string, now = new Date()) {
  const t = now.getTime();
  const open = items.filter(isOpen);
  return {
    upcoming: open.filter((a) => a.status !== 'in_progress' && new Date(a.start_at).getTime() > t),
    today: open.filter((a) => isToday(a, tz, now)),
    overdue: open.filter((a) => isOverdue(a, t)),
    in_progress: open.filter((a) => a.status === 'in_progress'),
  };
}
