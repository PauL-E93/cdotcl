<?php

class NotificationService {
    private $conn;

    public function __construct(PDO $conn) {
        $this->conn = $conn;
    }

    public function notifyStudent($studentId, $title, $message) {
        return $this->notifyUser($studentId, 'student', $title, $message);
    }

    public function notifyEmployee($employeeId, $title, $message) {
        return $this->notifyUser($employeeId, 'employee', $title, $message);
    }

    public function notifyUser($userId, $userType, $title, $message) {
        $userId = intval($userId);
        $userType = strtolower(trim((string) $userType));
        $title = trim((string) $title);
        $message = trim((string) $message);

        if ($userId <= 0 || !in_array($userType, ['student', 'employee'], true) || $title === '' || $message === '') {
            return false;
        }

        try {
            $stmt = $this->conn->prepare("
                INSERT INTO notification (user_id, user_type, title, message, is_read, created_at)
                VALUES (:user_id, :user_type, :title, :message, 0, NOW())
            ");
            return $stmt->execute([
                ':user_id' => $userId,
                ':user_type' => $userType,
                ':title' => $title,
                ':message' => $message
            ]);
        } catch (Throwable $e) {
            error_log('Notification insert failed: ' . $e->getMessage());
            return false;
        }
    }

    public function notifyRole($roles, $title, $message, $branchId = null, $excludeEmployeeIds = []) {
        $roles = is_array($roles) ? $roles : [$roles];
        $roles = array_values(array_unique(array_filter(array_map([$this, 'normalizeRole'], $roles))));

        if (empty($roles)) {
            return 0;
        }

        try {
            $rolePlaceholders = implode(', ', array_fill(0, count($roles), '?'));
            $params = $roles;
            $sql = "
                SELECT DISTINCT e.employee_id
                FROM employee e
                INNER JOIN role r ON e.role_id = r.role_id
                WHERE LOWER(REPLACE(REPLACE(TRIM(r.role_name), '_', ' '), '-', ' ')) IN ($rolePlaceholders)
            ";

            if ($branchId !== null && intval($branchId) > 0) {
                $sql .= " AND e.branch_id = ?";
                $params[] = intval($branchId);
            }

            $excludeEmployeeIds = array_values(array_filter(array_map('intval', (array) $excludeEmployeeIds)));
            if (!empty($excludeEmployeeIds)) {
                $excludePlaceholders = implode(', ', array_fill(0, count($excludeEmployeeIds), '?'));
                $sql .= " AND e.employee_id NOT IN ($excludePlaceholders)";
                $params = array_merge($params, $excludeEmployeeIds);
            }

            $stmt = $this->conn->prepare($sql);
            $stmt->execute($params);

            $count = 0;
            foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $employeeId) {
                if ($this->notifyEmployee($employeeId, $title, $message)) {
                    $count++;
                }
            }

            return $count;
        } catch (Throwable $e) {
            error_log('Role notification failed: ' . $e->getMessage());
            return 0;
        }
    }

