<?php

require_once __DIR__ . '/LoginSecuritySchema.php';
require_once __DIR__ . '/../config/runtime.php';

/**
 * MySQL-backed authentication limiter shared by every PHP worker and web node.
 */
final class LoginRateLimiter
{
    private const LOGIN_REQUEST_LIMIT = 20;
    private const LOGIN_REQUEST_WINDOW_SECONDS = 60;
    private const CAPTCHA_REQUEST_LIMIT = 30;
    private const CAPTCHA_REQUEST_WINDOW_SECONDS = 60;
    private const USER_IP_FAILURE_LIMIT = 5;
    private const USER_FAILURE_LIMIT = 10;
    private const FAILURE_WINDOW_SECONDS = 900;
    private const PASSWORD_RESET_IP_LIMIT = 5;
    private const PASSWORD_RESET_IDENTITY_LIMIT = 3;
    private const PASSWORD_RESET_WINDOW_SECONDS = 900;

    private $connection;

    public function __construct(PDO $connection)
    {
        $this->connection = $connection;
        LoginSecuritySchema::ensure($this->connection);
    }

    public function consumeLoginRequest($ipAddress)
    {
        return $this->consume(
            'login_ip',
            $this->normalizeIp($ipAddress),
            self::LOGIN_REQUEST_LIMIT,
            self::LOGIN_REQUEST_WINDOW_SECONDS
        );
    }

    public function consumeCaptchaRequest($ipAddress)
    {
        return $this->consume(
            'captcha_ip',
            $this->normalizeIp($ipAddress),
            self::CAPTCHA_REQUEST_LIMIT,
            self::CAPTCHA_REQUEST_WINDOW_SECONDS
        );
    }

    /**
     * Limit password-reset email requests both by source IP and by the exact
     * account identity supplied by the visitor. The identity itself is only
     * retained as a SHA-256 bucket key in the database.
     */
    public function consumePasswordResetRequest($ipAddress, $identity)
    {
        $ipResult = $this->consume(
            'password_reset_ip',
            $this->normalizeIp($ipAddress),
            self::PASSWORD_RESET_IP_LIMIT,
            self::PASSWORD_RESET_WINDOW_SECONDS
        );
        $identityResult = $this->consume(
            'password_reset_identity',
            strtolower(trim((string) $identity)),
            self::PASSWORD_RESET_IDENTITY_LIMIT,
            self::PASSWORD_RESET_WINDOW_SECONDS
        );

        return [
            'allowed' => $ipResult['allowed'] && $identityResult['allowed'],
            'newly_limited' => $ipResult['newly_limited'] || $identityResult['newly_limited'],
            'retry_after' => max($ipResult['retry_after'], $identityResult['retry_after'])
        ];
    }

    public function credentialRetryAfter($ipAddress, $username)
    {
        $usernameKey = $this->normalizeUsername($username);
        if ($usernameKey === '') {
            return 0;
        }

        $userIpRetryAfter = $this->retryAfter(
            'credential_ip_user',
            $this->normalizeIp($ipAddress) . '|' . $usernameKey,
            self::USER_IP_FAILURE_LIMIT,
            self::FAILURE_WINDOW_SECONDS
        );
        $userRetryAfter = $this->retryAfter(
            'credential_user',
            $usernameKey,
            self::USER_FAILURE_LIMIT,
            self::FAILURE_WINDOW_SECONDS
        );

        return max($userIpRetryAfter, $userRetryAfter);
    }

    public function recordCredentialFailure($ipAddress, $username)
    {
        $usernameKey = $this->normalizeUsername($username);
        if ($usernameKey === '') {
            return [
                'user_ip_limit_reached' => false,
                'user_limit_reached' => false
            ];
        }

        $userIpResult = $this->consume(
            'credential_ip_user',
            $this->normalizeIp($ipAddress) . '|' . $usernameKey,
            PHP_INT_MAX,
            self::FAILURE_WINDOW_SECONDS
        );
        $userResult = $this->consume(
            'credential_user',
            $usernameKey,
            PHP_INT_MAX,
            self::FAILURE_WINDOW_SECONDS
        );

        return [
            'user_ip_limit_reached' => $userIpResult['attempt_count'] === self::USER_IP_FAILURE_LIMIT,
            'user_limit_reached' => $userResult['attempt_count'] === self::USER_FAILURE_LIMIT
        ];
    }

