<?php

final class PasswordExpiration
{
    public const MAX_PASSWORD_AGE_DAYS = 72;
    public const CHANGE_SESSION_TTL_SECONDS = 600;

    public static function ensureSchema(PDO $connection)
    {
        static $ready = false;
        if ($ready) {
            return;
        }

        foreach (['student', 'employee'] as $table) {
            $statement = $connection->query(
                "SELECT COUNT(*)
                 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = " . $connection->quote($table) . "
                   AND COLUMN_NAME = 'password_changed_at'"
            );

            if ((int) $statement->fetchColumn() === 0) {
                $connection->exec(
                    "ALTER TABLE `{$table}`
                     ADD COLUMN password_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                     AFTER password_hash"
                );
            }
        }

        foreach (['student', 'employee'] as $table) {
            $temporaryColumnCheck = $connection->query(
                "SELECT COUNT(*)
                 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = " . $connection->quote($table) . "
                   AND COLUMN_NAME = 'password_is_temporary'"
            );

            if ((int) $temporaryColumnCheck->fetchColumn() !== 0) {
                continue;
            }

            $connection->exec(
                "ALTER TABLE `{$table}`
                 ADD COLUMN password_is_temporary TINYINT(1) NOT NULL DEFAULT 0
                 AFTER password_changed_at"
            );

            $idColumn = $table === 'student' ? 'student_id' : 'employee_id';
            $nameColumn = $table === 'student' ? 'first_name' : 'last_name';
            $accounts = $connection->query(
                "SELECT `{$idColumn}` AS account_id, `{$nameColumn}` AS password_name, password_hash
                 FROM `{$table}`"
            )->fetchAll(PDO::FETCH_ASSOC);
            $markTemporary = $connection->prepare(
                "UPDATE `{$table}` SET password_is_temporary = 1 WHERE `{$idColumn}` = ?"
            );

            foreach ($accounts as $account) {
                $passwordName = $table === 'student'
                    ? preg_replace('/\s+/', '', trim((string) ($account['password_name'] ?? '')))
                    : strtolower(preg_replace('/[^A-Za-z0-9]/', '', trim((string) ($account['password_name'] ?? ''))));
                $temporaryPassword = $table === 'student'
                    ? $passwordName . '@123'
                    : $passwordName . '@!123';
                if ($passwordName !== ''
                    && password_verify($temporaryPassword, (string) ($account['password_hash'] ?? ''))) {
                    $markTemporary->execute([(int) $account['account_id']]);
                }
            }
        }

        $ready = true;
    }

    public static function isExpired($passwordChangedAt)
    {
        if (!$passwordChangedAt) {
            return true;
        }

        try {
            $timezone = new DateTimeZone('Asia/Manila');
            $changedAt = new DateTimeImmutable((string) $passwordChangedAt, $timezone);
            $cutoff = (new DateTimeImmutable('now', $timezone))
                ->modify('-' . self::MAX_PASSWORD_AGE_DAYS . ' days');
            return $changedAt <= $cutoff;
        } catch (Throwable $error) {
            return true;
        }
    }
}
