import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { formatDuration, parseIntentions } from '../../shared/domain';
import type { Currency, Service } from '../../shared/types';
import { useFeedback } from '../components/feedback';
import { Page, PageHeader } from '../components/Layout';
import { Money } from '../components/Money';
import { Button, Chip, cx, EmptyState, ErrorBox, Field, IconButton, Input, LoadingBlock, SearchInput, Select, Sheet, Textarea, Toggle } from '../components/ui';
import { del, post, put } from '../lib/api';
import { useServices } from '../lib/hooks';
import { useSettings } from '../lib/settings';

export function ServicesPage() {
  const { data = [], isLoading, error } = useServices();
  const [editing, setEditing] = useState<Partial<Service> | null>(null);
  const [viewing, setViewing] = useState<Service | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const categories = [...new Set(data.map((s) => s.category))].sort((a, b) => a.localeCompare(b, 'es'));
  const list = data.filter(
    (s) => (!cat || s.category === cat) && `${s.name} ${s.category} ${s.description ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const grouped = list.reduce<Record<string, typeof list>>((acc, s) => ((acc[s.category] ??= []).push(s), acc), {});

  return (
    <>
      <PageHeader
        title="Servicios"
        subtitle={`${data.filter((s) => s.active).length} activos`}
        actions={
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing({})}>
            Nuevo
          </Button>
        }
      >
        <SearchInput value={q} onChange={setQ} placeholder="Buscar servicio…" />
        {categories.length > 1 && (
          <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
            <Chip active={!cat} onClick={() => setCat('')}>
              Todas
            </Chip>
            {categories.map((c) => (
              <Chip key={c} active={cat === c} onClick={() => setCat(c)}>
                {c}
              </Chip>
            ))}
          </div>
        )}
      </PageHeader>
      <Page>
        <ErrorBox error={error} />
        {isLoading ? (
          <LoadingBlock />
        ) : list.length ? (
          <div className="space-y-6">
            {Object.entries(grouped).map(([category, items]) => (
              <section key={category}>
                <p className="mb-2 text-xs font-extrabold tracking-wider text-gold-600 uppercase">{category}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {items.map((s) => (
                    <div key={s.id} className={cx('card flex items-start gap-3 p-4', !s.active && 'opacity-60')}>
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl gradient-soft text-plum-600">
                        <Sparkles className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-extrabold text-plum-800">
                          {s.name} {!s.active && <span className="text-xs font-bold text-plum-400">(inactivo)</span>}
                        </p>
                        <Money amount={s.price} currency={s.currency} className="text-sm font-bold text-rose-600" />
                        {s.duration_min ? (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-plum-500">
                            <Clock className="size-3.5" /> {formatDuration(s.duration_min)}
                          </p>
                        ) : null}
                        {s.description && (
                          <button type="button" onClick={() => setViewing(s)} className="mt-1 block w-full text-left">
                            <span className="line-clamp-2 text-xs whitespace-pre-line text-plum-500">{s.description}</span>
                            <span className="text-[11px] font-bold text-rose-500">Ver descripción completa</span>
                          </button>
                        )}
                        <p className="mt-1 text-[11px] text-plum-400">Usado en {s.usage_count} cita(s)</p>
                      </div>
                      <IconButton label="Editar" onClick={() => setEditing(s)}>
                        <Pencil className="size-4" />
                      </IconButton>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="card">
            <EmptyState icon={<Sparkles className="size-7" />} title={data.length ? 'Sin coincidencias' : 'Agrega tu primer servicio'}>
              {data.length ? 'Prueba con otra búsqueda.' : 'Registra tus lecturas de tarot, cartas astrales, rituales y demás servicios con su precio y duración.'}
            </EmptyState>
          </div>
        )}
      </Page>
      {viewing && <ServiceDetail service={viewing} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null); }} />}
      {editing && <ServiceSheet service={editing} categories={categories} onClose={() => setEditing(null)} />}
    </>
  );
}

function ServiceDetail({ service: s, onClose, onEdit }: { service: Service; onClose: () => void; onEdit: () => void }) {
  const intentions = parseIntentions(s.intentions);
  return (
    <Sheet
      open
      onClose={onClose}
      title={s.name}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cerrar
          </Button>
          <Button className="flex-1" icon={<Pencil className="size-4" />} onClick={onEdit}>
            Editar
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-xs font-extrabold tracking-wider text-gold-600 uppercase">{s.category}</p>
        <Money amount={s.price} currency={s.currency} className="text-lg font-extrabold text-rose-600" />
        {s.duration_min ? <p className="text-sm text-plum-500">Duración: {formatDuration(s.duration_min)}</p> : null}
        {s.description ? <p className="text-sm whitespace-pre-line text-plum-700">{s.description}</p> : <p className="text-sm text-plum-400">Sin descripción.</p>}
        {intentions.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-bold text-plum-500">Intenciones al agendar</p>
            <div className="flex flex-wrap gap-2">
              {intentions.map((i) => (
                <span key={i} className="rounded-full bg-plum-50 px-3 py-1 text-xs font-bold text-plum-600">{i}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function ServiceSheet({ service, categories, onClose }: { service: Partial<Service>; categories: string[]; onClose: () => void }) {
  const settings = useSettings();
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const [form, setForm] = useState({
    name: service.name ?? '',
    category: service.category ?? categories[0] ?? 'Tarot',
    description: service.description ?? '',
    price: service.price !== undefined ? String(service.price) : '',
    currency: (service.currency ?? settings.default_currency) as Currency,
    duration_min: service.duration_min ? String(service.duration_min) : '',
    intentions: parseIntentions(service.intentions).join(', '),
    active: service.active === undefined ? true : !!service.active,
  });
  const done = (msg: string) => {
    qc.invalidateQueries({ queryKey: ['services'] });
    qc.invalidateQueries({ queryKey: ['promotions'] });
    toast(msg);
    onClose();
  };
  const m = useMutation({
    mutationFn: () => {
      const body = { ...form, intentions: form.intentions.split(',').map((x) => x.trim()).filter(Boolean), price: Number(form.price) || 0, duration_min: form.duration_min ? Number(form.duration_min) : null };
      return service.id ? put(`/services/${service.id}`, body) : post('/services', body);
    },
    onSuccess: () => done(service.id ? 'Servicio actualizado' : 'Servicio agregado'),
  });
  const remove = async () => {
    const ok = await confirm({
      title: 'Eliminar servicio',
      message: 'Las citas que ya lo usan conservarán su información. Si solo ya no lo ofreces, puedes desactivarlo.',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (ok) {
      await del(`/services/${service.id}`);
      done('Servicio eliminado');
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={service.id ? 'Editar servicio' : 'Nuevo servicio'}
      footer={
        <div className="flex gap-3">
          {service.id && (
            <IconButton label="Eliminar servicio" className="text-rose-500" onClick={remove}>
              <Trash2 className="size-5" />
            </IconButton>
          )}
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button className="flex-1" loading={m.isPending} disabled={!form.name.trim()} onClick={() => m.mutate()}>
            Guardar
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Nombre del servicio" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Lectura de tarot general" autoFocus />
        </Field>
        <Field label="Categoría" hint="Escribe una nueva o elige una existente.">
          <Input list="service-categories" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Tarot, Astrología, Rituales…" />
          <datalist id="service-categories">
            {[...new Set([...categories, 'Tarot', 'Astrología', 'Rituales', 'Limpiezas energéticas', 'Paquetes'])].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Precio" required>
            <Input type="number" inputMode="decimal" min={0} step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </Field>
          <Field label="Moneda">
            <Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as Currency })}>
              <option value="MXN">MXN</option>
              <option value="USD">USD</option>
            </Select>
          </Field>
        </div>
        <Field label="Duración estimada (minutos)" hint="Opcional. Se usa para calcular la hora de fin de la cita.">
          <Input type="number" inputMode="numeric" min={0} step={5} value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: e.target.value })} />
        </Field>
        <Field label="Descripción" hint="Opcional. Puede ser larga y con varias líneas; también ayuda al Generador de promociones a encontrar este servicio.">
          <Textarea rows={7} maxLength={5000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Qué incluye, para quién es, qué se trabaja…" />
        </Field>
        <Field label="Intenciones (opcional)" hint="Sepáralas con comas. Si las defines, al agendar este servicio se pedirá elegir una. Ej. Salud, Abundancia, Proyectos.">
          <Input value={form.intentions} onChange={(e) => setForm({ ...form, intentions: e.target.value })} placeholder="Salud, Abundancia, Proyectos…" />
        </Field>
        <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Servicio activo" description="Los servicios inactivos no aparecen al crear citas." />
        <ErrorBox error={m.error} />
      </div>
    </Sheet>
  );
}
