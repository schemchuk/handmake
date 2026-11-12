-- Durable result receipts survive draft cleanup; no names or voter identities.
ALTER TABLE contest_entries ADD COLUMN winner INTEGER NOT NULL DEFAULT 0 CHECK (winner IN (0, 1));
CREATE UNIQUE INDEX contest_entries_winner ON contest_entries (tenant_id, week) WHERE winner = 1;
CREATE TABLE poll_results (
  tenant_id TEXT NOT NULL,
  week TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('readers', 'author')),
  PRIMARY KEY (tenant_id, week),
  FOREIGN KEY (tenant_id, entry_id) REFERENCES contest_entries (tenant_id, entry_id)
);
