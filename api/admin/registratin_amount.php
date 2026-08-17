<?php
// api/admin/registratin_amount.php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET");
header("Access-Control-Allow-Headers: Content-Type");

class RegistrationAmount {
    function getRegistrationAmounts() {
        include "connection-pdo.php";
        $sql = "SELECT * FROM registration ORDER BY registration_id DESC";
        $stmt = $conn->prepare($sql);
        $stmt->execute();
        $result = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(["status" => "success", "data" => $result]);
    }

    function getRegistrationAmount($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true);
        $stmt = $conn->prepare("SELECT * FROM registration WHERE registration_id = :id");
        $stmt->execute([':id' => $data['registration_id'] ?? 0]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            echo json_encode(["status" => "success", "data" => $row]);
        } else {
            echo json_encode(["status" => "error", "message" => "Registration amount not found."]);
        }
    }

    function insertRegistrationAmount($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true);

        if (empty($data['registration_name']) || !isset($data['amount']) || $data['amount'] === '') {
            echo json_encode(["status" => "error", "message" => "Name and amount are required."]);
            return;
        }

        $name = trim($data['registration_name']);
        $amount = $data['amount'];
        $status = $data['status'] ?? 'active';
        if (!in_array($status, ['active', 'inactive', ''])) {
            $status = 'active';
        }

        $sql = "INSERT INTO registration (registration_name, amount, status) VALUES (:name, :amount, :status)";
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(':name', $name);
        $stmt->bindParam(':amount', $amount);
        $stmt->bindParam(':status', $status);
        $stmt->execute();

        echo json_encode(["status" => "success", "message" => "Registration amount saved successfully."]);
    }

    function updateRegistrationAmount($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true);

        if (empty($data['registration_id']) || empty($data['registration_name']) || !isset($data['amount']) || $data['amount'] === '') {
            echo json_encode(["status" => "error", "message" => "ID, name and amount are required."]);
            return;
        }

        $id = $data['registration_id'];
        $name = trim($data['registration_name']);
        $amount = $data['amount'];
        $status = $data['status'] ?? 'active';
        if (!in_array($status, ['active', 'inactive', ''])) {
            $status = 'active';
        }

        $sql = "UPDATE registration SET registration_name = :name, amount = :amount, status = :status WHERE registration_id = :id";
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(':name', $name);
        $stmt->bindParam(':amount', $amount);
        $stmt->bindParam(':status', $status);
        $stmt->bindParam(':id', $id);
        $stmt->execute();

        echo json_encode(["status" => "success", "message" => "Registration amount updated successfully."]);
    }

    function deleteRegistrationAmount($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true);
        if (empty($data['registration_id'])) {
            echo json_encode(["status" => "error", "message" => "ID required."]);
            return;
        }

        $sql = "DELETE FROM registration WHERE registration_id = :id";
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(':id', $data['registration_id']);
        $stmt->execute();

        echo json_encode(["status" => "success", "message" => "Registration amount deleted successfully."]);
    }
}

$operation = "";
$json = "";
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $operation = $_GET['operation'] ?? "";
    $json = $_GET['json'] ?? "";
} else {
    $content = file_get_contents('php://input');
    $postData = json_decode($content, true);
    $operation = $postData['operation'] ?? "";
    $json = $postData['json'] ?? "";
}

$api = new RegistrationAmount();
switch ($operation) {
    case 'getRegistrationAmounts': $api->getRegistrationAmounts(); break;
    case 'getRegistrationAmount': $api->getRegistrationAmount($json); break;
    case 'insertRegistrationAmount': $api->insertRegistrationAmount($json); break;
    case 'updateRegistrationAmount': $api->updateRegistrationAmount($json); break;
    case 'deleteRegistrationAmount': $api->deleteRegistrationAmount($json); break;
    default: echo json_encode(["status" => "error", "message" => "Invalid Operation"]); break;
}
?>