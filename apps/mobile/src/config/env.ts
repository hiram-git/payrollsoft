/**
 * Configuración de entorno del móvil.
 *
 * `API_URL` y `TENANT` se leen de variables Vite (`import.meta.env`) con
 * fallback seguro para que un clon recién bajado arranque sin `.env`.
 * El tenant configurado aquí es solo el valor por defecto: el tenant
 * efectivo se persiste por sesión en el almacenamiento seguro (ver
 * `lib/storage.ts`) tras el login.
 */
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

export const DEFAULT_TENANT = import.meta.env.VITE_TENANT ?? 'demo'
