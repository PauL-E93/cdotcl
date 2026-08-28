ALTER TABLE billing_schedule
    MODIFY COLUMN status ENUM('unpaid','paid','overdue','partial','pending','cancelled') DEFAULT NULL;

ALTER TABLE enrollment_header
    MODIFY COLUMN status ENUM('pending','approved','enrolled','incomplete','completed','cancelled','withdrawn') DEFAULT NULL;

ALTER TABLE enrollment_details
    MODIFY COLUMN status ENUM('enrolled','completed','pending','incomplete','cancelled','withdrawn','active','session done') DEFAULT NULL;

CREATE TABLE IF NOT EXISTS enrollment_application_financial_snapshots (
    application_id BIGINT UNSIGNED NOT NULL,
    program_name VARCHAR(150) NOT NULL,
    program_type_name VARCHAR(100) DEFAULT NULL,
    unit_type VARCHAR(50) DEFAULT NULL,
    total_units INT NOT NULL DEFAULT 1,
    tuition_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    tuition_only_subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
    misc_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    service_id INT(11) DEFAULT NULL,
    service_name VARCHAR(100) DEFAULT NULL,
    service_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    service_total DECIMAL(10,2) NOT NULL DEFAULT 0,
    discount_id INT(11) DEFAULT NULL,
    discount_name VARCHAR(100) DEFAULT NULL,
    discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    registration_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
    downpayment_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    total_after_discount DECIMAL(10,2) NOT NULL DEFAULT 0,
    grand_total DECIMAL(10,2) NOT NULL DEFAULT 0,
    initial_payment DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (application_id),
    CONSTRAINT fk_application_financial_snapshot
        FOREIGN KEY (application_id) REFERENCES enrollment_applications (application_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS enrollment_application_fee_items (
    application_fee_item_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    application_id BIGINT UNSIGNED NOT NULL,
    item_type VARCHAR(40) NOT NULL,
    reference_id INT(11) DEFAULT NULL,
    description VARCHAR(180) NOT NULL,
    quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
    line_total DECIMAL(10,2) NOT NULL DEFAULT 0,
    is_recurring TINYINT(1) NOT NULL DEFAULT 0,
    recurrence_count INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (application_fee_item_id),
    KEY idx_application_fee_items (application_id, item_type),
    CONSTRAINT fk_application_fee_item_application
        FOREIGN KEY (application_id) REFERENCES enrollment_applications (application_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS billing_schedule_items (
    billing_schedule_item_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    billing_schedule_id INT(11) NOT NULL,
    item_type VARCHAR(40) NOT NULL,
    reference_id INT(11) DEFAULT NULL,
    description VARCHAR(180) NOT NULL,
    quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
    line_total DECIMAL(10,2) NOT NULL DEFAULT 0,
    penalty_eligible TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (billing_schedule_item_id),
    KEY idx_billing_schedule_items (billing_schedule_id, item_type),
    CONSTRAINT fk_billing_schedule_item_bill
        FOREIGN KEY (billing_schedule_id) REFERENCES billing_schedule (billing_schedule_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS enrollment_service_subscriptions (
    subscription_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    enrollment_details_id INT(11) NOT NULL,
    service_id INT(11) DEFAULT NULL,
    service_name VARCHAR(100) NOT NULL,
    monthly_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    effective_start_date DATE NOT NULL,
    effective_end_date DATE DEFAULT NULL,
    status ENUM('active','scheduled_stop','stopped') NOT NULL DEFAULT 'active',
    stop_reason VARCHAR(255) DEFAULT NULL,
    created_by INT(11) DEFAULT NULL,
    stopped_by INT(11) DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (subscription_id),
    KEY idx_enrollment_service_status (enrollment_details_id, status),
    CONSTRAINT fk_subscription_enrollment
        FOREIGN KEY (enrollment_details_id) REFERENCES enrollment_details (enrollment_details_id),
    CONSTRAINT fk_subscription_service
        FOREIGN KEY (service_id) REFERENCES service (service_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS product_orders (
    product_order_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    enrollment_details_id INT(11) NOT NULL,
    application_id BIGINT UNSIGNED DEFAULT NULL,
    billing_schedule_id INT(11) DEFAULT NULL,
    order_type ENUM('enrollment_bundle','additional_request') NOT NULL,
    status ENUM('included','awaiting_payment','paid','released','cancelled') NOT NULL,
    notes VARCHAR(255) DEFAULT NULL,
    requested_by INT(11) DEFAULT NULL,
    released_by INT(11) DEFAULT NULL,
    requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released_at DATETIME DEFAULT NULL,
    PRIMARY KEY (product_order_id),
    KEY idx_product_order_enrollment (enrollment_details_id, status),
    KEY idx_product_order_bill (billing_schedule_id),
    CONSTRAINT fk_product_order_enrollment
        FOREIGN KEY (enrollment_details_id) REFERENCES enrollment_details (enrollment_details_id),
    CONSTRAINT fk_product_order_application
        FOREIGN KEY (application_id) REFERENCES enrollment_applications (application_id) ON DELETE SET NULL,
    CONSTRAINT fk_product_order_bill
        FOREIGN KEY (billing_schedule_id) REFERENCES billing_schedule (billing_schedule_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS product_order_items (
    product_order_item_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    product_order_id BIGINT UNSIGNED NOT NULL,
    product_id INT(11) NOT NULL,
    product_name VARCHAR(150) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
    line_total DECIMAL(10,2) NOT NULL DEFAULT 0,
    item_note VARCHAR(100) DEFAULT NULL,
    PRIMARY KEY (product_order_item_id),
    KEY idx_product_order_items (product_order_id, product_id),
    CONSTRAINT fk_product_order_item_order
        FOREIGN KEY (product_order_id) REFERENCES product_orders (product_order_id) ON DELETE CASCADE,
    CONSTRAINT fk_product_order_item_product
        FOREIGN KEY (product_id) REFERENCES product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS inventory_transactions (
    inventory_transaction_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    product_id INT(11) NOT NULL,
    product_order_item_id BIGINT UNSIGNED DEFAULT NULL,
    transaction_type ENUM('release','restock','adjustment') NOT NULL,
    quantity_change INT NOT NULL,
    balance_after INT NOT NULL,
    performed_by INT(11) DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (inventory_transaction_id),
    KEY idx_inventory_product_date (product_id, created_at),
    CONSTRAINT fk_inventory_transaction_product
        FOREIGN KEY (product_id) REFERENCES product (product_id),
    CONSTRAINT fk_inventory_transaction_order_item
        FOREIGN KEY (product_order_item_id) REFERENCES product_order_items (product_order_item_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
