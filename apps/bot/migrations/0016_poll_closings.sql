-- Anonymous immutable poll snapshot and final counts; no participant names or voters.
CREATE TABLE poll_closings (
  tenant_id TEXT NOT NULL,
  week TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  claim TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  tally TEXT,
  PRIMARY KEY (tenant_id, week)
);
