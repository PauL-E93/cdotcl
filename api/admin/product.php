<?php
// api/admin/product.php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

class Product {
    
    // VIEW (Get All)
    function getAllProducts(){
        include "connection-pdo.php";

        $sql = "SELECT p.*, c.category_name 
                FROM product p
                LEFT JOIN category c ON p.category_id = c.category_id
                ORDER BY p.quantity ASC";
        
        $stmt = $conn->prepare($sql);
        $stmt->execute();
        $rs = $stmt->fetchAll(PDO::FETCH_ASSOC);

        echo json_encode($rs);
    }

    // ADD
    function insertProduct($json){
        include "connection-pdo.php";
        $json = json_decode($json, true);

        $sql = "INSERT INTO product(category_id, name, price, quantity, status)
                VALUES(:categoryId, :name, :price, :quantity, :status)";
        
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":categoryId", $json['category_id']);
        $stmt->bindParam(":name", $json['name']);
        $stmt->bindParam(":price", $json['price']);
        $stmt->bindParam(":quantity", $json['quantity']);
        $stmt->bindParam(":status", $json['status']); // e.g., 'active', 'low stacks'
        $stmt->execute();

        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    // GET SINGLE (For Editing)
    function getProduct($json){
        include "connection-pdo.php";
        $json = json_decode($json, true);

        $sql = "SELECT p.*, c.category_name
                FROM product p
                LEFT JOIN category c ON p.category_id = c.category_id
                WHERE p.product_id = :productId";

        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":productId", $json['product_id']);
        $stmt->execute();
        $rs = $stmt->fetchAll(PDO::FETCH_ASSOC);

        echo json_encode($rs);
    }

    // UPDATE
    function updateProduct($json){
        include "connection-pdo.php";
        $json = json_decode($json, true);

        $sql = "UPDATE product 
                SET category_id = :categoryId, 
                    name = :name, 
                    price = :price, 
                    quantity = :quantity,
                    status = :status
                WHERE product_id = :productId";
        
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":categoryId", $json['category_id']);
        $stmt->bindParam(":name", $json['name']);
        $stmt->bindParam(":price", $json['price']); 
        $stmt->bindParam(":quantity", $json['quantity']);
        $stmt->bindParam(":status", $json['status']);
        $stmt->bindParam(":productId", $json['product_id']);
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

$product = new Product();
switch($operation){
    case "getAllProducts": $product->getAllProducts(); break;
    case "insertProduct": $product->insertProduct($json); break;
    case "getProduct": $product->getProduct($json); break;
    case "updateProduct": $product->updateProduct($json); break;

}
?>