<?php

require_once __DIR__ . '/LoginSecuritySchema.php';

final class AuthenticationAuditLogger
{
    private const RETENTION_DAYS = 90;

    private $connection;

    public function __construct(PDO $connection)
    {
        $this->connection = $connection;
        LoginSecuritySchema::ensure($this->connection);
    }

    public function record(
        $eventType,
        $outcome,
        $reasonCode,
        $attemptedUsername,
        $ipAddress,
        $targetUser = null
    ) {
        $targetUser = is_array($targetUser) ? $targetUser : [];
        $statement = $this->connection->prepare(
            "INSERT INTO authentication_audit_log
                (event_type, outcome, reason_code, attempted_username,
                 target_user_type, target_user_id, target_role,
                 ip_address, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        $statement->execute([
            $this->truncate($eventType, 32),
            $this->truncate($outcome, 20),
            $this->nullableText($reasonCode, 50),
            $this->nullableText($attemptedUsername, 100),
            $this->nullableText($targetUser['user_type'] ?? null, 20),
            isset($targetUser['user_id']) ? (int) $targetUser['user_id'] : null,
            $this->nullableText($targetUser['role_name'] ?? null, 100),
            $this->normalizeIp($ipAddress),
            $this->nullableText($this->requestUserAgent(), 500)
        ]);

        // No cron job is required on shared hosting. Small, occasional batches
        // keep the audit table within the documented retention period.
        if (random_int(1, 100) === 1) {
            $this->connection->exec(
                "DELETE FROM authentication_audit_log
                 WHERE occurred_at < DATE_SUB(NOW(), INTERVAL " . self::RETENTION_DAYS . " DAY)
                 LIMIT 500"
            );
        }
    }

    private function requestUserAgent()
    {
        $userAgent = $_SERVER['HTTP_USER_AGENT'] ?? '';
        return preg_replace('/[\x00-\x1F\x7F]/', '', (string) $userAgent);
    }

    private function normalizeIp($ipAddress)
    {
        return filter_var($ipAddress, FILTER_VALIDATE_IP) ? $ipAddress : 'unknown';
    }

    private function nullableText($value, $maximumLength)
    {
        if ($value === null) {
            return null;
        }

        $value = trim((string) $value);
        return $value === '' ? null : $this->truncate($value, $maximumLength);
    }

    private function truncate($value, $maximumLength)
    {
        $value = (string) $value;
        return function_exists('mb_substr')
            ? mb_substr($value, 0, $maximumLength, 'UTF-8')
            : substr($value, 0, $maximumLength);
    }
}

