-- Private deletion markers survive entry/draft cleanup; never store the deleted name.
CREATE TABLE name_withdrawals (
  tenant_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, entry_id)
);
-- One generation per distinct withdrawn entry referenced by a publication.
CREATE TABLE name_reconciliations (
  tenant_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation > 0),
  completed_generation INTEGER NOT NULL DEFAULT 0,
  next_operation INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'running', 'failed', 'blocked', 'done')),
  error_code TEXT,
  PRIMARY KEY (tenant_id, post_id, channel)
);
