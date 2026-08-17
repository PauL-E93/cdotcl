<?php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

class StudentSession {
    private function normalizeRole($role) {
        $role = strtolower(trim((string) $role));
        return preg_replace('/[\s_-]+/', ' ', $role);
    }

    private function getAccessScope() {
        $role = $this->normalizeRole($_SESSION['user_role'] ?? '');

        if ($role === 'student') {
            $studentId = intval($_SESSION['student_id'] ?? $_SESSION['user_id'] ?? 0);
            if ($studentId <= 0) {
                throw new Exception('Unauthorized - Missing student account');
            }

            return [
                'role' => $role,
                'where' => 'eh.student_id = :student_id',
                'params' => [':student_id' => $studentId]
            ];
        }

        if ($role === 'branch admin') {
            $branchId = intval($_SESSION['branch_id'] ?? 0);
            if ($branchId <= 0) {
                throw new Exception('Branch admin account is not assigned to a branch.');
            }

            return [
                'role' => $role,
                'where' => 'eh.branch_id = :branch_id',
                'params' => [':branch_id' => $branchId]
            ];
        }

        if ($role === 'teacher') {
            $teacherId = intval($_SESSION['employee_id'] ?? 0);
            if ($teacherId <= 0) {
                throw new Exception('Teacher account is not assigned to an employee.');
            }

            return [
                'role' => $role,
                'where' => '(ed.preferred_teacher = :teacher_id OR sec.employee_id = :teacher_id)',
                'params' => [':teacher_id' => $teacherId]
            ];
        }

        if (in_array($role, ['owner', 'secretary', 'auditor'], true)) {
            return [
                'role' => $role,
                'where' => '1 = 1',
                'params' => []
            ];
        }

        throw new Exception('Unauthorized');
    }

    /**
     * Get all enrollments for the logged-in student
     */
    function getEnrollments() {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }

        include "../admin/connection-pdo.php";

