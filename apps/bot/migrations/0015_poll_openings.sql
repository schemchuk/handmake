-- Keep opening receipts separate from deletable drafts, including skipped weeks.
CREATE TABLE poll_openings (
  tenant_id TEXT NOT NULL,
  week TEXT NOT NULL,
  PRIMARY KEY (tenant_id, week)
);
