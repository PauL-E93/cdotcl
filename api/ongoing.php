<?php
header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: *');

use PHPMailer\PHPMailer\Exception as MailException;
use PHPMailer\PHPMailer\PHPMailer;

require_once __DIR__ . '/PHPMailer/src/Exception.php';
require_once __DIR__ . '/PHPMailer/src/PHPMailer.php';
require_once __DIR__ . '/PHPMailer/src/SMTP.php';
require_once __DIR__ . '/admin/connection-pdo.php';
require_once __DIR__ . '/notification_helper.php';

class OngoingSession
{
    private $conn;

    public function __construct(PDO $conn)
    {
        $this->conn = $conn;
    }

    private function respond($status, $message, $extra = [], $httpStatus = 200)
    {
        http_response_code($httpStatus);
        echo json_encode(array_merge([
            'status' => $status,
            'message' => $message
        ], $extra));
    }

    private function getTeacherId()
    {
        $role = strtolower(trim((string) ($_SESSION['user_role'] ?? '')));
        $role = preg_replace('/[\s_-]+/', ' ', $role);
        $teacherId = (int) ($_SESSION['employee_id'] ?? 0);

        if ($role !== 'teacher' || $teacherId <= 0) {
            throw new RuntimeException('Unauthorized');
        }

        return $teacherId;
    }

    private function getRequestData()
    {
        $data = json_decode(file_get_contents('php://input'), true);
        if (!is_array($data)) {
            $data = $_POST;
        }

        return is_array($data) ? $data : [];
    }

