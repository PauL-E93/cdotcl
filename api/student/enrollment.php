<?php
session_start();

header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET");
header("Access-Control-Allow-Headers: Content-Type");

class StudentEnrollmentAPI {
    private $conn;

    public function __construct() {
        include "../admin/connection-pdo.php";
        $this->conn = $conn;
    }

    private function buildProgramTypeFilter($type, $prefix = 'p') {
        $programName = "LOWER($prefix.name)";
        $programType = "$prefix.program_type";

        if ($type === 'tutorial') {
            return " AND (($programType IN (1, 2)) OR ($programType IS NULL AND $programName NOT LIKE '%preschool%' AND $programName NOT LIKE '%playschool%' AND $programName NOT LIKE '%pre-school%' AND $programName NOT LIKE '%play-school%' AND $programName NOT LIKE '%pre school%' AND $programName NOT LIKE '%play school%'))";
        }

        if ($type === 'preschool') {
            return " AND (($programType = 3) OR $programName LIKE '%preschool%' OR $programName LIKE '%playschool%' OR $programName LIKE '%pre-school%' OR $programName LIKE '%play-school%' OR $programName LIKE '%pre school%' OR $programName LIKE '%play school%')";
        }

        return "";
    }

    // Get enrollments for the logged-in student
    public function getEnrollments() {
        if (!isset($_SESSION['user_id'])) {
            echo json_encode(["status" => "error", "message" => "Not logged in"]);
            return;
        }
        $student_id = $_SESSION['user_id'];

        try {
            $page = isset($_GET['page']) ? (int)$_GET['page'] : 1;
            $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 10;
            $offset = ($page - 1) * $limit;
            $type = $_GET['type'] ?? null;
            $search = isset($_GET['search']) ? trim($_GET['search']) : '';
            $status = isset($_GET['status']) ? trim($_GET['status']) : '';
            $subject = isset($_GET['subject']) ? trim($_GET['subject']) : '';
            $teacher = isset($_GET['teacher']) ? trim($_GET['teacher']) : '';
            $typeFilter = $this->buildProgramTypeFilter($type);
            $subjectExpression = "COALESCE(NULLIF(TRIM(esub.subject_names), ''), NULLIF(TRIM(sub.subject_name), ''), p.name)";
            $teacherExpression = "COALESCE(NULLIF(TRIM(CONCAT_WS(' ', e.first_name, e.last_name)), ''), NULLIF(TRIM(CONCAT_WS(' ', sec_e.first_name, sec_e.last_name)), ''))";
            $effectiveStatusExpression = "COALESCE(NULLIF(eh.status, ''), ed.status)";
            $filterSql = "";
            $params = [':sid' => $student_id];

            if ($search !== '') {
                $filterSql .= " AND ($subjectExpression LIKE :search OR $teacherExpression LIKE :search)";
                $params[':search'] = "%$search%";
            }
            if ($status !== '') {
                $filterSql .= " AND $effectiveStatusExpression = :status";
                $params[':status'] = $status;
            }
            if ($subject !== '') {
                $filterSql .= " AND $subjectExpression LIKE :subject";
                $params[':subject'] = "%$subject%";
            }
            if ($teacher !== '') {
                $filterSql .= " AND $teacherExpression = :teacher";
                $params[':teacher'] = $teacher;
            }

            // Get total count for this student
            $countSql = "SELECT COUNT(*)
                         FROM enrollment_details ed
                         JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                         JOIN program p ON ed.program_id = p.program_id
                         LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                         LEFT JOIN (SELECT es.enrollment_details_id, GROUP_CONCAT(s.subject_name ORDER BY s.subject_name SEPARATOR ', ') AS subject_names FROM enrollment_subjects es JOIN subject s ON es.subject_id = s.subject_id GROUP BY es.enrollment_details_id) esub ON ed.enrollment_details_id = esub.enrollment_details_id
                         LEFT JOIN employee e ON ed.preferred_teacher = e.employee_id
                         LEFT JOIN sections sec ON ed.section_id = sec.section_id
                         LEFT JOIN employee sec_e ON sec.employee_id = sec_e.employee_id
                         WHERE eh.student_id = :sid" . $typeFilter . $filterSql;
            $stmtCount = $this->conn->prepare($countSql);
            foreach ($params as $key => $value) {
                $stmtCount->bindValue($key, $value);
            }
            $stmtCount->execute();
            $total = $stmtCount->fetchColumn();

            // Get paginated data for this student
            $sql = "SELECT ed.enrollment_details_id,
                           TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
                           p.name AS program_name,
                           p.program_type,
                           $subjectExpression AS subject_name,
                           $teacherExpression AS teacher_name,
                           DATE_FORMAT(eh.date_created, '%M %d, %Y') AS enrollment_date,
                           COALESCE(NULLIF(eh.status, ''), ed.status) AS status
                    FROM enrollment_details ed
                    JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                    JOIN student st ON eh.student_id = st.student_id
                    JOIN program p ON ed.program_id = p.program_id
                    LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                    LEFT JOIN (SELECT es.enrollment_details_id, GROUP_CONCAT(s.subject_name ORDER BY s.subject_name SEPARATOR ', ') AS subject_names FROM enrollment_subjects es JOIN subject s ON es.subject_id = s.subject_id GROUP BY es.enrollment_details_id) esub ON ed.enrollment_details_id = esub.enrollment_details_id
                    LEFT JOIN employee e ON ed.preferred_teacher = e.employee_id
                    LEFT JOIN sections sec ON ed.section_id = sec.section_id
                    LEFT JOIN employee sec_e ON sec.employee_id = sec_e.employee_id
                    WHERE eh.student_id = :sid" . $typeFilter . $filterSql . "
                    ORDER BY eh.date_created DESC
                    LIMIT :limit OFFSET :offset";
            $stmt = $this->conn->prepare($sql);
            foreach ($params as $key => $value) {
                $stmt->bindValue($key, $value);
            }
            $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
            $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
            $stmt->execute();
            $result = $stmt->fetchAll(PDO::FETCH_ASSOC);

            echo json_encode([
                "status" => "success",
                "data" => $result,
                "pagination" => [
                    "current_page" => $page,
                    "per_page" => $limit,
                    "total" => (int)$total,
                    "total_pages" => ceil($total / $limit)
                ]
            ]);
        } catch (Exception $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    public function getPrePlayEnrollments() {
        $_GET['type'] = 'preschool';
        $this->getEnrollments();
    }

    public function getEnrollmentFilterLookups() {
        if (!isset($_SESSION['user_id'])) {
            echo json_encode(["status" => "error", "message" => "Not logged in"]);
            return;
        }

        try {
            $studentId = $_SESSION['user_id'];
            $typeFilter = $this->buildProgramTypeFilter($_GET['type'] ?? null);
            $subjectExpression = "COALESCE(NULLIF(TRIM(esub.subject_names), ''), NULLIF(TRIM(sub.subject_name), ''), p.name)";
            $teacherExpression = "COALESCE(NULLIF(TRIM(CONCAT_WS(' ', e.first_name, e.last_name)), ''), NULLIF(TRIM(CONCAT_WS(' ', sec_e.first_name, sec_e.last_name)), ''))";
            $statusExpression = "COALESCE(NULLIF(eh.status, ''), ed.status)";
            $joins = " FROM enrollment_details ed
                       JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                       JOIN program p ON ed.program_id = p.program_id
                       LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                       LEFT JOIN (SELECT es.enrollment_details_id, GROUP_CONCAT(s.subject_name ORDER BY s.subject_name SEPARATOR ', ') AS subject_names FROM enrollment_subjects es JOIN subject s ON es.subject_id = s.subject_id GROUP BY es.enrollment_details_id) esub ON ed.enrollment_details_id = esub.enrollment_details_id
                       LEFT JOIN employee e ON ed.preferred_teacher = e.employee_id
                       LEFT JOIN sections sec ON ed.section_id = sec.section_id
                       LEFT JOIN employee sec_e ON sec.employee_id = sec_e.employee_id
                       WHERE eh.student_id = :sid" . $typeFilter;

            $loadValues = function ($expression) use ($joins, $studentId) {
                $sql = "SELECT DISTINCT $expression AS value" . $joins . " HAVING value IS NOT NULL AND TRIM(value) <> '' ORDER BY value";
                $stmt = $this->conn->prepare($sql);
                $stmt->execute([':sid' => $studentId]);
                return array_column($stmt->fetchAll(PDO::FETCH_ASSOC), 'value');
            };

            echo json_encode([
                "status" => "success",
                "data" => [
                    "statuses" => $loadValues($statusExpression),
                    "subjects" => $loadValues($subjectExpression),
                    "teachers" => $loadValues($teacherExpression)
                ]
            ]);
        } catch (Exception $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    // Get enrollment stats for the logged-in student
    public function getEnrollmentStats() {
        if (!isset($_SESSION['user_id'])) {
            echo json_encode(["status" => "error", "message" => "Not logged in"]);
            return;
        }
        $student_id = $_SESSION['user_id'];

        try {
            $type = $_GET['type'] ?? null;
            $typeFilter = $this->buildProgramTypeFilter($type);
            $baseFrom = " FROM enrollment_details ed JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id JOIN program p ON ed.program_id = p.program_id WHERE eh.student_id = ?";

            $total = $this->conn->prepare("SELECT COUNT(*)" . $baseFrom . $typeFilter);
            $total->execute([$student_id]);
            $total = $total->fetchColumn();

            $pending = $this->conn->prepare("SELECT COUNT(*)" . $baseFrom . $typeFilter . " AND COALESCE(NULLIF(eh.status, ''), ed.status) IN ('pending','incomplete')");
            $pending->execute([$student_id]);
            $pending = $pending->fetchColumn();

            $cancelled = $this->conn->prepare("SELECT COUNT(*)" . $baseFrom . $typeFilter . " AND ed.status = 'cancelled'");
            $cancelled->execute([$student_id]);
            $cancelled = $cancelled->fetchColumn();

            $new = $this->conn->prepare("SELECT COUNT(*)" . $baseFrom . $typeFilter . " AND eh.date_created >= DATE_SUB(NOW(), INTERVAL 30 DAY)");
            $new->execute([$student_id]);
            $new = $new->fetchColumn();

            echo json_encode(["status" => "success", "data" => ["total" => $total, "new" => $new, "pending" => $pending, "cancelled" => $cancelled]]);
        } catch (Exception $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    public function getPrePlayEnrollmentStats() {
        $_GET['type'] = 'preschool';
        $this->getEnrollmentStats();
    }

    // Get enrollment details for the logged-in student
    public function getEnrollmentDetails() {
        if (!isset($_SESSION['user_id'])) {
            echo json_encode(["status" => "error", "message" => "Not logged in"]);
            return;
        }
        $student_id = $_SESSION['user_id'];
        $id = $_GET['id'] ?? null;
        if (!$id) {
            echo json_encode(["status" => "error", "message" => "ID required"]);
            return;
        }
        try {
            // Check if the enrollment belongs to the logged-in student
            $checkSql = "SELECT COUNT(*) FROM enrollment_details ed JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id WHERE ed.enrollment_details_id = ? AND eh.student_id = ?";
            $checkStmt = $this->conn->prepare($checkSql);
            $checkStmt->execute([$id, $student_id]);
            if ($checkStmt->fetchColumn() == 0) {
                echo json_encode(["status" => "error", "message" => "Access denied"]);
                return;
            }

            // Get details
            $hasClassColStmt = $this->conn->prepare("SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'enrollment_details' AND COLUMN_NAME = 'class_id'");
            $hasClassColStmt->execute();
            $hasClassCol = $hasClassColStmt->fetchColumn() > 0;

            $hasHealthNoteColStmt = $this->conn->prepare("SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'enrollment_details' AND COLUMN_NAME = 'health_note'");
            $hasHealthNoteColStmt->execute();
            $hasHealthNoteCol = $hasHealthNoteColStmt->fetchColumn() > 0;

            $hasStudentHealthNoteColStmt = $this->conn->prepare("SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'student' AND COLUMN_NAME = 'health_note'");
            $hasStudentHealthNoteColStmt->execute();
            $hasStudentHealthNoteCol = $hasStudentHealthNoteColStmt->fetchColumn() > 0;

            if ($hasHealthNoteCol && $hasStudentHealthNoteCol) {
                $healthNoteSelect = ", COALESCE(NULLIF(ed.health_note, ''), s.health_note) AS health_note";
            } elseif ($hasHealthNoteCol) {
                $healthNoteSelect = ", ed.health_note";
            } elseif ($hasStudentHealthNoteCol) {
                $healthNoteSelect = ", s.health_note";
            } else {
                $healthNoteSelect = "";
            }

            if ($hasClassCol) {
                $sql = "SELECT ed.enrollment_details_id, ed.program_id, ed.grade_level_id, ed.subject_id, ed.goal, ed.preferred_time_day, ed.preferred_teacher, COALESCE(NULLIF(eh.status, ''), ed.status) AS status, ed.class_id, ed.section_id{$healthNoteSelect},
                               s.student_id, s.student_id_number, s.first_name, s.last_name, s.ext, s.adr_street, s.adr_barangay, s.adr_city, s.adr_province, s.adr_note, eh.total_of_program as total_fee, eh.school_year_id, sy.school_year AS school_year_label, DATE_FORMAT(eh.date_created, '%M %d, %Y') as enrollment_date,
                               p.name as program_name,
                               COALESCE(esub.subject_names, sub.subject_name) AS subject_name,
                               gl.grade_level,
                               CONCAT(e.first_name, ' ', e.last_name) as teacher_name,
                               CONCAT(sec_e.first_name, ' ', sec_e.last_name) as section_teacher_name,
                               b.branch_name,
                               COALESCE(sec.section_name, '') as section_name,
                               COALESCE(ed.class_id, sec.class_id) as class_id_from_section,
                               COALESCE(cls.program_id, p.program_id) as class_program_id
                        FROM enrollment_details ed
                        JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                        JOIN student s ON eh.student_id = s.student_id
                        LEFT JOIN branch b ON eh.branch_id = b.branch_id
                        LEFT JOIN school_years sy ON eh.school_year_id = sy.school_year_id
                        LEFT JOIN program p ON ed.program_id = p.program_id
                        LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                        LEFT JOIN (SELECT es.enrollment_details_id, GROUP_CONCAT(s.subject_name ORDER BY s.subject_name SEPARATOR ', ') AS subject_names FROM enrollment_subjects es JOIN subject s ON es.subject_id = s.subject_id GROUP BY es.enrollment_details_id) esub ON ed.enrollment_details_id = esub.enrollment_details_id
                        LEFT JOIN grade_level gl ON ed.grade_level_id = gl.grade_level_id
                        LEFT JOIN employee e ON ed.preferred_teacher = e.employee_id
                        LEFT JOIN sections sec ON ed.section_id = sec.section_id
                        LEFT JOIN class cls ON COALESCE(ed.class_id, sec.class_id) = cls.class_id
                        LEFT JOIN employee sec_e ON sec.employee_id = sec_e.employee_id
                        WHERE ed.enrollment_details_id = ?";
            } else {
                $sql = "SELECT ed.enrollment_details_id, ed.program_id, ed.grade_level_id, ed.subject_id, ed.goal, ed.preferred_time_day, ed.preferred_teacher, COALESCE(NULLIF(eh.status, ''), ed.status) AS status, ed.section_id{$healthNoteSelect},
                               s.student_id, s.student_id_number, s.first_name, s.last_name, s.ext, s.adr_street, s.adr_barangay, s.adr_city, s.adr_province, s.adr_note, eh.total_of_program as total_fee, eh.school_year_id, sy.school_year AS school_year_label, DATE_FORMAT(eh.date_created, '%M %d, %Y') as enrollment_date,
                               p.name as program_name,
                               COALESCE(esub.subject_names, sub.subject_name) AS subject_name,
                               gl.grade_level,
                               CONCAT(e.first_name, ' ', e.last_name) as teacher_name,
                               CONCAT(sec_e.first_name, ' ', sec_e.last_name) as section_teacher_name,
                               b.branch_name,
                               COALESCE(sec.section_name, '') as section_name,
                               COALESCE(sec.class_id, cls.class_id) as class_id_from_section,
                               COALESCE(cls.program_id, p.program_id) as class_program_id
                        FROM enrollment_details ed
                        JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                        JOIN student s ON eh.student_id = s.student_id
                        LEFT JOIN branch b ON eh.branch_id = b.branch_id
                        LEFT JOIN school_years sy ON eh.school_year_id = sy.school_year_id
                        LEFT JOIN program p ON ed.program_id = p.program_id
                        LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                        LEFT JOIN (SELECT es.enrollment_details_id, GROUP_CONCAT(s.subject_name ORDER BY s.subject_name SEPARATOR ', ') AS subject_names FROM enrollment_subjects es JOIN subject s ON es.subject_id = s.subject_id GROUP BY es.enrollment_details_id) esub ON ed.enrollment_details_id = esub.enrollment_details_id
                        LEFT JOIN grade_level gl ON ed.grade_level_id = gl.grade_level_id
                        LEFT JOIN employee e ON ed.preferred_teacher = e.employee_id
                        LEFT JOIN sections sec ON ed.section_id = sec.section_id
                        LEFT JOIN class cls ON sec.class_id = cls.class_id
                        LEFT JOIN employee sec_e ON sec.employee_id = sec_e.employee_id
                        WHERE ed.enrollment_details_id = ?";
            }
            $stmt = $this->conn->prepare($sql);
            $stmt->execute([$id]);
            $details = $stmt->fetch(PDO::FETCH_ASSOC);

            // Get schedule
            $sqlSched = "SELECT day, start_time, end_time, date FROM enrollment_preferred_schedule WHERE enrollment_details_id = ?";
            $stmtSched = $this->conn->prepare($sqlSched);
            $stmtSched->execute([$id]);
            $schedule = $stmtSched->fetchAll(PDO::FETCH_ASSOC);

            // Get assigned section schedule for preschool/play-school section details.
            $section_schedule = [];
            if (is_array($details) && !empty($details['section_id'])) {
                $sqlSectionSched = "SELECT day_of_week AS day, start_time, end_time
                                    FROM section_schedules
                                    WHERE section_id = ?
                                    ORDER BY FIELD(day_of_week, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')";
                $stmtSectionSched = $this->conn->prepare($sqlSectionSched);
                $stmtSectionSched->execute([$details['section_id']]);
                $section_schedule = $stmtSectionSched->fetchAll(PDO::FETCH_ASSOC);
            }

            echo json_encode(["status" => "success", "data" => ["details" => $details, "schedule" => $schedule, "section_schedule" => $section_schedule]]);
        } catch (Exception $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }
}

// ROUTER
if ($_SERVER['REQUEST_METHOD'] == 'GET') {
    $op = $_GET['operation'] ?? null;
} else {
    $content = file_get_contents('php://input');
    $postData = json_decode($content, true);
    $op = $postData['operation'] ?? null;
}

$api = new StudentEnrollmentAPI();
switch($op){
    case "getEnrollments": $api->getEnrollments(); break;
    case "getPrePlayEnrollments": $api->getPrePlayEnrollments(); break;
    case "getEnrollmentFilterLookups": $api->getEnrollmentFilterLookups(); break;
    case "getEnrollmentStats": $api->getEnrollmentStats(); break;
    case "getPrePlayEnrollmentStats": $api->getPrePlayEnrollmentStats(); break;
    case "getEnrollmentDetails": $api->getEnrollmentDetails(); break;
    default: echo json_encode(["status" => "error", "message" => "Invalid Operation"]); break;
}
?>
