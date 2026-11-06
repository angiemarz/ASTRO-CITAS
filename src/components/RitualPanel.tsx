import { CalendarPlus, Check, Flame, Hourglass, Send, X } from 'lucide-react';
import { useState } from 'react';
import { formatMoney, googleCalendarDayLink, hasRitual, isRitualOnly, RITUAL_WINDOW_DAYS, ritualCountdownLabel, ritualDeadline } from '../../shared/domain';
import { formatYmdLong } from '../../shared/time';
import type { Appointment } from '../../shared/types';
import { useSetRitual } from '../lib/hooks';
import { isOpen } from '../lib/pending';
import { useFmt } from '../lib/settings';
import { useFeedback } from './feedback';
import { cx } from './ui';

/** Sí / No */
function YesNo({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex shrink-0 rounded-full bg-lavender-100 p-1" role="group">
      {([true, false] as const).map((v) => (
        <button
          key={String(v)}
          type="button"
          disabled={disabled}
          aria-pressed={value === v}
          onClick={() => value !== v && onChange(v)}
          className={cx(
            'min-h-10 min-w-16 rounded-full px-4 text-sm font-bold transition disabled:opacity-60',
            value === v ? (v ? 'bg-emerald-500 text-white shadow-soft' : 'bg-white text-plum-600 shadow-soft') : 'text-plum-500',
          )}
        >
          {v ? 'Sí' : 'No'}
        </button>
      ))}
    </div>
  );
}

/** Botones "¿Mandé evidencia? Sí/No" y "¿Mandé explicación? Sí/No". Solo en citas con ritual. */
export function RitualFollowup({ appt, compact }: { appt: Appointment; compact?: boolean }) {
  const set = useSetRitual();
  const { toast } = useFeedback();
  if (!hasRitual(appt)) return null;
  const update = (patch: { evidence?: boolean; explanation?: boolean }) =>
    set.mutate({ id: appt.id, ...patch }, { onError: (e) => toast((e as Error).message, 'error') });
  const rows = [
    { key: 'evidence' as const, label: '¿Mandé la evidencia?', value: appt.ritual_evidence, at: appt.ritual_evidence_at },
    { key: 'explanation' as const, label: '¿Mandé la explicación?', value: appt.ritual_explanation, at: appt.ritual_explanation_at },
  ];
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.key} className={cx('flex items-center justify-between gap-3 rounded-2xl bg-lavender-50/80', compact ? 'px-3 py-2' : 'px-4 py-3')}>
          <div className="min-w-0">
            <p className="font-bold text-plum-700">{r.label}</p>
            <p className="text-xs text-plum-500">{r.value ? 'Enviada ✓' : 'Pendiente'}</p>
          </div>
          <YesNo value={r.value} disabled={set.isPending} onChange={(v) => update({ [r.key]: v })} />
        </div>
      ))}
    </div>
  );
}

const TONES = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  red: 'border-rose-300 bg-blush-100 text-rose-700',
  done: 'border-emerald-200 bg-emerald-50 text-emerald-800',
};

/** Contador del plazo para realizar el ritual (una semana y dos días desde la fecha de la cita). */
export function useRitualStatus(a: Appointment) {
  const { tz } = useFmt();
  if (!isRitualOnly(a)) return null;
  const r = ritualDeadline(a.start_at, tz);
  const done = a.status === 'completed';
  const closed = !isOpen(a);
  const tone: keyof typeof TONES = done ? 'done' : r.overdue ? 'red' : r.daysLeft <= 2 ? 'amber' : 'green';
  return { ...r, done, closed, tone, label: done ? 'Ritual realizado' : ritualCountdownLabel(r) };
}

/** Chip compacto para las tarjetas de citas. */
export function RitualChip({ appt }: { appt: Appointment }) {
  const s = useRitualStatus(appt);
  if (!s || s.closed) return null;
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold', TONES[s.tone])}>
      <Flame className="size-3.5" /> {s.label}
    </span>
  );
}