    public function clearCredentialFailures($ipAddress, $username)
    {
        $usernameKey = $this->normalizeUsername($username);
        if ($usernameKey === '') {
            return;
        }

        $statement = $this->connection->prepare(
            "DELETE FROM login_rate_limits
             WHERE (scope = ? AND identifier_hash = ?)
                OR (scope = ? AND identifier_hash = ?)"
        );
        $statement->execute([
            'credential_ip_user',
            $this->identifierHash(
                'credential_ip_user',
                $this->normalizeIp($ipAddress) . '|' . $usernameKey
            ),
            'credential_user',
            $this->identifierHash('credential_user', $usernameKey)
        ]);
    }

    public static function clientIpAddress()
    {
        $remoteAddress = $_SERVER['REMOTE_ADDR'] ?? '';
        if (!filter_var($remoteAddress, FILTER_VALIDATE_IP)) {
            return 'unknown';
        }

        // Never trust client-supplied forwarding headers unless the immediate
        // peer is an explicitly configured proxy address or CIDR range.
        $trustedProxyList = cdoTutorConfig('LOGIN_TRUSTED_PROXIES', '');
        if (trim((string) $trustedProxyList) === '') {
            return $remoteAddress;
        }

        $trustedProxies = array_filter(array_map('trim', explode(',', $trustedProxyList)));
        $isTrustedProxy = false;
        foreach ($trustedProxies as $trustedProxy) {
            if (self::ipMatchesNetwork($remoteAddress, $trustedProxy)) {
                $isTrustedProxy = true;
                break;
            }
        }

        if (!$isTrustedProxy) {
            return $remoteAddress;
        }

        $forwardedCandidates = [];
        if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
            $forwardedCandidates[] = trim($_SERVER['HTTP_CF_CONNECTING_IP']);
        }
        if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $forwardedCandidates = array_merge(
                $forwardedCandidates,
                array_map('trim', explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']))
            );
        }

        foreach ($forwardedCandidates as $candidate) {
            if (filter_var($candidate, FILTER_VALIDATE_IP)) {
                return $candidate;
            }
        }

