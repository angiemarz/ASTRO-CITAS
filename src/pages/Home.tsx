import {
  AlertTriangle,
  Ban,
  CalendarCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Coins,
  Eye,
  Hourglass,
  MessageCircle,
  Moon,
  Pencil,
  Plus,
  Wallet,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatMoney, PLATFORM_LABELS } from '../../shared/domain';
import { formatYmdLong, relativeTime } from '../../shared/time';
import type { Appointment } from '../../shared/types';
import { useActions } from '../components/ActionsProvider';
import { AppointmentCard, serviceNames } from '../components/AppointmentCard';
import { Constellation, Logo } from '../components/Brand';
import { Page } from '../components/Layout';
import { PlatformIcon } from '../components/PlatformIcon';
import { Button, cx, EmptyState, ErrorBox, LoadingBlock, PaymentBadge, SectionTitle, StatusBadge } from '../components/ui';
import { useDashboard } from '../lib/hooks';
import { timePhase } from '../lib/pending';
import { useFmt, useSettings } from '../lib/settings';

function greeting(hour: number) {
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function money(map: Record<string, number>) {
  const entries = Object.entries(map).filter(([, v]) => v > 0);
  if (!entries.length) return formatMoney(0, 'MXN');
  return entries.map(([c, v]) => formatMoney(v, c)).join(' · ');
}

/** Re-renderiza cada minuto para actualizar "en 20 min", "en curso", etc. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function HomePage() {
  const { data, isLoading, error } = useDashboard();
  const settings = useSettings();
  const fmt = useFmt();
  const navigate = useNavigate();
  const now = useNow();
  const hour = Number(fmt.hm(new Date(now)).slice(0, 2));

  return (
    <>
      <header className="pt-safe gradient-hero relative overflow-hidden text-white">
        <Constellation className="absolute top-[calc(var(--safe-top)+0.5rem)] right-4 h-10 w-36 text-gold-300 opacity-80" />
        <Moon className="absolute -right-6 -bottom-8 size-40 rotate-12 text-white/10" strokeWidth={1} />
        <div className="relative mx-auto max-w-5xl px-5 pt-5 pb-14 sm:px-6">
          <div className="flex items-center gap-3 lg:hidden">
            <Logo className="size-10 ring-2 ring-white/40" />
            <span className="font-display text-xl font-bold">{settings.business_name}</span>
          </div>
          <p className="mt-5 text-sm font-semibold text-white/80 first-letter:uppercase lg:mt-0">{formatYmdLong(fmt.today())}</p>
          <h1 className="font-display text-[2.1rem] leading-tight font-bold">{greeting(hour)} ✨</h1>
          <p className="mt-1 text-white/85">
            {data
              ? data.today_count
                ? `Hoy tienes ${data.today_count} ${data.today_count === 1 ? 'cita' : 'citas'}.`
                : 'Hoy no tienes citas agendadas.'
              : 'Cargando tu día…'}
          </p>
        </div>
      </header>

      <Page className="-mt-10 pt-0">
        {isLoading && <LoadingBlock />}
        <ErrorBox error={error} />
        {data && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Stat icon={<CalendarDays />} label="Citas hoy" value={data.today_count} to="/calendario" tone="plum" />
              <Stat icon={<Hourglass />} label="Pendientes de atender" value={data.pending_count} to="/pendientes" tone="lavender" />
              <Stat
                icon={<AlertTriangle />}
                label="Atrasadas sin marcar"
                value={data.overdue_count}
                to="/pendientes?tab=overdue"
                tone={data.overdue_count ? 'rose' : 'lavender'}
              />
              <Stat icon={<CheckCircle2 />} label="Completadas este mes" value={data.completed_count} to="/citas?status=completed" tone="green" />
              <Stat icon={<Ban />} label="Canceladas este mes" value={data.cancelled_count} to="/citas?status=cancelled,no_show" tone="stone" />
              <Stat icon={<Wallet />} label="Pagos pendientes" value={data.unpaid_count} to="/pagos?tab=owing" tone="gold" />
              <Stat icon={<Coins />} label="Cobrado hoy" value={money(data.collected_today)} to="/pagos" tone="green" small />
              <Stat icon={<Clock />} label="Por cobrar" value={money(data.pending_amount)} to="/pagos?tab=owing" tone="gold" small />
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
              <section>
                <SectionTitle icon={<Moon className="size-5" />}>Próxima cita</SectionTitle>
                {data.next ? (
                  <NextCard appt={data.next} now={now} />
                ) : (
                  <div className="card">
                    <EmptyState icon={<CalendarCheck className="size-7" />} title="Sin próximas citas">
                      Cuando agendes una cita aparecerá aquí.
                    </EmptyState>
                  </div>
                )}
                <Button size="lg" className="mt-4 w-full" icon={<Plus className="size-5" />} onClick={() => navigate('/nueva')}>
                  Nueva cita
                </Button>
              </section>

              <section>
                <SectionTitle
                  icon={<CalendarDays className="size-5" />}
                  action={
                    <Link to="/calendario" className="text-sm font-bold text-rose-600">
                      Ver calendario
                    </Link>
                  }
                >
                  Agenda de hoy
                </SectionTitle>
                <TodayAgenda items={data.today} now={now} />
              </section>
            </div>
          </div>
        )}
      </Page>
    </>
  );
}

const TONES: Record<string, string> = {
  plum: 'from-plum-500 to-rose-500 text-white',
  lavender: 'from-lavender-200 to-lavender-100 text-plum-600',
  rose: 'from-rose-500 to-rose-600 text-white',
  green: 'from-emerald-100 to-emerald-50 text-emerald-700',
  stone: 'from-stone-100 to-stone-50 text-stone-500',
  gold: 'from-gold-300 to-gold-300/40 text-gold-600',
};

function Stat({
  icon,
  label,
  value,
  to,
  tone,
  small,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  to: string;
  tone: string;
  small?: boolean;
}) {
  return (
    <Link to={to} className="card hover-lift flex flex-col gap-2 p-3.5 transition">
      <span className={cx('flex size-9 items-center justify-center rounded-xl bg-gradient-to-br [&>svg]:size-[18px]', TONES[tone])}>{icon}</span>
      <span className={cx('font-extrabold text-plum-800', small ? 'text-[15px] leading-snug' : 'text-2xl leading-none')}>{value}</span>
      <span className="text-xs leading-tight font-bold text-plum-500">{label}</span>
    </Link>
  );
}

function NextCard({ appt, now }: { appt: Appointment; now: number }) {
  const fmt = useFmt();
  const navigate = useNavigate();
  const a = useActions();
  return (
    <div className="card relative overflow-hidden p-5">
      <div className="absolute -top-10 -right-10 size-36 rounded-full bg-gradient-to-br from-blush-200/70 to-lavender-200/60 blur-2xl" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-[1.75rem] leading-tight font-bold text-plum-800">{appt.client_name}</p>
            <p className="mt-0.5 font-semibold text-plum-500">{serviceNames(appt)}</p>
          </div>
          <span className="shrink-0 rounded-full bg-gradient-to-r from-gold-300 to-gold-400 px-3 py-1 text-xs font-extrabold text-plum-800">
            {relativeTime(appt.start_at, new Date(now))}
          </span>
        </div>
        <div className="gold-line my-4" />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Info label="Fecha" value={<span className="capitalize">{fmt.dateShort(appt.start_at)}</span>} />
          <Info label="Hora" value={fmt.range(appt.start_at, appt.end_at)} />
          <Info
            label="Plataforma"
            value={
              <span className="inline-flex items-center gap-1.5">
                <PlatformIcon platform={appt.platform} className="size-4" />
                {PLATFORM_LABELS[appt.platform]}
              </span>
            }
          />
          <Info label="Precio total" value={formatMoney(appt.final_price, appt.currency)} />
          <Info label="Pago" value={<PaymentBadge status={appt.payment_status} />} />
          <Info label="Atención" value={<StatusBadge status={appt.status} />} />
        </dl>
        <div className="mt-5 grid grid-cols-4 gap-2">
          <Action icon={<Eye />} label="Ver" onClick={() => navigate(`/citas/${appt.id}`)} />
          <Action icon={<Pencil />} label="Editar" onClick={() => navigate(`/citas/${appt.id}/editar`)} />
          <Action icon={<MessageCircle />} label="Contactar" onClick={() => a.contact(appt)} disabled={!a.canContact(appt)} />
          <Action icon={<Check />} label="Atendida" onClick={() => a.markAttended(appt)} primary />
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-bold text-plum-400">{label}</dt>
      <dd className="mt-0.5 font-bold text-plum-700">{value}</dd>
    </div>
  );
}

function Action({
  icon,
  label,
  onClick,
  primary,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl text-xs font-bold transition disabled:opacity-40 [&>svg]:size-5',
        primary ? 'bg-gradient-to-br from-plum-600 to-rose-500 text-white shadow-glow' : 'bg-lavender-100/80 text-plum-700 active:bg-lavender-200',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function TodayAgenda({ items, now }: { items: Appointment[]; now: number }) {
  if (!items.length) {
    return (
      <div className="card">
        <EmptyState icon={<Moon className="size-7" />} title="Día libre">
          No hay citas para hoy. Disfruta tu energía ✨
        </EmptyState>
      </div>
    );
  }
  const groups: { key: string; title: string; items: Appointment[]; highlight?: 'overdue' | 'current' }[] = [
    {
      key: 'current',
      title: 'En curso',
      items: items.filter((a) => a.status === 'in_progress' || (['scheduled', 'confirmed'].includes(a.status) && timePhase(a, now) === 'current')),
      highlight: 'current',
    },
    {
      key: 'upcoming',
      title: 'Próximas',
      items: items.filter((a) => ['scheduled', 'confirmed'].includes(a.status) && timePhase(a, now) === 'upcoming'),
    },
    {
      key: 'pending',
      title: 'Pendientes de atender',
      items: items.filter((a) => ['scheduled', 'confirmed'].includes(a.status) && timePhase(a, now) === 'past'),
      highlight: 'overdue',
    },
    { key: 'done', title: 'Completadas', items: items.filter((a) => a.status === 'completed') },
    { key: 'cancelled', title: 'Canceladas / no asistió', items: items.filter((a) => a.status === 'cancelled' || a.status === 'no_show') },
  ];
  return (
    <div className="space-y-5">
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <div key={g.key}>
            <p
              className={cx(
                'mb-2 flex items-center gap-2 text-xs font-extrabold tracking-wider uppercase',
                g.key === 'pending' ? 'text-rose-600' : g.key === 'current' ? 'text-amber-600' : 'text-plum-400',
              )}
            >
              {g.title} <span className="rounded-full bg-white px-2 text-plum-500 ring-1 ring-lavender-200">{g.items.length}</span>
            </p>
            <div className="space-y-3">
              {g.items.map((a) => (
                <AppointmentCard key={a.id} appt={a} showDate={false} highlight={g.highlight} />
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
