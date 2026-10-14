<?php
require_once __DIR__ . '/../app_url_helper.php';
require_once __DIR__ . '/AuthGuard.php';
require_once __DIR__ . '/PasswordPolicy.php';

final class AccountActivation
{
    public const TTL_SECONDS = 86400;

    public static function ensureSchema(PDO $db): void
    {
        $db->exec("CREATE TABLE IF NOT EXISTS account_activations (
            user_type VARCHAR(12) NOT NULL,
            user_id INT NOT NULL,
            token_hash CHAR(64) NOT NULL,
            expires_at DATETIME NOT NULL,
            consumed_at DATETIME NULL,
            PRIMARY KEY (user_type, user_id),
            UNIQUE KEY unique_activation_token (token_hash)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    }

    public static function issue(PDO $db, string $type, int $id): string
    {
        if (!in_array($type, ['employee', 'student'], true) || $id <= 0) throw new InvalidArgumentException('Invalid account.');
        if (!$db->inTransaction()) self::ensureSchema($db);
        $token = bin2hex(random_bytes(32));
        $stmt = $db->prepare("INSERT INTO account_activations (user_type, user_id, token_hash, expires_at)
            VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))
            ON DUPLICATE KEY UPDATE token_hash = VALUES(token_hash), expires_at = VALUES(expires_at), consumed_at = NULL");
        $stmt->execute([$type, $id, hash('sha256', $token)]);
        return cdoBuildAppUrl('activate.html') . '?type=' . rawurlencode($type) . '&token=' . $token;
    }

    public static function activate(PDO $db, string $type, string $token, string $password): bool
    {
        if (!in_array($type, ['employee', 'student'], true) || !preg_match('/^[a-f0-9]{64}$/', $token)
            || !PasswordPolicy::valid($password)) return false;
        if (!$db->inTransaction()) self::ensureSchema($db);
        $started = !$db->inTransaction();
        if ($started) $db->beginTransaction();
        try {
            $stmt = $db->prepare("SELECT user_id FROM account_activations WHERE user_type = ? AND token_hash = ?
                AND consumed_at IS NULL AND expires_at > NOW() FOR UPDATE");
            $stmt->execute([$type, hash('sha256', $token)]);
            $id = (int) $stmt->fetchColumn();
            if (!$id) { if ($started) $db->rollBack(); return false; }
            $idColumn = $type === 'employee' ? 'employee_id' : 'student_id';
            $check = $db->prepare("SELECT password_is_temporary, status FROM `$type` WHERE `$idColumn` = ? FOR UPDATE");
            $check->execute([$id]);
            $account = $check->fetch(PDO::FETCH_ASSOC);
            if (!$account || empty($account['password_is_temporary'])
                || ($type === 'student' && strtolower((string) $account['status']) !== 'active')) {
                if ($started) $db->rollBack();
                return false;
            }
            $stmt = $db->prepare("UPDATE `$type` SET password_hash = ?, password_changed_at = NOW(),
                password_is_temporary = 0, status = 'active' WHERE `$idColumn` = ?");
            $stmt->execute([password_hash($password, PASSWORD_DEFAULT), $id]);
            $db->prepare('UPDATE account_activations SET consumed_at = NOW() WHERE user_type = ? AND user_id = ?')
                ->execute([$type, $id]);
            if ($started) $db->commit();
            return true;
        } catch (Throwable $e) {
            if ($started && $db->inTransaction()) $db->rollBack();
            throw $e;
        }
    }
}
