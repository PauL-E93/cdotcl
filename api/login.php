<?php
require_once __DIR__ . '/security/SessionBootstrap.php';
require_once __DIR__ . '/security/LoginRateLimiter.php';
require_once __DIR__ . '/security/AuthenticationAuditLogger.php';
require_once __DIR__ . '/security/PasswordExpiration.php';
require_once __DIR__ . '/security/AuthGuard.php';
require_once __DIR__ . '/security/PasswordPolicy.php';

SessionBootstrap::start();
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') AuthGuard::requireSameOrigin();

// Set headers for JSON responses.
header('Content-Type: application/json');
header('Cache-Control: no-store');

class Login {
    private const SESSION_IDLE_TIMEOUT_SECONDS = 600;
    private const CAPTCHA_TTL_SECONDS = 300;
    private const MAX_CAPTCHA_CHALLENGES = 5;
    private $captchaFailureMessage = 'CAPTCHA verification failed';
    private $connection;
    private $rateLimiter;
    private $auditLogger;

    private function databaseConnection() {
        if ($this->connection instanceof PDO) {
            return $this->connection;
        }

        include __DIR__ . '/admin/connection-pdo.php';
        if (!isset($conn) || !($conn instanceof PDO)) {
            throw new RuntimeException('Database connection is unavailable.');
        }

        $this->connection = $conn;
        PasswordExpiration::ensureSchema($this->connection);
        return $this->connection;
    }

    private function rateLimiter() {
        if (!($this->rateLimiter instanceof LoginRateLimiter)) {
            $this->rateLimiter = new LoginRateLimiter($this->databaseConnection());
        }

        return $this->rateLimiter;
    }

    private function auditLogger() {
        if (!($this->auditLogger instanceof AuthenticationAuditLogger)) {
            $this->auditLogger = new AuthenticationAuditLogger($this->databaseConnection());
        }

        return $this->auditLogger;
    }

    private function auditTarget($user) {
        if (!is_array($user) || empty($user['user_id'])) {
            return null;
        }

        return [
            'user_id' => (int) $user['user_id'],
            'user_type' => $user['user_type'] ?? null,
            'role_name' => $user['role_name'] ?? null
        ];
    }

    private function recordAuthenticationAudit(
        $eventType,
        $outcome,
        $reasonCode,
        $attemptedUsername,
        $ipAddress,
        $targetUser = null
    ) {
        try {
            $this->auditLogger()->record(
                $eventType,
                $outcome,
                $reasonCode,
                $attemptedUsername,
                $ipAddress,
                $this->auditTarget($targetUser)
            );
        } catch (Throwable $error) {
            // Authentication must remain available if optional audit writing
            // fails. The server log still preserves the operational failure.
            error_log('Authentication audit write failed: ' . $error->getMessage());
        }
    }

    private function rejectSecurityUnavailable($error) {
        error_log('Login security service failed: ' . $error->getMessage());
        http_response_code(503);
        header('Retry-After: 60');
        echo json_encode([
            'status' => 'error',
            'code' => 'LOGIN_SECURITY_UNAVAILABLE',
            'message' => 'Login is temporarily unavailable. Please try again later.'
        ]);
    }

    private function rejectRateLimited($retryAfter, $message = 'Too many login attempts. Please wait before trying again.') {
        $retryAfter = max(1, (int) $retryAfter);
        if ($message === 'Too many login attempts. Please wait before trying again.') {
            $message = 'Too many login attempts. Please try again in ' . $retryAfter . ' seconds.';
        }
        http_response_code(429);
        header('Retry-After: ' . $retryAfter);
        echo json_encode([
            'status' => 'error',
            'code' => 'RATE_LIMITED',
            'message' => $message,
            'retry_after' => $retryAfter
        ]);
    }

    private function normalizeRole($role) {
        return preg_replace('/[\s_-]+/', ' ', strtolower(trim((string) $role)));
    }