    private function getScheduleForUpdate($preferenceId, $enrollmentDetailsId, $scheduleDate, $teacherId)
    {
        $params = [':teacher_id' => $teacherId];

        if ($preferenceId > 0) {
            $identifierSql = 'eps.preference_id = :preference_id';
            $params[':preference_id'] = $preferenceId;
        } else {
            $identifierSql = 'eps.enrollment_details_id = :enrollment_details_id AND eps.date = :schedule_date';
            $params[':enrollment_details_id'] = $enrollmentDetailsId;
            $params[':schedule_date'] = $scheduleDate;
        }

        $sql = "SELECT
                    eps.preference_id,
                    eps.enrollment_details_id,
                    eps.date,
                    eps.day,
                    eps.start_time,
                    eps.end_time,
                    eps.status,
                    ed.preferred_teacher AS teacher_id,
                    eh.student_id,
                    eh.branch_id,
                    p.name AS program_name,
                    pt.type AS program_type,
                    sub.subject_name,
                    TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                    s.email AS student_email,
                    TRIM(CONCAT_WS(' ', t.first_name, t.last_name)) AS teacher_name,
                    b.branch_name
                FROM enrollment_preferred_schedule eps
                INNER JOIN enrollment_details ed ON ed.enrollment_details_id = eps.enrollment_details_id
                INNER JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
                INNER JOIN student s ON s.student_id = eh.student_id
                LEFT JOIN program p ON p.program_id = ed.program_id
                LEFT JOIN program_type pt ON pt.program_type_id = p.program_type
                LEFT JOIN subject sub ON sub.subject_id = ed.subject_id
                LEFT JOIN employee t ON t.employee_id = ed.preferred_teacher
                LEFT JOIN branch b ON b.branch_id = eh.branch_id
                WHERE {$identifierSql}
                  AND ed.preferred_teacher = :teacher_id
                LIMIT 1
                FOR UPDATE";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    private function isHouseBased($programType)
    {
        $normalizedType = strtolower(trim((string) $programType));
        $normalizedType = preg_replace('/[\s_-]+/', ' ', $normalizedType);
        return $normalizedType === 'house based';
    }

    private function escape($value)
    {
        return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    }

    private function buildOngoingEmail($schedule, $isHouseBased)
    {
        $studentName = $this->escape($schedule['student_name'] ?: 'Student');
        $programName = $this->escape($schedule['program_name'] ?: 'Tutorial');
        $subjectName = $this->escape($schedule['subject_name'] ?: 'N/A');
        $teacherName = $this->escape($schedule['teacher_name'] ?: 'Assigned teacher');
        $branchName = $this->escape($schedule['branch_name'] ?: 'N/A');
        $mode = $isHouseBased ? 'House Based' : 'Center';
        $date = date('F j, Y', strtotime($schedule['date']));
        $time = date('g:i A', strtotime($schedule['start_time']));

        if (!empty($schedule['end_time'])) {
            $time .= ' - ' . date('g:i A', strtotime($schedule['end_time']));
        }

        $closingMessage = $isHouseBased
            ? 'You will receive another notification when the house-based session is completed.'
            : 'You will receive another notification when the session is completed and the student is ready for pickup.';

        return "
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset='UTF-8'>
            <style>
                body { margin: 0; padding: 0; background: #f8fafc; font-family: Arial, sans-serif; color: #334155; }
                .container { max-width: 600px; margin: 0 auto; padding: 24px; }
                .header { background: #ea9aa6; color: #ffffff; padding: 22px; border-radius: 10px 10px 0 0; text-align: center; }
                .header h2 { margin: 0; }
                .content { background: #ffffff; padding: 24px; border: 1px solid #e2e8f0; border-top: 0; border-radius: 0 0 10px 10px; }
                .notice { background: #fdf2f4; border-left: 4px solid #ea9aa6; padding: 14px 16px; margin: 18px 0; font-weight: 600; }
                .details { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 18px 0; }
                .details p { margin: 7px 0; }
            </style>
        </head>
        <body>
            <div class='container'>
                <div class='header'><h2>Session Started</h2></div>
                <div class='content'>
                    <p>Hi {$studentName},</p>
                    <div class='notice'>Your tutorial session is now ongoing. The teacher has started the session.</div>
                    <div class='details'>
                        <p><strong>Program:</strong> {$programName}</p>
                        <p><strong>Subject:</strong> {$subjectName}</p>
                        <p><strong>Teacher:</strong> {$teacherName}</p>
                        <p><strong>Date:</strong> {$date}</p>
                        <p><strong>Time:</strong> {$time}</p>
                        <p><strong>Session Type:</strong> {$mode}</p>
                        <p><strong>Branch:</strong> {$branchName}</p>
                        <p><strong>Status:</strong> Ongoing</p>
                    </div>
                    <p>{$closingMessage}</p>
                </div>
            </div>
        </body>
        </html>";
    }

    private function sendOngoingEmail($schedule, $isHouseBased)
    {
        $mail = new PHPMailer(true);

        try {
            $mail->isSMTP();
            $mail->Host = 'smtp.gmail.com';
            $mail->SMTPAuth = true;
            $mail->Username = 'espinosapaul810@gmail.com';
            $mail->Password = 'yjds vbuo gxas knkm';
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
            $mail->Port = 587;
            $mail->CharSet = 'UTF-8';
            $mail->SMTPOptions = [
                'ssl' => [
                    'verify_peer' => false,
                    'verify_peer_name' => false,
                    'allow_self_signed' => true
                ]
            ];

            $mail->setFrom('espinosapaul810@gmail.com', 'CDO Tutor Session Notification');
            $mail->addAddress($schedule['student_email'], $schedule['student_name']);
            $mail->isHTML(true);
            $mail->Subject = 'Session Started - ' . date('F j, Y', strtotime($schedule['date']));
            $mail->Body = $this->buildOngoingEmail($schedule, $isHouseBased);
            $mail->AltBody = 'Your tutorial session is now ongoing. The teacher has started the session.';

            return $mail->send();
        } catch (MailException $e) {
            error_log('Ongoing session email failed: ' . $mail->ErrorInfo);
            return false;
        }
    }

    public function run()
    {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            $this->respond('error', 'Method not allowed', [], 405);
            return;
        }

        try {
            $teacherId = $this->getTeacherId();
            $data = $this->getRequestData();
            $preferenceId = (int) ($data['preference_id'] ?? 0);
            $enrollmentDetailsId = (int) ($data['enrollment_details_id'] ?? 0);
            $scheduleDate = trim((string) ($data['schedule_date'] ?? ''));

            if ($preferenceId <= 0 && ($enrollmentDetailsId <= 0 || $scheduleDate === '')) {
                $this->respond('error', 'Missing schedule identifier', [], 422);
                return;
            }

            if ($scheduleDate !== '') {
                $date = DateTime::createFromFormat('Y-m-d', $scheduleDate);
                if (!$date || $date->format('Y-m-d') !== $scheduleDate) {
                    $this->respond('error', 'Invalid schedule date', [], 422);
                    return;
                }
            }

            $this->conn->beginTransaction();
            $schedule = $this->getScheduleForUpdate(
                $preferenceId,
                $enrollmentDetailsId,
                $scheduleDate,
                $teacherId
            );

            if (!$schedule) {
                $this->conn->rollBack();
                $this->respond('error', 'Schedule not found or you are not assigned to it', [], 404);
                return;
            }

            $currentStatus = strtolower((string) $schedule['status']);
            if ($currentStatus === 'ongoing') {
                $this->conn->rollBack();
                $this->respond('success', 'This session is already ongoing.', [
                    'new_status' => 'ongoing',
                    'already_ongoing' => true,
                    'email_sent' => false
                ]);
                return;
            }

            if (!in_array($currentStatus, ['pending', 'confirmed'], true)) {
                $this->conn->rollBack();
                $this->respond('error', 'Only a pending or confirmed session can be started.', [], 409);
                return;
            }

            $update = $this->conn->prepare(
                "UPDATE enrollment_preferred_schedule
                 SET status = 'ongoing'
                 WHERE preference_id = :preference_id
                   AND status IN ('pending', 'confirmed')"
            );
            $update->execute([':preference_id' => $schedule['preference_id']]);

            if ($update->rowCount() !== 1) {
                throw new RuntimeException('The session status could not be updated.');
            }

            $this->conn->commit();

            $notifications = new NotificationService($this->conn);
            $schedule['status'] = 'ongoing';
            $notifications->notifyScheduleStatus($schedule, 'ongoing', 'employee', $teacherId);

            $isHouseBased = $this->isHouseBased($schedule['program_type']);
            $emailSent = false;

            if (!empty($schedule['student_email']) && filter_var($schedule['student_email'], FILTER_VALIDATE_EMAIL)) {
                $emailSent = $this->sendOngoingEmail($schedule, $isHouseBased);
            } else {
                error_log('Ongoing session email skipped: student email is missing or invalid.');
            }

            $message = $emailSent
                ? 'Session started and the student was emailed successfully.'
                : 'Session started, but the student email could not be sent.';

            $this->respond('success', $message, [
                'new_status' => 'ongoing',
                'email_sent' => $emailSent,
                'session_type' => $isHouseBased ? 'House Based' : 'Center'
            ]);
        } catch (RuntimeException $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }

            $httpStatus = $e->getMessage() === 'Unauthorized' ? 401 : 400;
            $this->respond('error', $e->getMessage(), [], $httpStatus);
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }

            error_log('Ongoing session failed: ' . $e->getMessage());
            $this->respond('error', 'Unable to start the session. Please try again.', [], 500);
        }
    }
}

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$ongoingSession = new OngoingSession($conn);
$ongoingSession->run();
