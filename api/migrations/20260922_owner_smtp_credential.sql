ALTER TABLE employee
    ADD COLUMN IF NOT EXISTS smtp_app_password_encrypted TEXT NULL AFTER email;
