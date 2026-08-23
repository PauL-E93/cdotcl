<?php

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/../grade_level_helper.php';

class GradeLevelAPI
{
    private PDO $conn;

    public function __construct()
    {
        include __DIR__ . '/connection-pdo.php';
        $this->conn = $conn;
        ensureGradeLevelSchema($this->conn);
    }

    private function respond(string $status, string $message = '', array $extra = [], int $httpStatus = 200): void
    {
        http_response_code($httpStatus);
        echo json_encode(array_merge(['status' => $status, 'message' => $message], $extra));
    }

    private function normalizeRole($value): string
    {
        return preg_replace('/[\s_-]+/', ' ', strtolower(trim((string)$value)));
    }

    private function resolvedPermissions(): array
    {
        $role = $this->normalizeRole($_SESSION['user_role'] ?? '');
        $employeeId = (int)($_SESSION['employee_id'] ?? 0);
        if ($employeeId <= 0 || $role === '' || $role === 'student') {
            throw new RuntimeException('Staff login is required.', 401);
        }

        $permissions = [
            'view' => false,
            'view_grades' => false,
            'create_grades' => false,
            'edit_grades' => false
        ];

        if ($role === 'owner' || $role === 'secretary') {
            $permissions = array_fill_keys(array_keys($permissions), true);
        } elseif ($role === 'auditor') {
            $permissions['view'] = true;
            $permissions['view_grades'] = true;
        }

        $table = $this->conn->query("SHOW TABLES LIKE 'role_module_permissions'")->fetchColumn();
        if ($table) {
            $stmt = $this->conn->prepare("SELECT permissions_json FROM role_module_permissions WHERE role_name = ? AND module_key = 'program' LIMIT 1");
            $stmt->execute([$role]);
            $stored = json_decode((string)($stmt->fetchColumn() ?: '{}'), true);
            if (is_array($stored)) {
                foreach ($permissions as $key => $value) {
                    if (array_key_exists($key, $stored) && is_bool($stored[$key])) {
                        $permissions[$key] = $stored[$key];
                    }
                }
            }
        }

        return $permissions;
    }

    private function requirePermission(string $permission): void
    {
        $permissions = $this->resolvedPermissions();
        if (empty($permissions['view']) || empty($permissions[$permission])) {
            throw new RuntimeException('You do not have permission to manage grade levels.', 403);
        }
    }

    public function payload(): array
    {
        $body = json_decode(file_get_contents('php://input'), true);
        if (is_array($body)) {
            $data = $body['json'] ?? $body;
            if (is_string($data)) {
                $data = json_decode($data, true);
            }
            return is_array($data) ? $data : [];
        }

        $data = json_decode((string)($_POST['json'] ?? ''), true);
        return is_array($data) ? $data : [];
    }

    private function validatedFields(array $data): array
    {
        $name = trim(preg_replace('/\s+/', ' ', (string)($data['grade_level'] ?? '')));
        $status = strtolower(trim((string)($data['status'] ?? 'active')));

        if ($name === '') {
            throw new InvalidArgumentException('Grade level name is required.', 422);
        }
        if (mb_strlen($name) > 50) {
            throw new InvalidArgumentException('Grade level name must be 50 characters or fewer.', 422);
        }
        if (!in_array($status, ['active', 'inactive'], true)) {
            throw new InvalidArgumentException('Grade level status must be active or inactive.', 422);
        }

        return [$name, $status];
    }

    public function list(): void
    {
        $this->requirePermission('view_grades');

        $rows = $this->conn->query('SELECT grade_level_id, grade_level, status FROM grade_level ORDER BY grade_level_id ASC')
            ->fetchAll(PDO::FETCH_ASSOC);
        $this->respond('success', '', ['data' => $rows]);
    }

    public function create(array $data): void
    {
        $this->requirePermission('create_grades');
        [$name, $status] = $this->validatedFields($data);

        $duplicate = $this->conn->prepare('SELECT 1 FROM grade_level WHERE LOWER(TRIM(grade_level)) = LOWER(TRIM(?)) LIMIT 1');
        $duplicate->execute([$name]);
        if ($duplicate->fetchColumn()) {
            throw new InvalidArgumentException('That grade level already exists.', 409);
        }

        $stmt = $this->conn->prepare('INSERT INTO grade_level (grade_level, status) VALUES (?, ?)');
        $stmt->execute([$name, $status]);
        $this->respond('success', 'Grade level added successfully.', ['grade_level_id' => (int)$this->conn->lastInsertId()], 201);
    }

    public function update(array $data): void
    {
        $this->requirePermission('edit_grades');
        $id = (int)($data['grade_level_id'] ?? 0);
        if ($id <= 0) {
            throw new InvalidArgumentException('Grade level is required.', 422);
        }
        [$name, $status] = $this->validatedFields($data);

        $exists = $this->conn->prepare('SELECT 1 FROM grade_level WHERE grade_level_id = ?');
        $exists->execute([$id]);
        if (!$exists->fetchColumn()) {
            throw new RuntimeException('Grade level was not found.', 404);
        }

        $duplicate = $this->conn->prepare('SELECT 1 FROM grade_level WHERE LOWER(TRIM(grade_level)) = LOWER(TRIM(?)) AND grade_level_id <> ? LIMIT 1');
        $duplicate->execute([$name, $id]);
        if ($duplicate->fetchColumn()) {
            throw new InvalidArgumentException('That grade level already exists.', 409);
        }

        $stmt = $this->conn->prepare('UPDATE grade_level SET grade_level = ?, status = ? WHERE grade_level_id = ?');
        $stmt->execute([$name, $status, $id]);
        $this->respond('success', 'Grade level updated successfully.');
    }

}

$operation = $_GET['operation'] ?? '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);
    $operation = $body['operation'] ?? ($_POST['operation'] ?? $operation);
}

try {
    $api = new GradeLevelAPI();
    switch ($operation) {
        case 'getGradeLevels':
            $api->list();
            break;
        case 'addGradeLevel':
            $api->create($api->payload());
            break;
        case 'updateGradeLevel':
            $api->update($api->payload());
            break;
        default:
            http_response_code(400);
            echo json_encode(['status' => 'error', 'message' => 'Invalid operation.']);
    }
} catch (Throwable $exception) {
    $status = (int)$exception->getCode();
    if ($status < 400 || $status > 599) {
        $status = 500;
    }
    http_response_code($status);
    echo json_encode(['status' => 'error', 'message' => $exception->getMessage()]);
}
