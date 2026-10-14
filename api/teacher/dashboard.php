<?php
require_once __DIR__ . '/../security/AuthGuard.php';
AuthGuard::requireUser();

header('Content-Type: application/json');
header('Cache-Control: no-store');

$role = strtolower(trim((string) ($_SESSION['user_role'] ?? '')));
$role = preg_replace('/[\s_-]+/', ' ', $role);
$teacherId = intval($_SESSION['employee_id'] ?? 0);

if ($role !== 'teacher' || $teacherId <= 0) {
    http_response_code(403);
    echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET' || ($_GET['operation'] ?? '') !== 'getStudents') {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'Invalid operation']);
    exit;
}

$conn = AuthGuard::connection();

try {
    // A student may have multiple subjects, sections, or enrollments. Count them once.
    $sql = "SELECT DISTINCT st.student_id, st.student_id_number,
                   TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name
            FROM student st
            JOIN enrollment_header eh ON eh.student_id = st.student_id
            JOIN enrollment_details ed ON ed.enrollment_header_id = eh.enrollment_header_id
            LEFT JOIN sections sec ON sec.section_id = ed.section_id
            WHERE ed.preferred_teacher = :preferred_teacher_id
               OR sec.employee_id = :section_teacher_id
               OR EXISTS (
                   SELECT 1 FROM enrollment_preferred_schedule assigned_session
                   WHERE assigned_session.enrollment_details_id = ed.enrollment_details_id
                     AND assigned_session.substitute_teacher_id = :substitute_teacher_id
               )
            ORDER BY student_name ASC, st.student_id ASC";
    $stmt = $conn->prepare($sql);
    $stmt->execute([
        ':preferred_teacher_id' => $teacherId,
        ':section_teacher_id' => $teacherId,
        ':substitute_teacher_id' => $teacherId
    ]);

    echo json_encode(['status' => 'success', 'students' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
} catch (PDOException $e) {
    error_log('Teacher dashboard students failed: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Assigned students could not be loaded.']);
}
