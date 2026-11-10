// Generador de paquetes promocionales a partir de palabras clave.
// Primera versión sin inteligencia artificial de pago: coincidencias de palabras y sinónimos (un pequeño
// "diccionario espiritual" en español) entre lo que escribes y el nombre, la categoría y la descripción
// de tus servicios y rituales. Todo corre en el navegador con los datos reales del catálogo.
import { mxnToUsd, round2, toMxn } from './domain';

export interface CatalogItem {
  id: number;
  name: string;
  category: string;
  description: string | null;
  price: number;
  currency: string;
  active?: number;
}

export interface Proposal {
  /** Identificador estable: los ids de los servicios, ordenados. */
  id: string;
  /** Etiqueta del tipo de paquete: Esencial, Lectura + ritual, Completo… */
  label: string;
  /** Nombre sugerido para la promoción. */
  title: string;
  serviceIds: number[];
  /** Relevancia 0–100 respecto a lo que escribiste. */
  relevance: number;
  /** Por servicio: qué palabras clave tuyas coincidieron (y por eso se sugirió). */
  matches: Record<number, string[]>;
  /** Descripción sugerida para promocionar el paquete (editable). */
  description: string;
}

export interface GeneratorResult {
  /** Las palabras clave detectadas en lo que escribiste. */
  keywords: string[];
  /** Palabras clave para las que no se encontró ningún servicio. */
  unmatched: string[];
  proposals: Proposal[];
}

// ---------- Texto ----------

const STOPWORDS = new Set(
  'a al algo ante con contra de del desde el ella ellas ellos en entre era es esta este esto la las lo los me mi mis muy no nos o para pero por que se si sin sobre su sus te tu tus un una uno unos unas y e ya quiero necesito necesita ofrecer paquete promocion promo relacionado relacionados clientes cliente clienta'.split(
    ' ',
  ),
);

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Raíz muy simple en español: quita plurales para que "bloqueos" coincida con "bloqueo". */
export function stem(w: string): string {
  let s = w;
  if (s.length > 6 && s.endsWith('ciones')) s = s.slice(0, -2);
  else if (s.length > 5 && s.endsWith('es')) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s')) s = s.slice(0, -1);
  // Género: "energético" = "energética", "bloqueado" = "bloqueada"
  if (s.length > 5 && (s.endsWith('a') || s.endsWith('o'))) s = s.slice(0, -1);
  return s;
}

const tokens = (s: string) =>
  normalize(s)
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t) && (t.length > 2 || /\d/.test(t)))
    .map(stem);

/** ¿El texto (ya normalizado) contiene la palabra o frase (también normalizada), respetando palabras completas? */
function containsPhrase(textN: string, phraseN: string): boolean {
  if (!phraseN) return false;
  return (' ' + textN + ' ').includes(' ' + phraseN + ' ') || (' ' + textN.split(' ').map(stem).join(' ') + ' ').includes(' ' + phraseN.split(' ').map(stem).join(' ') + ' ');
}

// ---------- Diccionario de temas ----------

interface Theme {
  id: string;
  label: string;
  /** Palabras o frases que, si las escribes, activan el tema. */
  triggers: string[];
  /** Palabras o frases que se buscan en tus servicios cuando el tema está activo. */
  terms: string[];
}

