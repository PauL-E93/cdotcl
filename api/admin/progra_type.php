<?php
// api/admin/program_type.php

header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET");
header("Access-Control-Allow-Headers: Content-Type");

class ProgramType {

    // 1. ADD NEW TYPE
    function addType($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true);

        if (empty($data['type'])) {
            echo json_encode(["status" => "error", "message" => "Type name is required."]);
            return;
        }

        try {
            $sql = "INSERT INTO program_type (type) VALUES (:type)";
            $stmt = $conn->prepare($sql);
            $stmt->execute([":type" => $data['type']]);
            echo json_encode(["status" => "success", "message" => "Program Type added successfully."]);
        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => "Database error: " . $e->getMessage()]);
        }
    }

    // 2. UPDATE TYPE
    function updateType($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true);

        if (empty($data['program_type_id'])) {
            echo json_encode(["status" => "error", "message" => "ID is required."]);
            return;
        }

        try {
            $sql = "UPDATE program_type SET type = :type WHERE program_type_id = :id";
            $stmt = $conn->prepare($sql);
            $stmt->execute([
                ":type" => $data['type'],
                ":id"   => $data['program_type_id']
            ]);
            echo json_encode(["status" => "success", "message" => "Program Type updated successfully."]);
        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => "Database error: " . $e->getMessage()]);
        }
    }

    // 3. GET ALL TYPES
    function getTypes() {
        include "connection-pdo.php";
        try {
            $sql = "SELECT * FROM program_type ORDER BY type ASC";
            $stmt = $conn->prepare($sql);
            $stmt->execute();
            $result = $stmt->fetchAll(PDO::FETCH_ASSOC);
            echo json_encode(["status" => "success", "data" => $result]);
        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    // 4. DELETE TYPE
    function deleteType($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true);
        try {
            $stmt = $conn->prepare("DELETE FROM program_type WHERE program_type_id = :id");
            $stmt->execute([':id' => $data['program_type_id']]);
            echo json_encode(["status" => "success", "message" => "Program Type deleted successfully."]);
        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => "Database error: " . $e->getMessage()]);
        }
    }
}

// ROUTER LOGIC
$content = file_get_contents('php://input');
$postData = json_decode($content, true);

$operation = $_SERVER['REQUEST_METHOD'] == 'GET' 
    ? ($_GET['operation'] ?? null) 
    : ($postData['operation'] ?? null);

$json = $_SERVER['REQUEST_METHOD'] == 'GET' 
    ? ($_GET['json'] ?? "") 
    : (isset($postData['json']) ? $postData['json'] : "");

$programType = new ProgramType();

switch($operation) {
    case "addType":    $programType->addType($json); break;
    case "updateType": $programType->updateType($json); break;
    case "getTypes":   $programType->getTypes(); break;
    case "deleteType": $programType->deleteType($json); break;
    default:           echo json_encode(["status" => "error", "message" => "Invalid Operation"]); break;
}
?>