<?php
// api/admin/branch.php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

function getBranchLookupBranchId() {
    $role = strtolower(trim((string) ($_SESSION['user_role'] ?? '')));
    $role = preg_replace('/[\s_-]+/', ' ', $role);

    if ($role !== 'branch admin') {
        return null;
    }

    $branchId = intval($_SESSION['branch_id'] ?? 0);
    return $branchId > 0 ? $branchId : -1;
}   

class Branch {
    // READ: Fetch all branches
    function getBranches(){
        include "connection-pdo.php";
        $branchId = getBranchLookupBranchId();
        // Selecting all columns based on the database image provided, joining with employee to get name
        $sql = "SELECT b.branch_id, b.branch_name, b.branch_location, b.phone_number, b.operating_days,
                       b.opening_time, b.closing_time, b.employee_id, b.status,
                       CONCAT(e.first_name, ' ', e.last_name) AS employee_name
                FROM branch b
                LEFT JOIN employee e ON b.employee_id = e.employee_id"
                . ($branchId ? " WHERE b.branch_id = :branch_id" : "") .
                " ORDER BY b.branch_id ASC";
        $stmt = $conn->prepare($sql);
        $stmt->execute($branchId ? [':branch_id' => $branchId] : []);
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    // READ: Fetch only active centers.
    function getActiveBranches(){
        include "connection-pdo.php";
        $branchId = getBranchLookupBranchId();
        $sql = "SELECT b.branch_id, b.branch_name, b.branch_location, b.phone_number, b.operating_days,
                       b.opening_time, b.closing_time, b.employee_id, b.status,
                       CONCAT(e.first_name, ' ', e.last_name) AS employee_name
                FROM branch b
                LEFT JOIN employee e ON b.employee_id = e.employee_id
                WHERE LOWER(COALESCE(b.status, '')) = 'active'"
                . ($branchId ? " AND b.branch_id = :branch_id" : "") .
                " ORDER BY b.branch_id ASC";
        $stmt = $conn->prepare($sql);
        $stmt->execute($branchId ? [':branch_id' => $branchId] : []);
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    // Public landing-page lookup. Returns only display-safe fields and is not
    // narrowed by an authenticated branch administrator's assigned center.
    function getPublicActiveBranches(){
        include "connection-pdo.php";
        $sql = "SELECT branch_id, branch_name, branch_location, phone_number,
                       operating_days, opening_time, closing_time
                FROM branch
                WHERE LOWER(COALESCE(status, '')) = 'active'
                ORDER BY branch_id ASC";
        $stmt = $conn->prepare($sql);
        $stmt->execute();
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    // CREATE: Insert new branch
    function insertBranch($json){
        include "connection-pdo.php";
        $data = json_decode($json, true);
        $sql = "INSERT INTO branch(
                    branch_name, branch_location, phone_number, operating_days,
                    opening_time, closing_time, employee_id, status
                ) VALUES(
                    :name, :location, :phone_number, :operating_days,
                    :opening_time, :closing_time, :emp_id, :status
                )";
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":name", $data['branch_name']);
        $stmt->bindParam(":location", $data['branch_location']);
        $stmt->bindValue(":phone_number", ($data['phone_number'] ?? '') ?: null);
        $stmt->bindValue(":operating_days", ($data['operating_days'] ?? '') ?: null);
        $stmt->bindValue(":opening_time", ($data['opening_time'] ?? '') ?: null);
        $stmt->bindValue(":closing_time", ($data['closing_time'] ?? '') ?: null);
        $stmt->bindParam(":emp_id", $data['employee_id']);
        $stmt->bindParam(":status", $data['status']);
        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    // UPDATE: Modify existing branch
    function updateBranch($json){
        include "connection-pdo.php";
        $data = json_decode($json, true);
        $sql = "UPDATE branch SET
                    branch_name = :name,
                    branch_location = :location,
                    phone_number = :phone_number,
                    operating_days = :operating_days,
                    opening_time = :opening_time,
                    closing_time = :closing_time,
                    employee_id = :emp_id,
                    status = :status
                WHERE branch_id = :id";
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":name", $data['branch_name']);
        $stmt->bindParam(":location", $data['branch_location']);
        $stmt->bindValue(":phone_number", ($data['phone_number'] ?? '') ?: null);
        $stmt->bindValue(":operating_days", ($data['operating_days'] ?? '') ?: null);
        $stmt->bindValue(":opening_time", ($data['opening_time'] ?? '') ?: null);
        $stmt->bindValue(":closing_time", ($data['closing_time'] ?? '') ?: null);
        $stmt->bindParam(":emp_id", $data['employee_id']);
        $stmt->bindParam(":status", $data['status']);
        $stmt->bindParam(":id", $data['branch_id']);
        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    // DELETE: Remove branch
    function deleteBranch($json){
        include "connection-pdo.php";
        $data = json_decode($json, true);
        $sql = "DELETE FROM branch WHERE branch_id = :id";
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":id", $data['branch_id']);
        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }
}

// Router
$operation = "";
if ($_SERVER['REQUEST_METHOD'] == 'GET'){
    $operation = $_GET['operation'] ?? "";
    $json = $_GET['json'] ?? "";
} else if($_SERVER['REQUEST_METHOD'] == 'POST'){
    $operation = $_POST['operation'] ?? "";
    $json = $_POST['json'] ?? "";
}

$br = new Branch();
switch($operation){
    case "getBranches": $br->getBranches(); break;
    case "getActiveBranches": $br->getActiveBranches(); break;
    case "getPublicActiveBranches": $br->getPublicActiveBranches(); break;
    case "insertBranch": $br->insertBranch($json); break;
    case "updateBranch": $br->updateBranch($json); break;
    case "deleteBranch": $br->deleteBranch($json); break;
    default: echo json_encode(["error" => "Invalid Operation"]); break;
}
?>
