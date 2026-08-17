<?php
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

require 'PHPMailer/src/Exception.php';
require 'PHPMailer/src/PHPMailer.php';
require 'PHPMailer/src/SMTP.php';
include "admin/connection-pdo.php";
require_once __DIR__ . '/notification_helper.php';

class ScheduleConfirm {
    private $conn;

    public function __construct() {
        global $conn;
        $this->conn = $conn;
    }

    private function buildAppUrl($path = '') {
        $scriptName = $_SERVER['SCRIPT_NAME'] ?? '';
        $appBasePath = rtrim(str_replace('\\', '/', dirname($scriptName)), '/');

        if (substr($appBasePath, -4) === '/api') {
            $appBasePath = substr($appBasePath, 0, -4);
        }

        return rtrim($appBasePath, '/') . '/' . ltrim($path, '/');
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
            error_log("Confirmation email failed: " . $mail->ErrorInfo);
            return false;
        }
    }

    private function getSchedule($enrollmentDetailsId, $scheduleDate) {
        $sql = "SELECT
                    eps.enrollment_details_id,
                    eps.date,
                    eps.day,
                    eps.start_time,
                    eps.end_time,
                    eps.status,
                    s.student_id,
                    p.name AS program_name,
                    sub.subject_name,
                    TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                    s.email AS student_email,
                    CONCAT(t.first_name, ' ', t.last_name) AS teacher_name,
                    ed.preferred_teacher AS teacher_id,
                    t.email AS teacher_email,
                    b.branch_name,
                    eh.branch_id
                FROM enrollment_preferred_schedule eps
                JOIN enrollment_details ed ON eps.enrollment_details_id = ed.enrollment_details_id
                JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                JOIN student s ON eh.student_id = s.student_id
                LEFT JOIN program p ON ed.program_id = p.program_id
                LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                LEFT JOIN employee t ON ed.preferred_teacher = t.employee_id
                LEFT JOIN branch b ON eh.branch_id = b.branch_id
                WHERE eps.enrollment_details_id = :enrollment_id
                  AND eps.date = :schedule_date
                LIMIT 1";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute([
            ':enrollment_id' => $enrollmentDetailsId,
            ':schedule_date' => $scheduleDate
        ]);

        return $stmt->fetch(PDO::FETCH_ASSOC);
    }

    private function updateScheduleStatus($enrollmentDetailsId, $scheduleDate) {
        $sql = "UPDATE enrollment_preferred_schedule
                SET status = 'confirmed'
                WHERE enrollment_details_id = :enrollment_id
                  AND date = :schedule_date
                  AND status = 'pending'";
        $stmt = $this->conn->prepare($sql);
        return $stmt->execute([
            ':enrollment_id' => $enrollmentDetailsId,
            ':schedule_date' => $scheduleDate
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

    private function buildTeacherConfirmationEmail($schedule) {
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
                .header { background: #ea9aa6; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
                .content { background: #f8fafc; padding: 20px; border-radius: 0 0 8px 8px; }
                .details { background: white; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; margin-top: 16px; }
            </style>
        </head>
        <body>
            <div class='container'>
                <div class='header'>
                    <h2>Session Confirmed</h2>
                </div>
                <div class='content'>
                    <p>Hi {$schedule['teacher_name']},</p>
                    <p>The student has confirmed today’s session.</p>
                    <div class='details'>
                        <p><strong>Student:</strong> {$schedule['student_name']}</p>
                        <p><strong>Program:</strong> {$schedule['program_name']}</p>
                        <p><strong>Subject:</strong> {$schedule['subject_name']}</p>
                        <p><strong>Date:</strong> " . date('F j, Y', strtotime($schedule['date'])) . "</p>
                        <p><strong>Time:</strong> {$timeDisplay}</p>
                        <p><strong>Branch:</strong> {$schedule['branch_name']}</p>
                        <p><strong>Status:</strong> Confirmed</p>
                    </div>
                    <p>Please be ready for today’s session.</p>
                </div>
            </div>
        </body>
        </html>
        ";
    }

    private function buildBranchAdminConfirmationEmail($schedule, $branchAdminName) {
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
                .header { background: #ea9aa6; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
                .content { background: #f8fafc; padding: 20px; border-radius: 0 0 8px 8px; }
                .details { background: white; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; margin-top: 16px; }
            </style>
        </head>
        <body>
            <div class='container'>
                <div class='header'>
                    <h2>Session Confirmed</h2>
                </div>
                <div class='content'>
                    <p>Hi {$branchAdminName},</p>
                    <p>The following session has been confirmed for your branch.</p>
                    <div class='details'>
                        <p><strong>Student:</strong> {$schedule['student_name']}</p>
                        <p><strong>Program:</strong> {$schedule['program_name']}</p>
                        <p><strong>Subject:</strong> {$schedule['subject_name']}</p>
                        <p><strong>Teacher:</strong> {$schedule['teacher_name']}</p>
                        <p><strong>Date:</strong> " . date('F j, Y', strtotime($schedule['date'])) . "</p>
                        <p><strong>Time:</strong> {$timeDisplay}</p>
                        <p><strong>Branch:</strong> {$schedule['branch_name']}</p>
                        <p><strong>Status:</strong> Confirmed</p>
                    </div>
                </div>
            </div>
        </body>
        </html>
        ";
    }

    private function renderHtmlPage($title, $message, $isSuccess = true, $redirectPath = '') {
        $bgColor = $isSuccess ? '#ea9aa6' : '#ef4444';
        $redirectUrl = $redirectPath !== '' ? htmlspecialchars($this->buildAppUrl($redirectPath), ENT_QUOTES, 'UTF-8') : '';
        $redirectMeta = $redirectUrl !== '' ? "<meta http-equiv='refresh' content='30;url={$redirectUrl}'>" : '';
        $redirectNotice = $redirectUrl !== '' ? "<p class='redirect-note'>Redirecting to the login page in 30 seconds. <a href='{$redirectUrl}'>Continue now</a>.</p>" : '';
        $redirectScript = $redirectUrl !== '' ? "
            <script>
                window.setTimeout(function () {
                    window.location.replace('{$redirectUrl}');
                }, 30000);
            </script>
        " : '';

        return "
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset='UTF-8'>
            {$redirectMeta}
            <title>{$title}</title>
            <style>
                body { font-family: Arial, sans-serif; background: #f8fafc; color: #111827; margin: 0; padding: 0; }
                .page { max-width: 680px; margin: 60px auto; padding: 24px; background: white; border-radius: 18px; box-shadow: 0 20px 50px rgba(15,23,42,0.08); }
                .badge { width: 48px; height: 48px; border-radius: 14px; background: {$bgColor}; display: grid; place-items: center; color: white; font-size: 1.3rem; }
                .title { margin: 0; font-size: 1.4rem; }
                .message { margin-top: 18px; color: #475569; line-height: 1.75; }
                .redirect-note { margin-top: 18px; color: #475569; }
                .redirect-note a { color: #ea9aa6; font-weight: 600; text-decoration: none; }
            </style>
        </head>
        <body>
            <div class='page'>
                <div style='display:flex; align-items:center; gap:14px;'>
                    <div class='badge'>✓</div>
                    <div>
                        <h1 class='title'>{$title}</h1>
                    </div>
                </div>
                <p class='message'>{$message}</p>
                {$redirectNotice}
            </div>
            {$redirectScript}
        </body>
        </html>
        ";
    }

    public function run() {
        $enrollmentDetailsId = $_GET['enrollment_details_id'] ?? 0;
        $scheduleDate = $_GET['schedule_date'] ?? '';

        if (!$enrollmentDetailsId || !$scheduleDate) {
            echo $this->renderHtmlPage('Invalid Request', 'Missing schedule details.', false);
            return;
        }

        $schedule = $this->getSchedule($enrollmentDetailsId, $scheduleDate);
        if (!$schedule) {
            echo $this->renderHtmlPage('Schedule Not Found', 'Unable to locate the requested schedule.', false);
            return;
        }

        if ($schedule['status'] !== 'pending') {
            echo $this->renderHtmlPage('Already Confirmed', 'This session has already been confirmed or is no longer pending.', true);
            return;
        }

        if (!$this->updateScheduleStatus($enrollmentDetailsId, $scheduleDate)) {
            echo $this->renderHtmlPage('Confirmation Failed', 'Unable to update the schedule status. Please try again later.', false);
            return;
        }

        $notifications = new NotificationService($this->conn);
        $notifications->notifyScheduleStatus($schedule, 'confirmed', 'student', $schedule['student_id']);

        $teacherSent = false;
        if (!empty($schedule['teacher_email'])) {
            $subject = "Session Confirmed by Student - " . date('F j, Y', strtotime($schedule['date']));
            $message = $this->buildTeacherConfirmationEmail($schedule);
            $teacherSent = $this->sendEmail($schedule['teacher_email'], $subject, $message);
        }

        $branchAdmins = $this->getBranchAdmins($schedule['branch_id']);
        $adminSentCount = 0;
        foreach ($branchAdmins as $admin) {
            $subject = "Branch Session Confirmed - " . date('F j, Y', strtotime($schedule['date']));
            $message = $this->buildBranchAdminConfirmationEmail($schedule, $admin['branch_admin_name']);
            if ($this->sendEmail($admin['email'], $subject, $message)) {
                $adminSentCount++;
            }
        }

        $message = "Your session has been confirmed.";
        if ($teacherSent) {
            $message .= " The teacher has been notified.";
        }
        if ($adminSentCount > 0) {
            $message .= " Branch admin(s) have also been notified.";
        }

        echo $this->renderHtmlPage('Session Confirmed', $message, true, 'login.html');
    }
}

$confirm = new ScheduleConfirm();
$confirm->run();

