<?php
// api/admin/employee.php

require_once __DIR__ . '/../security/SecretCipher.php';
require_once __DIR__ . '/../security/PasswordExpiration.php';
require_once __DIR__ . '/../email_service.php';
require_once __DIR__ . '/../security/AuthGuard.php';
require_once __DIR__ . '/../security/SafeImageUpload.php';
require_once __DIR__ . '/../security/AccountActivation.php';
require_once __DIR__ . '/../security/PasswordPolicy.php';
require_once __DIR__ . '/../security/EmployeeCredentials.php';
require_once __DIR__ . '/../employee_schedule_helper.php';

// Set headers for JSON content and CORS
header('Content-Type: application/json');
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

SessionBootstrap::start();

$requestMethod = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$requestBody = $requestMethod === 'POST' && strpos($_SERVER['CONTENT_TYPE'] ?? '', 'multipart/form-data') === false
    ? json_decode(file_get_contents('php://input'), true) : null;
$requestedOperation = $requestMethod === 'GET' ? ($_GET['operation'] ?? '')
    : ($_POST['operation'] ?? (is_array($requestBody) ? ($requestBody['operation'] ?? '') : ''));
$requestedData = $requestMethod === 'GET' ? ($_GET['json'] ?? '')
    : ($_POST['json'] ?? (is_array($requestBody) ? ($requestBody['json'] ?? '') : ''));
$requestedData = is_string($requestedData) ? json_decode($requestedData, true) : $requestedData;
$actor = AuthGuard::requireUser();
$staffRoles = ['owner', 'secretary', 'branch admin'];
$ownerOnly = ['saveRbacModulePermissions', 'clearRbacRolePermissions', 'updateOwnerSmtpSettings', 'getEmployeeLoginCredentials'];
$staffOnly = ['signup', 'updateEmployee', 'getEmployees', 'getAllEmployees',
    'assignPrograms', 'addProgram'];
if (in_array($requestedOperation, $ownerOnly, true) && $actor['role_name'] !== 'owner') AuthGuard::deny();
if (in_array($requestedOperation, $staffOnly, true) && !in_array($actor['role_name'], $staffRoles, true)) AuthGuard::deny();
if ($requestedOperation === 'getRbacPermissions' && $actor['user_type'] !== 'employee') AuthGuard::deny();
$targetId = (int) (($requestedData['employee_id'] ?? null) ?: ($_GET['employee_id'] ?? 0));
if ($requestedOperation === 'getEmployeeProfile') {
    // Authorize exactly the query-string ID used by the profile handler.
    $targetId = filter_var($_GET['employee_id'] ?? null, FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 1]]);
    if ($targetId === false) AuthGuard::deny(400, 'A valid employee ID is required.');
}
if ($requestedOperation === 'saveSchedule'
    && !in_array($actor['role_name'], $staffRoles, true)
    && !($actor['user_type'] === 'employee' && $actor['role_name'] === 'teacher'
        && $targetId > 0 && $targetId === (int) $actor['user_id'])) AuthGuard::deny();
if (in_array($requestedOperation, ['getEmployeeProfile', 'updateEmployeeProfile', 'updateEmployeePassword'], true)
    && ($actor['user_type'] !== 'employee'
        || ($targetId !== $actor['user_id'] && !in_array($actor['role_name'], $staffRoles, true)))) AuthGuard::deny();
if ($requestedOperation === 'updateEmployeePassword' && $targetId !== $actor['user_id']) AuthGuard::deny();
if ($requestedOperation === 'updateEmployeeProfile' && $targetId > 0 && $targetId !== $actor['user_id']
    && $actor['role_name'] !== 'owner') {
    $target = AuthGuard::account(AuthGuard::connection(), 'employee', $targetId);
    if (!$target || in_array(preg_replace('/[\s_-]+/', ' ', strtolower($target['role_name'])),
        ['owner', 'secretary', 'branch admin'], true)) AuthGuard::deny();
}
if ($actor['role_name'] === 'branch admin') {
    if ($requestedOperation === 'signup' && ((int) ($requestedData['branch_id'] ?? 0) !== (int) ($_SESSION['branch_id'] ?? 0)
        || strtolower((string) ($requestedData['role'] ?? '')) !== 'teacher')) AuthGuard::deny();
    if ($requestedOperation === 'updateEmployee'
        && (int) ($requestedData['branch_id'] ?? 0) !== (int) ($_SESSION['branch_id'] ?? 0)) AuthGuard::deny();
    if ($targetId > 0) {
        $target = AuthGuard::account(AuthGuard::connection(), 'employee', $targetId);
        if (!$target || (int) ($target['branch_id'] ?? 0) !== (int) ($_SESSION['branch_id'] ?? 0)) AuthGuard::deny();
    }
}
if ($actor['role_name'] !== 'owner' && in_array($requestedOperation, ['signup', 'updateEmployee'], true)) {
    $newRole = preg_replace('/[\s_-]+/', ' ', strtolower(trim((string) ($requestedData['role'] ?? ''))));
    if (in_array($newRole, ['owner', 'secretary', 'branch admin'], true)) AuthGuard::deny();
    if ($requestedOperation === 'updateEmployee' && $targetId > 0) {
        $target = AuthGuard::account(AuthGuard::connection(), 'employee', $targetId);
        if (!$target || in_array(preg_replace('/[\s_-]+/', ' ', strtolower($target['role_name'])),
            ['owner', 'secretary', 'branch admin'], true)) AuthGuard::deny();
    }
}
if ($requestMethod === 'GET' && in_array($requestedOperation,
    ['signup', 'updateEmployee', 'saveSchedule', 'saveRbacModulePermissions', 'clearRbacRolePermissions',
        'assignPrograms', 'addProgram', 'updateEmployeeProfile', 'updateEmployeePassword', 'updateOwnerSmtpSettings'], true)) {
    AuthGuard::deny(405, 'Method not allowed.');
}

function getEmployeeLookupBranchId() {
    $role = strtolower(trim((string) ($_SESSION['user_role'] ?? '')));
    $role = preg_replace('/[\s_-]+/', ' ', $role);

    if ($role !== 'branch admin') {
        return null;
    }

    $branchId = intval($_SESSION['branch_id'] ?? 0);
    return $branchId > 0 ? $branchId : -1;
}

