<?php
require_once __DIR__ . '/email_service.php';
require_once __DIR__ . '/agreement_helper.php';
require_once __DIR__ . '/grade_level_helper.php';
require_once __DIR__ . '/guardian_relationship_helper.php';
require_once __DIR__ . '/billing_assessment_helper.php';
require_once __DIR__ . '/notification_helper.php';
require_once __DIR__ . '/tutorial_validity_helper.php';
require_once __DIR__ . '/schedule_suggestion_diagnostics.php';
require_once __DIR__ . '/security/PasswordExpiration.php';
require_once __DIR__ . '/security/AccountActivation.php';
require_once __DIR__ . '/security/AuthGuard.php';
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') AuthGuard::requireSameOrigin();
if (!in_array((string) ($_REQUEST['operation'] ?? ''), [
    'getLookups', 'startExistingStudentApplication', 'getExistingStudentApplicationState',
    'linkIncompleteEnrollmentApplication', 'submitExistingStudentApplicationDetails',
    'checkStudent', 'sendOtp', 'verifyOtp', 'submitApplication', 'getPublicStatus', 'getFinancialPreview'
], true)) AuthGuard::requireUser();

SessionBootstrap::start();
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
    private NotificationService $notifications;

    public function __construct()
    {
        include __DIR__ . '/admin/connection-pdo.php';
        $this->conn = $conn;
        ensureTutorialValiditySchema($this->conn);
        AccountActivation::ensureSchema($this->conn);
        $this->notifications = new NotificationService($this->conn);
        ensureGradeLevelSchema($this->conn);
        ensureGuardianRelationshipSchema($this->conn);
        $this->ensureApplicationPaymentSchema();
        ensureAgreementSchema($this->conn);
        $this->ensureRoleModulePermissionSchema();
        ensureBillingAssessmentSchema($this->conn);
    }

    private function ensureRoleModulePermissionSchema(): void
    {
        $this->conn->exec("CREATE TABLE IF NOT EXISTS role_module_permissions (
            permission_id INT AUTO_INCREMENT PRIMARY KEY,
            role_name VARCHAR(100) NOT NULL,
            module_key VARCHAR(100) NOT NULL,
            permissions_json LONGTEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_role_module (role_name, module_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");
    }

    private function ensureApplicationPaymentSchema(): void
    {
        if (!$this->columnExists('enrollment_applications', 'preferred_session_hours')) {
            $this->conn->exec('ALTER TABLE enrollment_applications ADD COLUMN preferred_session_hours DECIMAL(3,1) DEFAULT NULL');
        }
        if (!$this->columnExists('enrollment_applications', 'applicant_type')) {
            $this->conn->exec("ALTER TABLE enrollment_applications ADD COLUMN applicant_type VARCHAR(24) NOT NULL DEFAULT 'new_student' AFTER student_id");
        }
        if (!$this->columnExists('enrollment_applications', 'submission_stage')) {
            $this->conn->exec("ALTER TABLE enrollment_applications ADD COLUMN submission_stage VARCHAR(24) NOT NULL DEFAULT 'submitted' AFTER status");
            $this->conn->exec('ALTER TABLE enrollment_applications ADD INDEX idx_enrollment_application_stage (submission_stage)');
        }
        if (!$this->columnExists('enrollment_applications', 'preferred_teacher_id')) {
            $this->conn->exec('ALTER TABLE enrollment_applications ADD COLUMN preferred_teacher_id INT(11) DEFAULT NULL AFTER grade_level_id');
            $this->conn->exec('ALTER TABLE enrollment_applications ADD INDEX idx_enrollment_application_preferred_teacher (preferred_teacher_id)');
        }
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
            throw new InvalidArgumentException('Upload the payment receipt screenshot before submitting.');
        }
        if (($uploadedFile['size'] ?? 0) > 10 * 1024 * 1024) {
            throw new InvalidArgumentException('The payment receipt screenshot must not exceed 10MB.');
        }
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($uploadedFile['tmp_name']);
        $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/bmp' => 'bmp'];
        if (!isset($allowed[$mime])) {
            throw new InvalidArgumentException('The payment receipt must be a JPG, PNG, WEBP, or BMP image.');
        }
        $directory = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'payment_screenshots';
        if (!is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) {
            throw new RuntimeException('Unable to create the payment screenshot directory.');
        }
        $fileName = 'application_' . $applicationId . '_' . bin2hex(random_bytes(6)) . '.' . $allowed[$mime];
        if (!move_uploaded_file($uploadedFile['tmp_name'], $directory . DIRECTORY_SEPARATOR . $fileName)) {
            throw new RuntimeException('Unable to save the payment receipt screenshot.');
        }
        return 'uploads/payment_screenshots/' . $fileName;
    }

    private function removeStoredPaymentProof(?string $relativePath): void
    {
        if (!$relativePath || !str_starts_with($relativePath, 'uploads/payment_screenshots/')) return;
        $path = dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativePath);
        if (is_file($path)) @unlink($path);
    }

    private function rollbackPaymentProof(?string $relativePath): void
    {
        // A post-commit error must never delete a proof referenced by saved rows.
        if ($this->conn->inTransaction()) {
            $this->conn->rollBack();
            $this->removeStoredPaymentProof($relativePath);
        }
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
        $value = trim(preg_replace('/\s+/', ' ', (string)$value));
        return function_exists('mb_strtolower')
            ? mb_strtolower($value, 'UTF-8')
            : strtolower($value);
    }

    private function normalizeEmail($value): string
    {
        $value = trim((string)$value);
        return function_exists('mb_strtolower')
            ? mb_strtolower($value, 'UTF-8')
            : strtolower($value);
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

    private function requireStudent(): int
    {
        $role = $this->normalizeText($_SESSION['user_role'] ?? '');
        $studentId = (int)($_SESSION['user_id'] ?? 0);
        if ($role !== 'student' || $studentId <= 0) {
            throw new RuntimeException('Student login is required.', 401);
        }
        return $studentId;
    }

    private function onlineApplicationPermissions(array $admin): array
    {
        $operator = in_array($admin['role'], ['owner', 'secretary', 'branch admin'], true);
        $permissions = [
            'view_online_applications' => in_array($admin['role'], ['owner', 'secretary', 'branch admin', 'auditor'], true),
            'edit_online_applications' => $operator,
            'approve_online_applications' => $operator,
            'reject_online_applications' => $operator,
            'receive_online_application_payment' => $operator,
            'finalize_online_applications' => $operator
        ];

        $stmt = $this->conn->prepare("SELECT permissions_json
            FROM role_module_permissions
            WHERE role_name = ? AND module_key = 'enrollment'
            LIMIT 1");
        $stmt->execute([$admin['role']]);
        $stored = json_decode((string)($stmt->fetchColumn() ?: '{}'), true);
        if (is_array($stored)) {
            foreach ($permissions as $permissionKey => $defaultValue) {
                if (array_key_exists($permissionKey, $stored) && is_bool($stored[$permissionKey])) {
                    $permissions[$permissionKey] = $stored[$permissionKey];
                }
            }
        }

        return $permissions;
    }

    private function requireOnlineApplicationPermission(array $admin, string $permissionKey, string $message): void
    {
        $permissions = $this->onlineApplicationPermissions($admin);
        $canView = !empty($permissions['view_online_applications']);
        if (!$canView || empty($permissions[$permissionKey])) {
            throw new RuntimeException($message, 403);
        }
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
            $featuredLength = function_exists('mb_strlen')
                ? mb_strlen((string)$options['featured_value'], 'UTF-8')
                : strlen((string)$options['featured_value']);
            $featuredClass = $featuredLength > 12
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
        return (new EmailService($this->conn))->send($to, $subject, $message, [
            'from_name' => 'CDO Tutorial Center',
            'alt_body' => $plainText
        ]);
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
            $programs = $this->conn->query("SELECT p.program_id, p.name, p.discription, p.tuition, p.total_units, p.validity_days, p.unit_type,
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
            $relationships = $this->conn->query('SELECT relationship_id, relationship_name FROM guardian_relationships ORDER BY relationship_id')->fetchAll(PDO::FETCH_ASSOC);
            $paymentMethods = $this->conn->query("SELECT payment_method_id, payment_method, account_name, account_number, qr_code
                FROM payment_method
                WHERE status <> 'inactive'
                ORDER BY CASE WHEN LOWER(TRIM(payment_method)) = 'cash' THEN 0 ELSE 1 END, payment_method_id")->fetchAll(PDO::FETCH_ASSOC);
            $this->respond('success', '', [
                'data' => compact('programs', 'branches', 'grades', 'subjects', 'genders', 'relationships', 'paymentMethods', 'schoolYear')
            ]);
        } catch (Throwable $e) {
            $this->respond('error', $e->getMessage(), [], 500);
        }
    }

    private function existingStudentFinancialSnapshot(int $programId, int $branchId): array
    {
        $snapshot = $this->financialSnapshot($programId, null, $branchId);
        // Registration is charged when a student record is first created. A
        // logged-in existing student pays only the configured downpayment.
        $snapshot['registration_fee'] = 0.0;
        $snapshot['grand_total'] = (float)$snapshot['total_after_discount'];
        $snapshot['initial_payment'] = min(
            (float)$snapshot['grand_total'],
            max(0, (float)$snapshot['downpayment_amount'])
        );
        return $snapshot;
    }

    public function startExistingStudentApplication(array $data): void
    {
        $storedProofPath = null;
        try {
            $studentId = $this->requireStudent();
            $programId = (int)($data['program_id'] ?? 0);
            $branchId = (int)($data['branch_id'] ?? 0);
            $paymentMethodId = (int)($data['payment_method_id'] ?? 0);
            $reference = trim((string)($data['payment_reference_no'] ?? ''));
            $amount = round((float)($data['payment_amount'] ?? 0), 2);

            $programStmt = $this->conn->prepare("SELECT p.name, p.program_type, pt.type AS program_type_name
                FROM program p LEFT JOIN program_type pt ON pt.program_type_id = p.program_type
                WHERE p.program_id = ? AND p.status = 'active' LIMIT 1");
            $programStmt->execute([$programId]);
            $program = $programStmt->fetch(PDO::FETCH_ASSOC);
            $branchStmt = $this->conn->prepare("SELECT branch_name FROM branch WHERE branch_id = ? AND status = 'active' LIMIT 1");
            $branchStmt->execute([$branchId]);
            $branchName = $branchStmt->fetchColumn();
            if (!$program || !$branchName) {
                throw new InvalidArgumentException('Select an active tutorial program and center.');
            }
            $descriptor = strtolower((string)$program['name'] . ' ' . (string)$program['program_type_name']);
            if (!str_contains($descriptor, 'tutorial') && !in_array((int)$program['program_type'], [1, 2], true)) {
                throw new InvalidArgumentException('This student enrollment page currently accepts Tutorial programs only.');
            }

            $activeStmt = $this->conn->prepare("SELECT application_id FROM enrollment_applications
                WHERE student_id = ? AND applicant_type = 'existing_student'
                  AND status IN ('pending_review', 'approved_for_payment', 'ready_for_scheduling')
                ORDER BY application_id DESC LIMIT 1");
            $activeStmt->execute([$studentId]);
            if ($activeStmt->fetchColumn()) {
                throw new RuntimeException('You already have an online enrollment application in progress. Resume it instead.');
            }

            $methodStmt = $this->conn->prepare("SELECT payment_method FROM payment_method WHERE payment_method_id = ? AND status <> 'inactive' LIMIT 1");
            $methodStmt->execute([$paymentMethodId]);
            $methodName = trim((string)$methodStmt->fetchColumn());
            if (strtolower($methodName) !== 'gcash') {
                throw new InvalidArgumentException('GCash is required for the student portal payment-first flow.');
            }
            if (!preg_match('/^(?:\d{10}|\d{12}|\d{13})$/', $reference)) {
                throw new InvalidArgumentException('The GCash reference number must contain 10, 12, or 13 digits.');
            }
            if (empty($_FILES['payment_screenshot'])) {
                throw new InvalidArgumentException('Upload the GCash receipt screenshot before continuing.');
            }

            $snapshot = $this->existingStudentFinancialSnapshot($programId, $branchId);
            $expected = round((float)$snapshot['initial_payment'], 2);
            if ($expected <= 0 || !is_finite($amount) || $amount <= 0 || round($amount * 100) < round($expected * 100)) {
                throw new InvalidArgumentException('The GCash receipt amount must be at least the required downpayment of PHP ' . number_format($expected, 2) . '.');
            }

            $schoolYear = $this->activeSchoolYear();
            $this->conn->beginTransaction();
            $applicationNumber = $this->uniqueApplicationNumber();
            $trackingToken = bin2hex(random_bytes(32));
            $appStmt = $this->conn->prepare("INSERT INTO enrollment_applications
                (application_number, tracking_token_hash, student_id, applicant_type, program_id, branch_id,
                 school_year_id, grade_level_id, preferred_teacher_id, goal, status, submission_stage, email_verified_at)
                VALUES (?, ?, ?, 'existing_student', ?, ?, ?, NULL, NULL, NULL, 'pending_review', 'payment', NOW())");
            $appStmt->execute([
                $applicationNumber,
                hash('sha256', $trackingToken),
                $studentId,
                $programId,
                $branchId,
                (int)$schoolYear['school_year_id']
            ]);
            $applicationId = (int)$this->conn->lastInsertId();
            saveApplicationFinancialSnapshot($this->conn, $applicationId, $snapshot);
            $storedProofPath = $this->storeApplicationPaymentProof($_FILES['payment_screenshot'], $applicationId);

            $paymentStmt = $this->conn->prepare("INSERT INTO enrollment_application_payments
                (application_id, payment_method_id, amount, reference_no, proof_pic, payment_status)
                VALUES (?, ?, ?, ?, ?, 'pending_review')");
            $paymentStmt->execute([$applicationId, $paymentMethodId, $amount, $reference, $storedProofPath]);
            $this->conn->commit();

            $studentStmt = $this->conn->prepare("SELECT TRIM(CONCAT_WS(' ', first_name, last_name, NULLIF(TRIM(ext), ''))) FROM student WHERE student_id = ?");
            $studentStmt->execute([$studentId]);
            $this->respond('success', 'Payment saved. Continue with the enrollment details.', [
                'application_id' => $applicationId,
                'application_number' => $applicationNumber,
                'student_name' => $studentStmt->fetchColumn() ?: 'Student',
                'program_id' => $programId,
                'program_name' => $program['name'],
                'branch_id' => $branchId,
                'branch_name' => $branchName,
                'payment_method' => $methodName,
                'payment_amount' => $amount,
                'payment_reference_no' => $reference,
                'payment_screenshot_path' => $storedProofPath,
                'submission_stage' => 'payment'
            ]);
        } catch (Throwable $e) {
            $this->rollbackPaymentProof($storedProofPath);
            $this->respond('error', $e->getMessage(), [], $e->getCode() === 401 ? 401 : 422);
        }
    }

    public function getExistingStudentApplicationState(): void
    {
        try {
            $studentId = $this->requireStudent();
            $stmt = $this->conn->prepare($this->applicationBaseQuery() . "
                WHERE ea.student_id = ? AND ea.applicant_type = 'existing_student'
                  AND ea.status IN ('pending_review', 'approved_for_payment', 'ready_for_scheduling')
                ORDER BY ea.application_id DESC LIMIT 1");
            $stmt->execute([$studentId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            $this->respond('success', '', ['data' => $row ? $this->hydrateApplication($row) : null]);
        } catch (Throwable $e) {
            $this->respond('error', $e->getMessage(), [], $e->getCode() === 401 ? 401 : 422);
        }
    }

    public function linkIncompleteEnrollmentApplication(array $data): void
    {
        try {
            $studentId = $this->requireStudent();
            $detailsId = (int)($data['enrollment_details_id'] ?? 0);
            if ($detailsId <= 0) {
                throw new InvalidArgumentException('The incomplete enrollment is required.');
            }

            $this->conn->beginTransaction();
            $detailsStmt = $this->conn->prepare("SELECT ed.enrollment_details_id, ed.program_id,
                    COALESCE(NULLIF(eh.status, ''), ed.status) AS enrollment_status
                FROM enrollment_details ed
                INNER JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
                WHERE ed.enrollment_details_id = ? AND eh.student_id = ?
                LIMIT 1 FOR UPDATE");
            $detailsStmt->execute([$detailsId, $studentId]);
            $details = $detailsStmt->fetch(PDO::FETCH_ASSOC);
            if (!$details || strtolower((string)$details['enrollment_status']) !== 'incomplete') {
                throw new RuntimeException('This enrollment is not available for completion.');
            }

            $linkedStmt = $this->conn->prepare("SELECT application_id, branch_id
                FROM enrollment_applications
                WHERE enrollment_details_id = ? AND student_id = ? AND applicant_type = 'existing_student'
                  AND status IN ('pending_review', 'approved_for_payment', 'ready_for_scheduling')
                ORDER BY application_id DESC LIMIT 1 FOR UPDATE");
            $linkedStmt->execute([$detailsId, $studentId]);
            $application = $linkedStmt->fetch(PDO::FETCH_ASSOC);

            if (!$application) {
                $activeStmt = $this->conn->prepare("SELECT application_id, branch_id
                    FROM enrollment_applications
                    WHERE student_id = ? AND program_id = ? AND applicant_type = 'existing_student'
                      AND enrollment_details_id IS NULL
                      AND status IN ('pending_review', 'approved_for_payment', 'ready_for_scheduling')
                    ORDER BY application_id DESC LIMIT 1 FOR UPDATE");
                $activeStmt->execute([$studentId, (int)$details['program_id']]);
                $application = $activeStmt->fetch(PDO::FETCH_ASSOC);
                if (!$application) {
                    throw new RuntimeException('No matching new enrollment request is available for this incomplete record.');
                }

                $legacyPaymentStmt = $this->conn->prepare("SELECT pay.amount_paid, pay.reference_no
                    FROM payment pay
                    INNER JOIN billing_schedule bs ON bs.billing_schedule_id = pay.billing_schedule_id
                    WHERE bs.enrollment_details_id = ? AND pay.payment_status IN ('Pending', 'Received')
                    ORDER BY pay.payment_id DESC LIMIT 1");
                $legacyPaymentStmt->execute([$detailsId]);
                $legacyPayment = $legacyPaymentStmt->fetch(PDO::FETCH_ASSOC);
                $applicationPaymentStmt = $this->conn->prepare("SELECT amount, reference_no
                    FROM enrollment_application_payments WHERE application_id = ? LIMIT 1");
                $applicationPaymentStmt->execute([(int)$application['application_id']]);
                $applicationPayment = $applicationPaymentStmt->fetch(PDO::FETCH_ASSOC);
                if (!$legacyPayment || !$applicationPayment
                    || abs((float)$legacyPayment['amount_paid'] - (float)$applicationPayment['amount']) > 0.01) {
                    throw new RuntimeException('The saved payment does not match this new enrollment request.');
                }
                $legacyReference = trim((string)($legacyPayment['reference_no'] ?? ''));
                $applicationReference = trim((string)($applicationPayment['reference_no'] ?? ''));
                if ($legacyReference !== '' && $applicationReference !== '' && $legacyReference !== $applicationReference) {
                    throw new RuntimeException('The saved payment reference does not match this new enrollment request.');
                }

                $this->conn->prepare('UPDATE enrollment_applications SET enrollment_details_id = ? WHERE application_id = ?')
                    ->execute([$detailsId, (int)$application['application_id']]);
                $this->conn->prepare("UPDATE enrollment_header eh
                    INNER JOIN enrollment_details ed ON ed.enrollment_header_id = eh.enrollment_header_id
                    SET eh.branch_id = ? WHERE ed.enrollment_details_id = ?")
                    ->execute([(int)$application['branch_id'], $detailsId]);
            }

            $applicationId = (int)$application['application_id'];
            $this->conn->commit();
            $applicationStmt = $this->conn->prepare($this->applicationBaseQuery() . ' WHERE ea.application_id = ? LIMIT 1');
            $applicationStmt->execute([$applicationId]);
            $row = $applicationStmt->fetch(PDO::FETCH_ASSOC);
            $this->respond('success', 'Incomplete enrollment connected to the new enrollment request.', [
                'data' => $row ? $this->hydrateApplication($row) : null
            ]);
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            $this->respond('error', $e->getMessage(), [], $e->getCode() === 401 ? 401 : 422);
        }
    }

    public function submitExistingStudentApplicationDetails(array $data): void
    {
        try {
            $studentId = $this->requireStudent();
            $applicationId = (int)($data['application_id'] ?? 0);
            $gradeId = (int)($data['grade_level_id'] ?? 0);
            $subjectIds = array_values(array_unique(array_filter(array_map('intval', (array)($data['subject_ids'] ?? [])))));
            $availability = $this->validateAvailability((array)($data['availability'] ?? []));
            $preferredTeacherId = (int)($data['preferred_teacher_id'] ?? 0) ?: null;
            if ($gradeId <= 0 || !$subjectIds || !$availability) {
                throw new InvalidArgumentException('Grade level, at least one subject, and weekly availability are required.');
            }

            $this->conn->beginTransaction();
            $appStmt = $this->conn->prepare("SELECT ea.*, p.name AS program_name
                FROM enrollment_applications ea
                INNER JOIN program p ON p.program_id = ea.program_id
                WHERE ea.application_id = ? AND ea.student_id = ? AND ea.applicant_type = 'existing_student'
                LIMIT 1 FOR UPDATE");
            $appStmt->execute([$applicationId, $studentId]);
            $application = $appStmt->fetch(PDO::FETCH_ASSOC);
            if (!$application || $application['status'] !== 'pending_review' || $application['submission_stage'] !== 'payment') {
                throw new RuntimeException('This application is not waiting for enrollment details.');
            }

            saveAgreementAcceptances($this->conn, $applicationId, $studentId, (int)$application['program_id'], $data);


            $gradeStmt = $this->conn->prepare("SELECT 1 FROM grade_level WHERE grade_level_id = ? AND status = 'active'");
            $gradeStmt->execute([$gradeId]);
            if (!$gradeStmt->fetchColumn()) throw new InvalidArgumentException('The selected grade level is unavailable.');

            $subjectPlaceholders = implode(',', array_fill(0, count($subjectIds), '?'));
            $subjectStmt = $this->conn->prepare("SELECT COUNT(*) FROM subject WHERE subject_id IN ($subjectPlaceholders)");
            $subjectStmt->execute($subjectIds);
            if ((int)$subjectStmt->fetchColumn() !== count($subjectIds)) {
                throw new InvalidArgumentException('One or more selected subjects are unavailable.');
            }

            if ($preferredTeacherId) {
                $teacherStmt = $this->conn->prepare("SELECT 1 FROM employee e
                    INNER JOIN program_teacher pt ON pt.employee_id = e.employee_id AND pt.program_id = ?
                    WHERE e.employee_id = ? AND e.branch_id = ? AND e.status = 'active'
                      AND e.employee_id IN (
                          SELECT st.employee_id FROM subject_teacher st
                          WHERE st.subject_id IN ($subjectPlaceholders)
                          GROUP BY st.employee_id HAVING COUNT(DISTINCT st.subject_id) = ?
                      ) LIMIT 1");
                $teacherStmt->execute(array_merge(
                    [(int)$application['program_id'], $preferredTeacherId, (int)$application['branch_id']],
                    $subjectIds,
                    [count($subjectIds)]
                ));
                if (!$teacherStmt->fetchColumn()) {
                    throw new InvalidArgumentException('The preferred teacher is no longer available for all selected subjects.');
                }
            }

            $this->conn->prepare("UPDATE enrollment_applications
                SET grade_level_id = ?, preferred_teacher_id = ?, goal = ?, preferred_session_hours = ?, submission_stage = 'submitted'
                WHERE application_id = ?")
                ->execute([$gradeId, $preferredTeacherId, trim((string)($data['goal'] ?? '')) ?: null, $this->validateSessionHours($data['preferred_session_hours'] ?? 1), $applicationId]);
            $this->conn->prepare('DELETE FROM enrollment_application_subjects WHERE application_id = ?')->execute([$applicationId]);
            $subjectInsert = $this->conn->prepare('INSERT INTO enrollment_application_subjects (application_id, subject_id) VALUES (?, ?)');
            foreach ($subjectIds as $subjectId) $subjectInsert->execute([$applicationId, $subjectId]);
            $this->conn->prepare('DELETE FROM enrollment_application_availability WHERE application_id = ?')->execute([$applicationId]);
            $availabilityInsert = $this->conn->prepare('INSERT INTO enrollment_application_availability (application_id, day, start_time, end_time) VALUES (?, ?, ?, ?)');
            foreach ($availability as $slot) {
                $availabilityInsert->execute([$applicationId, $slot['day'], $slot['start_time'], $slot['end_time']]);
            }

            $studentStmt = $this->conn->prepare("SELECT TRIM(CONCAT_WS(' ', first_name, last_name, NULLIF(TRIM(ext), ''))) FROM student WHERE student_id = ?");
            $studentStmt->execute([$studentId]);
            $studentName = $studentStmt->fetchColumn() ?: 'A student';
            $teacherNote = 'No preferred teacher selected.';
            if ($preferredTeacherId) {
                $teacherNameStmt = $this->conn->prepare("SELECT TRIM(CONCAT_WS(' ', first_name, NULLIF(TRIM(COALESCE(middle_name, '')), ''), last_name)) FROM employee WHERE employee_id = ?");
                $teacherNameStmt->execute([$preferredTeacherId]);
                $teacherNote = 'Preferred teacher: ' . ($teacherNameStmt->fetchColumn() ?: 'Not available') . '.';
            }
            $notificationTitle = 'New Online Enrollment Application';
            $notificationMessage = "{$application['application_number']}: {$studentName} submitted a paid existing-student application for {$application['program_name']}. {$teacherNote}";
            foreach (['owner', 'secretary', 'auditor', 'branch admin'] as $recipientRole) {
                $rolePermissions = $this->onlineApplicationPermissions(['role' => $recipientRole]);
                if (empty($rolePermissions['view_online_applications'])) continue;
                $this->notifications->notifyRole(
                    $recipientRole,
                    $notificationTitle,
                    $notificationMessage,
                    $recipientRole === 'branch admin' ? (int)$application['branch_id'] : null
                );
            }
            $this->conn->commit();
            $this->respond('success', 'Your paid online application was sent to the center for review.', [
                'application_id' => $applicationId,
                'application_number' => $application['application_number'],
                'submission_stage' => 'submitted'
            ]);
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            $this->respond('error', $e->getMessage(), [], $e->getCode() === 401 ? 401 : 422);
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

            // Compare database timestamps inside MySQL. On hosted servers PHP and
            // MySQL commonly use different time zones, so parsing a MySQL DATETIME
            // with PHP's clock can make a newly-created record look hours old.
            $rate = $this->conn->prepare("SELECT (created_at > DATE_SUB(NOW(), INTERVAL 1 MINUTE)) FROM enrollment_email_verifications WHERE email = ? ORDER BY verification_id DESC LIMIT 1");
            $rate->execute([$email]);
            if ((bool)$rate->fetchColumn()) {
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

            $stmt = $this->conn->prepare("SELECT *, (expires_at >= NOW()) AS is_unexpired FROM enrollment_email_verifications WHERE verification_id = ? AND email = ? LIMIT 1");
            $stmt->execute([$id, $email]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$row || !(bool)$row['is_unexpired']) {
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

    private function validateSessionHours($value): float
    {
        if (!is_numeric($value) || !in_array((float)$value, [1.0, 1.5, 2.0], true)) {
            throw new InvalidArgumentException('Select a session duration of 1 hour, 1 hour and 30 minutes, or 2 hours.');
        }
        return (float)$value;
    }

    private function validateAvailability(array $availability, bool $rejectConflicts = false): array
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
            if ($rejectConflicts) {
                foreach ($clean as $existing) {
                    if ($existing['day'] !== $day) continue;
                    $duplicate = strtotime($start) === strtotime($existing['start_time']) && strtotime($end) === strtotime($existing['end_time']);
                    $overlaps = strtotime($start) < strtotime($existing['end_time']) && strtotime($end) > strtotime($existing['start_time']);
                    if ($duplicate || $overlaps) {
                        throw new InvalidArgumentException($duplicate
                            ? "Warning: duplicate weekly availability on {$day}. Remove the duplicate row before saving corrections."
                            : "Warning: weekly availability overlaps on {$day}. Adjust the times before saving corrections.");
                    }
                }
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

    private function validateRequestedSubject($name): ?string
    {
        if ($name === null) return null;
        if (!is_string($name)) {
            throw new InvalidArgumentException('Enter a valid requested subject name.');
        }
        $name = trim(preg_replace('/\s+/u', ' ', $name) ?? '');
        $length = preg_match_all('/./us', $name);
        if ($name === '' || $length === false || $length > 100) {
            throw new InvalidArgumentException('Requested subject must contain 1 to 100 characters.');
        }
        return $name;
    }

    private function resolveRequestedSubject(string $name): int
    {
        $existing = $this->conn->prepare('SELECT subject_id FROM subject WHERE LOWER(TRIM(subject_name)) = LOWER(?) ORDER BY subject_id LIMIT 1 FOR UPDATE');
        $existing->execute([$name]);
        $subjectId = $existing->fetchColumn();
        if ($subjectId !== false) return (int)$subjectId;
        $insert = $this->conn->prepare('INSERT INTO subject (subject_name) VALUES (?)');
        $insert->execute([$name]);
        return (int)$this->conn->lastInsertId();
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
            $minimumBirthdate = (new DateTime('today'))->modify('-2 years');
            if (!$birthday || $birthday->format('Y-m-d') !== (string)$data['birthday'] || $birthday > $minimumBirthdate) {
                throw new InvalidArgumentException('Student must be at least 2 years old.');
            }
            $guardianRelationship = validateGuardianRelationship($data['guardian_relationship'] ?? null);
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
            $otherSubject = $isTutorial ? $this->validateRequestedSubject($data['other_subject'] ?? null) : null;
            $availability = $isTutorial ? $this->validateAvailability((array)($data['availability'] ?? [])) : [];
            $preferredSessionHours = $isTutorial ? $this->validateSessionHours($data['preferred_session_hours'] ?? 1) : null;
            $goal = $isTutorial ? (trim((string)($data['goal'] ?? '')) ?: null) : null;
            $schoolYear = $this->activeSchoolYear();
            $requestedServiceId = !empty($data['include_service']) ? (int)($data['service_id'] ?? 0) : null;
            if (!empty($data['include_service']) && ($requestedServiceId ?? 0) <= 0) {
                throw new InvalidArgumentException('Select a valid service or choose not to include it.');
            }
            $snapshot = $this->financialSnapshot($programId, $requestedServiceId, $branchId);
            $expectedInitialPayment = round((float)$snapshot['initial_payment'], 2);
            $paymentMethodId = (int)($data['payment_method_id'] ?? 0);
            $paymentMethodStmt = $this->conn->prepare("SELECT payment_method FROM payment_method WHERE payment_method_id = ? AND status <> 'inactive' LIMIT 1");
            $paymentMethodStmt->execute([$paymentMethodId]);
            $paymentMethodName = trim((string)$paymentMethodStmt->fetchColumn());
            $normalizedPaymentMethod = strtolower($paymentMethodName);
            $isCashPayment = $normalizedPaymentMethod === 'cash';
            $isGcashPayment = $normalizedPaymentMethod === 'gcash';
            if ($paymentMethodName === '') {
                throw new InvalidArgumentException('Choose an enrollment payment method.');
            }
            $paymentAmount = round((float)($data['payment_amount'] ?? $expectedInitialPayment), 2);
            $paymentReference = trim((string)($data['payment_reference_no'] ?? '')) ?: null;
            if (!$isCashPayment && abs($paymentAmount - $expectedInitialPayment) > 0.01) {
                throw new InvalidArgumentException('The receipt amount must equal the registration fee and downpayment total of ₱ ' . number_format($expectedInitialPayment, 2) . '.');
            }
            if (!$isCashPayment && $paymentReference === null) {
                throw new InvalidArgumentException('Payment reference number is required.');
            }
            if ($isGcashPayment && !preg_match('/^(?:\d{10}|\d{12}|\d{13})$/', (string)$paymentReference)) {
                throw new InvalidArgumentException('The GCash reference number must contain 10, 12, or 13 digits.');
            }
            if (!$isCashPayment && empty($_FILES['payment_screenshot'])) {
                throw new InvalidArgumentException('Upload the payment receipt screenshot before submitting.');
            }

            $this->conn->beginTransaction();

            // Serialize student-number generation for concurrent applications.
            $schoolYearLock = $this->conn->prepare('SELECT school_year_id FROM school_years WHERE school_year_id = ? FOR UPDATE');
            $schoolYearLock->execute([(int)$schoolYear['school_year_id']]);

            if ($subjectIds) {
                $placeholders = implode(',', array_fill(0, count($subjectIds), '?'));
                $subjects = $this->conn->prepare("SELECT COUNT(*) FROM subject WHERE subject_id IN ($placeholders)");
                $subjects->execute($subjectIds);
                if ((int)$subjects->fetchColumn() !== count($subjectIds)) {
                    throw new InvalidArgumentException('One or more selected subjects are unavailable.');
                }
            }
            if ($otherSubject !== null) {
                $subjectIds[] = $this->resolveRequestedSubject($otherSubject);
                $subjectIds = array_values(array_unique($subjectIds));
            }

            $guardian = $this->conn->prepare('INSERT INTO guardian (name, contact_number, relationship) VALUES (?, ?, ?)');
            $guardian->execute([
                trim((string)$data['guardian_name']), $guardianContact, saveGuardianRelationship($this->conn, $guardianRelationship)
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
                 grade_level_id, requested_service_id, goal, preferred_session_hours, status, email_verified_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?)");
            $app->execute([
                $applicationNumber, hash('sha256', $trackingToken), $studentId, $programId, $branchId,
                (int)$schoolYear['school_year_id'], $gradeId, $requestedServiceId, $goal, $preferredSessionHours, $verifiedAt
            ]);
            $applicationId = (int)$this->conn->lastInsertId();
            saveApplicationFinancialSnapshot($this->conn, $applicationId, $snapshot);
            saveAgreementAcceptances($this->conn, $applicationId, $studentId, $programId, $data);

            if (!$isCashPayment) {
                $storedProofPath = $this->storeApplicationPaymentProof($_FILES['payment_screenshot'], $applicationId);
            }
            $applicationPayment = $this->conn->prepare("INSERT INTO enrollment_application_payments
                (application_id, payment_method_id, amount, reference_no, proof_pic, payment_status)
                VALUES (?, ?, ?, ?, ?, ?)");
            $applicationPayment->execute([
                $applicationId,
                $paymentMethodId,
                $expectedInitialPayment,
                $isCashPayment ? null : $paymentReference,
                $storedProofPath,
                $isCashPayment ? 'awaiting_cash' : 'pending_review'
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

            $studentName = trim(implode(' ', array_filter([
                trim((string)$data['first_name']),
                trim((string)($data['middle_name'] ?? '')),
                trim((string)$data['last_name']),
                trim((string)($data['ext'] ?? ''))
            ])));
            $paymentNote = $isCashPayment
                ? 'Cash payment was selected and will be collected after approval.'
                : "A {$paymentMethodName} receipt is attached and awaiting review.";
            $notificationTitle = 'New Online Enrollment Application';
            $notificationMessage = "{$applicationNumber}: {$studentName} applied for {$program['name']} at {$branch['branch_name']}. {$paymentNote}";

            foreach (['owner', 'secretary', 'auditor', 'branch admin'] as $recipientRole) {
                $rolePermissions = $this->onlineApplicationPermissions(['role' => $recipientRole]);
                if (empty($rolePermissions['view_online_applications'])) {
                    continue;
                }

                $this->notifications->notifyRole(
                    $recipientRole,
                    $notificationTitle,
                    $notificationMessage,
                    $recipientRole === 'branch admin' ? $branchId : null
                );
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
                    $isCashPayment
                        ? 'Please visit your selected center after approval to pay the registration fee and downpayment in cash.'
                        : "Your {$paymentMethodName} receipt was recorded with the application. Once the center approves it, teacher or class assignment can begin."
                ],
                'notice' => 'Current status: Pending',
                'featured_label' => 'Application number',
                'featured_value' => $applicationNumber,
                'details' => [
                    'Application number' => $applicationNumber,
                    'Student ID' => $studentNumber,
                    'Program' => $program['name'],
                    'Center' => $branch['branch_name'],
                    'Payment method' => $paymentMethodName,
                    'Monthly service' => $snapshot['service_name'] ?: 'Not included',
                    'Initial payment' => '₱ ' . number_format($expectedInitialPayment, 2),
                    'School year' => $schoolYear['school_year']
                ],
                'button_label' => 'Track your application',
                'button_url' => $trackingUrl,
                'security' => 'To check the application online, enter the application number and the student’s first name, last name, and birthdate exactly as submitted.'
            ]);
            $paymentNextStep = $isCashPayment
                ? 'After approval, visit the selected center to pay the registration fee and downpayment in cash.'
                : "Your {$paymentMethodName} receipt was recorded and will be confirmed when the center approves the application.";
            $receivedPlainText = "Hello {$data['first_name']},\n\nYour new-student application {$applicationNumber} is pending review. " .
                $paymentNextStep . "\n\n" .
                "Track the application using application number {$applicationNumber} together with the student's first name, last name, and birthdate exactly as submitted.";
            $this->sendEmail($email, "Enrollment application {$applicationNumber} received", $receivedEmail, $receivedPlainText);

            $successMessage = $isCashPayment
                ? 'Application submitted. Please visit the center after approval to pay the registration fee and downpayment in cash.'
                : 'Application and payment receipt submitted. The center can approve it and continue directly to teacher or class assignment.';
            $this->respond('success', $successMessage, [
                'application_number' => $applicationNumber,
                'student_id_number' => $studentNumber,
                'payment_method' => $paymentMethodName,
                'payment_status' => $isCashPayment ? 'awaiting_cash' : 'pending_review',
                'status_code' => 'pending_review'
            ]);
        } catch (Throwable $e) {
            $this->rollbackPaymentProof($storedProofPath);
            $this->respond('error', $e->getMessage(), [], $e instanceof InvalidArgumentException ? 422 : 500);
        }
    }

    private function applicationBaseQuery(): string
    {
        return "SELECT ea.*, s.student_id_number, s.username, s.email, s.first_name, s.middle_name, s.last_name, s.ext,
                s.nickname, s.birthday, s.gender_id, s.adr_street, s.adr_barangay, s.adr_city, s.adr_province,
                s.adr_note, s.health_note, g.name AS guardian_name, g.contact_number AS guardian_contact,
                g.relationship AS guardian_relationship, p.name AS program_name, p.tuition, p.total_units,
                p.unit_type, p.validity_days, pt.type AS program_type, p.registration_fee AS program_registration_fee, p.downpayment AS program_downpayment,
                b.branch_name, b.branch_location, sy.school_year, gl.grade_level,
                TRIM(CONCAT_WS(' ', reviewer.first_name, reviewer.last_name)) AS reviewer_name,
                TRIM(CONCAT_WS(' ', preferred_teacher.first_name, NULLIF(TRIM(COALESCE(preferred_teacher.middle_name, '')), ''), preferred_teacher.last_name)) AS preferred_teacher_name
            FROM enrollment_applications ea
            JOIN student s ON s.student_id = ea.student_id
            LEFT JOIN guardian g ON g.guardian_id = s.guardian_id
            JOIN program p ON p.program_id = ea.program_id
            LEFT JOIN program_type pt ON pt.program_type_id = p.program_type
            JOIN branch b ON b.branch_id = ea.branch_id
            JOIN school_years sy ON sy.school_year_id = ea.school_year_id
            LEFT JOIN grade_level gl ON gl.grade_level_id = ea.grade_level_id
            LEFT JOIN employee preferred_teacher ON preferred_teacher.employee_id = ea.preferred_teacher_id
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
            $number = strtoupper(trim((string)($data['application_number'] ?? '')));
            $firstName = trim((string)($data['first_name'] ?? ''));
            $lastName = trim((string)($data['last_name'] ?? ''));
            $birthday = trim((string)($data['birthday'] ?? ''));
            if ($number === '' || $firstName === '' || $lastName === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $birthday)) {
                throw new InvalidArgumentException('Application number, student first name, last name, and birthdate are required.');
            }
            [$year, $month, $day] = array_map('intval', explode('-', $birthday));
            if (!checkdate($month, $day, $year)) {
                throw new InvalidArgumentException('Enter a valid student birthdate.');
            }
            $stmt = $this->conn->prepare($this->applicationBaseQuery() . ' WHERE ea.application_number = ? AND TRIM(s.first_name) = ? AND TRIM(s.last_name) = ? AND s.birthday = ? LIMIT 1');
            $stmt->execute([$number, $firstName, $lastName, $birthday]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$row) {
                throw new RuntimeException('Application was not found.');
            }
            $row = $this->hydrateApplication($row);
            if (!empty($row['enrollment_details_id'])) {
                $row['payment_receipt'] = $this->publicPaymentReceipt((int)$row['enrollment_details_id']);
            }
            // This lookup uses identifying details instead of a secret token, so
            // return only information needed by the public status screen.
            unset(
                $row['tracking_token_hash'], $row['password_hash'], $row['email'], $row['username'],
                $row['nickname'], $row['gender_id'], $row['adr_street'], $row['adr_barangay'],
                $row['adr_city'], $row['adr_province'], $row['adr_note'], $row['health_note'],
                $row['guardian_name'], $row['guardian_contact'], $row['guardian_relationship'],
                $row['reviewer_name'], $row['subjects'], $row['availability']
            );
            if (is_array($row['application_payment'] ?? null)) {
                unset(
                    $row['application_payment']['proof_pic'], $row['application_payment']['account_name'],
                    $row['application_payment']['account_number'], $row['application_payment']['qr_code']
                );
            }
            $this->respond('success', '', ['data' => $row]);
        } catch (Throwable $e) {
            $this->respond('error', $e->getMessage(), [], 404);
        }
    }

    public function listApplications(array $data): void
    {
        try {
            $admin = $this->requireAdmin();
            $this->requireOnlineApplicationPermission($admin, 'view_online_applications', 'You do not have permission to view online enrollment applications.');
            [$scope, $params] = $this->branchScope($admin);
            $status = trim((string)($data['status'] ?? ''));
            $search = trim((string)($data['search'] ?? ''));
            $where = " WHERE COALESCE(ea.submission_stage, 'submitted') = 'submitted'" . $scope;
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
            throw new RuntimeException('Application was not found or is outside your branch.', 404);
        }
        return $this->hydrateApplication($row);
    }

    public function getApplication(array $data): void
    {
        try {
            $admin = $this->requireAdmin();
            $this->requireOnlineApplicationPermission($admin, 'view_online_applications', 'You do not have permission to view online enrollment applications.');
            $row = $this->adminApplication((int)($data['application_id'] ?? 0), $admin);
            $row['edit_version'] = $this->applicationEditVersion($row);
            unset($row['tracking_token_hash']);
            $this->respond('success', '', ['data' => $row]);
        } catch (Throwable $e) {
            $httpStatus = in_array($e->getCode(), [401, 403, 404], true) ? $e->getCode() : 500;
            $this->respond('error', $e->getMessage(), [], $httpStatus);
        }
    }

    private function applicationEditSnapshot(array $application): array
    {
        $subjects = array_map(fn($subject) => (int)$subject['subject_id'], $application['subjects'] ?? []);
        sort($subjects);
        $availability = array_map(fn($slot) => [
            'day' => $slot['day'], 'start_time' => substr($slot['start_time'], 0, 5),
            'end_time' => substr($slot['end_time'], 0, 5)
        ], $application['availability'] ?? []);
        usort($availability, fn($a, $b) => strcmp(json_encode($a), json_encode($b)));
        return [
            'branch_id' => (int)$application['branch_id'],
            'grade_level_id' => (int)($application['grade_level_id'] ?? 0) ?: null,
            'subject_ids' => $subjects, 'goal' => (string)($application['goal'] ?? ''),
            'availability' => $availability,
            'preferred_session_hours' => !empty($application['preferred_session_hours']) ? (float)$application['preferred_session_hours'] : null,
            'preferred_teacher_id' => (int)($application['preferred_teacher_id'] ?? 0) ?: null
        ];
    }

    private function applicationEditVersion(array $application): string
    {
        return hash('sha256', json_encode([
            $this->applicationEditSnapshot($application), $application['status'],
            $application['submission_stage'] ?? 'submitted', $application['review_notes'] ?? null,
            $application['enrollment_details_id'] ?? null
        ]));
    }

    private function validateApplicationEditState(array $application, array $data): void
    {
        if (!in_array($application['status'], ['pending_review', 'approved_for_payment', 'ready_for_scheduling'], true)
            || ($application['submission_stage'] ?? 'submitted') !== 'submitted') {
            throw new RuntimeException('Only submitted applications that have not been finalized can be edited.', 409);
        }
        if (!hash_equals($this->applicationEditVersion($application), (string)($data['edit_version'] ?? ''))) {
            throw new RuntimeException('The application changed while you were editing. Reopen Application Details and try again.', 409);
        }
        $reason = trim((string)($data['reason'] ?? ''));
        if ($reason === '' || strlen($reason) > 1000) {
            throw new InvalidArgumentException('Enter a reason for the correction, up to 1,000 characters.');
        }
    }

    private function assertUnchangedApplicationFees(array $old, array $new): void
    {
        foreach (['tuition_amount', 'tuition_only_subtotal', 'misc_amount', 'service_amount', 'service_total',
            'discount_amount', 'registration_fee', 'downpayment_amount', 'total_after_discount', 'grand_total', 'initial_payment'] as $key) {
            if (abs((float)($old[$key] ?? 0) - (float)($new[$key] ?? 0)) > 0.001) {
                throw new RuntimeException('This branch change affects the assessed fees. Refer it to the auditor/owner for billing review before transferring the application. No changes were saved.', 409);
            }
        }
        foreach (['service_id', 'discount_id', 'total_units'] as $key) {
            if ((int)($old[$key] ?? 0) !== (int)($new[$key] ?? 0)) {
                throw new RuntimeException('This branch change affects the assessed service or discount. Refer it to the auditor/owner for billing review. No changes were saved.', 409);
            }
        }
    }

    public function updateApplication(array $data): void
    {
        try {
            $admin = $this->requireAdmin();
            $this->requireOnlineApplicationPermission($admin, 'edit_online_applications', 'You do not have permission to edit online applications.');
            $this->conn->beginTransaction();
            $applicationId = (int)($data['application_id'] ?? 0);
            $application = $this->adminApplication($applicationId, $admin, true);
            $this->validateApplicationEditState($application, $data);
            $before = $this->applicationEditSnapshot($application);
            $branchId = (int)($data['branch_id'] ?? 0);
            if ($admin['role'] === 'branch admin' && $branchId !== $admin['branch_id']) {
                throw new RuntimeException('Only the secretary or owner can transfer an application to another branch.', 403);
            }
            $branch = $this->conn->prepare("SELECT 1 FROM branch WHERE branch_id = ? AND status = 'active'");
            $branch->execute([$branchId]);
            if (!$branch->fetchColumn()) throw new InvalidArgumentException('Select an active branch.');
            if ($branchId !== (int)$application['branch_id']) {
                $financial = $application['financial'];
                $newFinancial = ($application['applicant_type'] ?? '') === 'existing_student'
                    ? $this->existingStudentFinancialSnapshot((int)$application['program_id'], $branchId)
                    : $this->financialSnapshot((int)$application['program_id'], !empty($financial['service_id']) ? (int)$financial['service_id'] : null, $branchId);
                $this->assertUnchangedApplicationFees($financial, $newFinancial);
            }
            $isTutorial = !$this->isPreschool(['name' => $application['program_name'], 'program_type_name' => $application['program_type'] ?? '']);
            $gradeId = $isTutorial ? (int)($data['grade_level_id'] ?? 0) : ($application['grade_level_id'] ?? null);
            $subjectIds = $isTutorial ? array_values(array_unique(array_filter(array_map('intval', (array)($data['subject_ids'] ?? []))))) : $before['subject_ids'];
            if ($isTutorial) {
                $grade = $this->conn->prepare("SELECT 1 FROM grade_level WHERE grade_level_id = ? AND status = 'active'");
                $grade->execute([$gradeId]);
                if (!$grade->fetchColumn()) throw new InvalidArgumentException('Select an active grade level.');
                if (!$subjectIds) throw new InvalidArgumentException('Select at least one subject.');
                $subjects = $this->conn->prepare('SELECT COUNT(*) FROM subject WHERE subject_id IN (' . implode(',', array_fill(0, count($subjectIds), '?')) . ')');
                $subjects->execute($subjectIds);
                if ((int)$subjects->fetchColumn() !== count($subjectIds)) throw new InvalidArgumentException('One or more subjects are unavailable.');
            }
            $availability = $isTutorial ? $this->validateAvailability((array)($data['availability'] ?? []), true) : $before['availability'];
            foreach ($availability as $slot) {
                foreach (['start_time', 'end_time'] as $key) {
                    if (!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $slot[$key])) throw new InvalidArgumentException('Enter valid availability times.');
                }
            }
            $hours = $isTutorial ? $this->validateSessionHours($data['preferred_session_hours'] ?? 1) : $before['preferred_session_hours'];
            $goal = $isTutorial ? trim((string)($data['goal'] ?? '')) : $before['goal'];
            if (strlen($goal) > 5000) throw new InvalidArgumentException('Learning goal is too long.');
            $updated = array_replace($application, [
                'branch_id' => $branchId, 'grade_level_id' => $gradeId, 'goal' => $goal,
                'preferred_session_hours' => $hours, 'availability' => $availability,
                'subjects' => array_map(fn($id) => ['subject_id' => $id], $subjectIds)
            ]);
            $after = $this->applicationEditSnapshot($updated);
            if ($after === $before) {
                $this->conn->rollBack();
                $this->respond('success', 'No application details were changed.');
                return;
            }
            // Re-select the preferred teacher when the branch or subjects change.
            if ($after['branch_id'] !== $before['branch_id'] || $after['subject_ids'] !== $before['subject_ids']) {
                $after['preferred_teacher_id'] = null;
            }
            $detailsId = (int)($application['enrollment_details_id'] ?? 0);
            if ($detailsId) {
                $details = $this->conn->prepare('SELECT enrollment_header_id, status FROM enrollment_details WHERE enrollment_details_id = ? FOR UPDATE');
                $details->execute([$detailsId]);
                $linked = $details->fetch(PDO::FETCH_ASSOC);
                if (!$linked || !in_array($linked['status'], ['pending', 'incomplete'], true)) {
                    throw new RuntimeException('The linked enrollment has already been finalized. Use the enrollment editing process.', 409);
                }
                $bookings = $this->conn->prepare('SELECT COUNT(*) FROM enrollment_preferred_schedule WHERE enrollment_details_id = ?');
                $bookings->execute([$detailsId]);
                if ((int)$bookings->fetchColumn() > 0) throw new RuntimeException('This enrollment already has plotted sessions. Use the enrollment editing process.', 409);
                $preferred = implode(', ', array_map(fn($slot) => $slot['day'] . ' ' . $slot['start_time'] . '-' . $slot['end_time'], $availability));
                $this->conn->prepare('UPDATE enrollment_details SET grade_level_id = ?, subject_id = ?, goal = ?, preferred_time_day = ? WHERE enrollment_details_id = ?')
                    ->execute([$gradeId ?: null, $subjectIds[0] ?? null, $goal ?: null, $preferred, $detailsId]);
                $this->conn->prepare('UPDATE enrollment_header SET branch_id = ? WHERE enrollment_header_id = ?')->execute([$branchId, $linked['enrollment_header_id']]);
                $this->conn->prepare('DELETE FROM enrollment_subjects WHERE enrollment_details_id = ?')->execute([$detailsId]);
                $insert = $this->conn->prepare('INSERT INTO enrollment_subjects (enrollment_details_id, subject_id) VALUES (?, ?)');
                foreach ($subjectIds as $subjectId) $insert->execute([$detailsId, $subjectId]);
            }
            $fieldLabels = ['branch_id' => 'Branch', 'grade_level_id' => 'Grade level', 'subject_ids' => 'Subjects',
                'goal' => 'Learning goal', 'availability' => 'Weekly availability', 'preferred_session_hours' => 'Session duration',
                'preferred_teacher_id' => 'Preferred teacher'];
            $changed = array_keys(array_filter($after, fn($value, $key) => $value !== $before[$key], ARRAY_FILTER_USE_BOTH));
            $audit = date('Y-m-d H:i:s') . ' — Application corrected by employee #' . $admin['employee_id'] . ' (' . $admin['role'] . ').'
                . "\nReason: " . trim((string)$data['reason'])
                . "\nUpdated fields: " . implode(', ', array_map(fn($key) => $fieldLabels[$key], $changed));
            $notes = trim((string)($application['review_notes'] ?? ''));
            $notes = ($notes !== '' ? $notes . "\n\n" : '') . $audit;
            $this->conn->prepare('UPDATE enrollment_applications SET branch_id = ?, grade_level_id = ?, goal = ?, preferred_session_hours = ?, preferred_teacher_id = ?, review_notes = ? WHERE application_id = ?')
                ->execute([$branchId, $gradeId ?: null, $goal ?: null, $hours, $after['preferred_teacher_id'], $notes, $applicationId]);
            $this->conn->prepare('DELETE FROM enrollment_application_subjects WHERE application_id = ?')->execute([$applicationId]);
            $insert = $this->conn->prepare('INSERT INTO enrollment_application_subjects (application_id, subject_id) VALUES (?, ?)');
            foreach ($subjectIds as $subjectId) $insert->execute([$applicationId, $subjectId]);
            $this->conn->prepare('DELETE FROM enrollment_application_availability WHERE application_id = ?')->execute([$applicationId]);
            $insert = $this->conn->prepare('INSERT INTO enrollment_application_availability (application_id, day, start_time, end_time) VALUES (?, ?, ?, ?)');
            foreach ($availability as $slot) $insert->execute([$applicationId, $slot['day'], $slot['start_time'], $slot['end_time']]);
            $this->conn->commit();
            $this->respond('success', 'Application details updated. Payment approval and receipts are preserved.');
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            $code = in_array($e->getCode(), [401, 403, 404, 409], true) ? $e->getCode() : 422;
            $this->respond('error', $e->getMessage(), [], $code);
        }
    }

    public function reviewApplication(array $data): void
    {
        try {
            $admin = $this->requireAdmin();
            $applicationId = (int)($data['application_id'] ?? 0);
            $decision = trim((string)($data['decision'] ?? ''));
            if (!in_array($decision, ['approve', 'reject'], true)) {
                throw new InvalidArgumentException('Choose approve or reject.');
            }
            $reviewPermission = $decision === 'approve' ? 'approve_online_applications' : 'reject_online_applications';
            $reviewMessage = $decision === 'approve'
                ? 'You do not have permission to approve online enrollment applications.'
                : 'You do not have permission to reject online enrollment applications.';
            $this->requireOnlineApplicationPermission($admin, $reviewPermission, $reviewMessage);
            $this->conn->beginTransaction();
            $application = $this->adminApplication($applicationId, $admin, true);
            if ($application['status'] !== 'pending_review') {
                throw new RuntimeException('Only applications pending review can be reviewed.');
            }
            if (($application['submission_stage'] ?? 'submitted') !== 'submitted') {
                throw new RuntimeException('The student has paid but has not submitted the enrollment details yet.');
            }
            $notes = trim(implode("\n\n", array_filter([
                trim((string)($application['review_notes'] ?? '')), trim((string)($data['notes'] ?? ''))
            ]))) ?: null;
            $applicationPayment = $application['application_payment'] ?? null;
            $isSubmittedOnlinePayment = $applicationPayment
                && ($applicationPayment['payment_status'] ?? '') === 'pending_review';
            if ($decision === 'approve' && $isSubmittedOnlinePayment) {
                $this->requireOnlineApplicationPermission(
                    $admin,
                    'receive_online_application_payment',
                    'You need payment-receiving permission to approve a submitted online payment.'
                );
            }
            $status = $decision === 'approve'
                ? ($isSubmittedOnlinePayment ? 'ready_for_scheduling' : 'approved_for_payment')
                : 'rejected';

            if ($decision === 'approve' && $isSubmittedOnlinePayment) {
                if (($applicationPayment['payment_status'] ?? '') !== 'pending_review') {
                    throw new RuntimeException('This online payment is not awaiting application review.');
                }
                if (!empty($application['enrollment_details_id'])) {
                    // Compatibility path for a payment-first request created by
                    // the short-lived enrollment_details bridge.
                    $detailsId = (int)$application['enrollment_details_id'];
                    $this->conn->prepare("UPDATE payment pay
                        INNER JOIN billing_schedule bs ON bs.billing_schedule_id = pay.billing_schedule_id
                        SET pay.payment_status = 'Received'
                        WHERE bs.enrollment_details_id = ? AND pay.payment_status = 'Pending'")
                        ->execute([$detailsId]);
                    $this->conn->prepare("UPDATE billing_schedule bs
                        SET bs.status = 'paid'
                        WHERE bs.enrollment_details_id = ? AND EXISTS (
                            SELECT 1 FROM payment pay
                            WHERE pay.billing_schedule_id = bs.billing_schedule_id AND pay.payment_status = 'Received'
                        )")->execute([$detailsId]);
                    $this->conn->prepare("UPDATE enrollment_details SET status = 'pending' WHERE enrollment_details_id = ?")
                        ->execute([$detailsId]);
                    $this->conn->prepare("UPDATE enrollment_header eh
                        INNER JOIN enrollment_details ed ON ed.enrollment_header_id = eh.enrollment_header_id
                        SET eh.status = 'pending', eh.employee_id = ?
                        WHERE ed.enrollment_details_id = ?")
                        ->execute([$admin['employee_id'], $detailsId]);
                    $created = ['enrollment_details_id' => $detailsId];
                } else {
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
                }
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
                if (!empty($application['enrollment_details_id'])) {
                    $this->conn->prepare("UPDATE payment pay
                        INNER JOIN billing_schedule bs ON bs.billing_schedule_id = pay.billing_schedule_id
                        SET pay.payment_status = 'Declined'
                        WHERE bs.enrollment_details_id = ? AND pay.payment_status = 'Pending'")
                        ->execute([(int)$application['enrollment_details_id']]);
                }
            }
            $stmt = $this->conn->prepare('UPDATE enrollment_applications SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_notes = ? WHERE application_id = ?');
            $stmt->execute([$status, $admin['employee_id'], $notes, $applicationId]);
            if ($decision === 'approve' && $isSubmittedOnlinePayment) {
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
                : ($isSubmittedOnlinePayment
                    ? 'Application and online payment approved. Continue to teacher or class assignment.'
                    : 'Application approved for center cash payment.');
            $this->respond('success', $message, [
                'status_code' => $status,
                'payment_confirmed' => $decision === 'approve' && $isSubmittedOnlinePayment,
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
        if (!is_finite($amount) || $amount < 0 || round($amount * 100) < round($expected * 100)) {
            throw new InvalidArgumentException('Payment must be at least the required registration fee and downpayment of ₱ ' . number_format($expected, 2) . '.');
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
        $downpaymentBillAmount = max(0, round($amount - $registrationBillAmount, 2));
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

        $receiptId = $amount > 0 ? $this->generateReceiptId() : null;
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
            $admin = $this->requireAdmin();
            $this->requireOnlineApplicationPermission($admin, 'receive_online_application_payment', 'You do not have permission to receive online application payments.');
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
            if (!is_finite($amount) || $amount <= 0 || round($amount * 100) < round($expected * 100)) {
                throw new InvalidArgumentException('Payment must be at least the required registration fee and downpayment of ₱ ' . number_format($expected, 2) . '.');
            }
            $method = $this->conn->prepare("SELECT payment_method FROM payment_method WHERE payment_method_id = ? AND status <> 'inactive'");
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
            JOIN program_teacher eligible_program
              ON eligible_program.employee_id = e.employee_id AND eligible_program.program_id = ?
            WHERE e.employee_id = ? AND e.status = 'active' AND e.branch_id = ? LIMIT 1");
        $stmt->execute([(int)$application['program_id'], $teacherId, (int)$application['branch_id']]);
        $teacher = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$teacher) return [];

        $programAssigned = true;

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
            $this->requireOnlineApplicationPermission($admin, 'finalize_online_applications', 'You do not have permission to finalize online enrollment applications.');
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
            $this->requireOnlineApplicationPermission($admin, 'finalize_online_applications', 'You do not have permission to finalize online enrollment applications.');
            $application = $this->adminApplication((int)($data['application_id'] ?? 0), $admin);
            $stmt = $this->conn->prepare("SELECT DISTINCT e.employee_id FROM employee e
                JOIN role r ON r.role_id = e.role_id
                JOIN program_teacher pt ON pt.employee_id = e.employee_id AND pt.program_id = ?
                WHERE r.role_name = 'teacher' AND e.status = 'active' AND e.branch_id = ? ORDER BY e.last_name, e.first_name");
            $stmt->execute([(int)$application['program_id'], (int)$application['branch_id']]);
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
            $this->requireOnlineApplicationPermission($admin, 'finalize_online_applications', 'You do not have permission to finalize online enrollment applications.');
            $application = $this->adminApplication((int)($data['application_id'] ?? 0), $admin);
            $teacherId = (int)($data['teacher_id'] ?? 0);
            $manualOverride = !empty($data['manual_override']);
            $match = $manualOverride
                ? $this->manualTeacherCandidate($application, $teacherId)
                : $this->teacherMatches($application, $teacherId);
            if (!$match) throw new RuntimeException($manualOverride
                ? 'The manually selected teacher must be active, assigned to this program, and in the application branch.'
                : 'The selected teacher does not match the program, subjects, branch, and preferred availability.');
            if (empty($match['matching_slots'])) {
                throw new RuntimeException('The selected teacher has no working schedule that overlaps the student’s submitted availability. Update the teacher schedule before continuing.');
            }
            $isSessionProgram = strtolower((string)$application['unit_type']) === 'session';
            $programUnits = $isSessionProgram ? max(1, (int)$application['total_units']) : 1;
            $sessionsPerDay = $isSessionProgram ? $this->validateSessionHours($data['sessions_per_day'] ?? $application['preferred_session_hours'] ?? 1) : 1.0;
            if ($sessionsPerDay < 0.5 || $sessionsPerDay > $programUnits || abs(($sessionsPerDay * 2) - round($sessionsPerDay * 2)) > 0.0001) {
                throw new InvalidArgumentException('The selected session duration must fit within the program total hours.');
            }
            $bookings = $this->conn->prepare("SELECT eps.date, eps.start_time, eps.end_time FROM enrollment_preferred_schedule eps JOIN enrollment_details ed ON ed.enrollment_details_id = eps.enrollment_details_id WHERE ed.preferred_teacher = ? AND ed.status IN ('pending','enrolled')");
            $bookings->execute([$teacherId]);
            $busy = $bookings->fetchAll(PDO::FETCH_ASSOC);
            $validityDays = $isSessionProgram ? tutorialValidityDays($application['validity_days'] ?? null) : null;
            $suggestions = [];
            $scheduledDates = [];
            $slotCount = count($match['matching_slots']);
            $attempt = 0;
            $maxAttempts = 104 * $slotCount;
            $requiredMinutes = $programUnits * 60;
            $scheduledMinutes = 0;
            $failedOpenings = [];
            while ($scheduledMinutes < $requiredMinutes && $attempt < $maxAttempts) {
                $slot = $match['matching_slots'][$attempt % $slotCount];
                $weekOffset = intdiv($attempt, $slotCount);
                $date = $this->nextDayDate($slot['day'], $weekOffset);
                $attempt++;
                if (isset($scheduledDates[$date])) continue;
                if ($validityDays && $suggestions) {
                    $first = min(array_merge(array_column($suggestions, 'date'), [$date]));
                    $window = tutorialValidityWindow($first, $validityDays);
                    if (max(array_merge(array_column($suggestions, 'date'), [$date])) > $window['validity_end_date']) continue;
                }

                $remainingMinutes = $requiredMinutes - $scheduledMinutes;
                $batchMinutes = min((int)round($sessionsPerDay * 60), $remainingMinutes);
                $slotStart = strtotime($slot['start_time']);
                $slotEnd = strtotime($slot['end_time']);
                $overlappingBookings = array_values(array_filter($busy, static fn($booking) =>
                    $booking['date'] === $date
                    && substr((string)$booking['start_time'], 0, 8) < $slot['end_time'] . ':00'
                    && substr((string)$booking['end_time'], 0, 8) > $slot['start_time'] . ':00'));

                // Try every 30 minutes inside the overlap so an earlier booking does not
                // prevent a later one- or two-hour block from being suggested that day.
                for ($cursor = $slotStart; $cursor + ($batchMinutes * 60) <= $slotEnd; $cursor += 1800) {
                    $conflict = false;
                    $endTs = $cursor + ($batchMinutes * 60);
                    $start = date('H:i:s', $cursor);
                    $end = date('H:i:s', $endTs);
                    foreach ($busy as $booking) {
                        if ($booking['date'] === $date
                            && substr((string)$booking['start_time'], 0, 8) < $end
                            && substr((string)$booking['end_time'], 0, 8) > $start) {
                            $conflict = true;
                            break;
                        }
                    }
                    if ($conflict) continue;
                    $suggestions[] = [
                        'date' => $date,
                        'day' => $slot['day'],
                        'start_time' => date('H:i', $cursor),
                        'end_time' => date('H:i', $endTs),
                        'duration_hours' => $batchMinutes / 60
                    ];
                    $busy[] = ['date' => $date, 'start_time' => $start, 'end_time' => $end];
                    $scheduledMinutes += $batchMinutes;
                    $scheduledDates[$date] = true;
                    break;
                }
                if (!isset($scheduledDates[$date])) {
                    $availableMinutes = (int)(($slotEnd - $slotStart) / 60);
                    $failedOpenings[$date][] = [
                        'start_time' => $slot['start_time'], 'end_time' => $slot['end_time'],
                        'available_minutes' => $availableMinutes, 'required_minutes' => $batchMinutes,
                        'reason' => $availableMinutes < $batchMinutes ? 'short' : 'booked',
                        'bookings' => $overlappingBookings
                    ];
                }
            }
            if ($scheduledMinutes < $requiredMinutes) {
                throw new RuntimeException(scheduleSuggestionFailureMessage(
                    $requiredMinutes, $scheduledMinutes, $sessionsPerDay, $validityDays, $suggestions, $failedOpenings
                ));
            }
            $this->respond('success', '', [
                'data' => $suggestions,
                'teacher' => $match,
                'manual_override' => $manualOverride,
                'sessions_per_day' => $sessionsPerDay,
                'validity_days' => $validityDays
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
        $conflict = $this->conn->prepare("SELECT 1 FROM enrollment_preferred_schedule eps JOIN enrollment_details ed ON ed.enrollment_details_id = eps.enrollment_details_id WHERE ed.preferred_teacher = ? AND ed.status IN ('pending','enrolled') AND eps.date = ? AND eps.start_time < ? AND eps.end_time > ? LIMIT 1");
        $conflict->execute([$teacherId, $date, $end, $start]);
        return !$conflict->fetchColumn();
    }

    private function generateRemainingBills(int $detailsId, array $application, array $snapshot, array $schedule): void
    {
        $paidStmt = $this->conn->prepare("SELECT COALESCE(SUM(p.amount_paid), 0)
            FROM payment p JOIN billing_schedule bs ON bs.billing_schedule_id = p.billing_schedule_id
            WHERE bs.enrollment_details_id = ? AND p.payment_status = 'Received'
              AND LOWER(bs.billing_type) IN ('registration fee', 'downpayment')");
        $paidStmt->execute([$detailsId]);
        $paidBase = (float)$paidStmt->fetchColumn();
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
        $temporaryPassword = 'Cdo!' . bin2hex(random_bytes(6));

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

        PasswordExpiration::ensureSchema($this->conn);
        $this->conn->prepare("UPDATE student SET username = ?, password_hash = ?, password_changed_at = NOW(), password_is_temporary = 1, status = 'active' WHERE student_id = ?")
            ->execute([$username, password_hash($temporaryPassword, PASSWORD_DEFAULT), $studentId]);
        $this->conn->prepare('DELETE FROM account_activations WHERE user_type = ? AND user_id = ?')
            ->execute(['student', $studentId]);

        return ['username' => $username, 'temporary_password' => $temporaryPassword];
    }

    public function finalizeEnrollment(array $data): void
    {
        try {
            $admin = $this->requireAdmin();
            $this->requireOnlineApplicationPermission($admin, 'finalize_online_applications', 'You do not have permission to finalize online enrollment applications.');
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
                    ? 'The manually selected teacher is no longer active, assigned to this program, or in this branch.'
                    : 'The selected teacher is no longer a valid automatic match.');
            }
            $isSessionProgram = strtolower((string)$application['unit_type']) === 'session';
            $required = $isSessionProgram ? max(1, (int)$application['total_units']) : 1;
            if (!$isSessionProgram && count($schedule) !== 1) {
                throw new InvalidArgumentException('Exactly one schedule is required for this program.');
            }
            $scheduledMinutes = 0;
            foreach ($schedule as $index => $row) {
                $durationSeconds = strtotime((string)($row['end_time'] ?? '')) - strtotime((string)($row['start_time'] ?? ''));
                if ($isSessionProgram && ($durationSeconds < 1800 || $durationSeconds % 1800 !== 0)) {
                    throw new InvalidArgumentException('Each session must be at least 30 minutes and use 30-minute increments.');
                }
                if ($isSessionProgram) $scheduledMinutes += (int)($durationSeconds / 60);
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
            if ($isSessionProgram && $scheduledMinutes !== $required * 60) {
                throw new InvalidArgumentException("The submitted sessions must total exactly {$required} hours for this program.");
            }
            $detailsId = (int)$application['enrollment_details_id'];
            prepareTutorialEnrollmentSchedule($this->conn, $detailsId, $schedule, true);
            $this->conn->prepare('DELETE FROM enrollment_preferred_schedule WHERE enrollment_details_id = ?')->execute([$detailsId]);
            $insert = $this->conn->prepare("INSERT INTO enrollment_preferred_schedule (enrollment_details_id, day, start_time, end_time, date, status, reschedule_reason) VALUES (?, ?, ?, ?, ?, 'pending', 'Initial enrollment schedule')");
            foreach ($schedule as $row) {
                $insert->execute([$detailsId, date('l', strtotime($row['date'])), $row['start_time'], $row['end_time'], $row['date']]);
            }
            $this->conn->prepare("UPDATE enrollment_details SET preferred_teacher = ?, status = 'enrolled' WHERE enrollment_details_id = ?")->execute([$teacherId, $detailsId]);
            $this->conn->prepare("UPDATE enrollment_header eh JOIN enrollment_details ed ON ed.enrollment_header_id = eh.enrollment_header_id SET eh.employee_id = ?, eh.status = 'enrolled' WHERE ed.enrollment_details_id = ?")->execute([$admin['employee_id'], $detailsId]);
            $snapshot = $this->applicationFinancialSnapshot($application);
            $this->generateRemainingBills($detailsId, $application, $snapshot, $schedule);
            $isExistingStudent = strtolower((string)($application['applicant_type'] ?? 'new_student')) === 'existing_student';
            $portalCredentials = $isExistingStudent ? null : $this->activateStudentPortalAccount($application);
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
                'messages' => $isExistingStudent
                    ? [
                        'Your teacher and exact sessions have been confirmed. Your enrollment is now complete.',
                        'Your existing student portal account remains active. Sign in normally to view the schedule, sessions, and billing statement.'
                    ]
                    : [
                        'Your teacher and exact sessions have been confirmed. Your enrollment is now complete.',
                        'The system has created the student portal account. Sign in with the temporary password below and create a new password to view your schedule, sessions, and billing statement.'
                    ],
                'notice' => 'You are officially enrolled in ' . $application['program_name'] . '.',
                'details' => [
                    'Student ID' => $application['student_id_number'],
                    'Program' => $application['program_name'],
                    'Center' => $application['branch_name'],
                    'Teacher' => $selectedTeacher['teacher_name'],
                    'Status' => 'Enrolled'
                ],
                'credentials' => $isExistingStudent ? [] : [
                    'Username' => $portalCredentials['username'],
                    'Temporary password' => $portalCredentials['temporary_password']
                ],
                'button_label' => 'Log in to your account',
                'button_url' => $loginUrl,
                'security' => $isExistingStudent
                    ? 'Use your existing student portal credentials. Never share your password or verification codes.'
                    : 'Sign in with your temporary password, then create a new password before continuing. Never share your password or verification codes.'
            ]);
            $completedPlainText = $isExistingStudent
                ? "Congratulations, {$application['first_name']}! Your enrollment is complete. Teacher: {$selectedTeacher['teacher_name']}. Use your existing student portal account to view your schedule and billing."
                : "Congratulations, {$application['first_name']}! Your enrollment is complete. " .
                    "Teacher: {$selectedTeacher['teacher_name']}. Username: {$portalCredentials['username']}. " .
                    "Temporary password: {$portalCredentials['temporary_password']}. Sign in with this password, then create a new password before continuing.";
            $emailSent = $this->sendEmail(
                $application['email'],
                "Enrollment {$application['application_number']} completed",
                $completedEmail,
                $completedPlainText
            );
            $message = $isExistingStudent
                ? ($emailSent
                    ? 'Teacher and schedule assigned. The student was notified successfully.'
                    : 'Teacher and schedule assigned, but the notification email could not be sent.')
                : ($emailSent
                    ? 'Enrollment completed. Student portal credentials were emailed successfully.'
                    : 'Enrollment completed, but the student portal credential email could not be sent.');
            $this->respond('success', $message, ['enrollment_details_id' => $detailsId, 'billing' => $billing, 'email_sent' => $emailSent]);
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            $this->respond('error', $e->getMessage(), [], 422);
        }
    }

    public function finalizePreschoolEnrollment(array $data): void
    {
        try {
            $admin = $this->requireAdmin();
            $this->requireOnlineApplicationPermission($admin, 'finalize_online_applications', 'You do not have permission to finalize online enrollment applications.');
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
                    SET eh.employee_id = ?, eh.status = 'enrolled'
                    WHERE ed.enrollment_details_id = ?")
                ->execute([$admin['employee_id'], $detailsId]);

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
                    'The system has created the student portal account. Sign in with the temporary password below and create a new password to view the enrollment and billing statement.'
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
                    'Temporary password' => $portalCredentials['temporary_password']
                ],
                'button_label' => 'Log in to your account',
                'button_url' => $loginUrl,
                'security' => 'Sign in with your temporary password, then create a new password before continuing. Never share your password or verification codes.'
            ]);
            $completedPlainText = "Congratulations, {$application['first_name']}! Your Pre and Play School enrollment is complete. " .
                "Section: {$section['section_name']}. Username: {$portalCredentials['username']}. " .
                "Temporary password: {$portalCredentials['temporary_password']}. Sign in with this password, then create a new password before continuing.";
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
            $admin = $this->requireAdmin();
            $this->requireOnlineApplicationPermission($admin, 'receive_online_application_payment', 'You do not have permission to receive online application payments.');
            $rows = $this->conn->query("SELECT payment_method_id, payment_method FROM payment_method WHERE status <> 'inactive' ORDER BY payment_method_id")->fetchAll(PDO::FETCH_ASSOC);
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
    case 'startExistingStudentApplication': $api->startExistingStudentApplication($data); break;
    case 'getExistingStudentApplicationState': $api->getExistingStudentApplicationState(); break;
    case 'linkIncompleteEnrollmentApplication': $api->linkIncompleteEnrollmentApplication($data); break;
    case 'submitExistingStudentApplicationDetails': $api->submitExistingStudentApplicationDetails($data); break;
    case 'checkStudent': $api->checkStudent($data); break;
    case 'sendOtp': $api->sendOtp($data); break;
    case 'verifyOtp': $api->verifyOtp($data); break;
    case 'submitApplication': $api->submitApplication($data); break;
    case 'getPublicStatus': $api->getPublicStatus($data); break;
    case 'getFinancialPreview': $api->getFinancialPreview($data); break;
    case 'listApplications': $api->listApplications($data); break;
    case 'getApplication': $api->getApplication($data); break;
    case 'updateApplication': $api->updateApplication($data); break;
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
