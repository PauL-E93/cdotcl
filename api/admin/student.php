<?php
// student.php

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET");
header("Access-Control-Allow-Headers: Content-Type");

class Student {
    
    function addStudent($json) {
        include "connection-pdo.php";

        $data = json_decode($json, true);

        // 1. Basic Validation
        if (empty($data['first_name']) || empty($data['last_name'])) {
            echo json_encode([
                "status" => "error",
                "message" => "First Name and Last Name are required."
            ]);
            return;
        }

        try {
            $conn->beginTransaction(); // Start Transaction

            // --- STEP 1: INSERT GUARDIAN ---
            $g_name = $data['guardian_name'] ?? '';
            $g_contact = $data['guardian_contact'] ?? '';
            $g_rel = $data['guardian_relationship'] ?? '';

            // Insert into guardian table (Matches image: guardian_id, name, contact_number, relationship)
            $sqlGuardian = "INSERT INTO guardian (name, contact_number, relationship) VALUES (:name, :contact, :rel)";
            $stmtG = $conn->prepare($sqlGuardian);
            $stmtG->bindParam(":name", $g_name);
            $stmtG->bindParam(":contact", $g_contact);
            $stmtG->bindParam(":rel", $g_rel);
            $stmtG->execute();
            
            // Get the newly created Guardian ID
            $guardian_id = $conn->lastInsertId();

            // --- STEP 2: PREPARE STUDENT DATA ---
            $first_name    = $data['first_name'];
            $middle_name   = $data['middle_name'] ?? null;
            $last_name     = $data['last_name'];
            $ext           = isset($data['ext']) ? trim((string)$data['ext']) : '';
            
            // AUTO-GENERATE CREDENTIALS
            // Username: firstName + lastName (lowercase, no spaces)
            // Password: firstName + "@123" (preserve the entered capitalization)
            $cleanFirst = strtolower(str_replace(' ', '', $first_name));
            $cleanLast  = strtolower(str_replace(' ', '', $last_name));
            $passwordFirstName = preg_replace('/\s+/', '', trim((string)$first_name));
            
            $username      = $cleanFirst . $cleanLast;
            $raw_password  = $passwordFirstName . "@123";
            $password_hash = password_hash($raw_password, PASSWORD_DEFAULT);

            $email         = $data['email'] ?? null;
            $gender_id     = !empty($data['gender_id']) ? $data['gender_id'] : null;
            $birthday      = !empty($data['birthday']) ? $data['birthday'] : null;
            $nickname      = $data['nickname'] ?? null;
            $adr_street    = $data['adr_street'] ?? null;
            $adr_barangay  = $data['adr_barangay'] ?? null;
            $adr_city      = $data['adr_city'] ?? null;
            $adr_province  = $data['adr_province'] ?? null;
            $adr_note      = $data['adr_note'] ?? null;
            $health_note   = isset($data['health_note']) && trim((string)$data['health_note']) !== ''
                ? trim((string)$data['health_note'])
                : null;
            
            // System Variables
            $status        = 'active'; // Always active on save
            $role_id       = 1; 
            $employee_id   = isset($_SESSION['employee_id']) ? $_SESSION['employee_id'] : 1; 

            $hasHealthNoteStmt = $conn->prepare("SHOW COLUMNS FROM student LIKE 'health_note'");
            $hasHealthNoteStmt->execute();
            $hasHealthNote = (bool)$hasHealthNoteStmt->fetch();

            $hasExtStmt = $conn->prepare("SHOW COLUMNS FROM student LIKE 'ext'");
            $hasExtStmt->execute();
            $hasExt = (bool)$hasExtStmt->fetch();

            $healthNoteColumn = $hasHealthNote ? ", health_note" : "";
            $healthNoteValue = $hasHealthNote ? ", :health_note" : "";

            // Generate school-year student ID number for supported enrollment categories
            $student_id_number = null;
            $enrollmentCategory = trim(strtolower($data['enrollment_category'] ?? 'tutorial'));
            $studentIdNumberColumn = false;

            $studentIdColumnCheck = $conn->prepare("SHOW COLUMNS FROM student LIKE 'student_id_number'");
            $studentIdColumnCheck->execute();
            if ($studentIdColumnCheck->fetch()) {
                $studentIdNumberColumn = true;
            }

            if ($studentIdNumberColumn && in_array($enrollmentCategory, ['preschool', 'tutorial'], true)) {
                $schoolYearRow = $conn->query("SELECT school_year FROM school_years WHERE sy_status = 'active' LIMIT 1")->fetch(PDO::FETCH_ASSOC);
                $schoolYearLabel = $schoolYearRow ? trim($schoolYearRow['school_year']) : null;

                if ($schoolYearLabel) {
                    // Use the starting year from labels such as "2025-2026".
                    preg_match('/\b(\d{4})\b/', $schoolYearLabel, $matches);
                    $schoolYearStart = $matches[1] ?? $schoolYearLabel;
                    $prefix = $schoolYearStart . ' - ';

                    $countStmt = $conn->prepare("SELECT COUNT(*) AS total FROM student WHERE student_id_number LIKE :prefix");
                    $countStmt->execute([":prefix" => $prefix . "%"]);
                    $countRow = $countStmt->fetch(PDO::FETCH_ASSOC);
                    $sequence = intval($countRow['total'] ?? 0) + 1;
                    $student_id_number = $prefix . str_pad($sequence, 4, '0', STR_PAD_LEFT);
                }
            }

            // --- STEP 3: INSERT STUDENT ---
            $studentFields = [
                'username',
                'password_hash',
                'email',
                'first_name',
                'middle_name',
                'last_name',
                'gender_id',
                'birthday',
                'nickname',
                'adr_street',
                'adr_barangay',
                'adr_city',
                'adr_province',
                'adr_note',
                'guardian_id',
                'role_id',
                'employee_id',
                'status',
                'date_created'
            ];
            $studentValues = [
                ':username',
                ':password_hash',
                ':email',
                ':first_name',
                ':middle_name',
                ':last_name',
                ':gender_id',
                ':birthday',
                ':nickname',
                ':adr_street',
                ':adr_barangay',
                ':adr_city',
                ':adr_province',
                ':adr_note',
                ':guardian_id',
                ':role_id',
                ':employee_id',
                ':status',
                'NOW()'
            ];

            if ($studentIdNumberColumn) {
                $studentFields[] = 'student_id_number';
                $studentValues[] = ':student_id_number';
            }
            if ($hasExt) {
                $lastNameIndex = array_search('last_name', $studentFields, true);
                array_splice($studentFields, $lastNameIndex + 1, 0, 'ext');
                array_splice($studentValues, $lastNameIndex + 1, 0, ':ext');
            }
            if ($hasHealthNote) {
                $studentFields[] = 'health_note';
                $studentValues[] = ':health_note';
            }

            $sqlStudent = "INSERT INTO student (" . implode(", ", $studentFields) . ") VALUES (" . implode(", ", $studentValues) . ")";
            $stmtS = $conn->prepare($sqlStudent);
            $stmtS->bindParam(":username", $username);
            $stmtS->bindParam(":password_hash", $password_hash);
            $stmtS->bindParam(":email", $email);
            $stmtS->bindParam(":first_name", $first_name);
            $stmtS->bindParam(":middle_name", $middle_name);
            $stmtS->bindParam(":last_name", $last_name);
            if ($hasExt) {
                $stmtS->bindParam(":ext", $ext);
            }
            $stmtS->bindParam(":gender_id", $gender_id);
            $stmtS->bindParam(":birthday", $birthday);
            $stmtS->bindParam(":nickname", $nickname);
            $stmtS->bindParam(":adr_street", $adr_street);
            $stmtS->bindParam(":adr_barangay", $adr_barangay);
            $stmtS->bindParam(":adr_city", $adr_city);
            $stmtS->bindParam(":adr_province", $adr_province);
            $stmtS->bindParam(":adr_note", $adr_note);
            $stmtS->bindParam(":guardian_id", $guardian_id); // Use the ID from Step 1
            $stmtS->bindParam(":role_id", $role_id);
            $stmtS->bindParam(":employee_id", $employee_id);
            $stmtS->bindParam(":status", $status);
            if ($studentIdNumberColumn) {
                $stmtS->bindParam(":student_id_number", $student_id_number);
            }
            if ($hasHealthNote) {
                $stmtS->bindParam(":health_note", $health_note);
            }

            $stmtS->execute();

            $conn->commit(); // Commit Transaction

            $student_id = intval($conn->lastInsertId());
            if ($student_id <= 0) {
                $stmtFind = $conn->prepare("SELECT student_id FROM student WHERE username = ? AND email = ? ORDER BY student_id DESC LIMIT 1");
                $stmtFind->execute([$username, $email]);
                $foundStudent = $stmtFind->fetch(PDO::FETCH_ASSOC);
                if ($foundStudent) {
                    $student_id = intval($foundStudent['student_id']);
                }
            }

            // Keep the one-time starter credentials server-side until the
            // enrollment is finalized and its welcome email is sent.
            if ($student_id > 0) {
                if (!isset($_SESSION['pending_enrollment_credentials']) || !is_array($_SESSION['pending_enrollment_credentials'])) {
                    $_SESSION['pending_enrollment_credentials'] = [];
                }

                $_SESSION['pending_enrollment_credentials'][$student_id] = [
                    'username' => $username,
                    'password' => $raw_password,
                    'created_at' => time()
                ];
            }

            // Include current branch info from session if available
            $currentBranch = null;
            if (isset($_SESSION['branch_id'])) {
                $stmtB = $conn->prepare("SELECT branch_id, branch_name FROM branch WHERE branch_id = ? LIMIT 1");
                $stmtB->execute([$_SESSION['branch_id']]);
                $currentBranch = $stmtB->fetch(PDO::FETCH_ASSOC);
            }

            echo json_encode([
                "status" => "success",
                "student_id" => $student_id,
                "student_name" => trim($first_name . " " . $last_name . " " . $ext),
                "current_branch" => $currentBranch
            ]);

        } catch (PDOException $e) {
            $conn->rollBack(); // Rollback if error
            
            if ($e->errorInfo[1] == 1062) {
                echo json_encode(["status" => "error", "message" => "Username or Email already exists."]);
            } else {
                echo json_encode(["status" => "error", "message" => "Database error: " . $e->getMessage()]);
            }
        }
    }