    public function getEnrollmentContext($enrollmentDetailsId) {
        try {
            $stmt = $this->conn->prepare("
                SELECT ed.enrollment_details_id,
                       ed.preferred_teacher AS teacher_id,
                       eh.student_id,
                       eh.branch_id,
                       TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                       CONCAT(t.first_name, ' ', t.last_name) AS teacher_name,
                       p.name AS program_name,
                       b.branch_name
                FROM enrollment_details ed
                INNER JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                INNER JOIN student s ON eh.student_id = s.student_id
                LEFT JOIN employee t ON ed.preferred_teacher = t.employee_id
                LEFT JOIN program p ON ed.program_id = p.program_id
                LEFT JOIN branch b ON eh.branch_id = b.branch_id
                WHERE ed.enrollment_details_id = ?
                LIMIT 1
            ");
            $stmt->execute([intval($enrollmentDetailsId)]);
            return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
        } catch (Throwable $e) {
            error_log('Enrollment notification context failed: ' . $e->getMessage());
            return null;
        }
    }

    public function getPaymentContext($paymentId) {
        try {
            $stmt = $this->conn->prepare("
                SELECT p.payment_id,
                       p.amount_paid,
                       p.reference_no,
                       p.payment_status,
                       pm.payment_method,
                       bs.billing_type,
                       ed.enrollment_details_id,
                       eh.student_id,
                       TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                       pr.name AS program_name
                FROM payment p
                INNER JOIN payment_method pm ON p.payment_method_id = pm.payment_method_id
                INNER JOIN billing_schedule bs ON p.billing_schedule_id = bs.billing_schedule_id
                INNER JOIN enrollment_details ed ON bs.enrollment_details_id = ed.enrollment_details_id
                INNER JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                INNER JOIN student s ON eh.student_id = s.student_id
                LEFT JOIN program pr ON ed.program_id = pr.program_id
                WHERE p.payment_id = ?
                LIMIT 1
            ");
            $stmt->execute([intval($paymentId)]);
            return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
        } catch (Throwable $e) {
            error_log('Payment notification context failed: ' . $e->getMessage());
            return null;
        }
    }

    public function getScheduleContext($preferenceId = null, $enrollmentDetailsId = null, $scheduleDate = null) {
        try {
            $where = [];
            $params = [];

            if ($preferenceId) {
                $where[] = 'eps.preference_id = ?';
                $params[] = intval($preferenceId);
            } else {
                $where[] = 'eps.enrollment_details_id = ?';
                $where[] = 'eps.date = ?';
                $params[] = intval($enrollmentDetailsId);
                $params[] = $scheduleDate;
            }

            $stmt = $this->conn->prepare("
                SELECT eps.preference_id,
                       eps.enrollment_details_id,
                       eps.date,
                       eps.start_time,
                       eps.end_time,
                       eps.status,
                       ed.preferred_teacher AS teacher_id,
                       eh.student_id,
                       eh.branch_id,
                       TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                       CONCAT(t.first_name, ' ', t.last_name) AS teacher_name,
                       p.name AS program_name,
                       sub.subject_name,
                       b.branch_name
                FROM enrollment_preferred_schedule eps
                INNER JOIN enrollment_details ed ON eps.enrollment_details_id = ed.enrollment_details_id
                INNER JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                INNER JOIN student s ON eh.student_id = s.student_id
                LEFT JOIN employee t ON ed.preferred_teacher = t.employee_id
                LEFT JOIN program p ON ed.program_id = p.program_id
                LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                LEFT JOIN branch b ON eh.branch_id = b.branch_id
                WHERE " . implode(' AND ', $where) . "
                LIMIT 1
            ");
            $stmt->execute($params);
            return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
        } catch (Throwable $e) {
            error_log('Schedule notification context failed: ' . $e->getMessage());
            return null;
        }
    }

    public function notifyScheduleStatus($schedule, $newStatus, $actorType = null, $actorId = null) {
        if (!$schedule) {
            return;
        }

        $statusLabel = ucwords(str_replace('-', ' ', (string) $newStatus));
        $date = !empty($schedule['date']) ? date('M j, Y', strtotime($schedule['date'])) : 'the scheduled date';
        $time = !empty($schedule['start_time']) ? date('g:i A', strtotime($schedule['start_time'])) : 'the scheduled time';
        $studentName = $schedule['student_name'] ?: 'A student';
        $programName = $schedule['program_name'] ?: 'tutorial';
        $title = 'Session ' . $statusLabel;
        $message = "{$studentName}'s {$programName} session on {$date} at {$time} is now {$statusLabel}.";

        if ($actorType !== 'student') {
            $this->notifyStudent($schedule['student_id'] ?? 0, $title, $message);
        }

        if ($actorType !== 'employee' || intval($schedule['teacher_id'] ?? 0) !== intval($actorId)) {
            $this->notifyEmployee($schedule['teacher_id'] ?? 0, $title, $message);
        }

        $excludedEmployees = $actorType === 'employee' ? [intval($actorId)] : [];
        $this->notifyRole('branch admin', $title, $message, $schedule['branch_id'] ?? null, $excludedEmployees);
    }

    private function normalizeRole($role) {
        return preg_replace('/[\s_-]+/', ' ', strtolower(trim((string) $role)));
    }
}

