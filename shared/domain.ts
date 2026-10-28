// Reglas de negocio compartidas: etiquetas, cálculo de precios, estado de pago y enlaces de contacto.
import { addDaysYmd } from './time';
import type {
  AppointmentStatus,
  Currency,
  PaymentStatus,
  Platform,
  Promotion,
  PromoType,
  Service,
} from './types';

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Agendada',
  confirmed: 'Confirmada',
  in_progress: 'En curso',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
};

export const STATUS_ORDER: AppointmentStatus[] = [
  'scheduled',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
];

/** Estados en los que la cita ya no está "pendiente de atender". */
export const FINAL_STATUSES: AppointmentStatus[] = ['completed', 'cancelled', 'no_show'];

export const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  unpaid: 'Sin pagar',
  partial: 'Abonada parcialmente',
  paid: 'Pagada completamente',
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  whatsapp: 'WhatsApp',
  messenger: 'Messenger',
  instagram: 'Instagram',
  video: 'Videollamada',
  phone: 'Llamada telefónica',
  other: 'Otra',
};

export const PLATFORM_FIELD: Record<Platform, { label: string; placeholder: string; inputMode?: string }> = {
  whatsapp: { label: 'Número de WhatsApp', placeholder: '+52 81 1234 5678', inputMode: 'tel' },
  messenger: { label: 'Usuario o enlace de Messenger', placeholder: 'usuario o https://m.me/usuario' },
  instagram: { label: 'Usuario o enlace de Instagram', placeholder: '@usuario' },
  video: { label: 'Enlace de la videollamada', placeholder: 'https://meet.google.com/…' },
  phone: { label: 'Número telefónico', placeholder: '+52 81 1234 5678', inputMode: 'tel' },
  other: { label: 'Contacto o enlace', placeholder: 'Enlace, usuario o nota' },
};

export const PROMO_TYPE_LABELS: Record<PromoType, string> = {
  fixed_price: 'Precio especial',
  percent: 'Porcentaje de descuento',
  amount: 'Descuento en monto fijo',
};

export const DEFAULT_PAYMENT_METHODS = [
  'Transferencia',
  'Efectivo',
  'Depósito',
  'Tarjeta',
  'PayPal',
  'Mercado Pago',
  'Otro',
];

export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function paymentStatus(finalPrice: number, paid: number): PaymentStatus {
  const f = round2(finalPrice);
  const p = round2(paid);
  if (p <= 0) return f <= 0 ? 'paid' : 'unpaid';
  if (p + 0.004 >= f) return 'paid';
  return 'partial';
}

export function formatMoney(amount: number, currency: Currency | string = 'MXN'): string {
  const n = Number(amount) || 0;
  const formatted = new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: Number.isInteger(round2(n)) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
  return `$${formatted} ${currency}`;
}