export const THEMES: Theme[] = [
  {
    id: 'amor',
    label: 'Amor y pareja',
    triggers: ['amor', 'pareja', 'relacion', 'romance', 'enamorar', 'noviazgo', 'matrimonio', 'boda', 'conyuge', 'corazon', 'soltera', 'reconciliacion'],
    terms: ['amor', 'amorosa', 'pareja', 'relacion', 'alma gemela', 'llamas gemelas', 'conyuge', 'boda', 'matrimonio', 'karmica', 'endulzamiento', 'autoendulzamiento', 'sinastria', 'divorcio', 'corazon'],
  },
  {
    id: 'amor_propio',
    label: 'Amor propio',
    triggers: ['amor propio', 'autoestima', 'autocuidado', 'autoamor', 'confianza', 'valorarme', 'merecer', 'aceptacion', 'seguridad'],
    terms: ['amor propio', 'autoestima', 'autoendulzamiento', 'dones', 'alma', 'sanacion', 'confianza', 'nuevos comienzos', 'evolucion', 'cumpleanos', 'proposito', 'endulzamiento'],
  },
  {
    id: 'abundancia',
    label: 'Abundancia y dinero',
    triggers: ['abundancia', 'dinero', 'prosperidad', 'riqueza', 'finanzas', 'economia', 'ingresos', 'exito', 'suerte', 'negocio', 'emprendimiento', 'trabajo', 'empleo', 'proyectos'],
    terms: ['abundancia', 'dinero', 'prosperidad', 'trabajo', 'proyectos', 'profesional', 'abre caminos', 'abrecaminos', 'negocio', 'vocacional', 'marca', 'exito', 'manifestar', 'deseo', '11 11'],
  },
  {
    id: 'bloqueos',
    label: 'Desbloqueo energético',
    triggers: ['desbloqueo', 'bloqueo', 'bloqueada', 'bloqueado', 'estancada', 'estancado', 'estancamiento', 'soltar', 'liberar', 'liberacion', 'cargas', 'limpieza', 'limpiar', 'energetico', 'energia', 'caminos'],
    terms: ['abrecaminos', 'abre caminos', 'caminos', 'vidas pasadas', 'akashicos', 'karma', 'karmica', 'limpieza', 'soltar', 'liberar', 'bloqueos', 'generacional', 'energia', 'ritual', 'endulzamiento'],
  },
  {
    id: 'proteccion',
    label: 'Protección',
    triggers: ['proteccion', 'proteger', 'escudo', 'envidia', 'mal de ojo', 'blindaje', 'defensa', 'seguridad energetica'],
    terms: ['proteccion', 'limpieza', 'escudo', 'angeles', 'angelicales', 'ritual', 'energia'],
  },
  {
    id: 'salud',
    label: 'Salud y bienestar',
    triggers: ['salud', 'bienestar', 'sanar', 'sanacion', 'cuerpo', 'equilibrio'],
    terms: ['salud', 'sanacion', 'bienestar', 'energia', 'ritual', 'equilibrio'],
  },
  {
    id: 'proposito',
    label: 'Propósito y destino',
    triggers: ['proposito', 'destino', 'mision', 'vocacion', 'direccion', 'rumbo', 'claridad de vida'],
    terms: ['proposito', 'destino', 'matriz', 'carta astral', 'revolucion solar', 'numerologia', 'vocacional', 'dones', 'vidas pasadas', 'mision', 'alma', 'evolucion profesional'],
  },
  {
    id: 'futuro',
    label: 'Futuro y año nuevo',
    triggers: ['futuro', '2026', '2027', 'ano nuevo', 'prediccion', 'proximo ano', 'anual', 'que viene'],
    terms: ['2026', 'futuro', 'revolucion solar', 'global', 'todo el mazo', 'videncia', 'prediccion', 'anual', 'cumpleanos', 'mensaje'],
  },
  {
    id: 'familia',
    label: 'Familia y hogar',
    triggers: ['familia', 'hijos', 'hogar', 'mama', 'papa', 'generacional', 'ancestros'],
    terms: ['familia', 'hijos', 'generacional', 'hogar', 'ancestral'],
  },
  {
    id: 'espiritual',
    label: 'Conexión espiritual',
    triggers: ['espiritual', 'espiritualidad', 'angeles', 'guias', 'conexion', 'intuicion', 'mensajes', 'mas alla'],
    terms: ['angeles', 'angelicales', 'mensaje del mas alla', 'oraculo', 'espiritual', 'guias', 'suenos', 'horas espejo', 'consejo', 'akashicos'],
  },
  {
    id: 'claridad',
    label: 'Claridad y respuestas',
    triggers: ['claridad', 'respuestas', 'dudas', 'decision', 'decisiones', 'orientacion', 'preguntas'],
    terms: ['preguntas', 'pendulo', 'respuesta', 'consejo', 'hora de preguntas', 'orientacion', 'lectura general', 'claridad'],
  },
  {
    id: 'deseos',
    label: 'Manifestación y deseos',
    triggers: ['manifestar', 'manifestacion', 'deseo', 'deseos', 'intencion', 'intenciones', 'peticion', 'nuevos comienzos', 'portal'],
    terms: ['11 11', 'deseo', 'manifestar', 'intencion', 'peticion', 'nuevos comienzos', 'abrecaminos', 'portal'],
  },
];

/** Ideas de palabras clave para mostrar como sugerencias. */
export const KEYWORD_IDEAS = ['Amor propio', 'Abundancia', 'Desbloqueo energético', 'Protección', 'Propósito', 'Claridad', 'Deseos', 'Año nuevo'];

// ---------- Búsqueda ----------

const isRitual = (i: CatalogItem) => /ritual/i.test(i.category);
/** Los "servicios" de la categoría Promociones son paquetes ya armados: no se usan para armar paquetes nuevos. */
const isPrebuiltPromo = (i: CatalogItem) => /promoci/i.test(i.category);

/** Divide lo escrito en palabras clave: por comas, punto y coma, saltos de línea, "+" y " y ". */
export function splitKeywords(query: string): string[] {
  return query
    .split(/[,;\n+/|]|\s+y\s+|\s+e\s+/i)
    .map((s) => s.trim())
    .filter((s) => normalize(s).length > 1);
}

