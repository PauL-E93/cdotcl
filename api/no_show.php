<?php
require_once __DIR__ . '/security/AuthGuard.php';
AuthGuard::requireUser();
header('Content-Type: application/json; charset=UTF-8');
$conn = AuthGuard::connection();
require_once __DIR__ . '/email_service.php';
require_once __DIR__ . '/session_status_email_helper.php';
require_once __DIR__ . '/notification_helper.php';
require_once __DIR__ . '/enrollment_completion_helper.php';
require_once __DIR__ . '/session_sequence_helper.php';

class NoShowSession
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
        $teacherId = (int) ($_SESSION['employee_id'] ?? 0);
        if ($role !== 'teacher' || $teacherId <= 0) {
            return ['status' => 'error', 'message' => 'Unauthorized'];
        }

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
            $params = [$teacherId];
            if ($ids) {
                $filter = 'eps.preference_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')';
                $params = array_merge($params, $ids);
            } else {
                $filter = 'eps.enrollment_details_id = ? AND eps.date = ?';
                $params = array_merge($params, [$enrollmentId, $date]);
            }
            $statement = $this->conn->prepare("SELECT eps.*, COALESCE(eps.substitute_teacher_id, ed.preferred_teacher) AS teacher_id,
                eh.student_id, eh.branch_id, s.email AS student_email,
                TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                CONCAT_WS(' ', t.first_name, t.last_name) AS teacher_name,
                p.name AS program_name, sub.subject_name, b.branch_name
                FROM enrollment_preferred_schedule eps
                JOIN enrollment_details ed ON ed.enrollment_details_id = eps.enrollment_details_id
                JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
                JOIN student s ON s.student_id = eh.student_id
                LEFT JOIN employee t ON t.employee_id = COALESCE(eps.substitute_teacher_id, ed.preferred_teacher)
                LEFT JOIN program p ON p.program_id = ed.program_id
                LEFT JOIN subject sub ON sub.subject_id = ed.subject_id
                LEFT JOIN branch b ON b.branch_id = eh.branch_id
                WHERE COALESCE(eps.substitute_teacher_id, ed.preferred_teacher) = ? AND {$filter}
                ORDER BY eps.start_time, eps.preference_id FOR UPDATE");
            $statement->execute($params);
            $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
            if (!$rows || ($ids && count($rows) !== count($ids))) {
                throw new DomainException('Schedule not found or you are not assigned to it');
            }
            $schedule = $rows[0];
            $changedIds = [];
            foreach ($rows as $row) {
                if ((int) $row['enrollment_details_id'] !== (int) $schedule['enrollment_details_id'] || $row['date'] !== $schedule['date']) {
                    throw new DomainException('Select sessions from the same enrollment and date');
                }
                if (!in_array($row['status'], ['pending', 'confirmed', 'no-show'], true)) {
                    throw new DomainException('Only a pending or confirmed session can be marked as no-show');
                }
                if ($row['status'] !== 'no-show') $changedIds[] = (int) $row['preference_id'];
                if ($row['end_time'] > $schedule['end_time']) $schedule['end_time'] = $row['end_time'];
            }
            if (!$changedIds) {
                $this->conn->rollBack();
                return ['status' => 'success', 'message' => 'This session is already marked as no-show.',
                    'new_status' => 'no-show', 'already_no_show' => true, 'email_sent' => false];
            }
            if (findEarlierUnresolvedSession(
                $this->conn, null, array_column($rows, 'preference_id'),
                $schedule['enrollment_details_id'], $schedule['date'], true
            )) {
                throw new DomainException('Complete all earlier sessions before marking this session as no-show.');
            }
            $update = $this->conn->prepare("UPDATE enrollment_preferred_schedule SET status = 'no-show'
                WHERE preference_id IN (" . implode(',', array_fill(0, count($changedIds), '?')) . ")
                AND status IN ('pending', 'confirmed')");
            $update->execute($changedIds);
            if ($update->rowCount() !== count($changedIds)) {
                throw new DomainException('The session status could not be updated');
            }
            $completion = syncEnrollmentCompletionStatus($this->conn, (int) $schedule['enrollment_details_id']);
            $this->conn->commit();
        } catch (Throwable $error) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            if (!($error instanceof DomainException)) error_log('No-show session failed: ' . $error->getMessage());
            return ['status' => 'error', 'message' => $error instanceof DomainException
                ? $error->getMessage() : 'Unable to update the session. Please try again.'];
        }

        // Delivery happens after commit so mail failure cannot undo attendance.
        try {
            $this->notifications->notifyScheduleStatus($schedule, 'no-show', 'employee', $teacherId);
        } catch (Throwable $error) {
            error_log('No-show notification failed: ' . $error->getMessage());
        }
        $emailSent = false;
        try {
            $emailSent = $this->sendEmail($schedule);
        } catch (Throwable $error) {
            error_log('No-show email failed: ' . $error->getMessage());
        }
        return ['status' => 'success', 'new_status' => 'no-show', 'email_sent' => $emailSent,
            'enrollment_completed' => $completion['completed'], 'affected_rows' => count($changedIds),
            'message' => $emailSent ? 'Session marked as no-show and the student was emailed successfully.'
                : 'Session marked as no-show, but the student email could not be sent.'];
    }

    private function sendEmail(array $schedule): bool
    {
        return sendSessionStatusEmail($this->email, $schedule, 'no-show');
    }
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['status' => 'error', 'message' => 'Method not allowed']);
} else {
    $data = json_decode(file_get_contents('php://input'), true);
    echo json_encode((new NoShowSession($conn))->handle(is_array($data) ? $data : $_POST));
}
