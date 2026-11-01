-- One paid show flow per tenant, retained for reconciliation after uncertain calls.
CREATE TABLE show_generation_locks (
  tenant_id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  lease TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
