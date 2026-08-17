<?php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

require_once __DIR__ . '/../notification_helper.php';

class BranchAdminSchedule {
    private function getBranchId() {
        $role = strtolower(trim((string) ($_SESSION['user_role'] ?? '')));
        $role = preg_replace('/[\s_-]+/', ' ', $role);
        $branchId = intval($_SESSION['branch_id'] ?? 0);

        if ($role !== 'branch admin' || $branchId <= 0) {
            throw new Exception('Unauthorized - No branch access');
        }

        return $branchId;
    }

    private function getBranchTeachers(PDO $conn, int $branchId): array {
        $sql = "SELECT e.employee_id,
                       TRIM(CONCAT_WS(' ', e.first_name, NULLIF(TRIM(e.middle_name), ''), e.last_name)) AS teacher_name
                FROM employee e
                INNER JOIN role r ON e.role_id = r.role_id
                WHERE e.branch_id = :branch_id
                  AND e.status = 'active'
                  AND LOWER(TRIM(r.role_name)) = 'teacher'
                ORDER BY e.first_name ASC, e.last_name ASC";

        $stmt = $conn->prepare($sql);
        $stmt->execute([':branch_id' => $branchId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /**
     * Fetch all active/pending schedules for students in the logged-in branch admin's branch
     */
    function getSchedules() {
        // Start session if not already started to access user_id
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }

        include "connection-pdo.php";

        try {
            $branchId = $this->getBranchId();

            $sql = "SELECT ed.enrollment_details_id,
                           eps.preference_id,
                           eps.date,
                           eps.day,
                           eps.start_time,
                           eps.end_time,
                           eps.status,
                           eps.is_notified,
                           p.name AS program_name,
                           sub.subject_name,
                           eh.student_id,
                           s.student_id_number,
                           TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                           t.employee_id AS teacher_id,
                           CONCAT(t.first_name, ' ', t.last_name) AS teacher_name,
                           b.branch_name,
                           b.branch_location
                    FROM enrollment_details ed
                    JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                    JOIN enrollment_preferred_schedule eps ON ed.enrollment_details_id = eps.enrollment_details_id
                    LEFT JOIN program p ON ed.program_id = p.program_id
                    LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                    LEFT JOIN student s ON eh.student_id = s.student_id
                    LEFT JOIN employee t ON ed.preferred_teacher = t.employee_id
                    LEFT JOIN branch b ON eh.branch_id = b.branch_id
                    WHERE eh.branch_id = :branch_id
                      AND (ed.preferred_teacher IS NULL OR t.branch_id = :branch_id)
                      AND ed.status IN ('active', 'pending' , 'enrolled', 'completed')
                    ORDER BY eps.date ASC, eps.start_time ASC";

            $stmt = $conn->prepare($sql);
            $stmt->execute([':branch_id' => $branchId]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            $teachers = $this->getBranchTeachers($conn, $branchId);

            // Formatting the output to match your original keys
            $schedules = [];
            foreach ($rows as $row) {
                $schedules[] = [
                    'preference_id' => $row['preference_id'],
                    'date' => $row['date'],
                    'day' => $row['day'],
                    'time' => $row['start_time'],
                    'endTime' => $row['end_time'] ?? '',
                    'program' => $row['program_name'],
                    'subject' => $row['subject_name'],
                    'student_id' => $row['student_id'],
                    'student_id_number' => $row['student_id_number'],
                    'student' => $row['student_name'],
                    'teacher_id' => $row['teacher_id'],
                    'preferred_teacher' => $row['teacher_id'],
                    'teacher' => $row['teacher_name'],
                    'branch' => $row['branch_name'],
                    'branch_location' => $row['branch_location'],
                    'enrollment_details_id' => $row['enrollment_details_id'],
                    'status' => $row['status'],
                    'isNotified' => (bool)$row['is_notified']
                ];
            }


            echo json_encode([
                'status' => 'success',
                'schedules' => $schedules,
                'teachers' => $teachers,
                'count' => count($schedules)
            ]);

        } catch (Exception $e) {
            echo json_encode([
                'status' => 'error',
                'message' => $e->getMessage()
            ]);
        }
    }

    function updateScheduleStatus() {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }

        include "connection-pdo.php";

        try {
            $branchId = $this->getBranchId();

            $data = json_decode(file_get_contents('php://input'), true) ?? $_POST;
            $preferenceId = $data['preference_id'] ?? null;
            $enrollmentDetailsId = $data['enrollment_details_id'] ?? null;
            $scheduleDate = $data['schedule_date'] ?? null;
            $newStatus = $data['new_status'] ?? null;

            if (!$newStatus || (!$preferenceId && (!$enrollmentDetailsId || !$scheduleDate))) {
                echo json_encode(['status' => 'error', 'message' => 'Missing preference_id or schedule identifier']);
                return;
            }

            $validStatuses = ['pending', 'confirmed', 'ongoing', 'done', 'cancelled', 'no-show'];
            if (!in_array($newStatus, $validStatuses)) {
                echo json_encode(['status' => 'error', 'message' => 'Invalid status']);
                return;
            }

            if ($preferenceId) {
                $verifySql = "SELECT 1 FROM enrollment_preferred_schedule eps 
                              JOIN enrollment_details ed ON eps.enrollment_details_id = ed.enrollment_details_id 
                              JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id 
                              WHERE eps.preference_id = :preference_id 
                              AND eh.branch_id = :branch_id";
                $verifyParams = [
                    ':preference_id' => $preferenceId,
                    ':branch_id' => $branchId
                ];
            } else {
                $verifySql = "SELECT 1 FROM enrollment_preferred_schedule eps 
                              JOIN enrollment_details ed ON eps.enrollment_details_id = ed.enrollment_details_id 
                              JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id 
                              WHERE eps.enrollment_details_id = :enrollment_details_id 
                                AND eps.date = :schedule_date 
                                AND eh.branch_id = :branch_id";
                $verifyParams = [
                    ':enrollment_details_id' => $enrollmentDetailsId,
                    ':schedule_date' => $scheduleDate,
                    ':branch_id' => $branchId
                ];
            }

            $verifyStmt = $conn->prepare($verifySql);
            $verifyStmt->execute($verifyParams);

            if (!$verifyStmt->fetch()) {
                echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
                return;
            }

            if ($preferenceId) {
                $sql = "UPDATE enrollment_preferred_schedule 
                        SET status = :new_status 
                        WHERE preference_id = :preference_id";
                $updateParams = [
                    ':new_status' => $newStatus,
                    ':preference_id' => $preferenceId
                ];
            } else {
                $sql = "UPDATE enrollment_preferred_schedule 
                        SET status = :new_status 
                        WHERE enrollment_details_id = :enrollment_details_id 
                          AND date = :schedule_date";
                $updateParams = [
                    ':new_status' => $newStatus,
                    ':enrollment_details_id' => $enrollmentDetailsId,
                    ':schedule_date' => $scheduleDate
                ];
            }

            $stmt = $conn->prepare($sql);
            $result = $stmt->execute($updateParams);
            $affectedRows = $stmt->rowCount();

            if ($result && $affectedRows > 0) {
                $notifications = new NotificationService($conn);
                $schedule = $notifications->getScheduleContext($preferenceId, $enrollmentDetailsId, $scheduleDate);
                $notifications->notifyScheduleStatus($schedule, $newStatus, 'employee', $_SESSION['employee_id'] ?? 0);

                echo json_encode([
                    'status' => 'success',
                    'message' => 'Schedule status updated successfully',
                    'new_status' => $newStatus,
                    'affected_rows' => $affectedRows
                ]);
            } else {
                echo json_encode(['status' => 'error', 'message' => 'No rows updated - schedule not found']);
            }
        } catch (Exception $e) {
            echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
        }
    }
}

// Router Logic
$operation = "";
if ($_SERVER['REQUEST_METHOD'] == 'GET') {
    $operation = $_GET['operation'] ?? "";
} else if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    if (strpos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== false) {
        $jsonData = json_decode(file_get_contents('php://input'), true);
        $operation = $jsonData['operation'] ?? "";
    } else {
        $operation = $_POST['operation'] ?? "";
    }
}

$scheduleHandler = new BranchAdminSchedule();

switch ($operation) {
    case "getSchedules":
        $scheduleHandler->getSchedules();
        break;
    case "updateScheduleStatus":
        $scheduleHandler->updateScheduleStatus();
        break;
    default:
        echo json_encode(["status" => "error", "message" => "Invalid Operation"]);
        break;
}
?>
