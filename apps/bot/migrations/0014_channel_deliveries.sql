CREATE TABLE channel_deliveries (
  tenant_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('done', 'failed')),
  message_ids TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, post_id, channel)
);
