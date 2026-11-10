// Cálculo de estadísticas con datos reales de citas, servicios, rituales, promociones y pagos.
// Es una función pura (sin base de datos) para poder probarla: el Worker le pasa las filas y ella suma.
//
// Reglas para que el dinero cuadre:
// • Solo cuentan las citas que no están canceladas ni "no asistió" (esas se cuentan aparte).
// • Una cita con varios servicios/rituales/promociones se cuenta UNA vez en citas e ingresos: su precio
//   final (ya con descuentos) se reparte entre sus líneas en proporción al precio de cada una, así
//   la suma por servicio + ritual nunca supera lo cobrado/facturado.
// • "Cobrado" es lo realmente pagado (abonos); "por cobrar" es lo que falta. Nunca se mezclan.
// • Todo se expresa en MXN: las citas en USD se convierten con el tipo de cambio configurado.
import { round2, toMxn } from './domain';
import { addDaysYmd, toYmd } from './time';

export interface AnalyticsAppointment {
  id: number;
  start_at: string;
  status: string;
  currency: string;
  original_price: number;
  discount: number;
  final_price: number;
  /** Suma de los abonos registrados de la cita. */
  paid: number;
}
export interface AnalyticsLine {
  appointment_id: number;
  service_id: number | null;
  name: string;
  category: string | null;
  price: number;
  intention: string | null;
}
export interface AnalyticsPromo {
  appointment_id: number;
  promotion_id: number | null;
  name: string;
  special_price: number;
  savings: number;
}
export interface AnalyticsCatalogItem {
  id: number;
  name: string;
  category: string;
  active: number;
}

export interface Ranked {
  key: string;
  name: string;
  /** Veces que se agendó. */
  count: number;
  /** Ingresos facturados (MXN) atribuidos. */
  revenue: number;
}
export interface SeriesPoint {
  /** 'YYYY-MM-DD' (día), lunes de la semana, o 'YYYY-MM'. */
  key: string;
  count: number;
  revenue: number;
  paid: number;
}

export interface AnalyticsResult {
  totals: {
    appointments: number;
    cancelled: number;
    no_show: number;
    /** Facturado (precio final de citas válidas), MXN. */
    revenue: number;
    original: number;
    discounts: number;
    paid: number;
    pending: number;
    paid_pct: number;
    pending_pct: number;
    average_ticket: number;
    /** Citas en USD que no se pudieron convertir por falta de tipo de cambio. */
    unconverted: number;
  };
  series: { day: SeriesPoint[]; week: SeriesPoint[]; month: SeriesPoint[] };
  services: Ranked[];
  rituals: Ranked[];
  promotions: Ranked[];
  /** Servicios activos del catálogo con menos citas (incluye los que tienen cero). */
  least_services: Ranked[];
  intentions: { name: string; count: number }[];
  comparison: { kind: 'services' | 'rituals' | 'promotions'; label: string; count: number; revenue: number }[];
}

const isRitual = (category: string | null | undefined) => /ritual/i.test(category ?? '');
const isValid = (status: string) => status !== 'cancelled' && status !== 'no_show';

function weekStart(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return addDaysYmd(ymd, -((dow + 6) % 7));
}

