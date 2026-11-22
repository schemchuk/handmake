-- T76a (F42): the release queue. A work the author approves waits in
-- status 'scheduled' until its slot; the bot cron claims due rows
-- ('scheduled' -> 'publishing') and dispatches them. `publish_at` is the slot
-- (UTC ISO); `queue_attempts` counts failed dispatch ticks (3 -> back to
-- 'ready', the author is told). The front-matter date stays the draft's
-- creation time, so queueing never moves it.

ALTER TABLE drafts ADD COLUMN publish_at TEXT;
ALTER TABLE drafts ADD COLUMN queue_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_drafts_release_queue
  ON drafts (tenant_id, status, publish_at);
