<?php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

class ProgramProducts {
    
    // NEW: Fetch products for a SPECIFIC program (Used by Billing)
    function getProductsByProgram($program_id) {
        include "connection-pdo.php";
        
        // This query follows the trail: Program ID -> Program_Products Bridge -> Product Details
        $sql = "SELECT 
                    prd.product_id,
                    prd.name AS product_name,
                    prd.price,
                    prd.quantity,
                    prd.status
                FROM program_products pp
                INNER JOIN product prd ON pp.product_id = prd.product_id
                WHERE pp.program_id = :program_id";
        
        try {
            $stmt = $conn->prepare($sql);
            $stmt->bindParam(":program_id", $program_id, PDO::PARAM_INT);
            $stmt->execute();
            $results = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            // Return as a structured response for your Axios call
            echo json_encode([
                "status" => "success",
                "data" => $results
            ]);
        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    // READ: Fetch all assignments (General Management)
    function getProgramProducts(){
        include "connection-pdo.php";
        $sql = "SELECT pp.program_products AS id,
                       pp.program_id,
                       prg.name AS program_name,
                       pp.product_id,
                       prd.name AS product_name
                FROM program_products pp
                INNER JOIN program prg ON pp.program_id = prg.program_id
                INNER JOIN product prd ON pp.product_id = prd.product_id
                ORDER BY prg.name ASC";
        
        $stmt = $conn->prepare($sql);
        $stmt->execute();
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    // CREATE: Assign a product to a program
    function insertProgramProduct($json){
        include "connection-pdo.php";
        $data = json_decode($json, true);
        $sql = "INSERT INTO program_products(program_id, product_id) VALUES(:program_id, :product_id)";
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":program_id", $data['program_id']);
        $stmt->bindParam(":product_id", $data['product_id']);
        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    // UPDATE: Change an assignment
    function updateProgramProduct($json){
        include "connection-pdo.php";
        $data = json_decode($json, true);
        $sql = "UPDATE program_products SET program_id = :program_id, product_id = :product_id WHERE program_products = :id";
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":program_id", $data['program_id']);
        $stmt->bindParam(":product_id", $data['product_id']);
        $stmt->bindParam(":id", $data['program_products_id']); 
        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    // DELETE: Remove an assignment
    function deleteProgramProduct($json){
        include "connection-pdo.php";
        $data = json_decode($json, true);
        $sql = "DELETE FROM program_products WHERE program_products = :id";
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":id", $data['program_products_id']);
        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }
}

// Router
$operation = "";
$program_id = "";

if ($_SERVER['REQUEST_METHOD'] == 'GET'){
    $operation = $_GET['operation'] ?? "";
    $json = $_GET['json'] ?? "";
    $program_id = $_GET['program_id'] ?? ""; // Capture program_id for GET requests
} else if($_SERVER['REQUEST_METHOD'] == 'POST'){
    $operation = $_POST['operation'] ?? "";
    $json = $_POST['json'] ?? "";
}

$pp = new ProgramProducts();
switch($operation){
    case "getProductsByProgram": 
        $pp->getProductsByProgram($program_id); 
        break;
    case "getProgramProducts": 
        $pp->getProgramProducts(); 
        break;
    case "insertProgramProduct": 
        $pp->insertProgramProduct($json); 
        break;
    case "updateProgramProduct": 
        $pp->updateProgramProduct($json); 
        break;
    case "deleteProgramProduct": 
        $pp->deleteProgramProduct($json); 
        break;
    default: 
        echo json_encode(["error" => "Invalid Operation"]); 
        break;
}
?>