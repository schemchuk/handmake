-- T77 (F42): delayed channels. A work's first run delivers the channels
-- without a delay; each delayed channel (Threads +90 min, Pinterest next
-- morning) waits here and the bot cron dispatches it later with the stored
-- job and `channels: [<channel>]`. A row is only dispatched once its draft
-- is 'published' (the first run reported back), so a delayed channel never
-- goes out alone.
--   job            the dispatched job (JSON), reused for the follow-up run.
--   state          pending -> dispatched -> done (callback) | failed (gave up).
--   attempts       dispatches made; a failed dispatch retries after one tick,
--                  a dispatched run with no callback after 2 h is dispatched
--                  again; after 3 the row is 'failed' and the author is told.

CREATE TABLE IF NOT EXISTS channel_followups (
  tenant_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  job TEXT NOT NULL,
  due_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'dispatched', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  dispatched_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, draft_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_channel_followups_due ON channel_followups (state, due_at);