export function formatDuration(min: number | null | undefined): string {
  if (!min) return '';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// ---------- Promociones ----------

export function isPromotionValidOn(p: Pick<Promotion, 'active' | 'valid_from' | 'valid_to'>, ymd: string): boolean {
  if (!p.active) return false;
  if (p.valid_from && ymd < p.valid_from) return false;
  if (p.valid_to && ymd > p.valid_to) return false;
  return true;
}

/** Servicios seleccionados a los que aplica la promoción (todos si la promoción es general). */
export function promoAffected<T extends { service_id: number | null; price: number }>(
  promo: Pick<Promotion, 'service_ids'>,
  lines: T[],
): T[] {
  if (!promo.service_ids || promo.service_ids.length === 0) return lines;
  return lines.filter((l) => l.service_id != null && promo.service_ids.includes(l.service_id));
}

export function promoIsApplicable(
  promo: Promotion,
  serviceIds: number[],
  ymd: string,
): boolean {
  if (!isPromotionValidOn(promo, ymd)) return false;
  if (!promo.service_ids || promo.service_ids.length === 0) return serviceIds.length > 0;
  return promo.service_ids.some((id) => serviceIds.includes(id));
}

export function computePromo(
  promo: Pick<Promotion, 'promo_type' | 'value' | 'service_ids'>,
  lines: { service_id: number | null; price: number }[],
): { original: number; special: number; savings: number } {
  const affected = promoAffected(promo, lines);
  const original = round2(affected.reduce((s, l) => s + (Number(l.price) || 0), 0));
  let special = original;
  if (promo.promo_type === 'fixed_price') special = Number(promo.value);
  else if (promo.promo_type === 'percent') special = original * (1 - Number(promo.value) / 100);
  else if (promo.promo_type === 'amount') special = original - Number(promo.value);
  special = round2(Math.max(0, Math.min(original, special)));
  return { original, special, savings: round2(original - special) };
}

export function describePromo(p: Pick<Promotion, 'promo_type' | 'value' | 'currency'>): string {
  if (p.promo_type === 'percent') return `${p.value}% de descuento`;
  if (p.promo_type === 'amount') return `${formatMoney(p.value, p.currency)} de descuento`;
  return `Precio especial ${formatMoney(p.value, p.currency)}`;
}

export function serviceToLine(s: Service) {
  return {
    service_id: s.id,
    name: s.name,
    category: s.category,
    price: Number(s.price) || 0,
    duration_min: s.duration_min,
  };
}

// ---------- Contacto ----------

const digits = (s: string) => s.replace(/[^\d]/g, '');
const stripAt = (s: string) => s.trim().replace(/^@/, '');
const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

/** Normaliza un teléfono mexicano: 10 dígitos → agrega 52. */
export function normalizePhoneForWa(phone: string): string {
  const d = digits(phone);
  if (d.length === 10) return `52${d}`;
  return d;
}

/**
 * Devuelve el enlace para abrir la conversación en la app correspondiente.
 * Nunca envía mensajes: solo abre el chat/perfil.
 */
export function contactLink(platform: Platform, value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  switch (platform) {
    case 'whatsapp': {
      if (isUrl(v)) return v;
      const d = normalizePhoneForWa(v);
      return d.length >= 8 ? `https://wa.me/${d}` : null;
    }
    case 'phone': {
      const d = digits(v);
      if (d.length < 7) return null;
      return `tel:${v.trim().startsWith('+') ? '+' : ''}${d}`;
    }
    case 'messenger': {
      if (isUrl(v)) return v;
      const u = stripAt(v);
      return /^[\w.]+$/.test(u) ? `https://m.me/${u}` : null;
    }
    case 'instagram': {
      if (isUrl(v)) return v;
      const u = stripAt(v);
      return /^[\w.]+$/.test(u) ? `https://instagram.com/${u}` : null;
    }
    case 'video':
    case 'other':
      return isUrl(v) ? v : null;
  }
}

/** Mejor dato de contacto conocido de un cliente para una plataforma. */
export function clientContactFor(
  platform: Platform,
  c: { phone?: string | null; instagram?: string | null; messenger?: string | null } | null | undefined,
): string {
  if (!c) return '';
  if (platform === 'whatsapp' || platform === 'phone') return c.phone ?? '';
  if (platform === 'instagram') return c.instagram ?? '';
  if (platform === 'messenger') return c.messenger ?? '';
  return '';
}

// ---------- Rituales ----------

export const isRitualCategory = (c: string | null | undefined) => /ritual/i.test(c ?? '');

/** Cita cuyos servicios son todos rituales: no ocupan una hora fija, así que no se envían a Cal.com ni bloquean horarios. */
export const isRitualOnly = (a: { services: { category: string | null }[] }) =>
  a.services.length > 0 && a.services.every((s) => isRitualCategory(s.category));

/**
 * Enlace "Agregar a Google Calendar" de un evento de día completo. Los eventos de día completo se crean como
 * "Disponible", así que no bloquean horarios en Cal.com. No requiere conectar nada.
 */
export function googleCalendarDayLink(o: { title: string; ymd: string; details?: string; tz?: string }): string {
  const d = (ymd: string) => ymd.replace(/-/g, '');
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: o.title,
    dates: `${d(o.ymd)}/${d(addDaysYmd(o.ymd, 1))}`,
    trp: 'false',
    ...(o.details ? { details: o.details } : {}),
    ...(o.tz ? { ctz: o.tz } : {}),
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
