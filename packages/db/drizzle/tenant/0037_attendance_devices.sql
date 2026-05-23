-- Registro unificado de dispositivos de marcación.
--
-- Cubre TODOS los tipos de captación biométrica en un solo catálogo:
--   • Relojes biométricos (conexión por TXT import)
--   • Tablets / kiosks faciales (conexión por API)
--   • Lectores NFC (conexión por API o webhook)
--   • Cualquier otro dispositivo futuro
--
-- Cada dispositivo tiene un tipo, un método de conexión, ubicación
-- física (texto + coordenadas GPS opcionales) y dirección IP.
--
-- Esta tabla es independiente de `facial_terminals` (que es
-- condicional a pgvector y maneja la auth de kiosk + heartbeat).
-- Para dispositivos faciales, `facial_terminal_id` enlaza al
-- registro facial cuando aplica.
--
-- Permisos: reusar `terminals:read` y `terminals:write` que ya
-- existen desde la migración de facial (0007 public).

CREATE TABLE IF NOT EXISTS attendance_devices (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code                varchar(60) NOT NULL UNIQUE,
  name                varchar(160) NOT NULL,
  /** Tipo de dispositivo físico */
  device_type         varchar(30) NOT NULL DEFAULT 'biometric_clock',
  /** Cómo se obtienen las marcaciones de este dispositivo */
  connection_method   varchar(30) NOT NULL DEFAULT 'txt_import',
  /** Ubicación descriptiva — "Lobby planta baja", "Estacionamiento" */
  location            varchar(200),
  ip_address          varchar(45),
  /** Coordenadas GPS opcionales (para dispositivos remotos) */
  latitude            varchar(20),
  longitude           varchar(20),
  /** Número de serie / identificador del fabricante */
  serial_number       varchar(100),
  manufacturer        varchar(100),
  model               varchar(100),
  /** Estado operativo */
  status              varchar(20) NOT NULL DEFAULT 'active',
  /** Última vez que el dispositivo reportó (heartbeat o import) */
  last_seen_at        timestamptz,
  /** Hash del token API (para dispositivos con conexión API) */
  api_token_hash      varchar(128),
  /** Enlace opcional al facial_terminal si es un kiosk facial */
  facial_terminal_id  uuid,
  /** Metadatos extensibles: firmware, features, config */
  meta                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_active           integer     NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT attendance_devices_type_check CHECK (
    device_type IN ('biometric_clock', 'facial_kiosk', 'tablet', 'nfc_reader', 'turnstile', 'other')
  ),
  CONSTRAINT attendance_devices_conn_check CHECK (
    connection_method IN ('txt_import', 'api', 'webhook', 'manual')
  ),
  CONSTRAINT attendance_devices_status_check CHECK (
    status IN ('active', 'inactive', 'maintenance')
  )
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS attendance_devices_type_idx
  ON attendance_devices(device_type);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS attendance_devices_status_idx
  ON attendance_devices(status);
--> statement-breakpoint

-- Eventos del dispositivo (heartbeats, errores, imports realizados).
-- Append-only para auditoría.
CREATE TABLE IF NOT EXISTS attendance_device_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id   uuid        NOT NULL REFERENCES attendance_devices(id) ON DELETE CASCADE,
  kind        varchar(40) NOT NULL,
  message     text,
  payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT device_events_kind_check CHECK (
    kind IN (
      'heartbeat', 'connection_lost', 'connection_restored',
      'txt_imported', 'error', 'config_changed',
      'token_rotated', 'maintenance_start', 'maintenance_end'
    )
  )
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS attendance_device_events_device_idx
  ON attendance_device_events(device_id, created_at DESC);
