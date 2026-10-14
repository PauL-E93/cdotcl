-- Add archive status for installations that do not yet have the column.
SET @payment_method_status_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'payment_method'
      AND COLUMN_NAME = 'status'
);

SET @payment_method_status_sql = IF(
    @payment_method_status_exists = 0,
    'ALTER TABLE payment_method ADD COLUMN status ENUM(''active'', ''inactive'') NOT NULL DEFAULT ''active'' AFTER qr_code',
    'SELECT 1'
);
PREPARE payment_method_status_stmt FROM @payment_method_status_sql;
EXECUTE payment_method_status_stmt;
DEALLOCATE PREPARE payment_method_status_stmt;

-- Existing rows may have an empty enum value if the column was added manually.
UPDATE payment_method SET status = 'active' WHERE status NOT IN ('active', 'inactive');
