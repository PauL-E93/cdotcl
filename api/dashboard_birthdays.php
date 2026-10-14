<?php
require_once __DIR__ . '/security/AuthGuard.php';
$user = AuthGuard::requireRoles(['auditor', 'secretary', 'branch admin', 'teacher']);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if ($user['user_type'] !== 'employee') {
    AuthGuard::deny();
}

try {
    require_once __DIR__ . '/dashboard_birthdays_helper.php';
    $rows = fetchDashboardBirthdays(
        AuthGuard::connection(), $user['role_name'], $user['user_id'], (int) ($_SESSION['branch_id'] ?? 0)
    );
    echo json_encode(['status' => 'success', 'student_birthdays' => $rows], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
} catch (Throwable $error) {
    $status = (int) $error->getCode() === 403 ? 403 : 500;
    http_response_code($status);
    if ($status === 500) error_log('Dashboard birthday query failed: ' . $error->getMessage());
    echo json_encode(['status' => 'error', 'message' => $status === 403 ? $error->getMessage() : 'Birthdays could not be loaded.']);
}