    private function usesLegacyStarterPassword($type, $user, $password) {
        if ($type === 'student') {
            $name = preg_replace('/\s+/', '', trim((string) ($user['first_name'] ?? '')));
            return $name !== '' && hash_equals($name . '@123', $password);
        }
        $name = strtolower(preg_replace('/[^A-Za-z0-9]/', '', trim((string) ($user['last_name'] ?? ''))));
        return $name !== '' && hash_equals($name . '@!123', $password);
    }

    private function disableLegacyStarterPassword(PDO $conn, $type, $user) {
        $table = $type === 'student' ? 'student' : 'employee';
        $idColumn = $type === 'student' ? 'student_id' : 'employee_id';
        $statement = $conn->prepare("UPDATE `$table` SET password_hash = ?, password_is_temporary = 1
            WHERE `$idColumn` = ? AND password_hash = ?");
        $statement->execute([password_hash(bin2hex(random_bytes(32)), PASSWORD_DEFAULT),
            (int) $user['user_id'], $user['password_hash']]);
    }

    private function clearSessionState() {
        $_SESSION = [];

        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(
                session_name(),
                '',
                time() - 42000,
                $params['path'],
                $params['domain'],
                $params['secure'],
                $params['httponly']
            );
        }

        session_destroy();
    }

    private function handleSessionTimeout() {
        if (empty($_SESSION['user_id'])) {
            return true;
        }   

        $now = time();
        $lastActivity = isset($_SESSION['last_activity']) ? (int) $_SESSION['last_activity'] : $now;

        if (($now - $lastActivity) > self::SESSION_IDLE_TIMEOUT_SECONDS) {
            $this->clearSessionState();
            return false;
        }

        $_SESSION['last_activity'] = $now;
        return true;
    }

    private function generateCaptchaChallenge() {
        $firstNumber = random_int(10, 99);
        $secondNumber = random_int(1, 9);
        $challengeId = bin2hex(random_bytes(16));
        $now = time();
        $challenges = $_SESSION['captcha_challenges'] ?? [];

        if (!is_array($challenges)) {
            $challenges = [];
        }

        foreach ($challenges as $id => $challenge) {
            if (!is_array($challenge) || ($challenge['expires_at'] ?? 0) < $now) {
                unset($challenges[$id]);
            }
        }

        $challenges[$challengeId] = [
            'answer' => (string) ($firstNumber + $secondNumber),
            'expires_at' => $now + self::CAPTCHA_TTL_SECONDS
        ];

        if (count($challenges) > self::MAX_CAPTCHA_CHALLENGES) {
            uasort($challenges, function ($a, $b) {
                return ($a['expires_at'] ?? 0) <=> ($b['expires_at'] ?? 0);
            });
            $challenges = array_slice($challenges, -self::MAX_CAPTCHA_CHALLENGES, null, true);
        }

        $_SESSION['captcha_challenges'] = $challenges;
        unset($_SESSION['captcha_answer']);

        return [
            'challenge_id' => $challengeId,
            'first_number' => $firstNumber,
            'second_number' => $secondNumber,
            'expires_in_seconds' => self::CAPTCHA_TTL_SECONDS
        ];
    }

    private function verifyCaptcha($submittedAnswer, $challengeId) {
        $challengeId = trim((string) $challengeId);
        $submittedAnswer = trim((string) $submittedAnswer);
        $challenges = $_SESSION['captcha_challenges'] ?? [];
        $challenge = is_array($challenges) && $challengeId !== ''
            ? ($challenges[$challengeId] ?? null)
            : null;

        if (is_array($challenge) && is_array($challenges)) {
            // Every challenge is single-use, including an incorrect attempt.
            unset($challenges[$challengeId]);
            $_SESSION['captcha_challenges'] = $challenges;
        }

        $expectedAnswer = is_array($challenge) ? ($challenge['answer'] ?? null) : null;
        $expiresAt = is_array($challenge) ? (int) ($challenge['expires_at'] ?? 0) : 0;

        if (!is_string($expectedAnswer) || $expiresAt < time()) {
            $this->captchaFailureMessage = 'CAPTCHA expired. Please solve the new challenge.';
            return false;
        }

        if ($submittedAnswer === '' || !hash_equals($expectedAnswer, $submittedAnswer)) {
            $this->captchaFailureMessage = 'CAPTCHA answer is incorrect.';
            return false;
        }

        return true;
    }

