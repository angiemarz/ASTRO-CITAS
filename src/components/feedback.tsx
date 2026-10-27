import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Button, cx, Sheet } from './ui';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
}

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface FeedbackApi {
  toast: (message: string, kind?: ToastKind, action?: Toast['action']) => void;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
}

const Ctx = createContext<FeedbackApi>({ toast: () => {}, confirm: async () => false });

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const idRef = useRef(0);

  const toast = useCallback<FeedbackApi['toast']>((message, kind = 'success', action) => {
    const id = ++idRef.current;
    setToasts((t) => [...t.slice(-2), { id, kind, message, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 6500 : 3800);
  }, []);

  const confirm = useCallback<FeedbackApi['confirm']>(
    (o) => new Promise<boolean>((resolve) => setDialog({ ...o, resolve })),
    [],
  );

  const close = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[calc(var(--safe-top)+0.75rem)] z-[60] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'animate-fade-up pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border px-4 py-3 shadow-soft backdrop-blur-md',
              t.kind === 'success' && 'border-emerald-100 bg-white/95 text-emerald-800',
              t.kind === 'error' && 'border-blush-200 bg-white/95 text-rose-700',
              t.kind === 'info' && 'border-lavender-200 bg-white/95 text-plum-700',
            )}
            role="status"
          >
            {t.kind === 'success' && <CheckCircle2 className="size-5 shrink-0" />}
            {t.kind === 'error' && <XCircle className="size-5 shrink-0" />}
            {t.kind === 'info' && <Info className="size-5 shrink-0" />}
            <span className="flex-1 text-sm font-semibold">{t.message}</span>
            {t.action && (
              <button
                className="rounded-full bg-lavender-100 px-3 py-1.5 text-xs font-bold text-plum-700"
                onClick={() => {
                  t.action!.onClick();
                  setToasts((x) => x.filter((y) => y.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      <Sheet
        open={!!dialog}
        onClose={() => close(false)}
        title={
          <span className="flex items-center gap-2">
            {dialog?.danger && <AlertTriangle className="size-6 text-rose-500" />}
            {dialog?.title}
          </span>
        }
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => close(false)}>
              {dialog?.cancelLabel ?? 'Volver'}
            </Button>
            <Button variant={dialog?.danger ? 'danger' : 'primary'} className="flex-1" onClick={() => close(true)}>
              {dialog?.confirmLabel ?? 'Confirmar'}
            </Button>
          </div>
        }
      >
        <div className="pb-2 text-plum-600">{dialog?.message}</div>
      </Sheet>
    </Ctx.Provider>
  );
}

export const useFeedback = () => useContext(Ctx);
