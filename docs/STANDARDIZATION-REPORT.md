# PayrollSoft — Code Standardization Report

## Executive Summary

**68 tables** analyzed across tenant and public schemas.  
**7 tables** have Spanish names. **4 tables** have Spanish-named columns.  
**6 API route prefixes** are in Spanish. Multiple files, comments, and UI strings use Spanish.

This report classifies every element that needs renaming, proposes English equivalents, and establishes the migration strategy.

---

## 1. Database Tables — Spanish → English Mapping

### Priority 1: Tables that need renaming

| Current Name (Spanish) | Proposed Name (English) | Schema File | Impact |
|---|---|---|---|
| `cargos` | `job_titles` | `catalog.ts` | HIGH — FK in employees, positions, provisioning seed |
| `funciones` | `job_functions` | `catalog.ts` | HIGH — FK in employees, positions |
| `departamentos` | `departments` | `catalog.ts` | HIGH — FK in employees, positions, vacation_approval_rules |
| `partidas_presupuestarias` | `budget_items` | `catalog.ts` | MEDIUM — FK in positions only |
| `cuentas_contables` | `chart_of_accounts` | `catalog.ts` | LOW — FK in concepts only |
| `payroll_acumulados` | `payroll_accumulators` | `payroll.ts` | MEDIUM — used by acumulados module |
| `facial_marcaciones` | `facial_punches` | `facial.ts` | MEDIUM — conditional (pgvector) |

### Tables already in English (no action needed): 61/68

All infrastructure, RBAC, attendance, treasury, vacation, employee-files, and payroll tables are already correctly named in English.

---

## 2. Columns — Spanish → English Mapping

### company_config

| Current Column | Proposed Column | Notes |
|---|---|---|
| `tipo_institucion` | `institution_type` | Values: 'publica' → 'public', 'privada' → 'private' |
| `elaborado_por` | `prepared_by` | Report header field |
| `cargo_elaborador` | `preparer_title` | |
| `jefe_recursos_humanos` | `hr_director_name` | |
| `cargo_jefe_rrhh` | `hr_director_title` | |
| `logo_empresa` | `company_logo` | |
| `logo_izquierdo_reportes` | `report_logo_left` | |
| `logo_derecho_reportes` | `report_logo_right` | |

### positions

| Current Column | Proposed Column | Notes |
|---|---|---|
| `cargo_id` | `job_title_id` | FK rename follows table rename |
| `departamento_id` | `department_id` | |
| `funcion_id` | `job_function_id` | |
| `partida_id` | `budget_item_id` | |

Status enum values:
| Current | Proposed |
|---|---|
| `'vacante'` | `'vacant'` |
| `'en_uso'` | `'in_use'` |

### employees

| Current Column | Proposed Column |
|---|---|
| `cargo_id` | `job_title_id` |
| `funcion_id` | `job_function_id` |
| `departamento_id` | `department_id` |

### concepts

| Current Column | Proposed Column |
|---|---|
| `cuenta_contable_id` | `chart_account_id` |

---

## 3. API Routes — Spanish → English Mapping

| Current Route | Proposed Route | Module Path |
|---|---|---|
| `/cargos` | `/job-titles` | `modules/catalogs/cargos/` → `modules/catalogs/job-titles/` |
| `/funciones` | `/job-functions` | `modules/catalogs/funciones/` → `modules/catalogs/job-functions/` |
| `/departamentos` | `/departments` | `modules/catalogs/departamentos/` → `modules/catalogs/departments/` |
| `/partidas` | `/budget-items` | `modules/catalogs/partidas/` → `modules/catalogs/budget-items/` |
| `/cuentas-contables` | `/chart-of-accounts` | `modules/catalogs/cuentas-contables/` → `modules/catalogs/chart-of-accounts/` |
| `/acumulados` | `/accumulators` | `modules/acumulados/` → `modules/accumulators/` |

---

## 4. Web Pages — Spanish → English Mapping

| Current Path | Proposed Path |
|---|---|
| `/config/cargos` | `/config/job-titles` |
| `/config/funciones` | `/config/job-functions` |
| `/config/departamentos` | `/config/departments` |
| `/config/partidas` | `/config/budget-items` |
| `/config/estructura` | `/config/positions` (already the API name) |
| `/config/acreedores` | `/config/creditors` (already the API name) |
| `/acumulados` | `/accumulators` |

---

## 5. Code Files — Spanish → English Mapping

### API Module Directories

| Current | Proposed |
|---|---|
| `modules/catalogs/cargos/` | `modules/catalogs/job-titles/` |
| `modules/catalogs/funciones/` | `modules/catalogs/job-functions/` |
| `modules/catalogs/departamentos/` | `modules/catalogs/departments/` |
| `modules/catalogs/partidas/` | `modules/catalogs/budget-items/` |
| `modules/catalogs/cuentas-contables/` | `modules/catalogs/chart-of-accounts/` |
| `modules/acumulados/` | `modules/accumulators/` |

### Web Page Directories

| Current | Proposed |
|---|---|
| `pages/config/cargos/` | `pages/config/job-titles/` |
| `pages/config/funciones/` | `pages/config/job-functions/` |
| `pages/config/departamentos/` | `pages/config/departments/` |
| `pages/config/partidas/` | `pages/config/budget-items/` |
| `pages/config/estructura/` | `pages/config/positions/` |
| `pages/config/acreedores/` | `pages/config/creditors/` |

### Exported Symbols (Drizzle Schema)

