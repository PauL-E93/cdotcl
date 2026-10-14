CREATE TABLE IF NOT EXISTS session_automation (
    automation_id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    auto_no_show TINYINT(1) NOT NULL DEFAULT 1,
    no_show_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
    auto_done TINYINT(1) NOT NULL DEFAULT 1,
    done_delay_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    effective_from DATETIME NOT NULL,
    updated_by INT DEFAULT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT session_automation_single_policy CHECK (automation_id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS session_automation_history (
    history_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    action VARCHAR(20) NOT NULL,
    employee_id INT DEFAULT NULL,
    settings_json LONGTEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS session_automation_log (
    log_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    preference_id INT NOT NULL,
    enrollment_details_id INT NOT NULL,
    old_status VARCHAR(30) NOT NULL,
    new_status VARCHAR(30) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    changed_at DATETIME NOT NULL,
    email_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    INDEX automation_enrollment (enrollment_details_id, changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS session_automation_worker (
    worker_id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    last_run_at DATETIME DEFAULT NULL,
    last_changed INT UNSIGNED NOT NULL DEFAULT 0,
    last_error VARCHAR(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO session_automation_worker (worker_id) VALUES (1);
