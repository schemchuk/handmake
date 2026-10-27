-- T18: index of published posts, written by the publisher's published
-- callback (architecture 4.3). One row per published post; the primary key
-- makes the insert idempotent, so a retried or duplicated callback can
-- never index the same post twice. Photos are the repo paths from the
-- callback body, stored as a JSON array.

CREATE TABLE published_posts (
  tenant_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  published_at TEXT NOT NULL,
  photos TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, post_id)
);
