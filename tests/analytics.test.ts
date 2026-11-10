import { describe, expect, it } from 'vitest';
import { computeAnalytics, type AnalyticsAppointment } from '../shared/analytics';

const tz = 'America/Mexico_City';
const appt = (id: number, start_at: string, final_price: number, paid: number, extra: Partial<AnalyticsAppointment> = {}): AnalyticsAppointment => ({
  id, start_at, status: 'completed', currency: 'MXN', original_price: final_price, discount: 0, final_price, paid, ...extra,
});
const line = (appointment_id: number, service_id: number, name: string, category: string, price: number, intention: string | null = null) => ({
  appointment_id, service_id, name, category, price, intention,
});
const catalog = [
  { id: 1, name: 'Lectura general', category: 'Tarot', active: 1 },
  { id: 2, name: 'Abrecaminos', category: 'Rituales ✨', active: 1 },
  { id: 3, name: 'Nunca agendado', category: 'Tarot', active: 1 },
  { id: 4, name: 'Inactivo', category: 'Tarot', active: 0 },
];

describe('estadísticas', () => {
  it('un paquete con varios servicios cuenta una cita y reparte el precio final sin duplicar ingresos', () => {
    // Lectura 180 + ritual 180 con 20% de descuento = 288 final
    const r = computeAnalytics(
      {
        appointments: [appt(1, '2026-11-03T18:00:00Z', 288, 100, { original_price: 360, discount: 72 })],
        lines: [line(1, 1, 'Lectura general', 'Tarot', 180), line(1, 2, 'Abrecaminos', 'Rituales ✨', 180, 'Salud')],
        promos: [{ appointment_id: 1, promotion_id: 9, name: 'Paquete', special_price: 288, savings: 72 }],
        catalog,
      },
      { rate: 20, tz },
    );
    expect(r.totals.appointments).toBe(1);
    expect(r.totals.revenue).toBe(288);
    expect(r.services[0]).toMatchObject({ name: 'Lectura general', count: 1, revenue: 144 });
    expect(r.rituals[0]).toMatchObject({ name: 'Abrecaminos', count: 1, revenue: 144 });
    expect(r.services[0].revenue + r.rituals[0].revenue).toBe(r.totals.revenue);
    expect(r.promotions[0]).toMatchObject({ count: 1, revenue: 288 });
    expect(r.intentions).toEqual([{ name: 'Salud', count: 1 }]);
    expect(r.totals.discounts).toBe(72);
  });

  it('distingue lo cobrado de lo pendiente y nunca cobra de más', () => {
    const r = computeAnalytics(
      {
        appointments: [appt(1, '2026-11-03T18:00:00Z', 200, 200), appt(2, '2026-11-04T18:00:00Z', 300, 100), appt(3, '2026-11-05T18:00:00Z', 100, 500)],
        lines: [], promos: [], catalog,
      },
      { rate: null, tz },
    );
    expect(r.totals).toMatchObject({ revenue: 600, paid: 400, pending: 200, appointments: 3, average_ticket: 200 });
    expect(r.totals.paid_pct + r.totals.pending_pct).toBeCloseTo(100, 1);
  });

  it('canceladas y no asistió se cuentan aparte y no suman ingresos', () => {
    const r = computeAnalytics(
      {
        appointments: [appt(1, '2026-11-03T18:00:00Z', 200, 0, { status: 'cancelled' }), appt(2, '2026-11-03T19:00:00Z', 200, 0, { status: 'no_show' }), appt(3, '2026-11-03T20:00:00Z', 100, 0)],
        lines: [], promos: [], catalog,
      },
      { rate: null, tz },
    );
    expect(r.totals).toMatchObject({ appointments: 1, cancelled: 1, no_show: 1, revenue: 100 });
  });

  it('convierte citas en dólares con el tipo de cambio, o las marca sin convertir', () => {
    const input = { appointments: [appt(1, '2026-11-03T18:00:00Z', 10, 5, { currency: 'USD' })], lines: [], promos: [], catalog };
    expect(computeAnalytics(input, { rate: 20, tz }).totals).toMatchObject({ revenue: 200, paid: 100 });
    const sin = computeAnalytics(input, { rate: null, tz }).totals;
    expect(sin).toMatchObject({ revenue: 0, unconverted: 1, appointments: 1 });
  });

  it('series por día, semana (lunes) y mes con la hora local', () => {
    const r = computeAnalytics(
      {
        // 2026-11-02 es lunes; 04:00Z del día 3 sigue siendo 2 de noviembre en CDMX
        appointments: [appt(1, '2026-11-03T04:00:00Z', 100, 0), appt(2, '2026-11-08T18:00:00Z', 50, 0), appt(3, '2026-12-01T18:00:00Z', 70, 0)],
        lines: [], promos: [], catalog,
      },
      { rate: null, tz },
    );
    expect(r.series.day.map((p) => p.key)).toEqual(['2026-11-02', '2026-11-08', '2026-12-01']);
    expect(r.series.week.find((p) => p.key === '2026-11-02')).toMatchObject({ count: 2, revenue: 150 });
    expect(r.series.month.map((p) => [p.key, p.count])).toEqual([['2026-11', 2], ['2026-12', 1]]);
  });

  it('lista los servicios menos agendados, incluyendo los que tienen cero, sin inactivos', () => {
    const r = computeAnalytics(
      { appointments: [appt(1, '2026-11-03T18:00:00Z', 180, 0)], lines: [line(1, 1, 'Lectura general', 'Tarot', 180)], promos: [], catalog },
      { rate: null, tz },
    );
    expect(r.least_services.map((s) => s.name)).toEqual(['Abrecaminos', 'Nunca agendado', 'Lectura general']);
    expect(r.least_services.map((s) => s.name)).not.toContain('Inactivo');
  });
});
