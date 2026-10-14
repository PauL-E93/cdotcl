<?php
require_once __DIR__ . '/security/AuthGuard.php';
require_once __DIR__ . '/security/ScheduleActionToken.php';
AuthGuard::user();
require_once __DIR__ . '/tutorial_validity_helper.php';
ensureTutorialValiditySchema(AuthGuard::connection());

// filepath: c:\xampp\htdocs\tutorial_center\api\schedule_reschedule.php
header('Content-Type: application/json');
if (session_status() === PHP_SESSION_NONE) session_start();

include __DIR__ . "/admin/connection-pdo.php";
require_once __DIR__ . '/email_service.php';
require_once __DIR__ . '/notification_helper.php';
require_once __DIR__ . '/enrollment_completion_helper.php';

class StudentReschedule {
    private $conn;

    public function __construct() {
        global $conn;
        $this->conn = $conn;
    }

    public function submitRescheduleRequest($payload) {
        if (!isset($payload['original_enrollment_details_id']) || !isset($payload['new_schedules']) || !is_array($payload['new_schedules']) || count($payload['new_schedules']) === 0) {
            return ['status' => 'error', 'message' => 'Missing required data'];
        }

        $enrollmentDetailsId = (int)$payload['original_enrollment_details_id'];
        $originalDate = $payload['original_date'];
        $newSchedule = $payload['new_schedules'][0];
        $reason = $payload['reason'] ?? '';
        $sessionCount = max(1, (int)($payload['session_count'] ?? 1));
        $preferenceIds = array_values(array_unique(array_filter(array_map('intval', (array)($payload['original_preference_ids'] ?? [])))));
        if ($preferenceIds && count($preferenceIds) !== $sessionCount) {
            return ['status' => 'error', 'message' => 'The selected time blocks do not match this meeting.'];
        }
        $studentId = $_SESSION['student_id'] ?? null;
        $employeeId = intval($_SESSION['employee_id'] ?? 0);
        $userRole = $this->normalizeRole($_SESSION['user_role'] ?? '');
        $token = $payload['token'] ?? null;

        $scheduleInfo = $this->getRescheduleData($enrollmentDetailsId, $originalDate, $preferenceIds[0] ?? null);
        if (!$scheduleInfo) {
            return ['status' => 'error', 'message' => 'Schedule not found for rescheduling'];
        }

        if (!$studentId && !$employeeId) {
            if (empty($token) || !$this->verifyRescheduleToken($enrollmentDetailsId, $originalDate,
                $scheduleInfo['student_email'], $payload['expires'] ?? null, $token)) {
                return ['status' => 'error', 'message' => 'User not authenticated'];
            }
        } elseif ($studentId) {
            if ($studentId !== (int)$scheduleInfo['student_id']) {
                return ['status' => 'error', 'message' => 'User not authorized to reschedule this session'];
            }
        } elseif (!$this->canEmployeeReschedule($scheduleInfo, $employeeId, $userRole)) {
            return ['status' => 'error', 'message' => 'User not authorized to reschedule this session'];
        }

        $actorLabel = $studentId || !$employeeId
            ? ($scheduleInfo['student_name'] ?? 'The student')
            : $this->employeeRescheduleLabel($userRole, $scheduleInfo);
        $isEmployeeAction = !$studentId && $employeeId > 0;

        try {
            $this->conn->beginTransaction();
            assertTutorialReschedule($this->conn, (int) $enrollmentDetailsId, (string) ($newSchedule['date'] ?? ''));

            if ($studentId || !$employeeId) {
                $statusSql = "SELECT status FROM enrollment_preferred_schedule WHERE enrollment_details_id = ? AND date = ?";
                $statusParams = [$enrollmentDetailsId, $originalDate];
                if ($preferenceIds) {
                    $statusSql .= ' AND preference_id IN (' . implode(',', array_fill(0, count($preferenceIds), '?')) . ')';
                    $statusParams = array_merge($statusParams, $preferenceIds);
                }
                $statusCheck = $this->conn->prepare($statusSql . ' FOR UPDATE');
                $statusCheck->execute($statusParams);
                foreach ($statusCheck->fetchAll(PDO::FETCH_COLUMN) as $status) {
                    if (preg_match('/^no[\s_-]*show$/i', trim((string)$status))) {
                        $this->conn->rollBack();
                        return ['status' => 'error', 'message' => 'No-show sessions cannot be rescheduled.'];
                    }
                }
            }

            if (count($preferenceIds) === $sessionCount) {
                $startTimestamp = strtotime((string)($newSchedule['time'] ?? ''));
                $endTimestamp = strtotime((string)($newSchedule['endTime'] ?? ''));
                if ($startTimestamp === false || $endTimestamp === false || $endTimestamp <= $startTimestamp || ($sessionCount > 1 && $endTimestamp - $startTimestamp !== $sessionCount * 3600)) {
                    $this->conn->rollBack();
                    return ['status' => 'error', 'message' => "The merged meeting must remain exactly {$sessionCount} hours."];
                }

                $placeholders = implode(',', array_fill(0, count($preferenceIds), '?'));
                $verify = $this->conn->prepare("SELECT eps.preference_id, COALESCE(eps.substitute_teacher_id, ed.preferred_teacher) AS teacher_id FROM enrollment_preferred_schedule eps JOIN enrollment_details ed ON ed.enrollment_details_id = eps.enrollment_details_id WHERE eps.enrollment_details_id = ? AND eps.date = ? AND eps.preference_id IN ({$placeholders}) ORDER BY eps.start_time ASC FOR UPDATE");
                $verify->execute(array_merge([$enrollmentDetailsId, $originalDate], $preferenceIds));
                $verifiedRows = $verify->fetchAll(PDO::FETCH_ASSOC);
                $verifiedIds = array_map('intval', array_column($verifiedRows, 'preference_id'));
                foreach ($verifiedRows as $row) {
                    if ($userRole === 'teacher' && (int)$row['teacher_id'] !== $employeeId) {
                        $this->conn->rollBack();
                        return ['status' => 'error', 'message' => 'You are not assigned to every selected session.'];
                    }
                }
                if (count($verifiedIds) !== $sessionCount) {
                    $this->conn->rollBack();
                    return ['status' => 'error', 'message' => 'One or more sessions in this merged meeting could not be found.'];
                }

                $update = $this->conn->prepare("UPDATE enrollment_preferred_schedule
                    SET date = ?, day = ?, start_time = ?, end_time = ?, reschedule_reason = ?, status = 'pending'
                    WHERE preference_id = ?");
                foreach ($verifiedIds as $index => $preferenceId) {
                    $sessionStart = $startTimestamp + ($index * 3600);
                    $sessionEnd = $sessionCount === 1 ? $endTimestamp : $sessionStart + 3600;
                    $update->execute([
                        $newSchedule['date'], $newSchedule['day'], date('H:i:s', $sessionStart), date('H:i:s', $sessionEnd),
                        $reason, $preferenceId
                    ]);
                }

                syncEnrollmentCompletionStatus($this->conn, $enrollmentDetailsId);

                $this->conn->commit();
                $this->notifyReschedule($scheduleInfo, $newSchedule, $reason, $actorLabel, $isEmployeeAction);
                return ['status' => 'success', 'message' => 'Selected session rescheduled successfully'];
            }

            $sql = "UPDATE enrollment_preferred_schedule
                    SET date = :new_date,
                        day = :new_day,
                        start_time = :new_start_time,
                        end_time = :new_end_time,
                        reschedule_reason = :reschedule_reason,
                        status = 'pending'
                    WHERE enrollment_details_id = :enrollment_id
                      AND date = :original_date" . ($userRole === 'teacher' ? "
                      AND COALESCE(substitute_teacher_id, (SELECT ed_assignment.preferred_teacher FROM enrollment_details ed_assignment WHERE ed_assignment.enrollment_details_id = enrollment_preferred_schedule.enrollment_details_id)) = :assigned_teacher_id" : '');

            $stmt = $this->conn->prepare($sql);
            $stmt->execute([
                ':new_date' => $newSchedule['date'],
                ':new_day' => $newSchedule['day'],
                ':new_start_time' => $newSchedule['time'],
                ':new_end_time' => $newSchedule['endTime'],
                ':reschedule_reason' => $reason,
                ':enrollment_id' => $enrollmentDetailsId,
                ':original_date' => $originalDate
            ] + ($userRole === 'teacher' ? [':assigned_teacher_id' => $employeeId] : []));

            if ($stmt->rowCount() === 0) {
                $this->conn->rollBack();
                return ['status' => 'error', 'message' => 'Schedule not found for rescheduling'];
            }

            syncEnrollmentCompletionStatus($this->conn, $enrollmentDetailsId);

            $this->conn->commit();
            $this->notifyReschedule($scheduleInfo, $newSchedule, $reason, $actorLabel, $isEmployeeAction);

            return [
                'status' => 'success',
                'message' => 'Reschedule request submitted successfully'
            ];
        } catch (Exception $e) {
            $this->conn->rollBack();
            error_log('Reschedule error: ' . $e->getMessage());
            return ['status' => 'error', 'message' => 'Failed to submit reschedule request: ' . $e->getMessage()];
        }
    }

    private function getRescheduleData($enrollmentDetailsId, $originalDate, $preferenceId = null) {
        $sql = "SELECT
                    eps.date AS original_date,
                    eps.day AS original_day,
                    eps.start_time AS original_start_time,
                    eps.end_time AS original_end_time,
                    ed.enrollment_details_id,
                    ed.program_id,
                    ed.subject_id,
                    COALESCE(eps.substitute_teacher_id, ed.preferred_teacher) AS preferred_teacher,
                    eh.branch_id,
                    s.student_id AS student_id,
                    p.name AS program_name,
                    sub.subject_name,
                    CONCAT(t.first_name, ' ', t.last_name) AS teacher_name,
                    t.email AS teacher_email,
                    TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                    s.email AS student_email,
                    b.branch_name
                FROM enrollment_preferred_schedule eps
                JOIN enrollment_details ed ON eps.enrollment_details_id = ed.enrollment_details_id
                JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                JOIN student s ON eh.student_id = s.student_id
                LEFT JOIN program p ON ed.program_id = p.program_id
                LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                LEFT JOIN employee t ON COALESCE(eps.substitute_teacher_id, ed.preferred_teacher) = t.employee_id
                LEFT JOIN branch b ON eh.branch_id = b.branch_id
                WHERE eps.enrollment_details_id = :enrollment_id
                  AND eps.date = :original_date
                  " . ($preferenceId ? "AND eps.preference_id = :preference_id" : "") . "
                LIMIT 1";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute([
            ':enrollment_id' => $enrollmentDetailsId,
            ':original_date' => $originalDate
        ] + ($preferenceId ? [':preference_id' => $preferenceId] : []));

