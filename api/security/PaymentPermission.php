<?php
require_once __DIR__ . '/AuthGuard.php';

final class PaymentPermission
{
    private const DEFAULTS = [
        'owner' => ['view', 'create', 'edit', 'approve', 'export'],
        'secretary' => ['view', 'create', 'edit', 'approve', 'export'],
        'branch admin' => ['view', 'create', 'edit', 'approve', 'export'],
        'auditor' => ['view', 'approve', 'export'],
        'teacher' => ['view', 'export'],
    ];

    public static function canPerform(string $role, string $permission, array $overrides = []): bool
    {
        $defaults = self::DEFAULTS[$role] ?? [];
        $enabled = static function (string $key) use ($defaults, $overrides): bool {
            return is_bool($overrides[$key] ?? null) ? $overrides[$key] : in_array($key, $defaults, true);
        };
        if (!$enabled('view')) return false;
        if ($permission === 'adjust_penalty') {
            return is_bool($overrides['adjust_penalty'] ?? null)
                ? $overrides['adjust_penalty'] : ($enabled('edit') && $enabled('approve'));
        }
        return $enabled($permission);
    }

    public static function requirePermission(string $permission): array
    {
        $actor = AuthGuard::requireUser();
        $role = preg_replace('/[\s_-]+/', ' ', strtolower(trim((string) $actor['role_name'])));
        if ($actor['user_type'] !== 'employee') {
            AuthGuard::deny(403, 'Payment staff permission required.');
        }

        $permissions = [];
        try {
            $stmt = AuthGuard::connection()->prepare(
                "SELECT permissions_json FROM role_module_permissions WHERE role_name = ? AND module_key = 'payment' LIMIT 1"
            );
            $stmt->execute([$role]);
            $stored = $stmt->fetchColumn();
            if ($stored !== false) {
                $permissions = json_decode((string) $stored, true);
            }
        } catch (PDOException $error) {
            // Older installations may not have the optional RBAC table yet.
            if ($error->getCode() !== '42S02' && (int) ($error->errorInfo[1] ?? 0) !== 1146) {
                error_log('Payment permission lookup failed: ' . $error->getMessage());
                AuthGuard::deny(503, 'Payment permissions are temporarily unavailable.');
            }
        }

        if (!self::canPerform($role, $permission, is_array($permissions) ? $permissions : [])) {
            AuthGuard::deny(403, 'You do not have permission for this payment action.');
        }
        return $actor;
    }
}
