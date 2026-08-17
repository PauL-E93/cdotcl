<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');
header('Access-Control-Allow-Headers: Content-Type');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

function studentAttendanceError($statusCode, $message) {
    http_response_code($statusCode);
    echo json_encode([
        'status' => 'error',
        'message' => $message
    ]);
    exit;
}

function normalizeStudentAttendanceRole($role) {
    $role = strtolower(trim((string) $role));
    return preg_replace('/[\s_-]+/', ' ', $role);
}

class StudentAttendanceModule {
    private $conn;
    private $studentId;

    public function __construct() {
        $role = normalizeStudentAttendanceRole($_SESSION['user_role'] ?? '');
        $studentId = intval($_SESSION['student_id'] ?? $_SESSION['user_id'] ?? 0);

        if ($role !== 'student' || $studentId <= 0) {
            studentAttendanceError(401, 'Please log in with a student account to view attendance.');
        }

        include '../admin/connection-pdo.php';
        $this->conn = $conn;
        $this->studentId = $studentId;
    }

    private function formatMonthKey($value) {
        $value = trim((string) $value);
        if (!preg_match('/^\d{4}-\d{2}$/', $value)) {
            return false;
        }

        $month = intval(substr($value, 5, 2));
        return $month >= 1 && $month <= 12 ? $value : false;
    }

    private function dayOrderSql($fieldName = 'sch.day_of_week') {
        return "CASE {$fieldName}
                    WHEN 'Sunday' THEN 1
                    WHEN 'Monday' THEN 2
                    WHEN 'Tuesday' THEN 3
                    WHEN 'Wednesday' THEN 4
                    WHEN 'Thursday' THEN 5
                    WHEN 'Friday' THEN 6
                    WHEN 'Saturday' THEN 7
                    ELSE 8
                END";
    }