    // Update Function for Profile
    function updateStudent($json) {
        include "connection-pdo.php";

        $data = json_decode($json, true);

        // Validation
        if (empty($data['student_id']) || empty($data['first_name']) || empty($data['last_name'])) {
            echo json_encode([
                "status" => "error",
                "message" => "Student ID, First Name, and Last Name are required."
            ]);
            return;
        }

        try {
            $conn->beginTransaction();

            $student_id = $data['student_id'];
            
            // --- STEP 1: UPDATE GUARDIAN (if guardian_id exists) ---
            if (!empty($data['guardian_id'])) {
                $g_name = $data['guardian_name'] ?? '';
                $g_contact = $data['guardian_contact'] ?? '';
                $g_rel = $data['guardian_relationship'] ?? '';

                $sqlGuardian = "UPDATE guardian SET name = :name, contact_number = :contact, relationship = :rel WHERE guardian_id = :guardian_id";
                $stmtG = $conn->prepare($sqlGuardian);
                $stmtG->bindParam(":name", $g_name);
                $stmtG->bindParam(":contact", $g_contact);
                $stmtG->bindParam(":rel", $g_rel);
                $stmtG->bindParam(":guardian_id", $data['guardian_id']);
                $stmtG->execute();
            }

            // --- STEP 2: UPDATE STUDENT ---
            $first_name = $data['first_name'];
            $middle_name = $data['middle_name'] ?? null;
            $last_name = $data['last_name'];
            $ext = isset($data['ext']) ? trim((string)$data['ext']) : '';
            $email = $data['email'] ?? null;
            $gender_id = !empty($data['gender_id']) ? $data['gender_id'] : null;
            $birthday = !empty($data['birthday']) ? $data['birthday'] : null;
            $nickname = $data['nickname'] ?? null;
            $adr_street = $data['adr_street'] ?? null;
            $adr_barangay = $data['adr_barangay'] ?? null;
            $adr_city = $data['adr_city'] ?? null;
            $adr_province = $data['adr_province'] ?? null;
            $adr_note = $data['adr_note'] ?? null;
            $health_note = isset($data['health_note']) && trim((string)$data['health_note']) !== ''
                ? trim((string)$data['health_note'])
                : null;
            $profile_picture = array_key_exists('profile_picture', $data) ? $data['profile_picture'] : null;

            // Only update profile_picture when a new value is provided.
            $updateProfilePictureSql = '';
            if ($profile_picture !== null) {
                $updateProfilePictureSql = ", profile_picture = :profile_picture";
            }

            $sqlStudent = "UPDATE student SET 
                first_name = :first_name,
                middle_name = :middle_name,
                last_name = :last_name,
                ext = :ext,
                email = :email,
                gender_id = :gender_id,
                birthday = :birthday,
                nickname = :nickname,
                adr_street = :adr_street,
                adr_barangay = :adr_barangay,
                adr_city = :adr_city,
                adr_province = :adr_province,
                adr_note = :adr_note,
                health_note = :health_note" .
                $updateProfilePictureSql .
                " WHERE student_id = :student_id";

            $stmtS = $conn->prepare($sqlStudent);
            $stmtS->bindParam(":first_name", $first_name);
            $stmtS->bindParam(":middle_name", $middle_name);
            $stmtS->bindParam(":last_name", $last_name);
            $stmtS->bindParam(":ext", $ext);
            $stmtS->bindParam(":email", $email);
            $stmtS->bindParam(":gender_id", $gender_id);
            $stmtS->bindParam(":birthday", $birthday);
            $stmtS->bindParam(":nickname", $nickname);
            $stmtS->bindParam(":adr_street", $adr_street);
            $stmtS->bindParam(":adr_barangay", $adr_barangay);
            $stmtS->bindParam(":adr_city", $adr_city);
            $stmtS->bindParam(":adr_province", $adr_province);
            $stmtS->bindParam(":adr_note", $adr_note);
            $stmtS->bindParam(":health_note", $health_note);
            if ($profile_picture !== null) {
                $stmtS->bindParam(":profile_picture", $profile_picture);
            }
            $stmtS->bindParam(":student_id", $student_id);

            $stmtS->execute();

            $conn->commit();

            echo json_encode([
                "status" => "success",
                "message" => "Profile updated successfully.",
                "student_id" => $student_id,
                "student_name" => trim($first_name . " " . $last_name . " " . $ext)
            ]);

        } catch (PDOException $e) {
            $conn->rollBack();
            echo json_encode([
                "status" => "error",
                "message" => "Database error: " . $e->getMessage()
            ]);
        }
    }

