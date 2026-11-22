-- T76b (F42): one cron execution at a time dispatches from the release
-- queue. Overlapping executions (a retried or slow tick) would otherwise both
-- see "nothing in flight" and both dispatch, and the repository-wide
-- `publish` concurrency group keeps only one pending run (PR #189 review).
-- A single row holds a short lease; an expired lease is taken over.

CREATE TABLE IF NOT EXISTS queue_dispatch_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  holder TEXT NOT NULL,
  held_until TEXT NOT NULL
);
