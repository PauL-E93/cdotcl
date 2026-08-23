<?php

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

class StudentManagementAPI
{
    private PDO $conn;

    public function __construct()
    {
        include __DIR__ . '/connection-pdo.php';
        $this->conn = $conn;
    }

    private function respond(string $status, string $message = '', array $extra = [], int $httpStatus = 200): void
    {
        http_response_code($httpStatus);
        echo json_encode(
            array_merge(['status' => $status, 'message' => $message], $extra),
            JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
        );
    }

    private function normalizeRole($value): string
    {
        $role = strtolower(trim((string) $value));
        return preg_replace('/[\s_-]+/', ' ', $role);
    }

    private function requireAdmin(): array
    {
        $role = $this->normalizeRole($_SESSION['user_role'] ?? '');
        $allowedRoles = ['owner', 'secretary', 'branch admin', 'auditor'];
        $employeeId = (int) ($_SESSION['employee_id'] ?? 0);

        if (!in_array($role, $allowedRoles, true) || $employeeId <= 0) {
            throw new RuntimeException('Administrator login is required.', 401);
        }

        $admin = [
            'employee_id' => $employeeId,
            'role' => $role,
            'branch_id' => (int) ($_SESSION['branch_id'] ?? 0)
        ];

        if ($role === 'branch admin' && $admin['branch_id'] <= 0) {
            throw new RuntimeException('Branch admin account is not assigned to a branch.', 403);
        }

        return $admin;
    }

    private function defaultEnrollmentPermission(string $role, string $permission): bool
    {
        $defaults = [
            'owner' => ['view', 'create', 'edit', 'delete', 'approve', 'export'],
            'secretary' => ['view', 'create', 'edit', 'approve', 'export'],
            'branch admin' => ['view', 'create', 'edit', 'approve', 'export'],
            'auditor' => ['view', 'export']
        ];

        return in_array($permission, $defaults[$role] ?? [], true);
    }

    private function hasEnrollmentPermission(array $admin, string $permission): bool
    {
        if ($admin['role'] === 'owner') {
            return true;
        }

        $allowed = $this->defaultEnrollmentPermission($admin['role'], $permission);

        try {
            $stmt = $this->conn->prepare(
                "SELECT permissions_json
                 FROM role_module_permissions
                 WHERE role_name = :role_name AND module_key = 'enrollment'
                 LIMIT 1"
            );
            $stmt->execute([':role_name' => $admin['role']]);
            $stored = $stmt->fetchColumn();

            if ($stored !== false) {
                $permissions = json_decode((string) $stored, true);
                if (is_array($permissions)) {
                    if (array_key_exists($permission, $permissions)) {
                        return (bool) $permissions[$permission];
                    }
                    if ($permission === 'view' && array_key_exists('can', $permissions)) {
                        return (bool) $permissions['can'];
                    }
                }
            }
        } catch (Throwable $error) {
            // Older installations may not have the RBAC table yet. The role
            // defaults above preserve the application's existing behavior.
        }

        return $allowed;
    }

    private function requirePermission(array $admin, string $permission): void
    {
        if (!$this->hasEnrollmentPermission($admin, $permission)) {
            throw new RuntimeException("You do not have permission to {$permission} student records.", 403);
        }
    }

    private function assertStudentAccessible(array $admin, int $studentId): void
    {
        if ($studentId <= 0) {
            throw new RuntimeException('A valid student is required.', 422);
        }

        $sql = 'SELECT 1 FROM student s WHERE s.student_id = :student_id';
        $params = [':student_id' => $studentId];

        if ($admin['role'] === 'branch admin') {
            $sql .= ' AND EXISTS (
                SELECT 1
                FROM enrollment_header eh
                WHERE eh.student_id = s.student_id AND eh.branch_id = :branch_id
            )';
            $params[':branch_id'] = $admin['branch_id'];
        }

