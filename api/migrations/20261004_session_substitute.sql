ALTER TABLE enrollment_preferred_schedule
    ADD COLUMN IF NOT EXISTS substitute_teacher_id INT NULL DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS substitute_reason VARCHAR(500) NULL DEFAULT NULL;
