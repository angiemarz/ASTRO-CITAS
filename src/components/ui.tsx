import { Loader2, Search, X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { PAYMENT_LABELS, STATUS_LABELS } from '../../shared/domain';
import type { AppointmentStatus, PaymentStatus } from '../../shared/types';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft' | 'gold';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-gradient-to-r from-plum-600 to-rose-500 text-white shadow-glow active:brightness-95',
  secondary: 'bg-white text-plum-700 border border-lavender-200 active:bg-lavender-50',
  ghost: 'text-plum-600 active:bg-lavender-100',
  danger: 'bg-white text-rose-700 border border-blush-200 active:bg-blush-50',
  soft: 'bg-lavender-100 text-plum-700 active:bg-lavender-200',
  gold: 'bg-gradient-to-r from-gold-400 to-gold-500 text-plum-900 active:brightness-95',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }
>(function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-full font-bold transition disabled:opacity-50',
        size === 'sm' && 'min-h-9 px-3.5 text-sm',
        size === 'md' && 'min-h-11 px-5 text-[15px]',
        size === 'lg' && 'min-h-13 px-6 text-base',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx('inline-flex size-10 items-center justify-center rounded-full text-plum-600 transition active:bg-lavender-100', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('card', className)} {...rest}>
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('block', className)}>
      {label && (
        <span className="mb-1.5 block text-sm font-bold text-plum-700">
          {label}
          {required && <span className="ml-0.5 text-rose-500">*</span>}
        </span>
      )}
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-plum-500/80">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-semibold text-rose-600">{error}</span>}
    </label>
  );
}

const inputBase =
  'w-full rounded-2xl border border-lavender-200 bg-white/90 px-4 py-3 text-plum-800 placeholder:text-plum-400/60 outline-none transition focus:border-lavender-400 focus:ring-4 focus:ring-lavender-200/60 disabled:bg-lavender-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(inputBase, 'min-h-12', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={3} className={cx(inputBase, 'resize-y', className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        inputBase,
        'min-h-12 appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%2374428a%27 stroke-width=%272.5%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E")] bg-[length:16px] bg-[right_1rem_center] bg-no-repeat pr-10',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Buscar…',
  className,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={cx('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-4 size-4.5 -translate-y-1/2 text-plum-400" />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cx(inputBase, 'min-h-12 pl-11', value && 'pr-10')}
      />
      {value && (
        <button
          type="button"
          aria-label="Limpiar búsqueda"
          onClick={() => onChange('')}
          className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-plum-400 active:bg-lavender-100"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 py-2 text-left"
    >
      <span>
        <span className="block font-bold text-plum-700">{label}</span>
        {description && <span className="block text-sm text-plum-500/80">{description}</span>}
      </span>
      <span className={cx('relative h-7 w-12 shrink-0 rounded-full transition', checked ? 'bg-rose-500' : 'bg-lavender-200')}>
        <span className={cx('absolute top-0.5 size-6 rounded-full bg-white shadow transition-all', checked ? 'left-5.5' : 'left-0.5')} />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
  className?: string;
}) {
  return (
    <div className={cx('no-scrollbar flex gap-1.5 overflow-x-auto rounded-full bg-lavender-100/80 p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-bold whitespace-nowrap transition',
            value === o.value ? 'bg-white text-plum-700 shadow-soft' : 'text-plum-500',
          )}
        >
          {o.label}
          {o.count !== undefined && (
            <span
              className={cx(
                'min-w-5 rounded-full px-1.5 text-xs leading-5',
                value === o.value ? 'bg-rose-500 text-white' : 'bg-white/70 text-plum-500',
              )}
            >
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'min-h-10 rounded-full border px-4 text-sm font-bold transition',
        active ? 'border-plum-600 bg-plum-600 text-white' : 'border-lavender-200 bg-white text-plum-600 active:bg-lavender-50',
      )}
    >
      {children}
    </button>
  );
}

const STATUS_STYLE: Record<AppointmentStatus, string> = {
  scheduled: 'bg-lavender-100 text-plum-600',
  confirmed: 'bg-sky-50 text-sky-700 ring-1 ring-sky-100',
  in_progress: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100',
  completed: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
  cancelled: 'bg-stone-100 text-stone-500',
  no_show: 'bg-blush-100 text-rose-700',
};

export const STATUS_COLOR: Record<AppointmentStatus, string> = {
  scheduled: '#9277cf',
  confirmed: '#4f8fd6',
  in_progress: '#d99a2b',
  completed: '#3fa57a',
  cancelled: '#b0a8b4',
  no_show: '#e0569a',
};

export function StatusBadge({ status, className }: { status: AppointmentStatus; className?: string }) {
  return (
    <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold', STATUS_STYLE[status], className)}>
      {STATUS_LABELS[status]}
    </span>
  );
}

const PAY_STYLE: Record<PaymentStatus, string> = {
  unpaid: 'bg-blush-100 text-rose-700',
  partial: 'bg-gold-300/40 text-gold-600',
  paid: 'bg-emerald-50 text-emerald-700',
};

export function PaymentBadge({ status, className }: { status: PaymentStatus; className?: string }) {
  return (
    <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold', PAY_STYLE[status], className)}>
      {status === 'partial' ? 'Abono parcial' : status === 'paid' ? 'Pagada' : PAYMENT_LABELS.unpaid}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-6 animate-spin text-lavender-400', className)} />;
}

export function LoadingBlock() {
  return (
    <div className="flex justify-center py-16">
      <Spinner className="size-8" />
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 flex size-16 items-center justify-center rounded-full gradient-soft text-plum-500">{icon}</div>
      <p className="font-display text-xl font-bold text-plum-700">{title}</p>
      {children && <div className="mt-2 max-w-sm text-sm text-plum-500">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="rounded-2xl border border-blush-200 bg-blush-50 px-4 py-3 text-sm font-semibold text-rose-700">
      {(error as Error).message || 'Ocurrió un error.'}
    </div>
  );
}

/** Hoja inferior en iPhone, diálogo centrado en computadora. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-plum-900/35 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={cx(
          'animate-sheet-up relative flex max-h-[92dvh] w-full flex-col rounded-t-4xl bg-cream shadow-2xl sm:animate-fade-up sm:rounded-4xl',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-lg',
        )}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-11 rounded-full bg-lavender-200 sm:hidden" />
        <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-2 sm:pt-5">
          <h2 className="font-display text-2xl font-bold text-plum-700">{title}</h2>
          <IconButton label="Cerrar" onClick={onClose}>
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
        {footer && <div className="border-t border-lavender-100 px-5 pt-3 pb-[calc(0.9rem+var(--safe-bottom))]">{footer}</div>}
        {!footer && <div className="pb-[var(--safe-bottom)]" />}
      </div>
    </div>,
    document.body,
  );
}

export function SectionTitle({ children, action, icon }: { children: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 font-display text-[1.45rem] font-bold text-plum-700">
        {icon && <span className="text-gold-500">{icon}</span>}
        {children}
      </h2>
      {action}
    </div>
  );
}
