import { ArrowDownUp, ClipboardList, Download, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatMoney, PAYMENT_LABELS, PLATFORM_LABELS, STATUS_LABELS, STATUS_ORDER } from '../../shared/domain';
import { addDaysYmd, dayRangeUtc } from '../../shared/time';
import type { Appointment, PaymentStatus, Platform } from '../../shared/types';
import { AppointmentCard } from '../components/AppointmentCard';
import { Page, PageHeader } from '../components/Layout';
import { Button, Chip, EmptyState, ErrorBox, Field, IconButton, Input, LoadingBlock, SearchInput, Select, Sheet } from '../components/ui';
import { useAppointments, useServices, type AppointmentFilters } from '../lib/hooks';
import { useFmt } from '../lib/settings';

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

  const exportCsv = () => {
    const header = ['Fecha', 'Hora inicio', 'Hora fin', 'Cliente', 'Servicios', 'Plataforma', 'Estado', 'Moneda', 'Precio final', 'Abonado', 'Saldo', 'Pago', 'Notas'];
    const rows = items.map((a: Appointment) => [
      fmt.ymd(a.start_at),
      fmt.time(a.start_at),
      fmt.time(a.end_at),
      a.client_name,
      a.services.map((s) => s.name).join(' + '),
      PLATFORM_LABELS[a.platform],
      STATUS_LABELS[a.status],
      a.currency,
      a.final_price,
      a.paid_total,
      a.balance,
      PAYMENT_LABELS[a.payment_status],
      a.notes ?? '',
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `citas-${fmt.today()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
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
            <IconButton label="Exportar CSV" onClick={exportCsv}>
              <Download className="size-5" />
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
        {isLoading ? (
          <LoadingBlock />
        ) : items.length ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              {items.map((a) => (
                <AppointmentCard key={a.id} appt={a} />
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