        $stmt = $this->conn->prepare($sql . ' LIMIT 1');
        $stmt->execute($params);
        if (!$stmt->fetchColumn()) {
            throw new RuntimeException('Student not found or unavailable for your branch.', 404);
        }
    }

    private function fetchStudents(array $admin): array
    {
        $sql = "SELECT s.student_id, s.student_id_number, s.lrn, s.username, s.email,
                       s.first_name, s.middle_name, s.last_name, s.ext, s.nickname,
                       s.birthday, s.gender_id, gdr.gender, s.guardian_id,
                       g.name AS guardian_name, g.contact_number AS guardian_contact,
                       g.relationship AS guardian_relationship,
                       s.adr_street, s.adr_barangay, s.adr_city, s.adr_province,
                       s.adr_note, s.health_note, s.profile_picture,
                       COALESCE(NULLIF(s.status, ''), 'inactive') AS student_status,
                       s.date_created
                FROM student s
                LEFT JOIN guardian g ON g.guardian_id = s.guardian_id
                LEFT JOIN gender gdr ON gdr.gender_id = s.gender_id";
        $params = [];

        if ($admin['role'] === 'branch admin') {
            $sql .= " WHERE EXISTS (
                SELECT 1
                FROM enrollment_header eh_scope
                WHERE eh_scope.student_id = s.student_id
                  AND eh_scope.branch_id = ?
            )";
            $params[] = $admin['branch_id'];
        }

        $sql .= ' ORDER BY s.last_name ASC, s.first_name ASC, s.student_id DESC';
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        $students = $stmt->fetchAll(PDO::FETCH_ASSOC);

        if (!$students) {
            return [];
        }

        $studentIds = array_map(static fn ($row) => (int) $row['student_id'], $students);
        $placeholders = implode(',', array_fill(0, count($studentIds), '?'));
        $enrollmentParams = $studentIds;

        $enrollmentSql = "SELECT eh.student_id, eh.enrollment_header_id, eh.branch_id,
                                 eh.status AS header_status, eh.date_created AS enrollment_date,
                                 ed.enrollment_details_id, ed.program_id, ed.status AS details_status,
                                 p.name AS program_name, pt.type AS program_type_name,
                                 b.branch_name, sy.school_year,
                                 COALESCE(NULLIF(eh.status, ''), NULLIF(ed.status, ''), 'none') AS enrollment_status
                          FROM enrollment_header eh
                          INNER JOIN enrollment_details ed ON ed.enrollment_header_id = eh.enrollment_header_id
                          LEFT JOIN program p ON p.program_id = ed.program_id
                          LEFT JOIN program_type pt ON pt.program_type_id = p.program_type
                          LEFT JOIN branch b ON b.branch_id = eh.branch_id
                          LEFT JOIN school_years sy ON sy.school_year_id = eh.school_year_id
                          WHERE eh.student_id IN ({$placeholders})";

        if ($admin['role'] === 'branch admin') {
            $enrollmentSql .= ' AND eh.branch_id = ?';
            $enrollmentParams[] = $admin['branch_id'];
        }

        $enrollmentSql .= " ORDER BY eh.student_id ASC,
                            CASE WHEN eh.status = 'enrolled' OR ed.status IN ('enrolled', 'active') THEN 0 ELSE 1 END ASC,
                            eh.date_created DESC, ed.enrollment_details_id DESC";

        $stmt = $this->conn->prepare($enrollmentSql);
        $stmt->execute($enrollmentParams);
        $enrollmentRows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $enrollmentsByStudent = [];
        foreach ($enrollmentRows as $enrollment) {
            $studentId = (int) $enrollment['student_id'];
            if (!isset($enrollmentsByStudent[$studentId])) {
                $enrollmentsByStudent[$studentId] = [];
            }
            $enrollmentsByStudent[$studentId][] = $enrollment;
        }

        foreach ($students as &$student) {
            $studentId = (int) $student['student_id'];
            $enrollments = $enrollmentsByStudent[$studentId] ?? [];
            $latest = $enrollments[0] ?? null;
            $activePrograms = [];
            $activeBranches = [];
            $activeProgramIds = [];
            $activeBranchIds = [];
            $programIds = [];
            $branchIds = [];

            foreach ($enrollments as $enrollment) {
                if (!empty($enrollment['program_id'])) {
                    $programIds[(string) $enrollment['program_id']] = true;
                }
                if (!empty($enrollment['branch_id'])) {
                    $branchIds[(string) $enrollment['branch_id']] = true;
                }

                $isCurrent = $enrollment['header_status'] === 'enrolled'
                    || in_array($enrollment['details_status'], ['enrolled', 'active'], true);
                if (!$isCurrent) {
                    continue;
                }

                $programName = trim((string) ($enrollment['program_name'] ?? ''));
                $branchName = trim((string) ($enrollment['branch_name'] ?? ''));
                if ($programName !== '') {
                    $activePrograms[$programName] = true;
                }
                if ($branchName !== '') {
                    $activeBranches[$branchName] = true;
                }
                if (!empty($enrollment['program_id'])) {
                    $activeProgramIds[(string) $enrollment['program_id']] = true;
                }
                if (!empty($enrollment['branch_id'])) {
                    $activeBranchIds[(string) $enrollment['branch_id']] = true;
                }
            }

            if (!$activePrograms && !empty($latest['program_name'])) {
                $activePrograms[trim((string) $latest['program_name'])] = true;
                if (!empty($latest['program_id'])) {
                    $activeProgramIds[(string) $latest['program_id']] = true;
                }
            }
            if (!$activeBranches && !empty($latest['branch_name'])) {
                $activeBranches[trim((string) $latest['branch_name'])] = true;
                if (!empty($latest['branch_id'])) {
                    $activeBranchIds[(string) $latest['branch_id']] = true;
                }
            }

            $student['program_ids'] = array_keys($programIds);
            $student['branch_ids'] = array_keys($branchIds);
            $student['current_program_ids'] = array_keys($activeProgramIds);
            $student['current_branch_ids'] = array_keys($activeBranchIds);
            $student['current_programs'] = array_keys($activePrograms);
            $student['current_branches'] = array_keys($activeBranches);
            $student['current_program'] = $activePrograms ? implode(', ', array_keys($activePrograms)) : null;
            $student['current_branch'] = $activeBranches ? implode(', ', array_keys($activeBranches)) : null;
            $student['enrollment_status'] = $latest['enrollment_status'] ?? 'none';
            $student['latest_enrollment_details_id'] = $latest['enrollment_details_id'] ?? null;
            $student['latest_program_id'] = $latest['program_id'] ?? null;
            $student['latest_program_type'] = $latest['program_type_name'] ?? null;
            $student['latest_enrollment_date'] = $latest['enrollment_date'] ?? null;
            $student['school_year'] = $latest['school_year'] ?? null;
            $student['enrollment_count'] = count($enrollments);
        }
        unset($student);

        return $students;
    }

    public function listStudents(): void
    {
        $admin = $this->requireAdmin();
        $this->requirePermission($admin, 'view');
        $students = $this->fetchStudents($admin);

        $this->respond('success', '', [
            'data' => $students,
            'meta' => [
                'total' => count($students),
                'can_edit' => $this->hasEnrollmentPermission($admin, 'edit') && $admin['role'] !== 'auditor',
                'can_export' => $this->hasEnrollmentPermission($admin, 'export'),
                'role' => $admin['role'],
                'branch_id' => $admin['role'] === 'branch admin' ? $admin['branch_id'] : null
            ]
        ]);
    }

    public function getLookups(): void
    {
        $admin = $this->requireAdmin();
        $this->requirePermission($admin, 'view');

        $programs = $this->conn->query(
            "SELECT p.program_id, p.name, pt.type AS program_type
             FROM program p
             LEFT JOIN program_type pt ON pt.program_type_id = p.program_type
             WHERE p.status = 'active'
             ORDER BY p.name ASC, pt.type ASC"
        )->fetchAll(PDO::FETCH_ASSOC);

        if ($admin['role'] === 'branch admin') {
            $stmt = $this->conn->prepare(
                "SELECT branch_id, TRIM(branch_name) AS branch_name
                 FROM branch WHERE branch_id = ? LIMIT 1"
            );
            $stmt->execute([$admin['branch_id']]);
            $branches = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } else {
            $branches = $this->conn->query(
                "SELECT branch_id, TRIM(branch_name) AS branch_name
                 FROM branch ORDER BY branch_name ASC"
            )->fetchAll(PDO::FETCH_ASSOC);
        }

        $genders = $this->conn->query(
            'SELECT gender_id, gender FROM gender ORDER BY gender ASC'
        )->fetchAll(PDO::FETCH_ASSOC);

        $this->respond('success', '', [
            'data' => [
                'programs' => $programs,
                'branches' => $branches,
                'genders' => $genders
            ]
        ]);
    }

    public function getStudentDetails(int $studentId): void
    {
        $admin = $this->requireAdmin();
        $this->requirePermission($admin, 'view');
        $this->assertStudentAccessible($admin, $studentId);

        $stmt = $this->conn->prepare(
            "SELECT s.student_id, s.student_id_number, s.lrn, s.username, s.email,
                    s.first_name, s.middle_name, s.last_name, s.ext, s.nickname,
                    s.birthday, s.gender_id, gdr.gender, s.guardian_id,
                    g.name AS guardian_name, g.contact_number AS guardian_contact,
                    g.relationship AS guardian_relationship,
                    s.adr_street, s.adr_barangay, s.adr_city, s.adr_province,
                    s.adr_note, s.health_note, s.profile_picture,
                    COALESCE(NULLIF(s.status, ''), 'inactive') AS student_status,
                    s.date_created
             FROM student s
             LEFT JOIN guardian g ON g.guardian_id = s.guardian_id
             LEFT JOIN gender gdr ON gdr.gender_id = s.gender_id
             WHERE s.student_id = ? LIMIT 1"
        );
        $stmt->execute([$studentId]);
        $student = $stmt->fetch(PDO::FETCH_ASSOC);

        $params = [$studentId];
        $branchSql = '';
        if ($admin['role'] === 'branch admin') {
            $branchSql = ' AND eh.branch_id = ?';
            $params[] = $admin['branch_id'];
        }

        $stmt = $this->conn->prepare(
            "SELECT ed.enrollment_details_id, ed.program_id, p.name AS program_name,
                    pt.type AS program_type_name, eh.status AS header_status,
                    ed.status AS details_status,
                    COALESCE(NULLIF(eh.status, ''), NULLIF(ed.status, ''), 'none') AS enrollment_status,
                    eh.branch_id, TRIM(b.branch_name) AS branch_name,
                    sy.school_year, gl.grade_level,
                    COALESCE(esub.subject_names, subj.subject_name) AS subject_names,
                    TRIM(CONCAT_WS(' ', emp.first_name, emp.middle_name, emp.last_name)) AS teacher_name,
                    eh.date_created AS enrollment_date
             FROM enrollment_header eh
             INNER JOIN enrollment_details ed ON ed.enrollment_header_id = eh.enrollment_header_id
             LEFT JOIN program p ON p.program_id = ed.program_id
             LEFT JOIN program_type pt ON pt.program_type_id = p.program_type
             LEFT JOIN branch b ON b.branch_id = eh.branch_id
             LEFT JOIN school_years sy ON sy.school_year_id = eh.school_year_id
             LEFT JOIN grade_level gl ON gl.grade_level_id = ed.grade_level_id
             LEFT JOIN subject subj ON subj.subject_id = ed.subject_id
             LEFT JOIN employee emp ON emp.employee_id = ed.preferred_teacher
             LEFT JOIN (
                 SELECT es.enrollment_details_id,
                        GROUP_CONCAT(DISTINCT s.subject_name ORDER BY s.subject_name SEPARATOR ', ') AS subject_names
                 FROM enrollment_subjects es
                 INNER JOIN subject s ON s.subject_id = es.subject_id
                 GROUP BY es.enrollment_details_id
             ) esub ON esub.enrollment_details_id = ed.enrollment_details_id
             WHERE eh.student_id = ?{$branchSql}
             ORDER BY eh.date_created DESC, ed.enrollment_details_id DESC"
        );
        $stmt->execute($params);
        $enrollments = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $audit = [];
        try {
            $stmt = $this->conn->prepare(
                "SELECT a.changed_fields_json, a.created_at,
                        TRIM(CONCAT_WS(' ', e.first_name, e.middle_name, e.last_name)) AS changed_by
                 FROM student_profile_audit a
                 LEFT JOIN employee e ON e.employee_id = a.employee_id
                 WHERE a.student_id = ?
                 ORDER BY a.created_at DESC, a.audit_id DESC
                 LIMIT 10"
            );
            $stmt->execute([$studentId]);
            $audit = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (Throwable $error) {
            // The audit table is created on the first profile update.
        }

        $this->respond('success', '', [
            'data' => [
                'student' => $student,
                'enrollments' => $enrollments,
                'audit' => $audit
            ]
        ]);
    }

    private function normalizeOptionalText(array $data, string $key): ?string
    {
        $value = trim((string) ($data[$key] ?? ''));
        return $value === '' ? null : $value;
    }

    private function ensureAuditTable(): void
    {
        $this->conn->exec(
            "CREATE TABLE IF NOT EXISTS student_profile_audit (
                audit_id INT AUTO_INCREMENT PRIMARY KEY,
                student_id INT NOT NULL,
                employee_id INT DEFAULT NULL,
                role_name VARCHAR(100) DEFAULT NULL,
                changed_fields_json LONGTEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                KEY idx_student_profile_audit_student (student_id),
                KEY idx_student_profile_audit_employee (employee_id),
                CONSTRAINT fk_student_profile_audit_student
                    FOREIGN KEY (student_id) REFERENCES student(student_id) ON DELETE CASCADE,
                CONSTRAINT fk_student_profile_audit_employee
                    FOREIGN KEY (employee_id) REFERENCES employee(employee_id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        );
    }

    public function updateStudent(array $data): void
    {
        $admin = $this->requireAdmin();
        $this->requirePermission($admin, 'edit');
        if ($admin['role'] === 'auditor') {
            throw new RuntimeException('Auditor accounts can view and export student records but cannot edit them.', 403);
        }

        $studentId = (int) ($data['student_id'] ?? 0);
        $this->assertStudentAccessible($admin, $studentId);

        $firstName = trim((string) ($data['first_name'] ?? ''));
        $lastName = trim((string) ($data['last_name'] ?? ''));
        if ($firstName === '' || $lastName === '') {
            throw new RuntimeException('First name and last name are required.', 422);
        }

        $email = $this->normalizeOptionalText($data, 'email');
        if ($email !== null && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new RuntimeException('Please enter a valid email address.', 422);
        }

        $birthday = $this->normalizeOptionalText($data, 'birthday');
        if ($birthday !== null) {
            $birthdayDate = DateTime::createFromFormat('Y-m-d', $birthday);
            if (!$birthdayDate || $birthdayDate->format('Y-m-d') !== $birthday) {
                throw new RuntimeException('Please enter a valid birthday.', 422);
            }
        }

        $status = strtolower(trim((string) ($data['student_status'] ?? 'active')));
        if (!in_array($status, ['active', 'inactive'], true)) {
            throw new RuntimeException('Student status must be active or inactive.', 422);
        }

        $genderId = (int) ($data['gender_id'] ?? 0);
        $genderId = $genderId > 0 ? $genderId : null;
        $studentIdNumber = $this->normalizeOptionalText($data, 'student_id_number');
        $lrn = $this->normalizeOptionalText($data, 'lrn');

        foreach ([['student_id_number', $studentIdNumber, 'Student ID'], ['lrn', $lrn, 'LRN']] as $uniqueField) {
            [$column, $value, $label] = $uniqueField;
            if ($value === null) {
                continue;
            }
            $stmt = $this->conn->prepare("SELECT student_id FROM student WHERE {$column} = ? AND student_id <> ? LIMIT 1");
            $stmt->execute([$value, $studentId]);
            if ($stmt->fetchColumn()) {
                throw new RuntimeException("{$label} is already assigned to another student.", 409);
            }
        }

        // DDL can implicitly commit a MySQL transaction, so prepare the audit
        // table before locking and updating the student record.
        $this->ensureAuditTable();
        $this->conn->beginTransaction();
        try {
            $stmt = $this->conn->prepare(
                "SELECT s.*, g.name AS guardian_name, g.contact_number AS guardian_contact,
                        g.relationship AS guardian_relationship
                 FROM student s
                 LEFT JOIN guardian g ON g.guardian_id = s.guardian_id
                 WHERE s.student_id = ? FOR UPDATE"
            );
            $stmt->execute([$studentId]);
            $before = $stmt->fetch(PDO::FETCH_ASSOC);

            $guardianId = (int) ($before['guardian_id'] ?? 0);
            $guardianName = $this->normalizeOptionalText($data, 'guardian_name');
            $guardianContact = $this->normalizeOptionalText($data, 'guardian_contact');
            $guardianRelationship = $this->normalizeOptionalText($data, 'guardian_relationship');
            $hasGuardianInput = $guardianName !== null || $guardianContact !== null || $guardianRelationship !== null;

            if ($guardianId > 0) {
                $stmt = $this->conn->prepare(
                    'UPDATE guardian SET name = ?, contact_number = ?, relationship = ? WHERE guardian_id = ?'
                );
                $stmt->execute([$guardianName, $guardianContact, $guardianRelationship, $guardianId]);
            } elseif ($hasGuardianInput) {
                $stmt = $this->conn->prepare(
                    'INSERT INTO guardian (name, contact_number, relationship) VALUES (?, ?, ?)'
                );
                $stmt->execute([$guardianName, $guardianContact, $guardianRelationship]);
                $guardianId = (int) $this->conn->lastInsertId();
            } else {
                $guardianId = null;
            }

            $updated = [
                'student_id_number' => $studentIdNumber,
                'lrn' => $lrn,
                'first_name' => $firstName,
                'middle_name' => $this->normalizeOptionalText($data, 'middle_name'),
                'last_name' => $lastName,
                'ext' => trim((string) ($data['ext'] ?? '')),
                'nickname' => $this->normalizeOptionalText($data, 'nickname'),
                'email' => $email,
                'birthday' => $birthday,
                'gender_id' => $genderId,
                'guardian_id' => $guardianId,
                'adr_street' => $this->normalizeOptionalText($data, 'adr_street'),
                'adr_barangay' => $this->normalizeOptionalText($data, 'adr_barangay'),
                'adr_city' => $this->normalizeOptionalText($data, 'adr_city'),
                'adr_province' => $this->normalizeOptionalText($data, 'adr_province'),
                'adr_note' => $this->normalizeOptionalText($data, 'adr_note'),
                'health_note' => $this->normalizeOptionalText($data, 'health_note'),
                'status' => $status
            ];

            $stmt = $this->conn->prepare(
                "UPDATE student SET
                    student_id_number = :student_id_number,
                    lrn = :lrn,
                    first_name = :first_name,
                    middle_name = :middle_name,
                    last_name = :last_name,
                    ext = :ext,
                    nickname = :nickname,
                    email = :email,
                    birthday = :birthday,
                    gender_id = :gender_id,
                    guardian_id = :guardian_id,
                    adr_street = :adr_street,
                    adr_barangay = :adr_barangay,
                    adr_city = :adr_city,
                    adr_province = :adr_province,
                    adr_note = :adr_note,
                    health_note = :health_note,
                    status = :status
                 WHERE student_id = :student_id"
            );
            $stmt->execute(array_merge($updated, ['student_id' => $studentId]));

            $changed = [];
            foreach ($updated as $field => $value) {
                $oldValue = $before[$field] ?? null;
                if ((string) ($oldValue ?? '') !== (string) ($value ?? '')) {
                    $changed[$field] = ['from' => $oldValue, 'to' => $value];
                }
            }
            foreach ([
                'guardian_name' => $guardianName,
                'guardian_contact' => $guardianContact,
                'guardian_relationship' => $guardianRelationship
            ] as $field => $value) {
                if ((string) ($before[$field] ?? '') !== (string) ($value ?? '')) {
                    $changed[$field] = ['from' => $before[$field] ?? null, 'to' => $value];
                }
            }

            if ($changed) {
                $stmt = $this->conn->prepare(
                    'INSERT INTO student_profile_audit
                        (student_id, employee_id, role_name, changed_fields_json)
                     VALUES (?, ?, ?, ?)'
                );
                $stmt->execute([
                    $studentId,
                    $admin['employee_id'],
                    $admin['role'],
                    json_encode($changed, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE)
                ]);
            }

            $this->conn->commit();
            $this->respond('success', 'Student information updated successfully.', [
                'data' => [
                    'student_id' => $studentId,
                    'changed_fields' => array_keys($changed)
                ]
            ]);
        } catch (Throwable $error) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $error;
        }
    }
}

