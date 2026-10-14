CREATE TABLE IF NOT EXISTS billing_penalty_adjustments (
    adjustment_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    billing_schedule_id INT NOT NULL,
    adjustment_type ENUM('waiver', 'reduction') NOT NULL,
    previous_penalty DECIMAL(12,2) NOT NULL,
    agreed_penalty DECIMAL(12,2) NOT NULL,
    waived_amount DECIMAL(12,2) NOT NULL,
    guardian_name VARCHAR(255) NOT NULL,
    reason TEXT NOT NULL,
    agreement_notes TEXT NOT NULL,
    pause_until DATE DEFAULT NULL,
    approved_by INT NOT NULL,
    approved_by_name VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_penalty_bill (billing_schedule_id, adjustment_id),
    FOREIGN KEY (billing_schedule_id) REFERENCES billing_schedule(billing_schedule_id),
    FOREIGN KEY (approved_by) REFERENCES employee(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