    private function generateSessionToken($userId) {
        $seed = random_bytes(32);
        $tokenBody = bin2hex($seed) . '|' . (int) $userId . '|' . session_id();
        return 'sess_' . substr(hash('sha256', $tokenBody), 0, 64);
    }

    private function sessionUserFromDatabase() {
        if (empty($_SESSION['user_id']) || empty($_SESSION['user_role'])) {
            return null;
        }

        $conn = $this->databaseConnection();

        $role = $this->normalizeRole($_SESSION['user_role']);
        $userType = $_SESSION['user_type'] ?? ($role === 'student' ? 'student' : 'employee');
        $userId = (int) $_SESSION['user_id'];

        if ($userType === 'student') {
            $stmt = $conn->prepare("
                SELECT
                    s.student_id AS user_id,
                    s.username,
                    r.role_name,
                    'student' AS user_type
                FROM student s
                JOIN role r ON s.role_id = r.role_id
                WHERE s.student_id = :user_id
                LIMIT 1
            ");
        } else {
            $stmt = $conn->prepare("
                SELECT
                    e.employee_id AS user_id,
                    e.username,
                    e.status,
                    r.role_name,
                    'employee' AS user_type
                FROM employee e
                JOIN role r ON e.role_id = r.role_id
                WHERE e.employee_id = :user_id
                LIMIT 1
            ");
        }

        $stmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
        $stmt->execute();
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$user || (($user['status'] ?? 'active') === 'inactive')) {
            return null;
        }

        unset($user['status']);
        return $this->rememberSessionUser($user);
    }

    private function rememberSessionUser($user) {
        $sessionUser = [
            'user_id' => (int) $user['user_id'],
            'username' => $user['username'],
            'role_name' => $this->normalizeRole($user['role_name']),
            'user_type' => $user['user_type']
        ];

        $_SESSION['last_activity'] = time();

        if (empty($_SESSION['session_token'])) {
            $_SESSION['session_token'] = $this->generateSessionToken($sessionUser['user_id']);
        }

        $sessionUser['session_token'] = $_SESSION['session_token'];
        $_SESSION['auth_user'] = $sessionUser;

        return $sessionUser;
    }

    private function getSessionUser() {
        return AuthGuard::user();
    }

    private function rejectIfAlreadyLoggedIn() {
        $user = $this->getSessionUser();

        if (!$user) {
            return false;
        }

        echo json_encode([
            "status" => "already_authenticated",
            "message" => "You are already logged in. Please log out before using another account.",
            "user" => $user,
            "remember_me" => !empty($_SESSION['remember_me'])
        ]);
        return true;
    }

    private function requirePasswordChange($user, $reason = 'expired', $remember = false) {
        $temporaryPassword = $reason === 'temporary';
        $_SESSION = [];
        session_regenerate_id(true);
        $_SESSION['password_change_required'] = [
            'user_id' => (int) $user['user_id'],
            'username' => $user['username'],
            'role_name' => $this->normalizeRole($user['role_name']),
            'user_type' => $user['user_type'],
            'reason' => $reason,
            'remember_me' => $remember,
            'credential_fingerprint' => hash('sha256', (string) $user['password_hash']),
            'expires_at' => time() + PasswordExpiration::CHANGE_SESSION_TTL_SECONDS
        ];

        echo json_encode([
            'status' => 'password_change_required',
            'code' => $temporaryPassword ? 'TEMPORARY_PASSWORD' : 'PASSWORD_EXPIRED',
            'message' => $temporaryPassword
                ? 'You signed in with a temporary password. Create a new password before continuing.'
                : 'Your password is 72 days old and must be changed before you can continue.',
            'user' => [
                'username' => $user['username'],
                'role_name' => $this->normalizeRole($user['role_name']),
                'user_type' => $user['user_type']
            ]
        ]);
    }

    function changeExpiredPassword($json) {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            http_response_code(405);
            echo json_encode(['status' => 'error', 'message' => 'Method not allowed.']);
            return;
        }

        $pending = $_SESSION['password_change_required'] ?? null;
        if (!is_array($pending)
            || empty($pending['user_id'])
            || empty($pending['user_type'])
            || (int) ($pending['expires_at'] ?? 0) < time()) {
            unset($_SESSION['password_change_required']);
            http_response_code(401);
            echo json_encode([
                'status' => 'error',
                'message' => 'Your password-change session expired. Please log in again.'
            ]);
            return;
        }
        if (!in_array($pending['user_type'], ['student', 'employee'], true)) {
            $this->clearSessionState();
            http_response_code(403);
            echo json_encode(['status' => 'error', 'message' => 'Invalid password-change session.']);
            return;
        }

        $data = json_decode($json, true);
        $newPassword = is_array($data) ? (string) ($data['new_password'] ?? '') : '';
        $confirmPassword = is_array($data) ? (string) ($data['confirm_password'] ?? '') : '';

        if ($newPassword === '' || $newPassword !== $confirmPassword) {
            echo json_encode(['status' => 'error', 'message' => 'The new passwords do not match.']);
            return;
        }

        if (!PasswordPolicy::valid($newPassword)) {
            echo json_encode([
                'status' => 'error',
                'message' => PasswordPolicy::message()
            ]);
            return;
        }

        $conn = $this->databaseConnection();
        $isStudent = $pending['user_type'] === 'student';
        $table = $isStudent ? 'student' : 'employee';
        $idColumn = $isStudent ? 'student_id' : 'employee_id';
        $statement = $conn->prepare(
            "SELECT password_hash, status, password_is_temporary FROM `{$table}` WHERE `{$idColumn}` = :user_id LIMIT 1"
        );
        $statement->execute([':user_id' => (int) $pending['user_id']]);
        $account = $statement->fetch(PDO::FETCH_ASSOC);
        $currentHash = $account['password_hash'] ?? null;

        $employeeSetup = !$isStudent && ($pending['reason'] ?? '') === 'temporary'
            && !empty($account['password_is_temporary']);
        if (!$currentHash || (strtolower((string) ($account['status'] ?? 'active')) === 'inactive' && !$employeeSetup)) {
            $this->clearSessionState();
            http_response_code(401);
            echo json_encode(['status' => 'error', 'message' => 'This account is no longer available. Please contact the learning center.']);
            return;
        }

        if (empty($pending['credential_fingerprint'])
            || !hash_equals($pending['credential_fingerprint'], hash('sha256', $currentHash))) {
            $this->clearSessionState();
            http_response_code(401);
            echo json_encode(['status' => 'error', 'message' => 'Your credentials changed. Please log in again.']);
            return;
        }

        if (password_verify($newPassword, $currentHash)) {
            echo json_encode(['status' => 'error', 'message' => 'Your new password must be different from your current password.']);
            return;
        }

        $activateEmployee = $employeeSetup ? ", status = 'active'" : '';
        $statement = $conn->prepare(
            "UPDATE `{$table}`
             SET password_hash = :password_hash,
                 password_changed_at = NOW(),
                 password_is_temporary = 0 {$activateEmployee}
             WHERE `{$idColumn}` = :user_id AND password_hash = :current_hash"
        );
        $statement->execute([
            ':password_hash' => password_hash($newPassword, PASSWORD_DEFAULT),
            ':user_id' => (int) $pending['user_id'],
            ':current_hash' => $currentHash
        ]);
        if ($statement->rowCount() !== 1) {
            $this->clearSessionState();
            http_response_code(401);
            echo json_encode(['status' => 'error', 'message' => 'Your credentials changed. Please log in again.']);
            return;
        }

        $requiresFreshLogin = ($pending['reason'] ?? 'expired') === 'temporary';
        $auditReason = $requiresFreshLogin
            ? 'temporary_password_changed'
            : 'expired_password_changed';

        $this->recordAuthenticationAudit(
            'password_change',
            'success',
            $auditReason,
            $pending['username'],
            LoginRateLimiter::clientIpAddress(),
            $pending
        );

        if ($requiresFreshLogin) {
            $this->clearSessionState();
            echo json_encode([
                'status' => 'success',
                'message' => 'Password changed successfully. Please log in with your new password.',
                'reauthenticate' => true
            ]);
            return;
        }

        unset($_SESSION['password_change_required']);
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $pending['user_id'];
        $_SESSION['user_role'] = $pending['role_name'];
        $_SESSION['user_type'] = $pending['user_type'];

        if ($isStudent) {
            unset($_SESSION['employee_id'], $_SESSION['branch_id']);
            $_SESSION['student_id'] = (int) $pending['user_id'];
        } else {
            unset($_SESSION['student_id'], $_SESSION['branch_id']);
            $_SESSION['employee_id'] = (int) $pending['user_id'];
            $branchStatement = $conn->prepare('SELECT branch_id FROM employee WHERE employee_id = :user_id');
            $branchStatement->execute([':user_id' => (int) $pending['user_id']]);
            $branchId = $branchStatement->fetchColumn();
            if ($branchId) {
                $_SESSION['branch_id'] = $branchId;
            }
        }

        AuthGuard::establish($conn, $pending['user_type'], (int) $pending['user_id'], !empty($pending['remember_me']));
        $user = $this->rememberSessionUser($pending);
        echo json_encode([
            'status' => 'success',
            'message' => 'Password changed successfully.',
            'user' => $user,
            'session_token' => $user['session_token'] ?? null,
            'remember_me' => !empty($_SESSION['remember_me'])
        ]);
    }

