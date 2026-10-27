import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarDays,
  ExternalLink,
  Gift,
  Plus,
  Save,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
  User,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  clientContactFor,
  computePromo,
  contactLink,
  describePromo,
  formatDuration,
  formatMoney,
  PAYMENT_LABELS,
  paymentStatus,
  PLATFORM_FIELD,
  PLATFORM_LABELS,
  promoIsApplicable,
  round2,
  serviceToLine,
  STATUS_LABELS,
} from '../../shared/domain';
import type {
  Appointment,
  AppointmentInput,
  AppointmentPromotion,
  AppointmentService,
  AppointmentStatus,
  Client,
  Conflict,
  Currency,
  Platform,
  Promotion,
} from '../../shared/types';
import { conflictMessage } from '../components/ActionsProvider';
import { useFeedback } from '../components/feedback';
import { Page, PageHeader } from '../components/Layout';
import { PlatformIcon } from '../components/PlatformIcon';
import { TimePicker } from '../components/TimePicker';
import {
  Button,
  Card,
  Chip,
  cx,
  ErrorBox,
  Field,
  Input,
  LoadingBlock,
  PaymentBadge,
  Select,
  Textarea,
} from '../components/ui';
import { ApiError, get, qs } from '../lib/api';
import { useAppointment, useClients, usePromotions, useSaveAppointment, useServices } from '../lib/hooks';
import { useFmt, useSettings } from '../lib/settings';

const PLATFORMS: Platform[] = ['whatsapp', 'messenger', 'instagram', 'video', 'phone', 'other'];
const STATUSES: AppointmentStatus[] = ['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'];

interface ClientForm {
  id: number | null;
  full_name: string;
  phone: string;
  instagram: string;
  messenger: string;
  notes: string;
}

const emptyClient: ClientForm = { id: null, full_name: '', phone: '', instagram: '', messenger: '', notes: '' };

interface FormState {
  client: ClientForm;
  date: string;
  time: string;
  duration: number;
  durationTouched: boolean;
  useEndTime: boolean;
  services: AppointmentService[];
  agreedAmount: string; // importe acordado manual ('' = usar subtotal)
  hasPromo: boolean;
  promoIds: number[];
  storedPromos: AppointmentPromotion[]; // promociones guardadas cuya definición ya no existe
  manualSpecial: string; // precio especial manual ('' = no usar)
  platform: Platform;
  contact: string;
  contactTouched: boolean;
  currency: Currency;
  status: AppointmentStatus;
  notes: string;
  payAmount: string;
  payMethod: string;
  payDate: string;
}

export function AppointmentFormPage() {
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const { data: appt, isLoading } = useAppointment(editId);
  if (editId && isLoading) return <LoadingBlock />;
  if (editId && !appt) return <Page>No se encontró la cita.</Page>;
  return <AppointmentForm key={editId ?? 'new'} existing={appt ?? null} />;
}

