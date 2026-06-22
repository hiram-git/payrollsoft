# Enganche: dependiente con discapacidad → saldo `family_disability`

> Estado: **implementado y verificado** (Fase 2.E). No requirió código nuevo;
> la cadena ya estaba cableada cuando se construyó el módulo de saldos.

## Flujo end-to-end

1. **UI** — pestaña *Dependientes* del empleado
   (`apps/web/src/pages/employees/[id].astro`): alta/edición/baja con el
   checkbox **"Con discapacidad"**.
2. **Proxy web** — `apps/web/src/pages/api/employees/[id]/dependents.ts`
   reenvía POST/PUT/DELETE a la API con auth + tenant.
3. **API** — `apps/api/src/modules/employees/dependents-routes.ts`: cada
   mutación (POST, PUT, DELETE) llama a `syncFamilyDisability(db, employeeId,
   user)`.
4. **Saldos** — `syncFamilyDisability` consulta si el empleado tiene ≥1
   dependiente activo con `has_disability = true` y llama a
   `syncConditionalBalance(db, employeeId, 'family_disability', hasCondition)`.

## Reglas (cumplidas por `syncConditionalBalance`)

- `condición true & sin saldo`  → abre el saldo (144 h) — **idempotente**: si
  ya existe el saldo del año, no se duplica.
- `condición false & saldo sin débitos` → lo cierra.
- `condición false & saldo con débitos` → **se mantiene** (no se debita lo
  consumido). El no-renovar el siguiente año lo decide el worker anual
  (`initializeYearForAllEmployees`, que también abre `family_disability` solo
  para empleados con dependiente discapacitado activo).

## Conclusión

La sección Dependientes existe y el trigger está activo. La dependencia
bloqueante declarada en el módulo de saldos queda **resuelta**.
