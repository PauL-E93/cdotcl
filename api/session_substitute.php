<?php
require_once __DIR__ . '/security/AuthGuard.php';
$actor = AuthGuard::requireRoles(['owner', 'secretary', 'branch admin']);
if ($actor['user_type'] !== 'employee') AuthGuard::deny(403, 'Staff access required.');
header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');
$conn = AuthGuard::connection();
require_once __DIR__ . '/session_substitute_helper.php';
require_once __DIR__ . '/notification_helper.php';

try {
    $permission = $conn->prepare("SELECT permissions_json FROM role_module_permissions WHERE role_name = ? AND module_key = 'session' LIMIT 1");
    $permission->execute([$actor['role_name']]);
    $permissions = json_decode((string)$permission->fetchColumn(), true);
    if (is_array($permissions) && (($permissions['view'] ?? true) === false || ($permissions['edit'] ?? true) === false)) {
        AuthGuard::deny(403, 'You do not have permission to edit sessions.');
    }
} catch (PDOException $error) {
    if ((int)($error->errorInfo[1] ?? 0) !== 1146) AuthGuard::deny(503, 'Session permissions are temporarily unavailable.');
}

try {
    ensureSessionSubstituteSchema($conn);
    $service = new SessionSubstituteService($conn);
    $data = $_SERVER['REQUEST_METHOD'] === 'GET' ? $_GET : json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) throw new DomainException('Invalid request.');
    $role = $actor['role_name'];
    $branch = (int)($_SESSION['branch_id'] ?? 0);
    if ($_SERVER['REQUEST_METHOD'] === 'GET' && ($data['operation'] ?? '') === 'getTeachers') {
        echo json_encode(['status' => 'success', 'teachers' => $service->teachers($data, $role, $branch)]);
    } elseif ($_SERVER['REQUEST_METHOD'] === 'POST' && ($data['operation'] ?? '') === 'saveSubstitute') {
        $result = $service->save($data, $role, $branch);
        $first = $result['rows'][0];
        $notifications = new NotificationService($conn);
        $message = "Teacher assignment updated for the session on {$first['date']} at {$first['start_time']}.";
        $recipients = array_unique(array_merge([$result['teacher_id']], array_map(fn($row) => (int)($row['substitute_teacher_id'] ?? $row['preferred_teacher']), $result['rows'])));
        foreach ($recipients as $id) $notifications->notifyEmployee($id, 'Session Teacher Updated', $message);
        $notifications->notifyStudent($first['student_id'], 'Session Teacher Updated', $message);
        echo json_encode(['status' => 'success', 'message' => empty($data['substitute_teacher_id']) ? 'Substitute removed. This session uses the regular teacher.' : 'Substitute teacher assigned to this session.']);
    } else {
        AuthGuard::deny(405, 'Invalid operation or request method.');
    }
} catch (DomainException $error) {
    http_response_code(422);
    echo json_encode(['status' => 'error', 'message' => $error->getMessage()]);
} catch (Throwable $error) {
    error_log('Session substitute failed: ' . $error->getMessage());
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Unable to update the substitute teacher. Please try again.']);
}
