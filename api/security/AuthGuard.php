<?php
require_once __DIR__ . '/SessionBootstrap.php';
require_once __DIR__ . '/LoginRateLimiter.php';

final class AuthGuard
{
    public const IDLE_SECONDS = 600;
    public const ABSOLUTE_SECONDS = 28800;
    public const REMEMBER_SECONDS = 604800;
    private static $connection;

    public static function connection(): PDO
    {
        if (!self::$connection) {
            require __DIR__ . '/../admin/connection-pdo.php';
            self::$connection = $conn;
        }
        return self::$connection;
    }

    public static function deny(int $status = 403, string $message = 'Access denied.'): void
    {
        http_response_code($status);
        header('Content-Type: application/json');
        header('Cache-Control: no-store');
        echo json_encode(['status' => 'error', 'message' => $message]);
        exit;
    }

    public static function account(PDO $db, string $type, int $id): ?array
    {
        if (!in_array($type, ['student', 'employee'], true) || $id <= 0) return null;
        $stmt = $db->prepare("SELECT a.*, r.role_name FROM `$type` a JOIN role r ON r.role_id = a.role_id WHERE a.{$type}_id = ? LIMIT 1");
        $stmt->execute([$id]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    // The account security version changes whenever credentials, status, role,
    // branch or recovery email change. No raw password hash is kept in session.
    public static function version(array $account): string
    {
        return hash('sha256', json_encode(array_map(static function ($key) use ($account) {
            return (string) ($account[$key] ?? '');
        }, ['password_hash', 'status', 'role_id', 'role_name', 'branch_id', 'email'])));
    }

    public static function establish(PDO $db, string $type, int $id, bool $remember = false): void
    {
        $account = self::account($db, $type, $id);
        if (!$account || strtolower($account['status'] ?? '') !== 'active') self::deny(401, 'Account is not active.');
        $_SESSION['account_version'] = self::version($account);
        $_SESSION['authenticated_at'] = time();
        $_SESSION['last_activity'] = time();
        $_SESSION['remember_me'] = $remember;
        if ($remember) SessionBootstrap::issuePersistentSessionCookie();
        SessionBootstrap::issueCsrfCookie();
    }

    public static function validSnapshot(array $session, array $account, int $now): bool
    {
        $absoluteSeconds = !empty($session['remember_me']) ? self::REMEMBER_SECONDS : self::ABSOLUTE_SECONDS;
        $idleSeconds = !empty($session['remember_me']) ? self::REMEMBER_SECONDS : self::IDLE_SECONDS;
        return strtolower($account['status'] ?? '') === 'active'
            && isset($session['account_version'], $session['authenticated_at'], $session['last_activity'])
            && $now >= (int) $session['authenticated_at']
            && $now - (int) $session['authenticated_at'] < $absoluteSeconds
            && $now - (int) $session['last_activity'] < $idleSeconds
            && hash_equals(self::version($account), (string) $session['account_version']);
    }

    public static function refreshCurrentVersion(PDO $db): void
    {
        $account = self::account($db, (string) ($_SESSION['user_type'] ?? ''), (int) ($_SESSION['user_id'] ?? 0));
        if ($account) $_SESSION['account_version'] = self::version($account);
    }

    public static function user(): ?array
    {
        SessionBootstrap::start();
        if (empty($_SESSION['user_id'])) return null;
        $type = (string) ($_SESSION['user_type'] ?? '');
        $account = self::account(self::connection(), $type, (int) $_SESSION['user_id']);
        if (!$account || !self::validSnapshot($_SESSION, $account, time())) {
            $_SESSION = [];
            session_regenerate_id(true);
            return null;
        }
        $_SESSION['last_activity'] = time();
        $role = preg_replace('/[\s_-]+/', ' ', strtolower(trim($account['role_name'])));
        $_SESSION['user_role'] = $role;
        if ($type === 'employee') $_SESSION['branch_id'] = $account['branch_id'] ?? null;
        return ['user_id' => (int) $_SESSION['user_id'], 'user_type' => $type,
            'username' => $account['username'], 'role_name' => $role,
            'session_token' => $_SESSION['session_token'] ?? null];
    }

    public static function requireUser(): array
    {
        try { $user = self::user(); }
        catch (Throwable $e) { error_log('Session validation failed: ' . $e->getMessage()); self::deny(503, 'Authentication is temporarily unavailable.'); }
        if (!$user) self::deny(401, 'Not authenticated');
        self::requireSafeRequest();
        return $user;
    }

    public static function requireSafeRequest(): void
    {
        $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        if ($method === 'GET' && preg_match('/^(add|create|update|delete|remove|save|set|change|confirm|cancel|send|release|approve|reject|mark|complete|assign|upload|pay|resend|toggle|reset|archive|disable|enable|submit|enroll|start|stop|process)/i', (string) ($_GET['operation'] ?? $_GET['action'] ?? ''))) {
            self::deny(405, 'This action requires POST.');
        }
        if (in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) return;
        if (!in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) self::deny(405, 'Method not allowed.');
        self::requireSameOrigin();
        $token = (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
        if ($token === '' || !hash_equals((string) ($_SESSION['csrf_token'] ?? ''), $token)) {
            self::deny(403, 'Invalid CSRF token. Refresh the page and try again.');
        }
    }

    public static function requireSameOrigin(): void
    {
        $site = strtolower((string) ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? ''));
        if ($site === 'cross-site') self::deny(403, 'Cross-site request denied.');
        $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
        if ($origin !== '') {
            $originParts = parse_url($origin);
            $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
            $originHost = strtolower((string) ($originParts['host'] ?? ''));
            $originPort = isset($originParts['port']) ? ':' . $originParts['port'] : '';
            if ($originHost . $originPort !== $host) self::deny(403, 'Cross-origin request denied.');
        }
    }

    public static function requireRoles(array $roles): array
    {
        $user = self::requireUser();
        if (!in_array($user['role_name'], $roles, true)) self::deny();
        return $user;
    }

    public static function verifyCurrentPassword(array $data): void
    {
        $user = self::requireUser();
        $db = self::connection();
        $account = self::account($db, $user['user_type'], $user['user_id']);
        $password = $data['current_password'] ?? $data['current_account_password'] ?? '';
        $limiter = new LoginRateLimiter($db);
        $ip = LoginRateLimiter::clientIpAddress();
        if ($limiter->credentialRetryAfter($ip, $account['username']) > 0) {
            self::deny(429, 'Too many password attempts. Please try again later.');
        }
        if (!is_string($password) || !password_verify($password, $account['password_hash'])) {
            $limiter->recordCredentialFailure($ip, $account['username']);
            self::deny(403, 'Your current password is required and must be correct.');
        }
        $limiter->clearCredentialFailures($ip, $account['username']);
    }
}
