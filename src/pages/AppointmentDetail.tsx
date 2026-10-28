import {
  Ban,
  CalendarPlus,
  CalendarClock,
  Check,
  Clock,
  CreditCard,
  History,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Play,
  StickyNote,
  Trash2,
  User,
  UserX,
  Wallet,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatDuration, formatMoney, googleCalendarDayLink, isRitualOnly, PLATFORM_LABELS } from '../../shared/domain';
import { relativeTime } from '../../shared/time';
import { useActions } from '../components/ActionsProvider';
import { ActionMenu } from '../components/AppointmentCard';
import { useFeedback } from '../components/feedback';
import { Page, PageHeader } from '../components/Layout';
import { PlatformIcon } from '../components/PlatformIcon';
import { Button, Card, cx, IconButton, LoadingBlock, PaymentBadge, StatusBadge } from '../components/ui';
import { useAppointment, useDeleteAppointment, useDeletePayment } from '../lib/hooks';
import { isOpen, isOverdue } from '../lib/pending';
import { useFmt, useSettings } from '../lib/settings';
import { post } from '../lib/api';
import { useInvalidateAppointments } from '../lib/hooks';

const SOURCE_NAMES: Record<string, string> = { calcom: 'Cal.com', canva: 'Canva', make: 'Make', notion: 'Notion', google: 'Google Calendar', zapier: 'Zapier' };