    // Update Student Password
    function updateStudentPassword($json) {
        include "connection-pdo.php";

        $data = json_decode($json, true);
        $student_id = $data['student_id'] ?? null;
        $username = trim($data['username'] ?? '');
        $new_password = $data['new_password'] ?? '';
        $confirm_password = $data['confirm_password'] ?? '';

        if (empty($student_id) || empty($username) || empty($new_password) || empty($confirm_password)) {
            echo json_encode(["status" => "error", "message" => "All fields are required."]);
            return;
        }

        if ($new_password !== $confirm_password) {
            echo json_encode(["status" => "error", "message" => "Passwords do not match."]);
            return;
        }

        if (strlen($new_password) < 8 || !preg_match('/[A-Za-z]/', $new_password) || !preg_match('/[A-Z]/', $new_password) || !preg_match('/[0-9]/', $new_password) || !preg_match('/[^A-Za-z0-9]/', $new_password)) {
            echo json_encode(["status" => "error", "message" => "Password must be at least 8 characters and include at least 1 letter, 1 uppercase letter, 1 number, and 1 symbol."]);
            return;
        }

        try {
            $conn->beginTransaction();

            // Update username if changed
            $sqlUpdate = "UPDATE student SET username = :username, password_hash = :password_hash WHERE student_id = :student_id";
            $stmt = $conn->prepare($sqlUpdate);
            $stmt->bindParam(':username', $username);
            $password_hash = password_hash($new_password, PASSWORD_DEFAULT);
            $stmt->bindParam(':password_hash', $password_hash);
            $stmt->bindParam(':student_id', $student_id);
            $stmt->execute();

            $conn->commit();

            echo json_encode(["status" => "success", "message" => "Password updated successfully."]);
        } catch (PDOException $e) {
            $conn->rollBack();
            if ($e->errorInfo[1] == 1062) {
                echo json_encode(["status" => "error", "message" => "Username already exists."]);
            } else {
                echo json_encode(["status" => "error", "message" => "Database error: " . $e->getMessage()]);
            }
        }
    }

