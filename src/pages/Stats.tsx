import { useQuery } from '@tanstack/react-query';
import { Coins, PiggyBank, Receipt, TrendingUp, Wallet } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatMoney, PLATFORM_LABELS, STATUS_LABELS } from '../../shared/domain';
import { addDaysYmd, dayRangeUtc, monthLabel } from '../../shared/time';
import type { Appointment, AppointmentStatus, Payment, Platform } from '../../shared/types';
import { AppointmentCard } from '../components/AppointmentCard';
import { Page, PageHeader } from '../components/Layout';
import { Card, Chip, cx, EmptyState, ErrorBox, Input, LoadingBlock, Segmented } from '../components/ui';
import { get, qs } from '../lib/api';
import { useFmt } from '../lib/settings';

type Tab = 'summary' | 'owing' | 'payments';
type Period = 'month' | 'last_month' | '30d' | 'year' | 'custom';

interface StatsData {
  income: { currency: string; total: number; n: number }[];
  billed: { currency: string; total: number; discounts: number; n: number }[];
  status_counts: { status: AppointmentStatus; n: number }[];
  by_service: { name: string; currency: string; n: number; catalog_total: number }[];
  by_platform: { platform: Platform; n: number }[];
  by_method: { method: string; currency: string; total: number; n: number }[];
  monthly: Record<string, Record<string, number>>;
  top_clients: { client_name: string; client_id: number | null; currency: string; n: number; total: number }[];
  owing: Appointment[];
  promotions: { name: string; n: number; savings: number; currency: string }[];
}