export function computeAnalytics(
  input: {
    appointments: AnalyticsAppointment[];
    lines: AnalyticsLine[];
    promos: AnalyticsPromo[];
    catalog: AnalyticsCatalogItem[];
  },
  opts: { rate: number | null; tz: string },
): AnalyticsResult {
  const { rate, tz } = opts;
  const linesBy = new Map<number, AnalyticsLine[]>();
  for (const l of input.lines) (linesBy.get(l.appointment_id) ?? linesBy.set(l.appointment_id, []).get(l.appointment_id)!).push(l);
  const promosBy = new Map<number, AnalyticsPromo[]>();
  for (const p of input.promos) (promosBy.get(p.appointment_id) ?? promosBy.set(p.appointment_id, []).get(p.appointment_id)!).push(p);

  const t = { appointments: 0, cancelled: 0, no_show: 0, revenue: 0, original: 0, discounts: 0, paid: 0, unconverted: 0 };
  const day = new Map<string, SeriesPoint>();
  const week = new Map<string, SeriesPoint>();
  const month = new Map<string, SeriesPoint>();
  const services = new Map<string, Ranked>();
  const rituals = new Map<string, Ranked>();
  const promotions = new Map<string, Ranked>();
  const intentions = new Map<string, number>();

  const bump = (m: Map<string, SeriesPoint>, key: string, revenue: number, paid: number) => {
    const p = m.get(key) ?? { key, count: 0, revenue: 0, paid: 0 };
    p.count += 1;
    p.revenue += revenue;
    p.paid += paid;
    m.set(key, p);
  };
  const add = (m: Map<string, Ranked>, key: string, name: string, revenue: number) => {
    const r = m.get(key) ?? { key, name, count: 0, revenue: 0 };
    r.count += 1;
    r.revenue += revenue;
    m.set(key, r);
  };

  for (const a of input.appointments) {
    if (a.status === 'cancelled') t.cancelled++;
    if (a.status === 'no_show') t.no_show++;
    if (!isValid(a.status)) continue;

    const conv = (n: number) => toMxn(n, a.currency, rate);
    const finalMxn = conv(a.final_price);
    if (finalMxn === null) {
      t.unconverted++;
      t.appointments++; // la cita existe y se cuenta, pero sin importes
      const ymd = toYmd(a.start_at, tz);
      bump(day, ymd, 0, 0);
      bump(week, weekStart(ymd), 0, 0);
      bump(month, ymd.slice(0, 7), 0, 0);
      continue;
    }
    const origMxn = conv(a.original_price) ?? 0;
    const discMxn = conv(a.discount) ?? 0;
    // Nunca se cuenta como cobrado más de lo que vale la cita
    const paidMxn = Math.min(conv(a.paid) ?? 0, finalMxn);

    t.appointments++;
    t.revenue += finalMxn;
    t.original += origMxn;
    t.discounts += discMxn;
    t.paid += paidMxn;

    const ymd = toYmd(a.start_at, tz);
    bump(day, ymd, finalMxn, paidMxn);
    bump(week, weekStart(ymd), finalMxn, paidMxn);
    bump(month, ymd.slice(0, 7), finalMxn, paidMxn);

    // Reparto proporcional del precio final entre las líneas de la cita
    const lines = linesBy.get(a.id) ?? [];
    const sum = lines.reduce((s, l) => s + (Number(l.price) || 0), 0);
    const seenService = new Set<string>();
    for (const l of lines) {
      const share = sum > 0 ? (Number(l.price) || 0) / sum : lines.length ? 1 / lines.length : 0;
      const rev = finalMxn * share;
      const key = String(l.service_id ?? `n:${l.name.toLowerCase()}`);
      // Un mismo servicio repetido en la misma cita cuenta una sola vez en "veces agendado"
      const target = isRitual(l.category) ? rituals : services;
      const k = `${isRitual(l.category) ? 'r' : 's'}${key}`;
      if (seenService.has(k)) {
        const r = target.get(key);
        if (r) r.revenue += rev;
      } else {
        seenService.add(k);
        add(target, key, l.name, rev);
      }
      if (l.intention) intentions.set(l.intention, (intentions.get(l.intention) ?? 0) + 1);
    }

    // Promociones: ingreso = precio especial de la promo; si hay varias, se escala para no pasar del total de la cita
    const ps = promosBy.get(a.id) ?? [];
    if (ps.length) {
      const specials = ps.map((p) => conv(p.special_price) ?? 0);
      const total = specials.reduce((s, x) => s + x, 0);
      const scale = total > finalMxn && total > 0 ? finalMxn / total : 1;
      ps.forEach((p, i) => add(promotions, String(p.promotion_id ?? `n:${p.name.toLowerCase()}`), p.name, specials[i] * scale));
    }
  }

  const sortRank = (m: Map<string, Ranked>) =>
    [...m.values()]
      .map((r) => ({ ...r, revenue: round2(r.revenue) }))
      .sort((a, b) => b.count - a.count || b.revenue - a.revenue || a.name.localeCompare(b.name, 'es'));
  const pts = (m: Map<string, SeriesPoint>) =>
    [...m.values()].map((p) => ({ ...p, revenue: round2(p.revenue), paid: round2(p.paid) })).sort((a, b) => a.key.localeCompare(b.key));

  const sv = sortRank(services);
  const rt = sortRank(rituals);
  const pm = sortRank(promotions);

  // Menos agendados: todo el catálogo activo (servicios y rituales) con su conteo, incluyendo ceros
  const counts = new Map<string, number>();
  for (const r of [...sv, ...rt]) counts.set(r.key, r.count);
  const least = input.catalog
    .filter((c) => c.active && !/promoci/i.test(c.category))
    .map((c) => ({ key: String(c.id), name: c.name, count: counts.get(String(c.id)) ?? 0, revenue: 0 }))
    .sort((a, b) => a.count - b.count || a.name.localeCompare(b.name, 'es'))
    .slice(0, 5);
  for (const l of least) l.revenue = round2([...sv, ...rt].find((r) => r.key === l.key)?.revenue ?? 0);

  const revenue = round2(t.revenue);
  const paid = round2(Math.min(t.paid, t.revenue));
  const pending = round2(Math.max(0, revenue - paid));
  const sumRev = (xs: Ranked[]) => round2(xs.reduce((s, r) => s + r.revenue, 0));
  const sumCnt = (xs: Ranked[]) => xs.reduce((s, r) => s + r.count, 0);

  return {
    totals: {
      appointments: t.appointments,
      cancelled: t.cancelled,
      no_show: t.no_show,
      revenue,
      original: round2(t.original),
      discounts: round2(t.discounts),
      paid,
      pending,
      paid_pct: revenue > 0 ? Math.round((paid / revenue) * 1000) / 10 : 0,
      pending_pct: revenue > 0 ? Math.round((pending / revenue) * 1000) / 10 : 0,
      average_ticket: t.appointments - t.unconverted > 0 ? round2(revenue / (t.appointments - t.unconverted)) : 0,
      unconverted: t.unconverted,
    },
    series: { day: pts(day), week: pts(week), month: pts(month) },
    services: sv,
    rituals: rt,
    promotions: pm,
    least_services: least,
    intentions: [...intentions.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    comparison: [
      { kind: 'services', label: 'Servicios', count: sumCnt(sv), revenue: sumRev(sv) },
      { kind: 'rituals', label: 'Rituales', count: sumCnt(rt), revenue: sumRev(rt) },
      { kind: 'promotions', label: 'Promociones', count: sumCnt(pm), revenue: sumRev(pm) },
    ],
  };
}
