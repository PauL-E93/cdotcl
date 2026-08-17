<?php
// api/admin/employee.php

// Set headers for JSON content and CORS
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if (session_status() === PHP_SESSION_NONE) {
    session_start();
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
    
    // --- SIGNUP FUNCTION ---
    function signup($json) {
        include "connection-pdo.php";

        $data = json_decode($json, true);

        // 1. Validate Required Fields
        if (empty($data['first_name']) || empty($data['last_name']) || empty($data['role']) || empty($data['username']) || empty($data['email']) || empty($data['password'])) {
            echo json_encode(["status" => "error", "message" => "First name, last name, role, username, email, and password are required"]);
            return;
        }

        // 2. Assign Variables
        $first_name = $data['first_name'];
        $middle_name = !empty($data['middle_name']) ? $data['middle_name'] : null;
        $last_name = $data['last_name'];
        $role_name = $data['role'];
        $username = $data['username'];
        $email = trim($data['email']);
        $password = password_hash($data['password'], PASSWORD_DEFAULT);
        $branch_id = $this->normalizeBranchId($data['branch_id'] ?? null);
        $birthday = $this->normalizeBirthday($data['birthday'] ?? null);

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            echo json_encode(["status" => "error", "message" => "Please provide a valid email address"]);
            return;
        }

        if ($birthday === false) {
            echo json_encode(["status" => "error", "message" => "Invalid birthday selected"]);
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

        // 4. Check Duplicate Username
        $sqlCheck = "SELECT COUNT(*) FROM employee WHERE username = :username";
        $stmt = $conn->prepare($sqlCheck);
        $stmt->bindParam(":username", $username);
        $stmt->execute();
        if ($stmt->fetchColumn() > 0) {
            echo json_encode(["status" => "error", "message" => "Username already exists"]);
            return;
        }

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
                      (first_name, middle_name, last_name, birthday, role_id, username, email, password_hash, status, branch_id, date_created)
                      VALUES
                      (:first_name, :middle_name, :last_name, :birthday, :role_id, :username, :email, :password, 'active', :branch_id, NOW())";

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

        if ($result) {
            // assign subjects if provided
            $lastId = $conn->lastInsertId();
            if (isset($data['subjects']) && is_array($data['subjects'])) {
                $this->assignSubjects($lastId, $data['subjects']);
            }
            if (isset($data['programs']) && is_array($data['programs'])) {
                $this->assignPrograms($lastId, $data['programs']);
            }
            echo json_encode(["status" => "success", "message" => "Employee account created successfully"]);
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
            GROUP BY e.employee_id
            ORDER BY e.date_created DESC";
        $stmt = $conn->prepare($sql);
        $stmt->execute();
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
        if ($birthday === false) {
            echo json_encode(["status" => "error", "message" => "Invalid birthday selected"]);
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
        $schedules = $data['schedules']; // Expecting array of {day, start, end}

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
        
        $sql = "SELECT e.employee_id, e.first_name, e.middle_name, e.last_name, e.username, e.email, e.contact_number, 
                       e.birthday, e.degree, e.status, e.date_created, e.profile_picture, r.role_name, b.branch_name,
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

        if (empty($data['employee_id'])) {
            echo json_encode(["status" => "error", "message" => "Employee ID is required"]);
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

        if (!empty($data['profile_picture'])) {
            $sql .= ", profile_picture = :profile_picture";
        }

        $sql .= " WHERE employee_id = :employee_id";

        $stmt = $conn->prepare($sql);
        $params = [
            ":first_name" => $data['first_name'],
            ":middle_name" => $data['middle_name'],
            ":last_name" => $data['last_name'],
            ":email" => $data['email'],
            ":contact_number" => $data['contact_number'],
            ":birthday" => $data['birthday'],
            ":degree" => $data['degree'],
            ":employee_id" => $data['employee_id']
        ];

        if (!empty($data['profile_picture'])) {
            $params[':profile_picture'] = $data['profile_picture'];
        }

        $result = $stmt->execute($params);

        if ($result) {
            echo json_encode(["status" => "success", "message" => "Profile updated successfully"]);
        } else {
            echo json_encode(["status" => "error", "message" => "Failed to update profile"]);
        }
    }

    // --- UPDATE EMPLOYEE PASSWORD & USERNAME ---
    function updateEmployeePassword($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true);

        if (empty($data['employee_id']) || empty($data['new_password']) || empty($data['email'])) {
            echo json_encode(["status" => "error", "message" => "Employee ID, email, and new password are required"]);
            return;
        }

        $newEmail = trim($data['email']);
        if (!filter_var($newEmail, FILTER_VALIDATE_EMAIL)) {
            echo json_encode(["status" => "error", "message" => "Please provide a valid email address"]);
            return;
        }

        if (strlen($data['new_password']) < 8 ||
            !preg_match('/[A-Za-z]/', $data['new_password']) ||
            !preg_match('/[A-Z]/', $data['new_password']) ||
            !preg_match('/[0-9]/', $data['new_password']) ||
            !preg_match('/[^A-Za-z0-9]/', $data['new_password'])) {
            echo json_encode(["status" => "error", "message" => "Password must be at least 8 characters long and include at least 1 letter, 1 uppercase letter, 1 number, and 1 symbol"]);
            return;
        }

        if (isset($data['confirm_password']) && $data['new_password'] !== $data['confirm_password']) {
            echo json_encode(["status" => "error", "message" => "New password and confirmation do not match"]);
            return;
        }

        $stmt = $conn->prepare("SELECT username, password_hash FROM employee WHERE employee_id = :employee_id LIMIT 1");
        $stmt->execute([":employee_id" => $data['employee_id']]);
        $employee = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$employee) {
            echo json_encode(["status" => "error", "message" => "Employee not found"]);
            return;
        }

        $newUsername = trim($data['username'] ?? $employee['username']);
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
        $stmtUpdate = $conn->prepare("UPDATE employee SET username = :username, email = :email, password_hash = :password_hash WHERE employee_id = :employee_id");
        $success = $stmtUpdate->execute([
            ":username" => $newUsername,
            ":email" => $newEmail,
            ":password_hash" => $updatedPasswordHash,
            ":employee_id" => $data['employee_id']
        ]);

        if ($success) {
            echo json_encode(["status" => "success", "message" => "Login credentials updated successfully"]);
        } else {
            echo json_encode(["status" => "error", "message" => "Failed to update login credentials"]);
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

        if (isset($_FILES['profile_picture']) && $_FILES['profile_picture']['error'] == UPLOAD_ERR_OK) {
            $file = $_FILES['profile_picture'];
            $upload_dir = '../../uploads/employee_profiles/';

            if (!is_dir($upload_dir)) {
                mkdir($upload_dir, 0755, true);
            }

            $file_ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
            $filename = 'employee_' . time() . '_' . uniqid() . '.' . $file_ext;
            $upload_path = $upload_dir . $filename;

            $allowed_types = ['image/jpeg', 'image/png', 'image/gif'];
            if (in_array($file['type'], $allowed_types) && $file['size'] <= 5 * 1024 * 1024) {
                if (move_uploaded_file($file['tmp_name'], $upload_path)) {
                    $data = json_decode($json, true);
                    $relativePath = 'uploads/employee_profiles/' . $filename;
                    $data['profile_picture'] = $relativePath;
                    $json = json_encode($data);
                }
            }
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
    case "getEmployeeProfile": $employee->getEmployeeProfile($_GET['employee_id']); break;
    case "updateEmployeeProfile": $employee->updateEmployeeProfile($json); break;
    case "updateEmployeePassword": $employee->updateEmployeePassword($json); break;
    default: echo json_encode(["status" => "error", "message" => "Invalid Operation"]); break;

}
?>
