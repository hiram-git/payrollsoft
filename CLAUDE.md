# PayrollSoft — Development Rules

## Code Language (MANDATORY)

All new code MUST use **English** for:
- Table names, column names
- Variables, constants, functions, methods, classes
- Type/interface names, enums
- File names, folder names
- API route paths (e.g., `/job-titles`, not `/cargos`)

**Exceptions** (stay in Spanish — application locale):
- UI labels, flash messages, sidebar navigation text
- PDF/report headers (legal requirement in Panama)
- `amountToWords()` output (financial requirement)
- User-facing error messages displayed in the frontend

**Existing Spanish elements** are tracked in `docs/STANDARDIZATION-REPORT.md`
and will be migrated to English incrementally. Do NOT add new Spanish-named
elements — route all new development through English names.

## Naming Conventions

| Context | Convention | Example |
|---|---|---|
| DB tables | snake_case, singular preferred | `job_title`, `budget_item` |
| DB columns | snake_case | `employee_id`, `created_at` |
| TypeScript variables/functions | camelCase | `getJobTitle`, `budgetItemId` |
| TypeScript types/interfaces | PascalCase | `JobTitle`, `BudgetItem` |
| Drizzle table exports | camelCase | `jobTitles`, `budgetItems` |
| API routes | kebab-case | `/job-titles`, `/budget-items` |
| Web page paths | kebab-case | `/config/job-titles` |
| File/folder names | kebab-case | `job-titles/`, `budget-items.ts` |

## Architecture Patterns

- **Schema**: Drizzle ORM in `packages/db/src/schema/`. One file per domain.
- **Service**: Business logic in `apps/api/src/modules/{module}/service.ts`. No DB imports in routes.
- **Routes**: Thin Elysia handlers in `routes.ts`. Validate with `t.Object()`, delegate to service.
- **Web proxy**: Astro API routes in `apps/web/src/pages/api/` forward to the Elysia API with auth+tenant headers.
- **UI pages**: Astro SSR in `apps/web/src/pages/`. Server-side data fetching in frontmatter. Client JS in `<script is:inline>`.

## Migrations

- Tenant migrations: `packages/db/drizzle/tenant/NNNN_description.sql`
- Public migrations: `packages/db/drizzle/public/NNNN_description.sql`
- Always update `meta/_journal.json` with the new entry.
- Use `IF NOT EXISTS` / `IF EXISTS` for DDL idempotency.
- For features that require optional extensions (e.g., pgvector), wrap in
  `DO $$ ... END $$` with availability check and graceful fallback.

## Permissions

- Format: `module:action` (e.g., `employees:read`, `treasury:write`)
- Register in `payroll_auth.permissions_catalog` (public migration)
- Assign to system roles in `payroll_auth.system_role_permissions`
- Gate routes with `guardPermission('code')` middleware

## Testing

- Pure logic tests in `packages/core/src/{module}/__tests__/`
- Run with `bun test` from the package directory
- Test file naming: `{module}.test.ts`

## Comments

- Default: no comments. Only add when WHY is non-obvious.
- Never explain WHAT — let names speak.
- Comments may be in English or Spanish (low priority for migration).
