import { FINAL_STATUSES, isRitualOnly, ritualDeadline } from '../../shared/domain';
import { toYmd } from '../../shared/time';
import type { Appointment } from '../../shared/types';

export type PendingGroup = 'overdue' | 'in_progress' | 'today' | 'upcoming';

export const isOpen = (a: Appointment) => !FINAL_STATUSES.includes(a.status);

/** Cita que solo incluye rituales: no tiene hora fija, se cuenta por plazo (una semana y dos días). */
export const isRitualCita = (a: Appointment) => isRitualOnly(a);

/**
 * La cita ya pasó y no se ha marcado como completada, cancelada o no asistió.
 * En los rituales cuenta cuando vence el plazo de una semana y dos días, no cuando termina su horario.
 */
export const isOverdue = (a: Appointment, tz: string, now = Date.now()) =>
  isOpen(a) && (isRitualCita(a) ? ritualDeadline(a.start_at, tz, now).overdue : new Date(a.end_at).getTime() < now);

export const isToday = (a: Appointment, tz: string, now = new Date()) => toYmd(a.start_at, tz) === toYmd(now, tz);

/** Momento de la cita respecto a "ahora" para la agenda del día. */
export function timePhase(a: Appointment, tz: string, now = Date.now()): 'upcoming' | 'current' | 'past' {
  if (isRitualCita(a)) return ritualDeadline(a.start_at, tz, now).overdue ? 'past' : 'upcoming';
  const s = new Date(a.start_at).getTime();
  const e = new Date(a.end_at).getTime();
  if (now < s) return 'upcoming';
  if (now <= e) return 'current';
  return 'past';
}

export function classifyPending(items: Appointment[], tz: string, now = new Date()) {
  const t = now.getTime();
  const open = items.filter(isOpen);
  const rituals = open.filter(isRitualCita).sort((x, y) => ritualDeadline(x.start_at, tz, t).deadlineMs - ritualDeadline(y.start_at, tz, t).deadlineMs);
  const regular = open.filter((a) => !isRitualCita(a));
  return {
    upcoming: regular.filter((a) => a.status !== 'in_progress' && new Date(a.start_at).getTime() > t),
    today: regular.filter((a) => isToday(a, tz, now)),
    overdue: open.filter((a) => isOverdue(a, tz, t)),
    in_progress: regular.filter((a) => a.status === 'in_progress'),
    rituals,
  };
}