class Employee {
    function getEmployeeLoginCredentials($employeeId) {
        header('Cache-Control: no-store');
        include "connection-pdo.php";
        EmployeeCredentials::ensureSchema($conn);
        $stmt = $conn->prepare('SELECT e.username, e.password_hash, c.password_encrypted
            FROM employee e LEFT JOIN employee_generated_credentials c ON c.employee_id = e.employee_id
            WHERE e.employee_id = ?');
        $stmt->execute([(int) $employeeId]);
        $employee = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$employee) {
            echo json_encode(['status' => 'error', 'message' => 'Employee not found.']);
            return;
        }
        $password = null;
        if (!empty($employee['password_encrypted'])) {
            try {
                $stored = SecretCipher::decrypt($employee['password_encrypted']);
                if (password_verify($stored, $employee['password_hash'])) $password = $stored;
            } catch (Throwable $error) {
                echo json_encode(['status' => 'error', 'message' => 'Unable to decrypt generated credentials. Please check the server secret key configuration.']);
                return;
            }
            if ($password === null) {
                $conn->prepare('DELETE FROM employee_generated_credentials WHERE employee_id = ? AND password_encrypted = ?')
                    ->execute([(int) $employeeId, $employee['password_encrypted']]);
            }
        }
        echo json_encode(['status' => 'success', 'username' => $employee['username'], 'password' => $password,
            'message' => $password === null ? 'The password was changed or this account predates generated credentials. Its current password cannot be displayed.' : 'Keep these credentials private.']);
    }

    private function getNormalizedSessionRole() {
        $role = strtolower(trim((string) ($_SESSION['user_role'] ?? '')));
        return preg_replace('/[\s_-]+/', ' ', $role);
    }

    private function ensureRbacPermissionTable($conn) {
        $sql = "CREATE TABLE IF NOT EXISTS role_module_permissions (
                    permission_id INT AUTO_INCREMENT PRIMARY KEY,
                    role_name VARCHAR(100) NOT NULL,
                    module_key VARCHAR(100) NOT NULL,
                    permissions_json LONGTEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uniq_role_module (role_name, module_key)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
        $conn->exec($sql);
    }

    private function normalizeBirthday($value) {
        $birthday = trim((string) ($value ?? ''));
        if ($birthday === '') {
            return null;
        }

        $date = DateTime::createFromFormat('Y-m-d', $birthday);
        return ($date && $date->format('Y-m-d') === $birthday) ? $birthday : false;
    }

    private function normalizeBranchId($value) {
        if ($value === null || $value === '') {
            return null;
        }

        $branchId = filter_var($value, FILTER_VALIDATE_INT);
        return ($branchId !== false && $branchId > 0) ? $branchId : null;
    }

