<?php

require_once __DIR__ . '/email_service.php';
require_once __DIR__ . '/security/SessionBootstrap.php';
require_once __DIR__ . '/security/LoginRateLimiter.php';
require_once __DIR__ . '/security/AuthenticationAuditLogger.php';
require_once __DIR__ . '/security/PasswordExpiration.php';
require_once __DIR__ . '/security/PasswordPolicy.php';
require_once __DIR__ . '/security/AuthGuard.php';

SessionBootstrap::start();
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') AuthGuard::requireSameOrigin();

header('Content-Type: application/json');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

final class ForgotPassword
{
    private const OTP_LIFETIME_SECONDS = 600;
    private const MAX_OTP_ATTEMPTS = 5;

    private $conn;
    private $rateLimiter;
    private $auditLogger;
    private $ipAddress;

    public function __construct()
    {
        include __DIR__ . '/admin/connection-pdo.php';
        $this->conn = $conn;
        PasswordExpiration::ensureSchema($this->conn);
        $this->rateLimiter = new LoginRateLimiter($this->conn);
        $this->auditLogger = new AuthenticationAuditLogger($this->conn);
        $this->ipAddress = LoginRateLimiter::clientIpAddress();
    }

    private function respond($status, $message, $extra = [], $httpStatus = 200)
    {
        http_response_code($httpStatus);
        echo json_encode(array_merge([
            'status' => $status,
            'message' => $message
        ], $extra));
    }

    private function parseRequest($json)
    {
        $data = json_decode((string) $json, true);
        return is_array($data) ? $data : [];
    }

    private function lowercase($value)
    {
        $value = trim((string) $value);
        return function_exists('mb_strtolower')
            ? mb_strtolower($value, 'UTF-8')
            : strtolower($value);
    }

    private function normalizeBirthday($birthday)
    {
        $birthday = trim((string) $birthday);
        $date = DateTime::createFromFormat('!Y-m-d', $birthday);
        if (!$date || $date->format('Y-m-d') !== $birthday || $date > new DateTime('today')) {
            return null;
        }

        return $birthday;
    }

    /**
     * Require one unambiguous account match. This prevents a shared parent
     * email address from arbitrarily selecting the first child in the table.
     * A selected account type also distinguishes student and employee accounts.
     */
    private function findExactAccount($firstName, $lastName, $birthday, $email, $accountType = '')
    {
        $parameters = [
            ':first_name' => $this->lowercase($firstName),
            ':last_name' => $this->lowercase($lastName),
            ':birthday' => $birthday,
            ':email' => $this->lowercase($email)
        ];

        $matches = [];
        // Table and ID names come only from this fixed list, never request input.
        foreach (['student' => 'student_id', 'employee' => 'employee_id'] as $type => $idColumn) {
            if ($accountType !== '' && $accountType !== $type) continue;
            $statusCondition = $type === 'employee' ? " AND a.status = 'active'" : '';
            $statement = $this->conn->prepare(
                "SELECT a.{$idColumn} AS user_id, a.username, a.email,
                        a.first_name, a.last_name, '{$type}' AS user_type,
                        COALESCE(r.role_name, '{$type}') AS role_name
                 FROM {$type} a
                 LEFT JOIN role r ON r.role_id = a.role_id
                 WHERE LOWER(TRIM(a.first_name)) = :first_name
                   AND LOWER(TRIM(a.last_name)) = :last_name
                   AND a.birthday = :birthday
                   AND LOWER(TRIM(a.email)) = :email
                   {$statusCondition}
                 LIMIT 2"
            );
            $statement->execute($parameters);
            $matches = array_merge($matches, $statement->fetchAll(PDO::FETCH_ASSOC));
        }

        return count($matches) === 1 ? $matches[0] : null;
    }

    private function audit($eventType, $outcome, $reasonCode, $email, $targetUser = null)
    {
        try {
            $this->auditLogger->record(
                $eventType,
                $outcome,
                $reasonCode,
                $email,
                $this->ipAddress,
                $targetUser
            );
        } catch (Throwable $error) {
            error_log('Password-reset audit failed: ' . $error->getMessage());
        }
    }

    private function sendEmail($to, $accountName, $otp)
    {
        $body = "A password reset was requested for {$accountName}.\n\n"
            . "OTP: {$otp}\n\n"
            . "This code expires in 10 minutes. If you did not request this reset, ignore this email.";

        return (new EmailService($this->conn))->send(
            $to,
            'Your CDO Tutor password reset code',
            nl2br(htmlspecialchars($body, ENT_QUOTES, 'UTF-8')),
            ['from_name' => 'CDO Tutor', 'alt_body' => $body]
        );
    }

