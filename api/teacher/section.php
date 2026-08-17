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

function getSectionsByClass($conn, $teacherId) {
    $classId = intval($_GET['class_id'] ?? 0);
    if ($classId <= 0) {
        http_response_code(400);
        echo json_encode(['status' => 'error', 'message' => 'Invalid class']);
        return;
    }

    $sql = "SELECT s.section_id,
                   s.class_id,
                   s.employee_id,
                   s.section_name,
                   s.status,
                   s.max,
                   e.first_name,
                   e.last_name,
                   e.status AS instructor_status,
                   GROUP_CONCAT(CONCAT(sch.day_of_week, ': ', TIME_FORMAT(sch.start_time, '%h:%i %p'), '-', TIME_FORMAT(sch.end_time, '%h:%i %p')) SEPARATOR ' | ') AS schedule_info
            FROM sections s
            LEFT JOIN employee e ON s.employee_id = e.employee_id
            LEFT JOIN section_schedules sch ON s.section_id = sch.section_id
            WHERE s.class_id = :class_id
              AND s.employee_id = :teacher_id
            GROUP BY s.section_id
            ORDER BY s.section_name ASC";
    $stmt = $conn->prepare($sql);
    $stmt->execute([
        ':class_id' => $classId,
        ':teacher_id' => $teacherId
    ]);

    echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
}

function getEnrolledStudents($conn, $teacherId) {
    $sectionId = intval($_GET['section_id'] ?? 0);
    if ($sectionId <= 0) {
        http_response_code(400);
        echo json_encode(['status' => 'error', 'message' => 'Invalid section']);
        return;
    }

    $sql = "SELECT ed.enrollment_details_id,
                   student.student_id,
                   student.student_id_number,
                   student.first_name,
                   student.last_name,
                   student.ext,
                   p.name AS program_name,
                   sy.school_year,
                   CASE
                       WHEN JSON_VALID(sy.quarters_json) AND JSON_LENGTH(sy.quarters_json) > 0
                           THEN JSON_LENGTH(sy.quarters_json)
                       ELSE GREATEST(3,
                           (sy.quarter_1_start IS NOT NULL OR sy.quarter_1_end IS NOT NULL) +
                           (sy.quarter_2_start IS NOT NULL OR sy.quarter_2_end IS NOT NULL) +
                           (sy.quarter_3_start IS NOT NULL OR sy.quarter_3_end IS NOT NULL) +
                           (sy.quarter_4_start IS NOT NULL OR sy.quarter_4_end IS NOT NULL))
                   END AS quarter_count,
                   ed.status,
                   eh.date_created AS enrollment_date
            FROM enrollment_details ed
            JOIN sections sec
              ON ed.section_id = sec.section_id
             AND sec.employee_id = :teacher_id
            JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
            JOIN student ON eh.student_id = student.student_id
            LEFT JOIN program p ON ed.program_id = p.program_id
            LEFT JOIN school_years sy ON eh.school_year_id = sy.school_year_id
            WHERE ed.section_id = :section_id
            ORDER BY student.last_name, student.first_name ASC";
    $stmt = $conn->prepare($sql);
    $stmt->execute([
        ':section_id' => $sectionId,
        ':teacher_id' => $teacherId
    ]);

    echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['status' => 'error', 'message' => 'Method not allowed']);
    exit;
}

include __DIR__ . '/../admin/connection-pdo.php';

$teacherId = getLoggedInTeacherId();
$operation = $_GET['operation'] ?? '';

switch ($operation) {
    case 'getSectionsByClass':
        getSectionsByClass($conn, $teacherId);
        break;
    case 'getEnrolledStudents':
        getEnrolledStudents($conn, $teacherId);
        break;
    default:
        http_response_code(400);
        echo json_encode(['status' => 'error', 'message' => 'Invalid operation']);
        break;
}
