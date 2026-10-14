<?php

function ensureGuardianRelationshipSchema(PDO $conn): void
{
    $sql = file_get_contents(__DIR__ . '/migrations/20261004_guardian_relationships.sql');
    if ($sql === false) {
        throw new RuntimeException('Unable to load guardian relationship schema.');
    }
    $conn->exec($sql);
}

function validateGuardianRelationship($value): string
{
    if (!is_string($value)) {
        throw new InvalidArgumentException('Guardian relationship must be text.');
    }
    $name = trim(preg_replace('/\s+/u', ' ', $value) ?? '');
    $length = function_exists('mb_strlen') ? mb_strlen($name, 'UTF-8') : strlen($name);
    if ($length < 1 || $length > 50 || preg_match('/[\p{C}]/u', $name)) {
        throw new InvalidArgumentException('Guardian relationship must contain 1 to 50 characters.');
    }
    if (in_array(strtolower($name), ['other', 'others'], true)) {
        throw new InvalidArgumentException('Please specify the other guardian relationship.');
    }
    return $name;
}

// Call within the application transaction so failed applications leave no new choices.
function saveGuardianRelationship(PDO $conn, string $name): string
{
    $name = validateGuardianRelationship($name);
    $insert = $conn->prepare('INSERT INTO guardian_relationships (relationship_name) VALUES (?) ON DUPLICATE KEY UPDATE relationship_name = relationship_name');
    $insert->execute([$name]);
    $select = $conn->prepare('SELECT relationship_name FROM guardian_relationships WHERE relationship_name = ?');
    $select->execute([$name]);
    return (string)$select->fetchColumn();
}