    function captcha() {
        $ipAddress = LoginRateLimiter::clientIpAddress();
        try {
            $requestLimit = $this->rateLimiter()->consumeCaptchaRequest($ipAddress);
        } catch (Throwable $error) {
            $this->rejectSecurityUnavailable($error);
            return;
        }

        if (!$requestLimit['allowed']) {
            if (!empty($requestLimit['newly_limited'])) {
                $this->recordAuthenticationAudit(
                    'captcha',
                    'rate_limited',
                    'captcha_request_limit',
                    null,
                    $ipAddress
                );
            }
            $this->rejectRateLimited(
                $requestLimit['retry_after'],
                'Too many CAPTCHA requests. Please wait before refreshing it again.'
            );
            return;
        }

        echo json_encode([
            "status" => "success",
            "captcha" => $this->generateCaptchaChallenge()
        ]);
    }

    function session() {
        $user = $this->getSessionUser();

        if (!$user) {
            echo json_encode([
                "status" => "error",
                "message" => "Not authenticated"
            ]);
            return;
        }

        echo json_encode([
            "status" => "success",
            "user" => $user,
            "session_token" => $_SESSION['session_token'] ?? null,
            "remember_me" => !empty($_SESSION['remember_me'])
        ]);
    }

    // --- LOGIN FUNCTION ---
    function login($json) {
        $data = json_decode($json, true);
        if (!is_array($data)) {
            $data = [];
        }
        $remember = ($data['remember_me'] ?? false) === true;

        $attemptedUsername = isset($data['username']) && is_string($data['username'])
            ? trim($data['username'])
            : null;
        $ipAddress = LoginRateLimiter::clientIpAddress();
        try {
            $requestLimit = $this->rateLimiter()->consumeLoginRequest($ipAddress);
        } catch (Throwable $error) {
            $this->rejectSecurityUnavailable($error);
            return;
        }

        if (!$requestLimit['allowed']) {
            if (!empty($requestLimit['newly_limited'])) {
                $this->recordAuthenticationAudit(
                    'login',
                    'rate_limited',
                    'login_request_limit',
                    $attemptedUsername,
                    $ipAddress
                );
            }
            $this->rejectRateLimited($requestLimit['retry_after']);
            return;
        }

        if (!isset($data['username'], $data['password'])
            || !is_string($data['username'])
            || !is_string($data['password'])
            || trim($data['username']) === ''
            || $data['password'] === ''
            || strlen($data['username']) > 100
            || strlen($data['password']) > 4096) {
            $this->recordAuthenticationAudit(
                'login',
                'failure',
                'invalid_request',
                $attemptedUsername,
                $ipAddress
            );
            echo json_encode([
                "status" => "error",
                "message" => "Username and password are required"
            ]);
            return;
        }

        $username = trim((string) $data['username']);
        if ($this->rejectIfAlreadyLoggedIn()) {
            return;
        }

        if (!$this->verifyCaptcha(
            isset($data['captcha_answer']) && is_scalar($data['captcha_answer'])
                ? $data['captcha_answer']
                : null,
            isset($data['captcha_challenge_id']) && is_scalar($data['captcha_challenge_id'])
                ? $data['captcha_challenge_id']
                : null
        )) {
            $this->recordAuthenticationAudit(
                'login',
                'failure',
                'captcha_failed',
                $username,
                $ipAddress
            );
            echo json_encode([
                "status" => "error",
                "message" => $this->captchaFailureMessage
            ]);
            return;
        }

        try {
            $credentialRetryAfter = $this->rateLimiter()->credentialRetryAfter($ipAddress, $username);
        } catch (Throwable $error) {
            $this->rejectSecurityUnavailable($error);
            return;
        }

        if ($credentialRetryAfter > 0) {
            $this->rejectRateLimited($credentialRetryAfter);
            return;
        }

        $conn = $this->databaseConnection();

        $password = $data['password'];

        /* =======================
           1. CHECK STUDENT
        ======================= */
        $sqlStudent = "
            SELECT 
                s.student_id AS user_id,
                s.username,
                s.first_name,
                s.password_hash,
                s.password_changed_at,
                s.password_is_temporary,
                r.role_name,
                'student' AS user_type
            FROM student s
            JOIN role r ON s.role_id = r.role_id
            WHERE s.username = :username
            LIMIT 1
        ";

        $stmt = $conn->prepare($sqlStudent);
        $stmt->bindParam(":username", $username);
        $stmt->execute();
        $student = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($student && password_verify($password, $student['password_hash'])) {
            if ($this->usesLegacyStarterPassword('student', $student, $password)) {
                $this->disableLegacyStarterPassword($conn, 'student', $student);
                $this->recordAuthenticationAudit('login', 'failure', 'legacy_starter_password', $username, $ipAddress, $student);
                http_response_code(403);
                echo json_encode(['status' => 'error', 'message' => 'Contact the center for a new temporary password.']);
                return;
            }
            try {
                $this->rateLimiter()->clearCredentialFailures($ipAddress, $username);
            } catch (Throwable $error) {
                error_log('Unable to clear successful login failures: ' . $error->getMessage());
            }
            if (!empty($student['password_is_temporary'])) {
                $this->recordAuthenticationAudit('login', 'success', 'temporary_password', $username, $ipAddress, $student);
                $this->requirePasswordChange($student, 'temporary', $remember);
                return;
            }
            if (PasswordExpiration::isExpired($student['password_changed_at'] ?? null)) {
                $this->recordAuthenticationAudit(
                    'login', 'success', 'password_expired', $username, $ipAddress, $student
                );
                $this->requirePasswordChange($student, 'expired', $remember);
                return;
            }
            $this->recordAuthenticationAudit(
                'login',
                'success',
                null,
                $username,
                $ipAddress,
                $student
            );
            session_regenerate_id(true);
            unset($_SESSION['employee_id'], $_SESSION['branch_id']);
            $_SESSION['user_id'] = $student['user_id'];
            $_SESSION['user_role'] = 'student';
            $_SESSION['user_type'] = 'student';
            $_SESSION['student_id'] = $student['user_id'];
            AuthGuard::establish($conn, 'student', (int) $student['user_id'], $remember);

            unset($student['password_hash'], $student['password_changed_at'], $student['password_is_temporary']);
            $student = $this->rememberSessionUser($student);
            echo json_encode([
                "status" => "success",
                "user" => $student,
                "session_token" => $student['session_token'] ?? null,
                "remember_me" => $remember
            ]);
            return;
        }

        /* =======================
           2. CHECK EMPLOYEE
        ======================= */
        $sqlEmployee = "
            SELECT 
                e.employee_id AS user_id,
                e.username,
                e.last_name,
                e.password_hash,
                e.password_changed_at,
                e.password_is_temporary,
                e.status,
                r.role_name,
                'employee' AS user_type
            FROM employee e
            JOIN role r ON e.role_id = r.role_id
            WHERE e.username = :username
            LIMIT 1
        ";

        $stmt = $conn->prepare($sqlEmployee);
        $stmt->bindParam(":username", $username);
        $stmt->execute();
        $employee = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($employee && password_verify($password, $employee['password_hash'])) {
            if ($this->usesLegacyStarterPassword('employee', $employee, $password)) {
                $this->disableLegacyStarterPassword($conn, 'employee', $employee);
                $this->recordAuthenticationAudit('login', 'failure', 'legacy_starter_password', $username, $ipAddress, $employee);
                http_response_code(403);
                echo json_encode(['status' => 'error', 'message' => 'Activate your account with a link from the center.']);
                return;
            }
            if (!empty($employee['password_is_temporary'])) {
                try {
                    $this->rateLimiter()->clearCredentialFailures($ipAddress, $username);
                } catch (Throwable $error) {
                    error_log('Unable to clear successful login failures: ' . $error->getMessage());
                }
                $this->recordAuthenticationAudit('login', 'success', 'temporary_password', $username, $ipAddress, $employee);
                $this->requirePasswordChange($employee, 'temporary', $remember);
                return;
            }

            if ($employee['status'] === 'inactive') {
                $this->recordAuthenticationAudit(
                    'login',
                    'failure',
                    'account_inactive',
                    $username,
                    $ipAddress,
                    $employee
                );
                echo json_encode([
                    "status" => "error",
                    "message" => "Invalid username or password"
                ]);
                return;
            }

            if (PasswordExpiration::isExpired($employee['password_changed_at'] ?? null)) {
                try {
                    $this->rateLimiter()->clearCredentialFailures($ipAddress, $username);
                } catch (Throwable $error) {
                    error_log('Unable to clear successful login failures: ' . $error->getMessage());
                }
                $this->recordAuthenticationAudit(
                    'login', 'success', 'password_expired', $username, $ipAddress, $employee
                );
                $this->requirePasswordChange($employee, 'expired', $remember);
                return;
            }

            try {
                $this->rateLimiter()->clearCredentialFailures($ipAddress, $username);
            } catch (Throwable $error) {
                error_log('Unable to clear successful login failures: ' . $error->getMessage());
            }
            $this->recordAuthenticationAudit(
                'login',
                'success',
                null,
                $username,
                $ipAddress,
                $employee
            );
            session_regenerate_id(true);
            unset($_SESSION['student_id'], $_SESSION['branch_id']);
            $_SESSION['user_id'] = $employee['user_id'];
            $_SESSION['user_role'] = $this->normalizeRole($employee['role_name']);
            $_SESSION['user_type'] = 'employee';
            $_SESSION['employee_id'] = $employee['user_id'];
            AuthGuard::establish($conn, 'employee', (int) $employee['user_id'], $remember);

            $branchStmt = $conn->prepare('SELECT branch_id FROM employee WHERE employee_id = :eid');
            $branchStmt->execute([':eid' => (int) $employee['user_id']]);
            $branchId = $branchStmt->fetchColumn();
            if ($branchId) $_SESSION['branch_id'] = $branchId;

            unset($employee['password_hash'], $employee['password_changed_at'], $employee['password_is_temporary'], $employee['status']);
            $employee = $this->rememberSessionUser($employee);
            echo json_encode([
                'status' => 'success',
                'user' => $employee,
                'session_token' => $employee['session_token'] ?? null,
                'remember_me' => $remember
            ]);
            return;
        }

        try {
            $failureResult = $this->rateLimiter()->recordCredentialFailure($ipAddress, $username);
        } catch (Throwable $error) {
            $this->rejectSecurityUnavailable($error);
            return;
        }

        $targetUser = $student ?: $employee;
        $this->recordAuthenticationAudit(
            'login',
            'failure',
            'invalid_credentials',
            $username,
            $ipAddress,
            $targetUser
        );

        if (!empty($failureResult['user_ip_limit_reached'])) {
            $this->recordAuthenticationAudit(
                'login',
                'rate_limited',
                'credential_ip_user_limit',
                $username,
                $ipAddress,
                $targetUser
            );
        }
        if (!empty($failureResult['user_limit_reached'])) {
            $this->recordAuthenticationAudit(
                'login',
                'rate_limited',
                'credential_user_limit',
                $username,
                $ipAddress,
                $targetUser
            );
        }

        echo json_encode([
            "status" => "error",
            "message" => "Invalid username or password"
        ]);
    }

