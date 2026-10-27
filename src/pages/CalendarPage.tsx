import type { DatesSetArg, EventClickArg, EventDropArg } from '@fullcalendar/core';
import esLocale from '@fullcalendar/core/locales/es';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { type DateClickArg, type EventResizeDoneArg } from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { Plus } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { utcWallClockToReal, wallClockAsUtc } from '../../shared/time';
import type { Appointment } from '../../shared/types';
import { conflictMessage } from '../components/ActionsProvider';
import { useFeedback } from '../components/feedback';
import { Page, PageHeader } from '../components/Layout';
import { Button, Chip, STATUS_COLOR } from '../components/ui';
import { ApiError } from '../lib/api';
import { useAppointments, useReschedule } from '../lib/hooks';
import { useFmt, useSettings } from '../lib/settings';

const VIEW_KEY = 'abx-calendar-view';

function savedView() {
  try {
    return localStorage.getItem(VIEW_KEY);
  } catch {
    return null;
  }
}

export function CalendarPage() {
  const settings = useSettings();
  const fmt = useFmt();
  const navigate = useNavigate();
  const { toast, confirm } = useFeedback();
  const reschedule = useReschedule();
  const calRef = useRef<FullCalendar>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [hideCancelled, setHideCancelled] = useState(true);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const initialView = savedView() || (isMobile ? 'timeGridDay' : 'timeGridWeek');

  const { data } = useAppointments(range ? { from: range.from, to: range.to, limit: 500 } : {}, !!range);

  // FullCalendar trabaja en "hora de pared" (timeZone: 'UTC') para mostrar siempre la zona configurada.
  const events = useMemo(
    () =>
      (data?.items ?? [])
        .filter((a) => !hideCancelled || (a.status !== 'cancelled' && a.status !== 'no_show'))
        .map((a) => ({
          id: String(a.id),
          title: `${a.client_name}${a.services.length ? ' · ' + a.services.map((s) => s.name).join(' + ') : ''}`,
          start: wallClockAsUtc(a.start_at, settings.timezone),
          end: wallClockAsUtc(a.end_at, settings.timezone),
          backgroundColor: STATUS_COLOR[a.status],
          textColor: '#fff',
          editable: a.status !== 'completed',
          extendedProps: { appt: a },
          classNames: a.status === 'cancelled' || a.status === 'no_show' ? ['opacity-60', 'line-through'] : [],
        })),
    [data, settings.timezone, hideCancelled],
  );

  const onDatesSet = (arg: DatesSetArg) => {
    try {
      localStorage.setItem(VIEW_KEY, arg.view.type);
    } catch {
      /* almacenamiento no disponible */
    }
    setRange({
      from: utcWallClockToReal(arg.start, settings.timezone).toISOString(),
      to: utcWallClockToReal(arg.end, settings.timezone).toISOString(),
    });
  };

  const moveEvent = async (arg: EventDropArg | EventResizeDoneArg) => {
    const appt = arg.event.extendedProps.appt as Appointment;
    const start = utcWallClockToReal(arg.event.start!, settings.timezone);
    const end = arg.event.end
      ? utcWallClockToReal(arg.event.end, settings.timezone)
      : new Date(start.getTime() + (new Date(appt.end_at).getTime() - new Date(appt.start_at).getTime()));
    const ok = await confirm({
      title: 'Mover cita',
      message: `¿Reprogramar la cita de ${appt.client_name} para el ${fmt.dateShort(start)} de ${fmt.time(start)} a ${fmt.time(end)}?`,
      confirmLabel: 'Reprogramar',
    });
    if (!ok) return arg.revert();
    const send = async (allow: boolean): Promise<void> => {
      try {
        await reschedule.mutateAsync({ id: appt.id, start_at: start.toISOString(), end_at: end.toISOString(), allow_overlap: allow });
        toast('Cita reprogramada');
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.data.conflicts) {
          if (await confirm({ title: 'Horario ocupado', message: conflictMessage(e.data.conflicts, fmt), confirmLabel: 'Mover de todos modos' })) return send(true);
          arg.revert();
        } else {
          toast((e as Error).message, 'error');
          arg.revert();
        }
      }
    };
    await send(false);
  };

  const pad = (n: number) => String(n).padStart(2, '0');
  const wallToParams = (d: Date, allDay: boolean) => {
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    return allDay ? `date=${date}` : `date=${date}&time=${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  };

  return (
    <>
      <PageHeader
        title="Calendario"
        subtitle={settings.timezone}
        actions={
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => navigate('/nueva')}>
            Nueva
          </Button>
        }
      />
      <Page>
        <div className="card p-3 sm:p-5">
          <FullCalendar
            ref={calRef}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
            locale={esLocale}
            timeZone="UTC"
            now={() => wallClockAsUtc(new Date(), settings.timezone)}
            initialView={initialView}
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: isMobile ? 'dayGridMonth,timeGridDay,listWeek' : 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
            }}
            buttonText={{ today: 'Hoy', month: 'Mes', week: 'Semana', day: 'Día', list: 'Lista' }}
            firstDay={settings.week_starts_monday ? 1 : 0}
            height="auto"
            slotMinTime={`${pad(settings.calendar_start_hour)}:00:00`}
            slotMaxTime={`${pad(settings.calendar_end_hour)}:00:00`}
            slotDuration="00:30:00"
            scrollTime={fmt.hm(new Date()).slice(0, 2) + ':00:00'}
            nowIndicator
            allDaySlot={false}
            dayMaxEvents={3}
            eventTimeFormat={
              settings.time_format === '24h'
                ? { hour: '2-digit', minute: '2-digit', hour12: false }
                : { hour: 'numeric', minute: '2-digit', hour12: true, meridiem: 'short' }
            }
            slotLabelFormat={
              settings.time_format === '24h' ? { hour: '2-digit', minute: '2-digit', hour12: false } : { hour: 'numeric', hour12: true, meridiem: 'short' }
            }
            events={events}
            editable
            eventDurationEditable
            longPressDelay={350}
            selectable={false}
            datesSet={onDatesSet}
            eventClick={(arg: EventClickArg) => navigate(`/citas/${arg.event.id}`)}
            eventDrop={moveEvent}
            eventResize={moveEvent}
            dateClick={(arg: DateClickArg) => {
              if (arg.view.type === 'dayGridMonth') {
                calRef.current?.getApi().changeView('timeGridDay', arg.date);
              } else navigate(`/nueva?${wallToParams(arg.date, arg.allDay)}`);
            }}
            noEventsText="No hay citas en este periodo"
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Chip active={!hideCancelled} onClick={() => setHideCancelled(!hideCancelled)}>
            {hideCancelled ? 'Mostrar canceladas' : 'Ocultar canceladas'}
          </Chip>
          {(['scheduled', 'confirmed', 'in_progress', 'completed', 'no_show'] as const).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 text-xs font-bold text-plum-500">
              <span className="size-3 rounded-full" style={{ background: STATUS_COLOR[s] }} />
              {{ scheduled: 'Agendada', confirmed: 'Confirmada', in_progress: 'En curso', completed: 'Completada', no_show: 'No asistió' }[s]}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-plum-400">
          Toca un horario vacío para crear una cita · mantén presionada una cita para moverla · toca un día del mes para ver su agenda.
        </p>
      </Page>
    </>
  );
}
