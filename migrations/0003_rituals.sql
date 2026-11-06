-- Seguimiento de rituales: tema de la clienta y si ya se mandó la evidencia y la explicación.
-- El Worker también crea estas tablas automáticamente si no existen.
CREATE TABLE IF NOT EXISTS ritual_details (
  appointment_id   INTEGER PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
  topic            TEXT,
  evidence_sent    INTEGER NOT NULL DEFAULT 0,
  evidence_at      TEXT,
  explanation_sent INTEGER NOT NULL DEFAULT 0,
  explanation_at   TEXT,
  updated_at       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS external_ignored (
  source      TEXT NOT NULL,
  external_id TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (source, external_id)
);
