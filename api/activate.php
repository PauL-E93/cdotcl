<?php
require_once __DIR__ . '/security/AccountActivation.php';
header('Content-Type: application/json');
header('Cache-Control: no-store');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') AuthGuard::deny(405, 'Method not allowed.');
AuthGuard::requireSameOrigin();
$data = json_decode(file_get_contents('php://input'), true);
if (!is_array($data)) AuthGuard::deny(400, 'Invalid request.');
$password = $data['password'] ?? null;
if (!PasswordPolicy::valid($password)
    || $password !== ($data['confirm_password'] ?? null)) {
    AuthGuard::deny(422, PasswordPolicy::message() . ' Both entries must match.');
}
try {
    $ok = AccountActivation::activate(AuthGuard::connection(), (string) ($data['type'] ?? ''),
        (string) ($data['token'] ?? ''), $password);
    if (!$ok) AuthGuard::deny(400, 'This activation link is invalid or expired. Contact the center for a new link.');
    echo json_encode(['status' => 'success', 'message' => 'Account activated. You can now log in.']);
} catch (Throwable $e) {
    error_log('Account activation failed: ' . $e->getMessage());
    AuthGuard::deny(503, 'Activation is temporarily unavailable.');
}
