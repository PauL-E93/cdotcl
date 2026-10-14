<?php
require_once __DIR__ . '/../security/AuthGuard.php';
AuthGuard::requireUser();
header('Content-Type: application/json; charset=UTF-8');
$conn = AuthGuard::connection();
require_once __DIR__ . '/../email_service.php';
require_once __DIR__ . '/../session_status_email_helper.php';
require_once __DIR__ . '/../notification_helper.php';
require_once __DIR__ . '/../enrollment_completion_helper.php';
require_once __DIR__ . '/../session_sequence_helper.php';
require_once __DIR__ . '/../tutorial_validity_helper.php';
ensureTutorialValiditySchema(AuthGuard::connection());

class BranchAdminSessionStatus
{
    private $conn;
    private $email;
    private $notifications;

    public function __construct(PDO $conn, ?EmailService $email = null, ?NotificationService $notifications = null)
    {
        $this->conn = $conn;
        $this->email = $email ?? new EmailService($conn);
        $this->notifications = $notifications ?? new NotificationService($conn);
    }

    public function handle(array $data): array
    {
        $role = preg_replace('/[\s_-]+/', ' ', strtolower(trim((string) ($_SESSION['user_role'] ?? ''))));
        $actorId = (int) ($_SESSION['employee_id'] ?? 0);
        $branchId = (int) ($_SESSION['branch_id'] ?? 0);
        if ($role !== 'branch admin' || $actorId <= 0 || $branchId <= 0) {
            return ['status' => 'error', 'message' => 'Unauthorized'];
        }

        $newStatus = $data['new_status'] ?? '';
        $allowedFrom = ['ongoing' => ['pending', 'confirmed'], 'done' => ['ongoing'], 'no-show' => ['pending', 'confirmed']];
        if (!is_string($newStatus) || !isset($allowedFrom[$newStatus])) {
            return ['status' => 'error', 'message' => 'Invalid session action'];
        }
        $statusLabel = ['ongoing' => 'Started', 'done' => 'Completed', 'no-show' => 'No-show'][$newStatus];
        $alreadyKey = ['ongoing' => 'already_ongoing', 'done' => 'already_done', 'no-show' => 'already_no_show'][$newStatus];

        $ids = $data['preference_ids'] ?? [];
        if (!is_array($ids)) {
            return ['status' => 'error', 'message' => 'Invalid schedule identifiers'];
        }
        if (!$ids && !empty($data['preference_id'])) $ids = [$data['preference_id']];
        foreach ($ids as $id) {
            if (!filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]])) {
                return ['status' => 'error', 'message' => 'Invalid schedule identifiers'];
            }
        }
        $ids = array_values(array_unique(array_map('intval', $ids)));
        $enrollmentId = (int) ($data['enrollment_details_id'] ?? 0);
        $date = trim((string) ($data['schedule_date'] ?? ''));
        if ($date !== '') {
            $parsedDate = DateTime::createFromFormat('!Y-m-d', $date);
            if (!$parsedDate || $parsedDate->format('Y-m-d') !== $date) {
                return ['status' => 'error', 'message' => 'Invalid schedule date'];
            }
        }
        if (!$ids && ($enrollmentId <= 0 || $date === '')) {
            return ['status' => 'error', 'message' => 'Missing schedule identifier'];
        }

        try {
            $this->conn->beginTransaction();
            $params = [$branchId];
            if ($ids) {
                $filter = 'eps.preference_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')';
                $params = array_merge($params, $ids);
            } else {
                $filter = 'eps.enrollment_details_id = ? AND eps.date = ?';
                $params = array_merge($params, [$enrollmentId, $date]);
            }
            $statement = $this->conn->prepare("SELECT eps.*, ed.validity_start_date, ed.validity_end_date, COALESCE(eps.substitute_teacher_id, ed.preferred_teacher) AS teacher_id,
                eh.student_id, eh.branch_id, s.email AS student_email,
                TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                CONCAT_WS(' ', t.first_name, t.last_name) AS teacher_name,
                p.name AS program_name, pt.type AS program_type, sub.subject_name, b.branch_name
                FROM enrollment_preferred_schedule eps
                JOIN enrollment_details ed ON ed.enrollment_details_id = eps.enrollment_details_id
                JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
                JOIN student s ON s.student_id = eh.student_id
                LEFT JOIN employee t ON t.employee_id = COALESCE(eps.substitute_teacher_id, ed.preferred_teacher)
                LEFT JOIN program p ON p.program_id = ed.program_id
                LEFT JOIN program_type pt ON pt.program_type_id = p.program_type
                LEFT JOIN subject sub ON sub.subject_id = ed.subject_id
                LEFT JOIN branch b ON b.branch_id = eh.branch_id
                WHERE eh.branch_id = ? AND {$filter}
                ORDER BY eps.start_time, eps.preference_id FOR UPDATE");
            $statement->execute($params);
            $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
            if (!$rows || ($ids && count($rows) !== count($ids))) {
                throw new DomainException('Schedule not found or it is outside your branch');
            }
            $schedule = $rows[0];
            $changedIds = [];
            foreach ($rows as $row) {
                if ((int) $row['enrollment_details_id'] !== (int) $schedule['enrollment_details_id'] || $row['date'] !== $schedule['date']) {
                    throw new DomainException('Select sessions from the same enrollment and date');
                }
                if ($row['status'] !== $newStatus && !in_array($row['status'], $allowedFrom[$newStatus], true)) {
                    throw new DomainException($newStatus === 'done'
                        ? 'Only an ongoing session can be marked as done'
                        : 'Only a pending or confirmed session can be started or marked as no-show');
                }
                if ($newStatus === 'ongoing' && $row['status'] !== $newStatus) assertTutorialSessionStart($row);
                if ($row['status'] !== $newStatus) $changedIds[] = (int) $row['preference_id'];
                if ($row['end_time'] > $schedule['end_time']) $schedule['end_time'] = $row['end_time'];
            }
            if (!$changedIds) {
                $this->conn->rollBack();
                return ['status' => 'success', 'message' => 'This session is already ' . strtolower($statusLabel) . '.',
                    'new_status' => $newStatus, $alreadyKey => true, 'email_sent' => false];
            }
            if (in_array($newStatus, ['ongoing', 'no-show'], true) && findEarlierUnresolvedSession(
                $this->conn, null, array_column($rows, 'preference_id'),
                $schedule['enrollment_details_id'], $schedule['date'], true
            )) {
                throw new DomainException($newStatus === 'no-show'
                    ? 'Complete all earlier sessions before marking this session as no-show.'
                    : 'Complete all earlier sessions before starting this session.');
            }
            $fromPlaceholders = implode(',', array_fill(0, count($allowedFrom[$newStatus]), '?'));
            $update = $this->conn->prepare("UPDATE enrollment_preferred_schedule SET status = ?
                WHERE preference_id IN (" . implode(',', array_fill(0, count($changedIds), '?')) . ")
                AND status IN ({$fromPlaceholders})");
            $update->execute(array_merge([$newStatus], $changedIds, $allowedFrom[$newStatus]));
            if ($update->rowCount() !== count($changedIds)) {
                throw new DomainException('The session status could not be updated');
            }
            $completion = syncEnrollmentCompletionStatus($this->conn, (int) $schedule['enrollment_details_id']);
            $this->conn->commit();
        } catch (Throwable $error) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            if (!($error instanceof DomainException)) error_log('Branch admin session failed: ' . $error->getMessage());
            return ['status' => 'error', 'message' => $error instanceof DomainException
                ? $error->getMessage() : 'Unable to update the session. Please try again.'];
        }

        // Delivery happens after commit so mail failure cannot undo attendance.
        try {
            $schedule['status'] = $newStatus;
            $this->notifications->notifyScheduleStatus($schedule, $newStatus, 'employee', $actorId);
        } catch (Throwable $error) {
            error_log('Branch admin notification failed: ' . $error->getMessage());
        }
        $emailSent = false;
        try {
            $emailSent = $this->sendEmail($schedule, $newStatus);
        } catch (Throwable $error) {
            error_log('Branch admin session email failed: ' . $error->getMessage());
        }
        $message = ['ongoing' => 'Session started', 'done' => 'Session marked as done', 'no-show' => 'Session marked as no-show'][$newStatus];
        return ['status' => 'success', 'new_status' => $newStatus, 'email_sent' => $emailSent,
            'enrollment_completed' => $completion['completed'], 'affected_rows' => count($changedIds),
            'message' => $emailSent ? $message . ' and the student was emailed successfully.'
                : $message . ', but the student email could not be sent.'];
    }

    private function sendEmail(array $schedule, string $newStatus): bool
    {
        if ($newStatus === 'no-show') {
            return sendSessionStatusEmail($this->email, $schedule, 'no-show');
        }
        $recipient = trim((string) ($schedule['student_email'] ?? ''));
        if (!filter_var($recipient, FILTER_VALIDATE_EMAIL)) return false;
        $date = date('F j, Y', strtotime($schedule['date']));
        $time = date('g:i A', strtotime($schedule['start_time']));
        if (!empty($schedule['end_time'])) $time .= ' - ' . date('g:i A', strtotime($schedule['end_time']));
        $houseBased = preg_replace('/[\s_-]+/', ' ', strtolower(trim((string) ($schedule['program_type'] ?? '')))) === 'house based';
        $title = ['ongoing' => 'Session Started', 'done' => 'Session Completed'][$newStatus];
        $notice = [
            'ongoing' => 'Your tutorial session has started and is now ongoing.',
            'done' => $houseBased ? 'Your house-based tutorial session has been completed.'
                : 'Your tutorial session has been completed. The student is now ready for pickup.',
        ][$newStatus];
        $closing = [
            'ongoing' => 'You will receive another notification when the session is completed.',
            'done' => $houseBased ? 'Thank you for completing today\'s house-based session.'
                : 'Please arrange to pick up the student from the tutorial center.',
        ][$newStatus];
        $details = ['Student' => $schedule['student_name'], 'Date' => $date, 'Time' => $time,
            'Program' => $schedule['program_name'] ?: 'Tutorial', 'Subject' => $schedule['subject_name'] ?: 'N/A',
            'Teacher' => $schedule['teacher_name'] ?: 'Assigned teacher', 'Center' => $schedule['branch_name'] ?: 'N/A',
            'Session Type' => $houseBased ? 'House Based' : 'Center',
            'Status' => ['ongoing' => 'Ongoing', 'done' => 'Done'][$newStatus]];
        $rows = '';
        foreach ($details as $label => $value) {
            $rows .= '<tr><th style="text-align:left;padding:8px">' . $label . '</th><td style="padding:8px">'
                . htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8') . '</td></tr>';
        }
        $body = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="background:#f8fafc;font-family:Arial,sans-serif;color:#334155">'
            . '<div style="max-width:600px;margin:auto;padding:24px"><h2 style="background:#ea9aa6;color:white;padding:22px;text-align:center">' . $title . '</h2>'
            . '<div style="background:white;padding:24px"><p>' . $notice . '</p>'
            . '<table style="width:100%;border-collapse:collapse">' . $rows . '</table>'
            . '<p>' . htmlspecialchars($closing, ENT_QUOTES, 'UTF-8') . '</p></div></div></body></html>';
        $plain = $notice . "\n";
        foreach ($details as $label => $value) $plain .= "{$label}: {$value}\n";
        $plain .= $closing;
        $subject = $newStatus === 'done' && !$houseBased ? 'Session Completed - Student Ready for Pickup' : $title;
        return $this->email->send($recipient, $subject . ' - ' . $date, $body, [
            'from_name' => 'CDO Tutor Session Notification', 'recipient_name' => $schedule['student_name'], 'alt_body' => $plain
        ]);
    }
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['status' => 'error', 'message' => 'Method not allowed']);
} else {
    $data = json_decode(file_get_contents('php://input'), true);
    echo json_encode((new BranchAdminSessionStatus($conn))->handle(is_array($data) ? $data : $_POST));
}
