-- Anonymous workflow measurements survive draft cleanup; no content or user IDs.
-- Do not backfill historical ready/edit times that cannot be reconstructed.
CREATE TABLE draft_usage (
  tenant_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  first_ready_at TEXT,
  tracked_from_creation INTEGER NOT NULL DEFAULT 0,
  uk_edits INTEGER NOT NULL DEFAULT 0,
  de_edits INTEGER NOT NULL DEFAULT 0,
  regenerations INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, draft_id)
);
CREATE TABLE usage_publications (
  tenant_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, draft_id)
);
CREATE TABLE usage_deliveries (
  tenant_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('done', 'failed')),
  observed_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, draft_id, channel)
);
CREATE INDEX idx_usage_delivery_time ON usage_deliveries (tenant_id, observed_at);
CREATE TRIGGER usage_draft_insert AFTER INSERT ON drafts BEGIN
  INSERT INTO draft_usage (tenant_id, draft_id, created_at, first_ready_at, tracked_from_creation)
  VALUES (NEW.tenant_id, NEW.id, NEW.created_at,
    CASE WHEN NEW.status = 'ready' THEN NEW.updated_at END, 1);
END;
-- The trigger shares the guarded draft mutation's transaction: failed CAS,
-- duplicate callbacks and stale claims never increment counters independently.
CREATE TRIGGER usage_draft_update AFTER UPDATE ON drafts BEGIN
  INSERT OR IGNORE INTO draft_usage (tenant_id, draft_id, created_at)
    VALUES (NEW.tenant_id, NEW.id, NEW.created_at);
  UPDATE draft_usage SET
    first_ready_at = CASE WHEN NEW.status = 'ready'
      THEN COALESCE(first_ready_at, NEW.updated_at) ELSE first_ready_at END,
    uk_edits = uk_edits + CASE WHEN OLD.pending_edit = 'uk'
      AND NEW.pending_edit IS NULL AND NEW.texts != OLD.texts THEN 1 ELSE 0 END,
    de_edits = de_edits + CASE WHEN OLD.pending_edit = 'de'
      AND NEW.pending_edit IS NULL AND NEW.texts != OLD.texts THEN 1 ELSE 0 END,
    regenerations = regenerations + CASE WHEN OLD.status = 'ready'
      AND NEW.status = 'translating' THEN 1 ELSE 0 END
  WHERE tenant_id = NEW.tenant_id AND draft_id = NEW.id;
END;
