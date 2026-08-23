CREATE TABLE IF NOT EXISTS enrollment_email_verifications (
    verification_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    email VARCHAR(150) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL,
    verification_token_hash CHAR(64) DEFAULT NULL,
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    expires_at DATETIME NOT NULL,
    verified_at DATETIME DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (verification_id),
    KEY idx_enrollment_verification_email (email),
    KEY idx_enrollment_verification_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Existing installations may already contain duplicate usernames, so a global
-- UNIQUE index cannot be added safely. This table serializes and reserves every
-- username created by the new public application workflow.
CREATE TABLE IF NOT EXISTS enrollment_application_usernames (
    username_key VARCHAR(100) NOT NULL,
    student_id INT(11) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (username_key),
    UNIQUE KEY uq_application_username_student (student_id),
    CONSTRAINT fk_application_username_student FOREIGN KEY (student_id) REFERENCES student (student_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS enrollment_applications (
    application_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    application_number VARCHAR(30) NOT NULL,
    tracking_token_hash CHAR(64) NOT NULL,
    student_id INT(11) NOT NULL,
    program_id INT(11) NOT NULL,
    branch_id INT(111) NOT NULL,
    school_year_id INT(11) NOT NULL,
    grade_level_id INT(11) DEFAULT NULL,
    goal TEXT DEFAULT NULL,
    status ENUM(
        'pending_review',
        'approved_for_payment',
        'ready_for_scheduling',
        'enrolled',
        'rejected',
        'cancelled'
    ) NOT NULL DEFAULT 'pending_review',
    email_verified_at DATETIME NOT NULL,
    reviewed_by INT(11) DEFAULT NULL,
    reviewed_at DATETIME DEFAULT NULL,
    review_notes TEXT DEFAULT NULL,
    enrollment_details_id INT(11) DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (application_id),
    UNIQUE KEY uq_enrollment_application_number (application_number),
    UNIQUE KEY uq_enrollment_application_tracking_hash (tracking_token_hash),
    KEY idx_enrollment_application_status (status, created_at),
    KEY idx_enrollment_application_student (student_id),
    KEY idx_enrollment_application_branch (branch_id),
    CONSTRAINT fk_application_student FOREIGN KEY (student_id) REFERENCES student (student_id),
    CONSTRAINT fk_application_program FOREIGN KEY (program_id) REFERENCES program (program_id),
    CONSTRAINT fk_application_branch FOREIGN KEY (branch_id) REFERENCES branch (branch_id),
    CONSTRAINT fk_application_school_year FOREIGN KEY (school_year_id) REFERENCES school_years (school_year_id),
    CONSTRAINT fk_application_grade FOREIGN KEY (grade_level_id) REFERENCES grade_level (grade_level_id),
    CONSTRAINT fk_application_reviewer FOREIGN KEY (reviewed_by) REFERENCES employee (employee_id),
    CONSTRAINT fk_application_enrollment FOREIGN KEY (enrollment_details_id) REFERENCES enrollment_details (enrollment_details_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS enrollment_application_subjects (
    application_subject_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    application_id BIGINT UNSIGNED NOT NULL,
    subject_id INT(11) NOT NULL,
    PRIMARY KEY (application_subject_id),
    UNIQUE KEY uq_application_subject (application_id, subject_id),
    KEY idx_application_subject_subject (subject_id),
    CONSTRAINT fk_application_subject_application FOREIGN KEY (application_id) REFERENCES enrollment_applications (application_id) ON DELETE CASCADE,
    CONSTRAINT fk_application_subject_subject FOREIGN KEY (subject_id) REFERENCES subject (subject_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS enrollment_application_availability (
    availability_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    application_id BIGINT UNSIGNED NOT NULL,
    day ENUM('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    PRIMARY KEY (availability_id),
    UNIQUE KEY uq_application_availability (application_id, day, start_time, end_time),
    CONSTRAINT fk_application_availability_application FOREIGN KEY (application_id) REFERENCES enrollment_applications (application_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
