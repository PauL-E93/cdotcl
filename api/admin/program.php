<?php
// api/program.php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET");
header("Access-Control-Allow-Headers: Content-Type");

require_once __DIR__ . '/../billing_penalty_helper.php';

class Program {
    private function getPenaltyData($data) {
        $penaltyAmount = $data['penalty_amount'] ?? ($data['penalty'] ?? 0);
        $gracePeriodDays = $data['grace_period_days'] ?? ($data['penalty_after_days'] ?? 2);

        if ($penaltyAmount === '' || $penaltyAmount === null) {
            $penaltyAmount = 0;
        }
        if (!is_numeric($penaltyAmount) || floatval($penaltyAmount) < 0) {
            throw new InvalidArgumentException("Penalty amount must be a non-negative number.");
        }
        if (filter_var($gracePeriodDays, FILTER_VALIDATE_INT) === false || intval($gracePeriodDays) < 0) {
            throw new InvalidArgumentException("Penalty grace period must be a non-negative whole number of days.");
        }

        return [number_format(floatval($penaltyAmount), 2, '.', ''), intval($gracePeriodDays)];
    }

    private function savePenaltyRule(PDO $conn, $programId, $penaltyAmount, $gracePeriodDays) {
        $stmt = $conn->prepare("INSERT INTO program_penalty (program_id, penalty_amount, grace_period_days)
                                VALUES (:program_id, :penalty_amount, :grace_period_days)
                                ON DUPLICATE KEY UPDATE
                                    penalty_amount = VALUES(penalty_amount),
                                    grace_period_days = VALUES(grace_period_days)");
        $stmt->execute([
            ':program_id' => $programId,
            ':penalty_amount' => $penaltyAmount,
            ':grace_period_days' => $gracePeriodDays
        ]);
    }

    // Fetch categories for the dropdown menu
    function getProgramTypes() {
        include "connection-pdo.php";
        try {
            $sql = "SELECT * FROM program_type ORDER BY type ASC";
            $stmt = $conn->prepare($sql);
            $stmt->execute();
            echo json_encode(["status" => "success", "data" => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        } catch (PDOException $e) { echo json_encode(["status" => "error", "message" => $e->getMessage()]); }
    }

    function addProgram($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true);
        try {
            [$penaltyAmount, $gracePeriodDays] = $this->getPenaltyData($data);
            $conn->beginTransaction();
            $sql = "INSERT INTO program (name, discription, tuition, total_units, unit_type, program_type, status, downpayment, registration_fee, default_discount_id, service_id) 
                    VALUES (:name, :discription, :tuition, :total_units, :unit_type, :program_type, :status, :downpayment, :registration_fee, :default_discount_id, :service_id)";
            $stmt = $conn->prepare($sql);
            $stmt->execute([
                ":name"                => $data['name'],
                ":discription"         => $data['discription'] ?? '',
                ":tuition"             => $data['tuition'] ?? 0.00,
                ":total_units"         => $data['total_units'] ?? 1,
                ":unit_type"           => $data['unit_type'] ?? 'session',
                ":program_type"        => $data['program_type'],
                ":status"              => $data['status'] ?? 'active',
                ":downpayment"         => $data['downpayment'] ?? null,
                ":registration_fee"    => $data['registration_fee'] ?? 0.00,
                ":default_discount_id" => $data['default_discount_id'] ?: null,
                ":service_id"          => $data['service_id'] ?: null
            ]);
            $this->savePenaltyRule($conn, $conn->lastInsertId(), $penaltyAmount, $gracePeriodDays);
            $conn->commit();
            echo json_encode(["status" => "success", "message" => "Program added successfully."]);
        } catch (Throwable $e) {
            if ($conn->inTransaction()) $conn->rollBack();
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    function updateProgram($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true);
        try {
            [$penaltyAmount, $gracePeriodDays] = $this->getPenaltyData($data);
            $conn->beginTransaction();
            $sql = "UPDATE program SET name = :name, discription = :discription, tuition = :tuition, 
                    total_units = :total_units, unit_type = :unit_type, program_type = :program_type, 
                    status = :status, downpayment = :downpayment, registration_fee = :registration_fee, default_discount_id = :default_discount_id, service_id = :service_id WHERE program_id = :program_id";
            $stmt = $conn->prepare($sql);
            $stmt->execute([
                ":name"                => $data['name'],
                ":discription"         => $data['discription'],
                ":tuition"             => $data['tuition'],
                ":total_units"         => $data['total_units'],
                ":unit_type"           => $data['unit_type'],
                ":program_type"        => $data['program_type'],
                ":status"              => $data['status'],
                ":downpayment"         => $data['downpayment'] ?? null,
                ":registration_fee"    => $data['registration_fee'] ?? 0.00,
                ":default_discount_id" => $data['default_discount_id'] ?: null,
                ":service_id"          => $data['service_id'] ?: null,
                ":program_id"          => $data['program_id']
            ]);
            $this->savePenaltyRule($conn, $data['program_id'], $penaltyAmount, $gracePeriodDays);
            refreshBillingSchedulePenalties($conn, null, null, $data['program_id']);
            $conn->commit();
            echo json_encode(["status" => "success", "message" => "Updated successfully."]);
        } catch (Throwable $e) {
            if ($conn->inTransaction()) $conn->rollBack();
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    function getPrograms() {
        include "connection-pdo.php";
        try {
            $sql = "SELECT p.*, COALESCE(pp.penalty_amount, 0) AS penalty_amount,
                           COALESCE(pp.penalty_amount, 0) AS penalty,
                           COALESCE(pp.grace_period_days, 2) AS grace_period_days,
                           pt.type as type_name, dd.discount_name as default_discount_name, s.service_name as default_service_name FROM program p 
                    LEFT JOIN program_penalty pp ON p.program_id = pp.program_id
                    LEFT JOIN program_type pt ON p.program_type = pt.program_type_id 
                    LEFT JOIN discount dd ON p.default_discount_id = dd.discount_id 
                    LEFT JOIN service s ON p.service_id = s.service_id 
                    ORDER BY p.program_id DESC";
            $stmt = $conn->prepare($sql);
            $stmt->execute();
            echo json_encode(["status" => "success", "data" => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        } catch (PDOException $e) { echo json_encode(["status" => "error", "message" => $e->getMessage()]); }
    }

    function getProgram($program_id = null) {
        include "connection-pdo.php";
        try {
            if ($program_id) {
                $stmt = $conn->prepare("SELECT p.*, COALESCE(pp.penalty_amount, 0) AS penalty_amount,
                                               COALESCE(pp.penalty_amount, 0) AS penalty,
                                               COALESCE(pp.grace_period_days, 2) AS grace_period_days
                                        FROM program p
                                        LEFT JOIN program_penalty pp ON p.program_id = pp.program_id
                                        WHERE p.program_id = :id");
                $stmt->execute([':id' => $program_id]);
                $result = $stmt->fetch(PDO::FETCH_ASSOC);
                echo json_encode(["status" => "success", "data" => $result ?: null]);
            } else {
                echo json_encode(["status" => "error", "message" => "No program_id provided"]);
            }
        } catch (PDOException $e) { echo json_encode(["status" => "error", "message" => $e->getMessage()]); }
    }
} 

$content = json_decode(file_get_contents('php://input'), true);
$operation = $_SERVER['REQUEST_METHOD'] == 'GET' ? ($_GET['operation'] ?? null) : ($content['operation'] ?? null);
$json = $_SERVER['REQUEST_METHOD'] == 'GET' ? ($_GET['json'] ?? "") : ($content['json'] ?? "");

$program = new Program();
switch($operation){
    case "getProgramTypes": $program->getProgramTypes(); break;
    case "addProgram": $program->addProgram($json); break;
    case "updateProgram": $program->updateProgram($json); break;
    case "getPrograms": $program->getPrograms(); break;
    case "getProgram":  
        if ($_SERVER['REQUEST_METHOD'] == 'GET' && isset($_GET['program_id'])) {
            $program->getProgram($_GET['program_id']);
        } else {
            $data = json_decode($json, true);
            $program->getProgram($data['program_id'] ?? null);
        }
        break;
    default: echo json_encode(["status" => "error", "message" => "Invalid Operation"]); break;
}
?>

