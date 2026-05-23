import { index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

/**
 * Registro unificado de dispositivos de marcación.
 *
 * Cada dispositivo físico que captura asistencia (reloj biométrico,
 * tablet facial, lector NFC, torniquete) tiene una fila aquí con su
 * tipo, método de conexión, ubicación e IP.
 *
 * Ejemplos:
 *   { code: 'REL-01', name: 'Reloj Estacionamiento',
 *     device_type: 'biometric_clock', connection_method: 'txt_import',
 *     ip_address: '192.168.1.1' }
 *   { code: 'TAB-LOBBY', name: 'Tablet Lobby',
 *     device_type: 'facial_kiosk', connection_method: 'api',
 *     ip_address: '192.168.1.2', facial_terminal_id: UUID }
 *   { code: 'REL-02', name: 'Reloj Ciudad X',
 *     device_type: 'biometric_clock', connection_method: 'txt_import',
 *     latitude: '8.9936', longitude: '-79.5197' }
 */
export const attendanceDevices = pgTable(
  'attendance_devices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 60 }).notNull().unique(),
    name: varchar('name', { length: 160 }).notNull(),
    /** 'biometric_clock' | 'facial_kiosk' | 'tablet' | 'nfc_reader' | 'turnstile' | 'other' */
    deviceType: varchar('device_type', { length: 30 }).notNull().default('biometric_clock'),
    /** 'txt_import' | 'api' | 'webhook' | 'manual' */
    connectionMethod: varchar('connection_method', { length: 30 }).notNull().default('txt_import'),
    location: varchar('location', { length: 200 }),
    ipAddress: varchar('ip_address', { length: 45 }),
    latitude: varchar('latitude', { length: 20 }),
    longitude: varchar('longitude', { length: 20 }),
    serialNumber: varchar('serial_number', { length: 100 }),
    manufacturer: varchar('manufacturer', { length: 100 }),
    model: varchar('model', { length: 100 }),
    /** 'active' | 'inactive' | 'maintenance' */
    status: varchar('status', { length: 20 }).notNull().default('active'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    apiTokenHash: varchar('api_token_hash', { length: 128 }),
    facialTerminalId: uuid('facial_terminal_id'),
    meta: jsonb('meta').notNull().default({}),
    isActive: integer('is_active').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    typeIdx: index('attendance_devices_type_idx').on(t.deviceType),
    statusIdx: index('attendance_devices_status_idx').on(t.status),
  })
)

/**
 * Eventos del dispositivo — heartbeats, errores, imports de TXT
 * realizados, cambios de config. Append-only para auditoría.
 */
export const attendanceDeviceEvents = pgTable(
  'attendance_device_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deviceId: uuid('device_id').notNull(),
    kind: varchar('kind', { length: 40 }).notNull(),
    message: text('message'),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    deviceIdx: index('attendance_device_events_device_idx').on(t.deviceId, t.createdAt),
  })
)

export type AttendanceDevice = typeof attendanceDevices.$inferSelect
export type NewAttendanceDevice = typeof attendanceDevices.$inferInsert
export type AttendanceDeviceEvent = typeof attendanceDeviceEvents.$inferSelect

export type DeviceType =
  | 'biometric_clock'
  | 'facial_kiosk'
  | 'tablet'
  | 'nfc_reader'
  | 'turnstile'
  | 'other'
export type ConnectionMethod = 'txt_import' | 'api' | 'webhook' | 'manual'
export type DeviceStatus = 'active' | 'inactive' | 'maintenance'
