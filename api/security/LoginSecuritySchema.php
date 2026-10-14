<?php

final class LoginSecuritySchema
{
    public static function ensure(PDO $connection)
    {
        static $ready = false;
        if ($ready) {
            return;
        }

        $tableCheck = $connection->query(
            "SELECT COUNT(*)
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME IN ('login_rate_limits', 'authentication_audit_log')"
        );

        if ((int) $tableCheck->fetchColumn() !== 2) {
            $connection->exec(
                "CREATE TABLE IF NOT EXISTS login_rate_limits (
                    scope VARCHAR(32) NOT NULL,
                    identifier_hash CHAR(64) NOT NULL,
                    attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
                    window_started_at BIGINT UNSIGNED NOT NULL,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (scope, identifier_hash),
                    KEY idx_login_rate_limits_updated (updated_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci"
            );

            $connection->exec(
                "CREATE TABLE IF NOT EXISTS authentication_audit_log (
                    audit_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                    event_type VARCHAR(32) NOT NULL,
                    outcome VARCHAR(20) NOT NULL,
                    reason_code VARCHAR(50) DEFAULT NULL,
                    attempted_username VARCHAR(100) DEFAULT NULL,
                    target_user_type VARCHAR(20) DEFAULT NULL,
                    target_user_id INT DEFAULT NULL,
                    target_role VARCHAR(100) DEFAULT NULL,
                    ip_address VARCHAR(45) NOT NULL,
                    user_agent VARCHAR(500) DEFAULT NULL,
                    occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (audit_id),
                    KEY idx_auth_audit_account (target_user_type, target_user_id, occurred_at),
                    KEY idx_auth_audit_username (attempted_username, occurred_at),
                    KEY idx_auth_audit_ip (ip_address, occurred_at),
                    KEY idx_auth_audit_date (occurred_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci"
            );
        }

        $ready = true;
    }
}

