import { useId } from 'react';
import { useSettings } from '../lib/settings';
import { cx } from './ui';

/** Logotipo: usa el logo subido en Configuración o el emblema por defecto (luna + flor + estrellas). */
export function Logo({ className }: { className?: string }) {
  const { logo, business_name } = useSettings();
  if (logo) return <img src={logo} alt={business_name} className={cx('rounded-full object-cover', className)} />;
  return <Emblem className={className} />;
}

export function Emblem({ className }: { className?: string }) {
  // IDs únicos: si otra copia del emblema está oculta (display:none), sus degradados no se pintarían.
  const uid = useId().replace(/:/g, '');
  const bg = `abx-bg-${uid}`;
  const gold = `abx-gold-${uid}`;
  return (
    <svg viewBox="0 0 64 64" className={cx('rounded-full', className)} aria-hidden="true">
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#74428a" />
          <stop offset="1" stopColor="#e0569a" />
        </linearGradient>
        <linearGradient id={gold} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3e2b5" />
          <stop offset="1" stopColor="#c5a25a" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="31" fill={`url(#${bg})`} />
      <circle cx="32" cy="32" r="27.5" fill="none" stroke={`url(#${gold})`} strokeWidth="0.8" opacity="0.8" />
      <path d="M36 14a17 17 0 1 0 14 26.5A14 14 0 1 1 36 14Z" fill={`url(#${gold})`} />
      <g transform="translate(25 33)" fill="#fde7f0">
        {[0, 72, 144, 216, 288].map((r) => (
          <ellipse key={r} rx="2.6" ry="5" transform={`rotate(${r}) translate(0 -4.4)`} opacity="0.95" />
        ))}
        <circle r="2.2" fill="#ead7a8" />
      </g>
      <path d="M46 16l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z" fill="#fff6dc" />
      <circle cx="50" cy="28" r="1" fill="#fff6dc" />
      <circle cx="42" cy="47" r="0.9" fill="#fff6dc" />
    </svg>
  );
}

export function Sparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
      <circle cx="19" cy="19" r="1.4" />
      <circle cx="5" cy="19" r="0.9" />
    </svg>
  );
}

/** Pequeña constelación decorativa para encabezados. */
export function Constellation({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 40" className={className} aria-hidden="true" fill="none">
      <path d="M4 30 L28 12 L52 22 L78 6 L100 18 L116 10" stroke="currentColor" strokeWidth="0.7" opacity="0.5" />
      {[
        [4, 30],
        [28, 12],
        [52, 22],
        [78, 6],
        [100, 18],
        [116, 10],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 2 ? 1.8 : 1.3} fill="currentColor" className="animate-twinkle" style={{ animationDelay: `${i * 0.4}s` }} />
      ))}
    </svg>
  );
}
