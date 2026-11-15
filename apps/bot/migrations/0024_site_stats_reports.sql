-- One at-most-once weekly report claim per tenant; no recipient data.
CREATE TABLE site_stats_reports (
  tenant_id TEXT PRIMARY KEY,
  week TEXT NOT NULL
);
