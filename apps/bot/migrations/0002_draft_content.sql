-- T14: a collecting draft holds its content — UA/DE texts as a JSON object
-- ({"ua": "...", "de": "..."}) and Telegram photo file_ids as a JSON array
-- (architecture 4.1: photos stay file_ids, no binary storage in the Worker).
-- Status values are the DraftState values from @handmake/core.

ALTER TABLE drafts ADD COLUMN texts TEXT NOT NULL DEFAULT '{}';
ALTER TABLE drafts ADD COLUMN photos TEXT NOT NULL DEFAULT '[]';
