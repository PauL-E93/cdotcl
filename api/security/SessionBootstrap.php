<?php

require_once __DIR__ . '/../config/runtime.php';

final class SessionBootstrap
{
    public static function start()
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }

        @ini_set('session.use_strict_mode', '1');
        @ini_set('session.use_only_cookies', '1');
        @ini_set('session.gc_maxlifetime', (string) (7 * 24 * 60 * 60));

        $httpsAtOrigin = !empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off';
        $secureCookie = cdoTutorBooleanConfig('SESSION_COOKIE_SECURE', $httpsAtOrigin);

        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'secure' => $secureCookie,
            'httponly' => true,
            'samesite' => 'Lax'
        ]);

        session_start();
        if (!empty($_SESSION['remember_me'])) {
            self::issuePersistentSessionCookie();
        }
        self::issueCsrfCookie($secureCookie);
    }

    public static function issuePersistentSessionCookie(): void
    {
        $params = session_get_cookie_params();
        $expires = (int) ($_SESSION['authenticated_at'] ?? 0) + 7 * 24 * 60 * 60;
        if ($expires <= time()) return;
        setcookie(session_name(), session_id(), [
            'expires' => $expires,
            'path' => $params['path'],
            'domain' => $params['domain'],
            'secure' => $params['secure'],
            'httponly' => true,
            'samesite' => 'Lax'
        ]);
    }

    public static function issueCsrfCookie(?bool $secureCookie = null): void
    {
        if ($secureCookie === null) {
            $httpsAtOrigin = !empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off';
            $secureCookie = cdoTutorBooleanConfig('SESSION_COOKIE_SECURE', $httpsAtOrigin);
        }
        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }
        setcookie('cdo_csrf', $_SESSION['csrf_token'], [
            'expires' => 0, 'path' => '/', 'secure' => $secureCookie,
            'httponly' => false, 'samesite' => 'Strict'
        ]);
    }
}