        return $stmt->fetch(PDO::FETCH_ASSOC);
    }

    private function normalizeRole($role) {
        return preg_replace('/[\s_-]+/', ' ', strtolower(trim((string)$role)));
    }

    private function canEmployeeReschedule($scheduleInfo, $employeeId, $userRole) {
        if ($employeeId <= 0) {
            return false;
        }

        if (in_array($userRole, ['owner', 'secretary'], true)) {
            return true;
        }

        if ($userRole === 'branch admin') {
            return intval($_SESSION['branch_id'] ?? 0) === intval($scheduleInfo['branch_id'] ?? 0);
        }

        if ($userRole === 'teacher') {
            return $employeeId === intval($scheduleInfo['preferred_teacher'] ?? 0);
        }

        return false;
    }

    private function verifyRescheduleToken($enrollmentDetailsId, $scheduleDate, $studentEmail, $expires, $token) {
        return ScheduleActionToken::validReschedule((int) $enrollmentDetailsId, (string) $scheduleDate,
            (string) $studentEmail, $expires, $token);
    }

    private function employeeRescheduleLabel($userRole, $scheduleInfo) {
        switch ($userRole) {
            case 'teacher':
                $teacherName = trim((string)($scheduleInfo['teacher_name'] ?? ''));
                return 'Your teacher' . ($teacherName !== '' ? ', ' . $teacherName : '');
            case 'owner':
                return 'The center owner';
            case 'secretary':
                return 'The secretary';
            case 'branch admin':
                return 'The branch admin';
            default:
                return 'An administrator';
        }
    }

    private function notifyReschedule($scheduleInfo, $newSchedule, $reason, $actorLabel = 'The student', $isEmployeeAction = false) {
        if (empty($scheduleInfo)) {
            return;
        }

        $teacherEmail = $scheduleInfo['teacher_email'] ?? '';
        $branchAdmins = $this->getBranchAdmins($scheduleInfo['branch_id']);
        $notifications = new NotificationService($this->conn);

        $subject = 'Session Rescheduled - ' . date('F j, Y', strtotime($newSchedule['date']));
        if ($isEmployeeAction && !empty($scheduleInfo['student_email'])) {
            $studentMessage = $this->buildStudentRescheduleEmail($scheduleInfo, $newSchedule, $reason, $actorLabel);
            $this->sendEmail($scheduleInfo['student_email'], $subject, $studentMessage);
        }
        $teacherMessage = $this->buildTeacherRescheduleEmail($scheduleInfo, $newSchedule, $reason, $actorLabel);
        $newTime = date('g:i A', strtotime($newSchedule['time']));
        $inAppMessage = "{$actorLabel} rescheduled the {$scheduleInfo['program_name']} session to " .
            date('M j, Y', strtotime($newSchedule['date'])) . " at {$newTime}.";

        $notifications->notifyEmployee($scheduleInfo['preferred_teacher'], 'Session Reschedule Requested', $inAppMessage);
        $notifications->notifyRole('branch admin', 'Session Reschedule Requested', $inAppMessage, $scheduleInfo['branch_id']);

        if (!empty($teacherEmail)) {
            $this->sendEmail($teacherEmail, $subject, $teacherMessage);
        }

        foreach ($branchAdmins as $admin) {
            $branchMessage = $this->buildBranchAdminRescheduleEmail($scheduleInfo, $newSchedule, $reason, $admin['branch_admin_name'], $actorLabel);
            $this->sendEmail($admin['email'], $subject, $branchMessage);
        }
    }

    private function buildStudentRescheduleEmail($scheduleInfo, $newSchedule, $reason, $actorLabel) {
        $escape = static function ($value) {
            return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        };
        $studentName = $escape($scheduleInfo['student_name'] ?? 'Student');
        $actorName = $escape($actorLabel);
        $teacherName = $escape($scheduleInfo['teacher_name'] ?? '');
        $programName = $escape($scheduleInfo['program_name'] ?? '');
        $subjectName = $escape($scheduleInfo['subject_name'] ?? '');
        $branchName = $escape($scheduleInfo['branch_name'] ?? '');
        $originalDate = date('F j, Y', strtotime($scheduleInfo['original_date']));
        $newDate = date('F j, Y', strtotime($newSchedule['date']));
        $originalTime = date('g:i A', strtotime($scheduleInfo['original_start_time']));
        if (!empty($scheduleInfo['original_end_time'])) {
            $originalTime .= ' - ' . date('g:i A', strtotime($scheduleInfo['original_end_time']));
        }
        $newTime = date('g:i A', strtotime($newSchedule['time']));
        if (!empty($newSchedule['endTime'])) {
            $newTime .= ' - ' . date('g:i A', strtotime($newSchedule['endTime']));
        }
        $reasonText = trim((string)$reason);
        $reasonHtml = $reasonText !== '' ? nl2br($escape($reasonText)) : 'No reason provided';

        return "<html><body style='font-family:Arial,sans-serif;color:#333'>
            <div style='max-width:600px;margin:0 auto;padding:20px'>
                <div style='background:#ea9aa6;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0'>
                    <h2>Session Rescheduled</h2>
                </div>
                <div style='background:#f8fafc;padding:20px;border-radius:0 0 8px 8px'>
                    <p>Hi {$studentName},</p>
                    <p>{$actorName} has rescheduled your session.</p>
                    <div style='background:white;padding:16px;border:1px solid #e2e8f0;border-radius:8px'>
                        <p><strong>Program:</strong> {$programName}</p>
                        <p><strong>Subject:</strong> {$subjectName}</p>
                        <p><strong>Teacher:</strong> {$teacherName}</p>
                        <p><strong>Original Date:</strong> {$originalDate}</p>
                        <p><strong>Original Time:</strong> {$originalTime}</p>
                        <p><strong>New Date:</strong> {$newDate}</p>
                        <p><strong>New Time:</strong> {$newTime}</p>
                        <p><strong>Branch:</strong> {$branchName}</p>
                        <p><strong>Reschedule Reason:</strong> {$reasonHtml}</p>
                    </div>
                    <p>Please update your calendar and attend at the new scheduled time.</p>
                </div>
            </div>
        </body></html>";
    }

    private function buildTeacherRescheduleEmail($scheduleInfo, $newSchedule, $reason, $actorLabel) {
        $newTime = date('g:i A', strtotime($newSchedule['time']));
        if (!empty($newSchedule['endTime'])) {
            $newTime .= ' - ' . date('g:i A', strtotime($newSchedule['endTime']));
        }

        $originalTime = date('g:i A', strtotime($scheduleInfo['original_start_time']));
        if (!empty($scheduleInfo['original_end_time'])) {
            $originalTime .= ' - ' . date('g:i A', strtotime($scheduleInfo['original_end_time']));
        }

        return "
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #ea9aa6; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
                .content { background: #f8fafc; padding: 20px; border-radius: 0 0 8px 8px; }
                .details { background: white; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; margin-top: 16px; }
            </style>
        </head>
        <body>
            <div class='container'>
                <div class='header'>
                    <h2>Session Rescheduled</h2>
                </div>
                <div class='content'>
                    <p>Hi {$scheduleInfo['teacher_name']},</p>
                    <p>{$actorLabel} updated the following session schedule.</p>
                    <div class='details'>
                        <p><strong>Student:</strong> {$scheduleInfo['student_name']}</p>
                        <p><strong>Program:</strong> {$scheduleInfo['program_name']}</p>
                        <p><strong>Subject:</strong> {$scheduleInfo['subject_name']}</p>
                        <p><strong>Original Date:</strong> " . date('F j, Y', strtotime($scheduleInfo['original_date'])) . "</p>
                        <p><strong>Original Time:</strong> {$originalTime}</p>
                        <p><strong>New Date:</strong> " . date('F j, Y', strtotime($newSchedule['date'])) . "</p>
                        <p><strong>New Time:</strong> {$newTime}</p>
                        <p><strong>Branch:</strong> {$scheduleInfo['branch_name']}</p>
                        <p><strong>Reschedule Reason:</strong> " . (!empty($reason) ? htmlspecialchars($reason) : 'No reason provided') . "</p>
                    </div>
                    <p>Please update your calendar and be ready for the new schedule.</p>
                </div>
            </div>
        </body>
        </html>
        ";
    }

    private function buildBranchAdminRescheduleEmail($scheduleInfo, $newSchedule, $reason, $branchAdminName, $actorLabel) {
        $newTime = date('g:i A', strtotime($newSchedule['time']));
        if (!empty($newSchedule['endTime'])) {
            $newTime .= ' - ' . date('g:i A', strtotime($newSchedule['endTime']));
        }

        $originalTime = date('g:i A', strtotime($scheduleInfo['original_start_time']));
        if (!empty($scheduleInfo['original_end_time'])) {
            $originalTime .= ' - ' . date('g:i A', strtotime($scheduleInfo['original_end_time']));
        }

        return "
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #ea9aa6; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
                .content { background: #f8fafc; padding: 20px; border-radius: 0 0 8px 8px; }
                .details { background: white; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; margin-top: 16px; }
            </style>
        </head>
        <body>
            <div class='container'>
                <div class='header'>
                    <h2>Branch Session Rescheduled</h2>
                </div>
                <div class='content'>
                    <p>Hi {$branchAdminName},</p>
                    <p>{$actorLabel} updated a session in your branch.</p>
                    <div class='details'>
                        <p><strong>Student:</strong> {$scheduleInfo['student_name']}</p>
                        <p><strong>Program:</strong> {$scheduleInfo['program_name']}</p>
                        <p><strong>Subject:</strong> {$scheduleInfo['subject_name']}</p>
                        <p><strong>Teacher:</strong> {$scheduleInfo['teacher_name']}</p>
                        <p><strong>Original Date:</strong> " . date('F j, Y', strtotime($scheduleInfo['original_date'])) . "</p>
                        <p><strong>Original Time:</strong> {$originalTime}</p>
                        <p><strong>New Date:</strong> " . date('F j, Y', strtotime($newSchedule['date'])) . "</p>
                        <p><strong>New Time:</strong> {$newTime}</p>
                        <p><strong>Branch:</strong> {$scheduleInfo['branch_name']}</p>
                        <p><strong>Reschedule Reason:</strong> " . (!empty($reason) ? htmlspecialchars($reason) : 'No reason provided') . "</p>
                    </div>
                    <p>Please note this rescheduled session in your branch calendar.</p>
                </div>
            </div>
        </body>
        </html>
        ";
    }

    private function sendEmail($to, $subject, $message) {
        return (new EmailService($this->conn))->send($to, $subject, $message, [
            'from_name' => 'CDO Tutor Schedule Reminder'
        ]);
    }

    private function getBranchAdmins($branchId) {
        $sql = "SELECT DISTINCT e.email,
                       CONCAT(e.first_name, ' ', e.last_name) AS branch_admin_name
                FROM employee e
                JOIN role r ON e.role_id = r.role_id
                WHERE e.branch_id = :branch_id
                  AND r.role_name IN ('branch admin', 'Branch Admin', 'Branch Administrator', 'Admin')
                  AND e.email IS NOT NULL";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':branch_id' => $branchId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function run() {
        $input = json_decode(file_get_contents('php://input'), true);
        $operation = $_GET['operation'] ?? $_POST['operation'] ?? $input['operation'] ?? null;

        if ($operation === 'submitRescheduleRequest') {
            echo json_encode($this->submitRescheduleRequest($input));
        } else {
            echo json_encode(['status' => 'error', 'message' => 'Invalid operation']);
        }
    }
}

$reschedule = new StudentReschedule();
$reschedule->run();
?>
