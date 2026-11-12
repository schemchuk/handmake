-- No time-based takeover: the remote API cannot fence an in-flight edit.
ALTER TABLE name_reconciliations ADD COLUMN lock_token TEXT;
