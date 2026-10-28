// Tipos compartidos entre el Worker (API) y el frontend.

export type Currency = 'MXN' | 'USD';

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export type Platform = 'whatsapp' | 'messenger' | 'instagram' | 'video' | 'phone' | 'other';

export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

export type PromoType = 'fixed_price' | 'percent' | 'amount';

export interface Client {
  id: number;
  full_name: string;
  phone: string | null;
  instagram: string | null;
  messenger: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  appointment_count?: number;
  last_appointment_at?: string | null;
  next_appointment_at?: string | null;
  total_billed?: number;
  total_paid?: number;
}

export interface Service {
  id: number;
  name: string;
  category: string;
  description: string | null;
  price: number;
  currency: Currency;
  duration_min: number | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface Promotion {
  id: number;
  name: string;
  description: string | null;
  promo_type: PromoType;
  value: number;
  currency: Currency;
  valid_from: string | null;
  valid_to: string | null;
  conditions: string | null;
  stackable: number;
  active: number;
  service_ids: number[];
  created_at: string;
  updated_at: string;
}

export interface AppointmentService {
  id?: number;
  service_id: number | null;
  name: string;
  category: string | null;
  price: number;
  duration_min: number | null;
}

export interface AppointmentPromotion {
  id?: number;
  promotion_id: number | null;
  name: string;
  original_price: number;
  special_price: number;
  savings: number;
}

export interface Payment {
  id: number;
  appointment_id: number;
  amount: number;
  method: string;
  paid_at: string;
  note: string | null;
  created_at: string;
  // presentes en listados globales de pagos
  client_name?: string;
  currency?: Currency;
  start_at?: string;
}

export interface HistoryEntry {
  id: number;
  action: string;
  details: string | null;
  created_at: string;
}

export interface Appointment {
  id: number;
  client_id: number | null;
  client_name: string;
  start_at: string;
  end_at: string;
  timezone: string;
  platform: Platform;
  contact_value: string | null;
  status: AppointmentStatus;
  currency: Currency;
  original_price: number;
  discount: number;
  final_price: number;
  manual_price: number;
  notes: string | null;
  started_at: string | null;
  attended_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  paid_total: number;
  balance: number;
  payment_status: PaymentStatus;
  services: AppointmentService[];
  promotions: AppointmentPromotion[];
  // Solo en detalle
  payments?: Payment[];
  history?: HistoryEntry[];
  client?: Client | null;
  /** Origen externo ("calcom", "canva"…) si la cita llegó por una integración. */
  external_source?: string | null;
  /** Aviso cuando un cambio no se pudo reflejar en Cal.com. */
  sync_warning?: string | null;
}

export interface AppointmentInput {
  client_id?: number | null;
  client?: {
    full_name: string;
    phone?: string | null;
    instagram?: string | null;
    messenger?: string | null;
    notes?: string | null;
  } | null;
  client_name?: string;
  start_at: string;
  end_at: string;
  timezone: string;
  platform: Platform;
  contact_value?: string | null;
  status: AppointmentStatus;
  currency: Currency;
  original_price: number;
  discount: number;
  final_price: number;
  manual_price: boolean;
  notes?: string | null;
  services: AppointmentService[];
  promotions: AppointmentPromotion[];
  initial_payment?: { amount: number; method: string; paid_at: string; note?: string | null } | null;
  allow_overlap?: boolean;
}

export interface Settings {
  timezone: string;
  time_format: '12h' | '24h';
  default_currency: Currency;
  default_duration_min: number;
  reminder_offsets: number[]; // minutos antes de la cita
  overdue_reminder: boolean; // avisar cuando una cita terminó y no se marcó
  overdue_after_min: number;
  daily_summary: boolean;
  daily_summary_time: string; // HH:mm
  business_name: string;
  logo: string | null; // data URL
  payment_methods: string[];
  week_starts_monday: boolean;
  calendar_start_hour: number;
  calendar_end_hour: number;
  /** Enlace del evento de Cal.com (p. ej. https://cal.com/usuario/cita) para crear allá las citas registradas a mano. */
  calcom_event_url: string | null;
  /** Crear en Cal.com (y por tanto en Google Calendar) las citas que se registran en la agenda. */
  calcom_push_manual: boolean;
  /** Correo que se usa como asistente en Cal.com cuando la clienta no dio el suyo. */
  calcom_attendee_email: string | null;
}

export interface DashboardStats {
  today_count: number;
  pending_count: number;
  overdue_count: number;
  completed_count: number;
  cancelled_count: number;
  unpaid_count: number;
  collected_today: Record<string, number>;
  pending_amount: Record<string, number>;
  next: Appointment | null;
  today: Appointment[];
}

export interface Conflict {
  id: number;
  client_name: string;
  start_at: string;
  end_at: string;
  status: AppointmentStatus;
}
