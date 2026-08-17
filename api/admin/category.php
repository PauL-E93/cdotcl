<?php
// api/admin/category.php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

class Category {
    function getAllCategories(){
        include "connection-pdo.php";
        $sql = "SELECT * FROM category ORDER BY category_name ASC";
        $stmt = $conn->prepare($sql);
        $stmt->execute();
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    function insertCategory($json){
        include "connection-pdo.php";
        $json = json_decode($json, true);
        $sql = "INSERT INTO category(category_name) VALUES(:name)";
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":name", $json['category_name']);
        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    function updateCategory($json){
        include "connection-pdo.php";
        $json = json_decode($json, true);
        $sql = "UPDATE category SET category_name = :name WHERE category_id = :id";
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":name", $json['category_name']);
        $stmt->bindParam(":id", $json['category_id']);
        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }
    
    function deleteCategory($json){
        include "connection-pdo.php";
        $json = json_decode($json, true);
        $sql = "DELETE FROM category WHERE category_id = :id";
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":id", $json['category_id']);
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

$cat = new Category();
switch($operation){
    case "getAllCategories": $cat->getAllCategories(); break;
    case "insertCategory": $cat->insertCategory($json); break;
    case "updateCategory": $cat->updateCategory($json); break;
    case "deleteCategory": $cat->deleteCategory($json); break;
}
?>