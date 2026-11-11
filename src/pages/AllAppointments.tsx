import { ArrowDownUp, Check, ClipboardList, Download, FileSpreadsheet, FileText, ListChecks, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatMoney, PAYMENT_LABELS, PLATFORM_LABELS, STATUS_LABELS, STATUS_ORDER } from '../../shared/domain';
import { addDaysYmd, dayRangeUtc } from '../../shared/time';
import type { Appointment, PaymentStatus, Platform } from '../../shared/types';
import { AppointmentCard } from '../components/AppointmentCard';
import { Page, PageHeader } from '../components/Layout';
import { Button, Chip, EmptyState, ErrorBox, Field, IconButton, Input, LoadingBlock, SearchInput, Select, Sheet } from '../components/ui';
import { get, qs } from '../lib/api';
import { downloadCsv, downloadPdf, downloadXlsx } from '../lib/exportAppointments';
import { useAppointments, useServices, type AppointmentFilters, type ListResult } from '../lib/hooks';
import { useFmt, useSettings } from '../lib/settings';

type Period = 'all' | 'upcoming' | 'past' | 'today' | 'week' | 'month' | 'custom';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'upcoming', label: 'Próximas' },
  { value: 'today', label: 'Hoy' },
  { value: 'week', label: 'Próximos 7 días' },
  { value: 'month', label: 'Este mes' },
  { value: 'past', label: 'Pasadas' },
  { value: 'custom', label: 'Rango' },
];

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function AllAppointmentsPage() {
  const fmt = useFmt();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const dq = useDebounced(q);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [limit, setLimit] = useState(50);
  const { data: services = [] } = useServices();
  const settings = useSettings();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Map<number, Appointment>>(new Map());
  const [exportOpen, setExportOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [exportError, setExportError] = useState('');

  const status = params.get('status') ?? '';
  const payment = params.get('payment') ?? '';
  const platform = params.get('platform') ?? '';
  const serviceId = params.get('service') ?? '';
  const period = (params.get('period') as Period) ?? 'all';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const order = (params.get('order') as 'asc' | 'desc') ?? (period === 'upcoming' || period === 'week' || period === 'today' ? 'asc' : 'desc');

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
    setLimit(50);
  };

  const filters: AppointmentFilters = useMemo(() => {
    const f: AppointmentFilters = { q: dq || undefined, status: status || undefined, payment: payment || undefined, platform: platform || undefined, order, limit };
    if (serviceId) f.service_id = Number(serviceId);
    const today = fmt.today();
    const now = new Date().toISOString();
    if (period === 'upcoming') f.from = now;
    if (period === 'past') f.to = now;
    if (period === 'today') {
      const r = dayRangeUtc(today, fmt.tz);
      f.from = r.start.toISOString();
      f.to = r.end.toISOString();
    }
    if (period === 'week') {
      f.from = now;
      f.to = dayRangeUtc(addDaysYmd(today, 7), fmt.tz).end.toISOString();
    }
    if (period === 'month') {
      f.from = fmt.toUtc(`${today.slice(0, 7)}-01`, '00:00').toISOString();
      const [y, m] = today.split('-').map(Number);
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
      f.to = fmt.toUtc(next, '00:00').toISOString();
    }
    if (period === 'custom') {
      if (from) f.from = dayRangeUtc(from, fmt.tz).start.toISOString();
      if (to) f.to = dayRangeUtc(to, fmt.tz).end.toISOString();
    }
    return f;
  }, [dq, status, payment, platform, serviceId, period, from, to, order, limit, fmt.tz]);

  const { data, isLoading, isFetching, error } = useAppointments(filters);
  const items = data?.items ?? [];
  const statusSet = new Set(status.split(',').filter(Boolean));
  const activeFilters = [status, payment, platform, serviceId].filter(Boolean).length;

  const toggleStatus = (s: string) => {
    const next = new Set(statusSet);
    next.has(s) ? next.delete(s) : next.add(s);
    setParam('status', [...next].join(','));
  };

  const toggle = (a: Appointment) =>
    setPicked((m) => {
      const n = new Map(m);
      n.has(a.id) ? n.delete(a.id) : n.set(a.id, a);
      return n;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Map());
  };
  const [selectingAll, setSelectingAll] = useState(false);
  /** Selecciona todas las citas que coinciden con la búsqueda y filtros actuales (hasta 500). */
  const selectAllMatching = async () => {
    setSelectingAll(true);
    try {
      const r = await get<ListResult<Appointment>>(`/appointments${qs({ ...filters, limit: 500, offset: 0 } as unknown as Record<string, string>)}`);
      setPicked((m) => {
        const n = new Map(m);
        r.items.forEach((a) => n.set(a.id, a));
        return n;
      });
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setSelectingAll(false);
    }
  };
  const chosen = [...picked.values()].sort((a, b) => a.start_at.localeCompare(b.start_at));
  const runExport = async (kind: 'xlsx' | 'pdf' | 'csv') => {
    setBusy(kind);
    setExportError('');
    try {
      if (kind === 'xlsx') downloadXlsx(chosen, fmt);
      else if (kind === 'csv') downloadCsv(chosen, fmt);
      else await downloadPdf(chosen, fmt, settings.business_name);
      setExportOpen(false);
    } catch (e) {
      setExportError((e as Error).message || 'No se pudo generar el archivo.');
    } finally {
      setBusy(null);
    }
  };

  const totals = items.reduce<Record<string, { total: number; balance: number }>>((acc, a) => {
    if (a.status === 'cancelled' || a.status === 'no_show') return acc;
    acc[a.currency] ??= { total: 0, balance: 0 };
    acc[a.currency].total += a.final_price;
    acc[a.currency].balance += a.balance;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Todas las citas"
        subtitle={data ? `${data.total} cita(s)` : undefined}
        actions={
          <>
            <IconButton label={order === 'asc' ? 'Más antiguas primero' : 'Más recientes primero'} onClick={() => setParam('order', order === 'asc' ? 'desc' : 'asc')}>
              <ArrowDownUp className="size-5" />
            </IconButton>
            <IconButton label={selecting ? 'Salir de seleccionar' : 'Seleccionar citas para descargar'} onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
              {selecting ? <X className="size-5" /> : <ListChecks className="size-5" />}
            </IconButton>
          </>
        }
      >
        <div className="flex gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Buscar cliente, servicio, nota, teléfono…" className="flex-1" />
          <Button variant="secondary" onClick={() => setFiltersOpen(true)} icon={<SlidersHorizontal className="size-4" />}>
            {activeFilters ? `Filtros (${activeFilters})` : 'Filtros'}
          </Button>
        </div>
        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
          {PERIODS.map((p) => (
            <Chip key={p.value} active={period === p.value} onClick={() => setParam('period', p.value === 'all' ? '' : p.value)}>
              {p.label}
            </Chip>
          ))}
        </div>
        {period === 'custom' && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Input type="date" value={from} onChange={(e) => setParam('from', e.target.value)} aria-label="Desde" />
            <Input type="date" value={to} onChange={(e) => setParam('to', e.target.value)} aria-label="Hasta" />
          </div>
        )}
      </PageHeader>
      <Page>
        <ErrorBox error={error} />
        {Object.keys(totals).length > 0 && (
          <p className="mb-3 text-xs font-semibold text-plum-500">
            En esta vista: {Object.entries(totals).map(([c, t]) => `${formatMoney(t.total, c)} (por cobrar ${formatMoney(t.balance, c)})`).join(' · ')}
          </p>
        )}
        {selecting && (
          <p className="mb-3 rounded-2xl bg-lavender-50 px-4 py-2 text-sm text-plum-600">
            Toca las citas que quieres descargar. La selección se conserva aunque cambies de filtros.
          </p>
        )}
        {isLoading ? (
          <LoadingBlock />
        ) : items.length ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              {items.map((a) => (
                <div key={a.id} className="relative">
                  <AppointmentCard appt={a} />
                  {selecting && (
                    <button
                      type="button"
                      onClick={() => toggle(a)}
                      aria-pressed={picked.has(a.id)}
                      aria-label={`${picked.has(a.id) ? 'Quitar' : 'Elegir'} cita de ${a.client_name}`}
                      className={`absolute inset-0 z-10 rounded-3xl ${picked.has(a.id) ? 'bg-rose-500/10 ring-2 ring-rose-400' : 'bg-white/20'}`}
                    >
                      <span className={`absolute -top-2 -left-2 flex size-7 shadow-soft items-center justify-center rounded-full border-2 ${picked.has(a.id) ? 'border-rose-500 bg-rose-500 text-white' : 'border-plum-300 bg-white'}`}>
                        {picked.has(a.id) && <Check className="size-4" />}
                      </span>
                    </button>
                  )}
                </div>
              ))}
            </div>
            {data && data.total > items.length && (
              <Button variant="secondary" className="mt-5 w-full" loading={isFetching} onClick={() => setLimit((l) => l + 50)}>
                Cargar más ({data.total - items.length} restantes)
              </Button>
            )}
          </>
        ) : (
          <div className="card">
            <EmptyState icon={<ClipboardList className="size-7" />} title="Sin resultados">
              No hay citas que coincidan con tu búsqueda o filtros.
            </EmptyState>
          </div>
        )}
      </Page>

      {selecting && (
        <div className="fixed inset-x-0 bottom-24 z-30 px-4 lg:bottom-6 lg:left-72">
          <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-2 rounded-3xl bg-plum-800 p-3 text-white shadow-glow">
            <span className="flex-1 pl-2 text-sm font-extrabold">{picked.size} seleccionada(s)</span>
            <Button size="sm" variant="secondary" loading={selectingAll} onClick={selectAllMatching}>
              Todas ({data?.total ?? 0})
            </Button>
            {picked.size > 0 && (
              <Button size="sm" variant="secondary" onClick={() => setPicked(new Map())}>
                Ninguna
              </Button>
            )}
            <Button size="sm" icon={<Download className="size-4" />} disabled={!picked.size} onClick={() => setExportOpen(true)}>
              Descargar
            </Button>
          </div>
        </div>
      )}

      <Sheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title={`Descargar ${picked.size} cita(s)`}
        footer={
          <Button variant="secondary" className="w-full" onClick={() => setExportOpen(false)}>
            Cancelar
          </Button>
        }
      >
        <div className="space-y-3">
          {([
            ['xlsx', 'Excel (editable)', 'Archivo .xlsx para editar, filtrar y sumar los importes.', <FileSpreadsheet key="x" className="size-6" />],
            ['pdf', 'PDF', 'Documento listo para ver o imprimir, con totales.', <FileText key="p" className="size-6" />],
            ['csv', 'CSV', 'Texto simple para importar en otras herramientas.', <Download key="c" className="size-6" />],
          ] as const).map(([k, title, desc, icon]) => (
            <button
              key={k}
              type="button"
              disabled={!!busy}
              onClick={() => runExport(k)}
              className="flex w-full items-center gap-3 rounded-2xl border border-lavender-200 bg-white p-4 text-left active:bg-lavender-50 disabled:opacity-60"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl gradient-soft text-plum-600">{icon}</span>
              <span className="flex-1">
                <span className="block font-extrabold text-plum-800">{busy === k ? 'Generando…' : title}</span>
                <span className="text-xs text-plum-500">{desc}</span>
              </span>
            </button>
          ))}
          {exportError && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-600">{exportError}</p>}
        </div>
      </Sheet>

      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filtrar citas"
        footer={
          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                const p = new URLSearchParams(params);
                ['status', 'payment', 'platform', 'service'].forEach((k) => p.delete(k));
                setParams(p, { replace: true });
              }}
            >
              Limpiar
            </Button>
            <Button className="flex-1" onClick={() => setFiltersOpen(false)}>
              Ver resultados
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <Field label="Estado de la cita">
            <div className="flex flex-wrap gap-2">
              {STATUS_ORDER.map((s) => (
                <Chip key={s} active={statusSet.has(s)} onClick={() => toggleStatus(s)}>
                  {STATUS_LABELS[s]}
                </Chip>
              ))}
            </div>
          </Field>
          <Field label="Estado de pago">
            <div className="flex flex-wrap gap-2">
              <Chip active={!payment} onClick={() => setParam('payment', '')}>
                Todos
              </Chip>
              {(['unpaid', 'partial', 'paid'] as PaymentStatus[]).map((p) => (
                <Chip key={p} active={payment === p} onClick={() => setParam('payment', p)}>
                  {PAYMENT_LABELS[p]}
                </Chip>
              ))}
              <Chip active={payment === 'owing'} onClick={() => setParam('payment', 'owing')}>
                Con saldo pendiente
              </Chip>
            </div>
          </Field>
          <Field label="Plataforma">
            <Select value={platform} onChange={(e) => setParam('platform', e.target.value)}>
              <option value="">Todas</option>
              {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Servicio">
            <Select value={serviceId} onChange={(e) => setParam('service', e.target.value)}>
              <option value="">Todos</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Sheet>
    </>
  );
}
