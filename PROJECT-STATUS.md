# Sistema de Nómina Panamá - Nuevo Proyecto con Bun + Astro + PostgreSQL

**Nombre del Proyecto:** Payroll Panamá v2 (o el nombre que prefieras)  
**Tecnologías principales:** Bun • Elysia.js • Astro • Drizzle ORM • PostgreSQL  
**Objetivo:** Reconstruir el sistema actual de nómina (con todos los módulos ya implementados) de forma más rápida, ligera y moderna.

**Estado actual del proyecto:** En fase de planificación / Inicio (Abril 2026)

---

## 🏗️ Arquitectura del Proyecto (Monorepo)

```bash
payroll-panama/
├── apps/
│   ├── api/                  # Backend: Elysia + Bun
│   │   ├── src/
│   │   │   ├── config/       # db, env, tenant
│   │   │   ├── modules/      # Feature-based (employees, payroll, vacations, etc.)
│   │   │   │   └── tenant/
│   │   │   │       ├── controller.ts
│   │   │   │       ├── service.ts
│   │   │   │       ├── repository.ts
│   │   │   │       └── routes.ts
│   │   │   ├── middleware/   # auth, tenant, csrf, roles
│   │   │   ├── lib/          # utils, formulas engine
│   │   │   └── index.ts      # Elysia app principal
│   │   ├── drizzle/          # Migraciones generadas
│   │   └── package.json
│   │
│   └── web/                  # Frontend: Astro + React/Solid islands
│       ├── src/
│       │   ├── components/   # Islands interactivas
│       │   ├── layouts/
│       │   ├── pages/        # SSR pages (dashboard, empleados, planillas...)
│       │   └── lib/          # API client (tRPC-like o fetch typed)
│       ├── public/
│       └── astro.config.mjs
│
├── packages/
│   ├── core/                 # Motor de fórmulas, cálculos de nómina, lógica de negocio Panamá
│   │   ├── formulas/         # INIPERIODO, ACUMULADOS, CONCEPTO, etc.
│   │   ├── payroll/          # Procesamiento de planillas, XIII Mes, acumulados
│   │   ├── attendance/       # Integración Base44, tolerancias, almuerzo
│   │   └── index.ts
│   │
│   ├── db/                   # Drizzle schemas + migraciones compartidas
│   │   ├── schema/
│   │   │   ├── tenant.ts
│   │   │   ├── employee.ts
│   │   │   ├── payroll.ts
│   │   │   ├── vacation.ts
│   │   │   ├── attendance.ts
│   │   │   └── index.ts
│   │   ├── drizzle.config.ts
│   │   └── client.ts         # Conexión dinámica multi-tenant
│   │
│   ├── types/                # Tipos compartidos (Zod + TS)
│   └── utils/                # Herramientas comunes (PDF helpers, date panamá, etc.)
│
├── .env.example
├── .env.pgsql.example
├── bun.lockb
├── turbo.json                # (Opcional) para caching y pipelines
├── package.json              # Root workspace
├── biome.json                # Linter/formatter recomendado
└── README.md