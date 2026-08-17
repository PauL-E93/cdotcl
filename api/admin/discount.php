<?php
// api/discount.php

header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET");
header("Access-Control-Allow-Headers: Content-Type");

class Discount {

    // ==========================================
    // 1. INSERT FUNCTION (addDiscount)
    // ==========================================
    function addDiscount($json) {
        include "connection-pdo.php";

        $data = json_decode($json, true);

        // Basic Validation (Matches JS payload keys 'name' and 'percentage')
        if (empty($data['name']) || !isset($data['discount_value']) || $data['discount_value'] === '') {
            echo json_encode(["status" => "error", "message" => "Name and Value are required."]);
            return;
        }

        $name = trim($data['name']);
        $value = $data['discount_value'];
        $type = $data['discount_type'] ?? 'percentage';
        $status = $data['status'] ?? 'active';

        if (!in_array($type, ['fixed', 'percentage', 'full_waiver'])) {
            $type = 'percentage';
        }

        if (!in_array($status, ['active', 'inactive', ''])) {
            $status = 'active';
        }

        try {
            $sql = "INSERT INTO discount (discount_name, discount_value, discount_type, status) VALUES (:name, :value, :type, :status)";

            $stmt = $conn->prepare($sql);
            $stmt->bindParam(":name", $name);
            $stmt->bindParam(":value", $value);
            $stmt->bindParam(":type", $type);
            $stmt->bindParam(":status", $status);

            $stmt->execute();

            echo json_encode(["status" => "success", "message" => "Discount added successfully."]);

        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => "Database error: " . $e->getMessage()]);
        }
    }

    // ==========================================
    // 2. UPDATE FUNCTION (updateDiscount)
    // ==========================================
    function updateDiscount($json) {
        include "connection-pdo.php";

        $data = json_decode($json, true);

        if (empty($data['discount_id'])) {
            echo json_encode(["status" => "error", "message" => "ID required."]);
            return;
        }

        if (empty($data['name']) || !isset($data['discount_value']) || $data['discount_value'] === '') {
            echo json_encode(["status" => "error", "message" => "Name and Value are required."]);
            return;
        }

        $id = $data['discount_id'];
        $name = trim($data['name']);
        $value = $data['discount_value'];
        $type = $data['discount_type'] ?? 'percentage';
        $status = $data['status'] ?? 'active';

        if (!in_array($type, ['fixed', 'percentage', 'full_waiver'])) {
            $type = 'percentage';
        }

        if (!in_array($status, ['active', 'inactive', ''])) {
            $status = 'active';
        }

        try {
            $sql = "UPDATE discount SET discount_name = :name, discount_value = :value, discount_type = :type, status = :status WHERE discount_id = :id";

            $stmt = $conn->prepare($sql);
            $stmt->bindParam(":name", $name);
            $stmt->bindParam(":value", $value);
            $stmt->bindParam(":type", $type);
            $stmt->bindParam(":status", $status);
            $stmt->bindParam(":id", $id);

            $stmt->execute();

            echo json_encode(["status" => "success", "message" => "Discount updated."]);

        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => "Database error: " . $e->getMessage()]);
        }
    }

    // ==========================================
    // 3. DISPLAY FUNCTION (getDiscounts)
    // ==========================================
    function getDiscounts() {
        include "connection-pdo.php";

        try {
            $sql = "SELECT * FROM discount ORDER BY discount_id DESC";
            $stmt = $conn->prepare($sql);
            $stmt->execute();
            $result = $stmt->fetchAll(PDO::FETCH_ASSOC);

            // Return data exactly as DB gives it (discount_name, price)
            echo json_encode(["status" => "success", "data" => $result]);

        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    // ==========================================
    // 4. GET SINGLE DISCOUNT
    // ==========================================
    function getDiscount($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true);

        try {
            $stmt = $conn->prepare("SELECT * FROM discount WHERE discount_id = :id");
            $stmt->execute([':id' => $data['discount_id']]);
            $result = $stmt->fetch(PDO::FETCH_ASSOC);

            if ($result) {
                echo json_encode(["status" => "success", "data" => $result]);
            } else {
                echo json_encode(["status" => "error", "message" => "Not found"]);
            }
        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }
    // ==========================================
    // 5. DELETE FUNCTION (deleteDiscount)
    // ==========================================
    function deleteDiscount($json) {
        include "connection-pdo.php";

        $data = json_decode($json, true);

        if (empty($data['discount_id'])) {
            echo json_encode(["status" => "error", "message" => "ID required."]);
            return;
        }

        try {
            $id = $data['discount_id'];

            $sql = "DELETE FROM discount WHERE discount_id = :id";

            $stmt = $conn->prepare($sql);
            $stmt->bindParam(":id", $id);

            $stmt->execute();

            echo json_encode(["status" => "success", "message" => "Discount deleted."]);

        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => "Database error: " . $e->getMessage()]);
        }
    }
}

// ROUTER
if ($_SERVER['REQUEST_METHOD'] == 'GET'){
    $operation = isset($_GET['operation']) ? $_GET['operation'] : null;
    $json = isset($_GET['json']) ? $_GET['json'] : "";
} else {
    $content = file_get_contents('php://input');
    $postData = json_decode($content, true);
    $operation = $postData['operation'] ?? null;
    $json = $postData['json'] ?? "";
}

$api = new Discount();
switch($operation){
    case "addDiscount": $api->addDiscount($json); break;
    case "updateDiscount": $api->updateDiscount($json); break;
    case "getDiscounts": $api->getDiscounts(); break;
    case "getDiscount": $api->getDiscount($json); break;
    case "deleteDiscount": $api->deleteDiscount($json); break;
    default: echo json_encode(["status" => "error", "message" => "Invalid Operation"]); break;
}
?>