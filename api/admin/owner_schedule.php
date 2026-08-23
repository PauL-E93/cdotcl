<?php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

require_once __DIR__ . '/../notification_helper.php';

class OwnerSchedule {
    private function normalizeRole($role) {
        $role = strtolower(trim((string) $role));
        return preg_replace('/[\s_-]+/', ' ', $role);
    }

    private function requireOwnerAccess() {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }

        if ($this->normalizeRole($_SESSION['user_role'] ?? '') !== 'owner') {
            throw new Exception('Unauthorized');
        }
    }

    private function requireScheduleViewAccess() {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }

        $role = $this->normalizeRole($_SESSION['user_role'] ?? '');
        if (!in_array($role, ['owner', 'auditor'], true)) {
            throw new Exception('Unauthorized');
        }
    }

    function getSchedules() {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }

        include "connection-pdo.php";

        try {
            $this->requireScheduleViewAccess();

            $branchId = intval($_GET['branch_id'] ?? 0);
            $branchFilterSql = '';
            $params = [];

            if ($branchId > 0) {
                $branchFilterSql = ' AND eh.branch_id = :branch_id';
                $params[':branch_id'] = $branchId;
            }

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
                           TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                           ed.preferred_teacher,
                           CONCAT(t.first_name, ' ', t.last_name) AS teacher_name,
                           eh.branch_id,
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
                    WHERE ed.status IN ('active', 'pending', 'enrolled', 'completed')
                      {$branchFilterSql}
                    ORDER BY eps.date ASC, eps.start_time ASC, b.branch_name ASC";

            $stmt = $conn->prepare($sql);
            $stmt->execute($params);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

            $schedules = [];
            foreach ($rows as $row) {
                $schedules[] = [
                    'preference_id' => $row['preference_id'],
                    'enrollment_details_id' => $row['enrollment_details_id'],
                    'date' => $row['date'],
                    'day' => $row['day'],
                    'time' => $row['start_time'],
                    'endTime' => $row['end_time'] ?? '',
                    'program' => $row['program_name'],
                    'subject' => $row['subject_name'],
                    'student' => $row['student_name'],
                    'preferred_teacher' => $row['preferred_teacher'],
                    'teacher' => $row['teacher_name'],
                    'branch_id' => $row['branch_id'],
                    'branch' => $row['branch_name'],
                    'branch_location' => $row['branch_location'],
                    'status' => $row['status'],
                    'isNotified' => (bool) $row['is_notified']
                ];
            }

            $branchStmt = $conn->prepare("SELECT branch_id, branch_name, branch_location FROM branch ORDER BY branch_name ASC");
            $branchStmt->execute();
            $branches = $branchStmt->fetchAll(PDO::FETCH_ASSOC);

            echo json_encode([
                'status' => 'success',
                'schedules' => $schedules,
                'branches' => $branches,
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
            $this->requireOwnerAccess();

            $data = json_decode(file_get_contents('php://input'), true) ?? $_POST;
            $preferenceId = $data['preference_id'] ?? null;
            $preferenceIds = array_values(array_unique(array_filter(array_map('intval', (array)($data['preference_ids'] ?? [])))));
            $enrollmentDetailsId = $data['enrollment_details_id'] ?? null;
            $scheduleDate = $data['schedule_date'] ?? null;
            $newStatus = $data['new_status'] ?? null;

            if (!$newStatus || (!$preferenceId && !$preferenceIds && (!$enrollmentDetailsId || !$scheduleDate))) {
                echo json_encode(['status' => 'error', 'message' => 'Missing preference_id or schedule identifier']);
                return;
            }

            $validStatuses = ['pending', 'confirmed', 'ongoing', 'done', 'cancelled', 'no-show'];
            if (!in_array($newStatus, $validStatuses, true)) {
                echo json_encode(['status' => 'error', 'message' => 'Invalid status']);
                return;
            }

            if ($preferenceIds) {
                $idPlaceholders = [];
                $verifyParams = [
                    ':enrollment_details_id' => $enrollmentDetailsId,
                    ':schedule_date' => $scheduleDate
                ];
                foreach ($preferenceIds as $index => $id) {
                    $placeholder = ':merged_preference_' . $index;
                    $idPlaceholders[] = $placeholder;
                    $verifyParams[$placeholder] = $id;
                }
                $verifySql = "SELECT COUNT(*) FROM enrollment_preferred_schedule
                              WHERE enrollment_details_id = :enrollment_details_id
                                AND date = :schedule_date
                                AND preference_id IN (" . implode(',', $idPlaceholders) . ")";
            } elseif ($preferenceId) {
                $verifySql = "SELECT 1
                              FROM enrollment_preferred_schedule
                              WHERE preference_id = :preference_id";
                $verifyParams = [':preference_id' => $preferenceId];
            } else {
                $verifySql = "SELECT 1
                              FROM enrollment_preferred_schedule
                              WHERE enrollment_details_id = :enrollment_details_id
                                AND date = :schedule_date";
                $verifyParams = [
                    ':enrollment_details_id' => $enrollmentDetailsId,
                    ':schedule_date' => $scheduleDate
                ];
            }

            $verifyStmt = $conn->prepare($verifySql);
            $verifyStmt->execute($verifyParams);

            $scheduleFound = $preferenceIds
                ? (int)$verifyStmt->fetchColumn() === count($preferenceIds)
                : (bool)$verifyStmt->fetch();
            if (!$scheduleFound) {
                echo json_encode(['status' => 'error', 'message' => 'Schedule not found']);
                return;
            }

            if ($preferenceIds) {
                $idPlaceholders = [];
                $updateParams = [
                    ':new_status' => $newStatus,
                    ':update_enrollment_details_id' => $enrollmentDetailsId,
                    ':update_schedule_date' => $scheduleDate
                ];
                foreach ($preferenceIds as $index => $id) {
                    $placeholder = ':update_merged_preference_' . $index;
                    $idPlaceholders[] = $placeholder;
                    $updateParams[$placeholder] = $id;
                }
                $transitionFilter = match ($newStatus) {
                    'ongoing' => " AND status IN ('pending', 'confirmed')",
                    'done' => " AND status = 'ongoing'",
                    'no-show' => " AND status IN ('pending', 'confirmed')",
                    default => ''
                };
                $sql = "UPDATE enrollment_preferred_schedule
                        SET status = :new_status
                        WHERE enrollment_details_id = :update_enrollment_details_id
                          AND date = :update_schedule_date
                          AND preference_id IN (" . implode(',', $idPlaceholders) . "){$transitionFilter}";
            } elseif ($preferenceId) {
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
                $notificationPreferenceId = $preferenceId ?: ($preferenceIds[0] ?? null);
                $schedule = $notifications->getScheduleContext($notificationPreferenceId, $enrollmentDetailsId, $scheduleDate);
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

$scheduleHandler = new OwnerSchedule();

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
