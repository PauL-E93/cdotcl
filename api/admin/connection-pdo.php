<?php

require_once __DIR__ . '/../config/runtime.php';

$servername = cdoTutorConfig('DB_HOST', 'localhost');
$dbport = cdoTutorConfig('DB_PORT', '3306');
$dbusername = cdoTutorConfig('DB_USERNAME', 'root');
$dbpassword = cdoTutorConfig('DB_PASSWORD', '');
$dbname = cdoTutorConfig('DB_NAME', 'tutorial_db_V2');

    try {
        // Always negotiate UTF-8 with MySQL. Without an explicit client
        // charset, legacy/shared hosts can return bytes that make
        // json_encode() fail and leave API responses completelxy empty.
        $conn = new PDO(
            "mysql:host=$servername;port=$dbport;dbname=$dbname;charset=utf8mb4",
            $dbusername,
            $dbpassword,
            [PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4"]
        );
        // set the PDO error mode to exception
        $conn->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        // Keep database-generated timestamps in Philippine Standard Time on every host.
        $conn->exec("SET time_zone = '+08:00'");
        require_once __DIR__ . '/../session_substitute_helper.php';
        ensureSessionSubstituteSchema($conn);
        // Initialize before payment/program transactions to avoid implicit DDL commits.
        require_once __DIR__ . '/../penalty_adjustment_helper.php';
        ensurePenaltyAdjustmentSchema($conn);
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
