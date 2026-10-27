import {
  CalendarDays,
  CalendarHeart,
  ClipboardList,
  Home,
  LayoutGrid,
  ListChecks,
  Plus,
  Settings,
  Sparkles,
  Tag,
  Users,
  Wallet,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useDashboard } from '../lib/hooks';
import { useSettings } from '../lib/settings';
import { Logo } from './Brand';
import { cx } from './ui';

export const SECTIONS = [
  { to: '/', label: 'Inicio', icon: Home, end: true },
  { to: '/calendario', label: 'Calendario', icon: CalendarDays },
  { to: '/nueva', label: 'Nueva cita', icon: Plus },
  { to: '/pendientes', label: 'Pendientes de atender', icon: ListChecks },
  { to: '/citas', label: 'Todas las citas', icon: ClipboardList, end: true },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/servicios', label: 'Servicios', icon: Sparkles },
  { to: '/promociones', label: 'Promociones', icon: Tag },
  { to: '/pagos', label: 'Pagos y estadísticas', icon: Wallet },
  { to: '/configuracion', label: 'Configuración', icon: Settings },
];

function usePendingBadge() {
  const { data } = useDashboard();
  return data ? data.overdue_count : 0;
}

function Sidebar() {
  const settings = useSettings();
  const overdue = usePendingBadge();
  return (
    <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col border-r border-lavender-200/70 bg-white/55 px-4 py-6 backdrop-blur-xl lg:flex">
      <div className="mb-8 flex items-center gap-3 px-2">
        <Logo className="size-12 shadow-soft" />
        <div>
          <p className="font-display text-2xl leading-none font-bold text-plum-700">{settings.business_name}</p>
          <p className="mt-1 text-xs font-bold tracking-[0.25em] text-gold-500 uppercase">Agenda</p>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {SECTIONS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cx(
                'flex items-center gap-3 rounded-2xl px-4 py-2.5 font-bold transition',
                to === '/nueva'
                  ? 'my-2 bg-gradient-to-r from-plum-600 to-rose-500 text-white shadow-glow'
                  : isActive
                    ? 'bg-white text-plum-700 shadow-soft'
                    : 'text-plum-500 hover:bg-white/60',
              )
            }
          >
            <Icon className="size-5" />
            <span className="flex-1">{label}</span>
            {to === '/pendientes' && overdue > 0 && (
              <span className="rounded-full bg-rose-500 px-2 text-xs leading-5 text-white">{overdue}</span>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

function BottomNav() {
  const navigate = useNavigate();
  const overdue = usePendingBadge();
  const item = (to: string, label: string, Icon: typeof Home, end = false, badge = 0) => (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cx('relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-bold', isActive ? 'text-rose-600' : 'text-plum-400')
      }
    >
      {({ isActive }) => (
        <>
          <span className={cx('flex h-8 w-14 items-center justify-center rounded-full transition', isActive && 'bg-blush-100')}>
            <Icon className="size-[22px]" strokeWidth={isActive ? 2.4 : 2} />
          </span>
          {label}
          {badge > 0 && (
            <span className="absolute top-0.5 left-1/2 ml-2 min-w-4.5 rounded-full bg-rose-500 px-1 text-center text-[10px] leading-4.5 text-white">
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-lavender-200/70 bg-white/85 backdrop-blur-xl lg:hidden">
      <div className="mx-auto flex h-[var(--nav-h)] max-w-xl items-stretch px-2 pb-0">
        {item('/', 'Inicio', Home, true)}
        {item('/calendario', 'Calendario', CalendarHeart)}
        <div className="flex flex-1 items-start justify-center">
          <button
            onClick={() => navigate('/nueva')}
            aria-label="Nueva cita"
            className="-mt-5 flex size-15 items-center justify-center rounded-full bg-gradient-to-br from-plum-600 to-rose-500 text-white shadow-glow ring-4 ring-cream active:scale-95"
          >
            <Plus className="size-7" strokeWidth={2.6} />
          </button>
        </div>
        {item('/pendientes', 'Pendientes', ListChecks, false, overdue)}
        {item('/mas', 'Más', LayoutGrid)}
      </div>
      <div className="pb-safe" />
    </nav>
  );
}

export function AppLayout() {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}

/** Encabezado de página con soporte para Dynamic Island / notch. */
export function PageHeader({
  title,
  subtitle,
  back,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <header className="pt-safe sticky top-0 z-30 border-b border-lavender-200/50 bg-cream/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3 sm:px-6">
        {back && (
          <button
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
            className="-ml-2 flex size-10 items-center justify-center rounded-full text-plum-600 active:bg-lavender-100"
            aria-label="Regresar"
          >
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[1.7rem] leading-tight font-bold text-plum-700">{title}</h1>
          {subtitle && <p className="truncate text-sm text-plum-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {children && <div className="mx-auto max-w-5xl px-4 pb-3 sm:px-6">{children}</div>}
    </header>
  );
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('pb-nav mx-auto max-w-5xl px-4 pt-4 sm:px-6', className)}>{children}</div>;
}
