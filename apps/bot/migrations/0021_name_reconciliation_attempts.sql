-- Fair retry ordering prevents permanently rejected publications starving others.
ALTER TABLE name_reconciliations ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
