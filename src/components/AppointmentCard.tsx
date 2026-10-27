import {
  Ban,
  CalendarClock,
  Check,
  Clock,
  CreditCard,
  Eye,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Play,
  StickyNote,
  UserX,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney, PLATFORM_LABELS } from '../../shared/domain';
import { relativeTime } from '../../shared/time';
import type { Appointment } from '../../shared/types';
import { isOpen, isOverdue } from '../lib/pending';
import { useFmt } from '../lib/settings';
import { useActions } from './ActionsProvider';
import { PlatformIcon } from './PlatformIcon';
import { cx, PaymentBadge, Sheet, STATUS_COLOR, StatusBadge } from './ui';

export function serviceNames(a: Appointment) {
  return a.services.map((s) => s.name).join(' + ') || 'Sin servicio';
}

export function AppointmentCard({
  appt,
  showDate = true,
  compact,
  highlight,
}: {
  appt: Appointment;
  showDate?: boolean;
  compact?: boolean;
  highlight?: 'overdue' | 'current';
}) {
  const fmt = useFmt();
  const navigate = useNavigate();
  const actions = useActions();
  const [menu, setMenu] = useState(false);
  const open = isOpen(appt);
  const overdue = isOverdue(appt);
  const muted = appt.status === 'cancelled' || appt.status === 'no_show';

  return (
    <div
      className={cx(
        'card animate-fade-up relative overflow-hidden',
        muted && 'opacity-70',
        (highlight === 'overdue' || overdue) && 'ring-2 ring-rose-300/70',
        highlight === 'current' && 'ring-2 ring-amber-300/70',
      )}
    >
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: STATUS_COLOR[appt.status] }} />
      <button className="block w-full py-3.5 pr-4 pl-5 text-left" onClick={() => navigate(`/citas/${appt.id}`)}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={cx('truncate text-[17px] font-extrabold text-plum-800', muted && 'line-through decoration-plum-300')}>
              {appt.client_name}
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-plum-500">{serviceNames(appt)}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[15px] font-extrabold text-plum-700">{fmt.time(appt.start_at)}</p>
            {showDate && <p className="text-xs font-semibold text-plum-500 capitalize">{fmt.dateShort(appt.start_at)}</p>}
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={appt.status} />
          <PaymentBadge status={appt.payment_status} />
          <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-plum-600 ring-1 ring-lavender-200">
            <PlatformIcon platform={appt.platform} className="size-3.5" />
            {PLATFORM_LABELS[appt.platform]}
          </span>
          <span className="ml-auto text-sm font-extrabold text-plum-700">{formatMoney(appt.final_price, appt.currency)}</span>
        </div>
        {!compact && (
          <div className="mt-2 space-y-1 text-xs text-plum-500">
            <p className="flex items-center gap-1.5">
              <Clock className="size-3.5" />
              {fmt.range(appt.start_at, appt.end_at)}
              {open && <span className={cx('font-bold', overdue ? 'text-rose-600' : 'text-plum-600')}>· {overdue ? `terminó ${relativeTime(appt.end_at)}` : relativeTime(appt.start_at)}</span>}
            </p>
            {appt.balance > 0 && appt.payment_status !== 'unpaid' && (
              <p className="font-semibold text-gold-600">Saldo pendiente: {formatMoney(appt.balance, appt.currency)}</p>
            )}
            {appt.notes && (
              <p className="flex items-start gap-1.5">
                <StickyNote className="mt-0.5 size-3.5 shrink-0" />
                <span className="line-clamp-2">{appt.notes}</span>
              </p>
            )}
          </div>
        )}
      </button>

      <div className="flex items-center gap-1.5 border-t border-lavender-100 px-3 py-2">
        {open ? (
          <>
            <QuickButton primary onClick={() => actions.markAttended(appt)} icon={<Check className="size-4" />}>
              Atendida
            </QuickButton>
            {appt.status !== 'in_progress' && (
              <QuickButton onClick={() => actions.start(appt)} icon={<Play className="size-4" />}>
                Iniciar
              </QuickButton>
            )}
            <QuickButton onClick={() => actions.contact(appt)} icon={<MessageCircle className="size-4" />} disabled={!actions.canContact(appt)}>
              Contactar
            </QuickButton>
          </>
        ) : (
          <>
            <QuickButton onClick={() => navigate(`/citas/${appt.id}`)} icon={<Eye className="size-4" />}>
              Ver
            </QuickButton>
            {appt.balance > 0 && appt.status !== 'cancelled' && (
              <QuickButton primary onClick={() => actions.addPayment(appt)} icon={<CreditCard className="size-4" />}>
                Registrar pago
              </QuickButton>
            )}
          </>
        )}
        <button
          onClick={() => setMenu(true)}
          className="ml-auto flex size-9 items-center justify-center rounded-full text-plum-500 active:bg-lavender-100"
          aria-label="Más acciones"
        >
          <MoreHorizontal className="size-5" />
        </button>
      </div>
      <ActionMenu appt={appt} open={menu} onClose={() => setMenu(false)} />
    </div>
  );
}

