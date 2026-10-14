<?php
require_once __DIR__ . '/../config/runtime.php';

final class ScheduleActionToken
{
    private static function key(): string
    {
        $base = base64_decode((string) cdoTutorConfig('CDO_TUTOR_SECRET_KEY', ''), true);
        if (!is_string($base) || strlen($base) !== 32) throw new RuntimeException('Schedule signing key is unavailable.');
        return hash_hmac('sha256', 'schedule-confirm', $base, true);
    }

    public static function query(int $id, string $date): string
    {
        $expires = time() + 172800;
        $signature = hash_hmac('sha256', "{$id}|{$date}|{$expires}", self::key());
        return 'expires=' . $expires . '&token=' . $signature;
    }

    public static function valid(int $id, string $date, $expires, $token): bool
    {
        if ($id <= 0 || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)
            || !is_scalar($expires) || !ctype_digit((string) $expires)
            || !is_string($token) || !preg_match('/^[a-f0-9]{64}$/', $token)) return false;
        $deadline = (int) $expires;
        if ($deadline < time() || $deadline > time() + 172800) return false;
        $expected = hash_hmac('sha256', "{$id}|{$date}|{$deadline}", self::key());
        return hash_equals($expected, $token);
    }

    public static function rescheduleQuery(int $id, string $date, string $email): string
    {
        $expires = time() + 172800;
        $signature = hash_hmac('sha256', "reschedule|{$id}|{$date}|{$email}|{$expires}", self::key());
        return 'expires=' . $expires . '&token=' . $signature;
    }

    public static function validReschedule(int $id, string $date, string $email, $expires, $token): bool
    {
        if ($id <= 0 || $email === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)
            || !is_scalar($expires) || !ctype_digit((string) $expires)
            || !is_string($token) || !preg_match('/^[a-f0-9]{64}$/', $token)) return false;
        $deadline = (int) $expires;
        if ($deadline < time() || $deadline > time() + 172800) return false;
        $expected = hash_hmac('sha256', "reschedule|{$id}|{$date}|{$email}|{$deadline}", self::key());
        return hash_equals($expected, $token);
    }
}