export function AppointmentDetailPage() {
  const id = Number(useParams().id);
  const { data: a, isLoading, error } = useAppointment(id);
  const fmt = useFmt();
  const actions = useActions();
  const navigate = useNavigate();
  const { confirm, toast } = useFeedback();
  const delAppt = useDeleteAppointment();
  const delPay = useDeletePayment();
  const [menu, setMenu] = useState(false);
  const settings = useSettings();
  const invalidate = useInvalidateAppointments();
  const [sending, setSending] = useState(false);
  const sendToCalcom = async () => {
    setSending(true);
    try {
      await post(`/appointments/${id}/calcom`);
      await invalidate();
      toast('✨ Agregada a Cal.com y a tu Google Calendar');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSending(false);
    }
  };

  if (isLoading) return <LoadingBlock />;
  if (error || !a)
    return (
      <>
        <PageHeader title="Cita" back />
        <Page>No se encontró la cita.</Page>
      </>
    );

  const open = isOpen(a);
  const overdue = isOverdue(a);
  const duration = Math.round((new Date(a.end_at).getTime() - new Date(a.start_at).getTime()) / 60000);

  const remove = async () => {
    const ok = await confirm({
      title: 'Eliminar cita',
      message: 'Se eliminará la cita junto con sus pagos e historial. Esta acción no se puede deshacer. Si solo no se realizará, mejor márcala como cancelada.',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const r = await delAppt.mutateAsync(a.id);
    toast('Cita eliminada');
    if (r?.sync_warning) toast(r.sync_warning, 'info');
    navigate('/citas', { replace: true });
  };

  return (
    <>
      <PageHeader
        title={a.client_name}
        subtitle={<span className="inline-block first-letter:uppercase">{fmt.dateLong(a.start_at)}</span>}
        back
        actions={
          <>
            <IconButton label="Editar" onClick={() => navigate(`/citas/${a.id}/editar`)}>
              <Pencil className="size-5" />
            </IconButton>
            <IconButton label="Más acciones" onClick={() => setMenu(true)}>
              <MoreHorizontal className="size-5" />
            </IconButton>
          </>
        }
      />
      <ActionMenu appt={a} open={menu} onClose={() => setMenu(false)} />
      <Page>
        <div className="mx-auto max-w-2xl space-y-4">
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={a.status} className="text-sm" />
              <PaymentBadge status={a.payment_status} className="text-sm" />
              {overdue && <span className="rounded-full bg-rose-500 px-2.5 py-0.5 text-sm font-bold text-white">Atrasada sin marcar</span>}
              {a.external_source && (
                <span className="rounded-full bg-gold-300/40 px-2.5 py-0.5 text-sm font-bold text-gold-600">
                  {a.external_source === 'agenda-calcom'
                    ? 'En Cal.com y Google Calendar'
                    : `Agendada en ${SOURCE_NAMES[a.external_source] ?? a.external_source}`}
                </span>
              )}
            </div>
            <div className="mt-4 flex items-end justify-between gap-4">
              <div>
                <p className="font-display text-4xl leading-none font-bold text-plum-800">{fmt.time(a.start_at)}</p>
                <p className="mt-1 text-sm font-semibold text-plum-500">
                  hasta {fmt.time(a.end_at)} · {formatDuration(duration)}
                </p>
              </div>
              {open && (
                <span className={cx('rounded-full px-3 py-1 text-xs font-extrabold', overdue ? 'bg-blush-100 text-rose-700' : 'bg-gold-300/50 text-plum-700')}>
                  {overdue ? `Terminó ${relativeTime(a.end_at)}` : relativeTime(a.start_at)}
                </span>
              )}
            </div>
            {open && (
              <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Button onClick={() => actions.markAttended(a)} icon={<Check className="size-4" />}>
                  Atendida
                </Button>
                {a.status !== 'in_progress' ? (
                  <Button variant="soft" onClick={() => actions.start(a)} icon={<Play className="size-4" />}>
                    Iniciar
                  </Button>
                ) : (
                  <Button variant="soft" disabled icon={<Clock className="size-4" />}>
                    En curso
                  </Button>
                )}
                <Button variant="soft" onClick={() => actions.reschedule(a)} icon={<CalendarClock className="size-4" />}>
                  Reprogramar
                </Button>
                <Button variant="soft" onClick={() => actions.contact(a)} disabled={!actions.canContact(a)} icon={<MessageCircle className="size-4" />}>
                  Contactar
                </Button>
                <Button variant="danger" size="sm" onClick={() => actions.noShow(a)} icon={<UserX className="size-4" />}>
                  No asistió
                </Button>
                <Button variant="danger" size="sm" onClick={() => actions.cancel(a)} icon={<Ban className="size-4" />}>
                  Cancelar
                </Button>
              </div>
            )}
            {open && !a.external_source && !isRitualOnly(a) && settings.calcom_event_url && new Date(a.start_at).getTime() > Date.now() && (
              <Button variant="gold" size="sm" className="mt-3 w-full" loading={sending} icon={<CalendarPlus className="size-4" />} onClick={sendToCalcom}>
                Agregar a Cal.com y Google Calendar
              </Button>
            )}
            {isRitualOnly(a) && open && (
              <div className="mt-3 space-y-2 rounded-2xl bg-lavender-50 p-3">
                <a
                  href={googleCalendarDayLink({
                    title: `✨ ${a.services.map((s) => s.name).join(' + ')} · ${a.client_name}`,
                    ymd: fmt.ymd(a.start_at),
                    tz: fmt.tz,
                    details: [`Ritual para ${a.client_name}`, a.contact_value && `Contacto: ${a.contact_value}`, `Cooperación: ${formatMoney(a.final_price, a.currency)}`, a.notes]
                      .filter(Boolean)
                      .join('\n'),
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-gold-400 to-gold-500 px-5 font-bold text-plum-900"
                >
                  <CalendarPlus className="size-4" /> Agregar a Google Calendar
                </a>
                <p className="text-xs text-plum-500">
                  Los rituales no ocupan una hora fija: se agregan como evento de día completo, que no bloquea tus horarios de Cal.com.
                </p>
              </div>
            )}
            {a.attended_at && (
              <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800">
                ✨ Atendida el <span className="capitalize">{fmt.dateShort(a.attended_at)}</span> a las {fmt.time(a.attended_at)}
              </p>
            )}
            {a.started_at && a.status === 'in_progress' && (
              <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800">Iniciada a las {fmt.time(a.started_at)}</p>
            )}
          </Card>

          <Card className="p-5">
            <Heading icon={<User />}>Cliente y contacto</Heading>
            <dl className="space-y-3 text-sm">
              <Row label="Cliente">
                {a.client_id ? (
                  <Link to={`/clientes/${a.client_id}`} className="font-bold text-rose-600">
                    {a.client_name}
                  </Link>
                ) : (
                  a.client_name
                )}
              </Row>
              <Row label="Plataforma">
                <span className="inline-flex items-center gap-1.5">
                  <PlatformIcon platform={a.platform} className="size-4" /> {PLATFORM_LABELS[a.platform]}
                </span>
              </Row>
              {a.contact_value && <Row label="Contacto">{a.contact_value}</Row>}
              {a.client?.phone && <Row label="Teléfono">{a.client.phone}</Row>}
              {a.client?.instagram && <Row label="Instagram">@{a.client.instagram.replace(/^@/, '')}</Row>}
              {a.client?.messenger && <Row label="Messenger">{a.client.messenger}</Row>}
              {a.client?.notes && <Row label="Notas del cliente">{a.client.notes}</Row>}
            </dl>
          </Card>

          <Card className="p-5">
            <Heading icon={<Wallet />}>Servicios y precio</Heading>
            <ul className="divide-y divide-lavender-100">
              {a.services.map((s, i) => (
                <li key={i} className="flex justify-between gap-3 py-2 text-sm">
                  <span>
                    <span className="font-bold text-plum-800">{s.name}</span>
                    <span className="block text-xs text-plum-500">
                      {s.category}
                      {s.duration_min ? ` · ${formatDuration(s.duration_min)}` : ''}
                    </span>
                  </span>
                  <span className="font-bold text-plum-700">{formatMoney(s.price, a.currency)}</span>
                </li>
              ))}
              {!a.services.length && <li className="py-2 text-sm text-plum-500">Sin servicios registrados</li>}
            </ul>
            {a.promotions.map((p, i) => (
              <p key={i} className="mt-2 rounded-xl bg-blush-50 px-3 py-2 text-sm font-semibold text-rose-700">
                🎁 {p.name}: {formatMoney(p.original_price, a.currency)} → {formatMoney(p.special_price, a.currency)} (ahorro {formatMoney(p.savings, a.currency)})
              </p>
            ))}
            <div className="gold-line my-3" />
            <dl className="space-y-1.5 text-sm">
              <Row label="Precio original">{formatMoney(a.original_price, a.currency)}</Row>
              <Row label="Descuento">{a.discount ? `− ${formatMoney(a.discount, a.currency)}` : '—'}</Row>
              <Row label="Precio final">
                <span className="text-base font-extrabold text-plum-800">{formatMoney(a.final_price, a.currency)}</span>
              </Row>
              <Row label="Total abonado">
                <span className="font-bold text-emerald-700">{formatMoney(a.paid_total, a.currency)}</span>
              </Row>
              <Row label="Saldo pendiente">
                <span className={cx('font-extrabold', a.balance > 0 ? 'text-rose-600' : 'text-emerald-600')}>{formatMoney(a.balance, a.currency)}</span>
              </Row>
            </dl>
          </Card>

          <Card className="p-5">
            <Heading
              icon={<CreditCard />}
              action={
                a.balance > 0 && (
                  <Button size="sm" onClick={() => actions.addPayment(a)}>
                    + Abono
                  </Button>
                )
              }
            >
              Historial de pagos
            </Heading>
            {a.payments?.length ? (
              <ul className="space-y-2">
                {a.payments.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-lavender-50/70 px-4 py-2.5 text-sm">
                    <div className="flex-1">
                      <p className="font-extrabold text-plum-800">{formatMoney(p.amount, a.currency)}</p>
                      <p className="text-xs text-plum-500">
                        <span className="capitalize">{fmt.dateShort(p.paid_at)}</span> · {p.method}
                        {p.note ? ` · ${p.note}` : ''}
                      </p>
                    </div>
                    <IconButton
                      label="Eliminar pago"
                      className="text-rose-500"
                      onClick={async () => {
                        if (await confirm({ title: 'Eliminar pago', message: `¿Eliminar el abono de ${formatMoney(p.amount, a.currency)}?`, confirmLabel: 'Eliminar', danger: true })) {
                          await delPay.mutateAsync(p.id);
                          toast('Pago eliminado');
                        }
                      }}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-plum-500">Aún no hay pagos registrados.</p>
            )}
          </Card>

          {a.notes && (
            <Card className="p-5">
              <Heading icon={<StickyNote />}>Notas personales</Heading>
              <p className="text-sm whitespace-pre-wrap text-plum-700">{a.notes}</p>
            </Card>
          )}

          {!!a.history?.length && (
            <Card className="p-5">
              <Heading icon={<History />}>Historial de la cita</Heading>
              <ol className="relative space-y-3 border-l-2 border-lavender-200 pl-4">
                {a.history.map((h) => (
                  <li key={h.id} className="text-sm">
                    <span className="absolute -left-[5px] mt-1.5 size-2 rounded-full bg-gold-500" />
                    <p className="font-bold text-plum-700">{h.action}</p>
                    {h.details && <p className="text-plum-600">{h.details}</p>}
                    <p className="text-xs text-plum-400">
                      <span className="capitalize">{fmt.dateShort(h.created_at)}</span> · {fmt.time(h.created_at)}
                    </p>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          <Button variant="ghost" className="w-full text-rose-600" icon={<Trash2 className="size-4" />} onClick={remove} loading={delAppt.isPending}>
            Eliminar cita
          </Button>
        </div>
      </Page>
    </>
  );
}

function Heading({ icon, children, action }: { icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 font-display text-xl font-bold text-plum-700 [&>svg]:size-5 [&>svg]:text-gold-500">
        {icon}
        {children}
      </h2>
      {action}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-plum-500">{label}</dt>
      <dd className="text-right font-semibold text-plum-700">{children}</dd>
    </div>
  );
}
