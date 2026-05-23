-- Tabla de punches individuales (marcaciones_registros).
--
-- Separada de `attendance_records` (que es el resumen diario/cabecera).
-- Los punches son eventos crudos de alta frecuencia — cada vez que un
-- empleado pasa la huella, toca el NFC o se reconoce su cara, se
-- inserta UNA fila aquí.
--
-- Diseño para alto volumen (1000+ empleados, sync cada 5 min):
--
--   • Idempotency key: evita duplicados en re-importaciones y
--     sincronizaciones frecuentes. El key es un hash de
--     (employee, datetime, device) — ON CONFLICT DO NOTHING.
--
--   • Sin rawData JSONB: solo campos escalares compactos.
--     Un punch ocupa ~120 bytes vs ~1-2 KB de un JSONB con metadata.
--
--   • Índice parcial en idempotency_key (WHERE NOT NULL) para que
--     los punches manuales (sin key) no gasten espacio de índice.
--
--   • Purgable: los punches de más de N días se pueden borrar
--     sin perder información — el resumen diario en
--     attendance_records es la fuente canónica para planilla.
--
-- Flujo:
--   TXT/API/facial → INSERT attendance_punches (ON CONFLICT SKIP)
--       → consolidar → UPSERT attendance_records (1 fila/emp/día)

CREATE TABLE IF NOT EXISTS attendance_punches (
  id               bigserial   PRIMARY KEY,
  employee_id      uuid        NOT NULL,
  device_id        uuid        REFERENCES attendance_devices(id) ON DELETE SET NULL,
  punched_at       timestamptz NOT NULL,
  /** 0=entrada, 1=salida_almuerzo, 2=regreso_almuerzo, 3=salida, 9=desconocido */
  punch_type       smallint    NOT NULL DEFAULT 0,
  /** import | api | manual | facial */
  source           varchar(20) NOT NULL DEFAULT 'import',
  /** Hash para deduplicación: ej. "{deviceCode}:{empCode}:{YYYYMMDD_HHMMSS}" */
  idempotency_key  varchar(120),
  created_at       timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS attendance_punches_idem_unique
  ON attendance_punches(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS attendance_punches_employee_date_idx
  ON attendance_punches(employee_id, punched_at DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS attendance_punches_device_idx
  ON attendance_punches(device_id)
  WHERE device_id IS NOT NULL;
