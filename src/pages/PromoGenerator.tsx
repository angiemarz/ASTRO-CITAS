import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Gift, Sparkles, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DISCOUNT_OPTIONS, formatMoney } from '../../shared/domain';
import { generateProposals, KEYWORD_IDEAS, previewPackage, type GeneratorResult, type Proposal } from '../../shared/promoGenerator';
import { useFeedback } from '../components/feedback';
import { Page, PageHeader } from '../components/Layout';
import { Money } from '../components/Money';
import { Button, Chip, cx, EmptyState, ErrorBox, Field, Input, LoadingBlock, Textarea, Toggle } from '../components/ui';
import { post } from '../lib/api';
import { usePromotions, useServices } from '../lib/hooks';
import { useSettings } from '../lib/settings';

export function PromoGeneratorPage() {
  const settings = useSettings();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { toast } = useFeedback();
  const { data: services = [], isLoading } = useServices();
  const { data: promotions = [] } = usePromotions();

  const [query, setQuery] = useState('');
  const [result, setResult] = useState<GeneratorResult | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', percent: 10, valid_from: '', valid_to: '', active: true, ids: [] as number[] });

  const catalog = useMemo(() => services.filter((s) => s.active), [services]);
  // Servicios que se pueden sumar a un paquete (no paquetes ya armados)
  const addable = useMemo(() => catalog.filter((s) => !/promoci/i.test(s.category)), [catalog]);
  const byId = (id: number) => services.find((s) => s.id === id);

  const generate = (text = query) => {
    const r = generateProposals(text, catalog);
    setResult(r);
    setPicked(null);
  };
  const addIdea = (idea: string) => {
    const next = query.trim() ? `${query.trim().replace(/[,;]\s*$/, '')}, ${idea}` : idea;
    setQuery(next);
  };
  const choose = (p: Proposal) => {
    setPicked(p.id);
    setForm((f) => ({ ...f, name: p.title, description: p.description, ids: [...p.serviceIds] }));
    setTimeout(() => document.getElementById('editor-paquete')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const toggleService = (id: number) => setForm((f) => ({ ...f, ids: f.ids.includes(id) ? f.ids.filter((x) => x !== id) : [...f.ids, id] }));

  const chosen = form.ids.map(byId).filter(Boolean) as NonNullable<ReturnType<typeof byId>>[];
  const preview = previewPackage(chosen, form.percent, settings.usd_rate);
  const sortedKey = [...form.ids].sort((a, b) => a - b).join(',');
  const twin = promotions.find((p) => p.active && p.requires_all && [...p.service_ids].sort((a, b) => a - b).join(',') === sortedKey && Number(p.value) === form.percent && p.promo_type === 'percent');
  const problem =
    !form.name.trim()
      ? 'Ponle un nombre al paquete.'
      : form.ids.length < 2
        ? 'Elige al menos dos servicios o rituales.'
        : form.percent <= 0
          ? 'Elige un descuento mayor a 0%.'
          : preview.missingRate
            ? 'Hay servicios en dólares y falta el tipo de cambio (Configuración) para sumarlos.'
            : form.valid_from && form.valid_to && form.valid_to < form.valid_from
              ? 'La fecha final no puede ser anterior a la inicial.'
              : twin
                ? `Ya existe una promoción activa igual: "${twin.name}".`
                : '';

  const save = useMutation({
    mutationFn: () =>
      post('/promotions', {
        name: form.name.trim(),
        description: form.description,
        promo_type: 'percent',
        value: form.percent,
        currency: settings.default_currency,
        valid_from: form.valid_from || null,
        valid_to: form.valid_to || null,
        conditions: null,
        stackable: 0,
        requires_all: 1,
        active: form.active ? 1 : 0,
        service_ids: form.ids,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['promotions'] });
      toast('Promoción creada. Ya aparece al agendar citas.');
      nav('/promociones');
    },
  });

  return (
    <>
      <PageHeader title="Generador de promociones" subtitle="Escribe lo que quieres trabajar y arma paquetes con tus servicios y rituales" />
      <Page>
        <div className="space-y-5">
          <div className="card space-y-3 p-4">
            <Field label="¿Qué intenciones o temas quieres promocionar?" hint="Sepáralos con comas. Ej. Amor propio, abundancia, desbloqueo energético.">
              <Textarea
                rows={2}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Amor propio, abundancia, desbloqueo energético"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate();
                }}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              {KEYWORD_IDEAS.map((k) => (
                <Chip key={k} onClick={() => addIdea(k)}>
                  + {k}
                </Chip>
              ))}
            </div>
            <Button icon={<Wand2 className="size-4" />} disabled={!query.trim() || isLoading} onClick={() => generate()}>
              Generar propuestas
            </Button>
            <p className="text-[11px] text-plum-400">
              Funciona con las palabras de los nombres, categorías y descripciones de tus servicios y rituales (no usa servicios de pago). Mientras más completas estén tus descripciones, mejores propuestas.
            </p>
          </div>

          {isLoading && <LoadingBlock />}

          {result && (
            <section className="space-y-3">
              {result.unmatched.length > 0 && (
                <p className="rounded-2xl bg-gold-300/30 px-4 py-2 text-sm text-plum-700">
                  No encontré servicios relacionados con: <b>{result.unmatched.join(', ')}</b>. Prueba con otras palabras o completa las descripciones de tus servicios.
                </p>
              )}
              {result.proposals.length ? (
                <>
                  <p className="text-xs font-extrabold tracking-wider text-gold-600 uppercase">Propuestas ({result.proposals.length})</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {result.proposals.map((p) => {
                      const items = p.serviceIds.map(byId).filter(Boolean) as NonNullable<ReturnType<typeof byId>>[];
                      const pv = previewPackage(items, 0, settings.usd_rate);
                      const on = picked === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => choose(p)}
                          className={cx('card p-4 text-left transition', on ? 'ring-2 ring-rose-400' : 'hover:shadow-soft')}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-[11px] font-extrabold tracking-wider text-gold-600 uppercase">{p.label}</p>
                              <p className="font-extrabold text-plum-800">{p.title}</p>
                            </div>
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">{p.relevance}% afín</span>
                          </div>
                          <ul className="mt-2 space-y-1">
                            {items.map((s) => (
                              <li key={s.id} className="text-sm text-plum-700">
                                <span className="font-bold">{s.name}</span> <span className="text-plum-400">· {formatMoney(s.price, s.currency)}</span>
                                {p.matches[s.id]?.length ? <span className="block text-[11px] text-plum-400">Por: {p.matches[s.id].join(', ')}</span> : null}
                              </li>
                            ))}
                          </ul>
                          <p className="mt-2 text-sm font-bold text-rose-600">Precio normal: {formatMoney(pv.original, 'MXN')}</p>
                          <p className="mt-1 flex items-center gap-1 text-xs font-bold text-plum-500">
                            {on ? <><Check className="size-4 text-emerald-600" /> Elegida: edítala abajo</> : 'Toca para elegirla y editarla'}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="card">
                  <EmptyState icon={<Sparkles className="size-7" />} title="Sin propuestas">
                    No hay suficientes servicios o rituales relacionados. También puedes armar el paquete a mano abajo.
                  </EmptyState>
                </div>
              )}
              {!picked && (
                <Button variant="secondary" onClick={() => setPicked('manual')}>
                  Armar un paquete a mano
                </Button>
              )}
            </section>
          )}

          {picked && (
            <section id="editor-paquete" className="card space-y-4 p-4">
              <p className="flex items-center gap-2 font-extrabold text-plum-800">
                <Gift className="size-5 text-rose-500" /> Tu promoción
              </p>
              <Field label="Nombre de la promoción" required>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Servicios y rituales incluidos" hint="Quita o agrega. El precio original es la suma de todos.">
                <div className="flex flex-wrap gap-2">
                  {addable.map((s) => (
                    <Chip key={s.id} active={form.ids.includes(s.id)} onClick={() => toggleService(s.id)}>
                      {s.name}
                    </Chip>
                  ))}
                </div>
              </Field>
              <Field label="Descuento">
                <div className="flex flex-wrap gap-2">
                  {DISCOUNT_OPTIONS.map((d) => (
                    <Chip key={d} active={form.percent === d} onClick={() => setForm({ ...form, percent: d })}>
                      {d}%
                    </Chip>
                  ))}
                </div>
              </Field>
              <Field label="Descripción promocional" hint="Sugerida automáticamente; edítala como quieras.">
                <Textarea rows={8} maxLength={5000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Vigente desde">
                  <Input type="date" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} />
                </Field>
                <Field label="Vigente hasta">
                  <Input type="date" value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} />
                </Field>
              </div>
              <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Activa" description="Si la dejas inactiva, no aparece al agendar hasta que la actives." />

              <div className="rounded-2xl bg-gradient-to-br from-lavender-50 to-blush-50 p-4">
                <p className="mb-2 text-xs font-extrabold tracking-wider text-gold-600 uppercase">Vista previa</p>
                <ul className="space-y-1 text-sm text-plum-700">
                  {chosen.map((s) => (
                    <li key={s.id} className="flex justify-between gap-3">
                      <span>{s.name}</span>
                      <span className="text-plum-500">{formatMoney(s.price, s.currency)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 space-y-1 border-t border-lavender-200 pt-3 text-sm">
                  <div className="flex justify-between text-plum-600">
                    <span>Precio original</span>
                    <Money amount={preview.original} className="font-bold" inline />
                  </div>
                  <div className="flex justify-between text-plum-600">
                    <span>Descuento ({preview.percent}%)</span>
                    <span className="font-bold text-emerald-700">− {formatMoney(preview.savings, 'MXN')}</span>
                  </div>
                  <div className="flex items-start justify-between pt-1 text-base">
                    <span className="font-extrabold text-plum-800">Precio final</span>
                    <Money amount={preview.final} className="text-lg font-extrabold text-rose-600" usdClassName="text-right" />
                  </div>
                  {preview.usd && (
                    <p className="text-right text-[11px] text-plum-400">
                      Ahorro ≈ ${preview.usd.savings.toFixed(2)} USD · tipo de cambio {settings.usd_rate}
                    </p>
                  )}
                </div>
              </div>

              {problem && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-600">{problem}</p>}
              <ErrorBox error={save.error} />
              <Button loading={save.isPending} disabled={!!problem} onClick={() => save.mutate()}>
                Guardar promoción
              </Button>
            </section>
          )}
        </div>
      </Page>
    </>
  );
}