    // Get Student Profile by ID
    function getStudentProfile($student_id) {
        include "connection-pdo.php";
        try {
            $sql = "SELECT s.student_id, s.student_id_number, s.username, s.first_name, s.middle_name, s.last_name, s.ext, s.nickname, 
                           s.email, s.birthday, s.gender_id, s.guardian_id, s.profile_picture, s.health_note,
                           s.adr_street, s.adr_barangay, s.adr_city, s.adr_province, s.adr_note,
                           g.name as guardian_name, g.contact_number as guardian_contact, g.relationship as guardian_relationship
                    FROM student s
                    LEFT JOIN guardian g ON s.guardian_id = g.guardian_id
                    WHERE s.student_id = :student_id LIMIT 1";
            $stmt = $conn->prepare($sql);
            $stmt->bindParam(":student_id", $student_id);
            $stmt->execute();
            $result = $stmt->fetch(PDO::FETCH_ASSOC);
            
            if ($result) {
                echo json_encode([
                    "status" => "success",
                    "data" => $result
                ]);
            } else {
                echo json_encode([
                    "status" => "error",
                    "message" => "Student not found"
                ]);
            }
        } catch (Exception $e) {
            echo json_encode([
                "status" => "error",
                "message" => "Database error: " . $e->getMessage()
            ]);
        }
    }

