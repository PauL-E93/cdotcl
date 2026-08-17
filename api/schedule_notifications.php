<?php

// schedule_notifications.php - Daily cron job to send schedule notifications at 6 AM

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

require 'PHPMailer/src/Exception.php';
require 'PHPMailer/src/PHPMailer.php';
require 'PHPMailer/src/SMTP.php';
require_once __DIR__ . '/notification_helper.php';
require_once __DIR__ . '/app_url_helper.php';

class ScheduleNotifications {
    private $conn;
    private $notifications;

    public function __construct() {
        include "admin/connection-pdo.php";
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

    private function getTodaysSchedules() {
        $today = date('Y-m-d');
        $sql = "SELECT
                    eps.enrollment_details_id,
                    eps.date,
                    eps.day,
                    eps.start_time,
                    eps.end_time,
                    eps.status,
                    eps.is_notified,
                    eh.student_id,
                    p.name AS program_name,
                    sub.subject_name,
                    TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                    s.email AS student_email,
                    CONCAT(t.first_name, ' ', t.last_name) AS teacher_name,
                    t.email AS teacher_email,
                    t.employee_id AS teacher_id,
                    b.branch_name,
                    eh.branch_id
                FROM enrollment_preferred_schedule eps
                JOIN enrollment_details ed ON eps.enrollment_details_id = ed.enrollment_details_id
                JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                LEFT JOIN program p ON ed.program_id = p.program_id
                LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                LEFT JOIN student s ON eh.student_id = s.student_id
                LEFT JOIN employee t ON ed.preferred_teacher = t.employee_id
                LEFT JOIN branch b ON eh.branch_id = b.branch_id
                WHERE eps.date = :today
                  AND eps.is_notified = 0
                  AND (eps.status IS NULL OR eps.status NOT IN ('done', 'no-show', 'cancelled', 'completed'))
                ORDER BY eps.start_time ASC";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':today' => $today]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
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

    private function buildConfirmUrl($enrollmentDetailsId, $scheduleDate) {
        return cdoBuildAppUrl('api/schedule_confirm.php?enrollment_details_id=' . urlencode($enrollmentDetailsId) . '&schedule_date=' . urlencode($scheduleDate));
    }

    private function buildStudentEmailContent($schedule, $confirmUrl = '') {
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
                        <a href='{$confirmUrl}' style='display:inline-block; background:#ea9aa6; color:#ffffff; text-decoration:none; padding:14px 22px; border-radius:8px; font-weight:700;'>Confirm Today's Session</a>
                    </td>
                </tr>
                <tr>
                    <td style='padding:0 20px 20px; text-align:center;'>
                        <a href='mailto:espinosapaul810@gmail.com?subject=Reschedule%20Request%20for%20{$schedule['date']}&body=Please%20help%20me%20reschedule%20my%20session%20on%20{$schedule['date']}.' style='display:inline-block; color:#ea9aa6; text-decoration:none; font-weight:600;'>Request Reschedule</a>
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
                    <p>You have a scheduled session today. Please confirm your attendance or request a reschedule.</p>
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

    private function buildTeacherSummaryEmail($teacherName, $schedules) {
        $total = count($schedules);
        $rows = $this->renderScheduleSummaryRows($schedules);

        return "
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; color: #333; }
                .container { max-width: 700px; margin: 0 auto; padding: 20px; }
                .header { background: #ea9aa6; color: #fff; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
                .content { background: #f8fafc; padding: 20px; border-radius: 0 0 8px 8px; }
                .summary { margin-bottom: 18px; }
                .session { background: #ffffff; padding: 16px; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 12px; }
            </style>
        </head>
        <body>
            <div class='container'>
                <div class='header'>
                    <h2>Today's Teaching Schedule Summary</h2>
                    <p>CDO Tutorial Center</p>
                </div>
                <div class='content'>
                    <p>Hi {$teacherName},</p>
                    <p>Here is your summary of scheduled sessions for today.</p>
                    <div class='summary'>
                        <p><strong>Date:</strong> " . date('F j, Y') . "</p>
                        <p><strong>Total Sessions:</strong> {$total}</p>
                    </div>
                    {$rows}
                    <p>Thank you,<br>CDO Tutorial Center Administration</p>
                </div>
            </div>
        </body>
        </html>
        ";
    }

    private function buildBranchAdminSummaryEmail($branchName, $schedules) {
        $total = count($schedules);
        $rows = $this->renderScheduleSummaryRows($schedules);

        return "
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; color: #333; }
                .container { max-width: 700px; margin: 0 auto; padding: 20px; }
                .header { background: #ea9aa6; color: #fff; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
                .content { background: #f8fafc; padding: 20px; border-radius: 0 0 8px 8px; }
                .summary { margin-bottom: 18px; }
                .session { background: #ffffff; padding: 16px; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 12px; }
            </style>
        </head>
        <body>
            <div class='container'>
                <div class='header'>
                    <h2>Today's Branch Schedule Summary</h2>
                    <p>CDO Tutorial Center</p>
                </div>
                <div class='content'>
                    <p>Hi Branch Admin,</p>
                    <p>Here's a summary of all scheduled sessions for your branch today.</p>
                    <div class='summary'>
                        <p><strong>Branch:</strong> {$branchName}</p>
                        <p><strong>Date:</strong> " . date('F j, Y') . "</p>
                        <p><strong>Total Sessions:</strong> {$total}</p>
                    </div>
                    {$rows}
                    <p>Thank you,<br>CDO Tutorial Center Administration</p>
                </div>
            </div>
        </body>
        </html>
        ";
    }

    private function renderScheduleSummaryRows($schedules) {
        $rows = '';
        foreach ($schedules as $schedule) {
            $timeDisplay = date('g:i A', strtotime($schedule['start_time']));
            if (!empty($schedule['end_time'])) {
                $timeDisplay .= ' - ' . date('g:i A', strtotime($schedule['end_time']));
            }

            $rows .= "
            <div class='session'>
                <p><strong>Program:</strong> {$schedule['program_name']}</p>
                <p><strong>Subject:</strong> {$schedule['subject_name']}</p>
                <p><strong>Teacher:</strong> {$schedule['teacher_name']}</p>
                <p><strong>Student:</strong> {$schedule['student_name']}</p>
                <p><strong>Time:</strong> {$timeDisplay}</p>
                <p><strong>Status:</strong> " . ucfirst($schedule['status']) . "</p>
            </div>
            ";
        }
        return $rows;
    }

    private function groupSchedulesByTeacher(array $schedules) {
        $groups = [];
        foreach ($schedules as $schedule) {
            if (empty($schedule['teacher_email'])) {
                continue;
            }
            $key = $schedule['teacher_email'];
            if (!isset($groups[$key])) {
                $groups[$key] = [
                    'teacher_name' => $schedule['teacher_name'],
                    'teacher_email' => $schedule['teacher_email'],
                    'schedules' => []
                ];
            }
            $groups[$key]['schedules'][] = $schedule;
        }
        return $groups;
    }

    private function groupSchedulesByBranch(array $schedules) {
        $groups = [];
        foreach ($schedules as $schedule) {
            if (empty($schedule['branch_id'])) {
                continue;
            }
            $key = $schedule['branch_id'];
            if (!isset($groups[$key])) {
                $groups[$key] = [
                    'branch_name' => $schedule['branch_name'],
                    'schedules' => []
                ];
            }
            $groups[$key]['schedules'][] = $schedule;
        }
        return $groups;
    }

    private function markSchedulesNotified(array $schedules) {
        foreach ($schedules as $schedule) {
            $this->markScheduleNotified($schedule['enrollment_details_id'], $schedule['date']);
        }
    }

    private function markScheduleNotified($enrollmentDetailsId, $scheduleDate) {
        $sql = "UPDATE enrollment_preferred_schedule
                SET is_notified = 1
                WHERE enrollment_details_id = :enrollment_id
                  AND date = :schedule_date";
        $stmt = $this->conn->prepare($sql);
        return $stmt->execute([
            ':enrollment_id' => $enrollmentDetailsId,
            ':schedule_date' => $scheduleDate
        ]);
    }

    public function sendDailyNotifications() {
        echo "=== STARTING DAILY NOTIFICATIONS ===\n";
        echo "Current date: " . date('Y-m-d H:i:s') . "\n";
        echo "Looking for schedules on: " . date('Y-m-d') . "\n\n";

        $schedules = $this->getTodaysSchedules();

        if (empty($schedules)) {
            echo "❌ No schedules to notify for today.\n";
            return;
        }

        echo "✓ Found " . count($schedules) . " schedule(s) to process.\n\n";

        $totalSent = 0;

        foreach ($schedules as $schedule) {
            echo "Processing student notification: {$schedule['student_name']} - {$schedule['subject_name']} at {$schedule['start_time']}\n";

            $confirmUrl = '';
            if ($schedule['status'] === 'pending') {
                $confirmUrl = $this->buildConfirmUrl($schedule['enrollment_details_id'], $schedule['date']);
            }

            if (!empty($schedule['student_email'])) {
                $studentSubject = "Schedule Reminder - " . date('F j, Y', strtotime($schedule['date']));
                $studentMessage = $this->buildStudentEmailContent($schedule, $confirmUrl);

                if ($this->sendEmail($schedule['student_email'], $studentSubject, $studentMessage)) {
                    echo "  ✓ Email sent to STUDENT: {$schedule['student_email']}\n";
                    $totalSent++;
                } else {
                    echo "  ✗ Failed to send email to STUDENT: {$schedule['student_email']}\n";
                }
            }

            $timeDisplay = date('g:i A', strtotime($schedule['start_time']));
            $dateDisplay = date('M j, Y', strtotime($schedule['date']));
            $message = "Reminder: {$schedule['student_name']}'s {$schedule['program_name']} session is scheduled for {$dateDisplay} at {$timeDisplay}.";
            $inAppSent = 0;
            $inAppSent += $this->notifications->notifyStudent($schedule['student_id'], 'Session Reminder', $message) ? 1 : 0;
            $inAppSent += $this->notifications->notifyEmployee($schedule['teacher_id'], 'Session Reminder', $message) ? 1 : 0;
            $inAppSent += $this->notifications->notifyRole('branch admin', 'Session Reminder', $message, $schedule['branch_id']);
            $totalSent += $inAppSent;
        }

        $teacherGroups = $this->groupSchedulesByTeacher($schedules);
        foreach ($teacherGroups as $group) {
            $teacherSubject = "Today's Teaching Schedule Summary - " . date('F j, Y');
            $teacherMessage = $this->buildTeacherSummaryEmail($group['teacher_name'], $group['schedules']);

            if ($this->sendEmail($group['teacher_email'], $teacherSubject, $teacherMessage)) {
                echo "✓ Summary email sent to TEACHER: {$group['teacher_email']}\n";
                $totalSent++;
            } else {
                echo "✗ Failed summary email to TEACHER: {$group['teacher_email']}\n";
            }
        }

        $branchGroups = $this->groupSchedulesByBranch($schedules);
        foreach ($branchGroups as $branchId => $group) {
            $admins = $this->getBranchAdmins($branchId);
            if (empty($admins)) {
                echo "⚠️ No branch admins found for branch {$group['branch_name']}.\n";
                continue;
            }

            $branchSubject = "Today's Branch Schedule Summary - " . date('F j, Y');
            $branchMessage = $this->buildBranchAdminSummaryEmail($group['branch_name'], $group['schedules']);

            foreach ($admins as $admin) {
                if ($this->sendEmail($admin['email'], $branchSubject, $branchMessage)) {
                    echo "✓ Summary email sent to BRANCH ADMIN: {$admin['email']}\n";
                    $totalSent++;
                } else {
                    echo "✗ Failed summary email to BRANCH ADMIN: {$admin['email']}\n";
                }
            }
        }

        if ($totalSent > 0) {
            $this->markSchedulesNotified($schedules);
            echo "✓ All schedules marked as notified.\n";
        }

        echo "=== DAILY NOTIFICATIONS COMPLETED ===\n";
    }
}

if (basename(__FILE__) == basename($_SERVER['PHP_SELF'])) {
    echo "Initializing ScheduleNotifications class...\n\n";
    $notifier = new ScheduleNotifications();
    $notifier->sendDailyNotifications();
}
?>
