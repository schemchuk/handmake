-- Extend network constraints while preserving reader data, edit arms and indexes.
CREATE TABLE comments_new (
  tenant_id TEXT NOT NULL,
  network TEXT NOT NULL CHECK (network IN ('instagram', 'facebook', 'threads')),
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
ALTER TABLE comments_new ADD COLUMN edit_chat_id TEXT;
ALTER TABLE comments_new ADD COLUMN edit_expires_at TEXT;
INSERT INTO comments_new SELECT * FROM comments;
DROP TABLE comments;
ALTER TABLE comments_new RENAME TO comments;
CREATE INDEX idx_comments_pending_notify ON comments (tenant_id, status, notified_at);
CREATE INDEX idx_comments_retention ON comments (created_at);
CREATE UNIQUE INDEX idx_comments_edit_chat ON comments (tenant_id, edit_chat_id)
  WHERE edit_chat_id IS NOT NULL;
CREATE TABLE comment_watermarks_new (
  tenant_id TEXT NOT NULL,
  network TEXT NOT NULL CHECK (network IN ('instagram', 'facebook', 'threads')),
  watermark TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, network)
);
INSERT INTO comment_watermarks_new SELECT * FROM comment_watermarks;
DROP TABLE comment_watermarks;
ALTER TABLE comment_watermarks_new RENAME TO comment_watermarks;
