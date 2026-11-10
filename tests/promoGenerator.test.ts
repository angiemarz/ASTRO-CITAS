import { describe, expect, it } from 'vitest';
import { generateProposals, normalize, previewPackage, splitKeywords, stem, type CatalogItem } from '../shared/promoGenerator';

let id = 0;
const item = (name: string, category: string, price: number, description: string | null = null, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  id: ++id,
  name,
  category,
  description,
  price,
  currency: 'MXN',
  active: 1,
  ...extra,
});

const catalog: CatalogItem[] = [
  item('Lectura general', 'Tarot', 180, 'Consulta individual para tener claridad sobre tu momento actual.'),
  item('Lectura de relación', 'Tarot', 190, 'Mira cómo está tu vida en pareja y tus vínculos de amor.'),
  item('Lectura de alma gemela', 'Tarot', 90),
  item('Lectura de dones', 'Tarot', 90, 'Descubre tus talentos y fortalece tu autoestima.'),
  item('Hora de preguntas', 'Tarot', 230),
  item('Lectura de evolución profesional', 'Tarot', 150),
  item('Revolución solar', 'Astrología', 295),
  item('Numerología del alma', 'Numerología', 250),
  item('Abrecaminos', 'Rituales ✨', 180, 'Ritual Abrecaminos. Abre caminos de trabajo y dinero.'),
  item('Autoendulzamiento', 'Rituales ✨', 180, 'Ritual de amor propio para endulzar tu energía.'),
  item('Ritual 11:11', 'Rituales ✨', 111, 'Ritual de intención especial del portal 11:11: manifestar deseos y nuevos comienzos.'),
  item('Limpieza energética', 'Rituales ✨', 250, 'Libera cargas y bloqueos para soltar lo que ya no te sirve.'),
  // No deben usarse para armar paquetes nuevos:
  item('PAQUETE ORIENTACIÓN VOCACIONAL', 'Promociones', 200, 'Orientación vocacional completa. amor propio abundancia'),
  item('Servicio inactivo de amor propio', 'Tarot', 100, 'amor propio', { active: 0 }),
];
const byId = (i: number) => catalog.find((c) => c.id === i)!;
const names = (ids: number[]) => ids.map((i) => byId(i).name);

describe('texto', () => {
  it('normaliza acentos y mayúsculas, y quita plurales', () => {
    expect(normalize('  Desbloqueo ENERGÉTICO, ¡ya! ')).toBe('desbloqueo energetico ya');
    expect(stem('bloqueos')).toBe(stem('bloqueo'));
    expect(stem('relaciones')).toBe(stem('relacion'));
    expect(stem(normalize('energético'))).toBe(stem(normalize('energética')));
  });
  it('separa las palabras clave por comas, "y" y saltos de línea', () => {
    expect(splitKeywords('Amor propio, abundancia, desbloqueo energético')).toEqual(['Amor propio', 'abundancia', 'desbloqueo energético']);
    expect(splitKeywords('amor y dinero\nsalud')).toEqual(['amor', 'dinero', 'salud']);
    expect(splitKeywords('   ')).toEqual([]);
  });
});

