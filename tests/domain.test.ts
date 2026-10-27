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
