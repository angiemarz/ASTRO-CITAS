import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Gift, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { describePromo, isPromotionValidOn, PROMO_TYPE_LABELS } from '../../shared/domain';
import type { Currency, Promotion, PromoType } from '../../shared/types';
import { useFeedback } from '../components/feedback';
import { Page, PageHeader } from '../components/Layout';
import { Button, Chip, cx, EmptyState, ErrorBox, Field, IconButton, Input, LoadingBlock, Segmented, Select, Sheet, Textarea, Toggle } from '../components/ui';
import { del, post, put } from '../lib/api';
import { usePromotions, useServices } from '../lib/hooks';
import { useFmt, useSettings } from '../lib/settings';

type Filter = 'current' | 'all' | 'expired';

export function PromotionsPage() {
  const { data = [], isLoading, error } = usePromotions();
  const { data: services = [] } = useServices();
  const fmt = useFmt();
  const today = fmt.today();
  const [filter, setFilter] = useState<Filter>('current');
  const [editing, setEditing] = useState<Partial<Promotion> | null>(null);

  const isCurrent = (p: Promotion) => isPromotionValidOn(p, today);
  const isExpired = (p: Promotion) => !!p.valid_to && p.valid_to < today;
  const list = data.filter((p) => (filter === 'current' ? isCurrent(p) : filter === 'expired' ? isExpired(p) || !p.active : true));
  const serviceName = (id: number) => services.find((s) => s.id === id)?.name ?? 'Servicio eliminado';

  return (
    <>
      <PageHeader
        title="Promociones"
        actions={
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing({})}>
            Nueva
          </Button>
        }
      >
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'current', label: 'Vigentes', count: data.filter(isCurrent).length },
            { value: 'all', label: 'Todas', count: data.length },
            { value: 'expired', label: 'Vencidas / inactivas' },
          ]}
        />
      </PageHeader>
      <Page>
        <ErrorBox error={error} />
        {isLoading ? (
          <LoadingBlock />
        ) : list.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {list.map((p) => {
              const current = isCurrent(p);
              return (
                <div key={p.id} className={cx('card relative overflow-hidden p-4', !current && 'opacity-70')}>
                  <div className="absolute -top-6 -right-6 size-20 rounded-full bg-gradient-to-br from-gold-300/60 to-blush-200/60 blur-xl" />
                  <div className="relative flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-plum-500 text-white">
                      <Gift className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-extrabold text-plum-800">{p.name}</p>
                      <p className="text-sm font-bold text-rose-600">{describePromo(p)}</p>
                      <p className="mt-1 text-xs text-plum-500">
                        {p.service_ids.length ? p.service_ids.map(serviceName).join(', ') : 'Aplica a cualquier servicio'}
                      </p>
                      <p className="mt-1 text-xs text-plum-500">
                        {p.valid_from || p.valid_to ? `Vigencia: ${p.valid_from ?? 'sin inicio'} → ${p.valid_to ?? 'sin fin'}` : 'Sin fecha de vencimiento'}
                      </p>
                      {p.conditions && <p className="mt-1 text-xs text-plum-500 italic">{p.conditions}</p>}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-bold', current ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500')}>
                          {current ? 'Vigente' : !p.active ? 'Inactiva' : 'Fuera de vigencia'}
                        </span>
                        {p.stackable ? <span className="rounded-full bg-gold-300/40 px-2 py-0.5 text-[11px] font-bold text-gold-600">Acumulable</span> : null}
                        <span className="rounded-full bg-lavender-100 px-2 py-0.5 text-[11px] font-bold text-plum-500">Usada {p.usage_count}×</span>
                      </div>
                    </div>
                    <IconButton label="Editar" onClick={() => setEditing(p)}>
                      <Pencil className="size-4" />
                    </IconButton>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card">
            <EmptyState icon={<Gift className="size-7" />} title="Sin promociones">
              Crea promociones con precio especial, porcentaje o monto de descuento, con vigencia y servicios específicos.
            </EmptyState>
          </div>
        )}
      </Page>
      {editing && <PromoSheet promo={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function PromoSheet({ promo, onClose }: { promo: Partial<Promotion>; onClose: () => void }) {
  const settings = useSettings();
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const { data: services = [] } = useServices();
  const [form, setForm] = useState({
    name: promo.name ?? '',
    description: promo.description ?? '',
    promo_type: (promo.promo_type ?? 'fixed_price') as PromoType,
    value: promo.value !== undefined ? String(promo.value) : '',
    currency: (promo.currency ?? settings.default_currency) as Currency,
    valid_from: promo.valid_from ?? '',
    valid_to: promo.valid_to ?? '',
    conditions: promo.conditions ?? '',
    stackable: !!promo.stackable,
    active: promo.active === undefined ? true : !!promo.active,
    service_ids: promo.service_ids ?? [],
  });
  const done = (msg: string) => {
    qc.invalidateQueries({ queryKey: ['promotions'] });
    toast(msg);
    onClose();
  };
  const m = useMutation({
    mutationFn: () => {
      const body = { ...form, value: Number(form.value) || 0, valid_from: form.valid_from || null, valid_to: form.valid_to || null };
      return promo.id ? put(`/promotions/${promo.id}`, body) : post('/promotions', body);
    },
    onSuccess: () => done(promo.id ? 'Promoción actualizada' : 'Promoción creada'),
  });
  const remove = async () => {
    if (await confirm({ title: 'Eliminar promoción', message: 'Las citas que ya la usaron conservan su descuento.', confirmLabel: 'Eliminar', danger: true })) {
      await del(`/promotions/${promo.id}`);
      done('Promoción eliminada');
    }
  };
  const toggleService = (id: number) =>
    setForm((f) => ({ ...f, service_ids: f.service_ids.includes(id) ? f.service_ids.filter((x) => x !== id) : [...f.service_ids, id] }));

  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title={promo.id ? 'Editar promoción' : 'Nueva promoción'}
      footer={
        <div className="flex gap-3">
          {promo.id && (
            <IconButton label="Eliminar promoción" className="text-rose-500" onClick={remove}>
              <Trash2 className="size-5" />
            </IconButton>
          )}
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button className="flex-1" loading={m.isPending} disabled={!form.name.trim() || form.value === ''} onClick={() => m.mutate()}>
            Guardar
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Nombre de la promoción" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Luna llena: tarot + carta astral" autoFocus />
        </Field>
        <Field label="Tipo de promoción">
          <Select value={form.promo_type} onChange={(e) => setForm({ ...form, promo_type: e.target.value as PromoType })}>
            {(Object.keys(PROMO_TYPE_LABELS) as PromoType[]).map((t) => (
              <option key={t} value={t}>
                {PROMO_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={form.promo_type === 'percent' ? 'Porcentaje (%)' : form.promo_type === 'amount' ? 'Monto de descuento' : 'Precio especial'}
            required
            hint={form.promo_type === 'fixed_price' ? 'Precio total de los servicios incluidos.' : undefined}
          >
            <Input type="number" inputMode="decimal" min={0} max={form.promo_type === 'percent' ? 100 : undefined} step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
          </Field>
          <Field label="Moneda">
            <Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as Currency })} disabled={form.promo_type === 'percent'}>
              <option value="MXN">MXN</option>
              <option value="USD">USD</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vigente desde">
            <Input type="date" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} />
          </Field>
          <Field label="Vigente hasta">
            <Input type="date" value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} />
          </Field>
        </div>
        <Field label="Servicios incluidos" hint="Si no eliges ninguno, la promoción aplica a cualquier servicio.">
          <div className="flex flex-wrap gap-2">
            {services.map((s) => (
              <Chip key={s.id} active={form.service_ids.includes(s.id)} onClick={() => toggleService(s.id)}>
                {s.name}
              </Chip>
            ))}
            {!services.length && <p className="text-sm text-plum-500">Primero agrega servicios.</p>}
          </div>
        </Field>
        <Field label="Condiciones">
          <Textarea rows={2} value={form.conditions} onChange={(e) => setForm({ ...form, conditions: e.target.value })} placeholder="Ej. Solo pago anticipado, una vez por cliente…" />
        </Field>
        <Field label="Descripción interna">
          <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Toggle checked={form.stackable} onChange={(v) => setForm({ ...form, stackable: v })} label="Acumulable" description="Permite combinarla con otras promociones acumulables en la misma cita." />
        <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Activa" />
        <ErrorBox error={m.error} />
      </div>
    </Sheet>
  );
}
