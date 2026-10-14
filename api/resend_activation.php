<?php
require_once __DIR__ . '/security/AccountActivation.php';
require_once __DIR__ . '/email_service.php';
header('Content-Type: application/json');
$actor = AuthGuard::requireRoles(['owner', 'secretary', 'branch admin']);
if ($_SERVER['REQUEST_METHOD'] !== 'POST') AuthGuard::deny(405, 'Method not allowed.');
$data = json_decode(file_get_contents('php://input'), true);
$type = is_array($data) ? (string) ($data['type'] ?? '') : '';
$id = is_array($data) ? (int) ($data['user_id'] ?? 0) : 0;
if (!in_array($type, ['employee', 'student'], true) || $id <= 0) AuthGuard::deny(400, 'Invalid account.');
try {
    $db = AuthGuard::connection();
    $account = AuthGuard::account($db, $type, $id);
    if (!$account || empty($account['password_is_temporary'])) AuthGuard::deny(409, 'This account does not need a temporary credential.');
    if ($type === 'employee' && $actor['role_name'] !== 'owner'
        && in_array(preg_replace('/[\s_-]+/', ' ', strtolower($account['role_name'])), ['owner', 'secretary', 'branch admin'], true)) AuthGuard::deny();
    if ($type === 'employee' && $actor['role_name'] === 'branch admin'
        && (int) ($account['branch_id'] ?? 0) !== (int) ($_SESSION['branch_id'] ?? 0)) AuthGuard::deny();
    if ($type === 'student' && $actor['role_name'] === 'branch admin') {
        $branchId = (int) ($_SESSION['branch_id'] ?? 0);
        $check = $db->prepare('SELECT 1 FROM student s LEFT JOIN employee e ON e.employee_id = s.employee_id
            WHERE s.student_id = ? AND (e.branch_id = ? OR EXISTS (
                SELECT 1 FROM enrollment_header eh WHERE eh.student_id = s.student_id AND eh.branch_id = ?)) LIMIT 1');
        $check->execute([$id, $branchId, $branchId]);
        if (!$check->fetchColumn()) AuthGuard::deny();
    }
    $email = (string) ($account['email'] ?? '');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) AuthGuard::deny(422, 'The account needs a valid email.');
    AccountActivation::ensureSchema($db);
    $db->beginTransaction();
    try {
        $idColumn = $type === 'employee' ? 'employee_id' : 'student_id';
        $temporaryPassword = $type === 'student' ? 'Cdo!' . bin2hex(random_bytes(6)) : bin2hex(random_bytes(32));
        $db->prepare("UPDATE `$type` SET password_hash = ?, password_changed_at = NOW() WHERE `$idColumn` = ?")
            ->execute([password_hash($temporaryPassword, PASSWORD_DEFAULT), $id]);
        if ($type === 'student') {
            $db->prepare('DELETE FROM account_activations WHERE user_type = ? AND user_id = ?')
                ->execute(['student', $id]);
        } else {
            $url = AccountActivation::issue($db, $type, $id);
        }
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
    if ($type === 'student') {
        $username = (string) ($account['username'] ?? '');
        $safeUsername = htmlspecialchars($username, ENT_QUOTES, 'UTF-8');
        $safePassword = htmlspecialchars($temporaryPassword, ENT_QUOTES, 'UTF-8');
        $sent = (new EmailService($db))->send($email, 'Your CDO Tutor temporary password',
            "<p>Username: {$safeUsername}</p><p>Temporary password: {$safePassword}</p><p>Sign in with this password, then create a new password before continuing. Do not share your password.</p>",
            ['alt_body' => "Username: {$username}. Temporary password: {$temporaryPassword}. Sign in with this password, then create a new password before continuing. Do not share your password."]);
    } else {
        $safeUrl = htmlspecialchars($url, ENT_QUOTES, 'UTF-8');
        $sent = (new EmailService($db))->send($email, 'Activate your CDO Tutor account',
            "<p>Use this one-time link within 24 hours to choose your password:</p><p><a href='{$safeUrl}'>Activate account</a></p>",
            ['alt_body' => "Use this one-time link within 24 hours to choose your password: {$url}"]);
    }
    if (!$sent) AuthGuard::deny(502, 'The account email could not be sent.');
    echo json_encode(['status' => 'success', 'message' => $type === 'student' ? 'Temporary password sent.' : 'Activation link sent.']);
} catch (Throwable $e) {
    error_log('Resend activation failed: ' . $e->getMessage());
    AuthGuard::deny(503, 'Account email is temporarily unavailable.');
}
