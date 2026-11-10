-- Durable, chat-scoped 30-minute edit arms; cleanup follows the comment row.
ALTER TABLE comments ADD COLUMN edit_chat_id TEXT;
ALTER TABLE comments ADD COLUMN edit_expires_at TEXT;
CREATE UNIQUE INDEX idx_comments_edit_chat ON comments (tenant_id, edit_chat_id)
  WHERE edit_chat_id IS NOT NULL;