/** Pendientes de envío del ritual (para las tarjetas). */
export function RitualPendingChips({ appt }: { appt: Appointment }) {
  if (!hasRitual(appt) || !isOpen(appt) && appt.status !== 'completed') return null;
  const missing = [!appt.ritual_evidence && 'evidencia', !appt.ritual_explanation && 'explicación'].filter(Boolean) as string[];
  if (!missing.length) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gold-300/40 px-2.5 py-0.5 text-xs font-bold text-gold-600">
      <Send className="size-3.5" /> Falta {missing.join(' y ')}
    </span>
  );
}

/** Tarjeta completa del ritual para el detalle de la cita. */
export function RitualPanel({ appt }: { appt: Appointment }) {
  const fmt = useFmt();
  const s = useRitualStatus(appt);
  const set = useSetRitual();
  const { toast } = useFeedback();
  const [topic, setTopic] = useState(appt.ritual_topic ?? '');
  if (!hasRitual(appt)) return null;
  const open = isOpen(appt);
  const saveTopic = () => {
    if (topic.trim() === (appt.ritual_topic ?? '')) return;
    set.mutate({ id: appt.id, topic: topic.trim() }, { onSuccess: () => toast('Tema guardado'), onError: (e) => toast((e as Error).message, 'error') });
  };
  return (
    <div className="card space-y-4 p-5">
      <h2 className="flex items-center gap-2 font-display text-xl font-bold text-plum-700">
        <Flame className="size-5 text-gold-500" /> Ritual
      </h2>

      {s && (
        <div className={cx('rounded-2xl border px-4 py-3', TONES[s.tone])}>
          <div className="flex items-center gap-2 font-extrabold">
            {s.done ? <Check className="size-5" /> : s.overdue ? <X className="size-5" /> : <Hourglass className="size-5" />}
            {s.label}
          </div>
          {!s.done && open && (
            <p className="mt-1 text-sm">
              Tienes {RITUAL_WINDOW_DAYS} días (una semana y dos días) desde su fecha. {s.overdue ? 'El plazo venció el' : 'Vence el'}{' '}
              <span className="font-bold">{formatYmdLong(s.deadlineYmd)}</span>.
            </p>
          )}
          {s.done && appt.attended_at && <p className="mt-1 text-sm">Marcado como atendido el {fmt.dateShort(appt.attended_at)}.</p>}
        </div>
      )}

      <label className="block">
        <span className="mb-1.5 block text-sm font-bold text-plum-700">Tema o intención</span>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onBlur={saveTopic}
          placeholder="Ej. abrir caminos en el trabajo"
          className="min-h-12 w-full rounded-2xl border border-lavender-200 bg-white/90 px-4 py-3 text-plum-800 outline-none focus:border-lavender-400 focus:ring-4 focus:ring-lavender-200/60"
        />
      </label>

      <div>
        <p className="mb-2 text-sm font-bold text-plum-700">Seguimiento con la clienta</p>
        <RitualFollowup appt={appt} />
      </div>

      {open && isRitualOnly(appt) && (
        <a
          href={googleCalendarDayLink({
            title: `✨ ${appt.services.map((x) => x.name).join(' + ')} · ${appt.client_name}`,
            ymd: fmt.ymd(appt.start_at),
            tz: fmt.tz,
            details: [
              `Ritual para ${appt.client_name}`,
              appt.ritual_topic && `Tema: ${appt.ritual_topic}`,
              appt.contact_value && `Contacto: ${appt.contact_value}`,
              `Cooperación: ${formatMoney(appt.final_price, appt.currency)}`,
              appt.notes,
            ]
              .filter(Boolean)
              .join('\n'),
          })}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-gold-400 to-gold-500 px-5 font-bold text-plum-900"
        >
          <CalendarPlus className="size-4" /> Agregar a Google Calendar
        </a>
      )}
    </div>
  );
}
