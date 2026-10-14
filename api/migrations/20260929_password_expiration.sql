ALTER TABLE student
    ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER password_hash;

ALTER TABLE student
    ADD COLUMN IF NOT EXISTS password_is_temporary TINYINT(1) NOT NULL DEFAULT 0 AFTER password_changed_at;

ALTER TABLE employee
    ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER password_hash;

ALTER TABLE employee
    ADD COLUMN IF NOT EXISTS password_is_temporary TINYINT(1) NOT NULL DEFAULT 0 AFTER password_changed_at;
