import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ActionsProvider } from './components/ActionsProvider';
import { Emblem } from './components/Brand';
import { FeedbackProvider } from './components/feedback';
import { AppLayout } from './components/Layout';
import { LoadingBlock } from './components/ui';
import { get, setUnauthorizedHandler } from './lib/api';
import { SettingsProvider } from './lib/settings';
import { AllAppointmentsPage } from './pages/AllAppointments';
import { AppointmentDetailPage } from './pages/AppointmentDetail';
import { AppointmentFormPage } from './pages/AppointmentForm';
import { ClientDetailPage, ClientsPage } from './pages/Clients';
import { HomePage } from './pages/Home';
import { LoginPage } from './pages/Login';
import { MorePage } from './pages/More';
import { PendingPage } from './pages/Pending';
import { PromotionsPage } from './pages/Promotions';
import { ServicesPage } from './pages/Services';
import { SettingsPage } from './pages/SettingsPage';
import { StatsPage } from './pages/Stats';

// FullCalendar es la dependencia más pesada: se carga solo al abrir el calendario.
const CalendarPage = lazy(() => import('./pages/CalendarPage').then((m) => ({ default: m.CalendarPage })));

interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
}

export default function App() {
  const qc = useQueryClient();
  const auth = useQuery({ queryKey: ['auth'], queryFn: () => get<AuthStatus>('/auth/status'), staleTime: Infinity, retry: 1 });

  useEffect(() => {
    setUnauthorizedHandler(() => qc.setQueryData(['auth'], (old: AuthStatus | undefined) => ({ configured: true, ...old, authenticated: false })));
  }, [qc]);

  if (auth.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Emblem className="size-20 animate-pulse" />
      </div>
    );
  }
  if (auth.error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <Emblem className="size-16" />
        <p className="font-bold text-plum-700">No se pudo conectar con la agenda.</p>
        <p className="text-sm text-plum-500">{(auth.error as Error).message}</p>
        <button className="rounded-full bg-plum-600 px-5 py-2 font-bold text-white" onClick={() => auth.refetch()}>
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <FeedbackProvider>
      {!auth.data?.authenticated ? (
        <LoginPage
          configured={!!auth.data?.configured}
          onDone={() => {
            qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
            qc.setQueryData(['auth'], { configured: true, authenticated: true });
          }}
        />
      ) : (
        <SettingsProvider>
          <BrowserRouter>
            <ActionsProvider>
              <Routes>
                <Route element={<AppLayout />}>
                  <Route index element={<HomePage />} />
                  <Route
                    path="calendario"
                    element={
                      <Suspense fallback={<LoadingBlock />}>
                        <CalendarPage />
                      </Suspense>
                    }
                  />
                  <Route path="nueva" element={<AppointmentFormPage />} />
                  <Route path="pendientes" element={<PendingPage />} />
                  <Route path="citas" element={<AllAppointmentsPage />} />
                  <Route path="citas/:id" element={<AppointmentDetailPage />} />
                  <Route path="citas/:id/editar" element={<AppointmentFormPage />} />
                  <Route path="clientes" element={<ClientsPage />} />
                  <Route path="clientes/:id" element={<ClientDetailPage />} />
                  <Route path="servicios" element={<ServicesPage />} />
                  <Route path="promociones" element={<PromotionsPage />} />
                  <Route path="pagos" element={<StatsPage />} />
                  <Route path="configuracion" element={<SettingsPage />} />
                  <Route path="mas" element={<MorePage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </ActionsProvider>
          </BrowserRouter>
        </SettingsProvider>
      )}
    </FeedbackProvider>
  );
}
