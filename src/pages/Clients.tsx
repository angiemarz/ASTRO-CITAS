import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, ChevronRight, MessageCircle, Pencil, Phone, Trash2, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { contactLink, formatMoney } from '../../shared/domain';
import type { Client } from '../../shared/types';
import { AppointmentCard } from '../components/AppointmentCard';
import { useFeedback } from '../components/feedback';
import { Page, PageHeader } from '../components/Layout';
import { Button, Card, EmptyState, ErrorBox, Field, IconButton, Input, LoadingBlock, SearchInput, Sheet, Textarea } from '../components/ui';
import { del, post, put } from '../lib/api';
import { useClient, useClients } from '../lib/hooks';
import { useFmt } from '../lib/settings';

function useDebounced(value: string, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ClientsPage() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data = [], isLoading, error } = useClients(dq);
  const [editing, setEditing] = useState<Partial<Client> | null>(null);
  const fmt = useFmt();

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle={`${data.length} cliente(s)`}
        actions={
          <Button size="sm" icon={<UserPlus className="size-4" />} onClick={() => setEditing({})}>
            Nuevo
          </Button>
        }
      >
        <SearchInput value={q} onChange={setQ} placeholder="Buscar por nombre, teléfono o usuario…" />
      </PageHeader>
      <Page>
        <ErrorBox error={error} />
        {isLoading ? (
          <LoadingBlock />
        ) : data.length ? (
          <div className="card divide-y divide-lavender-100 overflow-hidden">
            {data.map((c) => {
              const owed = (c.total_billed ?? 0) - (c.total_paid ?? 0);
              return (
                <Link key={c.id} to={`/clientes/${c.id}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-lavender-50 hover:bg-lavender-50/60">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-lavender-200 to-blush-200 font-display text-lg font-bold text-plum-700">
                    {c.full_name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-extrabold text-plum-800">{c.full_name}</span>
                    <span className="block truncate text-xs text-plum-500">
                      {c.appointment_count ?? 0} cita(s)
                      {c.next_appointment_at ? ` · próxima ${fmt.dateShort(c.next_appointment_at)}` : c.last_appointment_at ? ` · última ${fmt.dateShort(c.last_appointment_at)}` : ''}
                      {c.phone ? ` · ${c.phone}` : ''}
                    </span>
                  </span>
                  {owed > 0.009 && <span className="rounded-full bg-blush-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">Debe</span>}
                  <ChevronRight className="size-5 text-plum-300" />
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="card">
            <EmptyState icon={<Users className="size-7" />} title={q ? 'Sin coincidencias' : 'Aún no hay clientes'}>
              {q ? 'Prueba con otro nombre o dato.' : 'Los clientes se registran automáticamente al crear una cita, o puedes agregarlos aquí.'}
            </EmptyState>
          </div>
        )}
      </Page>
      {editing && <ClientSheet client={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ClientSheet({ client, onClose }: { client: Partial<Client>; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [form, setForm] = useState({
    full_name: client.full_name ?? '',
    phone: client.phone ?? '',
    instagram: client.instagram ?? '',
    messenger: client.messenger ?? '',
    notes: client.notes ?? '',
  });
  const m = useMutation({
    mutationFn: () => (client.id ? put(`/clients/${client.id}`, form) : post('/clients', form)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['client'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      toast(client.id ? 'Cliente actualizado' : 'Cliente registrado');
      onClose();
    },
  });
  const f = (k: keyof typeof form) => ({ value: form[k], onChange: (e: { target: { value: string } }) => setForm((s) => ({ ...s, [k]: e.target.value })) });
  return (
    <Sheet
      open
      onClose={onClose}
      title={client.id ? 'Editar cliente' : 'Nuevo cliente'}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button className="flex-1" loading={m.isPending} disabled={!form.full_name.trim()} onClick={() => m.mutate()}>
            Guardar
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Nombre completo" required>
          <Input {...f('full_name')} autoFocus />
        </Field>
        <Field label="Teléfono">
          <Input type="tel" inputMode="tel" {...f('phone')} />
        </Field>
        <Field label="Instagram">
          <Input {...f('instagram')} autoCapitalize="none" placeholder="@usuario" />
        </Field>
        <Field label="Messenger">
          <Input {...f('messenger')} autoCapitalize="none" />
        </Field>
        <Field label="Notas personales">
          <Textarea {...f('notes')} />
        </Field>
        <ErrorBox error={m.error} />
      </div>
    </Sheet>
  );
}

export function ClientDetailPage() {
  const id = Number(useParams().id);
  const { data: c, isLoading } = useClient(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { confirm, toast } = useFeedback();
  const [editing, setEditing] = useState(false);

  if (isLoading) return <LoadingBlock />;
  if (!c)
    return (
      <>
        <PageHeader title="Cliente" back />
        <Page>No se encontró el cliente.</Page>
      </>
    );

  const owed = (c.total_billed ?? 0) - (c.total_paid ?? 0);
  const wa = c.phone ? contactLink('whatsapp', c.phone) : null;
  const tel = c.phone ? contactLink('phone', c.phone) : null;
  const ig = c.instagram ? contactLink('instagram', c.instagram) : null;
  const ms = c.messenger ? contactLink('messenger', c.messenger) : null;

  const remove = async () => {
    const ok = await confirm({
      title: 'Eliminar cliente',
      message: 'Se eliminará la ficha del cliente. Sus citas se conservarán con su nombre.',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    await del(`/clients/${c.id}`);
    qc.invalidateQueries({ queryKey: ['clients'] });
    toast('Cliente eliminado');
    navigate('/clientes', { replace: true });
  };

  return (
    <>
      <PageHeader
        title={c.full_name}
        back
        actions={
          <IconButton label="Editar cliente" onClick={() => setEditing(true)}>
            <Pencil className="size-5" />
          </IconButton>
        }
      />
      <Page>
        <div className="mx-auto max-w-2xl space-y-4">
          <Card className="p-5">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-2xl font-extrabold text-plum-800">{c.appointment_count ?? 0}</p>
                <p className="text-xs font-bold text-plum-500">Citas</p>
              </div>
              <div>
                <p className="text-sm font-extrabold text-emerald-700">{formatMoney(c.total_paid ?? 0)}</p>
                <p className="text-xs font-bold text-plum-500">Pagado</p>
              </div>
              <div>
                <p className={`text-sm font-extrabold ${owed > 0.009 ? 'text-rose-600' : 'text-plum-700'}`}>{formatMoney(Math.max(0, owed))}</p>
                <p className="text-xs font-bold text-plum-500">Saldo</p>
              </div>
            </div>
            <div className="gold-line my-4" />
            <dl className="space-y-2 text-sm">
              {c.phone && <Info label="Teléfono" value={c.phone} />}
              {c.instagram && <Info label="Instagram" value={`@${c.instagram.replace(/^@/, '')}`} />}
              {c.messenger && <Info label="Messenger" value={c.messenger} />}
              {c.notes && <Info label="Notas" value={c.notes} />}
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" icon={<CalendarPlus className="size-4" />} onClick={() => navigate(`/nueva?client=${c.id}`)}>
                Agendar cita
              </Button>
              {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="soft" icon={<MessageCircle className="size-4" />}>
                    WhatsApp
                  </Button>
                </a>
              )}
              {tel && (
                <a href={tel}>
                  <Button size="sm" variant="soft" icon={<Phone className="size-4" />}>
                    Llamar
                  </Button>
                </a>
              )}
              {ig && (
                <a href={ig} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="soft">
                    Instagram
                  </Button>
                </a>
              )}
              {ms && (
                <a href={ms} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="soft">
                    Messenger
                  </Button>
                </a>
              )}
            </div>
          </Card>

          <h2 className="font-display text-2xl font-bold text-plum-700">Historial de citas</h2>
          {c.appointments.length ? (
            <div className="space-y-3">
              {c.appointments.map((a) => (
                <AppointmentCard key={a.id} appt={a} compact />
              ))}
            </div>
          ) : (
            <p className="text-sm text-plum-500">Este cliente aún no tiene citas.</p>
          )}
          <Button variant="ghost" className="w-full text-rose-600" icon={<Trash2 className="size-4" />} onClick={remove}>
            Eliminar cliente
          </Button>
        </div>
      </Page>
      {editing && <ClientSheet client={c} onClose={() => setEditing(false)} />}
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-plum-500">{label}</dt>
      <dd className="text-right font-semibold whitespace-pre-wrap text-plum-700">{value}</dd>
    </div>
  );
}
