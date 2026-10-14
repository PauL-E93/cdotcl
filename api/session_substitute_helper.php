<?php

function ensureSessionSubstituteSchema(PDO $conn): void
{
    static $ready = [];
    $key = spl_object_id($conn);
    if (isset($ready[$key])) return;
    $columns = $conn->query('SHOW COLUMNS FROM enrollment_preferred_schedule')->fetchAll(PDO::FETCH_COLUMN);
    foreach (['substitute_teacher_id' => 'INT NULL DEFAULT NULL', 'substitute_reason' => 'VARCHAR(500) NULL DEFAULT NULL'] as $name => $definition) {
        if (!in_array($name, $columns, true)) {
            try {
                $conn->exec("ALTER TABLE enrollment_preferred_schedule ADD COLUMN {$name} {$definition}");
            } catch (PDOException $error) {
                // Another request may have installed the same column concurrently.
                if ((int)($error->errorInfo[1] ?? 0) !== 1060) throw $error;
            }
        }
    }
    $ready[$key] = true;
}

// A merged meeting must remain within one teacher's assignment. Lock every
// selected block before a teacher starts or completes the meeting.
function selectTeacherMeeting(PDOStatement $statement, array $ids, string $targetStatus): ?array
{
    $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    if (count($rows) !== count($ids)) return null;
    $first = $rows[0];
    $allowed = $targetStatus === 'ongoing' ? ['pending', 'confirmed', 'ongoing'] : ['ongoing', 'done'];
    foreach ($rows as $index => $row) {
        if ($row['enrollment_details_id'] !== $first['enrollment_details_id'] || $row['date'] !== $first['date']
            || !in_array($row['status'], $allowed, true)
            || ($index && $rows[$index - 1]['end_time'] !== $row['start_time'])) return null;
    }
    $unfinished = array_filter($rows, fn($row) => $row['status'] !== $targetStatus);
    $result = $unfinished ? reset($unfinished) : $first;
    $result['start_time'] = $first['start_time'];
    $result['end_time'] = $rows[count($rows) - 1]['end_time'];
    $result['preference_ids'] = $ids;
    return $result;
}

final class SessionSubstituteService
{
    public function __construct(private PDO $conn) {}

