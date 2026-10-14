<?php
require_once __DIR__ . '/../security/AuthGuard.php';
$user = AuthGuard::requireUser();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
$canManage = $user['user_type'] === 'employee' && in_array($user['role_name'], ['owner', 'admin', 'administrator'], true);
if ($user['user_type'] !== 'employee' || !in_array($user['role_name'], ['owner', 'admin', 'administrator', 'auditor', 'branch admin', 'secretary', 'teacher'], true)) {
    AuthGuard::deny(403, 'Staff access is required to view session automation.');
}
require_once __DIR__ . '/../session_automation_helper.php';
$conn = AuthGuard::connection();
$permissions = ['view' => true, 'view_session_automation' => true,
    'create_session_automation' => $canManage, 'edit_session_automation' => $canManage];
try {
    $role = preg_replace('/[\s_-]+/', ' ', strtolower(trim($user['role_name'])));
    $statement = $conn->prepare("SELECT permissions_json FROM role_module_permissions WHERE role_name = ? AND module_key = 'program' LIMIT 1");
    $statement->execute([$role]);
    $stored = json_decode((string) $statement->fetchColumn(), true);
    foreach ($permissions as $key => $default) {
        if (isset($stored[$key]) && is_bool($stored[$key])) $permissions[$key] = $stored[$key];
    }
} catch (PDOException $error) {
    if ($error->getCode() !== '42S02' && (int) ($error->errorInfo[1] ?? 0) !== 1146) {
        error_log('Session automation permission lookup failed: ' . $error->getMessage());
        AuthGuard::deny(503, 'Session automation permissions are temporarily unavailable.');
    }
}
if (!$permissions['view'] || !$permissions['view_session_automation']) AuthGuard::deny(403, 'You do not have permission to view session automation.');
$canCreate = $permissions['create_session_automation'];
$canEdit = $permissions['edit_session_automation'];
ensureSessionAutomationSchema($conn);
$input = json_decode(file_get_contents('php://input'), true) ?: [];
$operation = $_GET['operation'] ?? $input['operation'] ?? 'list';
if ($operation === 'list' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    echo json_encode(['status' => 'success', 'can_manage' => $canCreate || $canEdit, 'can_create' => $canCreate, 'can_edit' => $canEdit, 'can_preview' => $user['role_name'] === 'owner',
        'server_time' => (new DateTimeImmutable('now', new DateTimeZone('Asia/Manila')))->format('Y-m-d\TH:i'),
        'policy' => $conn->query('SELECT * FROM session_automation WHERE automation_id = 1')->fetch(PDO::FETCH_ASSOC) ?: null,
        'worker' => $conn->query('SELECT * FROM session_automation_worker WHERE worker_id = 1')->fetch(PDO::FETCH_ASSOC)]);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') AuthGuard::deny(405, 'Use POST to change automation.');
if (in_array($operation, ['preview', 'send_preview_email'], true)) {
    if ($user['role_name'] !== 'owner') AuthGuard::deny(403, 'Only the owner can preview session timing.');
    $value = $input['preview_at'] ?? null;
    $time = is_string($value) ? DateTimeImmutable::createFromFormat('!Y-m-d\TH:i', $value, new DateTimeZone('Asia/Manila')) : false;
    if (!$time || $time->format('Y-m-d\TH:i') !== $value) AuthGuard::deny(422, 'Choose a valid date and time in Philippine time.');
    if ($operation === 'send_preview_email' && (!isset($input['preference_ids']) || !is_array($input['preference_ids']))) AuthGuard::deny(422, 'Select a preview meeting.');
    try {
        if ($operation === 'send_preview_email') {
            // PHP's session lock serializes double-clicks from the same owner account.
            $key = hash('sha256', $value . json_encode($input['preference_ids']));
            foreach (($_SESSION['timing_preview_emails'] ?? []) as $storedKey => $sentAt) {
                if ($sentAt < time() - 86400) unset($_SESSION['timing_preview_emails'][$storedKey]);
            }
            if (isset($_SESSION['timing_preview_emails'][$key])) {
                echo json_encode(['status' => 'success', 'already_sent' => true, 'email_sent' => true, 'message' => 'Email already sent for this timing test.']);
            } else {
                $sent = sendSessionTimingPreviewEmail($conn, new EmailService($conn), $time, $input['preference_ids']);
                $_SESSION['timing_preview_emails'][$key] = time();
                echo json_encode(array_merge(['status' => 'success', 'message' => 'Email sent. Attendance and enrollment records were not changed.'], $sent));
            }
        } else {
            $preview = runSessionAutomation($conn, true, 0, $time);
            if (!empty($preview['busy'])) AuthGuard::deny(409, 'A session check is running. Try the preview again shortly.');
            echo json_encode(array_merge(['status' => 'success'], $preview));
        }
    } catch (Throwable $error) {
        error_log('Session timing preview failed: ' . $error->getMessage());
        http_response_code($error instanceof DomainException ? 409 : 500);
        echo json_encode(['status' => 'error', 'message' => $error instanceof DomainException ? $error->getMessage()
            : ($operation === 'send_preview_email' ? 'Email could not be sent. Check the SMTP settings and try again.' : 'Unable to preview session timing. Try again shortly.')]);
    }
    exit;
}
if (!in_array($operation, ['create', 'update', 'delete'], true)) AuthGuard::deny(400, 'Invalid operation.');
if ($operation === 'delete' ? !$canManage : ($operation === 'create' ? !$canCreate : !$canEdit)) {
    AuthGuard::deny(403, 'You do not have permission to change session automation.');
}
if ($operation !== 'delete') {
    foreach (['auto_no_show', 'auto_done'] as $field) {
        if (!isset($input[$field]) || !in_array($input[$field], [true, false, 0, 1], true)) AuthGuard::deny(422, 'Invalid automation switch.');
    }
    foreach (['no_show_minutes', 'done_delay_minutes'] as $field) {
        if (!isset($input[$field]) || filter_var($input[$field], FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 1440]]) === false) {
            AuthGuard::deny(422, 'Timing must be a whole number between 0 and 1440 minutes.');
        }
    }
}
$lockName = sessionAutomationLockName($conn);
$lock = $conn->prepare('SELECT GET_LOCK(?, 5)');
$lock->execute([$lockName]);
if ((int) $lock->fetchColumn() !== 1) AuthGuard::deny(409, 'Automation is running. Try again shortly.');
try {
    $conn->beginTransaction();
    $existing = $conn->query('SELECT * FROM session_automation WHERE automation_id = 1 FOR UPDATE')->fetch(PDO::FETCH_ASSOC);
    if ($operation === 'create' && $existing) throw new DomainException('A global policy already exists. Edit that policy instead.');
    if ($operation !== 'create' && !$existing) throw new DomainException('The policy no longer exists. Refresh and try again.');
    if ($operation === 'delete') {
        $conn->exec('DELETE FROM session_automation WHERE automation_id = 1');
        $snapshot = $existing;
    } else {
        $effectiveFrom = $existing['effective_from'] ?? (new DateTimeImmutable('now', new DateTimeZone('Asia/Manila')))->format('Y-m-d H:i:s');
        $snapshot = ['automation_id' => 1, 'auto_no_show' => (int) $input['auto_no_show'],
            'no_show_minutes' => (int) $input['no_show_minutes'], 'auto_done' => (int) $input['auto_done'],
            'done_delay_minutes' => (int) $input['done_delay_minutes'], 'effective_from' => $effectiveFrom,
            'updated_by' => $user['user_id']];
        $conn->prepare('INSERT INTO session_automation (automation_id, auto_no_show, no_show_minutes, auto_done, done_delay_minutes, effective_from, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE auto_no_show = VALUES(auto_no_show), no_show_minutes = VALUES(no_show_minutes),
            auto_done = VALUES(auto_done), done_delay_minutes = VALUES(done_delay_minutes), updated_by = VALUES(updated_by)')
            ->execute(array_values($snapshot));
    }
    $conn->prepare('INSERT INTO session_automation_history (action, employee_id, settings_json) VALUES (?, ?, ?)')
        ->execute([$operation, $user['user_id'], json_encode($snapshot)]);
    $conn->commit();
    echo json_encode(['status' => 'success', 'message' => $operation === 'delete' ? 'Policy deleted. Automatic updates are stopped.' : 'Session automation saved.']);
} catch (Throwable $error) {
    if ($conn->inTransaction()) $conn->rollBack();
    http_response_code($error instanceof DomainException ? 409 : 500);
    if (!($error instanceof DomainException)) error_log('Automation settings failed: ' . $error->getMessage());
    echo json_encode(['status' => 'error', 'message' => $error instanceof DomainException ? $error->getMessage() : 'Unable to save automation settings.']);
} finally {
    $conn->prepare('SELECT RELEASE_LOCK(?)')->execute([$lockName]);
}