describe('propuestas de paquetes', () => {
  const r = generateProposals('Amor propio, abundancia, desbloqueo energético', catalog);

  it('encuentra paquetes con servicios y rituales relacionados con las palabras clave', () => {
    expect(r.keywords).toHaveLength(3);
    expect(r.unmatched).toEqual([]);
    expect(r.proposals.length).toBeGreaterThanOrEqual(3);
    const all = new Set(r.proposals.flatMap((p) => names(p.serviceIds)));
    expect(all.has('Autoendulzamiento')).toBe(true); // amor propio (por nombre y descripción)
    expect(all.has('Abrecaminos')).toBe(true); // abundancia / caminos
    expect(all.has('Limpieza energética')).toBe(true); // desbloqueo energético (por su descripción)
  });

  it('usa las descripciones: "autoestima" en la descripción relaciona la Lectura de dones con amor propio', () => {
    const p = generateProposals('amor propio', catalog);
    const ids = new Set(p.proposals.flatMap((x) => x.serviceIds));
    expect(ids.has(catalog.find((c) => c.name === 'Lectura de dones')!.id)).toBe(true);
  });

  it('nunca usa paquetes ya armados (categoría Promociones) ni servicios inactivos', () => {
    const used = r.proposals.flatMap((p) => names(p.serviceIds));
    expect(used).not.toContain('PAQUETE ORIENTACIÓN VOCACIONAL');
    expect(used).not.toContain('Servicio inactivo de amor propio');
  });

  it('cada propuesta tiene al menos dos servicios distintos, ids únicos y sin repetirse', () => {
    const ids = r.proposals.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of r.proposals) {
      expect(p.serviceIds.length).toBeGreaterThanOrEqual(2);
      expect(new Set(p.serviceIds).size).toBe(p.serviceIds.length);
      expect(p.relevance).toBeGreaterThan(0);
      expect(p.relevance).toBeLessThanOrEqual(100);
      expect(p.title.length).toBeGreaterThan(5);
    }
  });

  it('mezcla una lectura con un ritual en el paquete "Lectura + ritual"', () => {
    const mixed = r.proposals.find((p) => p.label === 'Lectura + ritual');
    expect(mixed).toBeTruthy();
    const cats = names(mixed!.serviceIds).map((n) => catalog.find((c) => c.name === n)!.category);
    expect(cats.some((c) => /ritual/i.test(c))).toBe(true);
    expect(cats.some((c) => !/ritual/i.test(c))).toBe(true);
  });

  it('explica por qué se sugirió cada servicio y escribe una descripción editable', () => {
    const p = r.proposals[0];
    for (const sid of p.serviceIds) expect(p.matches[sid].length).toBeGreaterThan(0);
    expect(p.description).toContain('✨');
    for (const n of names(p.serviceIds)) expect(p.description).toContain(n);
  });

  it('el ritual 11:11 aparece cuando hablas de deseos y manifestar', () => {
    const d = generateProposals('manifestar deseos, nuevos comienzos', catalog);
    expect(d.proposals.flatMap((p) => names(p.serviceIds))).toContain('Ritual 11:11');
  });

  it('avisa qué palabras no encontraron nada y no inventa paquetes', () => {
    const none = generateProposals('zzz qqq', catalog);
    expect(none.proposals).toEqual([]);
    expect(none.unmatched).toEqual(['zzz qqq']);
    const partial = generateProposals('abundancia, xyzabc', catalog);
    expect(partial.unmatched).toEqual(['xyzabc']);
    expect(partial.proposals.length).toBeGreaterThan(0);
    expect(generateProposals('', catalog).proposals).toEqual([]);
  });
});

describe('vista previa del paquete', () => {
  const items = [
    { price: 180, currency: 'MXN' },
    { price: 111, currency: 'MXN' },
  ];
  it('suma el precio original y aplica el descuento una sola vez', () => {
    expect(previewPackage(items, 0, 20)).toMatchObject({ original: 291, savings: 0, final: 291 });
    expect(previewPackage(items, 10, 20)).toMatchObject({ original: 291, percent: 10, savings: 29.1, final: 261.9 });
    expect(previewPackage(items, 20, 20)).toMatchObject({ savings: 58.2, final: 232.8 });
  });
  it('convierte a dólares DESPUÉS del descuento y redondea a 2 decimales', () => {
    const p = previewPackage(items, 15, 20);
    expect(p.final).toBe(247.35);
    expect(p.usd).toEqual({ original: 14.55, savings: 2.18, final: 12.37 });
  });
  it('sin tipo de cambio no hay USD, y los servicios en USD no se pueden sumar en pesos', () => {
    expect(previewPackage(items, 10, null).usd).toBeNull();
    const mixed = previewPackage([{ price: 180, currency: 'MXN' }, { price: 10, currency: 'USD' }], 0, null);
    expect(mixed.missingRate).toBe(true);
    expect(previewPackage([{ price: 180, currency: 'MXN' }, { price: 10, currency: 'USD' }], 0, 20).original).toBe(380);
  });
  it('limita el descuento entre 0 y 100', () => {
    expect(previewPackage(items, 150, 20).final).toBe(0);
    expect(previewPackage(items, -5, 20).final).toBe(291);
  });
});
