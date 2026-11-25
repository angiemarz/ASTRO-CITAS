// Excel de promociones: las propuestas del Generador y las promociones ya guardadas, con el mismo diseño AstroBloomx.
import { describePromo, isPromotionValidOn, mxnToUsd, round2, toMxn } from '../../shared/domain';
import type { CatalogItem, Proposal } from '../../shared/promoGenerator';
import { previewPackage } from '../../shared/promoGenerator';
import type { Promotion, Service } from '../../shared/types';
import { buildTableXlsx, downloadTableXlsx, STATUS_PALETTE, type TableCell } from './exportAppointments';

/** Propuestas del generador → Excel. Usa el descuento elegido para calcular precio final y ahorro. */
export function proposalsXlsx(proposals: Proposal[], services: CatalogItem[], percent: number, rate: number | null, business: string, today: string) {
  const byId = new Map(services.map((s) => [s.id, s]));
  const rows: TableCell[][] = proposals.map((p) => {
    const items = p.serviceIds.map((id) => byId.get(id)).filter(Boolean) as CatalogItem[];
    const pv = previewPackage(items, percent, rate);
    return [
      { v: p.title, kind: 'bold' },
      { v: p.label, kind: 'center' },
      { v: p.relevance / 100, kind: 'percent' },
      { v: items.map((i) => i.name).join(' + '), kind: 'wrap' },
      { v: items.length, kind: 'center' },
      { v: pv.original, kind: 'money' },
      { v: percent / 100, kind: 'percent' },
      { v: pv.savings, kind: 'money' },
      { v: pv.final, kind: 'money' },
      { v: pv.usd ? pv.usd.final : '', kind: 'money' },
      { v: p.description, kind: 'wrap' },
    ];
  });
  return buildTableXlsx({
    sheet: 'Propuestas',
    title: `${business} · Propuestas de promociones`,
    subtitle: `${proposals.length} propuesta(s) · descuento aplicado: ${percent}% · generado el ${today}${rate ? ` · tipo de cambio ${rate}` : ''}`,
    headers: ['Paquete', 'Tipo', 'Afinidad', 'Servicios / rituales incluidos', 'Cantidad', 'Precio original (MXN)', 'Descuento', 'Ahorro (MXN)', 'Precio final (MXN)', 'Precio final (USD)', 'Descripción sugerida'],
    widths: [34, 16, 11, 46, 10, 16, 11, 14, 16, 16, 70],
    rows,
  });
}

/** Promociones guardadas → Excel (con vigencia, estado y uso). */
export function promotionsXlsx(promos: (Promotion & { usage_count?: number })[], services: Service[], rate: number | null, business: string, today: string) {
  const byId = new Map(services.map((s) => [s.id, s]));
  const rows: TableCell[][] = promos.map((p) => {
    const items = p.service_ids.map((id) => byId.get(id)).filter(Boolean) as Service[];
    const normal = round2(items.reduce((a, s) => a + (toMxn(s.price, s.currency, rate) ?? 0), 0));
    let final = normal;
    if (p.promo_type === 'percent') final = round2(normal * (1 - p.value / 100));
    else if (p.promo_type === 'amount') final = round2(Math.max(0, normal - p.value));
    else if (p.promo_type === 'fixed_price') final = round2(toMxn(p.value, p.currency, rate) ?? 0);
    const current = isPromotionValidOn(p, today);
    const expired = !!p.valid_to && p.valid_to < today;
    const state: [string, [string, string]] = current ? ['Vigente', STATUS_PALETTE.good] : !p.active ? ['Inactiva', STATUS_PALETTE.off] : expired ? ['Vencida', STATUS_PALETTE.bad] : ['Fuera de vigencia', STATUS_PALETTE.warn];
    const usd = mxnToUsd(final, rate);
    return [
      { v: p.name, kind: 'bold' },
      { v: describePromo(p) + (p.requires_all ? ' · Paquete' : ''), kind: 'wrap' },
      { v: items.length ? items.map((i) => i.name).join(' + ') : 'Cualquier servicio', kind: 'wrap' },
      { v: items.length ? normal : '', kind: 'money' },
      { v: items.length ? final : '', kind: 'money' },
      { v: items.length && usd !== null ? usd : '', kind: 'money' },
      { v: p.valid_from ?? '', kind: 'center' },
      { v: p.valid_to ?? '', kind: 'center' },
      { v: state[0], kind: 'badge', color: state[1] },
      { v: p.usage_count ?? 0, kind: 'center' },
      { v: p.description ?? '', kind: 'wrap' },
      { v: p.conditions ?? '', kind: 'wrap' },
    ];
  });
  return buildTableXlsx({
    sheet: 'Promociones',
    title: `${business} · Promociones`,
    subtitle: `${promos.length} promoción(es) · generado el ${today}`,
    headers: ['Promoción', 'Tipo / descuento', 'Servicios incluidos', 'Precio normal (MXN)', 'Precio con promo (MXN)', 'Precio con promo (USD)', 'Desde', 'Hasta', 'Estado', 'Veces usada', 'Descripción', 'Condiciones'],
    widths: [32, 22, 44, 16, 17, 17, 12, 12, 17, 11, 70, 36],
    rows,
  });
}

export { downloadTableXlsx };
