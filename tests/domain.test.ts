import { describe, expect, it } from 'vitest';
import { computePromo, contactLink, isPromotionValidOn, paymentStatus, promoIsApplicable } from '../shared/domain';
import type { Promotion } from '../shared/types';

const promo = (p: Partial<Promotion>): Promotion => ({
  id: 1, name: 'P', description: null, promo_type: 'percent', value: 10, currency: 'MXN', valid_from: null, valid_to: null,
  conditions: null, stackable: 0, active: 1, service_ids: [], created_at: '', updated_at: '', ...p,
});

const lines = [
  { service_id: 1, price: 450 },
  { service_id: 2, price: 800 },
];

describe('estado de pago', () => {
  it('sin pagar, parcial y completo', () => {
    expect(paymentStatus(1000, 0)).toBe('unpaid');
    expect(paymentStatus(1000, 300)).toBe('partial');
    expect(paymentStatus(1000, 1000)).toBe('paid');
    expect(paymentStatus(0, 0)).toBe('paid');
  });
});

describe('promociones', () => {
  it('precio especial sobre los servicios incluidos', () => {
    expect(computePromo(promo({ promo_type: 'fixed_price', value: 1000, service_ids: [1, 2] }), lines)).toEqual({ original: 1250, special: 1000, savings: 250 });
  });
  it('porcentaje aplica solo a los servicios de la promoción', () => {
    expect(computePromo(promo({ promo_type: 'percent', value: 50, service_ids: [2] }), lines)).toEqual({ original: 800, special: 400, savings: 400 });
  });
  it('monto fijo nunca deja precio negativo', () => {
    expect(computePromo(promo({ promo_type: 'amount', value: 5000 }), lines).special).toBe(0);
  });
  it('vigencia y aplicabilidad', () => {
    const p = promo({ valid_from: '2026-10-01', valid_to: '2026-10-31', service_ids: [2] });
    expect(isPromotionValidOn(p, '2026-10-27')).toBe(true);
    expect(isPromotionValidOn(p, '2026-11-01')).toBe(false);
    expect(promoIsApplicable(p, [1], '2026-10-27')).toBe(false);
    expect(promoIsApplicable(p, [1, 2], '2026-10-27')).toBe(true);
  });
});

describe('enlaces de contacto', () => {
  it('WhatsApp agrega lada de México a 10 dígitos', () => {
    expect(contactLink('whatsapp', '81 1234 5678')).toBe('https://wa.me/528112345678');
  });
  it('Instagram, Messenger, teléfono y videollamada', () => {
    expect(contactLink('instagram', '@astro.bloom')).toBe('https://instagram.com/astro.bloom');
    expect(contactLink('messenger', 'astrobloomx')).toBe('https://m.me/astrobloomx');
    expect(contactLink('phone', '+52 81 1234 5678')).toBe('tel:+528112345678');
    expect(contactLink('video', 'https://meet.google.com/abc')).toBe('https://meet.google.com/abc');
    expect(contactLink('video', 'no es enlace')).toBeNull();
  });
});

import { googleCalendarDayLink, isRitualOnly } from '../shared/domain';

describe('rituales', () => {
  it('solo cuentan si todos los servicios son rituales', () => {
    expect(isRitualOnly({ services: [{ category: 'Rituales ✨' }] })).toBe(true);
    expect(isRitualOnly({ services: [{ category: 'Rituales ✨' }, { category: 'Tarot' }] })).toBe(false);
    expect(isRitualOnly({ services: [{ category: null }] })).toBe(false);
    expect(isRitualOnly({ services: [] })).toBe(false);
  });
  it('enlace de Google Calendar de día completo (el día siguiente como fin) y sin bloquear horario', () => {
    const url = new URL(googleCalendarDayLink({ title: '✨ Abrecaminos · Ana', ymd: '2026-12-31', tz: 'America/Monterrey', details: 'Cooperación: $180' }));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('dates')).toBe('20261231/20270101');
    expect(url.searchParams.get('trp')).toBe('false');
    expect(url.searchParams.get('text')).toBe('✨ Abrecaminos · Ana');
  });
});

import { hasRitual, RITUAL_WINDOW_DAYS, ritualCountdownLabel, ritualDeadline } from '../shared/domain';

describe('plazo de los rituales: una semana y dos días', () => {
  const TZ = 'America/Monterrey';
  // cita del viernes 30 de octubre (8:00 PM hora local = 02:00 UTC del 31)
  const start = '2026-10-31T02:00:00Z';
  it('el plazo son 9 días desde la fecha de la cita', () => {
    expect(RITUAL_WINDOW_DAYS).toBe(9);
    expect(ritualDeadline(start, TZ, new Date('2026-11-06T18:00:00Z')).deadlineYmd).toBe('2026-11-08');
  });
  it('cuenta los días que faltan', () => {
    const r = ritualDeadline(start, TZ, new Date('2026-11-06T18:00:00Z')); // 6 de nov, mediodía local
    expect(r).toMatchObject({ daysLeft: 2, overdue: false });
    expect(ritualCountdownLabel(r)).toBe('Faltan 2 días');
    expect(ritualCountdownLabel(ritualDeadline(start, TZ, new Date('2026-11-07T18:00:00Z')))).toBe('Falta 1 día');
  });
  it('vence hoy durante todo el último día y se pone en rojo al día siguiente', () => {
    const lastMinute = ritualDeadline(start, TZ, new Date('2026-11-09T05:59:00Z')); // 8 nov 11:59 PM local
    expect(lastMinute).toMatchObject({ daysLeft: 0, overdue: false });
    expect(ritualCountdownLabel(lastMinute)).toBe('Vence hoy');
    const next = ritualDeadline(start, TZ, new Date('2026-11-09T06:00:00Z')); // 9 nov 12:00 AM local
    expect(next).toMatchObject({ daysLeft: -1, overdue: true });
    expect(ritualCountdownLabel(next)).toBe('Venció ayer');
    expect(ritualCountdownLabel(ritualDeadline(start, TZ, new Date('2026-11-12T18:00:00Z')))).toBe('Venció hace 4 días');
  });
  it('hasRitual detecta rituales aunque haya otros servicios', () => {
    expect(hasRitual({ services: [{ category: 'Tarot' }, { category: 'Rituales ✨' }] })).toBe(true);
    expect(hasRitual({ services: [{ category: 'Tarot' }] })).toBe(false);
  });
});
