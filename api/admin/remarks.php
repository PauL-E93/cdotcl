<?php
// api/admin/remarks.php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

class RemarksManager {

    // Fetches all overarching quarterly remarks for a specific student
    function getRemarksByEnrollment(){
        include "connection-pdo.php";
        $enrollment_details_id = $_GET['enrollment_details_id'];
        
        $sql = "SELECT remarks_id, enrollment_details_id, employee_id, quarter, status, overall_grade, attendance, total_school_days, evaluation 
                FROM remarks 
                WHERE enrollment_details_id = :id 
                ORDER BY quarter ASC";
                
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":id", $enrollment_details_id);
        $stmt->execute();
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    function insertRemark($json){
        include "connection-pdo.php";
        $json = json_decode($json, true);
        
        $sql = "INSERT INTO remarks(enrollment_details_id, employee_id, quarter, status, overall_grade, attendance, total_school_days, evaluation) 
                VALUES(:enrollment_details_id, :employee_id, :quarter, :status, :overall_grade, :attendance, :total_school_days, :evaluation)";
                
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":enrollment_details_id", $json['enrollment_details_id']);
        $stmt->bindParam(":employee_id", $json['employee_id']);
        $stmt->bindParam(":quarter", $json['quarter']);
        $stmt->bindParam(":status", $json['status']);
        $stmt->bindParam(":overall_grade", $json['overall_grade']);
        $stmt->bindParam(":attendance", $json['attendance']);
        $stmt->bindParam(":total_school_days", $json['total_school_days']);
        $stmt->bindParam(":evaluation", $json['evaluation']);
        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    function updateRemark($json){
        include "connection-pdo.php";
        $json = json_decode($json, true);
        
        $sql = "UPDATE remarks 
                SET enrollment_details_id = :enrollment_details_id, employee_id = :employee_id, 
                    quarter = :quarter, status = :status, overall_grade = :overall_grade, 
                    attendance = :attendance, total_school_days = :total_school_days, evaluation = :evaluation 
                WHERE remarks_id = :id";
                
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":enrollment_details_id", $json['enrollment_details_id']);
        $stmt->bindParam(":employee_id", $json['employee_id']);
        $stmt->bindParam(":quarter", $json['quarter']);
        $stmt->bindParam(":status", $json['status']);
        $stmt->bindParam(":overall_grade", $json['overall_grade']);
        $stmt->bindParam(":attendance", $json['attendance']);
        $stmt->bindParam(":total_school_days", $json['total_school_days']);
        $stmt->bindParam(":evaluation", $json['evaluation']);
        $stmt->bindParam(":id", $json['remarks_id']);
        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    function deleteRemark($json){
        include "connection-pdo.php";
        $json = json_decode($json, true);
        
        $sql = "DELETE FROM remarks WHERE remarks_id = :id";
        
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":id", $json['remarks_id']);
        $stmt->execute();
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

$manager = new RemarksManager();
switch($operation){
    case "getRemarksByEnrollment": $manager->getRemarksByEnrollment(); break;
    case "insertRemark": $manager->insertRemark($json); break;
    case "updateRemark": $manager->updateRemark($json); break;
    case "deleteRemark": $manager->deleteRemark($json); break;
}
?>