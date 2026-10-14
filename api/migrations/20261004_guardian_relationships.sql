CREATE TABLE IF NOT EXISTS guardian_relationships (
    relationship_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    relationship_name VARCHAR(50) NOT NULL,
    UNIQUE KEY uq_guardian_relationship_name (relationship_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT IGNORE INTO guardian_relationships (relationship_name)
VALUES ('Mother'), ('Father'), ('Lolo'), ('Lola'), ('Guardian');