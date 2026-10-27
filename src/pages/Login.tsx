import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { post } from '../lib/api';
import { Constellation, Emblem } from '../components/Brand';
import { Button, ErrorBox, Field, Input } from '../components/ui';

export function LoginPage({ configured, onDone }: { configured: boolean; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!configured && password !== confirm) {
      setError(new Error('Las contraseñas no coinciden.'));
      return;
    }
    setLoading(true);
    try {
      if (configured) await post('/auth/login', { password });
      else await post('/auth/setup', { password, setup_code: setupCode });
      onDone();
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pt-safe pb-safe flex min-h-dvh items-center justify-center px-5">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <Constellation className="mb-2 h-8 w-32 text-gold-500" />
          <Emblem className="size-24 drop-shadow-xl" />
          <h1 className="mt-5 font-display text-4xl font-bold text-plum-700">AstroBloomx</h1>
          <p className="mt-1 text-xs font-bold tracking-[0.35em] text-gold-500 uppercase">Agenda</p>
          <p className="mt-4 text-sm text-plum-500">
            {configured ? 'Bienvenida de nuevo ✨ Ingresa tu contraseña.' : 'Primera vez aquí. Crea tu contraseña personal para proteger tu agenda.'}
          </p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          {!configured && (
            <Field label="Código de configuración" hint="Es el valor de SETUP_CODE que guardaste en Cloudflare.">
              <Input value={setupCode} onChange={(e) => setSetupCode(e.target.value)} autoComplete="off" required />
            </Field>
          )}
          <Field label={configured ? 'Contraseña' : 'Nueva contraseña'} hint={!configured ? 'Mínimo 10 caracteres.' : undefined}>
            <div className="relative">
              <Input
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={configured ? 'current-password' : 'new-password'}
                autoFocus
                required
                className="pr-12"
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                className="absolute top-1/2 right-2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-plum-400"
                aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
              </button>
            </div>
          </Field>
          {!configured && (
            <Field label="Confirmar contraseña">
              <Input type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </Field>
          )}
          <ErrorBox error={error} />
          <Button type="submit" size="lg" className="w-full" loading={loading} icon={<KeyRound className="size-5" />}>
            {configured ? 'Entrar' : 'Crear contraseña'}
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-plum-400">Agenda privada · solo para uso personal</p>
      </div>
    </div>
  );
}
