<?php
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception as MailException;

require_once __DIR__ . '/PHPMailer/src/Exception.php';
require_once __DIR__ . '/PHPMailer/src/PHPMailer.php';
require_once __DIR__ . '/PHPMailer/src/SMTP.php';
require_once __DIR__ . '/grade_level_helper.php';
require_once __DIR__ . '/billing_assessment_helper.php';

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
date_default_timezone_set('Asia/Manila');

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

class EnrollmentApplicationAPI
{
    private PDO $conn;

    public function __construct()
    {
        include __DIR__ . '/admin/connection-pdo.php';
        $this->conn = $conn;
        ensureGradeLevelSchema($this->conn);
        $this->ensureApplicationPaymentSchema();
        ensureBillingAssessmentSchema($this->conn);
    }

    private function ensureApplicationPaymentSchema(): void
    {
        if (!$this->columnExists('enrollment_applications', 'requested_service_id')) {
            $this->conn->exec('ALTER TABLE enrollment_applications ADD COLUMN requested_service_id INT(11) DEFAULT NULL AFTER grade_level_id');
            $this->conn->exec('ALTER TABLE enrollment_applications ADD INDEX idx_enrollment_application_service (requested_service_id)');
        }
        $this->conn->exec("CREATE TABLE IF NOT EXISTS enrollment_application_payments (
            application_payment_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            application_id BIGINT UNSIGNED NOT NULL,
            payment_method_id INT(11) NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            reference_no VARCHAR(100) DEFAULT NULL,
            proof_pic VARCHAR(255) DEFAULT NULL,
            payment_status ENUM('awaiting_cash','pending_review','received','declined') NOT NULL,
            reviewed_by INT(11) DEFAULT NULL,
            reviewed_at DATETIME DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (application_payment_id),
            UNIQUE KEY uq_application_payment_application (application_id),
            KEY idx_application_payment_method (payment_method_id),
            KEY idx_application_payment_status (payment_status),
            CONSTRAINT fk_application_payment_application FOREIGN KEY (application_id) REFERENCES enrollment_applications (application_id) ON DELETE CASCADE,
            CONSTRAINT fk_application_payment_method FOREIGN KEY (payment_method_id) REFERENCES payment_method (payment_method_id),
            CONSTRAINT fk_application_payment_reviewer FOREIGN KEY (reviewed_by) REFERENCES employee (employee_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");
    }

    private function columnExists(string $table, string $column): bool
    {
        $stmt = $this->conn->prepare("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?");
        $stmt->execute([$table, $column]);
        return (bool)$stmt->fetchColumn();
    }

    private function storeApplicationPaymentProof(array $uploadedFile, int $applicationId): string
    {
        if (($uploadedFile['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($uploadedFile['tmp_name'] ?? '')) {
            throw new InvalidArgumentException('Upload the GCash receipt screenshot before submitting.');
        }
        if (($uploadedFile['size'] ?? 0) > 10 * 1024 * 1024) {
            throw new InvalidArgumentException('The GCash receipt screenshot must not exceed 10MB.');
        }
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($uploadedFile['tmp_name']);
        $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/bmp' => 'bmp'];
        if (!isset($allowed[$mime])) {
            throw new InvalidArgumentException('The GCash receipt must be a JPG, PNG, WEBP, or BMP image.');
        }
        $directory = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'payment_screenshots';
        if (!is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) {
            throw new RuntimeException('Unable to create the payment screenshot directory.');
        }
        $fileName = 'application_' . $applicationId . '_' . bin2hex(random_bytes(6)) . '.' . $allowed[$mime];
        if (!move_uploaded_file($uploadedFile['tmp_name'], $directory . DIRECTORY_SEPARATOR . $fileName)) {
            throw new RuntimeException('Unable to save the GCash receipt screenshot.');
        }
        return 'uploads/payment_screenshots/' . $fileName;
    }

    private function removeStoredPaymentProof(?string $relativePath): void
    {
        if (!$relativePath || !str_starts_with($relativePath, 'uploads/payment_screenshots/')) return;
        $path = dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativePath);
        if (is_file($path)) @unlink($path);
    }

    public function respond(string $status, string $message = '', array $extra = [], int $httpStatus = 200): void
    {
        http_response_code($httpStatus);
        echo json_encode(array_merge(['status' => $status, 'message' => $message], $extra));
    }

    public function payload(): array
    {
        $json = $_REQUEST['json'] ?? '';
        if ($json === '' && str_contains(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json')) {
            $body = json_decode(file_get_contents('php://input'), true);
            if (is_array($body)) {
                return is_array($body['json'] ?? null) ? $body['json'] : $body;
            }
        }
        $data = json_decode((string)$json, true);
        return is_array($data) ? $data : [];
    }

    private function normalizeText($value): string
    {
        return mb_strtolower(trim(preg_replace('/\s+/', ' ', (string)$value)), 'UTF-8');
    }

    private function normalizeEmail($value): string
    {
        return mb_strtolower(trim((string)$value), 'UTF-8');
    }

    private function normalizePhilippineMobile($value): string
    {
        $digits = preg_replace('/\D+/', '', (string)$value);
        if (str_starts_with($digits, '0063')) {
            $digits = substr($digits, 4);
        } elseif (str_starts_with($digits, '63')) {
            $digits = substr($digits, 2);
        } elseif (str_starts_with($digits, '0')) {
            $digits = substr($digits, 1);
        }
        return $digits !== '' ? '+63' . $digits : '';
    }

    private function requireAdmin(): array
    {
        $role = $this->normalizeText($_SESSION['user_role'] ?? '');
        $allowed = ['owner', 'secretary', 'branch admin', 'auditor'];
        if (!in_array($role, $allowed, true) || empty($_SESSION['employee_id'])) {
            throw new RuntimeException('Administrator login is required.', 401);
        }
        return [
            'employee_id' => (int)$_SESSION['employee_id'],
            'role' => $role,
            'branch_id' => (int)($_SESSION['branch_id'] ?? 0)
        ];
    }

    private function requireOperator(): array
    {
        $admin = $this->requireAdmin();
        if ($admin['role'] === 'auditor') {
            throw new RuntimeException('Auditor accounts can review application information but cannot change it.', 403);
        }
        return $admin;
    }

    private function branchScope(array $admin, string $alias = 'ea'): array
    {
        if ($admin['role'] === 'branch admin') {
            if ($admin['branch_id'] <= 0) {
                throw new RuntimeException('Branch admin account is not assigned to a branch.');
            }
            return [" AND {$alias}.branch_id = ?", [$admin['branch_id']]];
        }
        return ['', []];
    }

    private function emailEscape($value): string
    {
        return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8');
    }

    private function applicationUrl(string $page): string
    {
        $host = trim((string)($_SERVER['HTTP_HOST'] ?? ''));
        if ($host === '') return '';
        $https = !empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off';
        $scheme = $https ? 'https' : 'http';
        $scriptName = str_replace('\\', '/', (string)($_SERVER['SCRIPT_NAME'] ?? ''));
        $basePath = rtrim(dirname(dirname($scriptName)), '/');
        return $scheme . '://' . $host . ($basePath === '.' ? '' : $basePath) . '/' . ltrim($page, '/');
    }

    private function buildApplicationEmail(array $options): string
    {
        $preheader = $this->emailEscape($options['preheader'] ?? $options['title'] ?? 'CDO Tutorial Center update');
        $eyebrow = $this->emailEscape($options['eyebrow'] ?? 'ONLINE ENROLLMENT');
        $title = $this->emailEscape($options['title'] ?? 'Application update');
        $subtitle = $this->emailEscape($options['subtitle'] ?? 'CDO Tutorial Center');
        $greeting = $this->emailEscape($options['greeting'] ?? 'Hello,');
        $messages = '';
        foreach ((array)($options['messages'] ?? []) as $message) {
            $messages .= "<p style='margin:0 0 14px;line-height:1.7;'>" . $this->emailEscape($message) . '</p>';
        }

        $notice = '';
        if (!empty($options['notice'])) {
            $notice = "<div class='notice'>" . $this->emailEscape($options['notice']) . '</div>';
        }

        $featuredValue = '';
        if (!empty($options['featured_value'])) {
            $featuredLabel = $this->emailEscape($options['featured_label'] ?? 'Reference');
            $safeFeaturedValue = $this->emailEscape($options['featured_value']);
            $featuredClass = mb_strlen((string)$options['featured_value'], 'UTF-8') > 12
                ? 'featured-value featured-value-long'
                : 'featured-value';
            $featuredValue = "
                <div class='featured'>
                    <div class='featured-label'>{$featuredLabel}</div>
                    <div class='{$featuredClass}'>{$safeFeaturedValue}</div>
                </div>";
        }

        $details = '';
        if (!empty($options['details']) && is_array($options['details'])) {
            $detailRows = '';
            foreach ($options['details'] as $label => $value) {
                if ($value === null || trim((string)$value) === '') continue;
                $detailRows .= "<tr><td class='detail-label'>" . $this->emailEscape($label) . "</td><td class='detail-value'>" . $this->emailEscape($value) . '</td></tr>';
            }
            if ($detailRows !== '') {
                $details = "<table class='details' role='presentation' cellpadding='0' cellspacing='0' width='100%'>{$detailRows}</table>";
            }
        }

        $credentials = '';
        if (!empty($options['credentials']) && is_array($options['credentials'])) {
            $credentialRows = '';
            foreach ($options['credentials'] as $label => $value) {
                if ($value === null || trim((string)$value) === '') continue;
                $credentialRows .= "<tr><td class='credential-label'>" . $this->emailEscape($label) . "</td><td class='credential-value'>" . $this->emailEscape($value) . '</td></tr>';
            }
            if ($credentialRows !== '') {
                $credentials = "<div class='credentials-title'>Your student portal credentials</div><table class='credentials' role='presentation' cellpadding='0' cellspacing='0' width='100%'>{$credentialRows}</table>";
            }
        }

        $button = '';
        $buttonUrl = trim((string)($options['button_url'] ?? ''));
        if ($buttonUrl !== '' && !empty($options['button_label'])) {
            $safeUrl = $this->emailEscape($buttonUrl);
            $buttonLabel = $this->emailEscape($options['button_label']);
            $button = "<div class='button-wrap'><a class='button' href='{$safeUrl}'>{$buttonLabel}</a></div>";
        }

        $security = '';
        if (!empty($options['security'])) {
            $security = "<div class='security'><strong>Security reminder:</strong> " . $this->emailEscape($options['security']) . '</div>';
        }

        return "<!DOCTYPE html>
<html lang='en'>
<head>
    <meta charset='UTF-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1.0'>
    <title>{$title}</title>
    <style>
        body { margin:0; padding:0; background:#f8fafc; color:#334155; font-family:Arial, Helvetica, sans-serif; }
        table { border-collapse:collapse; }
        .wrapper { width:100%; background:#f8fafc; padding:28px 12px; }
        .container { width:100%; max-width:620px; margin:0 auto; }
        .brand { padding:0 6px 14px; color:#172033; font-size:16px; font-weight:700; }
        .brand-mark { display:inline-block; width:36px; height:36px; margin-right:9px; border-radius:50%; background:#ea9aa6; color:#ffffff; font-size:12px; line-height:36px; text-align:center; vertical-align:middle; }
        .header { padding:31px 30px; border-radius:14px 14px 0 0; background:#ea9aa6; color:#ffffff; text-align:center; }
        .eyebrow { margin:0 0 9px; font-size:12px; font-weight:700; letter-spacing:1.5px; opacity:.92; }
        .header h1 { margin:0; font-size:28px; line-height:1.25; }
        .header p { margin:9px 0 0; font-size:15px; line-height:1.5; opacity:.96; }
        .content { padding:28px 30px 30px; border:1px solid #e2e8f0; border-top:0; border-radius:0 0 14px 14px; background:#ffffff; }
        .greeting { margin:0 0 15px; color:#172033; font-size:18px; font-weight:700; }
        .notice { margin:19px 0; padding:15px 17px; border-left:4px solid #ea9aa6; border-radius:6px; background:#fdf2f4; color:#7f3443; font-weight:700; line-height:1.55; }
        .featured { margin:22px 0; padding:19px 18px; border:1px solid #f3c5ce; border-radius:10px; background:#fff7f9; text-align:center; }
        .featured-label { margin-bottom:8px; color:#7f3443; font-size:12px; font-weight:700; letter-spacing:1px; text-transform:uppercase; }
        .featured-value { color:#172033; font-family:Consolas, Monaco, monospace; font-size:26px; font-weight:700; letter-spacing:5px; overflow-wrap:anywhere; word-break:break-word; }
        .featured-value-long { font-size:14px; line-height:1.65; letter-spacing:.25px; text-align:left; }
        .details { margin:20px 0; border:1px solid #e2e8f0; border-radius:9px; background:#f8fafc; }
        .details td { padding:11px 14px; border-bottom:1px solid #e2e8f0; font-size:14px; line-height:1.4; }
        .details tr:last-child td { border-bottom:0; }
        .detail-label { width:40%; color:#64748b; }
        .detail-value { color:#172033; font-weight:700; text-align:right; }
        .credentials-title { margin:23px 0 9px; color:#172033; font-size:15px; font-weight:700; }
        .credentials { margin:0 0 20px; border:1px solid #f3c5ce; border-radius:9px; background:#fff7f9; }
        .credentials td { padding:12px 14px; border-bottom:1px solid #f3c5ce; font-size:14px; line-height:1.4; }
        .credentials tr:last-child td { border-bottom:0; }
        .credential-label { width:40%; color:#7f3443; }
        .credential-value { color:#172033; font-family:Consolas, Monaco, monospace; font-size:16px !important; font-weight:700; text-align:right; overflow-wrap:anywhere; }
        .button-wrap { margin:25px 0 8px; text-align:center; }
        .button { display:inline-block; padding:13px 25px; border-radius:8px; background:#ea9aa6; color:#ffffff !important; font-size:15px; font-weight:700; text-decoration:none; }
        .security { margin-top:22px; padding-top:18px; border-top:1px solid #e2e8f0; color:#64748b; font-size:12px; line-height:1.6; }
        .footer { padding:18px 20px 0; color:#94a3b8; font-size:12px; line-height:1.6; text-align:center; }
        .preheader { display:none !important; max-height:0; max-width:0; overflow:hidden; opacity:0; color:transparent; }
        @media only screen and (max-width:520px) {
            .wrapper { padding:14px 8px; }
            .header, .content { padding-left:20px; padding-right:20px; }
            .header h1 { font-size:23px; }
            .featured-value { font-size:21px; letter-spacing:3px; }
            .details td { display:block; width:auto; padding:8px 12px; border:0; text-align:left; }
            .details tr { display:block; padding:6px 0; border-bottom:1px solid #e2e8f0; }
        }
    </style>
</head>
<body>
    <div class='preheader'>{$preheader}</div>
    <table class='wrapper' role='presentation' cellpadding='0' cellspacing='0' width='100%'><tr><td>
        <div class='container'>
            <div class='brand'><span class='brand-mark'>CDO</span>CDO Tutorial Center</div>
            <div class='header'><div class='eyebrow'>{$eyebrow}</div><h1>{$title}</h1><p>{$subtitle}</p></div>
            <div class='content'>
                <p class='greeting'>{$greeting}</p>
                {$messages}{$notice}{$featuredValue}{$details}{$credentials}{$button}{$security}
            </div>
            <div class='footer'>This is an automated message from CDO Tutorial Center.<br>Please contact your selected center if you need assistance.</div>
        </div>
    </td></tr></table>
</body>
</html>";
    }

    private function sendEmail(string $to, string $subject, string $message, string $plainText = ''): bool
    {
        $mail = new PHPMailer(true);
        try {
            $mail->isSMTP();
            $mail->Host = 'smtp.gmail.com';
            $mail->SMTPAuth = true;
            $mail->Username = getenv('CDO_TUTOR_SMTP_USERNAME') ?: 'espinosapaul810@gmail.com';
            $mail->Password = getenv('CDO_TUTOR_SMTP_PASSWORD') ?: 'yjds vbuo gxas knkm';
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
            $mail->Port = 587;
            $mail->SMTPOptions = [
                'ssl' => [
                    'verify_peer' => false,
                    'verify_peer_name' => false,
                    'allow_self_signed' => true
                ]
            ];
            $mail->setFrom($mail->Username, 'CDO Tutorial Center');
            $mail->addAddress($to);
            $mail->CharSet = 'UTF-8';
            $mail->isHTML(true);
            $mail->Subject = $subject;
            $mail->Body = $message;
            $mail->AltBody = $plainText !== ''
                ? $plainText
                : trim(html_entity_decode(strip_tags($message), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
            return $mail->send();
        } catch (MailException $e) {
            error_log('Enrollment application email failed: ' . $mail->ErrorInfo);
            return false;
        }
    }

    private function activeSchoolYear(): array
    {
        $row = $this->conn->query("SELECT school_year_id, school_year FROM school_years WHERE sy_status = 'active' ORDER BY school_year_id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            throw new RuntimeException('There is no active school year. Please contact the center.');
        }
        return $row;
    }

    private function findExactStudent(array $data): ?array
    {
        $email = $this->normalizeEmail($data['email'] ?? '');
        $first = $this->normalizeText($data['first_name'] ?? '');
        $middle = $this->normalizeText($data['middle_name'] ?? '');
        $last = $this->normalizeText($data['last_name'] ?? '');
        $ext = $this->normalizeText($data['ext'] ?? '');
        $birthday = trim((string)($data['birthday'] ?? ''));

        if ($email === '' || $first === '' || $last === '' || $birthday === '') {
            return null;
        }

        $stmt = $this->conn->prepare("SELECT student_id, username, student_id_number
            FROM student
            WHERE LOWER(TRIM(email)) = ?
              AND LOWER(TRIM(first_name)) = ?
              AND LOWER(TRIM(COALESCE(middle_name, ''))) = ?
              AND LOWER(TRIM(last_name)) = ?
              AND LOWER(TRIM(COALESCE(ext, ''))) = ?
              AND birthday = ?
            ORDER BY student_id ASC
            LIMIT 1");
        $stmt->execute([$email, $first, $middle, $last, $ext, $birthday]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function getLookups(): void
    {
        try {
            $schoolYear = $this->activeSchoolYear();
            $programs = $this->conn->query("SELECT p.program_id, p.name, p.discription, p.tuition, p.total_units, p.unit_type,
                    p.registration_fee, p.downpayment, pt.type AS program_type
                FROM program p
                LEFT JOIN program_type pt ON pt.program_type_id = p.program_type
                WHERE p.status = 'active'
                ORDER BY p.name")->fetchAll(PDO::FETCH_ASSOC);
            $branches = $this->conn->query("SELECT branch_id, branch_name, branch_location, operating_days, opening_time, closing_time
                FROM branch WHERE status = 'active' ORDER BY branch_name")->fetchAll(PDO::FETCH_ASSOC);
            $grades = $this->conn->query("SELECT grade_level_id, grade_level FROM grade_level WHERE status = 'active' ORDER BY grade_level_id")->fetchAll(PDO::FETCH_ASSOC);
            $subjects = $this->conn->query("SELECT subject_id, subject_name FROM subject ORDER BY subject_name")->fetchAll(PDO::FETCH_ASSOC);
            $genders = $this->conn->query("SELECT gender_id, gender FROM gender ORDER BY gender_id")->fetchAll(PDO::FETCH_ASSOC);
            $paymentMethods = $this->conn->query("SELECT payment_method_id, payment_method, account_name, account_number, qr_code
                FROM payment_method
                WHERE LOWER(payment_method) IN ('cash', 'gcash')
                ORDER BY FIELD(LOWER(payment_method), 'cash', 'gcash'), payment_method_id")->fetchAll(PDO::FETCH_ASSOC);
            $this->respond('success', '', [
                'data' => compact('programs', 'branches', 'grades', 'subjects', 'genders', 'paymentMethods', 'schoolYear')
            ]);
        } catch (Throwable $e) {
            $this->respond('error', $e->getMessage(), [], 500);
        }
    }

    public function checkStudent(array $data): void
    {
        $match = $this->findExactStudent($data);
        $this->respond('success', $match ? 'This student already has a record or application.' : 'No matching student record was found.', [
            'existing_student' => (bool)$match,
            'student_id_number' => $match['student_id_number'] ?? null,
            'username' => $match['username'] ?? null
        ]);
    }

    public function sendOtp(array $data): void
    {
        try {
            $email = $this->normalizeEmail($data['email'] ?? '');
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw new InvalidArgumentException('Please enter a valid parent or guardian email address.');
            }
            if ($this->findExactStudent($data)) {
                $this->respond('error', 'A student with this email, full name, and birthdate already has a record or application. Please track the existing application, log in if already enrolled, or contact the center.', ['existing_student' => true], 409);
                return;
            }

            $rate = $this->conn->prepare("SELECT created_at FROM enrollment_email_verifications WHERE email = ? ORDER BY verification_id DESC LIMIT 1");
            $rate->execute([$email]);
            $last = $rate->fetchColumn();
            if ($last && strtotime($last) > time() - 60) {
                throw new RuntimeException('Please wait one minute before requesting another code.');
            }

            $otp = (string)random_int(100000, 999999);
            $stmt = $this->conn->prepare("INSERT INTO enrollment_email_verifications (email, otp_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))");
            $stmt->execute([$email, password_hash($otp, PASSWORD_DEFAULT)]);
            $verificationId = (int)$this->conn->lastInsertId();

            $message = $this->buildApplicationEmail([
                'preheader' => "Your verification code is {$otp}. It expires in 10 minutes.",
                'eyebrow' => 'EMAIL VERIFICATION',
                'title' => 'Verify your email',
                'subtitle' => 'New Student Online Enrollment',
                'greeting' => 'Hello,',
                'messages' => [
                    'Use the six-digit code below to verify this parent or guardian email and continue the online enrollment application.'
                ],
                'featured_label' => 'Verification code',
                'featured_value' => $otp,
                'notice' => 'This code expires in 10 minutes. It may be used for applications for children sharing this parent or guardian email.',
                'security' => 'If you did not request this code, you can safely ignore this email. Never share this code with anyone.'
            ]);
            $plainText = "Your CDO Tutor new-student enrollment verification code is: {$otp}\n\n" .
                "This code expires in 10 minutes. It may be used to submit applications for children sharing this parent/guardian email.\n\n" .
                'If you did not request this code, please ignore this email.';
            if (!$this->sendEmail($email, 'CDO Tutor enrollment verification code', $message, $plainText)) {
                $this->conn->prepare('DELETE FROM enrollment_email_verifications WHERE verification_id = ?')->execute([$verificationId]);
                throw new RuntimeException('The verification email could not be sent. Please try again or contact the center.');
            }

            $this->respond('success', 'Verification code sent. Please check your email.', ['verification_id' => $verificationId]);
        } catch (Throwable $e) {
            $this->respond('error', $e->getMessage(), [], $e instanceof InvalidArgumentException ? 422 : 500);
        }
    }

    public function verifyOtp(array $data): void
    {
        try {
            $id = (int)($data['verification_id'] ?? 0);
            $email = $this->normalizeEmail($data['email'] ?? '');
            $otp = trim((string)($data['otp'] ?? ''));
            if ($id <= 0 || $email === '' || !preg_match('/^\d{6}$/', $otp)) {
                throw new InvalidArgumentException('Enter the six-digit verification code.');
            }

            $stmt = $this->conn->prepare("SELECT * FROM enrollment_email_verifications WHERE verification_id = ? AND email = ? LIMIT 1");
            $stmt->execute([$id, $email]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$row || strtotime($row['expires_at']) < time()) {
                throw new RuntimeException('The verification code has expired. Please request a new one.');
            }
            if ((int)$row['attempts'] >= 5) {
                throw new RuntimeException('Too many incorrect attempts. Please request a new code.');
            }
            if (!password_verify($otp, $row['otp_hash'])) {
                $this->conn->prepare('UPDATE enrollment_email_verifications SET attempts = attempts + 1 WHERE verification_id = ?')->execute([$id]);
                throw new RuntimeException('The verification code is incorrect.');
            }

            $token = bin2hex(random_bytes(32));
            $this->conn->prepare("UPDATE enrollment_email_verifications
                SET verified_at = NOW(), verification_token_hash = ?, expires_at = DATE_ADD(NOW(), INTERVAL 2 HOUR)
                WHERE verification_id = ?")->execute([hash('sha256', $token), $id]);
            $this->respond('success', 'Email verified successfully.', ['verification_token' => $token]);
        } catch (Throwable $e) {
            $this->respond('error', $e->getMessage(), [], 422);
        }
    }

    private function validateAvailability(array $availability): array
    {
        $days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        $clean = [];
        foreach ($availability as $slot) {
            $day = trim((string)($slot['day'] ?? ''));
            $start = trim((string)($slot['start_time'] ?? $slot['time'] ?? ''));
            $end = trim((string)($slot['end_time'] ?? $slot['endTime'] ?? ''));
            if (!in_array($day, $days, true) || !preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $start) || !preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $end)) {
                throw new InvalidArgumentException('Every availability entry needs a valid day, start time, and end time.');
            }
            if (strtotime($end) <= strtotime($start)) {
                throw new InvalidArgumentException("End time must be later than start time for {$day}.");
            }
            $key = "{$day}|{$start}|{$end}";
            $clean[$key] = ['day' => $day, 'start_time' => $start, 'end_time' => $end];
        }
        if (!$clean) {
            throw new InvalidArgumentException('Add at least one preferred day and time.');
        }
        return array_values($clean);
    }

    private function generateStudentNumber(string $schoolYear): string
    {
        preg_match('/\b(\d{4})\b/', $schoolYear, $matches);
        $prefix = ($matches[1] ?? date('Y')) . ' - ';
        $stmt = $this->conn->prepare("SELECT student_id_number FROM student WHERE student_id_number LIKE ? ORDER BY student_id DESC");
        $stmt->execute([$prefix . '%']);
        $max = 0;
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $number) {
            if (preg_match('/(\d+)$/', (string)$number, $numberMatch)) {
                $max = max($max, (int)$numberMatch[1]);
            }
        }
        return $prefix . str_pad((string)($max + 1), 4, '0', STR_PAD_LEFT);
    }

    private function uniqueApplicationNumber(): string
    {
        do {
            $number = 'APP-' . date('ymd') . '-' . strtoupper(bin2hex(random_bytes(2)));
            $stmt = $this->conn->prepare('SELECT 1 FROM enrollment_applications WHERE application_number = ?');
            $stmt->execute([$number]);
        } while ($stmt->fetchColumn());
        return $number;
    }

    public function submitApplication(array $data): void
    {
        $storedProofPath = null;
        try {
            $email = $this->normalizeEmail($data['email'] ?? '');
            $verificationId = (int)($data['verification_id'] ?? 0);
            $verificationToken = trim((string)($data['verification_token'] ?? ''));
            $verify = $this->conn->prepare("SELECT verified_at FROM enrollment_email_verifications
                WHERE verification_id = ? AND email = ? AND verification_token_hash = ?
                  AND verified_at IS NOT NULL AND expires_at >= NOW() LIMIT 1");
            $verify->execute([$verificationId, $email, hash('sha256', $verificationToken)]);
            $verifiedAt = $verify->fetchColumn();
            if (!$verifiedAt) {
                throw new RuntimeException('Email verification is required before submitting the application.');
            }
            if ($this->findExactStudent($data)) {
                $this->respond('error', 'A student with this email, full name, and birthdate already has a record or application.', ['existing_student' => true], 409);
                return;
            }

            $required = [
                'first_name' => 'First name', 'last_name' => 'Last name', 'birthday' => 'Birthdate',
                'gender_id' => 'Gender', 'guardian_name' => 'Guardian name',
                'guardian_contact' => 'Guardian contact number', 'guardian_relationship' => 'Guardian relationship',
                'adr_street' => 'House/street', 'adr_barangay' => 'Barangay', 'adr_city' => 'City/municipality',
                'adr_province' => 'Province',
                'program_id' => 'Program', 'branch_id' => 'Branch'
            ];
            foreach ($required as $key => $label) {
                if (trim((string)($data[$key] ?? '')) === '') {
                    throw new InvalidArgumentException("{$label} is required.");
                }
            }
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw new InvalidArgumentException('A valid email address is required.');
            }
            $birthday = DateTime::createFromFormat('!Y-m-d', (string)$data['birthday']);
            if (!$birthday || $birthday->format('Y-m-d') !== (string)$data['birthday'] || $birthday > new DateTime('today')) {
                throw new InvalidArgumentException('Enter a valid student birthdate that is not in the future.');
            }
            $guardianContact = $this->normalizePhilippineMobile($data['guardian_contact'] ?? '');
            if (!preg_match('/^\+639\d{9}$/', $guardianContact)) {
                throw new InvalidArgumentException('Guardian contact number must be a valid Philippine mobile number in +639XXXXXXXXX format.');
            }
            $programId = (int)$data['program_id'];
            $branchId = (int)$data['branch_id'];
            $genderId = (int)$data['gender_id'];
            $programStmt = $this->conn->prepare("SELECT p.name, pt.type AS program_type
                FROM program p
                LEFT JOIN program_type pt ON pt.program_type_id = p.program_type
                WHERE p.program_id = ? AND p.status = 'active' LIMIT 1");
            $programStmt->execute([$programId]);
            $program = $programStmt->fetch(PDO::FETCH_ASSOC);
            $branchStmt = $this->conn->prepare("SELECT branch_name FROM branch WHERE branch_id = ? AND status = 'active'");
            $branchStmt->execute([$branchId]);
            $branch = $branchStmt->fetch(PDO::FETCH_ASSOC);
            $genderStmt = $this->conn->prepare('SELECT 1 FROM gender WHERE gender_id = ?');
            $genderStmt->execute([$genderId]);
            if (!$program || !$branch) {
                throw new InvalidArgumentException('The selected program or branch is no longer available.');
            }
            if ($genderId <= 0 || !$genderStmt->fetchColumn()) {
                throw new InvalidArgumentException('The selected gender is not valid.');
            }

            $programDescriptor = strtolower(trim((string)$program['name'] . ' ' . (string)($program['program_type'] ?? '')));
            $isTutorial = str_contains($programDescriptor, 'tutorial');
            $gradeId = $isTutorial && !empty($data['grade_level_id']) ? (int)$data['grade_level_id'] : null;
            if ($isTutorial) {
                if (!$gradeId) {
                    throw new InvalidArgumentException('Grade level is required for a Tutorial enrollment.');
                }
                $gradeStmt = $this->conn->prepare("SELECT 1 FROM grade_level WHERE grade_level_id = ? AND status = 'active' LIMIT 1");
                $gradeStmt->execute([$gradeId]);
                if (!$gradeStmt->fetchColumn()) {
                    throw new InvalidArgumentException('The selected grade level is no longer available. Please choose another grade.');
                }
            }
            $subjectIds = $isTutorial
                ? array_values(array_unique(array_filter(array_map('intval', (array)($data['subject_ids'] ?? [])))))
                : [];
            $availability = $isTutorial ? $this->validateAvailability((array)($data['availability'] ?? [])) : [];
            $goal = $isTutorial ? (trim((string)($data['goal'] ?? '')) ?: null) : null;
            $schoolYear = $this->activeSchoolYear();
            $requestedServiceId = !empty($data['include_service']) ? (int)($data['service_id'] ?? 0) : null;
            if (!empty($data['include_service']) && ($requestedServiceId ?? 0) <= 0) {
                throw new InvalidArgumentException('Select a valid service or choose not to include it.');
            }
            $snapshot = $this->financialSnapshot($programId, $requestedServiceId, $branchId);
            $expectedInitialPayment = round((float)$snapshot['initial_payment'], 2);
            $paymentMethodId = (int)($data['payment_method_id'] ?? 0);
            $paymentMethodStmt = $this->conn->prepare('SELECT payment_method FROM payment_method WHERE payment_method_id = ? LIMIT 1');
            $paymentMethodStmt->execute([$paymentMethodId]);
            $paymentMethodName = trim((string)$paymentMethodStmt->fetchColumn());
            $normalizedPaymentMethod = strtolower($paymentMethodName);
            $isCashPayment = $normalizedPaymentMethod === 'cash';
            $isGcashPayment = $normalizedPaymentMethod === 'gcash';
            if (!$isCashPayment && !$isGcashPayment) {
                throw new InvalidArgumentException('Choose Cash or GCash as the enrollment payment method.');
            }
            $paymentAmount = round((float)($data['payment_amount'] ?? $expectedInitialPayment), 2);
            $paymentReference = trim((string)($data['payment_reference_no'] ?? '')) ?: null;
            if ($isGcashPayment) {
                if (abs($paymentAmount - $expectedInitialPayment) > 0.01) {
                    throw new InvalidArgumentException('The GCash receipt amount must equal the registration fee and downpayment total of PHP ' . number_format($expectedInitialPayment, 2) . '.');
                }
                if (!preg_match('/^\d{13}$/', (string)$paymentReference)) {
                    throw new InvalidArgumentException('The GCash reference number must contain exactly 13 digits.');
                }
                if (empty($_FILES['payment_screenshot'])) {
                    throw new InvalidArgumentException('Upload the GCash receipt screenshot before submitting.');
                }
            }

            $this->conn->beginTransaction();

            // Serialize student-number generation for concurrent applications.
            $schoolYearLock = $this->conn->prepare('SELECT school_year_id FROM school_years WHERE school_year_id = ? FOR UPDATE');
            $schoolYearLock->execute([(int)$schoolYear['school_year_id']]);

            $guardian = $this->conn->prepare('INSERT INTO guardian (name, contact_number, relationship) VALUES (?, ?, ?)');
            $guardian->execute([
                trim((string)$data['guardian_name']), $guardianContact, trim((string)$data['guardian_relationship'])
            ]);
            $guardianId = (int)$this->conn->lastInsertId();

            $studentNumber = $this->generateStudentNumber((string)$schoolYear['school_year']);
            $student = $this->conn->prepare("INSERT INTO student
                (student_id_number, username, password_hash, email, first_name, middle_name, last_name, ext, nickname,
                 birthday, gender_id, guardian_id, adr_street, adr_barangay, adr_city, adr_province, adr_note,
                 role_id, employee_id, status, date_created, health_note)
                 VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, 'inactive', NOW(), ?)");
            $student->execute([
                $studentNumber, $email,
                trim((string)$data['first_name']), trim((string)($data['middle_name'] ?? '')) ?: null,
                trim((string)$data['last_name']), trim((string)($data['ext'] ?? '')),
                trim((string)($data['nickname'] ?? '')) ?: null, $data['birthday'],
                $genderId, $guardianId,
                trim((string)($data['adr_street'] ?? '')) ?: null, trim((string)($data['adr_barangay'] ?? '')) ?: null,
                trim((string)($data['adr_city'] ?? '')) ?: null, trim((string)($data['adr_province'] ?? '')) ?: null,
                trim((string)($data['adr_note'] ?? '')) ?: null, trim((string)($data['health_note'] ?? '')) ?: null
            ]);
            $studentId = (int)$this->conn->lastInsertId();
            $applicationNumber = $this->uniqueApplicationNumber();
            $trackingToken = bin2hex(random_bytes(32));
            $app = $this->conn->prepare("INSERT INTO enrollment_applications
                (application_number, tracking_token_hash, student_id, program_id, branch_id, school_year_id,
                 grade_level_id, requested_service_id, goal, status, email_verified_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?)");
            $app->execute([
                $applicationNumber, hash('sha256', $trackingToken), $studentId, $programId, $branchId,
                (int)$schoolYear['school_year_id'], $gradeId, $requestedServiceId, $goal, $verifiedAt
            ]);
            $applicationId = (int)$this->conn->lastInsertId();
            saveApplicationFinancialSnapshot($this->conn, $applicationId, $snapshot);

            if ($isGcashPayment) {
                $storedProofPath = $this->storeApplicationPaymentProof($_FILES['payment_screenshot'], $applicationId);
            }
            $applicationPayment = $this->conn->prepare("INSERT INTO enrollment_application_payments
                (application_id, payment_method_id, amount, reference_no, proof_pic, payment_status)
                VALUES (?, ?, ?, ?, ?, ?)");
            $applicationPayment->execute([
                $applicationId,
                $paymentMethodId,
                $expectedInitialPayment,
                $isGcashPayment ? $paymentReference : null,
                $storedProofPath,
                $isGcashPayment ? 'pending_review' : 'awaiting_cash'
            ]);

            if ($subjectIds) {
                $subjectInsert = $this->conn->prepare('INSERT INTO enrollment_application_subjects (application_id, subject_id) VALUES (?, ?)');
                foreach ($subjectIds as $subjectId) {
                    $subjectInsert->execute([$applicationId, $subjectId]);
                }
            }
            $availabilityInsert = $this->conn->prepare('INSERT INTO enrollment_application_availability (application_id, day, start_time, end_time) VALUES (?, ?, ?, ?)');
            foreach ($availability as $slot) {
                $availabilityInsert->execute([$applicationId, $slot['day'], $slot['start_time'], $slot['end_time']]);
            }

            $this->conn->commit();

            $trackingUrl = $this->applicationUrl('new_student_enrollment.html');
            $receivedEmail = $this->buildApplicationEmail([
                'preheader' => "Application {$applicationNumber} was received and is waiting for center review.",
                'eyebrow' => 'APPLICATION RECEIVED',
                'title' => 'We received your application',
                'subtitle' => "Application {$applicationNumber}",
                'greeting' => 'Hello ' . trim((string)$data['first_name']) . ',',
                'messages' => [
                    'Your new-student online application has been submitted successfully and is now waiting for the center’s review.',
                    $isGcashPayment
                        ? 'Your GCash receipt was recorded with the application. Once the center approves it, teacher or class assignment can begin.'
                        : 'Please visit your selected center after approval to pay the registration fee and downpayment in cash.'
                ],
                'notice' => 'Current status: Pending',
                'featured_label' => 'Private tracking token',
                'featured_value' => $trackingToken,
                'details' => [
                    'Application number' => $applicationNumber,
                    'Student ID' => $studentNumber,
                    'Program' => $program['name'],
                    'Center' => $branch['branch_name'],
                    'Payment method' => $paymentMethodName,
                    'Monthly service' => $snapshot['service_name'] ?: 'Not included',
                    'Initial payment' => 'PHP ' . number_format($expectedInitialPayment, 2),
                    'School year' => $schoolYear['school_year']
                ],
                'button_label' => 'Track your application',
                'button_url' => $trackingUrl,
                'security' => 'Keep the tracking token private. You will need it together with the application number when checking the application online.'
            ]);
            $paymentNextStep = $isGcashPayment
                ? 'Your GCash receipt was recorded and will be confirmed when the center approves the application.'
                : 'After approval, visit the selected center to pay the registration fee and downpayment in cash.';
            $receivedPlainText = "Hello {$data['first_name']},\n\nYour new-student application {$applicationNumber} is pending review. " .
                $paymentNextStep . "\n\n" .
                "Tracking token: {$trackingToken}\n\nKeep this token private.";
            $this->sendEmail($email, "Enrollment application {$applicationNumber} received", $receivedEmail, $receivedPlainText);

            $successMessage = $isGcashPayment
                ? 'Application and GCash receipt submitted. The center can approve it and continue directly to teacher or class assignment.'
                : 'Application submitted. Please visit the center after approval to pay the registration fee and downpayment in cash.';
            $this->respond('success', $successMessage, [
                'application_number' => $applicationNumber,
                'tracking_token' => $trackingToken,
                'student_id_number' => $studentNumber,
                'payment_method' => $paymentMethodName,
                'payment_status' => $isGcashPayment ? 'pending_review' : 'awaiting_cash',
                'status_code' => 'pending_review'
            ]);
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            $this->removeStoredPaymentProof($storedProofPath);
            $this->respond('error', $e->getMessage(), [], $e instanceof InvalidArgumentException ? 422 : 500);
        }
    }

    private function applicationBaseQuery(): string
    {
        return "SELECT ea.*, s.student_id_number, s.username, s.email, s.first_name, s.middle_name, s.last_name, s.ext,
                s.nickname, s.birthday, s.gender_id, s.adr_street, s.adr_barangay, s.adr_city, s.adr_province,
                s.adr_note, s.health_note, g.name AS guardian_name, g.contact_number AS guardian_contact,
                g.relationship AS guardian_relationship, p.name AS program_name, p.tuition, p.total_units,
                p.unit_type, pt.type AS program_type, p.registration_fee AS program_registration_fee, p.downpayment AS program_downpayment,
                b.branch_name, b.branch_location, sy.school_year, gl.grade_level,
                TRIM(CONCAT_WS(' ', reviewer.first_name, reviewer.last_name)) AS reviewer_name
            FROM enrollment_applications ea
            JOIN student s ON s.student_id = ea.student_id
            LEFT JOIN guardian g ON g.guardian_id = s.guardian_id
            JOIN program p ON p.program_id = ea.program_id
            LEFT JOIN program_type pt ON pt.program_type_id = p.program_type
            JOIN branch b ON b.branch_id = ea.branch_id
            JOIN school_years sy ON sy.school_year_id = ea.school_year_id
            LEFT JOIN grade_level gl ON gl.grade_level_id = ea.grade_level_id
            LEFT JOIN employee reviewer ON reviewer.employee_id = ea.reviewed_by";
    }

    private function hydrateApplication(array $row): array
    {
        $id = (int)$row['application_id'];
        $subjects = $this->conn->prepare("SELECT s.subject_id, s.subject_name FROM enrollment_application_subjects eas JOIN subject s ON s.subject_id = eas.subject_id WHERE eas.application_id = ? ORDER BY s.subject_name");
        $subjects->execute([$id]);
        $availability = $this->conn->prepare("SELECT availability_id, day, TIME_FORMAT(start_time, '%H:%i') AS start_time, TIME_FORMAT(end_time, '%H:%i') AS end_time FROM enrollment_application_availability WHERE application_id = ? ORDER BY FIELD(day, 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'), start_time");
        $availability->execute([$id]);
        $row['subjects'] = $subjects->fetchAll(PDO::FETCH_ASSOC);
        $row['availability'] = $availability->fetchAll(PDO::FETCH_ASSOC);
        $payment = $this->conn->prepare("SELECT eap.application_payment_id, eap.payment_method_id, eap.amount,
                eap.reference_no, eap.proof_pic, eap.payment_status, eap.created_at,
                pm.payment_method, pm.account_name, pm.account_number, pm.qr_code
            FROM enrollment_application_payments eap
            JOIN payment_method pm ON pm.payment_method_id = eap.payment_method_id
            WHERE eap.application_id = ? LIMIT 1");
        $payment->execute([$id]);
        $row['application_payment'] = $payment->fetch(PDO::FETCH_ASSOC) ?: null;
        $selectedServiceId = !empty($row['requested_service_id']) ? (int)$row['requested_service_id'] : null;
        if (!empty($row['enrollment_details_id'])) {
            $selectedServiceId = $this->selectedServiceIdForEnrollment((int)$row['enrollment_details_id']);
        }
        $row['financial'] = loadApplicationFinancialSnapshot($this->conn, $id, (int)$row['program_id'])
            ?: $this->financialSnapshot((int)$row['program_id'], $selectedServiceId, (int)$row['branch_id']);
        if (!empty($row['enrollment_details_id'])) {
            $row['billing'] = $this->billingData((int)$row['enrollment_details_id']);
        }
        return $row;
    }

    public function getPublicStatus(array $data): void
    {
        try {
            $number = trim((string)($data['application_number'] ?? ''));
            $token = trim((string)($data['tracking_token'] ?? ''));
            if ($number === '' || $token === '') {
                throw new InvalidArgumentException('Application number and tracking token are required.');
            }
            $stmt = $this->conn->prepare($this->applicationBaseQuery() . ' WHERE ea.application_number = ? AND ea.tracking_token_hash = ? LIMIT 1');
            $stmt->execute([$number, hash('sha256', $token)]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$row) {
                throw new RuntimeException('Application was not found.');
            }
            $row = $this->hydrateApplication($row);
            if (!empty($row['enrollment_details_id'])) {
                $row['payment_receipt'] = $this->publicPaymentReceipt((int)$row['enrollment_details_id']);
            }
            unset($row['tracking_token_hash'], $row['password_hash']);
            $this->respond('success', '', ['data' => $row]);
        } catch (Throwable $e) {
            $this->respond('error', $e->getMessage(), [], 404);
        }
    }

    public function listApplications(array $data): void
    {
        try {
            $admin = $this->requireAdmin();
            [$scope, $params] = $this->branchScope($admin);
            $status = trim((string)($data['status'] ?? ''));
            $search = trim((string)($data['search'] ?? ''));
            $where = ' WHERE 1=1' . $scope;
            if ($status !== '') {
                $where .= ' AND ea.status = ?';
                $params[] = $status;
            }
            if ($search !== '') {
                $where .= " AND (ea.application_number LIKE ? OR s.student_id_number LIKE ? OR CONCAT_WS(' ', s.first_name, s.middle_name, s.last_name) LIKE ?)";
                $term = "%{$search}%";
                array_push($params, $term, $term, $term);
            }
            $stmt = $this->conn->prepare($this->applicationBaseQuery() . $where . ' ORDER BY ea.created_at DESC');
            $stmt->execute($params);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            foreach ($rows as &$row) {
                unset($row['tracking_token_hash']);
            }
            unset($row);
            $counts = array_fill_keys(['pending_review', 'approved_for_payment', 'ready_for_scheduling', 'enrolled', 'rejected'], 0);
            foreach ($rows as $row) {
                if (isset($counts[$row['status']])) $counts[$row['status']]++;
            }
            $this->respond('success', '', ['data' => $rows, 'counts' => $counts]);
        } catch (Throwable $e) {
            $this->respond('error', $e->getMessage(), [], $e->getCode() === 401 ? 401 : 500);
        }
    }

    private function adminApplication(int $applicationId, array $admin, bool $forUpdate = false): array
    {
        [$scope, $params] = $this->branchScope($admin);
        $sql = $this->applicationBaseQuery() . " WHERE ea.application_id = ?{$scope} LIMIT 1" . ($forUpdate ? ' FOR UPDATE' : '');
        array_unshift($params, $applicationId);
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            throw new RuntimeException('Application was not found or is outside your branch.');
        }
        return $this->hydrateApplication($row);
    }

    public function getApplication(array $data): void
    {
        try {
            $admin = $this->requireAdmin();
            $row = $this->adminApplication((int)($data['application_id'] ?? 0), $admin);
            unset($row['tracking_token_hash']);
            $this->respond('success', '', ['data' => $row]);
        } catch (Throwable $e) {
            $this->respond('error', $e->getMessage(), [], 404);
        }
    }

    public function reviewApplication(array $data): void
    {
        try {
            $admin = $this->requireOperator();
            $applicationId = (int)($data['application_id'] ?? 0);
            $decision = trim((string)($data['decision'] ?? ''));
            if (!in_array($decision, ['approve', 'reject'], true)) {
                throw new InvalidArgumentException('Choose approve or reject.');
            }
            $this->conn->beginTransaction();
            $application = $this->adminApplication($applicationId, $admin, true);
            if ($application['status'] !== 'pending_review') {
                throw new RuntimeException('Only applications pending review can be reviewed.');
            }
            $notes = trim((string)($data['notes'] ?? '')) ?: null;
            $applicationPayment = $application['application_payment'] ?? null;
            $isSubmittedGcash = $applicationPayment
                && strtolower(trim((string)($applicationPayment['payment_method'] ?? ''))) === 'gcash';
            $status = $decision === 'approve'
                ? ($isSubmittedGcash ? 'ready_for_scheduling' : 'approved_for_payment')
                : 'rejected';

            if ($decision === 'approve' && $isSubmittedGcash) {
                if (($applicationPayment['payment_status'] ?? '') !== 'pending_review') {
                    throw new RuntimeException('This GCash payment is not awaiting application review.');
                }
                $snapshot = $this->applicationFinancialSnapshot($application);
                $created = $this->createPaidApplicationEnrollment(
                    $application,
                    $snapshot,
                    (int)$applicationPayment['payment_method_id'],
                    trim((string)($applicationPayment['reference_no'] ?? '')) ?: null,
                    (float)$applicationPayment['amount'],
                    $admin['employee_id'],
                    trim((string)($applicationPayment['proof_pic'] ?? '')) ?: null
                );
                $application['enrollment_details_id'] = $created['enrollment_details_id'];
                $this->conn->prepare("UPDATE enrollment_application_payments
                    SET payment_status = 'received', reviewed_by = ?, reviewed_at = NOW()
                    WHERE application_payment_id = ?")
                    ->execute([$admin['employee_id'], (int)$applicationPayment['application_payment_id']]);
            } elseif ($decision === 'reject' && $applicationPayment) {
                $this->conn->prepare("UPDATE enrollment_application_payments
                    SET payment_status = 'declined', reviewed_by = ?, reviewed_at = NOW()
                    WHERE application_payment_id = ?")
                    ->execute([$admin['employee_id'], (int)$applicationPayment['application_payment_id']]);
            }
            $stmt = $this->conn->prepare('UPDATE enrollment_applications SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_notes = ? WHERE application_id = ?');
            $stmt->execute([$status, $admin['employee_id'], $notes, $applicationId]);
            if ($decision === 'approve' && $isSubmittedGcash) {
                $this->conn->prepare('UPDATE enrollment_applications SET enrollment_details_id = ? WHERE application_id = ?')
                    ->execute([(int)$application['enrollment_details_id'], $applicationId]);
            }
            $this->conn->commit();

            if ($decision === 'reject') {
                $rejectionEmail = $this->buildApplicationEmail([
                    'preheader' => "There is an update for application {$application['application_number']}.",
                    'eyebrow' => 'APPLICATION UPDATE',
                    'title' => 'Your application was not approved',
                    'subtitle' => "Application {$application['application_number']}",
                    'greeting' => 'Hello ' . trim((string)$application['first_name']) . ',',
                    'messages' => [
                        'The center reviewed your online enrollment application, but it cannot proceed at this time.',
                        'Please contact your selected center if you need clarification or would like help with the next steps.'
                    ],
                    'notice' => 'Center notes: ' . ($notes ?: 'No additional notes were provided.'),
                    'details' => [
                        'Application number' => $application['application_number'],
                        'Program' => $application['program_name'],
                        'Center' => $application['branch_name'],
                        'Status' => 'Not approved'
                    ],
                    'security' => 'Do not reply with passwords, verification codes, or other private account information.'
                ]);
                $rejectionPlainText = "Your enrollment application {$application['application_number']} was not approved. " .
                    "Please contact the selected center for assistance.\n\nNotes: " . ($notes ?: 'None');
                $this->sendEmail(
                    $application['email'],
                    "Application {$application['application_number']} updated",
                    $rejectionEmail,
                    $rejectionPlainText
                );
            }
            $message = $decision === 'reject'
                ? 'Application rejected.'
                : ($isSubmittedGcash
                    ? 'Application and GCash payment approved. Continue to teacher or class assignment.'
                    : 'Application approved for center cash payment.');
            $this->respond('success', $message, [
                'status_code' => $status,
                'payment_confirmed' => $decision === 'approve' && $isSubmittedGcash,
                'enrollment_details_id' => $application['enrollment_details_id'] ?? null
            ]);
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            $this->respond('error', $e->getMessage(), [], 422);
        }
    }

    private function isPreschool(array $program): bool
    {
        $name = strtolower(trim(
            (string)($program['name'] ?? $program['program_name'] ?? '') . ' ' .
            (string)($program['program_type_name'] ?? '') . ' ' .
            (!is_numeric($program['program_type'] ?? null) ? (string)($program['program_type'] ?? '') : '')
        ));
        return str_contains($name, 'preschool') || str_contains($name, 'pre school') || str_contains($name, 'pre-school')
            || str_contains($name, 'playschool') || str_contains($name, 'play school') || str_contains($name, 'play-school');
    }

    private function selectedServiceIdForEnrollment(int $detailsId): ?int
    {
        if ($detailsId <= 0) return null;
        $stmt = $this->conn->prepare("SELECT s.service_id
            FROM enrollment_details ed
            JOIN service s ON s.service_name = ed.services
            WHERE ed.enrollment_details_id = ?
            LIMIT 1");
        $stmt->execute([$detailsId]);
        $serviceId = (int)$stmt->fetchColumn();
        return $serviceId > 0 ? $serviceId : null;
    }

    private function financialSnapshot(int $programId, ?int $requestedServiceId = null, ?int $branchId = null): array
    {
        $stmt = $this->conn->prepare('SELECT p.*, pt.type AS program_type_name, s.service_name AS default_service_name,
                s.amount AS default_service_amount, s.status AS default_service_status
            FROM program p
            LEFT JOIN program_type pt ON pt.program_type_id = p.program_type
            LEFT JOIN service s ON s.service_id = p.service_id
            WHERE p.program_id = ? LIMIT 1');
        $stmt->execute([$programId]);
        $program = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$program) throw new RuntimeException('Program was not found.');
        $tuition = max(0, (float)$program['tuition']);
        $units = max(1, (int)$program['total_units']);
        $misc = 0.0;
        $isPreschool = $this->isPreschool($program);
        $tuitionOnlySubtotal = $isPreschool ? $tuition * $units : $tuition;
        $products = [];
        if ($isPreschool) {
            $miscStmt = $this->conn->prepare('SELECT pr.product_id, pr.name AS product_name, pr.price
                FROM program_products pp
                JOIN product pr ON pr.product_id = pp.product_id
                WHERE pp.program_id = ? ORDER BY pr.name');
            $miscStmt->execute([$programId]);
            $products = $miscStmt->fetchAll(PDO::FETCH_ASSOC);
            $misc = array_reduce($products, fn($sum, $product) => $sum + max(0, (float)$product['price']), 0.0);
        }

        $availableService = null;
        $programServiceId = (int)($program['service_id'] ?? 0);
        if ($isPreschool && $programServiceId > 0 && strtolower((string)($program['default_service_status'] ?? '')) === 'active') {
            $offeredAtBranch = true;
            if (($branchId ?? 0) > 0) {
                $branchService = $this->conn->prepare('SELECT 1 FROM branch_services WHERE branch_id = ? AND service_id = ? LIMIT 1');
                $branchService->execute([$branchId, $programServiceId]);
                $offeredAtBranch = (bool)$branchService->fetchColumn();
            }
            if ($offeredAtBranch) {
                $availableService = [
                    'service_id' => $programServiceId,
                    'service_name' => (string)$program['default_service_name'],
                    'amount' => max(0, (float)$program['default_service_amount'])
                ];
            }
        }
        if (($requestedServiceId ?? 0) > 0 && (!$availableService || (int)$availableService['service_id'] !== $requestedServiceId)) {
            throw new InvalidArgumentException('The selected service is not active or is not offered for this program and center.');
        }
        $selectedService = ($requestedServiceId ?? 0) > 0 ? $availableService : null;
        $serviceMonthlyAmount = max(0, (float)($selectedService['amount'] ?? 0));
        $serviceTotal = $isPreschool ? $serviceMonthlyAmount * $units : 0.0;
        $tuitionSubtotal = $tuitionOnlySubtotal + $serviceTotal;
        $discountAmount = 0.0;
        $discountName = null;
        $discountId = !empty($program['default_discount_id']) ? (int)$program['default_discount_id'] : null;
        if ($discountId) {
            $discountStmt = $this->conn->prepare('SELECT * FROM discount WHERE discount_id = ? LIMIT 1');
            $discountStmt->execute([$discountId]);
            $discount = $discountStmt->fetch(PDO::FETCH_ASSOC);
            if ($discount) {
                $discountName = $discount['discount_name'] ?? null;
                $value = (float)($discount['discount_value'] ?? $discount['price'] ?? 0);
                $type = strtolower((string)($discount['discount_type'] ?? 'fixed'));
                $base = $tuitionSubtotal + $misc;
                $discountAmount = $type === 'percentage' ? $base * ($value / 100) : ($type === 'full_waiver' ? $base : $value);
                $discountAmount = min(max(0, $discountAmount), $base);
            }
        }
        $registration = max(0, (float)$program['registration_fee']);
        $downpayment = max(0, (float)$program['downpayment']);
        $totalAfterDiscount = max(0, $tuitionSubtotal + $misc - $discountAmount);
        $grandTotal = $totalAfterDiscount + $registration;
        $initial = min($grandTotal, $registration + $downpayment);
        return [
            'program' => $program, 'tuition_amount' => $tuition, 'tuition_subtotal' => $tuitionSubtotal,
            'tuition_only_subtotal' => $tuitionOnlySubtotal, 'misc_amount' => $misc, 'other_fees' => $products,
            'available_service' => $availableService, 'service_id' => $selectedService['service_id'] ?? null,
            'service_name' => $selectedService['service_name'] ?? null, 'service_amount' => $serviceMonthlyAmount,
            'service_total' => $serviceTotal, 'total_units' => $units,
            'discount_id' => $discountId, 'discount_name' => $discountName, 'discount_amount' => $discountAmount,
            'registration_fee' => $registration, 'downpayment_amount' => $downpayment,
            'total_after_discount' => $totalAfterDiscount, 'grand_total' => $grandTotal,
            'initial_payment' => $initial
        ];
    }

    private function applicationFinancialSnapshot(array $application): array
    {
        $stored = loadApplicationFinancialSnapshot(
            $this->conn,
            (int)($application['application_id'] ?? 0),
            (int)$application['program_id']
        );
        if ($stored) return $stored;
        $snapshot = $this->financialSnapshot(
            (int)$application['program_id'],
            !empty($application['requested_service_id']) ? (int)$application['requested_service_id'] : null,
            (int)($application['branch_id'] ?? 0) ?: null
        );
        if (!empty($application['application_id'])) {
            saveApplicationFinancialSnapshot($this->conn, (int)$application['application_id'], $snapshot);
        }
        return $snapshot;
    }

    public function getFinancialPreview(array $data): void
    {
        try {
            $programId = (int)($data['program_id'] ?? 0);
            if ($programId <= 0) throw new InvalidArgumentException('Select a program to view its billing details.');
            $serviceId = !empty($data['include_service']) ? (int)($data['service_id'] ?? 0) : null;
            $branchId = (int)($data['branch_id'] ?? 0) ?: null;
            $this->respond('success', '', ['data' => $this->financialSnapshot($programId, $serviceId, $branchId)]);
        } catch (Throwable $e) {
            $this->respond('error', $e->getMessage(), [], 422);
        }
    }

    private function generateReceiptId(): int
    {
        $prefix = date('ymd');
        $min = (int)($prefix . '000');
        $max = (int)($prefix . '999');
        $stmt = $this->conn->prepare('SELECT MAX(receipt_id) FROM payment WHERE receipt_id BETWEEN ? AND ?');
        $stmt->execute([$min, $max]);
        $next = (int)($stmt->fetchColumn() ?: $min) + 1;
        if ($next > $max) throw new RuntimeException('Receipt number limit reached for today.');
        return $next;
    }

    private function insertBill(int $detailsId, string $type, float $amount, ?string $dueDate, string $status = 'unpaid'): int
    {
        $stmt = $this->conn->prepare('INSERT INTO billing_schedule (enrollment_details_id, due_date, original_amount, penalty_amount, total_amount, status, billing_type) VALUES (?, ?, ?, 0, ?, ?, ?)');
        $stmt->execute([$detailsId, $dueDate, $amount, $amount, $status, $type]);
        return (int)$this->conn->lastInsertId();
    }

    private function createPaidApplicationEnrollment(
        array $application,
        array $snapshot,
        int $methodId,
        ?string $reference,
        float $amount,
        int $employeeId,
        ?string $proofPath = null
    ): array {
        $expected = round((float)$snapshot['initial_payment'], 2);
        if (abs($amount - $expected) > 0.01) {
            throw new InvalidArgumentException('Payment must equal the required registration fee and downpayment of PHP ' . number_format($expected, 2) . '.');
        }

        $header = $this->conn->prepare("INSERT INTO enrollment_header (student_id, employee_id, branch_id, school_year_id, status, total_of_program, date_created) VALUES (?, ?, ?, ?, 'incomplete', ?, NOW())");
        $header->execute([(int)$application['student_id'], $employeeId, (int)$application['branch_id'], (int)$application['school_year_id'], $snapshot['grand_total']]);
        $headerId = (int)$this->conn->lastInsertId();
        $preferred = implode(', ', array_map(fn($slot) => $slot['day'] . ' ' . $slot['start_time'] . '-' . $slot['end_time'], $application['availability']));
        $primarySubject = (int)($application['subjects'][0]['subject_id'] ?? 0) ?: null;
        $details = $this->conn->prepare("INSERT INTO enrollment_details
            (enrollment_header_id, program_id, grade_level_id, subject_id, preferred_teacher, goal, preferred_time_day,
             discount_id, discount_name, discount_amount, registration_fee, downpayment_amount, services, status)
            VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')");
        $details->execute([
            $headerId, (int)$application['program_id'], $application['grade_level_id'] ?: null, $primarySubject,
            $application['goal'] ?: null, $preferred, $snapshot['discount_id'], $snapshot['discount_name'],
            $snapshot['discount_amount'], $snapshot['registration_fee'], $snapshot['downpayment_amount'],
            $snapshot['service_name']
        ]);
        $detailsId = (int)$this->conn->lastInsertId();
        ensureEnrollmentServiceSubscription($this->conn, $detailsId, $snapshot, $employeeId);
        ensureEnrollmentBundleOrders(
            $this->conn,
            $detailsId,
            !empty($application['application_id']) ? (int)$application['application_id'] : null,
            $snapshot,
            $employeeId
        );
        if ($application['subjects']) {
            $subjectInsert = $this->conn->prepare('INSERT INTO enrollment_subjects (enrollment_details_id, subject_id) VALUES (?, ?)');
            foreach ($application['subjects'] as $subject) {
                $subjectInsert->execute([$detailsId, (int)$subject['subject_id']]);
            }
        }

        $bills = [];
        $registrationBillAmount = min((float)$snapshot['registration_fee'], (float)$snapshot['grand_total']);
        $downpaymentBillAmount = min((float)$snapshot['downpayment_amount'], max(0, (float)$snapshot['grand_total'] - $registrationBillAmount));
        if ($registrationBillAmount > 0) {
            $billId = $this->insertBill($detailsId, 'Registration Fee', $registrationBillAmount, date('Y-m-d'));
            insertBillingScheduleItem($this->conn, $billId, 'registration', null, 'Registration Fee', 1, $registrationBillAmount, $registrationBillAmount, false);
            $bills[] = [$billId, 'Registration Fee', $registrationBillAmount];
        }
        if ($downpaymentBillAmount > 0) {
            $billId = $this->insertBill($detailsId, 'Downpayment', $downpaymentBillAmount, date('Y-m-d'));
            insertBillingScheduleItem($this->conn, $billId, 'downpayment', null, 'Downpayment', 1, $downpaymentBillAmount, $downpaymentBillAmount, false);
            $bills[] = [$billId, 'Downpayment', $downpaymentBillAmount];
        }

        $receiptId = $expected > 0 ? $this->generateReceiptId() : null;
        $remaining = $amount;
        $balance = (float)$snapshot['grand_total'];
        $lineItems = [];
        $hasProofColumn = $this->columnExists('payment', 'proof_pic');
        foreach ($bills as [$billId, $label, $due]) {
            $paid = min($remaining, (float)$due);
            if ($paid <= 0) continue;
            $remaining -= $paid;
            $balance = max(0, $balance - $paid);
            $columns = ['payment_method_id', 'billing_schedule_id', 'employee_id', 'payment_date', 'amount_paid', 'penalty_paid', 'payment_type', 'reference_no', 'balance', 'payment_status', 'receipt_id'];
            $values = [$methodId, $billId, $employeeId, $paid, $label, $reference, $balance, $receiptId];
            $placeholders = ['?', '?', '?', 'CURDATE()', '?', '0', '?', '?', '?', "'Received'", '?'];
            if ($hasProofColumn) {
                $columns[] = 'proof_pic';
                $placeholders[] = '?';
                $values[] = $proofPath;
            }
            $this->conn->prepare('INSERT INTO payment (' . implode(', ', $columns) . ') VALUES (' . implode(', ', $placeholders) . ')')->execute($values);
            $this->conn->prepare("UPDATE billing_schedule SET status = 'paid' WHERE billing_schedule_id = ?")->execute([$billId]);
            $lineItems[] = ['label' => $label, 'amount' => $paid];
        }

        return [
            'enrollment_details_id' => $detailsId,
            'receipt_id' => $receiptId,
            'amount_paid' => $amount,
            'balance' => $balance,
            'line_items' => $lineItems
        ];
    }

    public function collectDownpayment(array $data): void
    {
        try {
            $admin = $this->requireOperator();
            $applicationId = (int)($data['application_id'] ?? 0);
            $methodId = (int)($data['payment_method_id'] ?? 0);
            $reference = trim((string)($data['reference_no'] ?? '')) ?: null;
            $amount = round((float)($data['amount'] ?? 0), 2);
            if ($methodId <= 0) throw new InvalidArgumentException('Payment method is required.');

            $this->conn->beginTransaction();
            $application = $this->adminApplication($applicationId, $admin, true);
            if ($application['status'] !== 'approved_for_payment' || !empty($application['enrollment_details_id'])) {
                throw new RuntimeException('This application is not awaiting downpayment.');
            }
            $snapshot = $this->applicationFinancialSnapshot($application);
            $expected = round((float)$snapshot['initial_payment'], 2);
            if (abs($amount - $expected) > 0.01) {
                throw new InvalidArgumentException('Payment must equal the required registration fee and downpayment of PHP ' . number_format($expected, 2) . '.');
            }
            $method = $this->conn->prepare('SELECT payment_method FROM payment_method WHERE payment_method_id = ?');
            $method->execute([$methodId]);
            $methodName = (string)$method->fetchColumn();
            if ($methodName === '') throw new InvalidArgumentException('Payment method was not found.');
            if (stripos($methodName, 'gcash') !== false && !$reference) {
                throw new InvalidArgumentException('GCash reference number is required.');
            }

            $created = $this->createPaidApplicationEnrollment(
                $application,
                $snapshot,
                $methodId,
                $reference,
                $amount,
                $admin['employee_id']
            );
            $detailsId = $created['enrollment_details_id'];
            $this->conn->prepare("UPDATE enrollment_application_payments
                SET payment_method_id = ?, amount = ?, reference_no = ?, payment_status = 'received', reviewed_by = ?, reviewed_at = NOW()
                WHERE application_id = ?")
                ->execute([$methodId, $amount, $reference, $admin['employee_id'], $applicationId]);
            $this->conn->prepare("UPDATE enrollment_applications SET status = 'ready_for_scheduling', enrollment_details_id = ? WHERE application_id = ?")
                ->execute([$detailsId, $applicationId]);
            $this->conn->commit();

            $nextStep = $this->isPreschool($snapshot['program'])
                ? 'Continue to class and section assignment.'
                : 'Continue to teacher assignment and schedule plotting.';
            $this->respond('success', 'Downpayment recorded. ' . $nextStep, [
                'enrollment_details_id' => $detailsId, 'receipt_id' => $created['receipt_id'], 'amount_paid' => $amount,
                'balance' => $created['balance'], 'payment_method' => $methodName, 'reference_no' => $reference,
                'student_name' => trim($application['first_name'] . ' ' . $application['last_name']),
                'program_name' => $application['program_name'], 'line_items' => $created['line_items'],
                'financial' => $snapshot
            ]);
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            $this->respond('error', $e->getMessage(), [], 422);
        }
    }

    private function teacherWorkingSchedule(int $teacherId): array
    {
        $schedule = $this->conn->prepare("SELECT day_of_week, TIME_FORMAT(start_time, '%H:%i') start_time, TIME_FORMAT(end_time, '%H:%i') end_time FROM employee_schedule WHERE employee_id = ?");
        $schedule->execute([$teacherId]);
        return $schedule->fetchAll(PDO::FETCH_ASSOC);
    }

    private function teacherScheduleOverlaps(array $application, int $teacherId, ?array $workingSchedule = null): array
    {
        $workingSchedule ??= $this->teacherWorkingSchedule($teacherId);
        $overlaps = [];
        foreach ($workingSchedule as $teacherSlot) {
            foreach ($application['availability'] as $studentSlot) {
                if ($teacherSlot['day_of_week'] !== $studentSlot['day']) continue;
                $start = max($teacherSlot['start_time'], $studentSlot['start_time']);
                $end = min($teacherSlot['end_time'], $studentSlot['end_time']);
                if ($start < $end) {
                    $key = $studentSlot['day'] . '|' . $start . '|' . $end;
                    $overlaps[$key] = ['day' => $studentSlot['day'], 'start_time' => $start, 'end_time' => $end];
                }
            }
        }
        return array_values($overlaps);
    }

    private function manualTeacherCandidate(array $application, int $teacherId): array
    {
        $stmt = $this->conn->prepare("SELECT e.employee_id,
                TRIM(CONCAT_WS(' ', e.first_name, NULLIF(TRIM(COALESCE(e.middle_name,'')), ''), e.last_name)) AS teacher_name
            FROM employee e
            JOIN role r ON r.role_id = e.role_id AND r.role_name = 'teacher'
            WHERE e.employee_id = ? AND e.status = 'active' AND e.branch_id = ? LIMIT 1");
        $stmt->execute([$teacherId, (int)$application['branch_id']]);
        $teacher = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$teacher) return [];

        $program = $this->conn->prepare('SELECT 1 FROM program_teacher WHERE employee_id = ? AND program_id = ? LIMIT 1');
        $program->execute([$teacherId, (int)$application['program_id']]);
        $programAssigned = (bool)$program->fetchColumn();

        $assigned = $this->conn->prepare('SELECT s.subject_id, s.subject_name FROM subject_teacher st JOIN subject s ON s.subject_id = st.subject_id WHERE st.employee_id = ?');
        $assigned->execute([$teacherId]);
        $assignedSubjects = $assigned->fetchAll(PDO::FETCH_ASSOC);
        $assignedIds = array_map(fn($subject) => (int)$subject['subject_id'], $assignedSubjects);
        $requiredIds = array_map(fn($subject) => (int)$subject['subject_id'], $application['subjects']);
        $missingSubjects = array_values(array_map(
            fn($subject) => $subject['subject_name'],
            array_filter($application['subjects'], fn($subject) => !in_array((int)$subject['subject_id'], $assignedIds, true))
        ));

        $notes = [];
        if (!$programAssigned) $notes[] = 'program not assigned';
        if ($missingSubjects) $notes[] = 'missing subject assignment: ' . implode(', ', $missingSubjects);
        $workingSchedule = $this->teacherWorkingSchedule($teacherId);
        $matchingSlots = $this->teacherScheduleOverlaps($application, $teacherId, $workingSchedule);
        if (!$matchingSlots) $notes[] = 'no overlapping working schedule';

        return array_merge($teacher, [
            'program_assigned' => $programAssigned,
            'matched_subjects' => count(array_intersect($requiredIds, $assignedIds)),
            'required_subjects' => count($requiredIds),
            'missing_subjects' => $missingSubjects,
            'working_schedule' => $workingSchedule,
            'matching_slots' => $matchingSlots,
            'qualification_note' => $notes ? implode('; ', $notes) : 'meets all automatic matching rules'
        ]);
    }

    private function teacherMatches(array $application, int $teacherId): array
    {
        $subjectIds = array_map(fn($subject) => (int)$subject['subject_id'], $application['subjects']);
        $subjectSql = '';
        $subjectParams = [];
        if ($subjectIds) {
            $placeholders = implode(',', array_fill(0, count($subjectIds), '?'));
            $subjectSql = " AND (SELECT COUNT(DISTINCT st.subject_id) FROM subject_teacher st WHERE st.employee_id = e.employee_id AND st.subject_id IN ({$placeholders})) = ?";
            $subjectParams = [...$subjectIds, count($subjectIds)];
        }
        $sql = "SELECT e.employee_id, TRIM(CONCAT_WS(' ', e.first_name, NULLIF(TRIM(COALESCE(e.middle_name,'')), ''), e.last_name)) AS teacher_name
            FROM employee e
            JOIN role r ON r.role_id = e.role_id AND r.role_name = 'teacher'
            JOIN program_teacher pt ON pt.employee_id = e.employee_id AND pt.program_id = ?
            WHERE e.employee_id = ? AND e.status = 'active' AND e.branch_id = ?
              {$subjectSql}
            LIMIT 1";
        $params = [(int)$application['program_id'], $teacherId, (int)$application['branch_id'], ...$subjectParams];
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        $teacher = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$teacher) return [];
        $workingSchedule = $this->teacherWorkingSchedule($teacherId);
        $overlaps = $this->teacherScheduleOverlaps($application, $teacherId, $workingSchedule);
        return $overlaps ? array_merge($teacher, ['working_schedule' => $workingSchedule, 'matching_slots' => $overlaps]) : [];
    }

    public function getMatchingTeachers(array $data): void
    {
        try {
            $admin = $this->requireAdmin();
            $application = $this->adminApplication((int)($data['application_id'] ?? 0), $admin);
            $stmt = $this->conn->prepare("SELECT e.employee_id FROM employee e JOIN role r ON r.role_id = e.role_id WHERE r.role_name = 'teacher' AND e.status = 'active' AND e.branch_id = ?");
            $stmt->execute([(int)$application['branch_id']]);
            $matches = [];
            foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $teacherId) {
                $match = $this->teacherMatches($application, (int)$teacherId);
                if ($match) $matches[] = $match;
            }
            $this->respond('success', '', ['data' => $matches]);
        } catch (Throwable $e) {
            $this->respond('error', $e->getMessage(), [], 422);
        }
    }

    public function getManualTeachers(array $data): void
    {
        try {
            $admin = $this->requireAdmin();
            $application = $this->adminApplication((int)($data['application_id'] ?? 0), $admin);
            $stmt = $this->conn->prepare("SELECT e.employee_id FROM employee e JOIN role r ON r.role_id = e.role_id
                WHERE r.role_name = 'teacher' AND e.status = 'active' AND e.branch_id = ? ORDER BY e.last_name, e.first_name");
            $stmt->execute([(int)$application['branch_id']]);
            $teachers = [];
            foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $teacherId) {
                $candidate = $this->manualTeacherCandidate($application, (int)$teacherId);
                if ($candidate) $teachers[] = $candidate;
            }
            $this->respond('success', '', ['data' => $teachers]);
        } catch (Throwable $e) {
            $this->respond('error', $e->getMessage(), [], 422);
        }
    }

    private function nextDayDate(string $day, int $weekOffset = 0): string
    {
        $date = new DateTime('today');
        if ($date->format('l') !== $day) $date->modify("next {$day}");
        if ($weekOffset > 0) $date->modify('+' . $weekOffset . ' weeks');
        return $date->format('Y-m-d');
    }

    public function getScheduleSuggestions(array $data): void
    {
        try {
            $admin = $this->requireAdmin();
            $application = $this->adminApplication((int)($data['application_id'] ?? 0), $admin);
            $teacherId = (int)($data['teacher_id'] ?? 0);
            $manualOverride = !empty($data['manual_override']);
            $match = $manualOverride
                ? $this->manualTeacherCandidate($application, $teacherId)
                : $this->teacherMatches($application, $teacherId);
            if (!$match) throw new RuntimeException($manualOverride
                ? 'The manually selected teacher must be an active teacher in the application branch.'
                : 'The selected teacher does not match the program, subjects, branch, and preferred availability.');
            if (empty($match['matching_slots'])) {
                throw new RuntimeException('The selected teacher has no working schedule that overlaps the student’s submitted availability. Update the teacher schedule before continuing.');
            }
            $isSessionProgram = strtolower((string)$application['unit_type']) === 'session';
            $programUnits = $isSessionProgram ? max(1, (int)$application['total_units']) : 1;
            $sessionsPerDay = $isSessionProgram ? (int)($data['sessions_per_day'] ?? 1) : 1;
            if ($sessionsPerDay < 1 || $sessionsPerDay > $programUnits) {
                throw new InvalidArgumentException("Hours on the same day must be a whole number from 1 to {$programUnits}.");
            }
            $bookings = $this->conn->prepare("SELECT eps.date, eps.start_time, eps.end_time FROM enrollment_preferred_schedule eps JOIN enrollment_details ed ON ed.enrollment_details_id = eps.enrollment_details_id WHERE ed.preferred_teacher = ? AND ed.status IN ('active','pending','enrolled')");
            $bookings->execute([$teacherId]);
            $busy = $bookings->fetchAll(PDO::FETCH_ASSOC);
            $suggestions = [];
            $scheduledDates = [];
            $slotCount = count($match['matching_slots']);
            $attempt = 0;
            $maxAttempts = 104 * $slotCount;
            while (count($suggestions) < $programUnits && $attempt < $maxAttempts) {
                $slot = $match['matching_slots'][$attempt % $slotCount];
                $weekOffset = intdiv($attempt, $slotCount);
                $date = $this->nextDayDate($slot['day'], $weekOffset);
                $attempt++;
                if (isset($scheduledDates[$date])) continue;

                $remainingUnits = $programUnits - count($suggestions);
                $batchSize = min($sessionsPerDay, $remainingUnits);
                $slotStart = strtotime($slot['start_time']);
                $slotEnd = strtotime($slot['end_time']);

                // Try every 30 minutes inside the overlap so an earlier booking does not
                // prevent a later one- or two-hour block from being suggested that day.
                for ($cursor = $slotStart; $cursor + ($batchSize * 3600) <= $slotEnd; $cursor += 1800) {
                    $batch = [];
                    $conflict = false;
                    for ($session = 0; $session < $batchSize; $session++) {
                        $startTs = $cursor + ($session * 3600);
                        $endTs = $startTs + 3600;
                        $start = date('H:i:s', $startTs);
                        $end = date('H:i:s', $endTs);
                        foreach ($busy as $booking) {
                            if ($booking['date'] === $date
                                && substr((string)$booking['start_time'], 0, 8) < $end
                                && substr((string)$booking['end_time'], 0, 8) > $start) {
                                $conflict = true;
                                break 2;
                            }
                        }
                        $batch[] = [
                            'date' => $date,
                            'day' => $slot['day'],
                            'start_time' => date('H:i', $startTs),
                            'end_time' => date('H:i', $endTs)
                        ];
                    }
                    if ($conflict) continue;

                    foreach ($batch as $row) {
                        $suggestions[] = $row;
                        $busy[] = [
                            'date' => $row['date'],
                            'start_time' => $row['start_time'] . ':00',
                            'end_time' => $row['end_time'] . ':00'
                        ];
                    }
                    $scheduledDates[$date] = true;
                    break;
                }
            }
            if (count($suggestions) < $programUnits) {
                $message = $sessionsPerDay > 1
                    ? "Not enough conflict-free {$sessionsPerDay}-hour blocks could be suggested for this teacher. Enter fewer hours per day or update the teacher/student availability."
                    : 'Not enough conflict-free sessions could be suggested for this teacher.';
                throw new RuntimeException($message);
            }
            $this->respond('success', '', [
                'data' => $suggestions,
                'teacher' => $match,
                'manual_override' => $manualOverride,
                'sessions_per_day' => $sessionsPerDay
            ]);
        } catch (Throwable $e) {
            $this->respond('error', $e->getMessage(), [], 422);
        }
    }

    private function scheduleRowValid(array $application, int $teacherId, array $row): bool
    {
        $date = trim((string)($row['date'] ?? ''));
        $start = trim((string)($row['start_time'] ?? ''));
        $end = trim((string)($row['end_time'] ?? ''));
        if (!$date || !$start || !$end || strtotime($end) <= strtotime($start)) return false;
        $day = date('l', strtotime($date));
        $withinStudent = false;
        foreach ($application['availability'] as $slot) {
            if ($slot['day'] === $day && $slot['start_time'] <= $start && $slot['end_time'] >= $end) $withinStudent = true;
        }
        if (!$withinStudent) return false;
        $teacher = $this->conn->prepare('SELECT 1 FROM employee_schedule WHERE employee_id = ? AND day_of_week = ? AND start_time <= ? AND end_time >= ? LIMIT 1');
        $teacher->execute([$teacherId, $day, $start, $end]);
        if (!$teacher->fetchColumn()) return false;
        $conflict = $this->conn->prepare("SELECT 1 FROM enrollment_preferred_schedule eps JOIN enrollment_details ed ON ed.enrollment_details_id = eps.enrollment_details_id WHERE ed.preferred_teacher = ? AND ed.status IN ('active','pending','enrolled') AND eps.date = ? AND eps.start_time < ? AND eps.end_time > ? LIMIT 1");
        $conflict->execute([$teacherId, $date, $end, $start]);
        return !$conflict->fetchColumn();
    }

    private function generateRemainingBills(int $detailsId, array $application, array $snapshot, array $schedule): void
    {
        $paidBase = (float)$snapshot['initial_payment'];
        $remaining = max(0, (float)$snapshot['grand_total'] - $paidBase);
        if ($remaining <= 0) return;
        if (strtolower((string)$application['unit_type']) === 'month' || $this->isPreschool($snapshot['program'])) {
            $months = max(1, (int)($snapshot['total_units'] ?? $application['total_units']));
            $base = floor(($remaining / $months) * 100) / 100;
            $allocated = 0.0;
            $firstDue = new DateTime('first day of next month');
            $firstDue->setDate((int)$firstDue->format('Y'), (int)$firstDue->format('m'), 17);
            for ($month = 1; $month <= $months; $month++) {
                $amount = $month === $months ? round($remaining - $allocated, 2) : $base;
                $due = clone $firstDue;
                if ($month > 1) $due->modify('+' . ($month - 1) . ' months');
                $billId = $this->insertBill($detailsId, 'Month ' . $month, $amount, $due->format('Y-m-d'));
                $servicePart = min($amount, max(0, (float)($snapshot['service_amount'] ?? 0)));
                $basePart = max(0, $amount - $servicePart);
                if ($basePart > 0) {
                    insertBillingScheduleItem($this->conn, $billId, 'tuition_balance', null,
                        'Tuition and enrollment balance', 1, $basePart, $basePart, true);
                }
                if ($servicePart > 0) {
                    insertBillingScheduleItem($this->conn, $billId, 'service',
                        !empty($snapshot['service_id']) ? (int)$snapshot['service_id'] : null,
                        (string)($snapshot['service_name'] ?? 'Service'), 1, $servicePart, $servicePart, true);
                }
                $allocated += $amount;
            }
            return;
        }
        $midterm = round($remaining / 2, 2);
        $final = round($remaining - $midterm, 2);
        $dates = array_column($schedule, 'date');
        sort($dates);
        $midDate = $dates ? $dates[max(0, (int)floor((count($dates) - 1) / 2))] : null;
        $finalDate = $dates ? end($dates) : null;
        if ($midterm > 0) {
            $billId = $this->insertBill($detailsId, 'Midterm', $midterm, $midDate);
            insertBillingScheduleItem($this->conn, $billId, 'tuition', null, 'Midterm', 1, $midterm, $midterm, true);
        }
        if ($final > 0) {
            $billId = $this->insertBill($detailsId, 'Final', $final, $finalDate);
            insertBillingScheduleItem($this->conn, $billId, 'tuition', null, 'Final', 1, $final, $final, true);
        }
    }

    private function activateStudentPortalAccount(array $application): array
    {
        $studentId = (int)($application['student_id'] ?? 0);
        if ($studentId <= 0) throw new RuntimeException('The application student record was not found.');

        // Match the credential convention used by manual admin enrollment.
        $firstName = trim((string)($application['first_name'] ?? ''));
        $lastName = trim((string)($application['last_name'] ?? ''));
        $baseUsername = strtolower((string)preg_replace('/[^A-Za-z0-9._-]/', '', $firstName . $lastName));
        if ($baseUsername === '') $baseUsername = 'student' . $studentId;
        $passwordName = (string)preg_replace('/\s+/', '', $firstName);
        if ($passwordName === '') $passwordName = 'Student';
        $temporaryPassword = $passwordName . '@123';

        $this->conn->prepare('DELETE FROM enrollment_application_usernames WHERE student_id = ?')->execute([$studentId]);
        $studentUsernameCheck = $this->conn->prepare('SELECT 1 FROM student WHERE LOWER(TRIM(username)) = LOWER(TRIM(?)) AND student_id <> ? LIMIT 1');
        $username = '';
        for ($suffix = 1; $suffix <= 9999; $suffix++) {
            $suffixText = $suffix === 1 ? '' : (string)$suffix;
            $candidate = substr($baseUsername, 0, max(1, 100 - strlen($suffixText))) . $suffixText;
            $studentUsernameCheck->execute([$candidate, $studentId]);
            if ($studentUsernameCheck->fetchColumn()) continue;

            try {
                $this->conn->prepare('INSERT INTO enrollment_application_usernames (username_key, student_id) VALUES (?, ?)')
                    ->execute([$this->normalizeText($candidate), $studentId]);
                $username = $candidate;
                break;
            } catch (PDOException $e) {
                if (($e->errorInfo[0] ?? '') !== '23000') throw $e;
            }
        }
        if ($username === '') throw new RuntimeException('A unique student username could not be generated.');

        $this->conn->prepare("UPDATE student SET username = ?, password_hash = ?, status = 'active' WHERE student_id = ?")
            ->execute([$username, password_hash($temporaryPassword, PASSWORD_DEFAULT), $studentId]);

        return ['username' => $username, 'password' => $temporaryPassword];
    }

    public function finalizeEnrollment(array $data): void
    {
        try {
            $admin = $this->requireOperator();
            $applicationId = (int)($data['application_id'] ?? 0);
            $teacherId = (int)($data['teacher_id'] ?? 0);
            $schedule = (array)($data['schedule'] ?? []);
            $manualOverride = !empty($data['manual_override']);
            if ($teacherId <= 0 || !$schedule) throw new InvalidArgumentException('Teacher and session schedule are required.');
            $this->conn->beginTransaction();
            $application = $this->adminApplication($applicationId, $admin, true);
            if ($application['status'] !== 'ready_for_scheduling' || empty($application['enrollment_details_id'])) {
                throw new RuntimeException('This application is not ready for schedule plotting.');
            }
            $selectedTeacher = $manualOverride
                ? $this->manualTeacherCandidate($application, $teacherId)
                : $this->teacherMatches($application, $teacherId);
            if (!$selectedTeacher) {
                throw new RuntimeException($manualOverride
                    ? 'The manually selected teacher is no longer active in this branch.'
                    : 'The selected teacher is no longer a valid automatic match.');
            }
            $isSessionProgram = strtolower((string)$application['unit_type']) === 'session';
            $required = $isSessionProgram ? max(1, (int)$application['total_units']) : 1;
            if (count($schedule) !== $required) throw new InvalidArgumentException("Exactly {$required} session schedule(s) are required for this program.");
            foreach ($schedule as $index => $row) {
                if ($isSessionProgram && strtotime((string)($row['end_time'] ?? '')) - strtotime((string)($row['start_time'] ?? '')) !== 3600) {
                    throw new InvalidArgumentException('Each program session must remain exactly one hour. Use two consecutive rows for a two-hour meeting day.');
                }
                if (!$this->scheduleRowValid($application, $teacherId, $row)) {
                    throw new RuntimeException('One or more sessions are outside the student/teacher availability or conflict with an existing booking.');
                }
                foreach (array_slice($schedule, 0, $index) as $earlierRow) {
                    if (($earlierRow['date'] ?? '') === ($row['date'] ?? '')
                        && ($earlierRow['start_time'] ?? '') < ($row['end_time'] ?? '')
                        && ($earlierRow['end_time'] ?? '') > ($row['start_time'] ?? '')) {
                        throw new InvalidArgumentException('Two submitted session rows overlap each other. Keep same-day sessions consecutive without overlapping.');
                    }
                }
            }
            $detailsId = (int)$application['enrollment_details_id'];
            $this->conn->prepare('DELETE FROM enrollment_preferred_schedule WHERE enrollment_details_id = ?')->execute([$detailsId]);
            $insert = $this->conn->prepare("INSERT INTO enrollment_preferred_schedule (enrollment_details_id, day, start_time, end_time, date, status, reschedule_reason) VALUES (?, ?, ?, ?, ?, 'pending', 'Initial enrollment schedule')");
            foreach ($schedule as $row) {
                $insert->execute([$detailsId, date('l', strtotime($row['date'])), $row['start_time'], $row['end_time'], $row['date']]);
            }
            $this->conn->prepare("UPDATE enrollment_details SET preferred_teacher = ?, status = 'enrolled' WHERE enrollment_details_id = ?")->execute([$teacherId, $detailsId]);
            $this->conn->prepare("UPDATE enrollment_header eh JOIN enrollment_details ed ON ed.enrollment_header_id = eh.enrollment_header_id SET eh.status = 'enrolled' WHERE ed.enrollment_details_id = ?")->execute([$detailsId]);
            $snapshot = $this->applicationFinancialSnapshot($application);
            $this->generateRemainingBills($detailsId, $application, $snapshot, $schedule);
            $portalCredentials = $this->activateStudentPortalAccount($application);
            if ($manualOverride) {
                $auditNote = 'Manual teacher override used during schedule plotting: ' . $selectedTeacher['teacher_name'] . '.';
                $this->conn->prepare("UPDATE enrollment_applications
                    SET status = 'enrolled', review_notes = CONCAT_WS(CHAR(10), NULLIF(review_notes, ''), ?)
                    WHERE application_id = ?")->execute([$auditNote, $applicationId]);
            } else {
                $this->conn->prepare("UPDATE enrollment_applications SET status = 'enrolled' WHERE application_id = ?")->execute([$applicationId]);
            }
            $this->conn->commit();
            $billing = $this->billingData($detailsId);
            $loginUrl = $this->applicationUrl('login.html');
            $completedEmail = $this->buildApplicationEmail([
                'preheader' => "Enrollment {$application['application_number']} is complete.",
                'eyebrow' => 'ENROLLMENT CONFIRMED',
                'title' => 'Your enrollment is complete',
                'subtitle' => "Application {$application['application_number']}",
                'greeting' => 'Congratulations, ' . trim((string)$application['first_name']) . '!',
                'messages' => [
                    'Your teacher and exact sessions have been confirmed. Your enrollment is now complete.',
                    'The system has created the student portal account. Use the temporary credentials below to view the schedule, sessions, and billing statement.'
                ],
                'notice' => 'You are officially enrolled in ' . $application['program_name'] . '.',
                'details' => [
                    'Student ID' => $application['student_id_number'],
                    'Program' => $application['program_name'],
                    'Center' => $application['branch_name'],
                    'Teacher' => $selectedTeacher['teacher_name'],
                    'Status' => 'Enrolled'
                ],
                'credentials' => [
                    'Username' => $portalCredentials['username'],
                    'Temporary Password' => $portalCredentials['password']
                ],
                'button_label' => 'Log in to your account',
                'button_url' => $loginUrl,
                'security' => 'The temporary password is case-sensitive. Sign in and change it as soon as possible. Never share your credentials or verification codes.'
            ]);
            $completedPlainText = "Congratulations, {$application['first_name']}! Your enrollment is complete. " .
                "Teacher: {$selectedTeacher['teacher_name']}. Username: {$portalCredentials['username']}. " .
                "Temporary password: {$portalCredentials['password']}. Please change this password after signing in.";
            $emailSent = $this->sendEmail(
                $application['email'],
                "Enrollment {$application['application_number']} completed",
                $completedEmail,
                $completedPlainText
            );
            $message = $emailSent
                ? 'Enrollment completed. Student portal credentials were emailed successfully.'
                : 'Enrollment completed, but the student portal credential email could not be sent.';
            $this->respond('success', $message, ['enrollment_details_id' => $detailsId, 'billing' => $billing, 'email_sent' => $emailSent]);
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            $this->respond('error', $e->getMessage(), [], 422);
        }
    }

    public function finalizePreschoolEnrollment(array $data): void
    {
        try {
            $admin = $this->requireOperator();
            $applicationId = (int)($data['application_id'] ?? 0);
            $detailsId = (int)($data['enrollment_details_id'] ?? 0);
            $classId = (int)($data['class_id'] ?? 0);
            $sectionId = (int)($data['section_id'] ?? 0);
            if ($applicationId <= 0 || $detailsId <= 0 || $classId <= 0 || $sectionId <= 0) {
                throw new InvalidArgumentException('Application, enrollment, class, and section are required.');
            }

            $this->conn->beginTransaction();
            $application = $this->adminApplication($applicationId, $admin, true);
            if ($application['status'] !== 'ready_for_scheduling'
                || (int)($application['enrollment_details_id'] ?? 0) !== $detailsId) {
                throw new RuntimeException('This application is not ready for class and section assignment.');
            }

            $snapshot = $this->applicationFinancialSnapshot($application);
            if (!$this->isPreschool($snapshot['program'])) {
                throw new RuntimeException('Class and section assignment is only available for Pre and Play School applications.');
            }

            $sectionStmt = $this->conn->prepare("SELECT sec.section_id, sec.class_id, sec.employee_id, sec.section_name,
                    sec.status AS section_status, sec.`max` AS max_capacity,
                    c.program_id, c.branch_id, c.status AS class_status,
                    TRIM(CONCAT_WS(' ', e.first_name, e.last_name)) AS teacher_name,
                    (SELECT GROUP_CONCAT(CONCAT(ss.day_of_week, ' ', TIME_FORMAT(ss.start_time, '%h:%i %p'), ' - ', TIME_FORMAT(ss.end_time, '%h:%i %p')) ORDER BY FIELD(ss.day_of_week, 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') SEPARATOR ', ')
                     FROM section_schedules ss WHERE ss.section_id = sec.section_id) AS section_schedule
                FROM sections sec
                JOIN class c ON c.class_id = sec.class_id
                LEFT JOIN employee e ON e.employee_id = sec.employee_id
                WHERE sec.section_id = ?
                LIMIT 1 FOR UPDATE");
            $sectionStmt->execute([$sectionId]);
            $section = $sectionStmt->fetch(PDO::FETCH_ASSOC);
            if (!$section) throw new RuntimeException('The selected section was not found.');
            if ((int)$section['class_id'] !== $classId) {
                throw new RuntimeException('The selected section does not belong to the selected class.');
            }
            if ((int)$section['program_id'] !== (int)$application['program_id']) {
                throw new RuntimeException('The selected class is not for this preschool program.');
            }
            if ((int)$section['branch_id'] !== (int)$application['branch_id']) {
                throw new RuntimeException('The selected class is not assigned to the application center.');
            }
            if (!in_array(strtolower(trim((string)$section['class_status'])), ['', 'open', 'active'], true)
                || !in_array(strtolower(trim((string)$section['section_status'])), ['', 'open', 'active'], true)) {
                throw new RuntimeException('The selected class or section is not open for enrollment.');
            }

            $countStmt = $this->conn->prepare("SELECT COUNT(*)
                FROM enrollment_details ed
                JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
                WHERE ed.section_id = ? AND COALESCE(NULLIF(eh.status, ''), ed.status) = 'enrolled'");
            $countStmt->execute([$sectionId]);
            $currentCount = (int)$countStmt->fetchColumn();
            $maxCapacity = (int)($section['max_capacity'] ?? 0);
            if ($maxCapacity > 0 && $currentCount >= $maxCapacity) {
                throw new RuntimeException('The selected section is already full. Choose another section.');
            }

            // This schema derives the class through sections.class_id; enrollment_details
            // stores only the selected section.
            $this->conn->prepare("UPDATE enrollment_details
                    SET section_id = ?, preferred_teacher = ?, preferred_time_day = ?, status = 'enrolled'
                    WHERE enrollment_details_id = ?")
                ->execute([$sectionId, $section['employee_id'] ?: null, $section['section_schedule'] ?: null, $detailsId]);
            $this->conn->prepare("UPDATE enrollment_header eh
                    JOIN enrollment_details ed ON ed.enrollment_header_id = eh.enrollment_header_id
                    SET eh.status = 'enrolled'
                    WHERE ed.enrollment_details_id = ?")
                ->execute([$detailsId]);

            $this->generateRemainingBills($detailsId, $application, $snapshot, []);
            $portalCredentials = $this->activateStudentPortalAccount($application);
            $this->conn->prepare("UPDATE enrollment_applications SET status = 'enrolled' WHERE application_id = ?")
                ->execute([$applicationId]);

            $newCount = $currentCount + 1;
            if ($maxCapacity > 0 && $newCount >= $maxCapacity) {
                $this->conn->prepare("UPDATE sections SET status = 'full' WHERE section_id = ?")->execute([$sectionId]);
            }

            $this->conn->commit();

            $loginUrl = $this->applicationUrl('login.html');
            $completedEmail = $this->buildApplicationEmail([
                'preheader' => "Enrollment {$application['application_number']} is complete.",
                'eyebrow' => 'ENROLLMENT CONFIRMED',
                'title' => 'Your enrollment is complete',
                'subtitle' => "Application {$application['application_number']}",
                'greeting' => 'Congratulations, ' . trim((string)$application['first_name']) . '!',
                'messages' => [
                    'Your class and section have been confirmed. Your Pre and Play School enrollment is now complete.',
                    'The system has created the student portal account. Use the temporary credentials below to view the enrollment and billing statement.'
                ],
                'notice' => 'You are officially enrolled in ' . $application['program_name'] . '.',
                'details' => [
                    'Student ID' => $application['student_id_number'],
                    'Program' => $application['program_name'],
                    'Center' => $application['branch_name'],
                    'Class' => 'Class ' . $classId,
                    'Section' => $section['section_name'],
                    'Section Teacher' => $section['teacher_name'] ?: 'To be announced',
                    'Section Schedule' => $section['section_schedule'] ?: 'To be announced',
                    'Status' => 'Enrolled'
                ],
                'credentials' => [
                    'Username' => $portalCredentials['username'],
                    'Temporary Password' => $portalCredentials['password']
                ],
                'button_label' => 'Log in to your account',
                'button_url' => $loginUrl,
                'security' => 'The temporary password is case-sensitive. Sign in and change it as soon as possible. Never share your credentials or verification codes.'
            ]);
            $completedPlainText = "Congratulations, {$application['first_name']}! Your Pre and Play School enrollment is complete. " .
                "Section: {$section['section_name']}. Username: {$portalCredentials['username']}. " .
                "Temporary password: {$portalCredentials['password']}. Please change this password after signing in.";
            $emailSent = $this->sendEmail(
                $application['email'],
                "Enrollment {$application['application_number']} completed",
                $completedEmail,
                $completedPlainText
            );

            $message = $emailSent
                ? 'Class and section assigned. Student portal credentials were emailed successfully.'
                : 'Preschool enrollment completed, but the student portal credential email could not be sent.';
            $this->respond('success', $message, [
                'enrollment_details_id' => $detailsId,
                'billing' => $this->billingData($detailsId),
                'email_sent' => $emailSent
            ]);
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            $this->respond('error', $e->getMessage(), [], 422);
        }
    }

    private function billingData(int $detailsId): array
    {
        $summary = $this->conn->prepare("SELECT ed.enrollment_details_id, eh.total_of_program, p.name program_name,
            TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) student_name,
            TRIM(CONCAT_WS(' ', t.first_name, t.last_name)) teacher_name, b.branch_name
            FROM enrollment_details ed JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
            JOIN student s ON s.student_id = eh.student_id JOIN program p ON p.program_id = ed.program_id
            LEFT JOIN employee t ON t.employee_id = ed.preferred_teacher LEFT JOIN branch b ON b.branch_id = eh.branch_id
            WHERE ed.enrollment_details_id = ? LIMIT 1");
        $summary->execute([$detailsId]);
        $data = $summary->fetch(PDO::FETCH_ASSOC) ?: [];
        $bills = $this->conn->prepare("SELECT bs.billing_schedule_id, bs.billing_type, bs.due_date, bs.total_amount,
            COALESCE(SUM(CASE WHEN pay.payment_status != 'Declined' THEN pay.amount_paid ELSE 0 END), 0) paid_amount,
            GREATEST(bs.total_amount - COALESCE(SUM(CASE WHEN pay.payment_status != 'Declined' THEN pay.amount_paid ELSE 0 END), 0), 0) balance,
            bs.status FROM billing_schedule bs LEFT JOIN payment pay ON pay.billing_schedule_id = bs.billing_schedule_id
            WHERE bs.enrollment_details_id = ? GROUP BY bs.billing_schedule_id ORDER BY bs.billing_schedule_id");
        $bills->execute([$detailsId]);
        $data['schedule'] = $bills->fetchAll(PDO::FETCH_ASSOC);
        $data['total_paid'] = array_sum(array_map(fn($bill) => (float)$bill['paid_amount'], $data['schedule']));
        $data['balance'] = max(0, (float)($data['total_of_program'] ?? 0) - $data['total_paid']);
        return $data;
    }

    private function publicPaymentReceipt(int $detailsId): ?array
    {
        $stmt = $this->conn->prepare("SELECT p.payment_id, p.receipt_id, p.payment_date, p.amount_paid, p.balance,
                p.payment_type, p.reference_no, p.payment_status, p.or_no, pm.payment_method, bs.billing_type
            FROM payment p
            JOIN payment_method pm ON pm.payment_method_id = p.payment_method_id
            JOIN billing_schedule bs ON bs.billing_schedule_id = p.billing_schedule_id
            WHERE bs.enrollment_details_id = ? AND p.payment_status = 'Received' AND p.receipt_id IS NOT NULL
            ORDER BY p.receipt_id DESC, p.payment_id ASC");
        $stmt->execute([$detailsId]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        if (!$rows) return null;

        $receiptId = (string)$rows[0]['receipt_id'];
        $receiptRows = array_values(array_filter($rows, fn($row) => (string)$row['receipt_id'] === $receiptId));
        $amountPaid = array_sum(array_map(fn($row) => (float)$row['amount_paid'], $receiptRows));
        $balances = array_map(fn($row) => (float)$row['balance'], $receiptRows);
        return [
            'receipt_id' => $receiptId,
            'payment_date' => $receiptRows[0]['payment_date'],
            'payment_method' => $receiptRows[0]['payment_method'],
            'reference_no' => $receiptRows[0]['reference_no'],
            'or_no' => $receiptRows[0]['or_no'],
            'amount_paid' => $amountPaid,
            'balance' => $balances ? min($balances) : 0,
            'payment_status' => $receiptRows[0]['payment_status'],
            'line_items' => array_map(fn($row) => [
                'label' => $row['billing_type'] ?: ($row['payment_type'] ?: 'Payment'),
                'amount' => (float)$row['amount_paid']
            ], $receiptRows)
        ];
    }

    public function getPaymentMethods(): void
    {
        try {
            $this->requireAdmin();
            $rows = $this->conn->query('SELECT payment_method_id, payment_method FROM payment_method ORDER BY payment_method_id')->fetchAll(PDO::FETCH_ASSOC);
            $this->respond('success', '', ['data' => $rows]);
        } catch (Throwable $e) {
            $this->respond('error', $e->getMessage(), [], 401);
        }
    }
}

$api = new EnrollmentApplicationAPI();
$operation = $_REQUEST['operation'] ?? '';
$data = $api->payload();

switch ($operation) {
    case 'getLookups': $api->getLookups(); break;
    case 'checkStudent': $api->checkStudent($data); break;
    case 'sendOtp': $api->sendOtp($data); break;
    case 'verifyOtp': $api->verifyOtp($data); break;
    case 'submitApplication': $api->submitApplication($data); break;
    case 'getPublicStatus': $api->getPublicStatus($data); break;
    case 'getFinancialPreview': $api->getFinancialPreview($data); break;
    case 'listApplications': $api->listApplications($data); break;
    case 'getApplication': $api->getApplication($data); break;
    case 'reviewApplication': $api->reviewApplication($data); break;
    case 'getPaymentMethods': $api->getPaymentMethods(); break;
    case 'collectDownpayment': $api->collectDownpayment($data); break;
    case 'getMatchingTeachers': $api->getMatchingTeachers($data); break;
    case 'getManualTeachers': $api->getManualTeachers($data); break;
    case 'getScheduleSuggestions': $api->getScheduleSuggestions($data); break;
    case 'finalizeEnrollment': $api->finalizeEnrollment($data); break;
    case 'finalizePreschoolEnrollment': $api->finalizePreschoolEnrollment($data); break;
    default: $api->respond('error', 'Invalid operation.', [], 400); break;
}
