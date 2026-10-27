-- T15: reply-based editing (ADR 005). Pressing "Edit UA/DE" stores which
-- version the author's next text message replaces; NULL means "collect as
-- usual". Values: 'uk' | 'de' (the canonical draft language keys).

ALTER TABLE drafts ADD COLUMN pending_edit TEXT;
