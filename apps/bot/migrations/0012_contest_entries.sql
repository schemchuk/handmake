-- Optional consented names remain deletable in D1, never in Git content.
CREATE TABLE contest_entries (
  entry_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  week TEXT NOT NULL,
  file_id TEXT NOT NULL CHECK (length(file_id) > 0),
  display_name TEXT CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 30),
  consent_at TEXT NOT NULL CHECK (length(consent_at) > 0),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'withdrawn')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, entry_id)
);
CREATE INDEX contest_entries_week ON contest_entries (tenant_id, week, status, created_at, entry_id);
