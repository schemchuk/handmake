-- Daily aggregate page views only: no visitor identifiers or per-request rows.
CREATE TABLE site_visits (
  tenant_id TEXT NOT NULL,
  day TEXT NOT NULL,
  path TEXT NOT NULL,
  source TEXT NOT NULL,
  country TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, day, path, source, country)
);
