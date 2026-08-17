<?php
// api/admin/services.php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET");
header("Access-Control-Allow-Headers: Content-Type");

class Service {
    private function tableExists($conn, $table) {
        $stmt = $conn->prepare("SHOW TABLES LIKE ?");
        $stmt->execute([$table]);
        return (bool)$stmt->fetch(PDO::FETCH_NUM);
    }

    private function requireBranchServicesTable($conn) {
        if (!$this->tableExists($conn, 'branch_services')) {
            throw new Exception("Please run migrations/2026_05_30_branch_services.sql before saving service branches.");
        }
    }

    private function getBranchesForService($conn, $service_id) {
        if (!$this->tableExists($conn, 'branch_services')) {
            return [];
        }

        $stmt = $conn->prepare("
            SELECT b.branch_id, TRIM(b.branch_name) AS branch_name
            FROM branch_services bs
            INNER JOIN branch b ON bs.branch_id = b.branch_id
            WHERE bs.service_id = ?
            ORDER BY b.branch_name
        ");
        $stmt->execute([$service_id]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    private function attachBranches($conn, $service) {
        $branches = $this->getBranchesForService($conn, $service['service_id']);
        $service['branches'] = $branches;
        $service['branch_ids'] = array_map(function($branch) {
            return intval($branch['branch_id']);
        }, $branches);
        $service['branch_names'] = implode(', ', array_map(function($branch) {
            return $branch['branch_name'];
        }, $branches));
        return $service;
    }

    private function normalizeBranchIds($conn, $branch_ids) {
        if (!is_array($branch_ids)) {
            return [];
        }

        $normalized = [];
        foreach ($branch_ids as $branch_id) {
            $branch_id = intval($branch_id);
            if ($branch_id > 0 && !in_array($branch_id, $normalized, true)) {
                $normalized[] = $branch_id;
            }
        }

        if (empty($normalized)) {
            return [];
        }

        $placeholders = implode(', ', array_fill(0, count($normalized), '?'));
        $stmt = $conn->prepare("SELECT branch_id FROM branch WHERE branch_id IN ($placeholders)");
        $stmt->execute($normalized);
        $validBranchIds = array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));

        if (count($validBranchIds) !== count($normalized)) {
            throw new Exception("One or more selected branches do not exist.");
        }

        return $validBranchIds;
    }

    private function saveServiceBranches($conn, $service_id, $branch_ids) {
        $this->requireBranchServicesTable($conn);
        $branch_ids = $this->normalizeBranchIds($conn, $branch_ids);

        $stmt = $conn->prepare("DELETE FROM branch_services WHERE service_id = ?");
        $stmt->execute([$service_id]);

        if (empty($branch_ids)) {
            return;
        }

        $stmt = $conn->prepare("INSERT INTO branch_services (branch_id, service_id) VALUES (?, ?)");
        foreach ($branch_ids as $branch_id) {
            $stmt->execute([$branch_id, $service_id]);
        }
    }

    function getServices() {
        include "connection-pdo.php";
        try {
            $sql = "SELECT * FROM service ORDER BY service_id DESC";
            $stmt = $conn->prepare($sql);
            $stmt->execute();
            $services = $stmt->fetchAll(PDO::FETCH_ASSOC);
            foreach ($services as &$service) {
                $service = $this->attachBranches($conn, $service);
            }
            unset($service);
            echo json_encode(["status" => "success", "data" => $services]);
        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    function getBranches() {
        include "connection-pdo.php";
        try {
            $stmt = $conn->query("SELECT branch_id, TRIM(branch_name) AS branch_name FROM branch ORDER BY branch_name");
            echo json_encode(["status" => "success", "data" => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    function getService($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true);
        $service_id = $data['service_id'] ?? ($_GET['service_id'] ?? null);
        if (empty($service_id)) {
            echo json_encode(["status" => "error", "message" => "service_id is required."]);
            return;
        }

        try {
            $stmt = $conn->prepare("SELECT * FROM service WHERE service_id = :id");
            $stmt->execute([':id' => $service_id]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($row) {
                echo json_encode(["status" => "success", "data" => $this->attachBranches($conn, $row)]);
            } else {
                echo json_encode(["status" => "error", "message" => "Service not found."]);
            }
        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    function insertService($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true);
        $name = trim($data['service_name'] ?? '');
        $amount = $data['amount'] ?? '';
        $status = trim($data['status'] ?? 'active');
        $branch_ids = $data['branch_ids'] ?? [];

        if ($name === '' || $amount === '') {
            echo json_encode(["status" => "error", "message" => "Service name and amount are required."]);
            return;
        }

        if (!is_numeric($amount)) {
            echo json_encode(["status" => "error", "message" => "Amount must be a number."]);
            return;
        }

        if (!in_array($status, ['active', 'inactive'])) {
            $status = 'active';
        }

        try {
            $conn->beginTransaction();
            $sql = "INSERT INTO service (service_name, amount, status) VALUES (:name, :amount, :status)";
            $stmt = $conn->prepare($sql);
            $stmt->execute([':name' => $name, ':amount' => $amount, ':status' => $status]);
            $this->saveServiceBranches($conn, $conn->lastInsertId(), $branch_ids);
            $conn->commit();
            echo json_encode(["status" => "success", "message" => "Service saved successfully."]);
        } catch (Exception $e) {
            if ($conn->inTransaction()) {
                $conn->rollBack();
            }
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    function updateService($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true);
        $service_id = $data['service_id'] ?? null;
        $name = trim($data['service_name'] ?? '');
        $amount = $data['amount'] ?? '';
        $status = trim($data['status'] ?? 'active');
        $branch_ids = $data['branch_ids'] ?? [];

        if (empty($service_id) || $name === '' || $amount === '') {
            echo json_encode(["status" => "error", "message" => "Service ID, name, and amount are required."]);
            return;
        }

        if (!is_numeric($amount)) {
            echo json_encode(["status" => "error", "message" => "Amount must be a number."]);
            return;
        }

        if (!in_array($status, ['active', 'inactive'])) {
            $status = 'active';
        }

        try {
            $conn->beginTransaction();
            $sql = "UPDATE service SET service_name = :name, amount = :amount, status = :status WHERE service_id = :id";
            $stmt = $conn->prepare($sql);
            $stmt->execute([':name' => $name, ':amount' => $amount, ':status' => $status, ':id' => $service_id]);
            $this->saveServiceBranches($conn, $service_id, $branch_ids);
            $conn->commit();
            echo json_encode(["status" => "success", "message" => "Service updated successfully."]);
        } catch (Exception $e) {
            if ($conn->inTransaction()) {
                $conn->rollBack();
            }
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    function deleteService($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true);
        $service_id = $data['service_id'] ?? null;
        if (empty($service_id)) {
            echo json_encode(["status" => "error", "message" => "service_id is required."]);
            return;
        }

        try {
            $conn->beginTransaction();
            if ($this->tableExists($conn, 'branch_services')) {
                $stmt = $conn->prepare("DELETE FROM branch_services WHERE service_id = :id");
                $stmt->execute([':id' => $service_id]);
            }
            $stmt = $conn->prepare("DELETE FROM service WHERE service_id = :id");
            $stmt->execute([':id' => $service_id]);
            $conn->commit();
            echo json_encode(["status" => "success", "message" => "Service deleted successfully."]);
        } catch (Exception $e) {
            if ($conn->inTransaction()) {
                $conn->rollBack();
            }
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }
}

$operation = "";
$json = "";
$content = file_get_contents('php://input');
$postData = json_decode($content, true);

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $operation = $_GET['operation'] ?? "";
    $json = $_GET['json'] ?? "";
} else {
    $operation = $postData['operation'] ?? "";
    $json = $postData['json'] ?? "";
}

$api = new Service();
switch ($operation) {
    case 'getServices':
        $api->getServices();
        break;
    case 'getBranches':
        $api->getBranches();
        break;
    case 'getService':
        $api->getService($json);
        break;
    case 'insertService':
        $api->insertService($json);
        break;
    case 'updateService':
        $api->updateService($json);
        break;
    case 'deleteService':
        $api->deleteService($json);
        break;
    default:
        echo json_encode(["status" => "error", "message" => "Invalid Operation"]);
        break;
}