        try {
            if (!isset($_SESSION['user_role'])) {
                echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
                return;
            }

            $scope = $this->getAccessScope();

            // Get all enrollments
            $sql = "SELECT DISTINCT ed.enrollment_details_id,
                           p.program_id,
                           p.name AS program_name,
                           p.program_type,
                           sub.subject_name,
                           COALESCE(
                               CONCAT(t.first_name, ' ', t.last_name),
                               CONCAT(section_teacher.first_name, ' ', section_teacher.last_name)
                           ) AS teacher_name,
                           TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                           b.branch_name,
                           ed.status
                    FROM enrollment_details ed
                    JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                    JOIN student s ON eh.student_id = s.student_id
                    LEFT JOIN sections sec ON ed.section_id = sec.section_id
                    LEFT JOIN program p ON ed.program_id = p.program_id
                    LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                    LEFT JOIN employee t ON ed.preferred_teacher = t.employee_id
                    LEFT JOIN employee section_teacher ON sec.employee_id = section_teacher.employee_id
                    LEFT JOIN branch b ON eh.branch_id = b.branch_id
                    WHERE {$scope['where']}
                      AND ed.status IN ('active', 'pending', 'enrolled', 'completed', 'session done')
                    ORDER BY ed.enrollment_details_id DESC";

            $stmt = $conn->prepare($sql);
            $stmt->execute($scope['params']);
            $enrollments = $stmt->fetchAll(PDO::FETCH_ASSOC);

            if (empty($enrollments)) {
                echo json_encode(['status' => 'error', 'message' => 'No enrollments found']);
                return;
            }

            $enrollmentList = [];
            foreach ($enrollments as $enrollment) {
                $label = $enrollment['program_name'] . ' - ' . ($enrollment['subject_name'] ?? 'No Subject');
                if ($scope['role'] !== 'student') {
                    $label = $enrollment['student_name'] . ' - ' . $label . ' - ' . ($enrollment['branch_name'] ?? 'No Branch');
                }

                $enrollmentList[] = [
                    'enrollment_details_id' => $enrollment['enrollment_details_id'],
                    'label' => $label,
                    'program_name' => $enrollment['program_name'],
                    'program_type' => $enrollment['program_type'],
                    'subject_name' => $enrollment['subject_name'],
                    'teacher_name' => $enrollment['teacher_name'],
                    'student_name' => $enrollment['student_name'],
                    'branch_name' => $enrollment['branch_name'],
                    'status' => $enrollment['status']
                ];
            }

            echo json_encode([
                'status' => 'success',
                'enrollments' => $enrollmentList
            ]);

        } catch (Exception $e) {
            echo json_encode([
                'status' => 'error',
                'message' => $e->getMessage()
            ]);
        }
    }

    /**
     * Fetch session details for a specific enrollment
     */
    function getSessionByEnrollment() {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }

        include "../admin/connection-pdo.php";

        try {
            if (!isset($_SESSION['user_role'])) {
                echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
                return;
            }

            $enrollmentDetailsId = intval($_GET['enrollment_details_id'] ?? 0);
            if ($enrollmentDetailsId <= 0) {
                echo json_encode(['status' => 'error', 'message' => 'Missing enrollment_details_id']);
                return;
            }

            $scope = $this->getAccessScope();

            // Verify the current role can access this enrollment.
            $verifySQL = "SELECT ed.enrollment_details_id 
                         FROM enrollment_details ed
                         JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                         LEFT JOIN sections sec ON ed.section_id = sec.section_id
                         WHERE ed.enrollment_details_id = :enrollment_details_id
                           AND {$scope['where']}";
            
            $verifyStmt = $conn->prepare($verifySQL);
            $verifyStmt->execute(array_merge(
                [':enrollment_details_id' => $enrollmentDetailsId],
                $scope['params']
            ));
            
            if (!$verifyStmt->fetch()) {
                echo json_encode(['status' => 'error', 'message' => 'Unauthorized access to this enrollment']);
                return;
            }

            // Get enrollment data (LEFT JOIN to handle no schedules)
            $sql = "SELECT ed.enrollment_details_id,
                           p.program_id,
                           p.name AS program_name,
                           p.total_units,
                           p.unit_type,
                           sub.subject_name,
                           COALESCE(
                               CONCAT(t.first_name, ' ', t.last_name),
                               CONCAT(section_teacher.first_name, ' ', section_teacher.last_name)
                           ) AS teacher_name,
                           TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                           b.branch_name,
                           eh.date_created,
                           eh.total_of_program,
                           ed.preferred_teacher,
                           eps.preference_id,
                           eps.date,
                           eps.day,
                           eps.start_time,
                           eps.end_time,
                           eps.status AS schedule_status,
                           eps.is_notified
                    FROM enrollment_details ed
                    JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                    JOIN student s ON eh.student_id = s.student_id
                    LEFT JOIN sections sec ON ed.section_id = sec.section_id
                    LEFT JOIN enrollment_preferred_schedule eps ON ed.enrollment_details_id = eps.enrollment_details_id
                    LEFT JOIN program p ON ed.program_id = p.program_id
                    LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                    LEFT JOIN employee t ON ed.preferred_teacher = t.employee_id
                    LEFT JOIN employee section_teacher ON sec.employee_id = section_teacher.employee_id
                    LEFT JOIN branch b ON eh.branch_id = b.branch_id
                    WHERE ed.enrollment_details_id = :enrollment_details_id
                    ORDER BY eps.date ASC, eps.start_time ASC
                    LIMIT 1";

            $stmt = $conn->prepare($sql);
            $stmt->execute([':enrollment_details_id' => $enrollmentDetailsId]);
            $sessionData = $stmt->fetch(PDO::FETCH_ASSOC);

            // Always proceed - show enrollment info even without schedules
            if (!$sessionData) {
                // Fallback: get just enrollment details without schedule
                $fallbackSql = "SELECT ed.enrollment_details_id,
                                       p.program_id,
                                       p.name AS program_name,
                                       p.total_units,
                                       p.unit_type,
                                       sub.subject_name,
                                       COALESCE(
                                           CONCAT(t.first_name, ' ', t.last_name),
                                           CONCAT(section_teacher.first_name, ' ', section_teacher.last_name)
                                       ) AS teacher_name,
                                       TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                                       b.branch_name,
                                       eh.date_created,
                                       eh.total_of_program
                                FROM enrollment_details ed
                                JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                                JOIN student s ON eh.student_id = s.student_id
                                LEFT JOIN sections sec ON ed.section_id = sec.section_id
                                LEFT JOIN program p ON ed.program_id = p.program_id
                                LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                                LEFT JOIN employee t ON ed.preferred_teacher = t.employee_id
                                LEFT JOIN employee section_teacher ON sec.employee_id = section_teacher.employee_id
                                LEFT JOIN branch b ON eh.branch_id = b.branch_id
                                WHERE ed.enrollment_details_id = :enrollment_details_id";
                
                $fallbackStmt = $conn->prepare($fallbackSql);
                $fallbackStmt->execute([':enrollment_details_id' => $enrollmentDetailsId]);
                $sessionData = $fallbackStmt->fetch(PDO::FETCH_ASSOC);
            }

            // Get all sessions for this enrollment to calculate progress
            $progressSql = "SELECT eps.status, COUNT(*) as count
                           FROM enrollment_preferred_schedule eps
                           WHERE eps.enrollment_details_id = :enrollment_details_id
                           GROUP BY eps.status";
            
            $progressStmt = $conn->prepare($progressSql);
            $progressStmt->execute([':enrollment_details_id' => $enrollmentDetailsId]);
            $progressData = $progressStmt->fetchAll(PDO::FETCH_ASSOC);

            $totalSessions = 0;
            $completedSessions = 0;
            $hasSchedules = !empty($progressData);

            foreach ($progressData as $row) {
                $totalSessions += $row['count'];
                $rowStatus = $row['status'];
                if ($rowStatus === 'done' || $rowStatus === 'no-show') $rowStatus = 'completed';
                if (in_array($rowStatus, ['completed'])) {
                    $completedSessions += $row['count'];
                }
            }

            // Fallback to program total_units if no schedules
            if (!$hasSchedules && isset($sessionData['total_units'])) {
                $totalSessions = (int)$sessionData['total_units'];
            }

            $currentSessionNum = $completedSessions + 1;
            $overallProgress = ($totalSessions > 0) ? round(($completedSessions / $totalSessions) * 100) : 0;

            // Get all sessions for timeline (or generate placeholders if none)
            $allSessionsSql = "SELECT eps.preference_id,
                                      eps.enrollment_details_id,
                                      eps.date,
                                      eps.day,
                                      eps.status,
                                      eps.is_notified,
                                      p.name AS program_name,
                                      sub.subject_name,
                                      ed.preferred_teacher,
                                      COALESCE(
                                          CONCAT(t.first_name, ' ', t.last_name),
                                          CONCAT(section_teacher.first_name, ' ', section_teacher.last_name)
                                      ) AS teacher_name,
                                      TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                                      b.branch_name,
                                      b.branch_location,
                                      CONCAT(TIME_FORMAT(eps.start_time, '%h:%i %p')) as start_time,
                                      CONCAT(TIME_FORMAT(eps.end_time, '%h:%i %p')) as end_time,
                                      eps.start_time AS start_time_raw,
                                      eps.end_time AS end_time_raw
                               FROM enrollment_preferred_schedule eps
                               JOIN enrollment_details ed ON eps.enrollment_details_id = ed.enrollment_details_id
                               JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                               JOIN student s ON eh.student_id = s.student_id
                               LEFT JOIN sections sec ON ed.section_id = sec.section_id
                               LEFT JOIN branch b ON eh.branch_id = b.branch_id
                               LEFT JOIN program p ON ed.program_id = p.program_id
                               LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                               LEFT JOIN employee t ON ed.preferred_teacher = t.employee_id
                               LEFT JOIN employee section_teacher ON sec.employee_id = section_teacher.employee_id
                               WHERE eps.enrollment_details_id = :enrollment_details_id
                               ORDER BY eps.date ASC, eps.start_time ASC";

            $allSessionsStmt = $conn->prepare($allSessionsSql);
            $allSessionsStmt->execute([':enrollment_details_id' => $enrollmentDetailsId]);
            $allSessions = $allSessionsStmt->fetchAll(PDO::FETCH_ASSOC);
            $lastSessionDate = !empty($allSessions) ? max(array_column($allSessions, 'date')) : null;

            // Build lessons array for timeline
            $lessons = [];
            if (empty($allSessions) && isset($sessionData['total_units'])) {
                // Generate placeholder lessons based on total_units
                $totalUnits = (int)$sessionData['total_units'];
                for ($i = 1; $i <= min($totalUnits, 12); $i++) {  // Limit to 12 for UI
                    $lessons[] = [
                        'id' => $i,
                        'title' => 'Session ' . $i,
                        'duration' => 'TBD',
                        'status' => 'pending',
                        'hasSchedule' => false
                    ];
                }
            } else {
                foreach ($allSessions as $index => $session) {
                    // Map schedule status directly to frontend-expected statuses
                    $status = $session['status'];
                    if ($status === 'done') {
                        $status = 'completed';
                    } elseif ($status === 'no-show') {
                        $status = 'no-show';
                    } elseif (!in_array($status, ['pending', 'confirmed', 'ongoing', 'in-progress', 'no-show'])) {
                        $status = 'pending';
                    }

                    $lessons[] = [
                        'id' => $index + 1,
                        'title' => 'Session ' . ($index + 1),
                        'duration' => $session['start_time'] . ' - ' . $session['end_time'],
                        'status' => $status,
                        'hasSchedule' => true,
                        'preference_id' => $session['preference_id'],
                        'enrollment_details_id' => $session['enrollment_details_id'],
                        'preferred_teacher' => $session['preferred_teacher'],
                        'date' => $session['date'],
                        'last_session_date' => $lastSessionDate,
                        'day' => $session['day'],
                        'time' => $session['start_time_raw'],
                        'endTime' => $session['end_time_raw'],
                        'program' => $session['program_name'],
                        'subject' => $session['subject_name'],
                        'teacher' => $session['teacher_name'],
                        'student' => $session['student_name'],
                        'branch' => $session['branch_name'],
                        'branch_location' => $session['branch_location'],
                        'isNotified' => (bool)$session['is_notified']
                    ];
                }
            }

            // Determine no schedules flag
            $noSchedules = empty($allSessions);

            // Format dates safely
            $startDateFormatted = $noSchedules ? 'Not scheduled' : (isset($sessionData['date']) ? (new DateTime($sessionData['date']))->format('M d, Y') : 'TBD');
            $enrollmentDate = new DateTime($sessionData['date_created']);
            $startTimeFormatted = $noSchedules ? 'Schedule your first session' : (isset($sessionData['date']) ? 'Next: ' . (new DateTime($sessionData['date'] . ' ' . $sessionData['start_time']))->format('M d, g:i A') : 'TBD');
            $timeRange = $noSchedules ? 'TBD' : ((isset($sessionData['start_time']) && isset($sessionData['end_time'])) ? (new DateTime($sessionData['start_time']))->format('g:i A') . ' - ' . (new DateTime($sessionData['end_time']))->format('g:i A') : 'TBD');
            $totalDuration = $noSchedules || !isset($sessionData['start_time']) || !isset($sessionData['end_time']) ? '~1h (typical)' : $this->calculateDuration($sessionData['start_time'], $sessionData['end_time']);
            $sessionStatus = $noSchedules ? 'pending' : ($sessionData['schedule_status'] ?? $sessionData['status'] ?? 'pending');

            $response = [
                'status' => 'success',
                'data' => [
                    'title' => $sessionData['program_name'] ?? 'Enrollment Progress',
                    'description' => $sessionData['program_name'] ? 'Progress tracking for ' . $sessionData['program_name'] . ($noSchedules ? '. No sessions scheduled yet.' : '') : 'Track your learning progress',
                    'studentName' => $sessionData['student_name'] ?? 'Student',
                    'currentLesson' => $currentSessionNum,
                    'totalLessons' => $totalSessions,
                    'instructor' => $sessionData['teacher_name'] ?? 'To be assigned',
                    'category' => $sessionData['subject_name'] ?? $sessionData['program_name'] ?? 'General',
                    'startTimeFormatted' => $startTimeFormatted,
                    'startDate' => $startDateFormatted,
                    'timeRange' => $timeRange,
                    'totalDuration' => $totalDuration,
                    'overallProgress' => $overallProgress,
                    'tags' => array_filter([
                        $sessionData['program_name'],
                        $sessionData['subject_name'],
                        $sessionData['branch_name']
                    ]),
                    'lessons' => $lessons,
                    'enrollmentDate' => $enrollmentDate->format('M d, Y'),
                    'sessionStatus' => $sessionStatus,
                    'enrollmentDetailsId' => $sessionData['enrollment_details_id'],
                    'noScheduledSessions' => $noSchedules
                ]
            ];

            echo json_encode($response);

        } catch (Exception $e) {
            echo json_encode([
                'status' => 'error',
                'message' => $e->getMessage()
            ]);
        }
    }

    /**
     * Calculate duration between two times
     */
    private function calculateDuration($startTime, $endTime) {
        try {
            $start = DateTime::createFromFormat('H:i:s', $startTime);
            $end = DateTime::createFromFormat('H:i:s', $endTime);
            
            if ($start && $end) {
                $interval = $start->diff($end);
                $hours = $interval->h;
                $minutes = $interval->i;
                
                if ($hours > 0 && $minutes > 0) {
                    return "{$hours}h {$minutes}m";
                } elseif ($hours > 0) {
                    return "{$hours}h";
                } else {
                    return "{$minutes}m";
                }
            }
        } catch (Exception $e) {
            return 'N/A';
        }
        return 'N/A';
    }

}

// Router Logic
$operation = "";
if ($_SERVER['REQUEST_METHOD'] == 'GET') {
    $operation = $_GET['operation'] ?? "";
} else if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    // Check if data is JSON (from axios)
    if (strpos($_SERVER['CONTENT_TYPE'], 'application/json') !== false) {
        $jsonData = json_decode(file_get_contents('php://input'), true);
        $operation = $jsonData['operation'] ?? "";
    } else {
        $operation = $_POST['operation'] ?? "";
    }
}

$sessionHandler = new StudentSession();

switch ($operation) {
    case "getEnrollments":
        $sessionHandler->getEnrollments();
        break;
    case "getSessionByEnrollment":
        $sessionHandler->getSessionByEnrollment();
        break;
    case "getCurrentSession":
        $sessionHandler->getSessionByEnrollment();
        break;
    default:
        echo json_encode(["status" => "error", "message" => "Invalid Operation"]);
        break;
}
?>
