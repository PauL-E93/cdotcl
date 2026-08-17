<?php
header('Content-Type: application/json');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

function getLoggedInTeacherId() {
    $role = strtolower(trim((string) ($_SESSION['user_role'] ?? '')));
    $role = preg_replace('/[\s_-]+/', ' ', $role);
    $teacherId = intval($_SESSION['employee_id'] ?? 0);

    if ($role !== 'teacher' || $teacherId <= 0) {
        http_response_code(403);
        echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
        exit;
    }

    return $teacherId;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET' || ($_GET['operation'] ?? '') !== 'getAllClasses') {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'Invalid operation']);
    exit;
}

include __DIR__ . '/../admin/connection-pdo.php';

$teacherId = getLoggedInTeacherId();
$sql = "SELECT c.class_id,
               c.branch_id,
               c.program_id,
               c.status,
               p.name AS program_name,
               b.branch_name,
               COUNT(DISTINCT sec.section_id) AS section_count,
               COUNT(DISTINCT eh.student_id) AS student_count
        FROM class c
        JOIN sections sec
          ON sec.class_id = c.class_id
         AND sec.employee_id = :teacher_id
        JOIN program p ON c.program_id = p.program_id
        JOIN branch b ON c.branch_id = b.branch_id
        LEFT JOIN enrollment_details ed ON ed.section_id = sec.section_id
        LEFT JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
        GROUP BY c.class_id, c.branch_id, c.program_id, c.status, p.name, b.branch_name
        ORDER BY b.branch_name ASC, p.name ASC";
$stmt = $conn->prepare($sql);
$stmt->execute([':teacher_id' => $teacherId]);

echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