    // --- SIGNUP FUNCTION (Must be INSIDE the class) ---
    function signup($json) {
        $conn = $this->databaseConnection();

        $data = json_decode($json, true);

        if (empty($data['first_name']) || empty($data['last_name']) || empty($data['username']) || empty($data['password'])) {
            echo json_encode(["status" => "error", "message" => "Missing required fields"]);
            return;
        }

        $first_name = $data['first_name'];
        $middle_name = $data['middle_name'] ?? null;
        $last_name = $data['last_name'];
        $username = $data['username'];
        $password = password_hash($data['password'], PASSWORD_DEFAULT);

        // Get STUDENT role_id
        $roleStmt = $conn->prepare("SELECT role_id FROM role WHERE role_name = 'student' LIMIT 1");
        $roleStmt->execute();
        $role = $roleStmt->fetch(PDO::FETCH_ASSOC);

        if (!$role) {
            echo json_encode(["status" => "error", "message" => "Student role not found"]);
            return;
        }

        $role_id = $role['role_id'];

        // Check username
        $check = $conn->prepare("SELECT COUNT(*) FROM student WHERE username = :username");
        $check->bindParam(":username", $username);
        $check->execute();

        if ($check->fetchColumn() > 0) {
            echo json_encode(["status" => "error", "message" => "Username already exists"]);
            return;
        }

        // Insert student
        $sql = "INSERT INTO student 
            (first_name, middle_name, last_name, ext, username, password_hash, role_id, status, date_created)
            VALUES 
            (:first_name, :middle_name, :last_name, '', :username, :password, :role_id, 'active', NOW())";

        $stmt = $conn->prepare($sql);
        $stmt->execute([
            ":first_name" => $first_name,
            ":middle_name" => $middle_name,
            ":last_name" => $last_name,
            ":username" => $username,
            ":password" => $password,
            ":role_id" => $role_id
        ]);

        echo json_encode(["status" => "success", "message" => "Account created successfully"]);
    }