    public static function identifiers(array $data): array
    {
        $ids = $data['preference_ids'] ?? [$data['preference_id'] ?? null];
        if (!is_array($ids) || !$ids || count($ids) > 100) throw new DomainException('Select a session.');
        foreach ($ids as $id) {
            if (!filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]])) {
                throw new DomainException('Invalid session identifier.');
            }
        }
        return array_values(array_unique(array_map('intval', $ids)));
    }

    private function sessions(array $ids, string $role, int $branchId, bool $lock = false): array
    {
        $marks = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $this->conn->prepare("SELECT eps.*, ed.preferred_teacher, ed.program_id, ed.subject_id,
            eh.branch_id, eh.student_id, COALESCE(NULLIF(eh.status, ''), ed.status) AS enrollment_status
            FROM enrollment_preferred_schedule eps
            JOIN enrollment_details ed ON ed.enrollment_details_id = eps.enrollment_details_id
            JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
            WHERE eps.preference_id IN ({$marks}) ORDER BY eps.date, eps.start_time, eps.preference_id" . ($lock ? ' FOR UPDATE' : ''));
        $stmt->execute($ids);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        if (count($rows) !== count($ids)) throw new DomainException('Session not found.');
        $first = $rows[0];
        foreach ($rows as $index => $row) {
            if ($role === 'branch admin' && ($branchId <= 0 || (int)$row['branch_id'] !== $branchId)) {
                throw new DomainException('You cannot manage sessions outside your branch.');
            }
            if ((int)$row['enrollment_details_id'] !== (int)$first['enrollment_details_id'] || $row['date'] !== $first['date']) {
                throw new DomainException('Select time blocks from the same meeting.');
            }
            if ($index && $rows[$index - 1]['end_time'] !== $row['start_time']) {
                throw new DomainException('Select consecutive time blocks from the same meeting.');
            }
            if (!in_array(strtolower($row['status']), ['pending', 'confirmed'], true)) {
                throw new DomainException('Teacher assignment can only change before the session starts.');
            }
            if ($row['enrollment_status'] !== 'enrolled') throw new DomainException('Only enrolled sessions can receive a substitute.');
        }
        return $rows;
    }

    private function available(int $teacherId, array $rows): bool
    {
        foreach ($rows as $row) {
            $work = $this->conn->prepare('SELECT 1 FROM employee_schedule WHERE employee_id = ? AND day_of_week = ? AND start_time <= ? AND end_time >= ? LIMIT 1');
            $work->execute([$teacherId, $row['day'], $row['start_time'], $row['end_time']]);
            if (!$work->fetchColumn()) return false;
            $marks = implode(',', array_fill(0, count($rows), '?'));
            $conflict = $this->conn->prepare("SELECT 1 FROM enrollment_preferred_schedule eps
                JOIN enrollment_details ed ON ed.enrollment_details_id = eps.enrollment_details_id
                JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
                WHERE COALESCE(eps.substitute_teacher_id, ed.preferred_teacher) = ? AND eps.date = ?
                AND eps.start_time < ? AND eps.end_time > ? AND eps.preference_id NOT IN ({$marks})
                AND eps.status NOT IN ('done', 'completed', 'no-show', 'cancelled')
                AND COALESCE(NULLIF(eh.status, ''), ed.status) IN ('pending', 'approved', 'enrolled') LIMIT 1");
            $conflict->execute(array_merge([$teacherId, $row['date'], $row['end_time'], $row['start_time']], array_column($rows, 'preference_id')));
            if ($conflict->fetchColumn()) return false;
            $section = $this->conn->prepare("SELECT 1 FROM sections sec JOIN section_schedules ss ON ss.section_id = sec.section_id
                JOIN enrollment_details ed ON ed.section_id = sec.section_id
                JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
                LEFT JOIN school_years sy ON sy.school_year_id = eh.school_year_id
                WHERE sec.employee_id = ? AND ss.day_of_week = ? AND ss.start_time < ? AND ss.end_time > ?
                AND COALESCE(NULLIF(eh.status, ''), ed.status) = 'enrolled'
                AND (sy.start_date IS NULL OR sy.start_date <= ?) AND (sy.end_date IS NULL OR sy.end_date >= ?)
                AND NOT EXISTS (SELECT 1 FROM enrollment_preferred_schedule explicit_schedule WHERE explicit_schedule.enrollment_details_id = ed.enrollment_details_id)
                LIMIT 1");
            $section->execute([$teacherId, $row['day'], $row['end_time'], $row['start_time'], $row['date'], $row['date']]);
            if ($section->fetchColumn()) return false;
        }
        return true;
    }

    private function candidates(array $rows): array
    {
        $first = $rows[0];
        $stmt = $this->conn->prepare("SELECT e.employee_id, CONCAT_WS(' ', e.first_name, e.last_name) AS name
            FROM employee e JOIN role r ON r.role_id = e.role_id
            WHERE LOWER(r.role_name) = 'teacher' AND LOWER(e.status) = 'active' AND e.branch_id = ?
            AND e.employee_id <> COALESCE(?, 0)
            AND EXISTS (SELECT 1 FROM program_teacher pt WHERE pt.employee_id = e.employee_id AND pt.program_id = ?)
            AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM subject_teacher st WHERE st.subject_id = ?)
                OR EXISTS (SELECT 1 FROM subject_teacher st WHERE st.employee_id = e.employee_id AND st.subject_id = ?))
            ORDER BY e.first_name, e.last_name");
        $stmt->execute([$first['branch_id'], $first['preferred_teacher'], $first['program_id'], $first['subject_id'], $first['subject_id'], $first['subject_id']]);
        return array_values(array_filter($stmt->fetchAll(PDO::FETCH_ASSOC), fn($teacher) => $this->available((int)$teacher['employee_id'], $rows)));
    }

    public function teachers(array $data, string $role, int $branchId): array
    {
        return $this->candidates($this->sessions(self::identifiers($data), $role, $branchId));
    }

    public function save(array $data, string $role, int $branchId): array
    {
        $ids = self::identifiers($data);
        $teacher = $data['substitute_teacher_id'] ?? null;
        if ($teacher !== null && !filter_var($teacher, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]])) {
            throw new DomainException('Select a valid substitute teacher.');
        }
        $teacher = $teacher === null ? null : (int)$teacher;
        $reason = $data['reason'] ?? '';
        if (!is_string($reason) || (function_exists('mb_strlen') ? mb_strlen($reason, 'UTF-8') : strlen($reason)) > 500) {
            throw new DomainException('The reason must be text of up to 500 characters.');
        }
        try {
            $this->conn->beginTransaction();
            // Serialize substitute bookings for this teacher before checking conflicts.
            if ($teacher !== null) {
                $lock = $this->conn->prepare('SELECT employee_id FROM employee WHERE employee_id = ? FOR UPDATE');
                $lock->execute([$teacher]);
                if (!$lock->fetchColumn()) throw new DomainException('Teacher not found.');
            }
            $rows = $this->sessions($ids, $role, $branchId, true);
            if ($teacher !== null) {
                $eligible = array_map('intval', array_column($this->candidates($rows), 'employee_id'));
                if (!in_array($teacher, $eligible, true)) throw new DomainException('This teacher is unavailable or is not eligible for this session.');
            } else {
                $regular = (int)$rows[0]['preferred_teacher'];
                $lock = $this->conn->prepare('SELECT employee_id FROM employee WHERE employee_id = ? AND status = \'active\' FOR UPDATE');
                $lock->execute([$regular]);
                if (!$lock->fetchColumn() || !$this->available($regular, $rows)) {
                    throw new DomainException('The regular teacher is unavailable. Assign another substitute instead.');
                }
            }
            $marks = implode(',', array_fill(0, count($ids), '?'));
            $update = $this->conn->prepare("UPDATE enrollment_preferred_schedule SET substitute_teacher_id = ?, substitute_reason = ? WHERE preference_id IN ({$marks})");
            $update->execute(array_merge([$teacher, $teacher === null ? null : trim($reason)], $ids));
            $this->conn->commit();
            return ['rows' => $rows, 'teacher_id' => $teacher ?? (int)$rows[0]['preferred_teacher']];
        } catch (Throwable $error) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            throw $error;
        }
    }
}
