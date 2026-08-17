<?php
// api/admin/section.php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$role = strtolower(trim((string) ($_SESSION['user_role'] ?? '')));
$role = preg_replace('/[\s_-]+/', ' ', $role);
if ($role === 'teacher') {
    http_response_code(403);
    echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
    exit;
}

function getSectionBranchAdminBranchId() {
    global $role;

    if ($role !== 'branch admin') {
        return null;
    }

    $branchId = intval($_SESSION['branch_id'] ?? 0);
    if ($branchId <= 0) {
        http_response_code(403);
        echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
        exit;
    }

    return $branchId;
}

function denySectionAccess() {
    http_response_code(403);
    echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
}

function classBelongsToBranch($conn, $classId, $branchId) {
    if (!$branchId) {
        return true;
    }

    $stmt = $conn->prepare("SELECT 1 FROM class WHERE class_id = :class_id AND branch_id = :branch_id LIMIT 1");
    $stmt->execute([
        ':class_id' => $classId,
        ':branch_id' => $branchId
    ]);
    return (bool) $stmt->fetchColumn();
}

function sectionBelongsToBranch($conn, $sectionId, $branchId) {
    if (!$branchId) {
        return true;
    }

    $stmt = $conn->prepare("SELECT 1
                            FROM sections s
                            JOIN class c ON s.class_id = c.class_id
                            WHERE s.section_id = :section_id
                              AND c.branch_id = :branch_id
                            LIMIT 1");
    $stmt->execute([
        ':section_id' => $sectionId,
        ':branch_id' => $branchId
    ]);
    return (bool) $stmt->fetchColumn();
}

function employeeBelongsToBranch($conn, $employeeId, $branchId) {
    if (!$branchId) {
        return true;
    }

    $stmt = $conn->prepare("SELECT 1 FROM employee WHERE employee_id = :employee_id AND branch_id = :branch_id LIMIT 1");
    $stmt->execute([
        ':employee_id' => $employeeId,
        ':branch_id' => $branchId
    ]);
    return (bool) $stmt->fetchColumn();
}

class Section {
    function getAllSections(){
        include "connection-pdo.php";
        $branchId = getSectionBranchAdminBranchId();
        $sql = "SELECT s.section_id, s.class_id, s.employee_id, s.section_name, s.status, s.max, e.first_name, e.last_name, e.status AS instructor_status
                FROM sections s 
                JOIN class c ON s.class_id = c.class_id
                LEFT JOIN employee e ON s.employee_id = e.employee_id"
                . ($branchId ? " WHERE c.branch_id = :branch_id" : "") .
                " 
                ORDER BY s.section_name ASC";
        $stmt = $conn->prepare($sql);
        $stmt->execute($branchId ? [':branch_id' => $branchId] : []);
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    // ADDED: Logic for the nested table view
    function getSectionsByClass($class_id) {
        include "connection-pdo.php";
        $branchId = getSectionBranchAdminBranchId();
        if (!classBelongsToBranch($conn, $class_id, $branchId)) {
            echo json_encode([]);
            return;
        }
        
        // First, verify and update section status based on current enrollment
        $verifySql = "SELECT s.section_id, s.max, s.status, COUNT(ed.enrollment_details_id) as enrolled_count
                     FROM sections s
                     LEFT JOIN enrollment_details ed ON s.section_id = ed.section_id AND ed.status = 'enrolled'
                     WHERE s.class_id = :class_id
                     GROUP BY s.section_id, s.max, s.status";
        $verifyStmt = $conn->prepare($verifySql);
        $verifyStmt->bindParam(":class_id", $class_id);
        $verifyStmt->execute();
        $verifyResults = $verifyStmt->fetchAll(PDO::FETCH_ASSOC);
        
        // Update section status if needed
        foreach ($verifyResults as $result) {
            $enrolledCount = (int)$result['enrolled_count'];
            $maxCapacity = (int)$result['max'];
            $currentStatus = $result['status'];
            $sectionId = $result['section_id'];
            
            if ($maxCapacity > 0) {
                if ($enrolledCount >= $maxCapacity && $currentStatus !== 'full') {
                    $updateSql = "UPDATE sections SET status = 'full' WHERE section_id = :section_id";
                } elseif ($enrolledCount < $maxCapacity && $currentStatus === 'full') {
                    $updateSql = "UPDATE sections SET status = 'open' WHERE section_id = :section_id";
                } else {
                    continue;
                }
                $updateStmt = $conn->prepare($updateSql);
                $updateStmt->bindParam(":section_id", $sectionId);
                $updateStmt->execute();
            }
        }
        
        // Now fetch the updated section data
        $sql = "SELECT s.section_id, s.class_id, s.employee_id, s.section_name, s.status, s.max, e.first_name, e.last_name, e.status AS instructor_status,
                GROUP_CONCAT(CONCAT(sch.day_of_week, ': ', TIME_FORMAT(sch.start_time, '%h:%i %p'), '-', TIME_FORMAT(sch.end_time, '%h:%i %p')) SEPARATOR ' | ') as schedule_info
                FROM sections s
                LEFT JOIN employee e ON s.employee_id = e.employee_id
                LEFT JOIN section_schedules sch ON s.section_id = sch.section_id
                WHERE s.class_id = :class_id
                GROUP BY s.section_id
                ORDER BY s.section_name ASC";
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":class_id", $class_id);
        $stmt->execute();
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    function getSectionById(){
        include "connection-pdo.php";
        $section_id = $_GET['section_id'];
        $branchId = getSectionBranchAdminBranchId();
        $sql = "SELECT s.section_id, s.class_id, s.employee_id, s.section_name, s.status, s.max, e.first_name, e.last_name, e.status AS instructor_status
                FROM sections s
                JOIN class c ON s.class_id = c.class_id
                LEFT JOIN employee e ON s.employee_id = e.employee_id
                WHERE s.section_id = :id"
                . ($branchId ? " AND c.branch_id = :branch_id" : "");
        $stmt = $conn->prepare($sql);
        $params = [':id' => $section_id];
        if ($branchId) {
            $params[':branch_id'] = $branchId;
        }
        $stmt->execute($params);
        echo json_encode($stmt->fetch(PDO::FETCH_ASSOC));
    }

    function getSectionSchedules(){
        include "connection-pdo.php";
        $section_id = $_GET['section_id'];
        $branchId = getSectionBranchAdminBranchId();
        $sql = "SELECT sch.schedule_id, sch.day_of_week as day, sch.start_time as start, sch.end_time as end
                FROM section_schedules sch
                JOIN sections s ON sch.section_id = s.section_id
                JOIN class c ON s.class_id = c.class_id
                WHERE sch.section_id = :id"
                . ($branchId ? " AND c.branch_id = :branch_id" : "") .
                " ORDER BY sch.day_of_week";
        $stmt = $conn->prepare($sql);
        $params = [':id' => $section_id];
        if ($branchId) {
            $params[':branch_id'] = $branchId;
        }
        $stmt->execute($params);
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    function insertSection($json){
        include "connection-pdo.php";
        $data = json_decode($json, true);
        $branchId = getSectionBranchAdminBranchId();
        if (!classBelongsToBranch($conn, $data['class_id'] ?? null, $branchId)
            || !employeeBelongsToBranch($conn, $data['employee_id'] ?? null, $branchId)) {
            denySectionAccess();
            return;
        }
        try {
            $conn->beginTransaction();
            $sqlSec = "INSERT INTO sections(class_id, employee_id, section_name, status, max) 
                       VALUES(:class_id, :employee_id, :section_name, :status, :max)";
            $stmtSec = $conn->prepare($sqlSec);
            $stmtSec->bindParam(":class_id", $data['class_id']);
            $stmtSec->bindParam(":employee_id", $data['employee_id']);
            $stmtSec->bindParam(":section_name", $data['section_name']);
            $stmtSec->bindParam(":status", $data['status']);
            $max = $data['max'] ?? null;
            $stmtSec->bindParam(":max", $max);
            $stmtSec->execute();

            $section_id = $conn->lastInsertId();

            if(isset($data['schedules']) && is_array($data['schedules'])) {
                $sqlSched = "INSERT INTO section_schedules(section_id, day_of_week, start_time, end_time) 
                             VALUES(:section_id, :day, :start, :end)";
                $stmtSched = $conn->prepare($sqlSched);
                foreach($data['schedules'] as $s) {
                    $stmtSched->bindParam(":section_id", $section_id);
                    $stmtSched->bindParam(":day", $s['day']);
                    $stmtSched->bindParam(":start", $s['start']);
                    $stmtSched->bindParam(":end", $s['end']);
                    $stmtSched->execute();
                }
            }
            $conn->commit();
            echo json_encode(1); 
        } catch (Exception $e) {
            $conn->rollBack();
            echo json_encode("Error: " . $e->getMessage());
        }
    }

    function updateSection($json){
        include "connection-pdo.php";
        $data = json_decode($json, true);
        $branchId = getSectionBranchAdminBranchId();
        if (!sectionBelongsToBranch($conn, $data['section_id'] ?? null, $branchId)
            || !classBelongsToBranch($conn, $data['class_id'] ?? null, $branchId)
            || !employeeBelongsToBranch($conn, $data['employee_id'] ?? null, $branchId)) {
            denySectionAccess();
            return;
        }
        try {
            $conn->beginTransaction();
            $sectionId = $data['section_id'];
            $maxCapacity = $data['max'] ?? null;
            $status = $data['status'];

            if ($maxCapacity !== null) {
                $countSql = "SELECT COUNT(enrollment_details_id) AS enrolled_count FROM enrollment_details WHERE section_id = :section_id AND status = 'enrolled'";
                $countStmt = $conn->prepare($countSql);
                $countStmt->bindParam(":section_id", $sectionId);
                $countStmt->execute();
                $enrolledCount = (int)$countStmt->fetchColumn();

                if ($maxCapacity > 0) {
                    if ($enrolledCount >= $maxCapacity) {
                        $status = 'full';
                    } elseif ($status === 'full') {
                        $status = 'open';
                    }
                }
            }

            $sql = "UPDATE sections SET class_id = :class_id, employee_id = :employee_id, section_name = :section_name, status = :status, max = :max WHERE section_id = :id";
            $stmt = $conn->prepare($sql);
            $stmt->bindParam(":class_id", $data['class_id']);
            $stmt->bindParam(":employee_id", $data['employee_id']);
            $stmt->bindParam(":section_name", $data['section_name']);
            $stmt->bindParam(":status", $status);
            $max = $data['max'] ?? null;
            $stmt->bindParam(":max", $max);
            $stmt->bindParam(":id", $sectionId);
            $stmt->execute();

            // Handle schedules: update existing, insert new, delete removed
            $existingSchedules = [];
            $sqlGet = "SELECT schedule_id FROM section_schedules WHERE section_id = :id";
            $stmtGet = $conn->prepare($sqlGet);
            $stmtGet->bindParam(":id", $data['section_id']);
            $stmtGet->execute();
            $existing = $stmtGet->fetchAll(PDO::FETCH_ASSOC);
            foreach ($existing as $e) {
                $existingSchedules[] = $e['schedule_id'];
            }

            $incomingSchedules = [];
            if(isset($data['schedules']) && is_array($data['schedules'])) {
                foreach($data['schedules'] as $s) {
                    if (isset($s['schedule_id'])) {
                        $incomingSchedules[] = $s['schedule_id'];
                        // Update existing
                        $sqlUpd = "UPDATE section_schedules
                                   SET day_of_week = :day, start_time = :start, end_time = :end
                                   WHERE schedule_id = :sid AND section_id = :section_id";
                        $stmtUpd = $conn->prepare($sqlUpd);
                        $stmtUpd->bindParam(":day", $s['day']);
                        $stmtUpd->bindParam(":start", $s['start']);
                        $stmtUpd->bindParam(":end", $s['end']);
                        $stmtUpd->bindParam(":sid", $s['schedule_id']);
                        $stmtUpd->bindParam(":section_id", $data['section_id']);
                        $stmtUpd->execute();
                    } else {
                        // Insert new
                        $sqlIns = "INSERT INTO section_schedules(section_id, day_of_week, start_time, end_time) VALUES(:section_id, :day, :start, :end)";
                        $stmtIns = $conn->prepare($sqlIns);
                        $stmtIns->bindParam(":section_id", $data['section_id']);
                        $stmtIns->bindParam(":day", $s['day']);
                        $stmtIns->bindParam(":start", $s['start']);
                        $stmtIns->bindParam(":end", $s['end']);
                        $stmtIns->execute();
                    }
                }
            }

            // Delete removed schedules
            $toDelete = array_diff($existingSchedules, $incomingSchedules);
            if (!empty($toDelete)) {
                $placeholders = str_repeat('?,', count($toDelete) - 1) . '?';
                $sqlDel = "DELETE FROM section_schedules WHERE schedule_id IN ($placeholders)";
                $stmtDel = $conn->prepare($sqlDel);
                $stmtDel->execute($toDelete);
            }

            $conn->commit();
            echo json_encode(1);
        } catch (Exception $e) {
            $conn->rollBack();
            echo json_encode("Error: " . $e->getMessage());
        }
    }
    
    function deleteSection($json){
        include "connection-pdo.php";
        $data = json_decode($json, true);
        $branchId = getSectionBranchAdminBranchId();
        if (!sectionBelongsToBranch($conn, $data['section_id'] ?? null, $branchId)) {
            denySectionAccess();
            return;
        }
        $sql = "DELETE FROM sections WHERE section_id = :id";
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":id", $data['section_id']);
        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    function getEnrolledStudents(){
        include "connection-pdo.php";
        $section_id = $_GET['section_id'];
        $branchId = getSectionBranchAdminBranchId();
        $sql = "SELECT ed.enrollment_details_id, s.student_id, s.student_id_number,
                       s.first_name, s.last_name, s.ext, p.name as program_name,
                       sy.school_year,
                       CASE
                           WHEN JSON_VALID(sy.quarters_json) AND JSON_LENGTH(sy.quarters_json) > 0
                               THEN JSON_LENGTH(sy.quarters_json)
                           ELSE GREATEST(3,
                               (sy.quarter_1_start IS NOT NULL OR sy.quarter_1_end IS NOT NULL) +
                               (sy.quarter_2_start IS NOT NULL OR sy.quarter_2_end IS NOT NULL) +
                               (sy.quarter_3_start IS NOT NULL OR sy.quarter_3_end IS NOT NULL) +
                               (sy.quarter_4_start IS NOT NULL OR sy.quarter_4_end IS NOT NULL))
                       END AS quarter_count,
                       ed.status, eh.date_created as enrollment_date
                FROM enrollment_details ed
                JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                JOIN student s ON eh.student_id = s.student_id
                JOIN sections sec ON ed.section_id = sec.section_id
                JOIN class c ON sec.class_id = c.class_id
                LEFT JOIN program p ON ed.program_id = p.program_id
                LEFT JOIN school_years sy ON eh.school_year_id = sy.school_year_id
                WHERE ed.section_id = :section_id"
                . ($branchId ? " AND c.branch_id = :branch_id" : "") .
                "
                ORDER BY s.last_name, s.first_name ASC";
        $stmt = $conn->prepare($sql);
        $params = [':section_id' => $section_id];
        if ($branchId) {
            $params[':branch_id'] = $branchId;
        }
        $stmt->execute($params);
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
    }
}

// Router
if ($_SERVER['REQUEST_METHOD'] == 'GET'){
    $operation = $_GET['operation'];
    $class_id = isset($_GET['class_id']) ? $_GET['class_id'] : null;
    $json = isset($_GET['json']) ? $_GET['json'] : "";
} else if($_SERVER['REQUEST_METHOD'] == 'POST'){
    $operation = $_POST['operation'];
    $json = isset($_POST['json']) ? $_POST['json'] : "";
}

$sec = new Section();
switch($operation){
    case "getAllSections": $sec->getAllSections(); break;
    case "getSectionsByClass": $sec->getSectionsByClass($class_id); break; // Router update
    case "getSectionSchedules": $sec->getSectionSchedules(); break;
    case "getSectionById": $sec->getSectionById(); break;
    case "getEnrolledStudents": $sec->getEnrolledStudents(); break;
    case "insertSection": $sec->insertSection($json); break;
    case "updateSection": $sec->updateSection($json); break;
    case "deleteSection": $sec->deleteSection($json); break;
}
?>
