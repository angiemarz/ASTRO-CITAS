// Utilidades de zona horaria sin dependencias (solo Intl), compartidas entre el Worker y el frontend.

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = domingo
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(date: Date | string | number, tz: string): ZonedParts {
  const d = date instanceof Date ? date : new Date(date);
  const out: Record<string, string> = {};
  for (const p of partsFormatter(tz).formatToParts(d)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday] ?? 0,
  };
}

/** Diferencia (en minutos) entre la hora local de `tz` y UTC en ese instante. */
export function tzOffsetMinutes(date: Date | number, tz: string): number {
  const d = typeof date === 'number' ? new Date(date) : date;
  const p = zonedParts(d, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Convierte una fecha (YYYY-MM-DD) y hora (HH:mm) en la zona `tz` a un Date UTC. */
export function zonedToUtc(ymd: string, hm: string, tz: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi || 0, 0);
  let offset = tzOffsetMinutes(guess, tz);
  let ts = guess - offset * 60000;
  const offset2 = tzOffsetMinutes(ts, tz);
  if (offset2 !== offset) {
    offset = offset2;
    ts = guess - offset * 60000;
  }
  return new Date(ts);
}

export function toYmd(date: Date | string | number, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function toHm(date: Date | string | number, tz: string): string {
  const p = zonedParts(date, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Inicio y fin (UTC) de un día local en `tz`. */
export function dayRangeUtc(ymd: string, tz: string): { start: Date; end: Date } {
  const start = zonedToUtc(ymd, '00:00', tz);
  const end = zonedToUtc(addDaysYmd(ymd, 1), '00:00', tz);
  return { start, end };
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function todayYmd(tz: string): string {
  return toYmd(new Date(), tz);
}

/** "Hora de pared" en `tz` representada como Date UTC (útil para FullCalendar con timeZone: 'UTC'). */
export function wallClockAsUtc(date: Date | string | number, tz: string): Date {
  const p = zonedParts(date, tz);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
}

/** Inverso de wallClockAsUtc. */
export function utcWallClockToReal(wall: Date, tz: string): Date {
  const ymd = `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`;
  const hm = `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`;
  return zonedToUtc(ymd, hm, tz);
}

export function formatTime(date: Date | string | number, tz: string, use24h: boolean): string {
  const p = zonedParts(date, tz);
  if (use24h) return `${pad(p.hour)}:${pad(p.minute)}`;
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${pad(p.minute)} ${p.hour < 12 ? 'AM' : 'PM'}`;
}

export function formatHm(hm: string, use24h: boolean): string {
  const [h, m] = hm.split(':').map(Number);
  if (use24h) return `${pad(h)}:${pad(m)}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_ES_LONG = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function formatDateShort(date: Date | string | number, tz: string): string {
  const p = zonedParts(date, tz);
  return `${WEEKDAYS_ES[p.weekday].slice(0, 3)} ${p.day} ${MONTHS_ES[p.month - 1]}`;
}

export function formatDateLong(date: Date | string | number, tz: string): string {
  const p = zonedParts(date, tz);
  return `${WEEKDAYS_ES[p.weekday]} ${p.day} de ${MONTHS_ES_LONG[p.month - 1]} de ${p.year}`;
}

export function formatYmdLong(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS_ES[wd]} ${d} de ${MONTHS_ES_LONG[m - 1]}`;
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_ES_LONG[m - 1]} ${y}`;
}

/** Texto amigable del tiempo restante: "en 2 h 15 min", "en 3 días", "hace 20 min". */
export function relativeTime(target: Date | string | number, now: Date = new Date()): string {
  const t = target instanceof Date ? target : new Date(target);
  const diff = Math.round((t.getTime() - now.getTime()) / 60000);
  const abs = Math.abs(diff);
  let txt: string;
  if (abs < 1) return 'ahora';
  if (abs < 60) txt = `${abs} min`;
  else if (abs < 60 * 24) {
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    txt = m ? `${h} h ${m} min` : `${h} h`;
  } else {
    const d = Math.round(abs / (60 * 24));
    txt = d === 1 ? '1 día' : `${d} días`;
  }
  return diff > 0 ? `en ${txt}` : `hace ${txt}`;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
