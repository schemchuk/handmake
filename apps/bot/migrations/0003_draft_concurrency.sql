-- T14 re-review: make concurrent collection safe. Telegram delivers an album
-- as several messages and the Worker may handle them in parallel, so
-- read-modify-write on a draft must not lose photos, must not create two
-- collecting drafts for one chat, and must not let the 10-photo limit be
-- bypassed. Two guards:
--   * `version` — an optimistic-lock counter; writers UPDATE ... WHERE
--     version = ? and retry on a conflict, which serializes appends.
--   * a partial unique index — at most one collecting draft per chat.
-- Webhook retries are deduplicated by Telegram's update_id.

ALTER TABLE drafts ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_drafts_one_collecting
  ON drafts (tenant_id, chat_id)
  WHERE status = 'collecting';

CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY,
  processed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
