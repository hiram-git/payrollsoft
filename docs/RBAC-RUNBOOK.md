# RBAC + Multi-tenant Runbook

Operations playbook for the multi-tenant payroll platform. Targets the
on-call engineer who needs to provision a new tenant, recover a failed
provisioning, restore a single tenant from backup, or audit a permission
incident.

## 1. Architecture in 60 seconds

- One PostgreSQL database, many schemas:
  - `payroll_auth` — central: `tenants`, `super_admins`, `permissions_catalog`,
    `super_admin_audit`, `tenant_provisioning`.
  - `tenant_<slug>` — one per company; payroll, employees, attendance, plus
    its own `roles`, `role_permissions`, `role_inheritance`, `user_roles`,
    `users`, `audit_log`.
- App connections set `search_path = tenant_<slug>,payroll_auth,public`,
  so tenant tables resolve unqualified, the central tables resolve unqualified
  cross-schema, and Postgres extensions live in `public`.
- JWTs carry `userId`, `tenantId`, `tenantSlug`, `role`, `permissions[]`
  and `permissionsVersion`. `guardTenantMatchesToken` enforces that the
  request's resolved tenant matches the JWT — super-admins exempt.
- Effective permissions are pre-computed on login by a recursive CTE over
  `user_roles → role_inheritance → role_permissions`. Mutations bump
  `users.permissions_version` to invalidate live tokens on next refresh.

## 2. Provisioning a new tenant

### Happy path (UI)

1. Sign in at `/superadmin/login`.
2. Navigate to **Empresas → Nueva empresa**.
3. Fill the wizard: business name, slug, contact email; admin name, email,
   password (≥12 chars).
4. Submit → API runs `provisionTenant()` which:
   - inserts the tenant row in `payroll_auth.tenants` with
     `status='PROVISIONING'`,
   - inserts a `tenant_provisioning` row with `state='running'`,
   - `CREATE SCHEMA tenant_<slug>`,
   - applies every Drizzle migration from `drizzle/tenant`,
   - seeds the four system roles + their permission grants,
   - creates the admin user with `is_tenant_admin=true`,
   - flips status to `ACTIVE` and provisioning to `done`,
   - records a `tenant.create` row in `super_admin_audit`.

### Recovering a failed provision

Symptoms: tenant detail page shows `provisioning.state = failed` and an
error string.

1. Open `/superadmin/tenants/<slug>` and read the error in the **Provisión**
   card.
2. The provisioning service already attempted to clean up:
   - `DROP SCHEMA tenant_<slug> CASCADE` ran,
   - the `tenants` row was deleted (so the slug is free again).
3. If cleanup itself failed (rare — would have surfaced in `audit_log`):
   ```sql
   -- as a Postgres role with CREATE/DROP on the cluster:
   DROP SCHEMA IF EXISTS tenant_<slug> CASCADE;
   DELETE FROM payroll_auth.tenant_provisioning WHERE tenant_id = '<uuid>';
   DELETE FROM payroll_auth.tenants            WHERE id        = '<uuid>';
   ```
4. Retry provisioning from the wizard with the same slug.

`GET /superadmin/metrics` lists the last 20 failed provisionings — useful
when you want to triage without browsing tenant by tenant.

## 3. Migrations

### Local

```sh
bun run --filter @payroll/db db:migrate:public          # central schema
bun run --filter @payroll/db db:migrate:tenant          # demo tenant
bun run --filter @payroll/db db:migrate:all-tenants     # every active tenant
bun run --filter @payroll/db db:migrate:all             # both, in order
```

### Production / CI

```sh
bun run --filter @payroll/db migrate:prod
# Equivalent to:
#   bun src/migrate.ts --public
#   bun src/migrate.ts --all-tenants
```

The `--all-tenants` flag iterates every tenant whose status is `ACTIVE` or
`PROVISIONING` and applies pending migrations against
`tenant_<slug>,payroll_auth,public`. Each tenant gets its own
`__migrations` tracking table, so a partial failure leaves the rest
untouched.

### Adding a tenant-side migration

