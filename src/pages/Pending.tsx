import { AlertTriangle, CalendarCheck, CheckCircle2, Hourglass, PlayCircle, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppointmentCard } from '../components/AppointmentCard';
import { Page, PageHeader } from '../components/Layout';
import { EmptyState, ErrorBox, LoadingBlock, Segmented } from '../components/ui';
import { useAppointments } from '../lib/hooks';
import { classifyPending } from '../lib/pending';
import { useSettings } from '../lib/settings';

type Tab = 'overdue' | 'today' | 'in_progress' | 'upcoming' | 'completed';

const EMPTY: Record<Tab, { title: string; text: string; icon: React.ReactNode }> = {
  overdue: { title: '¡Todo al día!', text: 'No tienes citas atrasadas sin marcar.', icon: <CheckCircle2 className="size-7" /> },
  today: { title: 'Nada pendiente hoy', text: 'Todas las citas de hoy ya fueron atendidas o no hay citas.', icon: <Sun className="size-7" /> },
  in_progress: { title: 'Sin citas en curso', text: 'Usa “Iniciar” en una cita para verla aquí.', icon: <PlayCircle className="size-7" /> },
  upcoming: { title: 'Sin próximas citas', text: 'Las citas futuras agendadas o confirmadas aparecerán aquí.', icon: <CalendarCheck className="size-7" /> },
  completed: { title: 'Aún no hay citas atendidas', text: 'Cuando marques una cita como atendida aparecerá en este historial.', icon: <Hourglass className="size-7" /> },
};

export function PendingPage() {
  const { timezone } = useSettings();
  const [params, setParams] = useSearchParams();
  const open = useAppointments({ view: 'open', limit: 500 });
  const done = useAppointments({ status: 'completed', order: 'desc', limit: 60 });
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const groups = classifyPending(open.data?.items ?? [], timezone);
  const urlTab = params.get('tab') as Tab | null;
  const defaultTab: Tab = groups.overdue.length ? 'overdue' : groups.today.length ? 'today' : 'upcoming';
  const tab: Tab = urlTab ?? defaultTab;
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });

  const lists: Record<Tab, typeof groups.today> = {
    overdue: groups.overdue,
    today: groups.today,
    in_progress: groups.in_progress,
    upcoming: groups.upcoming,
    completed: done.data?.items ?? [],
  };
  const items = lists[tab];

  return (
    <>
      <PageHeader title="Pendientes de atender" subtitle="Independiente de los pagos">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overdue', label: 'Atrasadas', count: groups.overdue.length },
            { value: 'today', label: 'Hoy', count: groups.today.length },
            { value: 'in_progress', label: 'En curso', count: groups.in_progress.length },
            { value: 'upcoming', label: 'Próximas', count: groups.upcoming.length },
            { value: 'completed', label: 'Completadas' },
          ]}
        />
      </PageHeader>
      <Page>
        {tab === 'overdue' && groups.overdue.length > 0 && (
          <div className="mb-4 flex gap-3 rounded-2xl border border-blush-200 bg-blush-50 p-4 text-sm text-rose-700">
            <AlertTriangle className="size-5 shrink-0" />
            <p>
              Estas citas ya terminaron pero siguen sin marcarse. Indica si las atendiste, si no asistió la persona o si se canceló. Nada se marca
              automáticamente.
            </p>
          </div>
        )}
        <ErrorBox error={open.error} />
        {open.isLoading ? (
          <LoadingBlock />
        ) : items.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((a) => (
              <AppointmentCard key={a.id} appt={a} highlight={tab === 'overdue' ? 'overdue' : tab === 'in_progress' ? 'current' : undefined} />
            ))}
          </div>
        ) : (
          <div className="card">
            <EmptyState icon={EMPTY[tab].icon} title={EMPTY[tab].title}>
              {EMPTY[tab].text}
            </EmptyState>
          </div>
        )}
      </Page>
    </>
  );
}