    private function credentialNamePart($value) {
        $value = strtolower(trim((string) $value));
        if (function_exists('iconv')) {
            $ascii = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);
            if ($ascii !== false) {
                $value = $ascii;
            }
        }
        return preg_replace('/[^a-z0-9]/', '', $value);
    }

    private function generatedEmployeeUsername(PDO $conn, $firstName, $lastName) {
        $firstPart = $this->credentialNamePart($firstName);
        $lastPart = $this->credentialNamePart($lastName);
        $base = trim($firstPart . '.' . $lastPart, '.');
        if ($base === '') {
            $base = 'employee';
        }

        $check = $conn->prepare('SELECT 1 FROM employee WHERE username = :username LIMIT 1');
        for ($suffix = 1; $suffix <= 9999; $suffix++) {
            $suffixText = $suffix === 1 ? '' : (string) $suffix;
            $candidate = substr($base, 0, max(1, 100 - strlen($suffixText))) . $suffixText;
            $check->execute([':username' => $candidate]);
            if (!$check->fetchColumn()) {
                return $candidate;
            }
        }

        throw new RuntimeException('Unable to generate a unique employee username.');
    }
    
    // --- SIGNUP FUNCTION ---
    function signup($json) {
        header('Cache-Control: no-store');
        include "connection-pdo.php";
        PasswordExpiration::ensureSchema($conn);

        $data = json_decode($json, true);

        // 1. Validate Required Fields
        if (empty($data['first_name']) || empty($data['last_name']) || empty($data['role']) || empty($data['email'])) {
            echo json_encode(["status" => "error", "message" => "First name, last name, role, and email are required"]);
            return;
        }

        // 2. Assign Variables
        $first_name = $data['first_name'];
        $middle_name = !empty($data['middle_name']) ? $data['middle_name'] : null;
        $last_name = $data['last_name'];
        $role_name = $data['role'];
        $email = trim($data['email']);
        $branch_id = $this->normalizeBranchId($data['branch_id'] ?? null);
        $birthday = $this->normalizeBirthday($data['birthday'] ?? null);

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            echo json_encode(["status" => "error", "message" => "Please provide a valid email address"]);
            return;
        }

        if (!EmployeeCredentials::adultBirthday($birthday)) {
            echo json_encode(["status" => "error", "message" => "Employees must be at least 18 years old. Please select a valid birthday."]);
            return;
        }

        // 3. Get role_id
        $stmtRole = $conn->prepare("SELECT role_id FROM role WHERE role_name = :role LIMIT 1");
        $stmtRole->bindParam(":role", $role_name);
        $stmtRole->execute();
        $role_id = $stmtRole->fetchColumn();

        if (!$role_id) {
            echo json_encode(["status" => "error", "message" => "Invalid role selected"]);
            return;
        }

        $username = $this->generatedEmployeeUsername($conn, $first_name, $last_name);
        $generatedPassword = EmployeeCredentials::generatePassword();
        try {
            $encryptedPassword = SecretCipher::encrypt($generatedPassword);
            EmployeeCredentials::ensureSchema($conn);
        } catch (Throwable $error) {
            echo json_encode(["status" => "error", "message" => "Unable to securely store login credentials. Please check the server secret key configuration."]);
            return;
        }
        $password = password_hash($generatedPassword, PASSWORD_DEFAULT);

        // 5. Check Duplicate Email
        $stmtEmailCheck = $conn->prepare("SELECT COUNT(*) FROM employee WHERE email = :email");
        $stmtEmailCheck->bindParam(":email", $email);
        $stmtEmailCheck->execute();
        if ($stmtEmailCheck->fetchColumn() > 0) {
            echo json_encode(["status" => "error", "message" => "Email address is already in use"]);
            return;
        }

        // 6. Insert Employee
        $sqlInsert = "INSERT INTO employee
                      (first_name, middle_name, last_name, birthday, role_id, username, email, password_hash, password_changed_at, password_is_temporary, status, branch_id, date_created)
                      VALUES
                      (:first_name, :middle_name, :last_name, :birthday, :role_id, :username, :email, :password, NOW(), 1, 'inactive', :branch_id, NOW())";

        $conn->beginTransaction();
        try {
            $stmt = $conn->prepare($sqlInsert);
            $result = $stmt->execute([
                ":first_name" => $first_name,
                ":middle_name" => $middle_name,
                ":last_name" => $last_name,
                ":birthday" => $birthday,
                ":role_id" => $role_id,
                ":username" => $username,
                ":email" => $email,
                ":password" => $password,
                ":branch_id" => $branch_id
            ]);

            $lastId = $conn->lastInsertId();
            $conn->prepare('INSERT INTO employee_generated_credentials (employee_id, password_encrypted) VALUES (?, ?)')
                ->execute([$lastId, $encryptedPassword]);
            $conn->commit();
        } catch (Throwable $error) {
            if ($conn->inTransaction()) $conn->rollBack();
            echo json_encode(["status" => "error", "message" => "Unable to create employee account. Please try again."]);
            return;
        }
        if ($result) {
            // assign subjects if provided
            if (isset($data['subjects']) && is_array($data['subjects'])) {
                $this->assignSubjects($lastId, $data['subjects']);
            }
            if (isset($data['programs']) && is_array($data['programs'])) {
                $this->assignPrograms($lastId, $data['programs']);
            }

            $safeName = htmlspecialchars(trim($first_name . ' ' . $last_name), ENT_QUOTES, 'UTF-8');
            $safeUsername = htmlspecialchars($username, ENT_QUOTES, 'UTF-8');
            $safePassword = htmlspecialchars($generatedPassword, ENT_QUOTES, 'UTF-8');
            $emailSent = (new EmailService($conn))->send(
                $email,
                'Your CDO Tutor employee account',
                "<div style='font-family:Arial,sans-serif;line-height:1.6;color:#25304a'>
                    <h2 style='color:#c42f69'>Welcome to CDO Tutor, {$safeName}!</h2>
                    <p>Your employee portal account has been created.</p>
                    <div style='padding:16px;border-radius:12px;background:#fff3f7'>
                        <p><strong>Username:</strong> {$safeUsername}</p>
                        <p><strong>Temporary password:</strong> {$safePassword}</p>
                    </div>
                    <p>Sign in with this temporary password to create your own password. Your account becomes active after password setup. Then sign in again with your new password.</p>
                    <p>Never share your login credentials with anyone.</p>
                </div>",
                [
                    'recipient_name' => trim($first_name . ' ' . $last_name),
                    'alt_body' => "Welcome to CDO Tutor. Username: {$username}. Temporary password: {$generatedPassword}. Sign in to create your own password and activate your account, then sign in again with your new password."
                ]
            );

            echo json_encode([
                "status" => "success",
                "message" => $emailSent
                    ? "Inactive employee account created and temporary login credentials emailed successfully. The account becomes active after password setup."
                    : "Inactive employee account created, but the email could not be sent. The owner can view the temporary password under Actions > Login Credentials. The account becomes active after password setup.",
                "username" => $username,
                "email_sent" => $emailSent
            ]);
        } else {
            echo json_encode(["status" => "error", "message" => "Failed to create employee account"]);
        }
    }

    // --- GET ROLES FUNCTION ---
    function getRoles() {
        include "connection-pdo.php";
        $sql = "SELECT role_name FROM role WHERE role_name != 'student' ORDER BY role_name ASC";
        $stmt = $conn->prepare($sql);
        $stmt->execute();
        $roles = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode($roles);
    }

    // --- GET BRANCHES FUNCTION ---
    function getBranches() {
        include "connection-pdo.php";
        $sql = "SELECT branch_id, branch_name FROM branch ORDER BY branch_name ASC";
        $stmt = $conn->prepare($sql);
        $stmt->execute();
        $branches = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode($branches);
    }

    // --- GET EMPLOYEES FUNCTION ---
function getEmployees() {
        include "connection-pdo.php";
        $branchId = getEmployeeLookupBranchId();
        // Include assigned subjects and programs as comma-separated lists
        $sql = "SELECT e.employee_id, e.first_name, e.middle_name, e.last_name, e.birthday, e.username, e.status, e.branch_id, r.role_name, b.branch_name, e.date_created,
                   GROUP_CONCAT(DISTINCT s.subject_name SEPARATOR ', ') AS subjects,
                   GROUP_CONCAT(DISTINCT CONCAT(p.name, ' (', COALESCE(pt2.type, 'Unknown'), ')') SEPARATOR ', ') AS programs
            FROM employee e
            JOIN role r ON e.role_id = r.role_id
            LEFT JOIN branch b ON e.branch_id = b.branch_id
            LEFT JOIN subject_teacher st ON e.employee_id = st.employee_id
            LEFT JOIN subject s ON st.subject_id = s.subject_id
            LEFT JOIN program_teacher pt ON e.employee_id = pt.employee_id
            LEFT JOIN program p ON pt.program_id = p.program_id
            LEFT JOIN program_type pt2 ON p.program_type = pt2.program_type_id
            " . ($branchId ? "WHERE e.branch_id = :branch_id" : "") . "
            GROUP BY e.employee_id
            ORDER BY e.date_created DESC";
        $stmt = $conn->prepare($sql);
        $stmt->execute($branchId ? [':branch_id' => $branchId] : []);
        $employees = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(["status" => "success", "data" => $employees]);
    }

    // --- GET ALL EMPLOYEES FUNCTION ---
