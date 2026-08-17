<?php
// api/admin/subject.php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

class Subject {
    private function getSubjectName($data) {
        return trim((string) ($data['subject_name'] ?? ''));
    }

    private function findSubjectIdByName($conn, $subjectName, $excludeId = null) {
        $sql = "SELECT subject_id FROM subject WHERE subject_name = :subject_name";
        $params = [':subject_name' => $subjectName];

        if ($excludeId !== null) {
            $sql .= " AND subject_id != :subject_id";
            $params[':subject_id'] = $excludeId;
        }

        $sql .= " LIMIT 1";
        $stmt = $conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchColumn();
    }

    // READ: Fetch all subjects
    function getSubjects() {
        include "connection-pdo.php";
        $sql = "SELECT subject_id, subject_name FROM subject ORDER BY subject_name ASC";
        $stmt = $conn->prepare($sql);
        $stmt->execute();
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    // CREATE: Insert new subject, branch-style return
    function insertSubject($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true) ?: [];
        $subjectName = $this->getSubjectName($data);

        if ($subjectName === '' || $this->findSubjectIdByName($conn, $subjectName)) {
            echo json_encode(0);
            return;
        }

        $sql = "INSERT INTO subject(subject_name) VALUES(:subject_name)";
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":subject_name", $subjectName);
        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    // CREATE: Insert or return existing subject for employee modal
    function addSubject($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true) ?: [];
        $subjectName = $this->getSubjectName($data);

        if ($subjectName === '') {
            echo json_encode(["status" => "error", "message" => "Subject name is required"]);
            return;
        }

        $existing = $this->findSubjectIdByName($conn, $subjectName);
        if ($existing) {
            echo json_encode([
                "status" => "success",
                "message" => "Subject already exists",
                "subject_id" => $existing,
                "subject_name" => $subjectName
            ]);
            return;
        }

        $stmt = $conn->prepare("INSERT INTO subject(subject_name) VALUES(:subject_name)");
        $success = $stmt->execute([":subject_name" => $subjectName]);

        if ($success) {
            echo json_encode([
                "status" => "success",
                "message" => "Subject added",
                "subject_id" => $conn->lastInsertId(),
                "subject_name" => $subjectName
            ]);
        } else {
            echo json_encode(["status" => "error", "message" => "Failed to add subject"]);
        }
    }

    // UPDATE: Modify existing subject
    function updateSubject($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true) ?: [];
        $subjectId = intval($data['subject_id'] ?? 0);
        $subjectName = $this->getSubjectName($data);

        if ($subjectId <= 0 || $subjectName === '' || $this->findSubjectIdByName($conn, $subjectName, $subjectId)) {
            echo json_encode(0);
            return;
        }

        $sql = "UPDATE subject SET subject_name = :subject_name WHERE subject_id = :subject_id";
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":subject_name", $subjectName);
        $stmt->bindParam(":subject_id", $subjectId, PDO::PARAM_INT);
        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    // DELETE: Remove subject
    function deleteSubject($json) {
        include "connection-pdo.php";
        $data = json_decode($json, true) ?: [];
        $subjectId = intval($data['subject_id'] ?? 0);

        if ($subjectId <= 0) {
            echo json_encode(0);
            return;
        }

        try {
            $sql = "DELETE FROM subject WHERE subject_id = :subject_id";
            $stmt = $conn->prepare($sql);
            $stmt->bindParam(":subject_id", $subjectId, PDO::PARAM_INT);
            $stmt->execute();
            echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
        } catch (PDOException $e) {
            echo json_encode(0);
        }
    }
}

$operation = "";
$json = "";

if ($_SERVER['REQUEST_METHOD'] == 'GET') {
    $operation = $_GET['operation'] ?? "";
    $json = $_GET['json'] ?? "";
} else if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    if (is_array($input) && isset($input['operation'])) {
        $operation = $input['operation'];
        $json = $input['json'] ?? "";
    } else {
        $operation = $_POST['operation'] ?? "";
        $json = $_POST['json'] ?? "";
    }
}

$subject = new Subject();

switch ($operation) {
    case "getSubjects": $subject->getSubjects(); break;
    case "insertSubject": $subject->insertSubject($json); break;
    case "addSubject": $subject->addSubject($json); break;
    case "updateSubject": $subject->updateSubject($json); break;
    case "deleteSubject": $subject->deleteSubject($json); break;
    default: echo json_encode(["error" => "Invalid Operation"]); break;
}
?>
