ALTER TABLE notification
    ADD COLUMN dismissed_at DATETIME NULL DEFAULT NULL AFTER is_read,
    ADD INDEX idx_notification_recipient_history
        (user_id, user_type, dismissed_at, created_at);