    function logout() {
        $this->clearSessionState();
        echo json_encode(["status" => "success", "message" => "Logged out successfully"]);
    }
} // <--- CLOSE THE CLASS HERE, NOT EARLIER

// --- MAIN EXECUTION ---
$operation = "";
$json = "";

if ($_SERVER['REQUEST_METHOD'] == 'GET'){
    $operation = $_GET['operation'] ?? "";
    $json = $_GET['json'] ?? "";
} else if($_SERVER['REQUEST_METHOD'] == 'POST'){
    $operation = $_POST['operation'] ?? "";
    $json = $_POST['json'] ?? "";
}

$login = new Login();
switch($operation){
    case "login":
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') AuthGuard::deny(405, 'Method not allowed.');
        $login->login($json);
        break;
    case "captcha":
        $login->captcha();
        break;
    case "session":
        $login->session();
        break;
    case "change_expired_password":
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') AuthGuard::deny(405, 'Method not allowed.');
        $login->changeExpiredPassword($json);
        break;
    case "signup":
        AuthGuard::deny(403, 'Use the enrollment application to request a student account.');
        break;
    case "logout":
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') AuthGuard::deny(405, 'Method not allowed.');
        $login->logout();
        break;
    default:
        echo json_encode(["status" => "error", "message" => "Invalid Operation"]);
        break;
}
?>  
