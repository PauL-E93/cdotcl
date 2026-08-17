<?php
// api/admin/program_teacher.php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

class ProgramTeacher {

    // Get all teachers and the programs they are assigned to
    function getAllAssignments(){
        include "connection-pdo.php";
        $sql = "SELECT pt.id, e.first_name, e.last_name, p.name as program_name, ptype.type as program_category
                FROM program_teacher pt
                JOIN employee e ON pt.employee_id = e.employee_id
                JOIN program p ON pt.program_id = p.program_id
                JOIN program_type ptype ON p.program_type = ptype.program_type_id
                ORDER BY e.last_name ASC";
        $stmt = $conn->prepare($sql);
        $stmt->execute();
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    // Assign a teacher to a program (This fixes your "both programs" issue)
    function assignTeacher($json){
        include "connection-pdo.php";
        $json = json_decode($json, true);
        
        // Check if the assignment already exists to prevent duplicates
        $checkSql = "SELECT * FROM program_teacher WHERE employee_id = :e_id AND program_id = :p_id";
        $checkStmt = $conn->prepare($checkSql);
        $checkStmt->execute([':e_id' => $json['employee_id'], ':p_id' => $json['program_id']]);
        
        if($checkStmt->rowCount() > 0) {
            echo json_encode(0); // Already exists
            return;
        }

        $sql = "INSERT INTO program_teacher(employee_id, program_id) VALUES(:e_id, :p_id)";
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":e_id", $json['employee_id']);
        $stmt->bindParam(":p_id", $json['program_id']);
        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    // Remove a teacher from a specific program
    function deleteAssignment($json){
        include "connection-pdo.php";
        $json = json_decode($json, true);
        $sql = "DELETE FROM program_teacher WHERE id = :id";
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":id", $json['id']);
        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }
}

// Router Logic
$operation = "";
$json = "";

if ($_SERVER['REQUEST_METHOD'] == 'GET'){
    $operation = isset($_GET['operation']) ? $_GET['operation'] : "";
    $json = isset($_GET['json']) ? $_GET['json'] : "";
} else if($_SERVER['REQUEST_METHOD'] == 'POST'){
    $operation = isset($_POST['operation']) ? $_POST['operation'] : "";
    $json = isset($_POST['json']) ? $_POST['json'] : "";
}

$pt = new ProgramTeacher();
switch($operation){
    case "getAllAssignments": $pt->getAllAssignments(); break;
    case "assignTeacher": $pt->assignTeacher($json); break;
    case "deleteAssignment": $pt->deleteAssignment($json); break;
}
?>