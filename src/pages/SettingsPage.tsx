import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BellOff,
  Clock,
  Database,
  Download,
  ImagePlus,
  KeyRound,
  LogOut,
  Palette,
  Plus,
  Send,
  Shield,
  Smartphone,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isValidTimeZone } from '../../shared/time';
import type { Settings } from '../../shared/types';
import { Logo } from '../components/Brand';
import { useFeedback } from '../components/feedback';
import { Page, PageHeader } from '../components/Layout';
import { TimePicker } from '../components/TimePicker';
import { Button, Card, Chip, ErrorBox, Field, Input, Select, Toggle } from '../components/ui';
import { get, post, put } from '../lib/api';
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, pushSupported, type PushInfo } from '../lib/push';
import { useSettings } from '../lib/settings';

const TIMEZONES = [
  'America/Monterrey',
  'America/Mexico_City',
  'America/Cancun',
  'America/Chihuahua',
  'America/Mazatlan',
  'America/Hermosillo',
  'America/Tijuana',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/Madrid',
];

const OFFSETS: { value: number; label: string }[] = [
  { value: 2880, label: '2 días antes' },
  { value: 1440, label: '1 día antes' },
  { value: 180, label: '3 h antes' },
  { value: 120, label: '2 h antes' },
  { value: 60, label: '1 h antes' },
  { value: 30, label: '30 min antes' },
  { value: 15, label: '15 min antes' },
  { value: 5, label: '5 min antes' },
  { value: 0, label: 'Al iniciar' },
];

export function SettingsPage() {
  const s = useSettings();
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => put<Settings>('/settings', patch),
    onSuccess: (data) => {
      qc.setQueryData(['settings'], data);
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast('Configuración guardada');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const patch = (p: Partial<Settings>) => save.mutate(p);

  return (
    <>
      <PageHeader title="Configuración" />
      <Page>
        <div className="mx-auto max-w-2xl space-y-5">
          <BrandSection s={s} patch={patch} />
          <NotificationsSection s={s} patch={patch} />

          <Section icon={<Clock />} title="Fecha y hora">
            <Field label="Zona horaria">
              <Select value={TIMEZONES.includes(s.timezone) ? s.timezone : '__other'} onChange={(e) => e.target.value !== '__other' && patch({ timezone: e.target.value })}>
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, ' ')}
                  </option>
                ))}
                <option value="__other">{TIMEZONES.includes(s.timezone) ? 'Otra…' : s.timezone}</option>
              </Select>
            </Field>
            <OtherTimezone current={s.timezone} onSave={(tz) => patch({ timezone: tz })} />
            <Field label="Formato de hora">
              <div className="flex gap-2">
                <Chip active={s.time_format === '12h'} onClick={() => patch({ time_format: '12h' })}>
                  12 horas (3:30 PM)
                </Chip>
                <Chip active={s.time_format === '24h'} onClick={() => patch({ time_format: '24h' })}>
                  24 horas (15:30)
                </Chip>
              </div>
            </Field>
            <Field label="Duración predeterminada de una cita (min)">
              <NumberSave value={s.default_duration_min} onSave={(v) => patch({ default_duration_min: v })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Calendario desde (hora)">
                <NumberSave value={s.calendar_start_hour} min={0} max={23} onSave={(v) => patch({ calendar_start_hour: v })} />
              </Field>
              <Field label="Calendario hasta (hora)">
                <NumberSave value={s.calendar_end_hour} min={1} max={24} onSave={(v) => patch({ calendar_end_hour: v })} />
              </Field>
            </div>
            <Toggle checked={s.week_starts_monday} onChange={(v) => patch({ week_starts_monday: v })} label="La semana inicia en lunes" />
          </Section>

          <Section icon={<Wallet />} title="Moneda y pagos">
            <Field label="Moneda predeterminada">
              <div className="flex gap-2">
                <Chip active={s.default_currency === 'MXN'} onClick={() => patch({ default_currency: 'MXN' })}>
                  MXN
                </Chip>
                <Chip active={s.default_currency === 'USD'} onClick={() => patch({ default_currency: 'USD' })}>
                  USD
                </Chip>
              </div>
            </Field>
            <PaymentMethods methods={s.payment_methods} onSave={(m) => patch({ payment_methods: m })} />
          </Section>

          <SecuritySection />
          <BackupSection />

          <p className="pb-4 text-center text-xs text-plum-400">AstroBloomx Agenda · v1.0 · hecha con 💜 y luz de luna</p>
        </div>
      </Page>
    </>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="space-y-4 p-5">
      <h2 className="flex items-center gap-2.5 font-display text-[1.4rem] font-bold text-plum-700">
        <span className="flex size-9 items-center justify-center rounded-xl gradient-soft text-plum-600 [&>svg]:size-[18px]">{icon}</span>
        {title}
      </h2>
      {children}
    </Card>
  );
}

