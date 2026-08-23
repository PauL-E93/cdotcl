<?php

/**
 * Keep legacy installations compatible with the grade-level manager.
 * The migration is intentionally idempotent because this project is also
 * commonly opened directly through XAMPP without a separate migration step.
 */
function ensureGradeLevelSchema(PDO $conn): void
{
    static $completedConnections = [];

    $connectionId = spl_object_id($conn);
    if (isset($completedConnections[$connectionId])) {
        return;
    }

    $column = $conn->query("SHOW COLUMNS FROM grade_level LIKE 'status'")->fetch(PDO::FETCH_ASSOC);
    if (!$column) {
        try {
            $conn->exec("ALTER TABLE grade_level ADD COLUMN status ENUM('active', 'inactive') NOT NULL DEFAULT 'active' AFTER grade_level");
        } catch (PDOException $exception) {
            // Another request may have created the column at the same time.
            $column = $conn->query("SHOW COLUMNS FROM grade_level LIKE 'status'")->fetch(PDO::FETCH_ASSOC);
            if (!$column) {
                throw $exception;
            }
        }
    }

    $completedConnections[$connectionId] = true;
}
