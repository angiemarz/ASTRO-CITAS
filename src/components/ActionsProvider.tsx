// Acciones rápidas sobre una cita, disponibles en toda la app (tarjetas, inicio, detalle, calendario).
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { contactLink, formatMoney, PLATFORM_LABELS, round2 } from '../../shared/domain';
import type { Appointment, AppointmentStatus, Conflict } from '../../shared/types';
import { ApiError } from '../lib/api';
import { useAddPayment, useReschedule, useSetStatus } from '../lib/hooks';
import { useFmt, useSettings } from '../lib/settings';
import { useFeedback } from './feedback';
import { TimePicker } from './TimePicker';
import { Button, ErrorBox, Field, Input, Select, Sheet, Textarea } from './ui';

interface ActionsApi {
  setStatus: (a: Appointment, s: AppointmentStatus) => Promise<void>;
  markAttended: (a: Appointment) => Promise<void>;
  start: (a: Appointment) => Promise<void>;
  cancel: (a: Appointment) => Promise<void>;
  noShow: (a: Appointment) => Promise<void>;
  reschedule: (a: Appointment) => void;
  addPayment: (a: Appointment) => void;
  contact: (a: Appointment) => void;
  canContact: (a: Appointment) => boolean;
}

const Ctx = createContext<ActionsApi | null>(null);

export const useActions = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('ActionsProvider faltante');
  return c;
};

export function conflictMessage(conflicts: Conflict[], fmt: ReturnType<typeof useFmt>) {
  return (
    <div className="space-y-2">
      <p>Este horario se cruza con:</p>
      <ul className="space-y-1">
        {conflicts.map((c) => (
          <li key={c.id} className="rounded-xl bg-blush-50 px-3 py-2 text-sm font-semibold text-plum-700">
            {c.client_name} · {fmt.dateShort(c.start_at)} {fmt.range(c.start_at, c.end_at)}
          </li>
        ))}
      </ul>
      <p>¿Quieres guardarla de todos modos?</p>
    </div>
  );
}

