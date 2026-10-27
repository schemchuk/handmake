-- All bot tables are keyed by tenant_id (ADR 006): every entity belongs to
-- exactly one tenant and no query crosses tenants. The draft state machine
-- arrives in T14; publish requests in T16.

CREATE TABLE IF NOT EXISTS drafts (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'collecting',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_drafts_chat ON drafts (tenant_id, chat_id);

-- One publish request per draft; the ready -> publishing transition in T16
-- inserts here, which is what makes a double press idempotent (A4).
CREATE TABLE IF NOT EXISTS publish_requests (
  tenant_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (tenant_id, draft_id)
);