function getAllEmployees() {
        include "connection-pdo.php";
        $branchId = getEmployeeLookupBranchId();
        $sql = "SELECT e.employee_id, e.first_name, e.middle_name, e.last_name, e.birthday, e.username, e.status, e.branch_id, r.role_name, b.branch_name, e.date_created,
                   GROUP_CONCAT(DISTINCT s.subject_name SEPARATOR ', ') AS subjects,
                   GROUP_CONCAT(DISTINCT CONCAT(p.name, ' (', COALESCE(pt2.type, 'Unknown'), ')') SEPARATOR ', ') AS programs
            FROM employee e
            JOIN role r ON e.role_id = r.role_id
            LEFT JOIN branch b ON e.branch_id = b.branch_id
            LEFT JOIN subject_teacher st ON e.employee_id = st.employee_id
            LEFT JOIN subject s ON st.subject_id = s.subject_id
            LEFT JOIN program_teacher pt ON e.employee_id = pt.employee_id
            LEFT JOIN program p ON pt.program_id = p.program_id
            LEFT JOIN program_type pt2 ON p.program_type = pt2.program_type_id"
            . ($branchId ? " WHERE e.branch_id = :branch_id" : "") .
            "
            GROUP BY e.employee_id
            ORDER BY e.date_created DESC";
        $stmt = $conn->prepare($sql);
        $stmt->execute($branchId ? [':branch_id' => $branchId] : []);
        $employees = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode($employees);
    }

    // --- UPDATE EMPLOYEE FUNCTION ---
    function updateEmployee($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true);

        if (empty($data['employee_id'])) {
            echo json_encode(["status" => "error", "message" => "Employee ID is required"]);
            return;
        }

        $status = strtolower(trim((string) ($data['status'] ?? '')));
        if (!in_array($status, ['active', 'inactive'], true)) {
            echo json_encode(["status" => "error", "message" => "Invalid employee status selected"]);
            return;
        }

        $stmtRole = $conn->prepare("SELECT role_id FROM role WHERE role_name = :role LIMIT 1");
        $stmtRole->bindParam(":role", $data['role']);
        $stmtRole->execute();
        $role_id = $stmtRole->fetchColumn();

        if (!$role_id) {
            echo json_encode(["status" => "error", "message" => "Invalid role selected"]);
            return;
        }

        $birthday = $this->normalizeBirthday($data['birthday'] ?? null);
        if (!EmployeeCredentials::adultBirthday($birthday)) {
            echo json_encode(["status" => "error", "message" => "Employees must be at least 18 years old. Please select a valid birthday."]);
            return;
        }

        $branch_id = $this->normalizeBranchId($data['branch_id'] ?? null);

        $sqlUpdate = "UPDATE employee SET first_name = :fn, middle_name = :mn, last_name = :ln, birthday = :birthday, role_id = :rid, status = :status, branch_id = :bid WHERE employee_id = :eid";
        $stmt = $conn->prepare($sqlUpdate);
        $result = $stmt->execute([
            ":fn" => $data['first_name'],
            ":mn" => !empty($data['middle_name']) ? $data['middle_name'] : null,
            ":ln" => $data['last_name'],
            ":birthday" => $birthday,
            ":rid" => $role_id,
            ":status" => $status,
            ":bid" => $branch_id,
            ":eid" => $data['employee_id']
        ]);

        if ($result) {
            // assign subjects if provided
            if (isset($data['subjects']) && is_array($data['subjects'])) {
                $this->assignSubjects($data['employee_id'], $data['subjects']);
            }
            if (isset($data['programs']) && is_array($data['programs'])) {
                $this->assignPrograms($data['employee_id'], $data['programs']);
            }
            echo json_encode(["status" => "success", "message" => "Employee updated successfully"]);
        } else {
            echo json_encode(["status" => "error", "message" => "Failed to update employee"]);
        }
    }

    // --- GET SUBJECTS ---
    function getSubjects() {
        include "connection-pdo.php";
        $sql = "SELECT subject_id, subject_name FROM subject ORDER BY subject_name ASC";
        $stmt = $conn->prepare($sql);
        $stmt->execute();
        $subjects = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode($subjects);
    }

    // --- GET SUBJECTS ASSIGNED TO AN EMPLOYEE ---
    function getEmployeeSubjects() {
        include "connection-pdo.php";
        $id = $_GET['id'] ?? 0;
        $sql = "SELECT s.subject_id, s.subject_name
                FROM subject_teacher st
                JOIN subject s ON st.subject_id = s.subject_id
                WHERE st.employee_id = :id";
        $stmt = $conn->prepare($sql);
        $stmt->execute([':id' => $id]);
        $subs = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode($subs);
    }

    // --- ASSIGN SUBJECTS TO EMPLOYEE (replace existing) ---
    function assignSubjects($employee_id, $subjects) {
        include "connection-pdo.php";
        try {
            $conn->beginTransaction();
            $stmtDel = $conn->prepare("DELETE FROM subject_teacher WHERE employee_id = ?");
            $stmtDel->execute([$employee_id]);

            if (!empty($subjects) && is_array($subjects)) {
                $stmtIns = $conn->prepare("INSERT INTO subject_teacher (subject_id, employee_id) VALUES (?, ?)");
                foreach ($subjects as $sub) {
                    if (!empty($sub)) {
                        $stmtIns->execute([$sub, $employee_id]);
                    }
                }
            }
            $conn->commit();
            return true;
        } catch (Exception $e) {
            $conn->rollBack();
            return false;
        }
    }

    // --- NEW: GET SCHEDULE ---
    function getSchedule() {
        include "connection-pdo.php";
        $id = $_GET['id'] ?? 0;

        // Custom ordering to ensure Monday comes first
        $sql = "SELECT day_of_week, start_time, end_time 
                FROM employee_schedule 
                WHERE employee_id = :id 
                ORDER BY FIELD(day_of_week, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'), start_time";
        
        $stmt = $conn->prepare($sql);
        $stmt->execute([':id' => $id]);
        $result = $stmt->fetchAll(PDO::FETCH_ASSOC);

        echo json_encode(["status" => "success", "data" => $result]);
    }

    // --- NEW: SAVE SCHEDULE ---
    function saveSchedule($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true);

        if (empty($data['employee_id'])) {
            echo json_encode(["status" => "error", "message" => "Employee ID required"]);
            return;
        }

        $empId = $data['employee_id'];
        $schedules = $data['schedules'] ?? null; // Expecting array of {day, start, end}
        $validationError = employeeScheduleValidationError($schedules);
        if ($validationError !== null) {
            echo json_encode(["status" => "error", "message" => $validationError]);
            return;
        }

        try {
            $conn->beginTransaction();

            // 1. Clear old schedule
            $stmtDel = $conn->prepare("DELETE FROM employee_schedule WHERE employee_id = ?");
            $stmtDel->execute([$empId]);

            // 2. Insert new rows
            if (!empty($schedules) && is_array($schedules)) {
                $stmtIns = $conn->prepare("INSERT INTO employee_schedule (employee_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)");
                
                foreach ($schedules as $sched) {
                    if (!empty($sched['day']) && !empty($sched['start']) && !empty($sched['end'])) {
                        $stmtIns->execute([$empId, $sched['day'], $sched['start'], $sched['end']]);
                    }
                }
            }

            $conn->commit();
            echo json_encode(["status" => "success", "message" => "Schedule saved successfully"]);

        } catch (Exception $e) {
            $conn->rollBack();
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    // --- GET PROGRAMS ---
    function getPrograms() {
        include "connection-pdo.php";
        $sql = "SELECT program_id, CONCAT(p.name, ' (', COALESCE(pt.type, 'Unknown'), ')') AS name FROM program p LEFT JOIN program_type pt ON p.program_type = pt.program_type_id ORDER BY p.name ASC";
        $stmt = $conn->prepare($sql);
        $stmt->execute();
        $programs = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode($programs);
    }

    function getRbacPermissions() {
        include "connection-pdo.php";
        $this->ensureRbacPermissionTable($conn);

        $stmt = $conn->prepare("SELECT role_name, module_key, permissions_json FROM role_module_permissions");
        $stmt->execute();
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $permissions = [];
        foreach ($rows as $row) {
            $roleName = strtolower(trim((string) ($row['role_name'] ?? '')));
            $roleName = preg_replace('/[\s_-]+/', ' ', $roleName);
            $moduleKey = trim((string) ($row['module_key'] ?? ''));

            if ($roleName === '' || $moduleKey === '') {
                continue;
            }

            $decoded = json_decode($row['permissions_json'] ?? '{}', true);
            $permissions[$roleName][$moduleKey] = is_array($decoded) ? $decoded : [];
        }

        $currentRole = $this->getNormalizedSessionRole();
        if (!in_array($currentRole, ['owner', 'secretary'], true)) {
            $permissions = isset($permissions[$currentRole])
                ? [$currentRole => $permissions[$currentRole]]
                : [];
        }

        echo json_encode(["status" => "success", "data" => $permissions]);
    }

    function saveRbacModulePermissions($json) {
        include "connection-pdo.php";
        $this->ensureRbacPermissionTable($conn);

        $currentRole = $this->getNormalizedSessionRole();
        if (!in_array($currentRole, ['owner', 'secretary'], true)) {
            echo json_encode(["status" => "error", "message" => "You are not allowed to update RBAC settings"]);
            return;
        }

        $data = json_decode($json, true);
        $roleName = strtolower(trim((string) ($data['role_name'] ?? '')));
        $roleName = preg_replace('/[\s_-]+/', ' ', $roleName);
        $moduleKey = trim((string) ($data['module_key'] ?? ''));
        $updates = $data['updates'] ?? null;

        if ($roleName === '' || $moduleKey === '' || !is_array($updates)) {
            echo json_encode(["status" => "error", "message" => "Role, module, and permission updates are required"]);
            return;
        }

        $stmtSelect = $conn->prepare("SELECT permissions_json FROM role_module_permissions WHERE role_name = :role_name AND module_key = :module_key LIMIT 1");
        $stmtSelect->execute([
            ':role_name' => $roleName,
            ':module_key' => $moduleKey
        ]);
        $existing = $stmtSelect->fetchColumn();
        $permissions = json_decode($existing ?: '{}', true);
        if (!is_array($permissions)) {
            $permissions = [];
        }

        foreach ($updates as $permissionKey => $value) {
            if (is_bool($value)) {
                $permissions[$permissionKey] = $value;
            }
        }

        $payload = json_encode($permissions);

        $stmtUpsert = $conn->prepare("
            INSERT INTO role_module_permissions (role_name, module_key, permissions_json)
            VALUES (:role_name, :module_key, :permissions_json)
            ON DUPLICATE KEY UPDATE permissions_json = VALUES(permissions_json), updated_at = CURRENT_TIMESTAMP
        ");

        $stmtUpsert->execute([
            ':role_name' => $roleName,
            ':module_key' => $moduleKey,
            ':permissions_json' => $payload
        ]);

        echo json_encode(["status" => "success", "data" => $permissions]);
    }

    function clearRbacRolePermissions($json) {
        include "connection-pdo.php";
        $this->ensureRbacPermissionTable($conn);

        $currentRole = $this->getNormalizedSessionRole();
        if (!in_array($currentRole, ['owner', 'secretary'], true)) {
            echo json_encode(["status" => "error", "message" => "You are not allowed to reset RBAC settings"]);
            return;
        }

        $data = json_decode($json, true);
        $roleName = strtolower(trim((string) ($data['role_name'] ?? '')));
        $roleName = preg_replace('/[\s_-]+/', ' ', $roleName);

        if ($roleName === '') {
            echo json_encode(["status" => "error", "message" => "Role is required"]);
            return;
        }

        $stmt = $conn->prepare("DELETE FROM role_module_permissions WHERE role_name = :role_name");
        $stmt->execute([':role_name' => $roleName]);

        echo json_encode(["status" => "success", "message" => "RBAC role settings reset"]);
    }

    // --- GET PROGRAMS ASSIGNED TO AN EMPLOYEE ---
    function getEmployeePrograms() {
        include "connection-pdo.php";
        $id = $_GET['id'] ?? 0;
        $sql = "SELECT p.program_id, p.name
                FROM program_teacher pt
                JOIN program p ON pt.program_id = p.program_id
                WHERE pt.employee_id = :id";
        $stmt = $conn->prepare($sql);
        $stmt->execute([':id' => $id]);
        $progs = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode($progs);
    }

    // --- ASSIGN PROGRAMS TO EMPLOYEE (replace existing) ---
    function assignPrograms($employee_id, $programs) {
        include "connection-pdo.php";
        try {
            $conn->beginTransaction();
            $stmtDel = $conn->prepare("DELETE FROM program_teacher WHERE employee_id = ?");
            $stmtDel->execute([$employee_id]);

            if (!empty($programs) && is_array($programs)) {
                $stmtIns = $conn->prepare("INSERT INTO program_teacher (program_id, employee_id) VALUES (?, ?)");
                foreach ($programs as $prog) {
                    if (!empty($prog)) {
                        $stmtIns->execute([$prog, $employee_id]);
                    }
                }
            }
            $conn->commit();
            return true;
        } catch (Exception $e) {
            $conn->rollBack();
            return false;
        }
    }

    // --- ADD NEW PROGRAM ---
    function addProgram($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true);
        $name = isset($data['program_name']) ? trim($data['program_name']) : '';
        if (empty($name)) {
            echo json_encode(["status"=>"error","message"=>"Program name required"]);
            return;
        }

        // check duplicate
        $stmtChk = $conn->prepare("SELECT program_id FROM program WHERE name = ? LIMIT 1");
        $stmtChk->execute([$name]);
        $existing = $stmtChk->fetchColumn();
        if ($existing) {
            echo json_encode(["status"=>"success","message"=>"Program already exists","program_id"=>$existing,"name"=>$name]);
            return;
        }

        $stmt = $conn->prepare("INSERT INTO program (name) VALUES (?)");
        $res = $stmt->execute([$name]);
        if ($res) {
            $id = $conn->lastInsertId();
            echo json_encode(["status"=>"success","message"=>"Program added","program_id"=>$id,"name"=>$name]);
        } else {
            echo json_encode(["status"=>"error","message"=>"Failed to add program"]);
        }
    }

    // --- GET EMPLOYEE PROFILE FUNCTION ---
    function getEmployeeProfile($employee_id) {
        include "connection-pdo.php";
        PasswordExpiration::ensureSchema($conn);
        $passwordAgeDays = PasswordExpiration::MAX_PASSWORD_AGE_DAYS;
        
        $sql = "SELECT e.employee_id, e.first_name, e.middle_name, e.last_name, e.username, e.email, e.contact_number, 
                       e.birthday, e.degree, e.status, e.date_created, e.profile_picture, r.role_name, b.branch_name,
                       e.password_changed_at,
                       DATE_ADD(e.password_changed_at, INTERVAL {$passwordAgeDays} DAY) AS password_change_due_at,
                       CASE WHEN e.password_changed_at <= DATE_SUB(NOW(), INTERVAL {$passwordAgeDays} DAY) THEN 1 ELSE 0 END AS password_expired,
                       GREATEST(0, CEIL(GREATEST(0, TIMESTAMPDIFF(SECOND, NOW(), DATE_ADD(e.password_changed_at, INTERVAL {$passwordAgeDays} DAY))) / 86400)) AS password_days_remaining,
                       CASE WHEN e.smtp_app_password_encrypted IS NOT NULL
                                  AND TRIM(e.smtp_app_password_encrypted) <> '' THEN 1 ELSE 0 END AS smtp_app_password_configured,
                       GROUP_CONCAT(DISTINCT s.subject_name SEPARATOR ', ') AS subjects,
                       GROUP_CONCAT(DISTINCT CONCAT(p.name, ' (', COALESCE(pt2.type, 'Unknown'), ')') SEPARATOR ', ') AS programs
                FROM employee e
                JOIN role r ON e.role_id = r.role_id
                LEFT JOIN branch b ON e.branch_id = b.branch_id
                LEFT JOIN subject_teacher st ON e.employee_id = st.employee_id
                LEFT JOIN subject s ON st.subject_id = s.subject_id
                LEFT JOIN program_teacher pt ON e.employee_id = pt.employee_id
                LEFT JOIN program p ON pt.program_id = p.program_id
                LEFT JOIN program_type pt2 ON p.program_type = pt2.program_type_id
                WHERE e.employee_id = :employee_id
                GROUP BY e.employee_id";
        
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":employee_id", $employee_id, PDO::PARAM_INT);
        $stmt->execute();
        $employee = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if ($employee) {
            echo json_encode(["status" => "success", "data" => $employee]);
        } else {
            echo json_encode(["status" => "error", "message" => "Employee not found"]);
        }
    }

    // --- UPDATE EMPLOYEE PROFILE FUNCTION ---
    function updateEmployeeProfile($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true);

        if (!is_array($data) || empty($data['employee_id'])) {
            echo json_encode(["status" => "error", "message" => "Employee ID is required"]);
            return;
        }

        if (!EmployeeCredentials::adultBirthday($data['birthday'] ?? null)) {
            echo json_encode(["status" => "error", "message" => "Employees must be at least 18 years old. Please select a valid birthday."]);
            return;
        }

        $employeeId = (int) $data['employee_id'];
        $email = trim((string) ($data['email'] ?? ''));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            echo json_encode(["status" => "error", "message" => "Please provide a valid email address"]);
            return;
        }

        $currentStatement = $conn->prepare(
            "SELECT e.email, e.password_hash, r.role_name
             FROM employee e
             INNER JOIN role r ON r.role_id = e.role_id
             WHERE e.employee_id = :employee_id
             LIMIT 1"
        );
        $currentStatement->execute([':employee_id' => $employeeId]);
        $currentEmployee = $currentStatement->fetch(PDO::FETCH_ASSOC);
        if (!$currentEmployee) {
            echo json_encode(["status" => "error", "message" => "Employee not found"]);
            return;
        }

        $targetRole = strtolower(trim((string) $currentEmployee['role_name']));
        $emailChanged = strcasecmp(trim((string) $currentEmployee['email']), $email) !== 0;
        if ($emailChanged) {
            if ((int) ($_SESSION['employee_id'] ?? 0) !== $employeeId) {
                $target = AuthGuard::account($conn, 'employee', $employeeId);
                if (empty($target['password_is_temporary']) || ($target['status'] ?? '') !== 'inactive') AuthGuard::deny();
                AccountActivation::ensureSchema($conn);
                $conn->prepare('DELETE FROM account_activations WHERE user_type = ? AND user_id = ?')
                    ->execute(['employee', $employeeId]);
            } else {
                AuthGuard::verifyCurrentPassword(is_array($data) ? $data : []);
            }
        }
        $smtpAppPassword = preg_replace('/\s+/', '', (string) ($data['smtp_app_password'] ?? ''));
        $encryptedSmtpPassword = null;

        if ($targetRole === 'owner' && ($emailChanged || $smtpAppPassword !== '')) {
            $sessionEmployeeId = (int) ($_SESSION['employee_id'] ?? 0);
            if ($this->getNormalizedSessionRole() !== 'owner' || $sessionEmployeeId !== $employeeId) {
                http_response_code(403);
                echo json_encode(["status" => "error", "message" => "Only the logged-in owner can update owner email settings"]);
                return;
            }
            if (!preg_match('/^[A-Za-z0-9]{16}$/', $smtpAppPassword)) {
                echo json_encode(["status" => "error", "message" => "Enter the 16-character Gmail app password for the new owner email"]);
                return;
            }
            if (!password_verify((string) ($data['current_account_password'] ?? ''), $currentEmployee['password_hash'])) {
                http_response_code(403);
                echo json_encode(["status" => "error", "message" => "Your current system password is incorrect"]);
                return;
            }

            try {
                $encryptedSmtpPassword = SecretCipher::encrypt($smtpAppPassword);
            } catch (Throwable $error) {
                error_log('Unable to encrypt owner SMTP settings: ' . $error->getMessage());
                http_response_code(500);
                echo json_encode(["status" => "error", "message" => "Unable to save the Gmail app password"]);
                return;
            }
        }

        $duplicateStatement = $conn->prepare(
            "SELECT COUNT(*) FROM employee WHERE email = :email AND employee_id != :employee_id"
        );
        $duplicateStatement->execute([':email' => $email, ':employee_id' => $employeeId]);
        if ((int) $duplicateStatement->fetchColumn() > 0) {
            echo json_encode(["status" => "error", "message" => "Email address is already in use"]);
            return;
        }

        $sql = "UPDATE employee SET 
                first_name = :first_name, 
                middle_name = :middle_name, 
                last_name = :last_name, 
                email = :email, 
                contact_number = :contact_number, 
                birthday = :birthday, 
                degree = :degree";

        if ($encryptedSmtpPassword !== null) {
            $sql .= ", smtp_app_password_encrypted = :smtp_app_password";
        }

        if (!empty($data['profile_picture'])) {
            $sql .= ", profile_picture = :profile_picture";
        }

        $sql .= " WHERE employee_id = :employee_id";

        $stmt = $conn->prepare($sql);
        $params = [
            ":first_name" => $data['first_name'],
            ":middle_name" => $data['middle_name'],
            ":last_name" => $data['last_name'],
            ":email" => $email,
            ":contact_number" => $data['contact_number'],
            ":birthday" => $data['birthday'],
            ":degree" => $data['degree'],
            ":employee_id" => $data['employee_id']
        ];

        if (!empty($data['profile_picture'])) {
            $params[':profile_picture'] = $data['profile_picture'];
        }
        if ($encryptedSmtpPassword !== null) {
            $params[':smtp_app_password'] = $encryptedSmtpPassword;
        }

        $result = $stmt->execute($params);

        if ($result) {
            if ((int) ($_SESSION['employee_id'] ?? 0) === $employeeId) AuthGuard::refreshCurrentVersion($conn);
            echo json_encode([
                "status" => "success",
                "message" => $encryptedSmtpPassword !== null
                    ? "Profile and email sending settings updated successfully"
                    : "Profile updated successfully",
                "smtp_app_password_configured" => $encryptedSmtpPassword !== null
            ]);
        } else {
            echo json_encode(["status" => "error", "message" => "Failed to update profile"]);
        }
    }

    // --- UPDATE EMPLOYEE PASSWORD & USERNAME ---
    function updateEmployeePassword($json) {
        include "connection-pdo.php";
        PasswordExpiration::ensureSchema($conn);
        $data = json_decode($json, true);

        $user = AuthGuard::requireUser();
        if ($user['user_type'] !== 'employee' || (int) ($data['employee_id'] ?? 0) !== $user['user_id']) {
            AuthGuard::deny();
        }
        AuthGuard::verifyCurrentPassword(is_array($data) ? $data : []);

        if (empty($data['employee_id']) || empty($data['new_password']) || empty($data['email'])) {
            echo json_encode(["status" => "error", "message" => "Employee ID, email, and new password are required"]);
            return;
        }

        $newEmail = trim($data['email']);
        if (!filter_var($newEmail, FILTER_VALIDATE_EMAIL)) {
            echo json_encode(["status" => "error", "message" => "Please provide a valid email address"]);
            return;
        }

        if (!PasswordPolicy::valid($data['new_password'] ?? null)) {
            echo json_encode(["status" => "error", "message" => PasswordPolicy::message()]);
            return;
        }

        if (isset($data['confirm_password']) && $data['new_password'] !== $data['confirm_password']) {
            echo json_encode(["status" => "error", "message" => "New password and confirmation do not match"]);
            return;
        }

        $stmt = $conn->prepare("SELECT username, email, password_hash FROM employee WHERE employee_id = :employee_id LIMIT 1");
        $stmt->execute([":employee_id" => $data['employee_id']]);
        $employee = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$employee) {
            echo json_encode(["status" => "error", "message" => "Employee not found"]);
            return;
        }

        $newUsername = trim($data['username'] ?? $employee['username']);
        if ($this->getNormalizedSessionRole() === 'owner'
            && strcasecmp($newEmail, trim((string) $employee['email'])) !== 0) {
            echo json_encode([
                "status" => "error",
                "message" => "Change the owner email in Profile and provide the matching Gmail app password so email sending settings stay together"
            ]);
            return;
        }
        if ($newUsername !== $employee['username']) {
            $stmtCheck = $conn->prepare("SELECT COUNT(*) FROM employee WHERE username = :username AND employee_id != :employee_id");
            $stmtCheck->execute([":username" => $newUsername, ":employee_id" => $data['employee_id']]);
            if ($stmtCheck->fetchColumn() > 0) {
                echo json_encode(["status" => "error", "message" => "Username is already taken"]);
                return;
            }
        }

        $stmtEmailCheck = $conn->prepare("SELECT COUNT(*) FROM employee WHERE email = :email AND employee_id != :employee_id");
        $stmtEmailCheck->execute([":email" => $newEmail, ":employee_id" => $data['employee_id']]);
        if ($stmtEmailCheck->fetchColumn() > 0) {
            echo json_encode(["status" => "error", "message" => "Email address is already in use"]);
            return;
        }

        $updatedPasswordHash = password_hash($data['new_password'], PASSWORD_DEFAULT);
        $stmtUpdate = $conn->prepare("UPDATE employee SET username = :username, email = :email, password_hash = :password_hash, password_changed_at = NOW(), password_is_temporary = 0 WHERE employee_id = :employee_id");
        $success = $stmtUpdate->execute([
            ":username" => $newUsername,
            ":email" => $newEmail,
            ":password_hash" => $updatedPasswordHash,
            ":employee_id" => $data['employee_id']
        ]);

        if ($success) {
            AuthGuard::refreshCurrentVersion($conn);
            echo json_encode(["status" => "success", "message" => "Login credentials updated successfully"]);
        } else {
            echo json_encode(["status" => "error", "message" => "Failed to update login credentials"]);
        }
    }

    function updateOwnerSmtpSettings($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true);
        $sessionEmployeeId = (int) ($_SESSION['employee_id'] ?? 0);

        if ($this->getNormalizedSessionRole() !== 'owner' || $sessionEmployeeId <= 0) {
            http_response_code(403);
            echo json_encode(["status" => "error", "message" => "Only the logged-in owner can update email sending settings"]);
            return;
        }

        $accountPassword = (string) ($data['account_password'] ?? '');
        $appPassword = preg_replace('/\s+/', '', (string) ($data['smtp_app_password'] ?? ''));

        if ($accountPassword === '' || !preg_match('/^[A-Za-z0-9]{16}$/', $appPassword)) {
            echo json_encode([
                "status" => "error",
                "message" => "Enter your current account password and the 16-character Gmail app password"
            ]);
            return;
        }

        $statement = $conn->prepare(
            "SELECT e.password_hash
             FROM employee e
             INNER JOIN role r ON r.role_id = e.role_id
             WHERE e.employee_id = :employee_id
               AND LOWER(TRIM(r.role_name)) = 'owner'
               AND LOWER(TRIM(COALESCE(e.status, 'active'))) = 'active'
             LIMIT 1"
        );
        $statement->execute([':employee_id' => $sessionEmployeeId]);
        $passwordHash = $statement->fetchColumn();

        if (!$passwordHash || !password_verify($accountPassword, $passwordHash)) {
            http_response_code(403);
            echo json_encode(["status" => "error", "message" => "Your current account password is incorrect"]);
            return;
        }

        try {
            $encryptedPassword = SecretCipher::encrypt($appPassword);
            $update = $conn->prepare(
                "UPDATE employee
                 SET smtp_app_password_encrypted = :smtp_app_password
                 WHERE employee_id = :employee_id"
            );
            $update->execute([
                ':smtp_app_password' => $encryptedPassword,
                ':employee_id' => $sessionEmployeeId
            ]);

            echo json_encode([
                "status" => "success",
                "message" => "Gmail app password saved securely",
                "smtp_app_password_configured" => true
            ]);
        } catch (Throwable $error) {
            error_log('Unable to update owner SMTP settings: ' . $error->getMessage());
            http_response_code(500);
            echo json_encode(["status" => "error", "message" => "Unable to save the Gmail app password"]);
        }
    }
}


