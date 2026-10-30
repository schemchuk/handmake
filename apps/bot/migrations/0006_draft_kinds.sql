-- T25: drafts carry a kind (post | work), their post type (free |
-- announcement | reminder | wotw-poll | wotw-result) and kind extras (JSON:
-- poll spec, entry refs, collection). Type flows through to the dispatch
-- payload, so an announcement is committed as `type: announcement` from now
-- on (no backfill for rows that already exist).
--
-- chat_sessions makes the per-chat flow explicit (post | entry | work): the
-- session points at the draft the author's commands and messages belong to,
-- so a cron-created announcement draft can no longer steal /done, the preview
-- buttons or a collecting text message (review N2, PR #30 note). The
-- one-collecting-draft guard moves from per-chat to per-chat-and-kind.

ALTER TABLE drafts ADD COLUMN kind TEXT NOT NULL DEFAULT 'post';
ALTER TABLE drafts ADD COLUMN type TEXT NOT NULL DEFAULT 'free';
ALTER TABLE drafts ADD COLUMN extras TEXT NOT NULL DEFAULT '{}';

DROP INDEX IF EXISTS idx_drafts_one_collecting;
CREATE UNIQUE INDEX idx_drafts_one_collecting
  ON drafts (tenant_id, chat_id, kind)
  WHERE status = 'collecting';

CREATE TABLE IF NOT EXISTS chat_sessions (
  tenant_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  draft_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (tenant_id, chat_id)
);
