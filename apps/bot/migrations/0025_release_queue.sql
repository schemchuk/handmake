-- T76a (F42): the release queue. A work the author approves waits in
-- status 'scheduled' until its slot; the bot cron claims due rows
-- ('scheduled' -> 'publishing') and dispatches them. The front-matter date
-- stays the draft's creation time, so queueing never moves it.
--   publish_at     the slot (UTC ISO); kept while publishing, cleared when a
--                  manual publish takes over or the queue gives up.
--   retry_at       after a failed dispatch: the earliest next claim, so two
--                  executions of one cron tick never spend two attempts.
--   dispatched_at  set once GitHub accepted the dispatch; a 'publishing'
--                  queued row without it was interrupted and is reclaimed.
--   queue_attempts failed dispatch ticks (3 -> back to 'ready').
-- One queued work per tenant and slot, enforced here, not by the caller.

ALTER TABLE drafts ADD COLUMN publish_at TEXT;
ALTER TABLE drafts ADD COLUMN retry_at TEXT;
ALTER TABLE drafts ADD COLUMN dispatched_at TEXT;
ALTER TABLE drafts ADD COLUMN queue_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_drafts_release_queue
  ON drafts (tenant_id, status, publish_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_drafts_one_per_slot
  ON drafts (tenant_id, publish_at)
  WHERE status = 'scheduled';
