<?php
require_once __DIR__ . '/SecretCipher.php';
require_once __DIR__ . '/PasswordPolicy.php';

final class EmployeeCredentials
{
    public static function generatePassword(): string
    {
        $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*?';
        do {
            $password = '';
            for ($i = 0; $i < 24; $i++) {
                $password .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            }
        } while (!PasswordPolicy::valid($password));
        return $password;
    }

    public static function adultBirthday($value, ?DateTimeImmutable $today = null): bool
    {
        if (!is_string($value)) return false;
        $timezone = new DateTimeZone('Asia/Manila');
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, $timezone);
        $today = $today ?? new DateTimeImmutable('today', $timezone);
        return $date && $date->format('Y-m-d') === $value
            && $date <= $today && $date->diff($today)->y >= 18;
    }

    public static function ensureSchema(PDO $conn): void
    {
        $conn->exec('CREATE TABLE IF NOT EXISTS employee_generated_credentials (
            employee_id INT NOT NULL PRIMARY KEY,
            password_encrypted TEXT NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    }
}
