<?php
require_once __DIR__ . '/security/AuthGuard.php';
require_once __DIR__ . '/security/EnrollmentPermission.php';
require_once __DIR__ . '/tutorial_validity_helper.php';
$actor = AuthGuard::requireUser();
$conn = AuthGuard::connection();
ensureTutorialValiditySchema($conn);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
$input = json_decode(file_get_contents('php://input'), true) ?: [];
$id = (int) ($_GET['enrollment_details_id'] ?? $input['enrollment_details_id'] ?? 0);
$write = $_SERVER['REQUEST_METHOD'] === 'POST';
if (!in_array($_SERVER['REQUEST_METHOD'], ['GET', 'POST'], true)) AuthGuard::deny(405, 'Use GET or POST.');
if ($write) EnrollmentPermission::requirePermission('extend_tutorial_validity');
elseif ($actor['user_type'] === 'employee') EnrollmentPermission::requirePermission('view');

try {
    if ($write) $conn->beginTransaction();
    $query = $conn->prepare('SELECT ed.enrollment_details_id, ed.validity_days, ed.validity_start_date,
        ed.validity_end_date, ed.preferred_teacher, eh.student_id, eh.branch_id, p.unit_type,
        p.validity_days AS program_validity_days
        FROM enrollment_details ed JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
        JOIN program p ON p.program_id = ed.program_id WHERE ed.enrollment_details_id = ?' . ($write ? ' FOR UPDATE' : ''));
    $query->execute([$id]);
    $package = $query->fetch(PDO::FETCH_ASSOC);
    if (!$package) throw new DomainException('Enrollment package not found.');
    if ($actor['user_type'] === 'student' && (int) $package['student_id'] !== $actor['user_id']) AuthGuard::deny();
    if ($actor['user_type'] === 'employee' && $actor['role_name'] === 'branch admin'
        && (int) $package['branch_id'] !== (int) ($_SESSION['branch_id'] ?? 0)) AuthGuard::deny();
    if ($actor['user_type'] === 'employee' && $actor['role_name'] === 'teacher'
        && (int) $package['preferred_teacher'] !== $actor['user_id']) {
        $assigned = $conn->prepare('SELECT 1 FROM enrollment_preferred_schedule WHERE enrollment_details_id = ? AND substitute_teacher_id = ? LIMIT 1');
        $assigned->execute([$id, $actor['user_id']]);
        if (!$assigned->fetchColumn()) AuthGuard::deny();
    }

    $canExtend = $actor['user_type'] === 'employee' && $actor['role_name'] === 'owner';
    if ($actor['user_type'] === 'employee') {
        try {
            $permission = $conn->prepare("SELECT permissions_json FROM role_module_permissions WHERE role_name = ? AND module_key = 'enrollment'");
            $permission->execute([$actor['role_name']]);
            $stored = json_decode((string) $permission->fetchColumn(), true);
            if (isset($stored['extend_tutorial_validity']) && is_bool($stored['extend_tutorial_validity'])) $canExtend = $stored['extend_tutorial_validity'];
        } catch (PDOException $error) {
            if ((int) ($error->errorInfo[1] ?? 0) !== 1146) throw $error;
        }
    }
    $isTutorial = strtolower((string) $package['unit_type']) === 'session';
    if ($write) {
        $end = saveTutorialValidityChange($conn, $id, $package, $input, $actor['user_id']);
        $conn->commit();
        echo json_encode(['status' => 'success', 'message' => 'Tutorial validity saved.', 'validity_end_date' => $end]);
        exit;
    }
    $history = $conn->prepare('SELECT h.action, h.previous_end_date, h.new_end_date, h.reason, h.changed_at,
        CONCAT_WS(" ", e.first_name, e.last_name) AS changed_by
        FROM enrollment_validity_history h LEFT JOIN employee e ON e.employee_id = h.employee_id
        WHERE h.enrollment_details_id = ? ORDER BY h.history_id DESC');
    $history->execute([$id]);
    $today = (new DateTimeImmutable('now', new DateTimeZone('Asia/Manila')))->format('Y-m-d');
    echo json_encode(['status' => 'success', 'data' => [
        'is_tutorial' => $isTutorial, 'validity_days' => $package['validity_days'],
        'program_validity_days' => $package['program_validity_days'],
        'validity_start_date' => $package['validity_start_date'], 'validity_end_date' => $package['validity_end_date'],
        'expired' => $package['validity_end_date'] && $today > $package['validity_end_date'],
        'can_extend' => $canExtend, 'today' => $today, 'history' => $history->fetchAll(PDO::FETCH_ASSOC)
    ]]);
} catch (Throwable $error) {
    if ($conn->inTransaction()) $conn->rollBack();
    http_response_code($error instanceof DomainException ? 422 : 500);
    echo json_encode(['status' => 'error', 'message' => $error instanceof DomainException ? $error->getMessage() : 'Unable to load or save tutorial validity.']);
    if (!$error instanceof DomainException) error_log('Tutorial validity: ' . $error->getMessage());
}
