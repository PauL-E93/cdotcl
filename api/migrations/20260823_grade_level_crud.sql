ALTER TABLE grade_level
    ADD COLUMN IF NOT EXISTS status ENUM('active', 'inactive') NOT NULL DEFAULT 'active' AFTER grade_level;