interface Hit {
  score: number;
}

/** Puntaje de un servicio para UNA palabra clave (nombre pesa más que categoría y descripción). */
function scoreItem(item: CatalogItem, keyword: string): Hit {
  const kwN = normalize(keyword);
  const kwTokens = tokens(keyword);
  const nameN = normalize(item.name);
  const catN = normalize(item.category);
  const descN = normalize(item.description ?? '');
  let score = 0;

  // 1) Coincidencia directa con lo que escribiste
  if (kwN.includes(' ') && containsPhrase(nameN, kwN)) score += 8; // frase completa en el nombre
  if (kwN.includes(' ') && containsPhrase(descN, kwN)) score += 4;
  for (const t of kwTokens) {
    if (containsPhrase(nameN, t)) score += 6;
    if (containsPhrase(catN, t)) score += 3;
    if (containsPhrase(descN, t)) {
      const hits = descN.split(' ').map(stem).filter((w) => w === t).length;
      score += 3 + Math.min(2, hits - 1);
    }
  }

  // 2) Sinónimos: temas que activa la palabra clave
  for (const theme of THEMES) {
    const active = theme.triggers.some((tr) => {
      const trN = normalize(tr);
      return trN.includes(' ') ? containsPhrase(kwN, trN) : kwTokens.includes(stem(trN));
    });
    if (!active) continue;
    let t = 0;
    for (const term of theme.terms) {
      const termN = normalize(term);
      if (containsPhrase(nameN, termN)) t += 3;
      if (containsPhrase(descN, termN)) t += 1.5;
      if (containsPhrase(catN, termN)) t += 0.5;
    }
    score += Math.min(9, t);
  }
  return { score };
}

