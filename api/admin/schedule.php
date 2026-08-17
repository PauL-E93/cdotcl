<?php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

require_once __DIR__ . '/../notification_helper.php';

class TeacherSchedule {
    private function getTeacherId() {
        $role = strtolower(trim((string) ($_SESSION['user_role'] ?? '')));
        $role = preg_replace('/[\s_-]+/', ' ', $role);
        $teacherId = intval($_SESSION['employee_id'] ?? 0);

        if ($role !== 'teacher' || $teacherId <= 0) {
            throw new Exception('Unauthorized');
        }

        return $teacherId;
    }
    
    /**
     * Fetch all active/pending schedules for students assigned to the logged-in teacher
     */
    function getSchedules() {
        // Start session if not already started to access user_id
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }

        include "connection-pdo.php";

        try {
            $teacherId = $this->getTeacherId();

$sql = "SELECT ed.enrollment_details_id,
                           ed.preferred_teacher,
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
                           b.branch_name
                    FROM enrollment_details ed
                    JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                    JOIN enrollment_preferred_schedule eps ON ed.enrollment_details_id = eps.enrollment_details_id
                    LEFT JOIN program p ON ed.program_id = p.program_id
                    LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                    LEFT JOIN student s ON eh.student_id = s.student_id
                    LEFT JOIN branch b ON eh.branch_id = b.branch_id
                    WHERE ed.preferred_teacher = :teacher_id
                      AND ed.status IN ('active', 'pending' , 'enrolled', 'completed')
                    ORDER BY eps.date ASC, eps.start_time ASC";

            $stmt = $conn->prepare($sql);
            $stmt->execute([':teacher_id' => $teacherId]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

            // Formatting the output to match your original keys
            $schedules = [];
            foreach ($rows as $row) {
                $schedules[] = [
                    'enrollment_details_id' => $row['enrollment_details_id'],
                    'preferred_teacher' => $row['preferred_teacher'],
                    'preference_id' => $row['preference_id'],
                    'date' => $row['date'],
                    'day' => $row['day'],
                    'start_time' => $row['start_time'],
                    'end_time' => $row['end_time'],
                    'status' => $row['status'],
                    'is_notified' => (bool)$row['is_notified'],
                    'program_name' => $row['program_name'],
                    'subject_name' => $row['subject_name'],
                    'student_id' => $row['student_id'],
                    'student_id_number' => $row['student_id_number'],
                    'student_name' => $row['student_name'],
                    'branch_name' => $row['branch_name']
                ];
            }


            echo json_encode([
                'status' => 'success',
                'schedules' => $schedules,
                'count' => count($schedules)
            ]);

        } catch (Exception $e) {
            echo json_encode([
                'status' => 'error',
                'message' => $e->getMessage()
            ]);
        }
    }

    /**
     * Update schedule status (pending -> confirmed -> ongoing -> done)
     */
    function updateScheduleStatus() {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }

        include "connection-pdo.php";

        try {
            $teacherId = $this->getTeacherId();

            // Get preference_id, enrollment_details_id, and new status from POST
            $data = json_decode(file_get_contents('php://input'), true) ?? $_POST;
            $preferenceId = $data['preference_id'] ?? null;
            $enrollmentDetailsId = $data['enrollment_details_id'] ?? null;
            $scheduleDate = $data['schedule_date'] ?? null;
            $newStatus = $data['new_status'] ?? null;

            if (!$newStatus || (!$preferenceId && (!$enrollmentDetailsId || !$scheduleDate))) {
                echo json_encode(['status' => 'error', 'message' => 'Missing preference_id or schedule identifier']);
                return;
            }

            // Validate status values
            $validStatuses = ['pending', 'confirmed', 'ongoing', 'done', 'cancelled', 'no-show'];
            if (!in_array($newStatus, $validStatuses)) {
                echo json_encode(['status' => 'error', 'message' => 'Invalid status']);
                return;
            }

            // Verify teacher authorization for this enrollment
            if ($preferenceId) {
                $verifySql = "SELECT ed.preferred_teacher 
                              FROM enrollment_details ed 
                              JOIN enrollment_preferred_schedule eps ON ed.enrollment_details_id = eps.enrollment_details_id
                              WHERE eps.preference_id = :preference_id AND ed.preferred_teacher = :teacher_id";
                $verifyParams = [
                    ':preference_id' => $preferenceId,
                    ':teacher_id' => $teacherId
                ];
            } else {
                $verifySql = "SELECT ed.preferred_teacher 
                              FROM enrollment_details ed 
                              JOIN enrollment_preferred_schedule eps ON ed.enrollment_details_id = eps.enrollment_details_id
                              WHERE eps.enrollment_details_id = :enrollment_details_id 
                                AND eps.date = :schedule_date 
                                AND ed.preferred_teacher = :teacher_id";
                $verifyParams = [
                    ':enrollment_details_id' => $enrollmentDetailsId,
                    ':schedule_date' => $scheduleDate,
                    ':teacher_id' => $teacherId
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
                $params = [
                    ':new_status' => $newStatus,
                    ':preference_id' => $preferenceId
                ];
            } else {
                $sql = "UPDATE enrollment_preferred_schedule 
                        SET status = :new_status
                        WHERE enrollment_details_id = :enrollment_details_id AND date = :schedule_date";
                $params = [
                    ':new_status' => $newStatus,
                    ':enrollment_details_id' => $enrollmentDetailsId,
                    ':schedule_date' => $scheduleDate
                ];
            }

            $stmt = $conn->prepare($sql);
            $result = $stmt->execute($params);
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
            echo json_encode([
                'status' => 'error',
                'message' => $e->getMessage()
            ]);
        }
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

$scheduleHandler = new TeacherSchedule();

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
