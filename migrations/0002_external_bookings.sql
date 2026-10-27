-- Relación entre citas y reservas de servicios externos (Cal.com, Make, Canva, Notion…).
-- El Worker también la crea automáticamente si no existe.
CREATE TABLE IF NOT EXISTS external_bookings (
  source         TEXT NOT NULL,
  external_id    TEXT NOT NULL,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (source, external_id)
);