    public function sendOtp($json)
    {
        $data = $this->parseRequest($json);
        $accountType = trim((string) ($data['account_type'] ?? ''));
        $firstName = trim((string) ($data['first_name'] ?? ''));
        $lastName = trim((string) ($data['last_name'] ?? ''));
        $birthday = $this->normalizeBirthday($data['birthday'] ?? '');
        $email = $this->lowercase($data['email'] ?? '');

        if (!in_array($accountType, ['', 'student', 'employee'], true)
            || $firstName === '' || $lastName === '' || !$birthday
            || !filter_var($email, FILTER_VALIDATE_EMAIL)
            || strlen($firstName) > 100 || strlen($lastName) > 100 || strlen($email) > 150) {
            $this->audit('password_reset_request', 'failure', 'invalid_request', $email ?: null);
            $this->respond(
                'error',
                'Enter a valid first name, last name, birthday, and registered email address.'
            );
            return;
        }

        $identityKey = implode('|', [
            $this->lowercase($firstName),
            $this->lowercase($lastName),
            $birthday,
            $email
        ]);

        try {
            $limit = $this->rateLimiter->consumePasswordResetRequest($this->ipAddress, $identityKey);
        } catch (Throwable $error) {
            error_log('Password-reset limiter failed: ' . $error->getMessage());
            $this->respond('error', 'Password recovery is temporarily unavailable. Please try again later.', [], 503);
            return;
        }

        if (!$limit['allowed']) {
            if ($limit['newly_limited']) {
                $this->audit('password_reset_request', 'rate_limited', 'request_limit', $email);
            }
            header('Retry-After: ' . max(1, (int) $limit['retry_after']));
            $this->respond(
                'error',
                'Too many reset requests. Please wait before trying again.',
                ['retry_after' => (int) $limit['retry_after']],
                429
            );
            return;
        }

        $account = $this->findExactAccount($firstName, $lastName, $birthday, $email, $accountType);
        $requestId = bin2hex(random_bytes(32));
        $otp = (string) random_int(100000, 999999);

        // A decoy request is retained when no unique account matches. The
        // response stays generic so the endpoint cannot enumerate accounts.
        $_SESSION['forgot_password'] = [
            'request_id' => $requestId,
            'user_id' => $account ? (int) $account['user_id'] : null,
            'user_type' => $account['user_type'] ?? null,
            'username' => $account['username'] ?? null,
            'role_name' => $account['role_name'] ?? null,
            'email' => $email,
            'otp_hash' => password_hash($otp, PASSWORD_DEFAULT),
            'expires_at' => time() + self::OTP_LIFETIME_SECONDS,
            'verify_attempts' => 0,
            'verified' => false,
            'is_real' => (bool) $account
        ];

        if ($account) {
            $accountName = trim($account['first_name'] . ' ' . $account['last_name']);
            if (!$this->sendEmail($account['email'], $accountName, $otp)) {
                unset($_SESSION['forgot_password']);
                $this->audit('password_reset_request', 'failure', 'email_delivery_failed', $email, $account);
                $this->respond('error', 'The reset email could not be sent right now. Please try again later.');
                return;
            }
            $this->audit('password_reset_request', 'success', null, $email, $account);
        } else {
            $this->audit('password_reset_request', 'failure', 'account_not_matched', $email);
        }

        $this->respond(
            'success',
            'If those details match one account, an OTP has been sent to the registered email.',
            [
                'request_id' => $requestId,
                'expires_in_seconds' => self::OTP_LIFETIME_SECONDS
            ]
        );
    }

