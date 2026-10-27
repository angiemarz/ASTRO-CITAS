import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Logo } from '../components/Brand';
import { Page, PageHeader, SECTIONS } from '../components/Layout';
import { useSettings } from '../lib/settings';

export function MorePage() {
  const s = useSettings();
  return (
    <>
      <PageHeader title="Menú" />
      <Page>
        <div className="mb-5 flex items-center gap-3 px-1">
          <Logo className="size-14 shadow-soft" />
          <div>
            <p className="font-display text-2xl font-bold text-plum-700">{s.business_name}</p>
            <p className="text-xs font-bold tracking-[0.25em] text-gold-500 uppercase">Agenda</p>
          </div>
        </div>
        <div className="card divide-y divide-lavender-100 overflow-hidden">
          {SECTIONS.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} className="flex min-h-14 items-center gap-3 px-4 active:bg-lavender-50">
              <span className="flex size-9 items-center justify-center rounded-xl gradient-soft text-plum-600">
                <Icon className="size-[18px]" />
              </span>
              <span className="flex-1 font-bold text-plum-700">{label}</span>
              <ChevronRight className="size-5 text-plum-300" />
            </Link>
          ))}
        </div>
      </Page>
    </>
  );
}
