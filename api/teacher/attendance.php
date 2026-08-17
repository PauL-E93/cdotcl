<?php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

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

function denyAttendanceAccess() {
    http_response_code(403);
    echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
}

class AttendanceModule {
    private function getConnection() {
        include __DIR__ . '/../admin/connection-pdo.php';
        $this->ensureSchema($conn);
        return $conn;
    }

    private function ensureSchema($conn) {
        $conn->exec("
            CREATE TABLE IF NOT EXISTS attendance_sessions (
                session_id INT(11) NOT NULL AUTO_INCREMENT,
                section_id INT(11) NOT NULL,
                attendance_date DATE NOT NULL,
                created_by INT(11) DEFAULT NULL,
                updated_by INT(11) DEFAULT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (session_id),
                UNIQUE KEY uq_attendance_section_date (section_id, attendance_date),
                KEY idx_attendance_section (section_id),
                KEY idx_attendance_date (attendance_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        ");

        $conn->exec("
            CREATE TABLE IF NOT EXISTS attendance_records (
                attendance_record_id INT(11) NOT NULL AUTO_INCREMENT,
                session_id INT(11) NOT NULL,
                enrollment_details_id INT(11) NOT NULL,
                student_id INT(11) DEFAULT NULL,
                status ENUM('present', 'absent') NOT NULL DEFAULT 'absent',
                marked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (attendance_record_id),
                UNIQUE KEY uq_attendance_session_enrollment (session_id, enrollment_details_id),
                KEY idx_attendance_record_session (session_id),
                KEY idx_attendance_record_student (student_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        ");
    }

    private function sectionBelongsToTeacher($conn, $sectionId, $teacherId) {
        $stmt = $conn->prepare("
            SELECT 1
            FROM sections
            WHERE section_id = :section_id
              AND employee_id = :teacher_id
            LIMIT 1
        ");
        $stmt->execute([
            ':section_id' => $sectionId,
            ':teacher_id' => $teacherId
        ]);

        return (bool) $stmt->fetchColumn();
    }

    private function formatDateKey($value) {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }

        $date = DateTime::createFromFormat('Y-m-d', $value);
        return $date && $date->format('Y-m-d') === $value ? $value : false;
    }

    private function formatMonthKey($value) {
        $value = trim((string) $value);
        if (!preg_match('/^\d{4}-\d{2}$/', $value)) {
            return false;
        }

        return $value;
    }

    private function dayOrderSql($fieldName = 'sch.day_of_week') {
        return "CASE {$fieldName}
                    WHEN 'Monday' THEN 1
                    WHEN 'Tuesday' THEN 2
                    WHEN 'Wednesday' THEN 3
                    WHEN 'Thursday' THEN 4
                    WHEN 'Friday' THEN 5
                    WHEN 'Saturday' THEN 6
                    WHEN 'Sunday' THEN 7
                    ELSE 8
                END";
    }

    private function getSectionContext($conn, $sectionId, $teacherId) {
        $sql = "SELECT s.section_id, s.section_name, s.status AS section_status, s.max,
                       c.class_id, c.status AS class_status,
                       p.name AS program_name,
                       b.branch_name,
                       CONCAT(COALESCE(e.first_name, ''), CASE WHEN e.last_name IS NOT NULL AND e.last_name <> '' THEN ' ' ELSE '' END, COALESCE(e.last_name, '')) AS teacher_name
                FROM sections s
                JOIN class c ON s.class_id = c.class_id
                JOIN program p ON c.program_id = p.program_id
                JOIN branch b ON c.branch_id = b.branch_id
                LEFT JOIN employee e ON s.employee_id = e.employee_id
                WHERE s.section_id = :section_id
                  AND s.employee_id = :teacher_id
                LIMIT 1";
        $stmt = $conn->prepare($sql);
        $stmt->execute([
            ':section_id' => $sectionId,
            ':teacher_id' => $teacherId
        ]);
        $section = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$section) {
            return null;
        }

        $scheduleStmt = $conn->prepare("
            SELECT schedule_id, day_of_week AS day, start_time, end_time
            FROM section_schedules
            WHERE section_id = :section_id
            ORDER BY " . $this->dayOrderSql('day_of_week') . ", start_time
        ");
        $scheduleStmt->execute([':section_id' => $sectionId]);
        $section['schedules'] = $scheduleStmt->fetchAll(PDO::FETCH_ASSOC);

        $schoolYearStmt = $conn->query("
            SELECT school_year_id, school_year, start_date, end_date
            FROM school_years
            WHERE sy_status = 'active'
            ORDER BY start_date DESC, school_year_id DESC
            LIMIT 1
        ");
        $section['school_year'] = $schoolYearStmt->fetch(PDO::FETCH_ASSOC) ?: null;

        $countStmt = $conn->prepare("
            SELECT COUNT(*) AS total_students
            FROM (
                SELECT DISTINCT ed.enrollment_details_id
                FROM enrollment_details ed
                WHERE ed.section_id = :section_id
            ) AS active_students
        ");
        $countStmt->execute([':section_id' => $sectionId]);
        $section['total_students'] = (int) ($countStmt->fetchColumn() ?: 0);

        return $section;
    }

    private function getRosterRows($conn, $sectionId, $attendanceDate) {
        $sql = "SELECT ed.enrollment_details_id,
                       eh.student_id,
                       s.first_name,
                       s.last_name,
                       s.ext,
                       p.name AS program_name,
                       ar.status AS attendance_status
                FROM enrollment_details ed
                JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                JOIN student s ON eh.student_id = s.student_id
                LEFT JOIN program p ON ed.program_id = p.program_id
                LEFT JOIN attendance_sessions ats
                    ON ats.section_id = ed.section_id
                   AND ats.attendance_date = :attendance_date
                LEFT JOIN attendance_records ar
                    ON ar.session_id = ats.session_id
                   AND ar.enrollment_details_id = ed.enrollment_details_id
                WHERE ed.section_id = :section_id
                ORDER BY s.last_name ASC, s.first_name ASC";

        $stmt = $conn->prepare($sql);
        $stmt->execute([
            ':section_id' => $sectionId,
            ':attendance_date' => $attendanceDate
        ]);

        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$row) {
            $row['attendance_status'] = $row['attendance_status'] ?: null;
        }

        return $rows;
    }

    private function getMonthSummary($conn, $sectionId, $monthKey) {
        $monthStart = $monthKey . '-01';
        $monthEnd = date('Y-m-t', strtotime($monthStart));

        $sql = "SELECT ats.attendance_date,
                       SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END) AS present_count,
                       SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
                       COUNT(ar.attendance_record_id) AS marked_count
                FROM attendance_sessions ats
                LEFT JOIN attendance_records ar ON ats.session_id = ar.session_id
                WHERE ats.section_id = :section_id
                  AND ats.attendance_date BETWEEN :month_start AND :month_end
                GROUP BY ats.attendance_date
                ORDER BY ats.attendance_date ASC";

        $stmt = $conn->prepare($sql);
        $stmt->execute([
            ':section_id' => $sectionId,
            ':month_start' => $monthStart,
            ':month_end' => $monthEnd
        ]);

        $summary = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $summary[$row['attendance_date']] = [
                'present_count' => (int) ($row['present_count'] ?? 0),
                'absent_count' => (int) ($row['absent_count'] ?? 0),
                'marked_count' => (int) ($row['marked_count'] ?? 0)
            ];
        }

        return $summary;
    }

    public function getSectionAttendanceDashboard() {
        $conn = $this->getConnection();
        $teacherId = getLoggedInTeacherId();
        $sectionId = intval($_GET['section_id'] ?? 0);
        $monthKey = $this->formatMonthKey($_GET['month'] ?? '');

        if ($sectionId <= 0 || $monthKey === false) {
            http_response_code(422);
            echo json_encode(['status' => 'error', 'message' => 'Invalid section or month.']);
            return;
        }

        if (!$this->sectionBelongsToTeacher($conn, $sectionId, $teacherId)) {
            denyAttendanceAccess();
            return;
        }

        $section = $this->getSectionContext($conn, $sectionId, $teacherId);
        if (!$section) {
            http_response_code(404);
            echo json_encode(['status' => 'error', 'message' => 'Section not found.']);
            return;
        }

        echo json_encode([
            'status' => 'success',
            'data' => [
                'section' => $section,
                'month' => $monthKey,
                'attendance_by_date' => $this->getMonthSummary($conn, $sectionId, $monthKey)
            ]
        ]);
    }

    public function getAttendanceRoster() {
        $conn = $this->getConnection();
        $teacherId = getLoggedInTeacherId();
        $sectionId = intval($_GET['section_id'] ?? 0);
        $attendanceDate = $this->formatDateKey($_GET['attendance_date'] ?? '');

        if ($sectionId <= 0 || $attendanceDate === false || !$attendanceDate) {
            http_response_code(422);
            echo json_encode(['status' => 'error', 'message' => 'Invalid section or attendance date.']);
            return;
        }

        if (!$this->sectionBelongsToTeacher($conn, $sectionId, $teacherId)) {
            denyAttendanceAccess();
            return;
        }

        $section = $this->getSectionContext($conn, $sectionId, $teacherId);
        if (!$section) {
            http_response_code(404);
            echo json_encode(['status' => 'error', 'message' => 'Section not found.']);
            return;
        }

        $students = $this->getRosterRows($conn, $sectionId, $attendanceDate);
        $presentStudents = [];
        $absentStudents = [];

        foreach ($students as $student) {
            $name = trim(($student['first_name'] ?? '') . ' ' . ($student['last_name'] ?? '') . ' ' . ($student['ext'] ?? ''));
            $student['student_name'] = preg_replace('/\s+/', ' ', trim($name));

            if ($student['attendance_status'] === 'present') {
                $presentStudents[] = $student;
            } else {
                $absentStudents[] = $student;
            }
        }

        echo json_encode([
            'status' => 'success',
            'data' => [
                'section' => $section,
                'attendance_date' => $attendanceDate,
                'students' => array_map(function ($student) {
                    $student['student_name'] = preg_replace('/\s+/', ' ', trim(($student['first_name'] ?? '') . ' ' . ($student['last_name'] ?? '') . ' ' . ($student['ext'] ?? '')));
                    return $student;
                }, $students),
                'present_count' => count($presentStudents),
                'absent_count' => count($absentStudents),
                'present_students' => array_map(function ($student) {
                    return [
                        'student_name' => $student['student_name'],
                        'program_name' => $student['program_name']
                    ];
                }, $presentStudents),
                'absent_students' => array_map(function ($student) {
                    return [
                        'student_name' => $student['student_name'],
                        'program_name' => $student['program_name']
                    ];
                }, $absentStudents)
            ]
        ]);
    }

    public function saveAttendance($json) {
        $conn = $this->getConnection();
        $teacherId = getLoggedInTeacherId();
        $data = json_decode($json, true);
        $sectionId = intval($data['section_id'] ?? 0);
        $attendanceDate = $this->formatDateKey($data['attendance_date'] ?? '');
        $records = isset($data['records']) && is_array($data['records']) ? $data['records'] : [];
        $employeeId = intval($_SESSION['employee_id'] ?? 0) ?: null;

        if ($sectionId <= 0 || $attendanceDate === false || !$attendanceDate) {
            http_response_code(422);
            echo json_encode(['status' => 'error', 'message' => 'Invalid section or attendance date.']);
            return;
        }

        if (count($records) === 0) {
            http_response_code(422);
            echo json_encode(['status' => 'error', 'message' => 'No attendance records were submitted.']);
            return;
        }

        if (!$this->sectionBelongsToTeacher($conn, $sectionId, $teacherId)) {
            denyAttendanceAccess();
            return;
        }

        $eligibleStudents = $this->getRosterRows($conn, $sectionId, $attendanceDate);
        $eligibleMap = [];
        foreach ($eligibleStudents as $student) {
            $eligibleMap[(int) $student['enrollment_details_id']] = (int) ($student['student_id'] ?? 0);
        }

        if (count($eligibleMap) === 0) {
            http_response_code(422);
            echo json_encode(['status' => 'error', 'message' => 'This section has no enrolled students to mark.']);
            return;
        }

        try {
            $conn->beginTransaction();

            $findSessionStmt = $conn->prepare("
                SELECT session_id
                FROM attendance_sessions
                WHERE section_id = :section_id
                  AND attendance_date = :attendance_date
                LIMIT 1
            ");
            $findSessionStmt->execute([
                ':section_id' => $sectionId,
                ':attendance_date' => $attendanceDate
            ]);
            $sessionId = (int) ($findSessionStmt->fetchColumn() ?: 0);

            if ($sessionId > 0) {
                $updateSessionStmt = $conn->prepare("
                    UPDATE attendance_sessions
                    SET updated_by = :updated_by,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE session_id = :session_id
                ");
                $updateSessionStmt->execute([
                    ':updated_by' => $employeeId,
                    ':session_id' => $sessionId
                ]);
            } else {
                $insertSessionStmt = $conn->prepare("
                    INSERT INTO attendance_sessions (section_id, attendance_date, created_by, updated_by)
                    VALUES (:section_id, :attendance_date, :created_by, :updated_by)
                ");
                $insertSessionStmt->execute([
                    ':section_id' => $sectionId,
                    ':attendance_date' => $attendanceDate,
                    ':created_by' => $employeeId,
                    ':updated_by' => $employeeId
                ]);
                $sessionId = (int) $conn->lastInsertId();
            }

            $upsertStmt = $conn->prepare("
                INSERT INTO attendance_records (session_id, enrollment_details_id, student_id, status, marked_at)
                VALUES (:session_id, :enrollment_details_id, :student_id, :status, CURRENT_TIMESTAMP)
                ON DUPLICATE KEY UPDATE
                    student_id = VALUES(student_id),
                    status = VALUES(status),
                    marked_at = CURRENT_TIMESTAMP
            ");

            $seenIds = [];
            foreach ($records as $record) {
                $enrollmentDetailsId = intval($record['enrollment_details_id'] ?? 0);
                $status = strtolower(trim((string) ($record['status'] ?? 'absent')));

                if ($enrollmentDetailsId <= 0 || !isset($eligibleMap[$enrollmentDetailsId])) {
                    continue;
                }

                $status = $status === 'present' ? 'present' : 'absent';
                $seenIds[] = $enrollmentDetailsId;

                $upsertStmt->execute([
                    ':session_id' => $sessionId,
                    ':enrollment_details_id' => $enrollmentDetailsId,
                    ':student_id' => $eligibleMap[$enrollmentDetailsId] ?: null,
                    ':status' => $status
                ]);
            }

            if (count($seenIds) === 0) {
                $conn->rollBack();
                http_response_code(422);
                echo json_encode(['status' => 'error', 'message' => 'No valid students were submitted for attendance.']);
                return;
            }

            $placeholders = implode(',', array_fill(0, count($seenIds), '?'));
            $deleteSql = "DELETE FROM attendance_records
                          WHERE session_id = ?
                            AND enrollment_details_id NOT IN ({$placeholders})";
            $deleteStmt = $conn->prepare($deleteSql);
            $deleteStmt->execute(array_merge([$sessionId], $seenIds));

            $conn->commit();

            echo json_encode([
                'status' => 'success',
                'message' => 'Attendance saved successfully.'
            ]);
        } catch (Throwable $e) {
            if ($conn->inTransaction()) {
                $conn->rollBack();
            }

            http_response_code(500);
            echo json_encode([
                'status' => 'error',
                'message' => 'Unable to save attendance.'
            ]);
        }
    }
}

$operation = '';
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $operation = $_GET['operation'] ?? '';
    $json = $_GET['json'] ?? '';
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $operation = $_POST['operation'] ?? '';
    $json = $_POST['json'] ?? '';
}

$attendance = new AttendanceModule();
switch ($operation) {
    case 'getSectionAttendanceDashboard': $attendance->getSectionAttendanceDashboard(); break;
    case 'getAttendanceRoster': $attendance->getAttendanceRoster(); break;
    case 'saveAttendance': $attendance->saveAttendance($json); break;
    default:
        http_response_code(400);
        echo json_encode(['status' => 'error', 'message' => 'Invalid operation.']);
        break;
}
