import { useQuery } from '@tanstack/react-query';
import { BarChart3, CalendarCheck, Coins, Percent, Receipt, Trophy, Wallet, XCircle } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { AnalyticsResult, Ranked, SeriesPoint } from '../../shared/analytics';
import { formatMoney } from '../../shared/domain';
import { addDaysYmd, dayRangeUtc } from '../../shared/time';
import { Page, PageHeader } from '../components/Layout';
import { Money } from '../components/Money';
import { Chip, cx, EmptyState, ErrorBox, Input, LoadingBlock, Segmented } from '../components/ui';
import { get, qs } from '../lib/api';
import { useFmt } from '../lib/settings';

type Period = 'today' | '7d' | '30d' | 'month' | 'year' | 'custom';
type Grain = 'day' | 'week' | 'month';
type Result = AnalyticsResult & { from: string; to: string; rate: number | null };

const PERIODS: [Period, string][] = [
  ['today', 'Hoy'],
  ['7d', 'Últimos 7 días'],
  ['30d', 'Últimos 30 días'],
  ['month', 'Mes actual'],
  ['year', 'Año actual'],
  ['custom', 'Rango personalizado'],
];

const mx = (n: number) => formatMoney(n, 'MXN');
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function label(key: string, grain: Grain) {
  if (grain === 'month') {
    const [y, m] = key.split('-').map(Number);
    return `${MESES[m - 1]} ${String(y).slice(2)}`;
  }
  const [, m, d] = key.split('-').map(Number);
  return `${d} ${MESES[m - 1]}`;
}