    // New Function for Gender Lookup
    function getGenders() {
        include "connection-pdo.php";
        try {
            $sql = "SELECT * FROM gender ORDER BY gender ASC";
            $stmt = $conn->prepare($sql);
            $stmt->execute();
            $result = $stmt->fetchAll(PDO::FETCH_ASSOC);
            echo json_encode($result);
        } catch (Exception $e) {
            echo json_encode([]);
        }
    }
}

// Handling Request
if ($_SERVER['REQUEST_METHOD'] == 'GET'){
    $operation = isset($_GET['operation']) ? $_GET['operation'] : null;
    $json = isset($_GET['json']) ? $_GET['json'] : "";
} else if($_SERVER['REQUEST_METHOD'] == 'POST'){
    // Check if this is a multipart/form-data request (file upload)
    if (strpos($_SERVER['CONTENT_TYPE'] ?? '', 'multipart/form-data') !== false) {
        $operation = $_POST['operation'] ?? null;
        $json = $_POST['json'] ?? "";
        
        // Handle file upload if present
        if (isset($_FILES['profile_picture']) && $_FILES['profile_picture']['error'] == UPLOAD_ERR_OK) {
            $file = $_FILES['profile_picture'];
            $upload_dir = '../../uploads/student_profiles/';
            
            // Create directory if it doesn't exist
            if (!is_dir($upload_dir)) {
                mkdir($upload_dir, 0755, true);
            }
            
            // Generate unique filename
            $file_ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
            $filename = 'student_' . time() . '_' . uniqid() . '.' . $file_ext;
            $upload_path = $upload_dir . $filename;
            
            // Validate file type
            $allowed_types = ['image/jpeg', 'image/png', 'image/gif'];
            if (in_array($file['type'], $allowed_types) && $file['size'] <= 5 * 1024 * 1024) {
                if (move_uploaded_file($file['tmp_name'], $upload_path)) {
                    // Decode json and add the profile_picture path
                    $data = json_decode($json, true);
                    $relativePath = 'uploads/student_profiles/' . $filename;
                    $data['profile_picture'] = $relativePath;
                    $json = json_encode($data);
                }
            }
        }
    } else {
        $content = file_get_contents('php://input');
        $postData = json_decode($content, true);
        $operation = $postData['operation'] ?? null;
        $json = $postData['json'] ?? "";
    }
}

$student = new Student();

switch($operation){
    case "addStudent":
        $student->addStudent($json);
        break;
    case "updateStudent":
        $student->updateStudent($json);
        break;
    case "updateStudentPassword":
        $student->updateStudentPassword($json);
        break;
    case "getStudentProfile":
        $student_id = isset($_GET['student_id']) ? $_GET['student_id'] : null;
        if ($student_id) {
            $student->getStudentProfile($student_id);
        } else {
            echo json_encode(["status" => "error", "message" => "Student ID required"]);
        }
        break;
    case "getGenders":
        $student->getGenders();
        break;
    default:    
        echo json_encode(["status" => "error", "message" => "Invalid Operation"]);
        break;}
?>
