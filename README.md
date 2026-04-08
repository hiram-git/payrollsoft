📍 ROADMAP POR FASES
Fase 0: Setup inicial (1-2 días)

Crear monorepo con Bun workspaces + Turborepo (opcional)
Configurar Elysia + Astro
Drizzle + PostgreSQL (conexión dinámica)
Multitenancy básico + Super Admin
Biome + Husky

Milestone: bun run dev levanta API + Web al mismo tiempo.
Fase 1: Base de datos + Core (5-7 días)

Migrar todos los schemas a Drizzle
Portar Motor de Fórmulas V3.5.3 (100% seguro)
Custom Query Builder v2
TenantMigrationSystem

Milestone: Todas las tablas creadas + motor de fórmulas funcionando.
Fase 2: Autenticación y Seguridad (3-4 días)

Auth (Elysia + JWT/cookies)
Roles, Permissions y Super Admin
CSRF + Rate limiting

Milestone: Login multi-tenant funcional.
Fase 3: API Core + Business Logic (10-14 días)

Employee + Campos personalizados + Expedientes
Manual Concepts + Loans
Attendance System + Webhooks
Vacaciones Panamá (balance + integración planilla)
Payroll Engine (planillas, XIII Mes, acumulados, múltiples tipos)

Milestone: Generar una planilla completa con XIII Mes correcto.
Fase 4: Frontend Astro (8-12 días)

Diseño moderno (Tailwind + shadcn/ui o similar)
Dashboard + DataTables (TanStack Table)
FullCalendar Panamá
Generación y visualización de PDFs

Milestone: Flujo completo Empleado → Planilla → PDF desde la UI.
Fase 5: Módulos avanzados (10-15 días)

Módulo Acumulados (varias vistas + Excel)
Reportes PDF empresariales (logos, firmas)
Sistema de tolerancias + cálculo almuerzo
Importación masiva + Documentos empleados

Fase 6: Testing, Optimización y Deploy (5-7 días)

Tests con Bun:test
Docker + Compose
Deploy (Railway / Fly.io / Render recomendado)

Milestone final: Sistema completo en producción.