export function AnalyticsPage() {
  const fmt = useFmt();
  const today = fmt.today();
  const [period, setPeriod] = useState<Period>('month');
  const [from, setFrom] = useState(addDaysYmd(today, -30));
  const [to, setTo] = useState(today);
  const [grainPick, setGrainPick] = useState<Grain | null>(null);

  const range = useMemo(() => {
    const [y, m] = today.split('-').map(Number);
    const ym = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-01`;
    const endToday = dayRangeUtc(today, fmt.tz).end;
    switch (period) {
      case 'today':
        return { from: dayRangeUtc(today, fmt.tz).start, to: endToday };
      case '7d':
        return { from: dayRangeUtc(addDaysYmd(today, -6), fmt.tz).start, to: endToday };
      case '30d':
        return { from: dayRangeUtc(addDaysYmd(today, -29), fmt.tz).start, to: endToday };
      case 'month':
        return { from: fmt.toUtc(ym(y, m), '00:00'), to: m === 12 ? fmt.toUtc(ym(y + 1, 1), '00:00') : fmt.toUtc(ym(y, m + 1), '00:00') };
      case 'year':
        return { from: fmt.toUtc(`${y}-01-01`, '00:00'), to: fmt.toUtc(`${y + 1}-01-01`, '00:00') };
      case 'custom':
        return { from: dayRangeUtc(from, fmt.tz).start, to: dayRangeUtc(to || from, fmt.tz).end };
    }
  }, [period, from, to, today, fmt.tz]);

  const valid = range.to > range.from;
  const rangeQs = qs({ from: range.from.toISOString(), to: range.to.toISOString() });
  const q = useQuery({
    queryKey: ['analytics', rangeQs],
    queryFn: () => get<Result>(`/analytics${rangeQs}`),
    placeholderData: (p) => p,
    enabled: valid,
  });
  const d = q.data;

  const days = Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000));
  const autoGrain: Grain = days <= 31 ? 'day' : days <= 120 ? 'week' : 'month';
  const grain = grainPick ?? autoGrain;

  return (
    <>
      <PageHeader title="Estadísticas" subtitle="Datos reales de tus citas, servicios, rituales y pagos">
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          {PERIODS.map(([v, l]) => (
            <Chip key={v} active={period === v} onClick={() => setPeriod(v)}>
              {l}
            </Chip>
          ))}
        </div>
        {period === 'custom' && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Desde" />
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="Hasta" />
          </div>
        )}
      </PageHeader>
      <Page>
        <ErrorBox error={q.error} />
        {!valid && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">La fecha final no puede ser anterior a la inicial.</p>}
        {!d ? (
          valid && <LoadingBlock />
        ) : (
          <Dashboard d={d} grain={grain} onGrain={setGrainPick} />
        )}
      </Page>
    </>
  );
}

function Dashboard({ d, grain, onGrain }: { d: Result; grain: Grain; onGrain: (g: Grain) => void }) {
  const t = d.totals;
  const series = d.series[grain];
  const empty = t.appointments === 0 && t.cancelled === 0 && t.no_show === 0;
  if (empty) {
    return (
      <div className="card">
        <EmptyState icon={<BarChart3 className="size-7" />} title="Sin citas en este periodo">
          Cambia el periodo o agenda citas para ver tus estadísticas.
        </EmptyState>
      </div>
    );
  }
  const topServices = d.services.slice(0, 5);
  const topRituals = d.rituals.slice(0, 5);
  const topPromos = d.promotions.slice(0, 5);
  const topRevenue = [...d.services, ...d.rituals].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  return (
    <div className="space-y-5">
      {t.unconverted > 0 && (
        <p className="rounded-2xl bg-gold-300/30 px-4 py-2 text-sm text-plum-700">
          {t.unconverted} cita(s) están en dólares y no se pudieron sumar en pesos: captura el <b>Tipo de cambio</b> en Configuración.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<CalendarCheck />} label="Citas" value={String(t.appointments)} sub={`${t.cancelled} cancelada(s)${t.no_show ? ` · ${t.no_show} no asistió` : ''}`} />
        <Kpi icon={<Receipt />} label="Ingresos (facturado)" value={<Money amount={t.revenue} className="" usdClassName="block" />} sub={t.discounts ? `Descuentos: ${mx(t.discounts)}` : 'Sin descuentos'} />
        <Kpi icon={<Coins />} label="Cobrado" value={<Money amount={t.paid} usdClassName="block" />} sub={`${t.paid_pct}% del total`} tone="text-emerald-600" />
        <Kpi icon={<Wallet />} label="Por cobrar" value={<Money amount={t.pending} usdClassName="block" />} sub={`${t.pending_pct}% del total`} tone={t.pending > 0 ? 'text-rose-600' : undefined} />
        <Kpi icon={<Percent />} label="Ticket promedio" value={<Money amount={t.average_ticket} usdClassName="block" />} sub="Por cita atendida o agendada" />
        <Kpi icon={<XCircle />} label="Canceladas" value={String(t.cancelled)} sub="No suman ingresos" />
        <Kpi icon={<Trophy />} label="Servicio más pedido" value={d.services[0]?.name ?? '—'} sub={d.services[0] ? `${d.services[0].count} cita(s)` : ''} small />
        <Kpi icon={<Trophy />} label="Ritual más pedido" value={d.rituals[0]?.name ?? '—'} sub={d.rituals[0] ? `${d.rituals[0].count} cita(s)` : ''} small />
      </div>

      <Panel
        title="Evolución de citas"
        action={
          <Segmented<Grain>
            value={grain}
            onChange={onGrain}
            options={[
              { value: 'day', label: 'Día' },
              { value: 'week', label: 'Semana' },
              { value: 'month', label: 'Mes' },
            ]}
          />
        }
      >
        <LineChart points={series} grain={grain} />
      </Panel>

      <Panel title="Ingresos por mes" note="Facturado vs. cobrado (MXN)">
        <ColumnChart points={d.series.month} />
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Servicios más agendados">
          <HBars items={topServices} metric="count" empty="Sin servicios en este periodo." />
        </Panel>
        <Panel title="Rituales más pedidos">
          <HBars items={topRituals} metric="count" empty="Sin rituales en este periodo." />
          {d.intentions.length > 0 && (
            <div className="mt-4 border-t border-lavender-100 pt-3">
              <p className="mb-2 text-xs font-bold text-plum-500">Intenciones elegidas</p>
              <div className="flex flex-wrap gap-2">
                {d.intentions.map((i) => (
                  <span key={i.name} className="rounded-full bg-plum-50 px-3 py-1 text-xs font-bold text-plum-600">
                    {i.name} · {i.count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Panel>
        <Panel title="Promociones más usadas">
          <HBars items={topPromos} metric="count" empty="Aún no se usaron promociones." />
        </Panel>
        <Panel title="Menos agendados" note="Servicios y rituales activos">
          <HBars items={d.least_services} metric="count" empty="Sin servicios." muted />
        </Panel>
      </div>

      <Panel title="Top 5 por ingresos" note="El precio final de cada cita se reparte entre sus servicios (no se duplica)">
        <HBars items={topRevenue} metric="revenue" empty="Sin ingresos en este periodo." money />
      </Panel>

      <Panel title="Servicios, rituales y promociones" note="Citas e ingresos atribuidos. Las promociones se cuentan aparte porque ya incluyen servicios.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-bold text-plum-500">Citas</p>
            <HBars items={d.comparison.map((c) => ({ key: c.kind, name: c.label, count: c.count, revenue: c.revenue }))} metric="count" empty="" />
          </div>
          <div>
            <p className="mb-2 text-xs font-bold text-plum-500">Ingresos</p>
            <HBars items={d.comparison.map((c) => ({ key: c.kind, name: c.label, count: c.count, revenue: c.revenue }))} metric="revenue" empty="" money />
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-3">
        <RevenueTable title="Ingresos por servicio" rows={d.services} />
        <RevenueTable title="Ingresos por ritual" rows={d.rituals} />
        <RevenueTable title="Ingresos por promoción" rows={d.promotions} />
      </div>
    </div>
  );
}

// ---------- Piezas ----------

function Kpi({ icon, label, value, sub, tone, small }: { icon: ReactNode; label: string; value: ReactNode; sub?: string; tone?: string; small?: boolean }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-xs font-bold text-plum-500">
        <span className="flex size-7 items-center justify-center rounded-lg gradient-soft text-plum-600 [&>svg]:size-4">{icon}</span>
        {label}
      </div>
      <div className={cx('mt-2 font-extrabold text-plum-800', small ? 'text-base leading-snug' : 'text-xl', tone)}>{value}</div>
      {sub && <p className="mt-0.5 text-[11px] text-plum-400">{sub}</p>}
    </div>
  );
}

function Panel({ title, note, action, children }: { title: string; note?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-extrabold text-plum-800">{title}</h2>
          {note && <p className="text-[11px] text-plum-400">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Barras horizontales con el nombre completo (se lee bien en el celular). */
function HBars({
  items,
  metric,
  empty,
  money,
  muted,
}: {
  items: Pick<Ranked, 'key' | 'name' | 'count' | 'revenue'>[];
  metric: 'count' | 'revenue';
  empty: string;
  money?: boolean;
  muted?: boolean;
}) {
  if (!items.length) return <p className="text-sm text-plum-400">{empty}</p>;
  const max = Math.max(...items.map((i) => i[metric]), 1);
  return (
    <ul className="space-y-2.5">
      {items.map((i, idx) => (
        <li key={i.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-bold text-plum-700">
              <span className="mr-1.5 text-plum-300">{idx + 1}.</span>
              {i.name}
            </span>
            <span className="shrink-0 font-extrabold text-plum-800">{money ? mx(i[metric]) : `${i[metric]}×`}</span>
          </div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-lavender-100">
            <div
              className={cx('h-full rounded-full', muted ? 'bg-plum-300' : 'bg-gradient-to-r from-plum-500 to-rose-500')}
              style={{ width: `${Math.max(i[metric] > 0 ? 3 : 0, (i[metric] / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function RevenueTable({ title, rows }: { title: string; rows: Ranked[] }) {
  const byRevenue = [...rows].sort((a, b) => b.revenue - a.revenue);
  return (
    <Panel title={title}>
      {byRevenue.length ? (
        <ul className="divide-y divide-lavender-100 text-sm">
          {byRevenue.map((r) => (
            <li key={r.key} className="flex items-start justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-bold text-plum-700">{r.name}</span>
                <span className="text-[11px] text-plum-400">{r.count}×</span>
              </span>
              <Money amount={r.revenue} right className="font-extrabold text-plum-800" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-plum-400">Sin datos en este periodo.</p>
      )}
    </Panel>
  );
}

function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Línea de citas en el tiempo (SVG, sin librerías). */
function LineChart({ points, grain }: { points: SeriesPoint[]; grain: Grain }) {
  if (!points.length) return <p className="text-sm text-plum-400">Sin datos.</p>;
  const W = 640;
  const H = 220;
  const pad = { l: 34, r: 12, t: 12, b: 28 };
  const max = niceMax(Math.max(...points.map((p) => p.count)));
  const x = (i: number) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (points.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.count).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const every = Math.ceil(points.length / 6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Evolución de citas">
      <defs>
        <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-rose-500)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--color-rose-500)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((tk) => (
        <g key={tk}>
          <line x1={pad.l} x2={W - pad.r} y1={y(tk)} y2={y(tk)} stroke="var(--color-lavender-200)" strokeDasharray="3 4" />
          <text x={pad.l - 6} y={y(tk) + 4} textAnchor="end" fontSize="11" fill="var(--color-plum-400)">
            {tk}
          </text>
        </g>
      ))}
      <path d={area} fill="url(#area)" />
      <path d={path} fill="none" stroke="var(--color-rose-500)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={p.key}>
          <circle cx={x(i)} cy={y(p.count)} r={points.length > 40 ? 2 : 3.5} fill="white" stroke="var(--color-plum-600)" strokeWidth="2">
            <title>{`${label(p.key, grain)}: ${p.count} cita(s) · ${mx(p.revenue)}`}</title>
          </circle>
          {i % every === 0 && (
            <text x={x(i)} y={H - 8} textAnchor={i === points.length - 1 && i > 0 ? 'end' : i === 0 && points.length > 1 ? 'start' : 'middle'} fontSize="11" fill="var(--color-plum-400)">
              {label(p.key, grain)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** Columnas por mes: facturado (morado) y cobrado (dorado). */
function ColumnChart({ points }: { points: SeriesPoint[] }) {
  if (!points.length) return <p className="text-sm text-plum-400">Sin datos.</p>;
  const W = 640;
  const H = 230;
  const pad = { l: 8, r: 8, t: 14, b: 28 };
  const max = Math.max(...points.map((p) => p.revenue), 1);
  const slot = (W - pad.l - pad.r) / points.length;
  const bw = Math.min(26, slot / 2.6);
  const h = (v: number) => (v / max) * (H - pad.t - pad.b);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Ingresos por mes">
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--color-lavender-200)" />
        {points.map((p, i) => {
          const cx0 = pad.l + slot * i + slot / 2;
          return (
            <g key={p.key}>
              <rect x={cx0 - bw - 1} y={H - pad.b - h(p.revenue)} width={bw} height={h(p.revenue)} rx="4" fill="var(--color-plum-500)">
                <title>{`${label(p.key, 'month')}: facturado ${mx(p.revenue)}`}</title>
              </rect>
              <rect x={cx0 + 1} y={H - pad.b - h(p.paid)} width={bw} height={h(p.paid)} rx="4" fill="var(--color-gold-400)">
                <title>{`${label(p.key, 'month')}: cobrado ${mx(p.paid)}`}</title>
              </rect>
              {p.revenue > 0 && points.length <= 8 && (
                <text x={cx0} y={H - pad.b - h(p.revenue) - 5} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--color-plum-600)">
                  {mx(p.revenue).replace(/\.00$/, '')}
                </text>
              )}
              <text x={cx0} y={H - 9} textAnchor="middle" fontSize="11" fill="var(--color-plum-400)">
                {label(p.key, 'month')}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex gap-4 text-[11px] font-bold text-plum-500">
        <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-plum-500" /> Facturado</span>
        <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-gold-400" /> Cobrado</span>
      </div>
    </>
  );
}
