-- Reader comments on our own Meta posts (F34, T49c). Handle and text are
-- reader personal data: kept only in D1 (never Git/logs), keyed by tenant,
-- deleted 30 days after the row was created. Status lifecycle:
-- new -> drafting -> drafted -> (T49c3) sending -> sent | skipped.
CREATE TABLE comments (
  tenant_id TEXT NOT NULL,
  network TEXT NOT NULL CHECK (network IN ('instagram', 'facebook')),
  id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('new', 'drafting', 'drafted', 'sending', 'sent', 'skipped')),
  translation_uk TEXT,
  reply_de TEXT,
  notes_uk TEXT,
  notified_at TEXT,
  comment_created_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, network, id)
);
CREATE INDEX idx_comments_pending_notify ON comments (tenant_id, status, notified_at);
CREATE INDEX idx_comments_retention ON comments (created_at);

-- Per-tenant+network watermark bounding Meta API calls: advanced to the
-- safely scanned boundaries (inclusive; id dedupe covers repeats).
CREATE TABLE comment_watermarks (
  tenant_id TEXT NOT NULL,
  network TEXT NOT NULL CHECK (network IN ('instagram', 'facebook')),
  watermark TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, network)
);
