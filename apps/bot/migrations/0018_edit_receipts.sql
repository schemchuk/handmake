-- Anonymous publication source survives draft cleanup; IDs are tenant scoped.
CREATE TABLE anonymous_edit_receipts (
  tenant_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  receipt TEXT NOT NULL CHECK (length(receipt) <= 70000),
  published_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, post_id, channel)
);
ALTER TABLE poll_results ADD COLUMN published_at TEXT;
