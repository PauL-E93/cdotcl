<?php
require_once __DIR__ . '/AuthGuard.php';

final class EnrollmentPermission
{
    private const DEFAULTS = [
        'owner' => ['view', 'create', 'edit', 'delete', 'approve', 'export', 'extend_tutorial_validity'],
        'secretary' => ['view', 'create', 'edit', 'approve', 'export'],
        'branch admin' => ['view', 'create', 'edit', 'approve', 'export'],
        'auditor' => ['view', 'export'],
        'teacher' => ['view', 'export'],
    ];

    public static function requirePermission(string $permission): array
    {
        $actor = AuthGuard::requireUser();
        if ($actor['user_type'] !== 'employee') {
            AuthGuard::deny(403, 'Enrollment staff permission required.');
        }

        $role = preg_replace('/[\s_-]+/', ' ', strtolower(trim((string) $actor['role_name'])));
        $defaults = self::DEFAULTS[$role] ?? [];
        $canView = in_array('view', $defaults, true);
        $allowed = in_array($permission, $defaults, true);
        try {
            $stmt = AuthGuard::connection()->prepare(
                "SELECT permissions_json FROM role_module_permissions WHERE role_name = ? AND module_key = 'enrollment' LIMIT 1"
            );
            $stmt->execute([$role]);
            $stored = $stmt->fetchColumn();
            if ($stored !== false) {
                $permissions = json_decode((string) $stored, true);
                if (is_array($permissions)) {
                    if (isset($permissions['view']) && is_bool($permissions['view'])) {
                        $canView = $permissions['view'];
                    }
                    if (isset($permissions[$permission]) && is_bool($permissions[$permission])) {
                        $allowed = $permissions[$permission];
                    }
                }
            }
        } catch (PDOException $error) {
            if ($error->getCode() !== '42S02' && (int) ($error->errorInfo[1] ?? 0) !== 1146) {
                error_log('Enrollment permission lookup failed: ' . $error->getMessage());
                AuthGuard::deny(503, 'Enrollment permissions are temporarily unavailable.');
            }
        }

        if (!$canView || !$allowed) {
            AuthGuard::deny(403, 'You do not have permission for this enrollment action.');
        }
        return $actor;
    }
}