    private function getEnrollmentContext($enrollmentDetailsId) {
        $sql = "SELECT ed.enrollment_details_id,
                       ed.section_id,
                       ed.status AS enrollment_status,
                       eh.school_year_id,
                       eh.status AS enrollment_header_status,
                       st.student_id,
                       TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
                       p.name AS program_name,
                       sec.section_name,
                       b.branch_name,
                       TRIM(CONCAT_WS(' ', emp.first_name, emp.last_name)) AS teacher_name,
                       sy.school_year,
                       sy.start_date AS school_year_start,
                       sy.end_date AS school_year_end
                FROM enrollment_details ed
                JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
                JOIN student st ON st.student_id = eh.student_id
                JOIN program p ON p.program_id = ed.program_id
                LEFT JOIN sections sec ON sec.section_id = ed.section_id
                LEFT JOIN class c ON c.class_id = sec.class_id
                LEFT JOIN branch b ON b.branch_id = c.branch_id
                LEFT JOIN employee emp ON emp.employee_id = sec.employee_id
                LEFT JOIN school_years sy ON sy.school_year_id = eh.school_year_id
                WHERE ed.enrollment_details_id = :enrollment_details_id
                  AND eh.student_id = :student_id
                LIMIT 1";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute([
            ':enrollment_details_id' => $enrollmentDetailsId,
            ':student_id' => $this->studentId
        ]);
        $context = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$context) {
            return null;
        }

        if (empty($context['school_year_start']) || empty($context['school_year_end'])) {
            $schoolYearStmt = $this->conn->query("SELECT school_year_id, school_year, start_date, end_date
                                                  FROM school_years
                                                  WHERE sy_status = 'active'
                                                  ORDER BY start_date DESC, school_year_id DESC
                                                  LIMIT 1");
            $schoolYear = $schoolYearStmt->fetch(PDO::FETCH_ASSOC);
            if ($schoolYear) {
                $context['school_year_id'] = $schoolYear['school_year_id'];
                $context['school_year'] = $schoolYear['school_year'];
                $context['school_year_start'] = $schoolYear['start_date'];
                $context['school_year_end'] = $schoolYear['end_date'];
            }
        }

        $scheduleStmt = $this->conn->prepare("SELECT schedule_id,
                                                     day_of_week AS day,
                                                     start_time,
                                                     end_time
                                              FROM section_schedules sch
                                              WHERE section_id = :section_id
                                              ORDER BY " . $this->dayOrderSql('sch.day_of_week') . ", start_time");
        $scheduleStmt->execute([':section_id' => intval($context['section_id'])]);
        $context['schedules'] = $scheduleStmt->fetchAll(PDO::FETCH_ASSOC);

        return $context;
    }

    private function getAttendanceForMonth($enrollmentDetailsId, $sectionId, $monthKey) {
        $monthStart = $monthKey . '-01';
        $monthEnd = date('Y-m-t', strtotime($monthStart));
        $stmt = $this->conn->prepare("SELECT ats.attendance_date,
                                             LOWER(ar.status) AS status,
                                             ar.marked_at
                                      FROM attendance_records ar
                                      JOIN attendance_sessions ats ON ats.session_id = ar.session_id
                                      WHERE ar.enrollment_details_id = :enrollment_details_id
                                        AND ats.section_id = :section_id
                                        AND ats.attendance_date BETWEEN :month_start AND :month_end
                                      ORDER BY ats.attendance_date ASC, ar.marked_at DESC");
        $stmt->execute([
            ':enrollment_details_id' => $enrollmentDetailsId,
            ':section_id' => $sectionId,
            ':month_start' => $monthStart,
            ':month_end' => $monthEnd
        ]);

        $attendance = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $dateKey = $row['attendance_date'];
            if (!isset($attendance[$dateKey])) {
                $attendance[$dateKey] = [
                    'status' => $row['status'],
                    'marked_at' => $row['marked_at']
                ];
            }
        }

        return $attendance;
    }

    private function getAttendanceSummary($enrollmentDetailsId, $sectionId, $schoolYearStart, $schoolYearEnd) {
        $dateSql = '';
        $params = [
            ':enrollment_details_id' => $enrollmentDetailsId,
            ':section_id' => $sectionId
        ];

        if ($schoolYearStart && $schoolYearEnd) {
            $dateSql = ' AND ats.attendance_date BETWEEN :school_year_start AND :school_year_end';
            $params[':school_year_start'] = $schoolYearStart;
            $params[':school_year_end'] = $schoolYearEnd;
        }

        $stmt = $this->conn->prepare("SELECT SUM(CASE WHEN LOWER(ar.status) = 'present' THEN 1 ELSE 0 END) AS present_count,
                                             SUM(CASE WHEN LOWER(ar.status) = 'absent' THEN 1 ELSE 0 END) AS absent_count,
                                             SUM(CASE WHEN LOWER(ar.status) = 'late' THEN 1 ELSE 0 END) AS late_count,
                                             SUM(CASE WHEN LOWER(ar.status) = 'excused' THEN 1 ELSE 0 END) AS excused_count,
                                             COUNT(ar.attendance_record_id) AS total_count
                                      FROM attendance_records ar
                                      JOIN attendance_sessions ats ON ats.session_id = ar.session_id
                                      WHERE ar.enrollment_details_id = :enrollment_details_id
                                        AND ats.section_id = :section_id{$dateSql}");
        $stmt->execute($params);
        $summary = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];

        $present = intval($summary['present_count'] ?? 0);
        $absent = intval($summary['absent_count'] ?? 0);
        $late = intval($summary['late_count'] ?? 0);
        $excused = intval($summary['excused_count'] ?? 0);
        $countedDays = $present + $absent + $late;

        return [
            'present' => $present,
            'absent' => $absent,
            'late' => $late,
            'excused' => $excused,
            'total' => intval($summary['total_count'] ?? 0),
            'attendance_rate' => $countedDays > 0 ? round(($present / $countedDays) * 100, 1) : 0
        ];
    }

    private function getRecentAttendance($enrollmentDetailsId, $sectionId, $schoolYearStart, $schoolYearEnd) {
        $dateSql = '';
        $params = [
            ':enrollment_details_id' => $enrollmentDetailsId,
            ':section_id' => $sectionId
        ];

        if ($schoolYearStart && $schoolYearEnd) {
            $dateSql = ' AND ats.attendance_date BETWEEN :school_year_start AND :school_year_end';
            $params[':school_year_start'] = $schoolYearStart;
            $params[':school_year_end'] = $schoolYearEnd;
        }

        $stmt = $this->conn->prepare("SELECT ats.attendance_date,
                                             LOWER(ar.status) AS status,
                                             ar.marked_at
                                      FROM attendance_records ar
                                      JOIN attendance_sessions ats ON ats.session_id = ar.session_id
                                      WHERE ar.enrollment_details_id = :enrollment_details_id
                                        AND ats.section_id = :section_id{$dateSql}
                                      ORDER BY ats.attendance_date DESC, ar.marked_at DESC
                                      LIMIT 10");
        $stmt->execute($params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function getAttendanceDashboard() {
        $enrollmentDetailsId = intval($_GET['enrollment_details_id'] ?? 0);
        $monthKey = $this->formatMonthKey($_GET['month'] ?? '');

        if ($enrollmentDetailsId <= 0 || $monthKey === false) {
            studentAttendanceError(422, 'Invalid enrollment or month.');
        }

        $context = $this->getEnrollmentContext($enrollmentDetailsId);
        if (!$context) {
            studentAttendanceError(404, 'Enrollment not found for this student account.');
        }

        $sectionId = intval($context['section_id'] ?? 0);
        if ($sectionId <= 0) {
            studentAttendanceError(422, 'This enrollment has not been assigned to a class section yet.');
        }

        echo json_encode([
            'status' => 'success',
            'data' => [
                'enrollment' => $context,
                'month' => $monthKey,
                'attendance_by_date' => $this->getAttendanceForMonth($enrollmentDetailsId, $sectionId, $monthKey),
                'summary' => $this->getAttendanceSummary(
                    $enrollmentDetailsId,
                    $sectionId,
                    $context['school_year_start'] ?? null,
                    $context['school_year_end'] ?? null
                ),
                'recent_attendance' => $this->getRecentAttendance(
                    $enrollmentDetailsId,
                    $sectionId,
                    $context['school_year_start'] ?? null,
                    $context['school_year_end'] ?? null
                )
            ]
        ]);
    }
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    studentAttendanceError(405, 'Attendance is read-only for students.');
}

$operation = $_GET['operation'] ?? '';
$attendance = new StudentAttendanceModule();

switch ($operation) {
    case 'getAttendanceDashboard':
        $attendance->getAttendanceDashboard();
        break;
    default:
        studentAttendanceError(400, 'Invalid operation.');
}