export function StatsPage() {
  const fmt = useFmt();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'summary';
  const [period, setPeriod] = useState<Period>('month');
  const today = fmt.today();
  const [from, setFrom] = useState(addDaysYmd(today, -30));
  const [to, setTo] = useState(today);

  const range = useMemo(() => {
    const [y, m] = today.split('-').map(Number);
    const ym = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-01`;
    const endToday = dayRangeUtc(today, fmt.tz).end;
    switch (period) {
      case 'month':
        return { from: fmt.toUtc(ym(y, m), '00:00'), to: m === 12 ? fmt.toUtc(ym(y + 1, 1), '00:00') : fmt.toUtc(ym(y, m + 1), '00:00') };
      case 'last_month':
        return { from: m === 1 ? fmt.toUtc(ym(y - 1, 12), '00:00') : fmt.toUtc(ym(y, m - 1), '00:00'), to: fmt.toUtc(ym(y, m), '00:00') };
      case '30d':
        return { from: dayRangeUtc(addDaysYmd(today, -29), fmt.tz).start, to: endToday };
      case 'year':
        return { from: fmt.toUtc(`${y}-01-01`, '00:00'), to: fmt.toUtc(`${y + 1}-01-01`, '00:00') };
      case 'custom':
        return { from: dayRangeUtc(from, fmt.tz).start, to: dayRangeUtc(to || from, fmt.tz).end };
    }
  }, [period, from, to, today, fmt.tz]);

  const rangeQs = qs({ from: range.from.toISOString(), to: range.to.toISOString() });
  const stats = useQuery({ queryKey: ['stats', rangeQs], queryFn: () => get<StatsData>(`/stats${rangeQs}`), placeholderData: (p) => p });
  const payments = useQuery({
    queryKey: ['payments', rangeQs],
    queryFn: () => get<Payment[]>(`/payments${rangeQs}`),
    enabled: tab === 'payments',
  });

  const d = stats.data;

  return (
    <>
      <PageHeader title="Pagos y estadísticas">
        <Segmented<Tab>
          value={tab}
          onChange={(t) => setParams({ tab: t }, { replace: true })}
          options={[
            { value: 'summary', label: 'Resumen' },
            { value: 'owing', label: 'Por cobrar', count: d?.owing.length },
            { value: 'payments', label: 'Pagos' },
          ]}
        />
        {tab !== 'owing' && (
          <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
            {(
              [
                ['month', 'Este mes'],
                ['last_month', 'Mes pasado'],
                ['30d', 'Últimos 30 días'],
                ['year', 'Este año'],
                ['custom', 'Rango'],
              ] as [Period, string][]
            ).map(([v, l]) => (
              <Chip key={v} active={period === v} onClick={() => setPeriod(v)}>
                {l}
              </Chip>
            ))}
          </div>
        )}
        {tab !== 'owing' && period === 'custom' && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Desde" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Hasta" />
          </div>
        )}
      </PageHeader>
      <Page>
        <ErrorBox error={stats.error} />
        {!d ? (
          <LoadingBlock />
        ) : tab === 'summary' ? (
          <Summary d={d} />
        ) : tab === 'owing' ? (
          <Owing items={d.owing} />
        ) : (
          <PaymentsList items={payments.data} loading={payments.isLoading} />
        )}
      </Page>
    </>
  );
}

function money(rows: { currency: string; total: number }[]) {
  const r = rows.filter((x) => x.total > 0);
  return r.length ? r.map((x) => formatMoney(x.total, x.currency)).join(' · ') : formatMoney(0, 'MXN');
}

function Summary({ d }: { d: StatsData }) {
  const totalAppts = d.status_counts.reduce((s, x) => s + x.n, 0);
  const owing = d.owing.reduce<Record<string, number>>((acc, a) => ((acc[a.currency] = (acc[a.currency] ?? 0) + a.balance), acc), {});
  const months = Object.keys(d.monthly).sort().slice(-12);
  const currencies = [...new Set(months.flatMap((m) => Object.keys(d.monthly[m])))];
  const discounts = d.billed.filter((b) => b.discounts > 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<Coins />} label="Cobrado en el periodo" value={money(d.income)} sub={`${d.income.reduce((s, x) => s + x.n, 0)} pago(s)`} />
        <Kpi icon={<Receipt />} label="Facturado (citas)" value={money(d.billed)} sub={`${d.billed.reduce((s, x) => s + x.n, 0)} cita(s)`} />
        <Kpi
          icon={<Wallet />}
          label="Por cobrar (total)"
          value={Object.keys(owing).length ? Object.entries(owing).map(([c, v]) => formatMoney(v, c)).join(' · ') : formatMoney(0)}
          sub={`${d.owing.length} cita(s) con saldo`}
          tone="rose"
        />
        <Kpi
          icon={<PiggyBank />}
          label="Descuentos otorgados"
          value={discounts.length ? discounts.map((b) => formatMoney(b.discounts, b.currency)).join(' · ') : formatMoney(0)}
          sub="Promociones y precios especiales"
        />
      </div>

      {months.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-4 flex items-center gap-2 font-display text-xl font-bold text-plum-700">
            <TrendingUp className="size-5 text-gold-500" /> Ingresos por mes
          </h3>
          {currencies.map((cur) => {
            const max = Math.max(...months.map((m) => d.monthly[m][cur] ?? 0), 1);
            return (
              <div key={cur} className="mb-4 last:mb-0">
                {currencies.length > 1 && <p className="mb-2 text-xs font-bold text-plum-500">{cur}</p>}
                <div className="flex h-40 items-end gap-1.5">
                  {months.map((m) => {
                    const v = d.monthly[m][cur] ?? 0;
                    return (
                      <div key={m} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${monthLabel(m)}: ${formatMoney(v, cur)}`}>
                        <span className="text-[9px] font-bold text-plum-500">{v ? Math.round(v).toLocaleString('es-MX') : ''}</span>
                        <div className="w-full rounded-t-lg bg-gradient-to-t from-plum-500 to-rose-400" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
                        <span className="text-[10px] font-bold text-plum-400 capitalize">{monthLabel(m).slice(0, 3)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <BarList
          title="Citas por estado"
          rows={d.status_counts.map((s) => ({ label: STATUS_LABELS[s.status], value: s.n, display: `${s.n}` }))}
          empty="Sin citas en el periodo"
          footer={totalAppts ? `${totalAppts} cita(s) en total` : undefined}
        />
        <BarList title="Servicios más solicitados" rows={d.by_service.map((s) => ({ label: s.name, value: s.n, display: `${s.n}` }))} empty="Sin servicios en el periodo" />
        <BarList
          title="Plataformas de atención"
          rows={d.by_platform.map((p) => ({ label: PLATFORM_LABELS[p.platform] ?? p.platform, value: p.n, display: `${p.n}` }))}
          empty="Sin datos"
        />
        <BarList
          title="Métodos de pago"
          rows={d.by_method.map((m) => ({ label: `${m.method}${d.by_method.some((x) => x.currency !== m.currency) ? ` (${m.currency})` : ''}`, value: m.total, display: formatMoney(m.total, m.currency) }))}
          empty="Sin pagos en el periodo"
        />
        <BarList
          title="Clientes frecuentes"
          rows={d.top_clients.map((c) => ({ label: c.client_name, value: c.n, display: `${c.n} · ${formatMoney(c.total, c.currency)}` }))}
          empty="Sin datos"
        />
        <BarList
          title="Promociones usadas"
          rows={d.promotions.map((p) => ({ label: p.name, value: p.n, display: `${p.n}× · ahorro ${formatMoney(p.savings, p.currency)}` }))}
          empty="Sin promociones en el periodo"
        />
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub, tone }: { icon: ReactNode; label: string; value: string; sub?: string; tone?: 'rose' }) {
  return (
    <Card className="p-4">
      <span className={cx('mb-2 flex size-9 items-center justify-center rounded-xl [&>svg]:size-[18px]', tone === 'rose' ? 'bg-blush-100 text-rose-600' : 'gradient-soft text-plum-600')}>
        {icon}
      </span>
      <p className="text-[15px] leading-snug font-extrabold text-plum-800">{value}</p>
      <p className="mt-1 text-xs font-bold text-plum-500">{label}</p>
      {sub && <p className="text-[11px] text-plum-400">{sub}</p>}
    </Card>
  );
}

function BarList({ title, rows, empty, footer }: { title: string; rows: { label: string; value: number; display: string }[]; empty: string; footer?: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <Card className="p-5">
      <h3 className="mb-3 font-display text-xl font-bold text-plum-700">{title}</h3>
      {rows.length ? (
        <ul className="space-y-2.5">
          {rows.map((r, i) => (
            <li key={i}>
              <div className="mb-1 flex justify-between gap-3 text-sm">
                <span className="truncate font-semibold text-plum-700">{r.label}</span>
                <span className="shrink-0 font-bold text-plum-600">{r.display}</span>
              </div>
              <div className="h-2 rounded-full bg-lavender-100">
                <div className="h-2 rounded-full bg-gradient-to-r from-lavender-400 to-rose-400" style={{ width: `${(r.value / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-plum-500">{empty}</p>
      )}
      {footer && <p className="mt-3 text-xs text-plum-400">{footer}</p>}
    </Card>
  );
}

function Owing({ items }: { items: Appointment[] }) {
  if (!items.length)
    return (
      <div className="card">
        <EmptyState icon={<Wallet className="size-7" />} title="Nadie te debe 💖">
          Todas tus citas activas están pagadas.
        </EmptyState>
      </div>
    );
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((a) => (
        <AppointmentCard key={a.id} appt={a} />
      ))}
    </div>
  );
}

function PaymentsList({ items, loading }: { items?: Payment[]; loading: boolean }) {
  const fmt = useFmt();
  if (loading || !items) return <LoadingBlock />;
  if (!items.length)
    return (
      <div className="card">
        <EmptyState icon={<Coins className="size-7" />} title="Sin pagos en este periodo" />
      </div>
    );
  return (
    <div className="card divide-y divide-lavender-100 overflow-hidden">
      {items.map((p) => (
        <Link key={p.id} to={`/citas/${p.appointment_id}`} className="flex items-center gap-3 px-4 py-3 active:bg-lavender-50">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <Coins className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-bold text-plum-800">{p.client_name}</span>
            <span className="block text-xs text-plum-500">
              <span className="capitalize">{fmt.dateShort(p.paid_at)}</span> · {p.method}
              {p.note ? ` · ${p.note}` : ''}
            </span>
          </span>
          <span className="font-extrabold text-emerald-700">{formatMoney(p.amount, p.currency)}</span>
        </Link>
      ))}
    </div>
  );
}