try {
    $api = new StudentManagementAPI();
    $operation = $_GET['operation'] ?? null;
    $payload = [];

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $body = json_decode(file_get_contents('php://input'), true);
        if (is_array($body)) {
            $operation = $body['operation'] ?? $operation;
            $payload = $body['json'] ?? $body['data'] ?? [];
            if (is_string($payload)) {
                $payload = json_decode($payload, true);
            }
            if (!is_array($payload)) {
                $payload = [];
            }
        } else {
            $operation = $_POST['operation'] ?? $operation;
            $payload = json_decode((string) ($_POST['json'] ?? '{}'), true) ?: [];
        }
    }

    switch ($operation) {
        case 'list':
            $api->listStudents();
            break;
        case 'lookups':
            $api->getLookups();
            break;
        case 'details':
            $api->getStudentDetails((int) ($_GET['student_id'] ?? 0));
            break;
        case 'update':
            $api->updateStudent($payload);
            break;
        default:
            throw new RuntimeException('Invalid operation.', 400);
    }
} catch (RuntimeException $error) {
    $status = $error->getCode();
    if ($status < 400 || $status > 599) {
        $status = 400;
    }
    http_response_code($status);
    echo json_encode([
        'status' => 'error',
        'message' => $error->getMessage()
    ], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
} catch (Throwable $error) {
    error_log('Student management API error: ' . $error->getMessage());
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'message' => 'Unable to complete the student management request.'
    ]);
}
