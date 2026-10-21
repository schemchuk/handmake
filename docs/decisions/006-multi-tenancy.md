# 006 — Tenant-aware from day one, pluggable content store

Status: accepted · Date: 2026-10-21

## Context
The platform will later be offered to other volunteer groups and bloggers (spec v4, section 12).
Today there is exactly one tenant: the circle. Its content lives in this public repo.

## Options
1. **Single-tenant now, refactor later.** Least work today; later every table, key and config needs a
   migration, and the Git-repo assumption leaks everywhere.
2. **Tenant-aware data and ports now, one tenant and one implementation each.** Small extra cost:
   a `tenantId` column/field and an interface in front of storage and runners.
3. Full multi-tenant SaaS now (sign-up, billing, isolation). Out of scope and budget.

## Decision
Option 2.
- Every entity carries `tenantId`; D1 primary keys and idempotency keys include it.
- Tenant config files move to `config/tenants/<tenantId>.yaml`; secrets are referenced by name and
  resolved through `SecretResolver`.
- `ContentStore` port; `GitRepoContentStore` is the only implementation, used for the circle only.
- `PublishRunner` port; `GitHubActionsRunner` is the only implementation (ADR 003).

## Consequences
- External tenants never write into this repo; adding one requires a second `ContentStore` and a
  queue-based `PublishRunner` (architecture 11.3).
- Tests cover two fake tenants to prove isolation (no cross-tenant reads).