        return $remoteAddress;
    }

    private function consume($scope, $identifier, $limit, $windowSeconds)
    {
        $now = time();
        $windowExpiryThreshold = $now - $windowSeconds;
        $identifierHash = $this->identifierHash($scope, $identifier);
        $startedTransaction = false;

        try {
            if (!$this->connection->inTransaction()) {
                $this->connection->beginTransaction();
                $startedTransaction = true;
            }

            $statement = $this->connection->prepare(
                "INSERT INTO login_rate_limits
                    (scope, identifier_hash, attempt_count, window_started_at)
                 VALUES (?, ?, 1, ?)
                 ON DUPLICATE KEY UPDATE
                    attempt_count = IF(window_started_at <= ? OR window_started_at > ?, 1, attempt_count + 1),
                    window_started_at = IF(window_started_at <= ? OR window_started_at > ?, ?, window_started_at),
                    updated_at = CURRENT_TIMESTAMP"
            );
            $statement->execute([
                $scope,
                $identifierHash,
                $now,
                $windowExpiryThreshold,
                $now,
                $windowExpiryThreshold,
                $now,
                $now
            ]);

            $statement = $this->connection->prepare(
                "SELECT attempt_count, window_started_at
                 FROM login_rate_limits
                 WHERE scope = ? AND identifier_hash = ?
                 FOR UPDATE"
            );
            $statement->execute([$scope, $identifierHash]);
            $bucket = $statement->fetch(PDO::FETCH_ASSOC);

            if ($startedTransaction) {
                $this->connection->commit();
            }
        } catch (Throwable $error) {
            if ($startedTransaction && $this->connection->inTransaction()) {
                $this->connection->rollBack();
            }
            throw $error;
        }

        $attemptCount = (int) ($bucket['attempt_count'] ?? 0);
        $windowStartedAt = (int) ($bucket['window_started_at'] ?? $now);
        $allowed = $attemptCount <= $limit;

        $this->occasionallyDeleteExpiredBuckets();

        return [
            'allowed' => $allowed,
            'attempt_count' => $attemptCount,
            'newly_limited' => !$allowed && $attemptCount === ($limit + 1),
            'retry_after' => $allowed
                ? 0
                : max(1, ($windowStartedAt + $windowSeconds) - $now)
        ];
    }

    private function retryAfter($scope, $identifier, $limit, $windowSeconds)
    {
        $statement = $this->connection->prepare(
            "SELECT attempt_count, window_started_at
             FROM login_rate_limits
             WHERE scope = ? AND identifier_hash = ?
             LIMIT 1"
        );
        $statement->execute([$scope, $this->identifierHash($scope, $identifier)]);
        $bucket = $statement->fetch(PDO::FETCH_ASSOC);

        if (!$bucket) {
            return 0;
        }

        $now = time();
        $windowStartedAt = (int) $bucket['window_started_at'];
        if ($windowStartedAt <= ($now - $windowSeconds)
            || $windowStartedAt > $now
            || (int) $bucket['attempt_count'] < $limit) {
            return 0;
        }

        return max(1, ($windowStartedAt + $windowSeconds) - $now);
    }

    private function occasionallyDeleteExpiredBuckets()
    {
        try {
            if (random_int(1, 100) !== 1) {
                return;
            }

            $oldestUsefulTimestamp = time() - 86400;
            $statement = $this->connection->prepare(
                "DELETE FROM login_rate_limits
                 WHERE window_started_at < ?
                 LIMIT 200"
            );
            $statement->execute([$oldestUsefulTimestamp]);
        } catch (Throwable $error) {
            error_log('Login rate-limit cleanup failed: ' . $error->getMessage());
        }
    }

    private function identifierHash($scope, $identifier)
    {
        return hash('sha256', $scope . "\0" . $identifier);
    }

    private function normalizeIp($ipAddress)
    {
        return filter_var($ipAddress, FILTER_VALIDATE_IP) ? $ipAddress : 'unknown';
    }

    private function normalizeUsername($username)
    {
        return strtolower(trim((string) $username));
    }

    private static function ipMatchesNetwork($ipAddress, $network)
    {
        if (strpos($network, '/') === false) {
            return hash_equals($network, $ipAddress);
        }

        [$subnet, $prefixLength] = array_pad(explode('/', $network, 2), 2, null);
        $ipBytes = @inet_pton($ipAddress);
        $subnetBytes = @inet_pton($subnet);
        if ($ipBytes === false || $subnetBytes === false || strlen($ipBytes) !== strlen($subnetBytes)) {
            return false;
        }

        $prefixLength = filter_var($prefixLength, FILTER_VALIDATE_INT);
        $maximumPrefixLength = strlen($ipBytes) * 8;
        if ($prefixLength === false || $prefixLength < 0 || $prefixLength > $maximumPrefixLength) {
            return false;
        }

        $wholeBytes = intdiv($prefixLength, 8);
        $remainingBits = $prefixLength % 8;
        if ($wholeBytes > 0
            && substr($ipBytes, 0, $wholeBytes) !== substr($subnetBytes, 0, $wholeBytes)) {
            return false;
        }

        if ($remainingBits === 0) {
            return true;
        }

        $mask = (0xFF << (8 - $remainingBits)) & 0xFF;
        return (ord($ipBytes[$wholeBytes]) & $mask) === (ord($subnetBytes[$wholeBytes]) & $mask);
    }
}