function QuickButton({
  children,
  icon,
  onClick,
  primary,
  disabled,
}: {
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold transition disabled:opacity-40',
        primary ? 'bg-gradient-to-r from-plum-600 to-rose-500 text-white' : 'bg-lavender-100/80 text-plum-700 active:bg-lavender-200',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function ActionMenu({ appt, open, onClose }: { appt: Appointment; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const a = useActions();
  const fmt = useFmt();
  const isOpenAppt = isOpen(appt);
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const items: { label: string; icon: ReactNode; onClick: () => void; danger?: boolean; show?: boolean }[] = [
    { label: 'Marcar como atendida', icon: <Check />, onClick: () => a.markAttended(appt), show: appt.status !== 'completed' },
    { label: 'Iniciar cita', icon: <Play />, onClick: () => a.start(appt), show: isOpenAppt && appt.status !== 'in_progress' },
    { label: 'Marcar como confirmada', icon: <Check />, onClick: () => a.setStatus(appt, 'confirmed'), show: appt.status === 'scheduled' },
    { label: 'Reprogramar', icon: <CalendarClock />, onClick: () => a.reschedule(appt) },
    { label: 'Editar', icon: <Pencil />, onClick: () => navigate(`/citas/${appt.id}/editar`) },
    { label: 'Contactar al cliente', icon: <MessageCircle />, onClick: () => a.contact(appt), show: a.canContact(appt) },
    { label: 'Registrar pago', icon: <CreditCard />, onClick: () => a.addPayment(appt), show: appt.balance > 0 },
    { label: 'Volver a pendiente', icon: <Clock />, onClick: () => a.setStatus(appt, 'scheduled'), show: !isOpenAppt },
    { label: 'Marcar como no asistió', icon: <UserX />, onClick: () => a.noShow(appt), danger: true, show: isOpenAppt },
    { label: 'Cancelar cita', icon: <Ban />, onClick: () => a.cancel(appt), danger: true, show: appt.status !== 'cancelled' },
  ];
  return (
    <Sheet open={open} onClose={onClose} title={appt.client_name}>
      <p className="-mt-1 mb-3 text-sm text-plum-500 capitalize">
        {fmt.dateShort(appt.start_at)} · {fmt.range(appt.start_at, appt.end_at)}
      </p>
      <div className="flex flex-col gap-1 pb-2">
        {items
          .filter((i) => i.show !== false)
          .map((i) => (
            <button
              key={i.label}
              onClick={run(i.onClick)}
              className={cx(
                'flex min-h-12 items-center gap-3 rounded-2xl px-3 text-left font-bold active:bg-lavender-100 [&>svg]:size-5',
                i.danger ? 'text-rose-600' : 'text-plum-700',
              )}
            >
              {i.icon}
              {i.label}
            </button>
          ))}
      </div>
    </Sheet>
  );
}