function firstSentence(text: string | null, max = 150): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  const s = m ? m[1] : t;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function joinNatural(list: string[]): string {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} y ${list[list.length - 1]}`;
}

export function suggestDescription(title: string, items: CatalogItem[], keywords: string[]): string {
  const lines = items.map((i) => {
    const d = firstSentence(i.description);
    return d ? `• ${i.name}: ${d}` : `• ${i.name}`;
  });
  const names = joinNatural(items.map((i) => i.name));
  const intent = keywords.length ? ` pensado para trabajar ${joinNatural(keywords.map((k) => k.toLowerCase()))}` : '';
  return `✨ ${title}: ${names} en un solo paquete${intent}.\n\n${lines.join('\n')}\n\n💜 Reserva tu espacio y recibe un precio especial por elegir el paquete completo.`;
}

export function generateProposals(query: string, catalog: CatalogItem[], opts: { max?: number } = {}): GeneratorResult {
  const keywords = splitKeywords(query);
  if (!keywords.length) return { keywords: [], unmatched: [], proposals: [] };
  const items = catalog.filter((i) => (i.active ?? 1) && !isPrebuiltPromo(i));

  // score[item][keyword]
  const per = new Map<number, number[]>();
  for (const it of items) per.set(it.id, keywords.map((k) => scoreItem(it, k).score));
  const total = (it: CatalogItem) => (per.get(it.id) ?? []).reduce((a, b) => a + b, 0);

  const unmatched = keywords.filter((_, ki) => !items.some((it) => (per.get(it.id)?.[ki] ?? 0) > 0));
  const ranked = items.filter((it) => total(it) > 0).sort((a, b) => total(b) - total(a) || a.name.localeCompare(b.name, 'es'));
  if (ranked.length < 2) return { keywords, unmatched, proposals: [] };
  const top = total(ranked[0]);
  // Descarta coincidencias muy débiles para no rellenar paquetes con servicios sin relación
  const pool = ranked.filter((it) => total(it) >= top * 0.22);

  /** Selección voraz: cubre cada palabra clave, mezcla categorías y mezcla lecturas con rituales. */
  const pick = (k: number, kwIdx: number[] | null = null, from: CatalogItem[] = pool): CatalogItem[] => {
    const chosen: CatalogItem[] = [];
    const covered = new Set<number>();
    const idxs = kwIdx ?? keywords.map((_, i) => i);
    while (chosen.length < k) {
      let best: CatalogItem | null = null;
      let bestGain = 0;
      for (const it of from) {
        if (chosen.includes(it)) continue;
        const s = per.get(it.id) ?? [];
        let gain = 0;
        for (const i of idxs) gain += (s[i] ?? 0) * (covered.has(i) ? 0.35 : 1);
        if (gain <= 0) continue;
        if (!chosen.some((c) => c.category === it.category)) gain += 1.5;
        if (chosen.length && !chosen.some((c) => isRitual(c) === isRitual(it))) gain += 1.5;
        if (gain > bestGain) {
          best = it;
          bestGain = gain;
        }
      }
      if (!best) break;
      chosen.push(best);
      (per.get(best.id) ?? []).forEach((v, i) => v > 0 && idxs.includes(i) && covered.add(i));
    }
    return chosen;
  };

  const rituals = pool.filter(isRitual);
  const readings = pool.filter((i) => !isRitual(i));
  const drafts: { label: string; items: CatalogItem[]; focus?: string }[] = [];
  drafts.push({ label: 'Esencial', items: pick(2) });
  if (readings.length && rituals.length) drafts.push({ label: 'Lectura + ritual', items: [pick(1, null, readings)[0], pick(1, null, rituals)[0]].filter(Boolean) });
  drafts.push({ label: 'Completo', items: pick(3) });
  drafts.push({ label: 'Profundo', items: pick(4) });
  if (rituals.length >= 2) drafts.push({ label: 'Solo rituales', items: pick(Math.min(3, rituals.length), null, rituals) });
  if (keywords.length >= 2) {
    keywords.forEach((kw, i) => {
      if (unmatched.includes(kw)) return;
      let its = readings.length && rituals.length ? [pick(1, [i], readings)[0], pick(1, [i], rituals)[0]].filter(Boolean) : pick(2, [i]);
      if (its.length < 2) its = pick(2, [i]);
      drafts.push({ label: `Enfoque: ${capitalize(kw)}`, items: its, focus: kw });
    });
  }

  const maxItem = Math.max(1, top);
  const seen = new Set<string>();
  const out: Proposal[] = [];
  const titles = new Set<string>();
  for (const d of drafts) {
    const its = [...new Map(d.items.map((i) => [i.id, i])).values()];
    if (its.length < 2) continue;
    const id = its.map((i) => i.id).sort((a, b) => a - b).join('-');
    if (seen.has(id)) continue;
    seen.add(id);
    const focusKw = d.focus ? [d.focus] : keywords.filter((_, ki) => its.some((i) => (per.get(i.id)?.[ki] ?? 0) > 0));
    const coverage = d.focus ? 1 : focusKw.length / keywords.length;
    const avg = its.reduce((s, i) => s + total(i) / maxItem, 0) / its.length;
    const relevance = Math.round(100 * Math.min(1, 0.6 * coverage + 0.4 * Math.min(1, avg)));
    let title = `Paquete ${joinNatural((focusKw.length ? focusKw : keywords).slice(0, 3).map(capitalize))}`;
    if (titles.has(title)) title += ` · ${d.label.replace(/^Enfoque: .*/, 'Enfoque')}`;
    titles.add(title);
    const matches: Record<number, string[]> = {};
    for (const i of its) matches[i.id] = keywords.filter((_, ki) => (per.get(i.id)?.[ki] ?? 0) > 0);
    out.push({
      id,
      label: d.label,
      title,
      serviceIds: its.map((i) => i.id),
      relevance,
      matches,
      description: suggestDescription(title, its, focusKw.length ? focusKw : keywords),
    });
  }
  out.sort((a, b) => b.relevance - a.relevance);
  return { keywords, unmatched, proposals: out.slice(0, opts.max ?? 9) };
}

// ---------- Vista previa de precios ----------

export interface PackagePreview {
  /** Suma de los precios originales, en MXN. */
  original: number;
  percent: number;
  savings: number;
  final: number;
  /** Equivalentes en USD calculados con el tipo de cambio (null si no hay tipo de cambio). */
  usd: { original: number; savings: number; final: number } | null;
  /** Hay servicios en USD y falta el tipo de cambio para sumarlos en pesos. */
  missingRate: boolean;
}

/** El precio original es la suma de los servicios incluidos; el descuento se aplica una sola vez y después se convierte a USD. */
export function previewPackage(items: Pick<CatalogItem, 'price' | 'currency'>[], percent: number, rate: number | null | undefined): PackagePreview {
  let missingRate = false;
  let original = 0;
  for (const i of items) {
    const mxn = toMxn(Number(i.price) || 0, i.currency, rate);
    if (mxn === null) missingRate = true;
    else original += mxn;
  }
  original = round2(original);
  const pct = Math.min(100, Math.max(0, Number(percent) || 0));
  const final = round2(Math.max(0, Math.min(original, original * (1 - pct / 100))));
  const savings = round2(original - final);
  const usdOriginal = mxnToUsd(original, rate);
  return {
    original,
    percent: pct,
    savings,
    final,
    usd: usdOriginal === null ? null : { original: usdOriginal, savings: mxnToUsd(savings, rate)!, final: mxnToUsd(final, rate)! },
    missingRate,
  };
}
