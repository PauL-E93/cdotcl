<?php
// api/admin/class.php
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

function getBranchAdminBranchId() {
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

class ClassGroup {
    function getAllClasses(){
        include "connection-pdo.php";
        $branchId = getBranchAdminBranchId();
        $sql = "SELECT c.class_id, c.branch_id, c.program_id, c.status, p.name AS program_name, b.branch_name,
                       (SELECT COUNT(*) FROM sections sec WHERE sec.class_id = c.class_id) AS section_count,
                       (SELECT COUNT(DISTINCT eh.student_id)
                        FROM sections sec
                        JOIN enrollment_details ed ON ed.section_id = sec.section_id
                        JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                        WHERE sec.class_id = c.class_id) AS student_count
                FROM class c
                JOIN program p ON c.program_id = p.program_id
                JOIN branch b ON c.branch_id = b.branch_id"
                . ($branchId ? " WHERE c.branch_id = :branch_id" : "") .
                " ORDER BY c.class_id ASC";
        $stmt = $conn->prepare($sql);
        $stmt->execute($branchId ? [':branch_id' => $branchId] : []);
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    function getClassById(){
        include "connection-pdo.php";
        $class_id = $_GET['class_id'];
        $branchId = getBranchAdminBranchId();
        $sql = "SELECT c.class_id, c.branch_id, c.program_id, c.status, p.name AS program_name, b.branch_name
                FROM class c
                JOIN program p ON c.program_id = p.program_id
                JOIN branch b ON c.branch_id = b.branch_id
                WHERE c.class_id = :id"
                . ($branchId ? " AND c.branch_id = :branch_id" : "");
        $stmt = $conn->prepare($sql);
        $params = [':id' => $class_id];
        if ($branchId) {
            $params[':branch_id'] = $branchId;
        }
        $stmt->execute($params);
        echo json_encode($stmt->fetch(PDO::FETCH_ASSOC));
    }

    function insertClass($json){
        include "connection-pdo.php";
        $json = json_decode($json, true);
        $branchId = getBranchAdminBranchId() ?: ($json['branch_id'] ?? null);
        $sql = "INSERT INTO class(branch_id, program_id, status) VALUES(:branch_id, :program_id, :status)";
        $stmt = $conn->prepare($sql);
        $stmt->execute([
            ':branch_id' => $branchId,
            ':program_id' => $json['program_id'],
            ':status' => $json['status']
        ]);
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    function updateClass($json){
        include "connection-pdo.php";
        $json = json_decode($json, true);
        $managedBranchId = getBranchAdminBranchId();
        $branchId = $managedBranchId ?: ($json['branch_id'] ?? null);
        $sql = "UPDATE class
                SET branch_id = :branch_id, program_id = :program_id, status = :status
                WHERE class_id = :id"
                . ($managedBranchId ? " AND branch_id = :managed_branch_id" : "");
        $stmt = $conn->prepare($sql);
        $params = [
            ':branch_id' => $branchId,
            ':program_id' => $json['program_id'],
            ':status' => $json['status'],
            ':id' => $json['class_id']
        ];
        if ($managedBranchId) {
            $params[':managed_branch_id'] = $managedBranchId;
        }
        $stmt->execute($params);
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    function deleteClass($json){
        include "connection-pdo.php";
        $json = json_decode($json, true);
        $branchId = getBranchAdminBranchId();
        $sql = "DELETE FROM class WHERE class_id = :id"
                . ($branchId ? " AND branch_id = :branch_id" : "");
        $stmt = $conn->prepare($sql);
        $params = [':id' => $json['class_id']];
        if ($branchId) {
            $params[':branch_id'] = $branchId;
        }
        $stmt->execute($params);
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }
}

// Router
if ($_SERVER['REQUEST_METHOD'] == 'GET'){
    $operation = $_GET['operation'];
    $json = isset($_GET['json']) ? $_GET['json'] : "";
} else if($_SERVER['REQUEST_METHOD'] == 'POST'){
    $operation = $_POST['operation'];
    $json = isset($_POST['json']) ? $_POST['json'] : "";
}

$cls = new ClassGroup();
switch($operation){
    case "getAllClasses": $cls->getAllClasses(); break;
    case "getClassById": $cls->getClassById(); break;
    case "insertClass": $cls->insertClass($json); break;
    case "updateClass": $cls->updateClass($json); break;
    case "deleteClass": $cls->deleteClass($json); break;
}
?>