| Current Export | Proposed Export | File |
|---|---|---|
| `cargos` | `jobTitles` | `catalog.ts` |
| `funciones` | `jobFunctions` | `catalog.ts` |
| `departamentos` | `departments` | `catalog.ts` |
| `partidasPresupuestarias` | `budgetItems` | `catalog.ts` |
| `cuentasContables` | `chartOfAccounts` | `catalog.ts` |
| `payrollAcumulados` | `payrollAccumulators` | `payroll.ts` |
| `facialMarcaciones` | `facialPunches` | `facial.ts` |

### Type Exports

| Current | Proposed |
|---|---|
| `Cargo` | `JobTitle` |
| `Funcion` | `JobFunction` |
| `Departamento` | `Department` |
| `PartidaPresupuestaria` | `BudgetItem` |
| `CuentaContable` | `ChartOfAccount` |

---

## 6. Spanish Comments and Strings

### Comments
Extensive Spanish comments exist throughout the codebase. Key files:
- All schema files in `packages/db/src/schema/`
- All service files in `apps/api/src/modules/*/service.ts`
- Migration SQL files (header comments)
- UI flash messages and labels in `.astro` files

**Recommendation:** Comments can remain in Spanish for now (lowest priority). UI-facing strings (labels, messages) should stay in Spanish since the end users are Spanish-speaking — this is an **application locale** concern, not a code quality concern.

### String Literals in Code
- Error messages: mix of Spanish and English. Standardize to English in API responses; keep Spanish in UI-facing text.
- Permission codes: already English (`employees:read`, `treasury:write`).
- Status enums: mostly English except `'vacante'`/`'en_uso'` in positions.

---

## 7. Catalog Import Config

The `apps/web/src/lib/catalog-import/config.ts` references Spanish names:

| Current Key | Proposed Key |
|---|---|
| `cargos` | `job-titles` |
| `funciones` | `job-functions` |
| `departamentos` | `departments` |
| `partidas` | `budget-items` |
| `estructura` | `positions` |
| `acreedores` | `creditors` |

---

## 8. Sidebar / Navigation Labels

Labels in `AppLayout.astro` are user-facing Spanish and should **remain in Spanish** (application locale). The `href` paths should change to English as listed in §4.

---

## 9. Migration Strategy

### Recommended Approach: Parallel Aliasing

Renaming 7 tables + 15 columns in a live multi-tenant system requires care. The safest strategy:

1. **Phase A — New migration that creates English aliases:**
   - `ALTER TABLE cargos RENAME TO job_titles;`
   - `ALTER TABLE funciones RENAME TO job_functions;`
   - `ALTER TABLE departamentos RENAME TO departments;`
   - etc.
   - PostgreSQL handles this atomically — existing FKs follow the rename.

2. **Phase B — Update Drizzle schema exports:**
   - Change `pgTable('cargos')` → `pgTable('job_titles')`
   - Change all TypeScript symbol names
   - Update all imports across the codebase

3. **Phase C — Update API routes:**
   - Add new English routes alongside Spanish ones
   - Keep Spanish routes as temporary aliases (deprecated)
   - Update web pages to use English routes

4. **Phase D — Update web pages:**
   - Rename directories
   - Update sidebar `href` values
   - Update catalog-import config keys

5. **Phase E — Remove deprecated Spanish aliases** (after verification)

### Estimated Impact per Phase

| Phase | Files Changed | Risk | Reversible |
|---|---|---|---|
| A (DB rename) | 1 migration | LOW — PostgreSQL atomic rename | YES (reverse migration) |
| B (Schema + imports) | ~40 files | MEDIUM — grep/replace | YES (git revert) |
| C (API routes) | ~15 files | LOW — add aliases first | YES |
| D (Web pages) | ~25 files | LOW — directory renames | YES |
| E (Remove aliases) | ~10 files | LOW | N/A |

---

## 10. Priority Matrix

| Priority | Category | Items | Business Impact |
|---|---|---|---|
| **P0** | Enforce rule going forward | CLAUDE.md rule file | Prevents new Spanish code |
| **P1** | Database tables | 7 tables to rename | Highest — everything depends on schema |
| **P2** | Drizzle schema exports | 7 symbols + types | Required after P1 |
| **P3** | API routes | 6 route prefixes | Client-facing |
| **P4** | Web page paths | 7 directory renames | User-facing URLs |
| **P5** | Column renames | 15 columns | Can be done incrementally |
| **P6** | Code comments | ~200 files | Lowest — cosmetic |

---

## 11. Elements That Should Stay in Spanish

| Element | Reason |
|---|---|
| UI labels (`"Empleados"`, `"Planilla"`, etc.) | Application locale — end users speak Spanish |
| Flash messages in .astro pages | User-facing text |
| PDF report headers (`"Elaborado por"`, etc.) | Legal/institutional requirement in Panama |
| `amountToWords()` output (`"BALBOAS"`) | Financial/legal requirement |
| Sidebar navigation labels | UX — users navigate in Spanish |

---

## 12. CLAUDE.md Rule (P0 — Immediate)

Add to the project root so all future development enforces English:

```markdown
## Code Language Rules

- All new code (tables, columns, variables, functions, files, folders,
  types, enums) MUST use English names.
- Existing Spanish-named elements are being migrated to English
  incrementally (see docs/STANDARDIZATION-REPORT.md).
- UI-facing strings (labels, messages, PDF text) remain in Spanish
  as this is the application locale.
- API error messages should be in English. User-facing error messages
  displayed in the UI should be in Spanish.
```
