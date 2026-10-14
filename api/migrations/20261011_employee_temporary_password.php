<?php
// Repair accounts created with generated passwords before temporary setup was enabled.
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit;
}
require_once __DIR__ . '/../security/EmployeeCredentials.php';
require __DIR__ . '/../admin/connection-pdo.php';
EmployeeCredentials::ensureSchema($conn);
$accounts = $conn->query("SELECT e.employee_id, e.password_hash, c.password_encrypted
    FROM employee e JOIN employee_generated_credentials c ON c.employee_id = e.employee_id
    WHERE e.status = 'active' AND e.password_is_temporary = 0")->fetchAll(PDO::FETCH_ASSOC);
$update = $conn->prepare("UPDATE employee SET status = 'inactive', password_is_temporary = 1
    WHERE employee_id = ? AND password_hash = ? AND status = 'active' AND password_is_temporary = 0");
$count = 0;
$conn->beginTransaction();
try {
    foreach ($accounts as $account) {
        $password = SecretCipher::decrypt($account['password_encrypted']);
        if (!password_verify($password, $account['password_hash'])) continue;
        $update->execute([$account['employee_id'], $account['password_hash']]);
        $count += $update->rowCount();
    }
    $conn->commit();
} catch (Throwable $error) {
    $conn->rollBack();
    throw new RuntimeException('Unable to repair employee password setup.', 0, $error);
}
echo "Updated {$count} employee account(s) to inactive with mandatory temporary password setup.\n";