    public function verifyOtp($json)
    {
        $data = $this->parseRequest($json);
        $requestId = trim((string) ($data['request_id'] ?? ''));
        $otp = trim((string) ($data['otp'] ?? ''));
        $reset = $_SESSION['forgot_password'] ?? null;

        if (!is_array($reset)
            || !preg_match('/^[a-f0-9]{64}$/', $requestId)
            || !isset($reset['request_id'])
            || !hash_equals((string) $reset['request_id'], $requestId)) {
            $this->respond('error', 'This reset request is no longer valid. Please request a new OTP.');
            return;
        }

        if (time() > (int) ($reset['expires_at'] ?? 0)) {
            $this->audit('password_reset_otp', 'failure', 'otp_expired', $reset['email'] ?? null, $reset);
            unset($_SESSION['forgot_password']);
            $this->respond('error', 'OTP has expired. Please request a new code.');
            return;
        }

        if (!preg_match('/^\d{6}$/', $otp)) {
            $this->respond('error', 'Enter the 6-digit OTP sent to the registered email.');
            return;
        }

        $_SESSION['forgot_password']['verify_attempts'] = (int) ($reset['verify_attempts'] ?? 0) + 1;
        $attempts = $_SESSION['forgot_password']['verify_attempts'];
        $validOtp = !empty($reset['is_real'])
            && isset($reset['otp_hash'])
            && password_verify($otp, $reset['otp_hash']);

        if (!$validOtp) {
            $target = !empty($reset['is_real']) ? $reset : null;
            $this->audit('password_reset_otp', 'failure', 'otp_invalid', $reset['email'] ?? null, $target);
            if ($attempts >= self::MAX_OTP_ATTEMPTS) {
                unset($_SESSION['forgot_password']);
                $this->respond('error', 'Too many incorrect OTP attempts. Please request a new code.');
                return;
            }

            $this->respond(
                'error',
                'The OTP is invalid. ' . (self::MAX_OTP_ATTEMPTS - $attempts) . ' attempt(s) remaining.'
            );
            return;
        }

        $_SESSION['forgot_password']['verified'] = true;
        $_SESSION['forgot_password']['verified_at'] = time();
        unset($_SESSION['forgot_password']['otp_hash']);
        session_regenerate_id(true);
        $this->audit('password_reset_otp', 'success', null, $reset['email'] ?? null, $reset);
        $this->respond('success', 'OTP verified. You may now choose a new password.');
    }

    public function resetPassword($json)
    {
        $data = $this->parseRequest($json);
        $requestId = trim((string) ($data['request_id'] ?? ''));
        $password = isset($data['password']) && is_string($data['password']) ? $data['password'] : '';
        $confirmPassword = isset($data['confirm_password']) && is_string($data['confirm_password'])
            ? $data['confirm_password']
            : '';
        $reset = $_SESSION['forgot_password'] ?? null;

        if (!PasswordPolicy::valid($password)) {
            $this->respond('error', PasswordPolicy::message());
            return;
        }
        if (!hash_equals($password, $confirmPassword)) {
            $this->respond('error', 'Passwords do not match.');
            return;
        }
        if (!is_array($reset)
            || empty($reset['verified'])
            || empty($reset['is_real'])
            || empty($reset['request_id'])
            || !hash_equals((string) $reset['request_id'], $requestId)
            || time() > (int) ($reset['expires_at'] ?? 0)) {
            unset($_SESSION['forgot_password']);
            $this->respond('error', 'OTP verification is required. Please start a new password reset.');
            return;
        }

        if ($reset['user_type'] === 'student') {
            $sql = 'UPDATE student SET password_hash = :password_hash, password_changed_at = NOW(), password_is_temporary = 0 WHERE student_id = :user_id';
        } elseif ($reset['user_type'] === 'employee') {
            $sql = 'UPDATE employee SET password_hash = :password_hash, password_changed_at = NOW(), password_is_temporary = 0 WHERE employee_id = :user_id';
        } else {
            unset($_SESSION['forgot_password']);
            $this->respond('error', 'The selected account is no longer valid. Please start again.');
            return;
        }

        try {
            $statement = $this->conn->prepare($sql);
            $statement->execute([
                ':password_hash' => password_hash($password, PASSWORD_DEFAULT),
                ':user_id' => (int) $reset['user_id']
            ]);

            if (!empty($reset['username'])) {
                $this->rateLimiter->clearCredentialFailures($this->ipAddress, $reset['username']);
            }
            $this->audit('password_reset', 'success', null, $reset['email'] ?? null, $reset);
        } catch (Throwable $error) {
            error_log('Password reset failed: ' . $error->getMessage());
            $this->audit('password_reset', 'failure', 'update_failed', $reset['email'] ?? null, $reset);
            $this->respond('error', 'The password could not be updated. Please try again later.');
            return;
        }

        unset($_SESSION['forgot_password']);
        session_regenerate_id(true);
        $this->respond('success', 'Your password was updated successfully.');
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$operation = $_POST['operation'] ?? '';
$json = $_POST['json'] ?? '';
$forgotPassword = new ForgotPassword();

switch ($operation) {
    case 'send_otp':
        $forgotPassword->sendOtp($json);
        break;
    case 'verify_otp':
        $forgotPassword->verifyOtp($json);
        break;
    case 'reset_password':
        $forgotPassword->resetPassword($json);
        break;
    default:
        http_response_code(400);
        echo json_encode(['status' => 'error', 'message' => 'Invalid operation.']);
        break;
}
