<?php

header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

require 'PHPMailer/src/Exception.php';
require 'PHPMailer/src/PHPMailer.php';
require 'PHPMailer/src/SMTP.php';
include "admin/connection-pdo.php";
require_once __DIR__ . '/notification_helper.php';
require_once __DIR__ . '/app_url_helper.php';

class SendScheduleNotification {
    private $conn;
    private $notifications;

    public function __construct() {
        global $conn;
        $this->conn = $conn;
        $this->notifications = new NotificationService($this->conn);
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
            error_log("Email sending failed: " . $mail->ErrorInfo);
            return false;
        }
    }

    private function getSchedule($enrollmentDetailsId, $scheduleDate) {
        $role = strtolower(trim((string) ($_SESSION['user_role'] ?? '')));
        $role = preg_replace('/[\s_-]+/', ' ', $role);
        $accessSql = '';
        $params = [
            ':enrollment_id' => $enrollmentDetailsId,
            ':schedule_date' => $scheduleDate
        ];

        if ($role === 'teacher') {
            $employeeId = intval($_SESSION['employee_id'] ?? 0);
            if ($employeeId <= 0) {
                throw new \Exception('Unauthorized');
            }

            $accessSql = ' AND ed.preferred_teacher = :employee_id';
            $params[':employee_id'] = $employeeId;
        } elseif ($role === 'branch admin') {
            $branchId = intval($_SESSION['branch_id'] ?? 0);
            if ($branchId <= 0) {
                throw new \Exception('Unauthorized - No branch access');
            }

            $accessSql = ' AND eh.branch_id = :branch_id';
            $params[':branch_id'] = $branchId;
        } elseif (in_array($role, ['owner', 'secretary', 'auditor'], true)) {
            $employeeId = intval($_SESSION['employee_id'] ?? $_SESSION['user_id'] ?? 0);
            if ($employeeId <= 0) {
                throw new \Exception('Unauthorized');
            }
        } else {
            throw new \Exception('Unauthorized');
        }

        $sql = "SELECT
                    eps.enrollment_details_id,
                    eps.date,
                    eps.day,
                    eps.start_time,
                    eps.end_time,
                    eps.status,
                    eps.is_notified,
                    eh.student_id,
                    eh.branch_id,
                    p.name AS program_name,
                    sub.subject_name,
                    TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                    s.email AS student_email,
                    CONCAT(t.first_name, ' ', t.last_name) AS teacher_name,
                    ed.preferred_teacher AS teacher_id,
                    t.email AS teacher_email,
                    b.branch_name
                FROM enrollment_preferred_schedule eps
                JOIN enrollment_details ed ON eps.enrollment_details_id = ed.enrollment_details_id
                JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                LEFT JOIN program p ON ed.program_id = p.program_id
                LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                LEFT JOIN student s ON eh.student_id = s.student_id
                LEFT JOIN employee t ON ed.preferred_teacher = t.employee_id
                LEFT JOIN branch b ON eh.branch_id = b.branch_id
                WHERE eps.enrollment_details_id = :enrollment_id
                  AND eps.date = :schedule_date
                  {$accessSql}
                  AND (eps.status IS NULL OR eps.status NOT IN ('done', 'no-show', 'cancelled', 'completed'))
                LIMIT 1";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);

        return $stmt->fetch(PDO::FETCH_ASSOC);
    }

    private function buildRescheduleUrl($enrollmentDetailsId, $scheduleDate, $studentEmail) {
        $token = $this->generateRescheduleToken($enrollmentDetailsId, $scheduleDate, $studentEmail);
        return cdoBuildAppUrl('api/reschedule_confirm.php?enrollment_details_id=' . urlencode($enrollmentDetailsId) . '&schedule_date=' . urlencode($scheduleDate) . '&token=' . urlencode($token));
    }

    private function generateRescheduleToken($enrollmentDetailsId, $scheduleDate, $studentEmail) {
        $secret = 'cdo_tutor_reschedule_secret_2026';
        return hash_hmac('sha256', $enrollmentDetailsId . '|' . $scheduleDate . '|' . $studentEmail, $secret);
    }

    private function buildConfirmUrl($enrollmentDetailsId, $scheduleDate) {
        return cdoBuildAppUrl('api/schedule_confirm.php?enrollment_details_id=' . urlencode($enrollmentDetailsId) . '&schedule_date=' . urlencode($scheduleDate));
    }

    private function buildStudentEmailContent($schedule, $confirmUrl = '', $rescheduleUrl = '') {
        $timeDisplay = date('g:i A', strtotime($schedule['start_time']));
        $loginUrl = htmlspecialchars(cdoBuildAppUrl('login.html'), ENT_QUOTES, 'UTF-8');
        if (!empty($schedule['end_time'])) {
            $timeDisplay .= ' - ' . date('g:i A', strtotime($schedule['end_time']));
        }

        $confirmSection = '';
        if ($schedule['status'] === 'pending' && $confirmUrl) {
            $confirmSection = "
                <tr>
                    <td style='padding:20px; text-align:center;'>
                        <a href='{$confirmUrl}' style='display:inline-block; background:#ea9aa6; color:#ffffff; text-decoration:none; padding:14px 22px; border-radius:8px; font-weight:700;'>Confirm Today’s Session</a>
                    </td>
                </tr>
                <tr>
                    <td style='padding:0 20px 20px; text-align:center;'>
                        <a href='{$rescheduleUrl}' style='display:inline-block; color:#ea9aa6; text-decoration:none; font-weight:600;'>Request Reschedule</a>
                    </td>
                </tr>
                <tr>
                    <td style='padding:0 20px 20px; font-size:0.9rem; color:#475569; text-align:center;'>
                        If the button does not work, please login to the website and use the login button below.<br><br>
                        <a href='{$loginUrl}' style='display:inline-block; background:#ea9aa6; color:#ffffff; text-decoration:none; padding:10px 16px; border-radius:6px; font-weight:600;'>Login</a>
                    </td>
                </tr>
            ";
        }

        return "
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #ea9aa6; color: #fff; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
                .content { background: #f8fafc; padding: 20px; border-radius: 0 0 8px 8px; }
                .details { background: #ffffff; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; margin-top: 16px; }
            </style>
        </head>
        <body>
            <div class='container'>
                <div class='header'>
                    <h2>Schedule Reminder</h2>
                    <p>CDO Tutorial Center</p>
                </div>
                <div class='content'>
                    <p>Hi {$schedule['student_name']},</p>
                    <p>You have a scheduled session. Please confirm your attendance or request a reschedule.</p>
                    <div class='details'>
                        <p><strong>Program:</strong> {$schedule['program_name']}</p>
                        <p><strong>Subject:</strong> {$schedule['subject_name']}</p>
                        <p><strong>Teacher:</strong> {$schedule['teacher_name']}</p>
                        <p><strong>Branch:</strong> {$schedule['branch_name']}</p>
                        <p><strong>Date:</strong> " . date('F j, Y', strtotime($schedule['date'])) . " ({$schedule['day']})</p>
                        <p><strong>Time:</strong> {$timeDisplay}</p>
                        <p><strong>Status:</strong> " . ucfirst($schedule['status']) . "</p>
                    </div>

                    {$confirmSection}

                    <p>If you have questions, please contact the tutorial center administration.</p>
                    <p>Thank you,<br>CDO Tutorial Center Team</p>
                </div>
            </div>
        </body>
        </html>
        ";
    }

    private function buildTeacherEmailContent($schedule) {
        $timeDisplay = date('g:i A', strtotime($schedule['start_time']));
        if (!empty($schedule['end_time'])) {
            $timeDisplay .= ' - ' . date('g:i A', strtotime($schedule['end_time']));
        }

        return "
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #ea9aa6; color: #fff; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
                .content { background: #f8fafc; padding: 20px; border-radius: 0 0 8px 8px; }
                .details { background: #ffffff; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; margin-top: 16px; }
            </style>
        </head>
        <body>
            <div class='container'>
                <div class='header'>
                    <h2>Teaching Schedule Reminder</h2>
                    <p>CDO Tutorial Center</p>
                </div>
                <div class='content'>
                    <p>Hi {$schedule['teacher_name']},</p>
                    <p>The student has been sent a schedule reminder. Please wait for their confirmation.</p>
                    <div class='details'>
                        <p><strong>Program:</strong> {$schedule['program_name']}</p>
                        <p><strong>Subject:</strong> {$schedule['subject_name']}</p>
                        <p><strong>Student:</strong> {$schedule['student_name']}</p>
                        <p><strong>Branch:</strong> {$schedule['branch_name']}</p>
                        <p><strong>Date:</strong> " . date('F j, Y', strtotime($schedule['date'])) . " ({$schedule['day']})</p>
                        <p><strong>Time:</strong> {$timeDisplay}</p>
                        <p><strong>Status:</strong> " . ucfirst($schedule['status']) . "</p>
                    </div>
                    <p>Thank you,<br>CDO Tutorial Center Administration</p>
                </div>
            </div>
        </body>
        </html>
        ";
    }

    private function markScheduleNotified($enrollmentDetailsId, $scheduleDate) {
        $sql = "UPDATE enrollment_preferred_schedule
                SET is_notified = 1
                WHERE enrollment_details_id = :enrollment_id
                  AND date = :schedule_date";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([
            ':enrollment_id' => $enrollmentDetailsId,
            ':schedule_date' => $scheduleDate
        ]);
    }

    public function handle() {
        $payload = json_decode(file_get_contents('php://input'), true);
        if (!is_array($payload)) {
            return ['success' => false, 'message' => 'Invalid request body'];
        }

        $enrollmentDetailsId = $payload['enrollment_details_id'] ?? 0;
        $scheduleDate = $payload['schedule_date'] ?? '';
        if (!$enrollmentDetailsId || !$scheduleDate) {
            return ['success' => false, 'message' => 'Missing schedule data'];
        }

        try {
            $schedule = $this->getSchedule($enrollmentDetailsId, $scheduleDate);
        } catch (\Exception $e) {
            return ['success' => false, 'message' => $e->getMessage()];
        }

        if (!$schedule) {
            return ['success' => false, 'message' => 'Schedule not found'];
        }

        $recipients = [];
        $confirmUrl = '';
        $rescheduleUrl = '';
        if ($schedule['status'] === 'pending') {
            $confirmUrl = $this->buildConfirmUrl($schedule['enrollment_details_id'], $schedule['date']);
            $rescheduleUrl = $this->buildRescheduleUrl($schedule['enrollment_details_id'], $schedule['date'], $schedule['student_email']);
        }
        if (!empty($schedule['student_email'])) {
            $studentSubject = "Schedule Reminder - " . date('F j, Y', strtotime($schedule['date']));
            $studentMessage = $this->buildStudentEmailContent($schedule, $confirmUrl, $rescheduleUrl);

            if ($this->sendEmail($schedule['student_email'], $studentSubject, $studentMessage)) {
                $recipients[] = ['type' => 'student', 'email' => $schedule['student_email'], 'name' => $schedule['student_name']];
                $this->markScheduleNotified($schedule['enrollment_details_id'], $schedule['date']);
            }
        }

        if (!empty($schedule['teacher_email'])) {
            $teacherSubject = "Teaching Schedule Reminder - " . date('F j, Y', strtotime($schedule['date']));
            $teacherMessage = $this->buildTeacherEmailContent($schedule);

            if ($this->sendEmail($schedule['teacher_email'], $teacherSubject, $teacherMessage)) {
                $recipients[] = ['type' => 'teacher', 'email' => $schedule['teacher_email'], 'name' => $schedule['teacher_name']];
            }
        }

        $timeDisplay = date('g:i A', strtotime($schedule['start_time']));
        $dateDisplay = date('M j, Y', strtotime($schedule['date']));
        $message = "Reminder: {$schedule['student_name']}'s {$schedule['program_name']} session is scheduled for {$dateDisplay} at {$timeDisplay}.";
        $inAppRecipients = 0;
        $inAppRecipients += $this->notifications->notifyStudent($schedule['student_id'], 'Session Reminder', $message) ? 1 : 0;
        $inAppRecipients += $this->notifications->notifyEmployee($schedule['teacher_id'], 'Session Reminder', $message) ? 1 : 0;
        $inAppRecipients += $this->notifications->notifyRole('branch admin', 'Session Reminder', $message, $schedule['branch_id']);

        if ($inAppRecipients > 0) {
            $this->markScheduleNotified($schedule['enrollment_details_id'], $schedule['date']);
        }

        if (empty($recipients) && $inAppRecipients === 0) {
            return ['success' => false, 'message' => 'Notification could not be sent to any recipient'];
        }

        return [
            'success' => true,
            'message' => 'Notification sent successfully',
            'recipients' => $recipients,
            'in_app_recipients' => $inAppRecipients
        ];
    }
}

$handler = new SendScheduleNotification();
echo json_encode($handler->handle());
