import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Appointment,
  AppointmentInput,
  AppointmentStatus,
  Client,
  DashboardStats,
  Promotion,
  Service,
} from '../../shared/types';
import { del, get, post, put, qs } from './api';

export interface ListResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface AppointmentFilters {
  from?: string;
  to?: string;
  view?: 'open';
  status?: string;
  platform?: string;
  payment?: string;
  q?: string;
  client_id?: number;
  service_id?: number;
  promotion_id?: number;
  currency?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export const useAppointments = (f: AppointmentFilters, enabled = true) =>
  useQuery({
    queryKey: ['appointments', f],
    queryFn: () => get<ListResult<Appointment>>(`/appointments${qs(f as Record<string, string>)}`),
    enabled,
    placeholderData: (prev) => prev,
  });

export const useAppointment = (id: number | null) =>
  useQuery({
    queryKey: ['appointment', id],
    queryFn: () => get<Appointment>(`/appointments/${id}`),
    enabled: !!id,
  });

export const useDashboard = () =>
  useQuery({ queryKey: ['dashboard'], queryFn: () => get<DashboardStats>('/dashboard'), refetchInterval: 60_000 });

export const useClients = (q = '') =>
  useQuery({ queryKey: ['clients', q], queryFn: () => get<Client[]>(`/clients${qs({ q })}`), placeholderData: (p) => p });

export const useClient = (id: number) =>
  useQuery({
    queryKey: ['client', id],
    queryFn: () => get<Client & { appointments: Appointment[] }>(`/clients/${id}`),
  });

export const useServices = () =>
  useQuery({ queryKey: ['services'], queryFn: () => get<(Service & { usage_count: number })[]>('/services'), staleTime: 60_000 });

export const usePromotions = () =>
  useQuery({
    queryKey: ['promotions'],
    queryFn: () => get<(Promotion & { usage_count: number })[]>('/promotions'),
    staleTime: 60_000,
  });

/** Invalida todo lo que depende de las citas. */
export function useInvalidateAppointments() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['appointments'] }),
      qc.invalidateQueries({ queryKey: ['appointment'] }),
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
      qc.invalidateQueries({ queryKey: ['stats'] }),
      qc.invalidateQueries({ queryKey: ['client'] }),
      qc.invalidateQueries({ queryKey: ['clients'] }),
      qc.invalidateQueries({ queryKey: ['payments'] }),
    ]);
}

export function useSaveAppointment() {
  const invalidate = useInvalidateAppointments();
  return useMutation({
    mutationFn: ({ id, input }: { id?: number; input: AppointmentInput }) =>
      id ? put<Appointment>(`/appointments/${id}`, input) : post<Appointment>('/appointments', input),
    onSuccess: () => invalidate(),
  });
}

export function useSetStatus() {
  const invalidate = useInvalidateAppointments();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: number; status: AppointmentStatus; note?: string }) =>
      post<Appointment>(`/appointments/${id}/status`, { status, note }),
    onSuccess: () => invalidate(),
  });
}

export function useReschedule() {
  const invalidate = useInvalidateAppointments();
  return useMutation({
    mutationFn: (v: { id: number; start_at: string; end_at: string; allow_overlap?: boolean; reason?: string }) =>
      post<Appointment>(`/appointments/${v.id}/reschedule`, v),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteAppointment() {
  const invalidate = useInvalidateAppointments();
  return useMutation({
    mutationFn: (id: number) => del<{ ok: boolean; sync_warning?: string | null }>(`/appointments/${id}`),
    onSuccess: () => invalidate(),
  });
}

export function useAddPayment() {
  const invalidate = useInvalidateAppointments();
  return useMutation({
    mutationFn: (v: { id: number; amount: number; method: string; paid_at: string; note?: string }) =>
      post<Appointment>(`/appointments/${v.id}/payments`, v),
    onSuccess: () => invalidate(),
  });
}

export function useDeletePayment() {
  const invalidate = useInvalidateAppointments();
  return useMutation({ mutationFn: (id: number) => del(`/payments/${id}`), onSuccess: () => invalidate() });
}