// --- HANDLE REQUESTS ---

$operation = '';
$json = '';

if ($_SERVER['REQUEST_METHOD'] == 'GET'){
    $operation = isset($_GET['operation']) ? $_GET['operation'] : "";
    $json = isset($_GET['json']) ? $_GET['json'] : "";
} 
else if($_SERVER['REQUEST_METHOD'] == 'POST'){
    // Check if this is a multipart/form-data request (file upload)
    if (strpos($_SERVER['CONTENT_TYPE'] ?? '', 'multipart/form-data') !== false) {
        $operation = $_POST['operation'] ?? "";
        $json = $_POST['json'] ?? "";

        if (isset($_FILES['profile_picture'])) {
            if ($operation !== 'updateEmployeeProfile' || $targetId <= 0) AuthGuard::deny();
            try {
                $relativePath = SafeImageUpload::store($_FILES['profile_picture'], 'employee_profiles');
                $data = json_decode($json, true);
                if (!is_array($data)) AuthGuard::deny(400, 'Invalid profile data.');
                $data['profile_picture'] = $relativePath;
                $json = json_encode($data);
            } catch (Throwable $e) { AuthGuard::deny(422, $e->getMessage()); }
        }
    } else {
        $content = file_get_contents('php://input');
        $postData = json_decode($content, true);
        $operation = $postData['operation'] ?? "";
        $json = $postData['json'] ?? "";
    }
}

