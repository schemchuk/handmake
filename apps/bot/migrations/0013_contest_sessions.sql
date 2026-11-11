-- Short-lived author input, separate from submitted entries and publishing drafts.
CREATE TABLE contest_sessions (
  tenant_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  file_id TEXT CHECK (file_id IS NULL OR length(file_id) > 0),
  display_name TEXT CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 30),
  name_chosen INTEGER NOT NULL DEFAULT 0 CHECK (name_chosen IN (0, 1)),
  expires_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, chat_id)
);
