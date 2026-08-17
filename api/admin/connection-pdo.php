<?php
$servername = "localhost";
$dbusername = "root";
// Change this from "" to your actual Ubuntu MariaDB root password
$dbpassword = ""; 
$dbname = "tutorial_db_V2";

    try {
        // Always negotiate UTF-8 with MySQL. Without an explicit client
        // charset, legacy/shared hosts can return bytes that make
        // json_encode() fail and leave API responses completelxy empty.
        $conn = new PDO(
            "mysql:host=$servername;dbname=$dbname;charset=utf8mb4",
            $dbusername,
            $dbpassword,
            [PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4"]
        );
        // set the PDO error mode to exception
        $conn->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        //echo "Connected successfully";
    } catch(PDOException $e) {
        error_log("DB Connection failed: " . $e->getMessage());
        if (!headers_sent()) {
            header('Content-Type: application/json');
        }
        http_response_code(500);
        echo json_encode(['error' => 'Database connection failed']);
        exit;
    }
?>