export function ActionsProvider({ children }: { children: ReactNode }) {
  const { toast, confirm } = useFeedback();
  const statusM = useSetStatus();
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null);
  const [paying, setPaying] = useState<Appointment | null>(null);

  const setStatus = useCallback(
    async (a: Appointment, s: AppointmentStatus) => {
      try {
        await statusM.mutateAsync({ id: a.id, status: s });
        toast('Estado actualizado');
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    },
    [statusM, toast],
  );

  const markAttended = useCallback(
    async (a: Appointment) => {
      try {
        const updated = await statusM.mutateAsync({ id: a.id, status: 'completed' });
        if (updated.balance > 0) {
          toast(`✨ ${a.client_name} atendida · saldo pendiente ${formatMoney(updated.balance, updated.currency)}`, 'success', {
            label: 'Registrar pago',
            onClick: () => setPaying(updated),
          });
        } else toast(`✨ ${a.client_name} marcada como atendida`);
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    },
    [statusM, toast],
  );

  const start = useCallback(
    async (a: Appointment) => {
      try {
        await statusM.mutateAsync({ id: a.id, status: 'in_progress' });
        toast(`Cita con ${a.client_name} en curso`);
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    },
    [statusM, toast],
  );

  const cancel = useCallback(
    async (a: Appointment) => {
      const ok = await confirm({
        title: 'Cancelar cita',
        message: `¿Cancelar la cita de ${a.client_name}? Podrás reprogramarla después si lo necesitas.`,
        confirmLabel: 'Sí, cancelar',
        cancelLabel: 'No',
        danger: true,
      });
      if (ok) await setStatus(a, 'cancelled');
    },
    [confirm, setStatus],
  );

  const noShow = useCallback(
    async (a: Appointment) => {
      const ok = await confirm({
        title: 'Marcar como no asistió',
        message: `¿${a.client_name} no se presentó a su cita?`,
        confirmLabel: 'Sí, no asistió',
        cancelLabel: 'No',
        danger: true,
      });
      if (ok) await setStatus(a, 'no_show');
    },
    [confirm, setStatus],
  );

  const canContact = useCallback((a: Appointment) => !!contactLink(a.platform, a.contact_value), []);

  const contact = useCallback(
    (a: Appointment) => {
      const link = contactLink(a.platform, a.contact_value);
      if (!link) {
        toast(`No hay un ${PLATFORM_LABELS[a.platform]} válido registrado para esta cita.`, 'info');
        return;
      }
      if (link.startsWith('tel:')) window.location.href = link;
      else window.open(link, '_blank', 'noopener');
    },
    [toast],
  );

  return (
    <Ctx.Provider
      value={{
        setStatus,
        markAttended,
        start,
        cancel,
        noShow,
        contact,
        canContact,
        reschedule: setRescheduling,
        addPayment: setPaying,
      }}
    >
      {children}
      {rescheduling && <RescheduleSheet appt={rescheduling} onClose={() => setRescheduling(null)} />}
      {paying && <PaymentSheet appt={paying} onClose={() => setPaying(null)} />}
    </Ctx.Provider>
  );
}

function RescheduleSheet({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const fmt = useFmt();
  const { toast, confirm } = useFeedback();
  const m = useReschedule();
  const duration = Math.round((new Date(appt.end_at).getTime() - new Date(appt.start_at).getTime()) / 60000);
  const [date, setDate] = useState(fmt.ymd(appt.start_at));
  const [time, setTime] = useState(fmt.hm(appt.start_at));
  const [dur, setDur] = useState(duration);
  const [reason, setReason] = useState('');

  const submit = async (allow = false) => {
    const start = fmt.toUtc(date, time);
    const end = new Date(start.getTime() + dur * 60000);
    try {
      await m.mutateAsync({ id: appt.id, start_at: start.toISOString(), end_at: end.toISOString(), allow_overlap: allow, reason });
      toast(`Cita reprogramada para ${fmt.dateShort(start)} a las ${fmt.time(start)}`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data.conflicts) {
        const ok = await confirm({ title: 'Horario ocupado', message: conflictMessage(e.data.conflicts, fmt), confirmLabel: 'Guardar así' });
        if (ok) await submit(true);
      } else toast((e as Error).message, 'error');
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Reprogramar cita"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button className="flex-1" loading={m.isPending} onClick={() => submit()}>
            Reprogramar
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="rounded-2xl bg-lavender-50 px-4 py-3 text-sm text-plum-600">
          <strong>{appt.client_name}</strong> · actualmente {fmt.dateShort(appt.start_at)} {fmt.range(appt.start_at, appt.end_at)}
        </p>
        <Field label="Nueva fecha">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Hora de inicio">
          <TimePicker value={time} onChange={setTime} />
        </Field>
        <Field label="Duración (minutos)">
          <Input type="number" inputMode="numeric" min={5} step={5} value={dur} onChange={(e) => setDur(Math.max(5, Number(e.target.value) || 5))} />
        </Field>
        <Field label="Motivo (opcional)">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. la clienta pidió cambio de horario" />
        </Field>
      </div>
    </Sheet>
  );
}

export function PaymentSheet({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const settings = useSettings();
  const fmt = useFmt();
  const { toast } = useFeedback();
  const m = useAddPayment();
  const [amount, setAmount] = useState(String(round2(appt.balance) || ''));
  const [method, setMethod] = useState(settings.payment_methods[0] ?? 'Transferencia');
  const [date, setDate] = useState(fmt.today());
  const [note, setNote] = useState('');

  const submit = async () => {
    const value = Number(amount);
    if (!(value > 0)) {
      toast('Escribe un monto válido', 'error');
      return;
    }
    // Hora actual si el pago es de hoy; mediodía si es de otro día
    const paidAt = date === fmt.today() ? new Date() : fmt.toUtc(date, '12:00');
    try {
      const updated = await m.mutateAsync({ id: appt.id, amount: value, method, paid_at: paidAt.toISOString(), note });
      toast(
        updated.balance > 0
          ? `Abono registrado · resta ${formatMoney(updated.balance, updated.currency)}`
          : '💖 Pago completo registrado',
      );
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Registrar abono"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button className="flex-1" loading={m.isPending} onClick={submit}>
            Guardar pago
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-lavender-50 p-3 text-center text-sm">
          <div>
            <p className="text-plum-500">Total</p>
            <p className="font-bold text-plum-700">{formatMoney(appt.final_price, appt.currency)}</p>
          </div>
          <div>
            <p className="text-plum-500">Abonado</p>
            <p className="font-bold text-emerald-700">{formatMoney(appt.paid_total, appt.currency)}</p>
          </div>
          <div>
            <p className="text-plum-500">Saldo</p>
            <p className="font-bold text-rose-600">{formatMoney(appt.balance, appt.currency)}</p>
          </div>
        </div>
        <Field label={`Monto (${appt.currency})`} required>
          <Input type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Método de pago">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {settings.payment_methods.map((pm) => (
              <option key={pm}>{pm}</option>
            ))}
          </Select>
        </Field>
        <Field label="Fecha de pago">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Nota (opcional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. referencia de transferencia" />
        </Field>
        <ErrorBox error={m.error} />
      </div>
    </Sheet>
  );
}
