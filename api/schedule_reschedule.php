<?php
// filepath: c:\xampp\htdocs\tutorial_center\api\schedule_reschedule.php
header('Content-Type: application/json');
session_start();

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

require __DIR__ . '/PHPMailer/src/Exception.php';
require __DIR__ . '/PHPMailer/src/PHPMailer.php';
require __DIR__ . '/PHPMailer/src/SMTP.php';
include __DIR__ . "/admin/connection-pdo.php";
require_once __DIR__ . '/notification_helper.php';

class StudentReschedule {
    private $conn;
    private $rescheduleTokenSecret = 'cdo_tutor_reschedule_secret_2026';

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
        $studentId = $_SESSION['student_id'] ?? null;
        $employeeId = intval($_SESSION['employee_id'] ?? 0);
        $userRole = $this->normalizeRole($_SESSION['user_role'] ?? '');
        $token = $payload['token'] ?? null;

        $scheduleInfo = $this->getRescheduleData($enrollmentDetailsId, $originalDate);
        if (!$scheduleInfo) {
            return ['status' => 'error', 'message' => 'Schedule not found for rescheduling'];
        }

        if (!$studentId && !$employeeId) {
            if (empty($token) || !$this->verifyRescheduleToken($enrollmentDetailsId, $originalDate, $scheduleInfo['student_email'], $token)) {
                return ['status' => 'error', 'message' => 'User not authenticated'];
            }
        } elseif ($studentId) {
            if ($studentId !== (int)$scheduleInfo['student_id']) {
                return ['status' => 'error', 'message' => 'User not authorized to reschedule this session'];
            }
        } elseif (!$this->canEmployeeReschedule($scheduleInfo, $employeeId, $userRole)) {
            return ['status' => 'error', 'message' => 'User not authorized to reschedule this session'];
        }

        try {
            $this->conn->beginTransaction();

            $sql = "UPDATE enrollment_preferred_schedule
                    SET date = :new_date,
                        day = :new_day,
                        start_time = :new_start_time,
                        end_time = :new_end_time,
                        reschedule_reason = :reschedule_reason,
                        status = 'pending'
                    WHERE enrollment_details_id = :enrollment_id
                      AND date = :original_date";

            $stmt = $this->conn->prepare($sql);
            $stmt->execute([
                ':new_date' => $newSchedule['date'],
                ':new_day' => $newSchedule['day'],
                ':new_start_time' => $newSchedule['time'],
                ':new_end_time' => $newSchedule['endTime'],
                ':reschedule_reason' => $reason,
                ':enrollment_id' => $enrollmentDetailsId,
                ':original_date' => $originalDate
            ]);

            if ($stmt->rowCount() === 0) {
                $this->conn->rollBack();
                return ['status' => 'error', 'message' => 'Schedule not found for rescheduling'];
            }

            $this->conn->commit();
            $actorLabel = $studentId ? ($scheduleInfo['student_name'] ?? 'The student') : 'An administrator';
            $this->notifyReschedule($scheduleInfo, $newSchedule, $reason, $actorLabel);

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

    private function getRescheduleData($enrollmentDetailsId, $originalDate) {
        $sql = "SELECT
                    eps.date AS original_date,
                    eps.day AS original_day,
                    eps.start_time AS original_start_time,
                    eps.end_time AS original_end_time,
                    ed.enrollment_details_id,
                    ed.program_id,
                    ed.subject_id,
                    ed.preferred_teacher,
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
                LEFT JOIN employee t ON ed.preferred_teacher = t.employee_id
                LEFT JOIN branch b ON eh.branch_id = b.branch_id
                WHERE eps.enrollment_details_id = :enrollment_id
                  AND eps.date = :original_date
                LIMIT 1";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute([
            ':enrollment_id' => $enrollmentDetailsId,
            ':original_date' => $originalDate
        ]);

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

    private function verifyRescheduleToken($enrollmentDetailsId, $scheduleDate, $studentEmail, $token) {
        if (empty($token) || empty($studentEmail)) {
            return false;
        }
        $expected = hash_hmac('sha256', $enrollmentDetailsId . '|' . $scheduleDate . '|' . $studentEmail, $this->rescheduleTokenSecret);
        return hash_equals($expected, $token);
    }

    private function notifyReschedule($scheduleInfo, $newSchedule, $reason, $actorLabel = 'The student') {
        if (empty($scheduleInfo)) {
            return;
        }

        $teacherEmail = $scheduleInfo['teacher_email'] ?? '';
        $branchAdmins = $this->getBranchAdmins($scheduleInfo['branch_id']);
        $notifications = new NotificationService($this->conn);

        $subject = 'Session Rescheduled - ' . date('F j, Y', strtotime($newSchedule['date']));
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
        $mail = new PHPMailer(true);
        try {
            $mail->isSMTP();
            $mail->Host       = 'smtp.gmail.com';
            $mail->SMTPAuth   = true;
            $mail->Username   = 'espinosapaul810@gmail.com';
            $mail->Password   = 'yjds vbuo gxas knkm';
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
            $mail->Port       = 587;

            $mail->SMTPOptions = [
                'ssl' => [
                    'verify_peer' => false,
                    'verify_peer_name' => false,
                    'allow_self_signed' => true
                ]
            ];

            $mail->setFrom('espinosapaul810@gmail.com', 'CDO Tutor Schedule Reminder');
            $mail->addAddress($to);

            $mail->isHTML(true);
            $mail->Subject = $subject;
            $mail->Body    = $message;

            return $mail->send();
        } catch (Exception $e) {
            error_log('Reschedule email failed: ' . $e->getMessage());
            return false;
        }
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