function AppointmentForm({ existing }: { existing: Appointment | null }) {
  const settings = useSettings();
  const fmt = useFmt();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { toast, confirm } = useFeedback();
  const qc = useQueryClient();
  const save = useSaveAppointment();
  const { data: services = [] } = useServices();
  const { data: promotions = [] } = usePromotions();

  const initial = (): FormState => {
    if (existing) {
      const dur = Math.round((new Date(existing.end_at).getTime() - new Date(existing.start_at).getTime()) / 60000);
      const catalogPromoIds = existing.promotions.map((p) => p.promotion_id).filter((x): x is number => !!x);
      const subtotal = round2(existing.services.reduce((s, l) => s + l.price, 0));
      return {
        client: {
          id: existing.client_id,
          full_name: existing.client?.full_name ?? existing.client_name,
          phone: existing.client?.phone ?? '',
          instagram: existing.client?.instagram ?? '',
          messenger: existing.client?.messenger ?? '',
          notes: existing.client?.notes ?? '',
        },
        date: fmt.ymd(existing.start_at),
        time: fmt.hm(existing.start_at),
        duration: dur,
        durationTouched: true,
        useEndTime: false,
        services: existing.services.map(({ id: _id, ...s }) => s),
        agreedAmount: round2(existing.original_price) !== subtotal ? String(existing.original_price) : '',
        hasPromo: existing.promotions.length > 0 || (!!existing.manual_price && existing.discount > 0 && !existing.promotions.length),
        promoIds: catalogPromoIds,
        storedPromos: existing.promotions.filter((p) => !p.promotion_id),
        manualSpecial: existing.manual_price && !existing.promotions.length && existing.discount > 0 ? String(existing.final_price) : '',
        platform: existing.platform,
        contact: existing.contact_value ?? '',
        contactTouched: true,
        currency: existing.currency,
        status: existing.status,
        notes: existing.notes ?? '',
        payAmount: '',
        payMethod: settings.payment_methods[0] ?? 'Transferencia',
        payDate: fmt.today(),
      };
    }
    return {
      client: { ...emptyClient },
      date: params.get('date') || fmt.today(),
      time: params.get('time') || nextRoundTime(fmt.hm(new Date())),
      duration: settings.default_duration_min,
      durationTouched: false,
      useEndTime: false,
      services: [],
      agreedAmount: '',
      hasPromo: false,
      promoIds: [],
      storedPromos: [],
      manualSpecial: '',
      platform: 'whatsapp',
      contact: '',
      contactTouched: false,
      currency: settings.default_currency,
      status: 'scheduled',
      notes: '',
      payAmount: '',
      payMethod: settings.payment_methods[0] ?? 'Transferencia',
      payDate: fmt.today(),
    };
  };

  const [f, setF] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  // Precarga un cliente desde ?client=ID
  useEffect(() => {
    const cid = Number(params.get('client'));
    if (!existing && cid) {
      get<Client>(`/clients/${cid}`).then((c) => pickClient(c)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Cálculos ----------
  const subtotal = round2(f.services.reduce((s, l) => s + (Number(l.price) || 0), 0));
  const original = f.agreedAmount !== '' ? round2(Number(f.agreedAmount) || 0) : subtotal;
  const selectedServiceIds = f.services.map((s) => s.service_id).filter((x): x is number => !!x);

  const availablePromos = useMemo(
    () => promotions.filter((p) => promoIsApplicable(p, selectedServiceIds, f.date) || f.promoIds.includes(p.id)),
    [promotions, selectedServiceIds.join(','), f.date, f.promoIds.join(',')],
  );

  const appliedPromos: AppointmentPromotion[] = useMemo(() => {
    if (!f.hasPromo || f.manualSpecial !== '') return [];
    const fromCatalog = f.promoIds
      .map((pid) => promotions.find((p) => p.id === pid))
      .filter((p): p is Promotion & { usage_count: number } => !!p)
      .map((p) => {
        const r = computePromo(p, f.services);
        return { promotion_id: p.id, name: p.name, original_price: r.original, special_price: r.special, savings: r.savings };
      });
    return [...fromCatalog, ...f.storedPromos];
  }, [f.hasPromo, f.manualSpecial, f.promoIds, f.services, f.storedPromos, promotions]);

  let discount = 0;
  if (f.hasPromo && f.manualSpecial !== '') discount = Math.max(0, original - (Number(f.manualSpecial) || 0));
  else discount = Math.min(original, appliedPromos.reduce((s, p) => s + p.savings, 0));
  discount = round2(discount);
  const finalPrice = round2(Math.max(0, original - discount));
  const alreadyPaid = existing?.paid_total ?? 0;
  const newPay = round2(Number(f.payAmount) || 0);
  const balance = round2(Math.max(0, finalPrice - alreadyPaid - newPay));
  const payStatus = paymentStatus(finalPrice, alreadyPaid + newPay);

  // Duración automática con base en los servicios
  const servicesDuration = f.services.reduce((s, l) => s + (l.duration_min || 0), 0);
  useEffect(() => {
    if (!f.durationTouched && servicesDuration > 0) set('duration', servicesDuration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicesDuration, f.durationTouched]);

  const startUtc = useMemo(() => fmt.toUtc(f.date, f.time), [f.date, f.time, fmt.tz]);
  const endUtc = new Date(startUtc.getTime() + f.duration * 60000);
  const endHm = fmt.hm(endUtc);
  const endsNextDay = fmt.ymd(endUtc) !== f.date;

  // ---------- Detección de empalmes en vivo ----------
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  useEffect(() => {
    if (!f.date || !f.time || f.duration <= 0) return;
    const t = setTimeout(() => {
      get<Conflict[]>(
        `/appointments/conflicts${qs({ start: startUtc.toISOString(), end: endUtc.toISOString(), exclude: existing?.id })}`,
      )
        .then(setConflicts)
        .catch(() => setConflicts([]));
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startUtc.getTime(), f.duration, existing?.id]);

  // ---------- Cliente ----------
  const pickClient = (c: Client) => {
    setF((s) => ({
      ...s,
      client: {
        id: c.id,
        full_name: c.full_name,
        phone: c.phone ?? '',
        instagram: c.instagram ?? '',
        messenger: c.messenger ?? '',
        notes: c.notes ?? '',
      },
      contact: s.contactTouched && s.contact ? s.contact : clientContactFor(s.platform, c),
    }));
    setErrors((e) => ({ ...e, client: '' }));
  };

  const setClientField = (k: keyof ClientForm, v: string) =>
    setF((s) => {
      const client = { ...s.client, [k]: v };
      let contact = s.contact;
      if (!s.contactTouched) contact = clientContactFor(s.platform, client);
      return { ...s, client, contact };
    });

  const setPlatform = (p: Platform) =>
    setF((s) => ({ ...s, platform: p, contact: s.contactTouched && s.contact ? s.contact : clientContactFor(p, s.client) || '' }));

  // ---------- Guardar ----------
  const validate = () => {
    const e: Record<string, string> = {};
    if (!f.client.full_name.trim()) e.client = 'Escribe el nombre completo del cliente.';
    if (!f.date) e.date = 'Elige una fecha.';
    if (!f.time) e.time = 'Elige la hora de inicio.';
    if (!(f.duration > 0)) e.duration = 'La duración debe ser mayor a 0.';
    if (f.agreedAmount !== '' && !(Number(f.agreedAmount) >= 0)) e.price = 'Importe inválido.';
    if (newPay < 0) e.pay = 'Monto inválido.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const buildInput = (allowOverlap: boolean): AppointmentInput => ({
    client_id: f.client.id,
    client: {
      full_name: f.client.full_name.trim(),
      phone: f.client.phone.trim() || null,
      instagram: f.client.instagram.trim() || null,
      messenger: f.client.messenger.trim() || null,
      notes: f.client.notes.trim() || null,
    },
    start_at: startUtc.toISOString(),
    end_at: endUtc.toISOString(),
    timezone: settings.timezone,
    platform: f.platform,
    contact_value: f.contact.trim() || null,
    status: f.status,
    currency: f.currency,
    original_price: original,
    discount,
    final_price: finalPrice,
    manual_price: f.agreedAmount !== '' || (f.hasPromo && f.manualSpecial !== ''),
    notes: f.notes.trim() || null,
    services: f.services,
    promotions: appliedPromos,
    initial_payment:
      newPay > 0
        ? {
            amount: newPay,
            method: f.payMethod,
            paid_at: (f.payDate === fmt.today() ? new Date() : fmt.toUtc(f.payDate, '12:00')).toISOString(),
          }
        : null,
    allow_overlap: allowOverlap,
  });

  const submit = async (createAnother: boolean, allowOverlap = false): Promise<void> => {
    if (!validate()) {
      toast('Revisa los campos marcados', 'error');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (newPay > finalPrice - alreadyPaid + 0.004 && finalPrice > 0) {
      const ok = await confirm({
        title: 'Abono mayor al saldo',
        message: `El abono (${formatMoney(newPay, f.currency)}) supera el saldo pendiente. ¿Guardar de todos modos?`,
        confirmLabel: 'Guardar',
      });
      if (!ok) return;
    }
    try {
      const saved = await save.mutateAsync({ id: existing?.id, input: buildInput(allowOverlap) });
      qc.invalidateQueries({ queryKey: ['clients'] });
      toast(existing ? '💜 Cita actualizada' : `✨ Cita guardada: ${saved.client_name}, ${fmt.dateShort(saved.start_at)} ${fmt.time(saved.start_at)}`);
      if (saved.sync_warning) toast(saved.sync_warning, 'info');
      if (createAnother) {
        setF({ ...initial(), date: f.date, client: { ...emptyClient } });
        setErrors({});
        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (existing) navigate('/nueva');
      } else navigate(existing ? `/citas/${saved.id}` : '/', { replace: !!existing });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data.conflicts) {
        const ok = await confirm({
          title: 'Horario ocupado',
          message: conflictMessage(e.data.conflicts, fmt),
          confirmLabel: 'Guardar de todos modos',
          cancelLabel: 'Cambiar horario',
        });
        if (ok) return submit(createAnother, true);
      } else toast((e as Error).message, 'error');
    }
  };

  const link = contactLink(f.platform, f.contact);

  return (
    <>
      <PageHeader title={existing ? 'Editar cita' : 'Nueva cita'} subtitle={existing ? existing.client_name : 'Registra los datos de la consulta'} back />
      <Page>
        <form
          className="mx-auto max-w-2xl space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
        >
          {/* A. Cliente */}
          <FormSection icon={<User />} title="Datos del cliente">
            <ClientPicker client={f.client} onPick={pickClient} onChangeName={(v) => setClientField('full_name', v)} onClear={() => set('client', { ...emptyClient })} error={errors.client} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Teléfono">
                <Input type="tel" inputMode="tel" value={f.client.phone} onChange={(e) => setClientField('phone', e.target.value)} placeholder="+52 81 1234 5678" />
              </Field>
              <Field label="Instagram">
                <Input value={f.client.instagram} onChange={(e) => setClientField('instagram', e.target.value)} placeholder="@usuario" autoCapitalize="none" />
              </Field>
              <Field label="Messenger" className="sm:col-span-2">
                <Input value={f.client.messenger} onChange={(e) => setClientField('messenger', e.target.value)} placeholder="usuario o enlace" autoCapitalize="none" />
              </Field>
            </div>
            <Field label="Notas personales sobre el cliente" hint="Se guardan en su ficha de cliente.">
              <Textarea rows={2} value={f.client.notes} onChange={(e) => setClientField('notes', e.target.value)} />
            </Field>
          </FormSection>

          {/* B. Fecha y hora */}
          <FormSection icon={<CalendarDays />} title="Fecha y hora">
            <Field label="Fecha" required error={errors.date}>
              <Input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
            </Field>
            <Field label="Hora de inicio" required error={errors.time}>
              <TimePicker value={f.time} onChange={(v) => set('time', v)} />
            </Field>
            <div className="flex gap-2">
              <Chip active={!f.useEndTime} onClick={() => set('useEndTime', false)}>
                Duración
              </Chip>
              <Chip active={f.useEndTime} onClick={() => set('useEndTime', true)}>
                Hora de finalización
              </Chip>
            </div>
            {f.useEndTime ? (
              <Field label="Hora de finalización" hint={endsNextDay ? 'Termina al día siguiente.' : undefined}>
                <TimePicker
                  value={endHm}
                  onChange={(v) => {
                    let end = fmt.toUtc(f.date, v);
                    if (end <= startUtc) end = new Date(end.getTime() + 24 * 3600_000);
                    setF((s) => ({ ...s, duration: Math.round((end.getTime() - startUtc.getTime()) / 60000), durationTouched: true }));
                  }}
                />
              </Field>
            ) : (
              <Field
                label="Duración (minutos)"
                error={errors.duration}
                hint={servicesDuration && !f.durationTouched ? 'Calculada con la duración de los servicios.' : `Termina a las ${fmt.time(endUtc)}`}
              >
                <div className="flex flex-wrap gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={5}
                    step={5}
                    value={f.duration}
                    onChange={(e) => setF((s) => ({ ...s, duration: Number(e.target.value) || 0, durationTouched: true }))}
                    className="w-28"
                  />
                  {[30, 45, 60, 90, 120].map((m) => (
                    <Chip key={m} active={f.duration === m} onClick={() => setF((s) => ({ ...s, duration: m, durationTouched: true }))}>
                      {formatDuration(m)}
                    </Chip>
                  ))}
                </div>
              </Field>
            )}
            <p className="text-xs text-plum-400">Zona horaria: {settings.timezone}</p>
            {conflicts.length > 0 && (
              <div className="flex gap-3 rounded-2xl border border-gold-300 bg-gold-300/20 p-3.5 text-sm text-plum-700">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-gold-600" />
                <div>
                  <p className="font-bold">Este horario se empalma con:</p>
                  <ul className="mt-1 space-y-0.5">
                    {conflicts.map((c) => (
                      <li key={c.id}>
                        {c.client_name} · {fmt.range(c.start_at, c.end_at)}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-plum-500">Te pediremos confirmación al guardar.</p>
                </div>
              </div>
            )}
          </FormSection>

          {/* C. Servicios */}
          <FormSection icon={<Sparkles />} title="Servicios">
            <ServicePicker
              services={services.filter((s) => s.active)}
              selectedIds={selectedServiceIds}
              onAdd={(s) => {
                setF((st) => ({ ...st, services: [...st.services, serviceToLine(s)], currency: st.services.length ? st.currency : s.currency }));
              }}
            />
            {f.services.length > 0 && (
              <ul className="divide-y divide-lavender-100 overflow-hidden rounded-2xl border border-lavender-200 bg-white">
                {f.services.map((s, i) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-plum-800">{s.name}</p>
                      <p className="text-xs text-plum-500">
                        {s.category}
                        {s.duration_min ? ` · ${formatDuration(s.duration_min)}` : ''}
                      </p>
                    </div>
                    <span className="font-extrabold text-plum-700">{formatMoney(s.price, f.currency)}</span>
                    <button
                      type="button"
                      aria-label={`Quitar ${s.name}`}
                      onClick={() => set('services', f.services.filter((_, j) => j !== i))}
                      className="flex size-9 items-center justify-center rounded-full text-rose-500 active:bg-blush-50"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
                <li className="flex items-center justify-between bg-lavender-50 px-4 py-3">
                  <span className="font-bold text-plum-600">Subtotal</span>
                  <span className="font-extrabold text-plum-800">{formatMoney(subtotal, f.currency)}</span>
                </li>
              </ul>
            )}
            <Field
              label="Importe acordado (opcional)"
              hint="Modifica el precio solo para esta cita, sin cambiar tu catálogo."
              error={errors.price}
            >
              <div className="flex gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={f.agreedAmount}
                  placeholder={String(subtotal)}
                  onChange={(e) => set('agreedAmount', e.target.value)}
                />
                {f.agreedAmount !== '' && (
                  <Button type="button" variant="secondary" onClick={() => set('agreedAmount', '')}>
                    Quitar
                  </Button>
                )}
              </div>
            </Field>
          </FormSection>

          {/* D. Promociones */}
          <FormSection icon={<Gift />} title="Promociones">
            <p className="font-bold text-plum-700">¿Esta cita tiene promoción?</p>
            <div className="flex gap-2">
              <Chip active={f.hasPromo} onClick={() => set('hasPromo', true)}>
                Sí
              </Chip>
              <Chip active={!f.hasPromo} onClick={() => setF((s) => ({ ...s, hasPromo: false, promoIds: [], manualSpecial: '', storedPromos: [] }))}>
                No
              </Chip>
            </div>
            {f.hasPromo && (
              <PromoPicker
                promos={availablePromos}
                selected={f.promoIds}
                lines={f.services}
                currency={f.currency}
                manual={f.manualSpecial !== ''}
                onToggle={(p) => {
                  setF((s) => {
                    const isSel = s.promoIds.includes(p.id);
                    if (isSel) return { ...s, promoIds: s.promoIds.filter((x) => x !== p.id) };
                    // No acumula promociones salvo que todas permitan acumularse
                    const current = s.promoIds.map((pid) => promotions.find((x) => x.id === pid)).filter(Boolean) as Promotion[];
                    const canStack = p.stackable && current.every((c) => c.stackable);
                    return { ...s, manualSpecial: '', promoIds: canStack ? [...s.promoIds, p.id] : [p.id] };
                  });
                }}
                onManual={(on) => setF((s) => ({ ...s, manualSpecial: on ? String(finalPrice) : '', promoIds: on ? [] : s.promoIds, storedPromos: on ? [] : s.storedPromos }))}
                storedPromos={f.storedPromos}
              />
            )}
            {f.hasPromo && f.manualSpecial !== '' && (
              <Field label="Precio especial manual" hint="Solo para esta cita; no crea una promoción permanente.">
                <Input type="number" inputMode="decimal" min={0} step="0.01" value={f.manualSpecial} onChange={(e) => set('manualSpecial', e.target.value)} />
              </Field>
            )}
          </FormSection>

          {/* E. Plataforma */}
          <FormSection icon={<PlatformIcon platform={f.platform} />} title="Plataforma de atención">
            <div className="grid grid-cols-3 gap-2">
              {PLATFORMS.map((p) => (
                <button
                  type="button"
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={cx(
                    'flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border text-xs font-bold transition',
                    f.platform === p ? 'border-plum-600 bg-plum-600 text-white shadow-soft' : 'border-lavender-200 bg-white text-plum-600',
                  )}
                >
                  <PlatformIcon platform={p} className="size-5" />
                  {PLATFORM_LABELS[p]}
                </button>
              ))}
            </div>
            <Field label={PLATFORM_FIELD[f.platform].label}>
              <div className="flex gap-2">
                <Input
                  value={f.contact}
                  inputMode={PLATFORM_FIELD[f.platform].inputMode as 'tel' | undefined}
                  autoCapitalize="none"
                  onChange={(e) => setF((s) => ({ ...s, contact: e.target.value, contactTouched: true }))}
                  placeholder={PLATFORM_FIELD[f.platform].placeholder}
                />
                {link && (
                  <a
                    href={link}
                    target={link.startsWith('tel:') ? undefined : '_blank'}
                    rel="noopener noreferrer"
                    className="flex min-h-12 shrink-0 items-center gap-1.5 rounded-2xl bg-lavender-100 px-4 text-sm font-bold text-plum-700"
                  >
                    <ExternalLink className="size-4" /> Abrir
                  </a>
                )}
              </div>
            </Field>
          </FormSection>

          {/* F. Información económica */}
          <FormSection icon={<Wallet />} title="Información económica">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Moneda">
                <Select value={f.currency} onChange={(e) => set('currency', e.target.value as Currency)}>
                  <option value="MXN">MXN — Peso mexicano</option>
                  <option value="USD">USD — Dólar</option>
                </Select>
              </Field>
              <div className="flex items-end justify-end pb-2">
                <PaymentBadge status={payStatus} className="text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-gradient-to-br from-lavender-50 to-blush-50 p-4 text-center">
              <Money label="Precio original" value={formatMoney(original, f.currency)} />
              <Money label="Descuento" value={discount ? `− ${formatMoney(discount, f.currency)}` : formatMoney(0, f.currency)} tone="text-rose-600" />
              <Money label="Precio final" value={formatMoney(finalPrice, f.currency)} big />
            </div>
            {existing && existing.payments && existing.payments.length > 0 && (
              <p className="rounded-2xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800">
                Ya abonado: {formatMoney(alreadyPaid, f.currency)} en {existing.payments.length} pago(s). Puedes ver el historial en el detalle de la cita.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={existing ? 'Agregar abono' : 'Cantidad abonada'} error={errors.pay}>
                <Input type="number" inputMode="decimal" min={0} step="0.01" placeholder="0" value={f.payAmount} onChange={(e) => set('payAmount', e.target.value)} />
              </Field>
              <Field label="Método de pago">
                <Select value={f.payMethod} onChange={(e) => set('payMethod', e.target.value)}>
                  {settings.payment_methods.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Fecha de pago">
                <Input type="date" value={f.payDate} onChange={(e) => set('payDate', e.target.value)} />
              </Field>
            </div>
            {finalPrice > 0 && (
              <div className="flex flex-wrap gap-2">
                <Chip onClick={() => set('payAmount', String(round2(Math.max(0, finalPrice - alreadyPaid))))}>Pago completo</Chip>
                <Chip onClick={() => set('payAmount', String(round2(Math.max(0, (finalPrice - alreadyPaid) / 2))))}>50% anticipo</Chip>
                {f.payAmount && <Chip onClick={() => set('payAmount', '')}>Sin abono</Chip>}
              </div>
            )}
            <div className="flex items-center justify-between rounded-2xl border border-lavender-200 bg-white px-4 py-3">
              <span className="font-bold text-plum-600">Saldo pendiente</span>
              <span className={cx('text-lg font-extrabold', balance > 0 ? 'text-rose-600' : 'text-emerald-600')}>{formatMoney(balance, f.currency)}</span>
            </div>
            <p className="text-xs text-plum-400">Saldo = precio final − total abonado · Estado: {PAYMENT_LABELS[payStatus]}</p>
          </FormSection>

          {/* G. Estado */}
          <FormSection icon={<Sparkles />} title="Estado de la cita">
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <Chip key={s} active={f.status === s} onClick={() => set('status', s)}>
                  {STATUS_LABELS[s]}
                </Chip>
              ))}
            </div>
            <p className="text-xs text-plum-400">El estado de atención es independiente del estado de pago.</p>
          </FormSection>

          {/* H. Notas */}
          <FormSection icon={<StickyNote />} title="Notas personales">
            <Textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Observaciones privadas de esta cita…" />
          </FormSection>

          <ErrorBox error={save.error && !(save.error instanceof ApiError && save.error.status === 409) ? save.error : null} />

          {/* I. Guardar */}
          <div className="sticky bottom-[calc(var(--nav-h)+var(--safe-bottom)+0.5rem)] z-20 lg:bottom-4">
            <div className="card flex items-center gap-2 p-2.5">
              <Button type="button" variant="ghost" className="px-3" onClick={() => navigate(-1)}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="soft"
                className="px-4"
                disabled={save.isPending}
                onClick={() => submit(true)}
                icon={<Plus className="size-5" />}
                aria-label="Guardar y crear otra"
                title="Guardar y crear otra"
              >
                <span className="hidden sm:inline">Guardar y crear otra</span>
                <span className="sm:hidden">Otra</span>
              </Button>
              <Button type="submit" className="flex-1" loading={save.isPending} icon={<Save className="size-5" />}>
                Guardar cita
              </Button>
            </div>
          </div>
        </form>
      </Page>
    </>
  );
}

function nextRoundTime(hm: string) {
  const [h, m] = hm.split(':').map(Number);
  const total = Math.min(23 * 60 + 30, Math.ceil((h * 60 + m + 1) / 30) * 30);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function FormSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="space-y-4 p-5">
      <h2 className="flex items-center gap-2.5 font-display text-[1.4rem] font-bold text-plum-700">
        <span className="flex size-9 items-center justify-center rounded-xl gradient-soft text-plum-600 [&>svg]:size-[18px]">{icon}</span>
        {title}
      </h2>
      {children}
    </Card>
  );
}

function Money({ label, value, big, tone }: { label: string; value: string; big?: boolean; tone?: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-plum-500">{label}</p>
      <p className={cx('font-extrabold', big ? 'text-base text-plum-800' : 'text-sm text-plum-700', tone)}>{value}</p>
    </div>
  );
}

function ClientPicker({
  client,
  onPick,
  onChangeName,
  onClear,
  error,
}: {
  client: ClientForm;
  onPick: (c: Client) => void;
  onChangeName: (v: string) => void;
  onClear: () => void;
  error?: string;
}) {
  const [focused, setFocused] = useState(false);
  const term = client.id ? '' : client.full_name.trim();
  const { data: matches = [] } = useClients(term.length >= 1 ? term : '');
  const show = focused && !client.id && term.length >= 1;
  const exact = matches.some((m) => m.full_name.toLowerCase() === term.toLowerCase());
  const blurTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  if (client.id) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-lavender-300 bg-lavender-50 px-4 py-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-plum-500 to-rose-500 font-bold text-white">
          {client.full_name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-plum-500">Cliente registrado</p>
          <input
            className="w-full bg-transparent text-[17px] font-extrabold text-plum-800 outline-none"
            value={client.full_name}
            onChange={(e) => onChangeName(e.target.value)}
            aria-label="Nombre completo"
          />
        </div>
        <button type="button" onClick={onClear} className="flex size-9 items-center justify-center rounded-full text-plum-500 active:bg-lavender-100" aria-label="Cambiar cliente">
          <X className="size-5" />
        </button>
      </div>
    );
  }

  return (
    <Field label="Nombre completo" required error={error} hint={!show ? 'Escribe para buscar un cliente registrado o crear uno nuevo.' : undefined}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4.5 -translate-y-1/2 text-plum-400" />
        <Input
          value={client.full_name}
          onChange={(e) => onChangeName(e.target.value)}
          onFocus={() => {
            clearTimeout(blurTimer.current);
            setFocused(true);
          }}
          onBlur={() => (blurTimer.current = setTimeout(() => setFocused(false), 180))}
          placeholder="Nombre y apellido"
          autoComplete="off"
          className="pl-11"
        />
        {show && (
          <div className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-72 overflow-y-auto rounded-2xl border border-lavender-200 bg-white p-1.5 shadow-soft">
            {matches.slice(0, 8).map((c) => (
              <button
                type="button"
                key={c.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(c);
                  setFocused(false);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left active:bg-lavender-50 hover:bg-lavender-50"
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-lavender-100 text-sm font-bold text-plum-600">
                  {c.full_name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-plum-800">{c.full_name}</span>
                  <span className="block truncate text-xs text-plum-500">
                    {[c.phone, c.instagram && `@${c.instagram.replace(/^@/, '')}`].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                    {c.appointment_count ? ` · ${c.appointment_count} cita(s)` : ''}
                  </span>
                </span>
              </button>
            ))}
            {!exact && (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-rose-600">
                <UserPlus className="size-4" /> Nuevo cliente: “{term}” (se registrará al guardar)
              </div>
            )}
          </div>
        )}
      </div>
    </Field>
  );
}

function ServicePicker({
  services,
  selectedIds,
  onAdd,
}: {
  services: { id: number; name: string; category: string; price: number; currency: Currency; duration_min: number | null }[];
  selectedIds: number[];
  onAdd: (s: any) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const filtered = services.filter(
    (s) => !selectedIds.includes(s.id) && `${s.name} ${s.category}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const byCat = filtered.reduce<Record<string, typeof filtered>>((acc, s) => ((acc[s.category] ??= []).push(s), acc), {});

  if (!services.length) {
    return (
      <div className="rounded-2xl border border-dashed border-lavender-300 bg-lavender-50/60 p-4 text-sm text-plum-600">
        Aún no tienes servicios en tu catálogo.{' '}
        <button type="button" className="font-bold text-rose-600 underline" onClick={() => navigate('/servicios')}>
          Agregar servicios
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex min-h-12 w-full items-center gap-2 rounded-2xl border border-dashed border-lavender-300 bg-white px-4 font-bold text-plum-600 active:bg-lavender-50"
      >
        <Plus className="size-5" /> Agregar servicio
      </button>
      {open && (
        <div className="mt-2 rounded-2xl border border-lavender-200 bg-white p-2 shadow-soft">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-plum-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar servicio o categoría…" className="pl-10" autoFocus />
          </div>
          <div className="max-h-80 overflow-y-auto">
            {Object.entries(byCat).map(([cat, list]) => (
              <div key={cat} className="mb-1">
                <p className="px-3 pt-2 pb-1 text-[11px] font-extrabold tracking-wider text-gold-600 uppercase">{cat}</p>
                {list.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => {
                      onAdd(s);
                      setQ('');
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left active:bg-lavender-50 hover:bg-lavender-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-plum-800">{s.name}</span>
                      {s.duration_min ? <span className="text-xs text-plum-500">{formatDuration(s.duration_min)}</span> : null}
                    </span>
                    <span className="text-sm font-extrabold text-plum-700">{formatMoney(s.price, s.currency)}</span>
                    <Plus className="size-4 text-rose-500" />
                  </button>
                ))}
              </div>
            ))}
            {!filtered.length && <p className="px-3 py-4 text-center text-sm text-plum-500">No hay más servicios que coincidan.</p>}
          </div>
          <Button type="button" variant="ghost" size="sm" className="mt-1 w-full" onClick={() => setOpen(false)}>
            Listo
          </Button>
        </div>
      )}
    </div>
  );
}

function PromoPicker({
  promos,
  selected,
  lines,
  currency,
  manual,
  onToggle,
  onManual,
  storedPromos,
}: {
  promos: Promotion[];
  selected: number[];
  lines: AppointmentService[];
  currency: Currency;
  manual: boolean;
  onToggle: (p: Promotion) => void;
  onManual: (on: boolean) => void;
  storedPromos: AppointmentPromotion[];
}) {
  const [q, setQ] = useState('');
  const list = promos.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="space-y-3">
      {!lines.length && <p className="text-sm text-plum-500">Selecciona primero los servicios para ver sus promociones.</p>}
      {promos.length > 3 && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-plum-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar promoción…" className="pl-10" />
        </div>
      )}
      {lines.length > 0 && !promos.length && (
        <p className="rounded-2xl bg-lavender-50 px-4 py-3 text-sm text-plum-600">No hay promociones vigentes para estos servicios en esta fecha.</p>
      )}
      {storedPromos.map((p, i) => (
        <div key={`s${i}`} className="rounded-2xl border border-lavender-300 bg-lavender-50 p-3 text-sm">
          <p className="font-bold text-plum-700">{p.name} (guardada)</p>
          <p className="text-plum-500">Ahorro: {formatMoney(p.savings, currency)}</p>
        </div>
      ))}
      {list.map((p) => {
        const r = computePromo(p, lines);
        const sel = selected.includes(p.id);
        return (
          <button
            type="button"
            key={p.id}
            onClick={() => onToggle(p)}
            className={cx(
              'w-full rounded-2xl border p-4 text-left transition',
              sel ? 'border-rose-400 bg-blush-50 ring-2 ring-rose-200' : 'border-lavender-200 bg-white active:bg-lavender-50',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-extrabold text-plum-800">{p.name}</p>
                <p className="text-xs font-semibold text-plum-500">{describePromo(p)}</p>
              </div>
              <span className={cx('flex size-6 shrink-0 items-center justify-center rounded-full border-2', sel ? 'border-rose-500 bg-rose-500 text-white' : 'border-lavender-300')}>
                {sel && '✓'}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl bg-white/70 py-1.5">
                <p className="text-plum-400">Original</p>
                <p className="font-bold text-plum-600 line-through">{formatMoney(r.original, currency)}</p>
              </div>
              <div className="rounded-xl bg-white/70 py-1.5">
                <p className="text-plum-400">Especial</p>
                <p className="font-extrabold text-plum-800">{formatMoney(r.special, currency)}</p>
              </div>
              <div className="rounded-xl bg-white/70 py-1.5">
                <p className="text-plum-400">Ahorro</p>
                <p className="font-extrabold text-emerald-600">{formatMoney(r.savings, currency)}</p>
              </div>
            </div>
            {(p.valid_from || p.valid_to || p.conditions) && (
              <p className="mt-2 text-xs text-plum-500">
                {p.valid_from || p.valid_to ? `Vigencia: ${p.valid_from ?? '…'} al ${p.valid_to ?? '…'}. ` : ''}
                {p.conditions}
              </p>
            )}
            {p.stackable ? <p className="mt-1 text-[11px] font-bold text-gold-600">Acumulable con otras promociones acumulables</p> : null}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onManual(!manual)}
        className={cx(
          'w-full rounded-2xl border border-dashed p-3.5 text-left text-sm font-bold transition',
          manual ? 'border-rose-400 bg-blush-50 text-rose-700' : 'border-lavender-300 text-plum-600',
        )}
      >
        {manual ? '✓ Usando precio especial manual' : '+ Usar un precio especial manual (sin crear promoción)'}
      </button>
    </div>
  );
}
