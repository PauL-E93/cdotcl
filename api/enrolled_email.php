<?php
header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

require_once __DIR__ . '/admin/connection-pdo.php';
require_once __DIR__ . '/email_service.php';
require_once __DIR__ . '/security/AuthGuard.php';

AuthGuard::requireRoles(['owner', 'secretary', 'branch admin']);

function enrollmentEmailRespond($status, $message, $extra = [], $httpStatus = 200)
{
    http_response_code($httpStatus);
    echo json_encode(array_merge([
        'status' => $status,
        'message' => $message
    ], $extra));
    exit;
}

function enrollmentEmailEscape($value)
{
    return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8');
}

function buildEnrollmentEmailBody($enrollment, $username, $password = null, $isNewStudent = false)
{
    $studentName = enrollmentEmailEscape($enrollment['student_name'] ?: 'Student');
    $programName = enrollmentEmailEscape($enrollment['program_name'] ?: 'your selected program');
    $branchName = enrollmentEmailEscape($enrollment['branch_name'] ?: 'CDO Tutorial Center');
    $studentNumber = enrollmentEmailEscape($enrollment['student_id_number'] ?: 'To be assigned');
    $safeUsername = enrollmentEmailEscape($username);
    $safePassword = enrollmentEmailEscape($password ?? '');

    $isHttps = !empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off';
    $scheme = $isHttps ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? '';
    $appPath = rtrim(str_replace('\\', '/', dirname(dirname($_SERVER['SCRIPT_NAME'] ?? ''))), '/');
    $loginUrl = $host !== '' ? enrollmentEmailEscape($scheme . '://' . $host . $appPath . '/login.html') : '';
    $loginButton = $loginUrl !== ''
        ? "<p style='margin:24px 0;text-align:center;'><a href='{$loginUrl}' style='display:inline-block;padding:12px 24px;background:#ea9aa6;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;'>Log in to your account</a></p>"
        : '';
    $credentialsBlock = $isNewStudent
        ? "
                <p><strong>Your login credentials</strong></p>
                <div class='credentials'>
                    <p><strong>Username:</strong> <span class='credential-value'>{$safeUsername}</span></p>
                    <p><strong>Temporary password:</strong> <span class='credential-value'>{$safePassword}</span></p>
                </div>"
        : '';
    $securityMessage = $isNewStudent
        ? 'Sign in with this temporary password. You will be asked to create a new password before continuing. Do not share your password.'
        : 'Please use your current password to sign in. For security, existing passwords cannot be displayed or emailed. Use the Forgot Password option on the login page if you no longer remember it.';

    return "
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset='UTF-8'>
        <meta name='viewport' content='width=device-width, initial-scale=1.0'>
        <style>
            body { margin: 0; padding: 0; background: #f8fafc; font-family: Arial, sans-serif; color: #334155; }
            .container { max-width: 600px; margin: 0 auto; padding: 24px; }
            .header { background: #ea9aa6; color: #ffffff; padding: 26px 22px; border-radius: 10px 10px 0 0; text-align: center; }
            .header h2 { margin: 0 0 6px; }
            .header p { margin: 0; opacity: .95; }
            .content { background: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-top: 0; border-radius: 0 0 10px 10px; }
            .notice { background: #fdf2f4; border-left: 4px solid #ea9aa6; padding: 14px 16px; margin: 18px 0; font-weight: 600; }
            .details, .credentials { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 18px 0; }
            .details p, .credentials p { margin: 7px 0; }
            .credentials { background: #fff7f9; border-color: #f3c5ce; }
            .credential-value { font-family: Consolas, Monaco, monospace; font-size: 16px; }
            .security { color: #64748b; font-size: 13px; line-height: 1.5; }
        </style>
    </head>
    <body>
        <div class='container'>
            <div class='header'>
                <h2>Congratulations, {$studentName}!</h2>
                <p>Your enrollment has been completed successfully.</p>
            </div>
            <div class='content'>
                <p>Welcome to CDO Tutorial Center. We are delighted to have you with us.</p>
                <div class='notice'>You are officially enrolled in {$programName}.</div>
                <div class='details'>
                    <p><strong>Student ID:</strong> {$studentNumber}</p>
                    <p><strong>Program:</strong> {$programName}</p>
                    <p><strong>Branch:</strong> {$branchName}</p>
                </div>
                {$credentialsBlock}
                {$loginButton}
                <p class='security'>{$securityMessage}</p>
            </div>
        </div>
    </body>
    </html>";
}

function sendEnrollmentEmail($enrollment, $username, $password = null, $isNewStudent = false)
{
    global $conn;

    $altBody = $isNewStudent
            ? "Congratulations, {$enrollment['student_name']}! Your enrollment in {$enrollment['program_name']} has been completed. Username: {$username}. Temporary password: {$password}. Sign in with this password, then create a new password before continuing."
            : "Congratulations, {$enrollment['student_name']}! Your enrollment in {$enrollment['program_name']} has been completed. Please use your current account credentials to sign in.";

    return (new EmailService($conn))->send(
        $enrollment['email'],
        'Congratulations! Your CDO Tutorial Center Enrollment',
        buildEnrollmentEmailBody($enrollment, $username, $password, $isNewStudent),
        [
            'from_name' => 'CDO Tutorial Center Enrollment',
            'recipient_name' => $enrollment['student_name'],
            'alt_body' => $altBody
        ]
    );
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    enrollmentEmailRespond('error', 'Method not allowed.', [], 405);
}

$data = json_decode(file_get_contents('php://input'), true);
if (!is_array($data)) {
    $data = $_POST;
}

$studentId = intval($data['student_id'] ?? 0);
$enrollmentId = intval($data['enrollment_id'] ?? 0);
$isNewStudent = filter_var($data['is_new_student'] ?? false, FILTER_VALIDATE_BOOLEAN);

if ($studentId <= 0 || $enrollmentId <= 0) {
    enrollmentEmailRespond('error', 'Student and enrollment IDs are required.', [], 422);
}

$pendingCredentials = $_SESSION['pending_enrollment_credentials'][$studentId] ?? null;
if ($isNewStudent && !is_array($pendingCredentials)) {
    enrollmentEmailRespond('error', 'No new-student credentials are pending for this enrollment.', [], 409);
}

if ($isNewStudent && time() - intval($pendingCredentials['created_at'] ?? 0) > 7200) {
    unset($_SESSION['pending_enrollment_credentials'][$studentId]);
    enrollmentEmailRespond('error', 'The temporary credential email window has expired.', [], 410);
}

try {
    $stmt = $conn->prepare("
        SELECT
            ed.enrollment_details_id,
            s.student_id,
            s.student_id_number,
            s.email,
            TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
            p.name AS program_name,
            b.branch_name
        FROM enrollment_details ed
        INNER JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
        INNER JOIN student s ON s.student_id = eh.student_id
        LEFT JOIN program p ON p.program_id = ed.program_id
        LEFT JOIN branch b ON b.branch_id = eh.branch_id
        WHERE ed.enrollment_details_id = ?
          AND s.student_id = ?
        LIMIT 1
    ");
    $stmt->execute([$enrollmentId, $studentId]);
    $enrollment = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$enrollment) {
        enrollmentEmailRespond('error', 'The completed enrollment could not be found for this student.', [], 404);
    }

    if (empty($enrollment['email']) || !filter_var($enrollment['email'], FILTER_VALIDATE_EMAIL)) {
        enrollmentEmailRespond('error', 'The student email address is missing or invalid.', [], 422);
    }

    $username = $isNewStudent ? (string)($pendingCredentials['username'] ?? '') : '';
    $password = $isNewStudent ? (string)($pendingCredentials['temporary_password'] ?? '') : null;
    if ($isNewStudent && ($username === '' || $password === '')) {
        enrollmentEmailRespond('error', 'The new-student credentials are unavailable.', [], 409);
    }

    if (!sendEnrollmentEmail($enrollment, $username, $password, $isNewStudent)) {
        enrollmentEmailRespond('error', 'Enrollment was saved, but the welcome email could not be sent.', [], 502);
    }

    if ($isNewStudent) {
        unset($_SESSION['pending_enrollment_credentials'][$studentId]);
    }
    enrollmentEmailRespond('success', $isNewStudent
        ? 'Congratulations email and login credentials sent successfully.'
        : 'Congratulations email sent to the existing student successfully.', [
        'email_sent' => true,
        'credentials_included' => $isNewStudent
    ]);
} catch (Throwable $e) {
    error_log('Enrollment welcome email error: ' . $e->getMessage());
    enrollmentEmailRespond('error', 'Unable to send the enrollment welcome email. Please try again.', [], 500);
}