1. Edit a Drizzle schema under `packages/db/src/schema/`.
2. `bun run --filter @payroll/db db:generate:tenant`.
3. Verify the new SQL file lands in `packages/db/drizzle/tenant/`.
4. Append the new entry to `drizzle/tenant/meta/_journal.json`.
5. Run `db:migrate:all-tenants` against staging; smoke-test one tenant.
6. Deploy. CI runs `migrate:prod` automatically.

## 4. Backups and restore

`pg_dump --schema=tenant_<slug>` cleanly captures one tenant in isolation,
which is the right granularity for "one customer asks for a restore":

```sh
# Backup
pg_dump "$DATABASE_URL" \
  --schema=tenant_acme --schema=payroll_auth \
  --format=custom --file=acme.dump

# Restore into a fresh database (staging)
createdb payroll_acme_recovery
pg_restore --dbname=payroll_acme_recovery acme.dump
```

`payroll_auth` has to come along on every restore so the catalog and the
tenants/super_admins rows the restored tenant references are present.

For full-platform backups, dump the whole database — schemas-by-schema is
just slower for the same coverage.

## 5. Permissions incident playbook

### "User says they can't do X"

1. Have them open the browser dev-tools and read the cookie. Decode the
   JWT payload (https://jwt.io). Check:
   - `permissions[]` contains the expected code.
   - `tenantSlug` matches the company they were trying to access.
   - `permissionsVersion` matches the current value in `users` for that
     user (a stale token survives until next request triggers a refresh).
2. Hit `POST /auth/refresh` with the cookie attached — the API re-reads
   the role graph and re-issues the token. Tell them to log out / log in
   if you don't want to debug further.
3. If `permissions[]` does NOT contain the code:
   - `/config/users` → open the user → check assigned roles.
   - `/config/roles/<role-id>` → check the permission set.
   - Update either; both code paths bump `permissions_version` so the next
     login or refresh picks up the change.

### "User can do X they shouldn't"

1. **Immediate mitigation** — deactivate the user from `/config/users` if
   you suspect compromise. That bumps `permissions_version` so the
   existing token is invalidated on the next request.
2. Audit the trail:
   - Tenant-scope: `tenant_<slug>.audit_log` for the user's actions.
   - Cross-tenant: `payroll_auth.super_admin_audit` for impersonations or
     status changes that affected the user.
3. Identify the offending permission grant (it's either on a role they
   hold or a role inherited from one of theirs). Remove the grant; the
   bump propagates.

### Cross-tenant access attempt

`guardTenantMatchesToken` returns 403 with `error: 'Forbidden: tenant
mismatch'`. These should be rare — investigate any cluster of them in
the API logs alongside `audit_log` for the user. Confirmed replay
attempts mean the user's cookie leaked; force a password rotation and
deactivate the session via password reset.

## 6. Observability

Endpoints worth monitoring externally:

- `GET /health` — liveness only.
- `GET /superadmin/metrics` (auth-gated; use a service account token):
  - alert when `tenantCounts.provisioning > 0` for more than 5 minutes,
  - alert on any `failedProvisionings` row newer than 1 hour.
- `GET /superadmin/audit?action=tenant.suspend` — paged feed of the
  destructive actions, fan it out into your incident channel.

Key columns to dashboard from `payroll_auth.super_admin_audit`:

```sql
SELECT date_trunc('hour', created_at) AS hour, action, COUNT(*)
  FROM payroll_auth.super_admin_audit
 WHERE created_at > now() - INTERVAL '24 hours'
 GROUP BY 1, 2
 ORDER BY 1 DESC, 2;
```

## 7. Rotating secrets

`JWT_SECRET` rotation invalidates every cookie at once.

1. Update `JWT_SECRET` in the deployment environment.
2. Restart the API.
3. Force-broadcast a logout to the UI. Users re-authenticate; new tokens
   are signed with the new secret.

Per-tenant database passwords (when you graduate to per-tenant DB roles)
are out of scope here — the current setup uses a single application role
with `USAGE` on every `tenant_<slug>` schema.
