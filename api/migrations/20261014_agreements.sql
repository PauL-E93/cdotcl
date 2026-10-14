CREATE TABLE IF NOT EXISTS agreement_templates (
    agreement_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    tutorial_setup ENUM('all','center','home','online') NOT NULL DEFAULT 'all',
    program_id INT DEFAULT NULL,
    status ENUM('active','inactive') NOT NULL DEFAULT 'inactive',
    display_order INT UNSIGNED NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_agreement_applicable (status, tutorial_setup, program_id),
    FOREIGN KEY (program_id) REFERENCES program(program_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS agreement_clauses (
    clause_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    agreement_id INT UNSIGNED NOT NULL,
    clause_text TEXT NOT NULL,
    is_required TINYINT(1) NOT NULL DEFAULT 1,
    display_order INT UNSIGNED NOT NULL DEFAULT 0,
    FOREIGN KEY (agreement_id) REFERENCES agreement_templates(agreement_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS agreement_acceptances (
    acceptance_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    agreement_id INT UNSIGNED NOT NULL,
    application_id BIGINT UNSIGNED NOT NULL,
    student_id INT NOT NULL,
    guardian_name VARCHAR(255) NOT NULL,
    tutorial_setup ENUM('center','home','online') NOT NULL,
    accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    checked_clauses_json LONGTEXT NOT NULL,
    agreement_snapshot_json LONGTEXT NOT NULL,
    UNIQUE KEY uq_agreement_application (application_id, agreement_id),
    KEY idx_acceptance_student (student_id),
    FOREIGN KEY (agreement_id) REFERENCES agreement_templates(agreement_id),
    FOREIGN KEY (application_id) REFERENCES enrollment_applications(application_id),
    FOREIGN KEY (student_id) REFERENCES student(student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Nullable for legacy applications, which have no recorded setup or acceptance.
-- The PHP migration adds this column idempotently.

CREATE TABLE IF NOT EXISTS enrollment_agreement_acceptances (
    acceptance_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    agreement_id INT UNSIGNED NOT NULL,
    enrollment_details_id INT NOT NULL,
    student_id INT NOT NULL,
    guardian_name VARCHAR(255) NOT NULL,
    tutorial_setup ENUM('center','home','online') NOT NULL,
    accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    checked_clauses_json LONGTEXT NOT NULL,
    agreement_snapshot_json LONGTEXT NOT NULL,
    UNIQUE KEY uq_agreement_enrollment (enrollment_details_id, agreement_id),
    FOREIGN KEY (agreement_id) REFERENCES agreement_templates(agreement_id),
    FOREIGN KEY (enrollment_details_id) REFERENCES enrollment_details(enrollment_details_id),
    FOREIGN KEY (student_id) REFERENCES student(student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
