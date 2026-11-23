-- T80a (F41): when a work first left the author (queued, or published at
-- once). The PC reel cleanup asks for these times and trashes the local media
-- that arrived before them. Set once, never cleared: unscheduling keeps it
-- (the bot still holds the media) and a later re-schedule does not move it.

ALTER TABLE drafts ADD COLUMN handed_off_at TEXT;

CREATE INDEX IF NOT EXISTS idx_drafts_handed_off ON drafts (tenant_id, handed_off_at);
