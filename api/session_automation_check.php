<?php
require_once __DIR__ . '/security/AuthGuard.php';
$user = AuthGuard::requireUser();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') AuthGuard::deny(405, 'Session checks require POST.');
$staff = $user['user_type'] === 'employee' && in_array($user['role_name'], ['owner', 'secretary', 'admin', 'administrator', 'branch admin', 'auditor', 'teacher'], true);
$student = $user['user_type'] === 'student' && $user['role_name'] === 'student';
if (!$staff && !$student) {
    AuthGuard::deny(403, 'A logged-in system user is required to run session checks.');
}
require_once __DIR__ . '/session_automation_helper.php';
$input = json_decode(file_get_contents('php://input'), true);
$clientTime = null;
if (is_array($input) && array_key_exists('client_time', $input)) {
    // Student/auditor checks keep their existing server clock behavior.
    if (!$staff || $user['role_name'] === 'auditor') AuthGuard::deny(403, 'Only session staff can supply the device clock.');
    $value = $input['client_time'];
    $clientTime = is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/D', $value)
        ? DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s', $value, new DateTimeZone('Asia/Manila')) : false;
    if (!$clientTime || $clientTime->format('Y-m-d\TH:i:s') !== $value) AuthGuard::deny(422, 'Invalid device date and time.');
}
try {
    $conn = AuthGuard::connection();
    ensureSessionAutomationSchema($conn);
    // The database clock throttles requests; staff device time determines deadlines.
    $result = runSessionAutomation($conn, false, 60, null, $clientTime);
    echo json_encode(array_merge(['status' => 'success'], $result));
} catch (Throwable $error) {
    error_log('Browser session check failed: ' . $error->getMessage());
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Unable to check session deadlines. The next browser check will retry.']);
}