function NumberSave({ value, onSave, min = 0, max = 1440 }: { value: number; onSave: (v: number) => void; min?: number; max?: number }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <Input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = Number(v);
        if (Number.isFinite(n) && n !== value) onSave(Math.min(max, Math.max(min, Math.round(n))));
      }}
    />
  );
}

function OtherTimezone({ current, onSave }: { current: string; onSave: (tz: string) => void }) {
  const [tz, setTz] = useState('');
  const valid = tz && isValidTimeZone(tz);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-bold text-plum-500">Escribir otra zona horaria (IANA)</summary>
      <div className="mt-2 flex gap-2">
        <Input value={tz} onChange={(e) => setTz(e.target.value)} placeholder={current} autoCapitalize="none" />
        <Button variant="secondary" disabled={!valid} onClick={() => onSave(tz)}>
          Guardar
        </Button>
      </div>
    </details>
  );
}

function BrandSection({ s, patch }: { s: Settings; patch: (p: Partial<Settings>) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(s.business_name);
  const { toast } = useFeedback();
  useEffect(() => setName(s.business_name), [s.business_name]);

  const onFile = async (file: File) => {
    try {
      const dataUrl = await resizeImage(file, 512);
      patch({ logo: dataUrl });
    } catch {
      toast('No se pudo leer la imagen', 'error');
    }
  };

  return (
    <Section icon={<Palette />} title="Mi marca">
      <div className="flex items-center gap-4">
        <Logo className="size-20 shadow-soft" />
        <div className="flex flex-col gap-2">
          <Button size="sm" variant="secondary" icon={<ImagePlus className="size-4" />} onClick={() => fileRef.current?.click()}>
            {s.logo ? 'Cambiar logotipo' : 'Subir mi logotipo'}
          </Button>
          {s.logo && (
            <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => patch({ logo: null })}>
              Usar emblema original
            </Button>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </div>
      </div>
      <p className="text-xs text-plum-400">
        Tu logotipo se muestra dentro de la app. Para cambiar también el ícono de la pantalla de inicio, reemplaza los archivos de <code>public/icons</code> (ver README).
      </p>
      <Field label="Nombre del negocio">
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="secondary" disabled={name === s.business_name || !name.trim()} onClick={() => patch({ business_name: name.trim() })}>
            Guardar
          </Button>
        </div>
      </Field>
    </Section>
  );
}

async function resizeImage(file: File, size: number): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, size / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function NotificationsSection({ s, patch }: { s: Settings; patch: (p: Partial<Settings>) => void }) {
  const { toast } = useFeedback();
  const info = useQuery({ queryKey: ['push'], queryFn: () => get<PushInfo>('/push') });
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [overdueMin, setOverdueMin] = useState(s.overdue_after_min);
  useEffect(() => {
    currentSubscription().then((sub) => setSubscribed(!!sub));
  }, []);

  const toggleOffset = (v: number) => {
    const set = new Set(s.reminder_offsets);
    set.has(v) ? set.delete(v) : set.add(v);
    patch({ reminder_offsets: [...set] });
  };

  const enable = async () => {
    setBusy(true);
    try {
      await enablePush();
      setSubscribed(true);
      info.refetch();
      toast('🔔 Notificaciones activadas en este dispositivo');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await disablePush();
      setSubscribed(false);
      info.refetch();
      toast('Notificaciones desactivadas en este dispositivo', 'info');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    try {
      const r = await post<{ sent: number; failed: number }>('/push/test');
      toast(r.sent ? `Notificación de prueba enviada a ${r.sent} dispositivo(s)` : 'No hay dispositivos activos', r.sent ? 'success' : 'info');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const needsInstall = isIos() && !isStandalone();

  return (
    <Section icon={<Bell />} title="Recordatorios push">
      {info.data && !info.data.configured && (
        <p className="rounded-2xl bg-gold-300/30 px-4 py-3 text-sm text-plum-700">
          El servidor aún no tiene llaves VAPID. Sigue el paso “Notificaciones” del README para activarlas.
        </p>
      )}
      {needsInstall && (
        <div className="flex gap-3 rounded-2xl bg-lavender-50 p-4 text-sm text-plum-700">
          <Smartphone className="size-5 shrink-0 text-plum-500" />
          <p>
            Para recibir recordatorios en tu iPhone, primero instala la app: en Safari toca <strong>Compartir</strong> →{' '}
            <strong>“Agregar a pantalla de inicio”</strong>, ábrela desde el ícono y vuelve aquí.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {subscribed ? (
          <Button variant="secondary" icon={<BellOff className="size-4" />} loading={busy} onClick={disable}>
            Desactivar en este dispositivo
          </Button>
        ) : (
          <Button icon={<Bell className="size-4" />} loading={busy} onClick={enable} disabled={!pushSupported() && !needsInstall}>
            Activar en este dispositivo
          </Button>
        )}
        <Button variant="soft" icon={<Send className="size-4" />} onClick={test} disabled={!info.data?.devices}>
          Enviar prueba
        </Button>
      </div>
      <p className="text-xs text-plum-400">
        {info.data ? `${info.data.devices} dispositivo(s) registrado(s).` : ''} {subscribed ? 'Este dispositivo recibe recordatorios.' : ''}
      </p>
      <Field label="Avisarme antes de cada cita">
        <div className="flex flex-wrap gap-2">
          {OFFSETS.map((o) => (
            <Chip key={o.value} active={s.reminder_offsets.includes(o.value)} onClick={() => toggleOffset(o.value)}>
              {o.label}
            </Chip>
          ))}
        </div>
      </Field>
      <Toggle
        checked={s.overdue_reminder}
        onChange={(v) => patch({ overdue_reminder: v })}
        label="Avisar si una cita terminó y no la marqué"
        description="Te recuerda marcarla como atendida, no asistió o cancelada."
      />
      {s.overdue_reminder && (
        <Field label="Minutos después de terminar">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={overdueMin}
            onChange={(e) => setOverdueMin(Number(e.target.value))}
            onBlur={() => overdueMin !== s.overdue_after_min && patch({ overdue_after_min: overdueMin })}
          />
        </Field>
      )}
      <Toggle checked={s.daily_summary} onChange={(v) => patch({ daily_summary: v })} label="Resumen diario" description="Una notificación con tus citas del día." />
      {s.daily_summary && (
        <Field label="Hora del resumen">
          <TimePicker value={s.daily_summary_time} step={15} onChange={(v) => patch({ daily_summary_time: v })} />
        </Field>
      )}
      <p className="text-xs text-plum-400">Los recordatorios se revisan cada 5 minutos, por lo que pueden llegar con unos minutos de diferencia.</p>
    </Section>
  );
}

function PaymentMethods({ methods, onSave }: { methods: string[]; onSave: (m: string[]) => void }) {
  const [list, setList] = useState(methods);
  const [nv, setNv] = useState('');
  useEffect(() => setList(methods), [methods]);
  const changed = JSON.stringify(list) !== JSON.stringify(methods);
  return (
    <Field label="Métodos de pago">
      <div className="flex flex-wrap gap-2">
        {list.map((m) => (
          <span key={m} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-lavender-100 pr-1 pl-3 text-sm font-bold text-plum-700">
            {m}
            <button type="button" aria-label={`Quitar ${m}`} onClick={() => setList(list.filter((x) => x !== m))} className="flex size-7 items-center justify-center rounded-full active:bg-lavender-200">
              <X className="size-3.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Input value={nv} onChange={(e) => setNv(e.target.value)} placeholder="Agregar método…" />
        <Button
          type="button"
          variant="secondary"
          icon={<Plus className="size-4" />}
          disabled={!nv.trim()}
          onClick={() => {
            setList([...list, nv.trim()]);
            setNv('');
          }}
        >
          Agregar
        </Button>
      </div>
      {changed && (
        <Button className="mt-3" size="sm" onClick={() => onSave(list)}>
          Guardar métodos
        </Button>
      )}
    </Field>
  );
}

function SecuritySection() {
  const { toast, confirm } = useFeedback();
  const qc = useQueryClient();
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [nw2, setNw2] = useState('');
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => get<{ created_at: string; last_seen_at: string; user_agent: string; current: boolean }[]>('/auth/sessions'),
  });
  const change = useMutation({
    mutationFn: () => {
      if (nw !== nw2) throw new Error('Las contraseñas nuevas no coinciden.');
      return post('/auth/password', { current_password: cur, new_password: nw });
    },
    onSuccess: () => {
      setCur('');
      setNw('');
      setNw2('');
      sessions.refetch();
      toast('Contraseña actualizada. Se cerraron las demás sesiones.');
    },
  });
  const device = (ua: string) =>
    /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Navegador';

  return (
    <Section icon={<Shield />} title="Seguridad">
      <div className="space-y-3">
        <p className="flex items-center gap-2 font-bold text-plum-700">
          <KeyRound className="size-4" /> Cambiar contraseña
        </p>
        <Input type="password" placeholder="Contraseña actual" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
        <Input type="password" placeholder="Nueva contraseña (mín. 10 caracteres)" value={nw} onChange={(e) => setNw(e.target.value)} autoComplete="new-password" />
        <Input type="password" placeholder="Confirmar nueva contraseña" value={nw2} onChange={(e) => setNw2(e.target.value)} autoComplete="new-password" />
        <ErrorBox error={change.error} />
        <Button variant="secondary" loading={change.isPending} disabled={!cur || nw.length < 10} onClick={() => change.mutate()}>
          Actualizar contraseña
        </Button>
      </div>
      <div className="gold-line" />
      <div>
        <p className="mb-2 font-bold text-plum-700">Sesiones abiertas</p>
        <ul className="space-y-1.5 text-sm">
          {sessions.data?.map((x, i) => (
            <li key={i} className="flex justify-between rounded-xl bg-lavender-50 px-3 py-2">
              <span className="font-semibold text-plum-700">
                {device(x.user_agent)} {x.current && <span className="text-xs text-rose-600">(este dispositivo)</span>}
              </span>
              <span className="text-xs text-plum-500">{new Date(x.last_seen_at).toLocaleDateString('es-MX')}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await post('/auth/logout-all');
              sessions.refetch();
              toast('Se cerraron las demás sesiones');
            }}
          >
            Cerrar otras sesiones
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<LogOut className="size-4" />}
            onClick={async () => {
              if (await confirm({ title: 'Cerrar sesión', message: '¿Salir de la agenda en este dispositivo?', confirmLabel: 'Cerrar sesión' })) {
                await post('/auth/logout');
                qc.clear();
                window.location.href = '/';
              }
            }}
          >
            Cerrar sesión
          </Button>
        </div>
      </div>
    </Section>
  );
}

function BackupSection() {
  const { toast, confirm } = useFeedback();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    const data = await get<unknown>('/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `astrobloomx-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Respaldo descargado');
  };

  const restore = async (file: File) => {
    let backup: unknown;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      toast('El archivo no es un JSON válido', 'error');
      return;
    }
    const ok = await confirm({
      title: 'Restaurar respaldo',
      message: 'Se reemplazará TODA la información actual (citas, clientes, servicios, pagos y configuración) por la del respaldo. Tu contraseña no cambia.',
      confirmLabel: 'Restaurar',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await post('/import', { confirm: 'RESTAURAR', backup });
      await qc.invalidateQueries();
      toast('Respaldo restaurado');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={<Database />} title="Respaldo de información">
      <p className="text-sm text-plum-500">
        Tu información vive en tu base de datos de Cloudflare D1. Descarga un respaldo de vez en cuando para mayor tranquilidad.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={<Download className="size-4" />} onClick={download}>
          Descargar respaldo
        </Button>
        <Button variant="ghost" icon={<Upload className="size-4" />} loading={busy} onClick={() => fileRef.current?.click()}>
          Restaurar
        </Button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
      </div>
    </Section>
  );
}