$employee = new Employee();

switch($operation){
    case "signup": $employee->signup($json); break;
    case "getEmployeeLoginCredentials": $employee->getEmployeeLoginCredentials($_GET['employee_id'] ?? 0); break;
    case "getRoles": $employee->getRoles(); break;
    case "getBranches": $employee->getBranches(); break;
    case "getEmployees": $employee->getEmployees(); break;
    case "getAllEmployees": $employee->getAllEmployees(); break;
    case "updateEmployee": $employee->updateEmployee($json); break;
    case "getSchedule": $employee->getSchedule(); break; // NEW
    case "saveSchedule": $employee->saveSchedule($json); break; // NEW
    case "getSubjects": $employee->getSubjects(); break;
    case "getEmployeeSubjects": $employee->getEmployeeSubjects(); break;
    case "getPrograms": $employee->getPrograms(); break;
    case "getRbacPermissions": $employee->getRbacPermissions(); break;
    case "saveRbacModulePermissions": $employee->saveRbacModulePermissions($json); break;
    case "clearRbacRolePermissions": $employee->clearRbacRolePermissions($json); break;
    case "getEmployeePrograms": $employee->getEmployeePrograms(); break;
    case "assignPrograms": $employee->assignPrograms($json); break;
    case "addProgram": $employee->addProgram($json); break;
    case "getEmployeeProfile": $employee->getEmployeeProfile($targetId); break;
    case "updateEmployeeProfile": $employee->updateEmployeeProfile($json); break;
    case "updateEmployeePassword": $employee->updateEmployeePassword($json); break;
    case "updateOwnerSmtpSettings": $employee->updateOwnerSmtpSettings($json); break;
    default: echo json_encode(["status" => "error", "message" => "Invalid Operation"]); break;

}
?>
