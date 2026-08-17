<?php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

class StudentSchedule {
    private function normalizeRole($role) {
        $role = strtolower(trim((string) $role));
        return preg_replace('/[\s_-]+/', ' ', $role);
    }

    private function formatMonthKey($value) {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }

        return preg_match('/^\d{4}-\d{2}$/', $value) ? $value : false;
    }

    private function dayOrderSql($fieldName) {
        return "CASE {$fieldName}
                    WHEN 'Monday' THEN 1
                    WHEN 'Tuesday' THEN 2
                    WHEN 'Wednesday' THEN 3
                    WHEN 'Thursday' THEN 4
                    WHEN 'Friday' THEN 5
                    WHEN 'Saturday' THEN 6
                    WHEN 'Sunday' THEN 7
                    ELSE 8
                END";
    }

    private function buildPreschoolProgramFilter($programAlias = 'p') {
        $programName = "LOWER({$programAlias}.name)";
        $programType = "{$programAlias}.program_type";

        return "(($programType = 3)
                OR {$programName} LIKE '%preschool%'
                OR {$programName} LIKE '%playschool%'
                OR {$programName} LIKE '%pre-school%'
                OR {$programName} LIKE '%play-school%'
                OR {$programName} LIKE '%pre school%'
                OR {$programName} LIKE '%play school%')";
    }

    private function buildTeacherNameSql($fieldAlias = 'teacher_name') {
        return "TRIM(CONCAT_WS(' ',
                    NULLIF(TRIM(COALESCE(pref_t.first_name, sec_t.first_name, '')), ''),
                    NULLIF(TRIM(COALESCE(pref_t.last_name, sec_t.last_name, '')), '')
                )) AS {$fieldAlias}";
    }

    private function deriveEnrollmentType($row) {
        $programName = strtolower(trim((string) ($row['program_name'] ?? '')));

        if (preg_match('/play[\s-]*school/', $programName)) {
            return 'Play School';
        }

        if (preg_match('/pre[\s-]*school/', $programName) || (int) ($row['program_type'] ?? 0) === 3) {
            return 'Preschool';
        }

        return 'Tutorial';
    }

    private function fetchActiveSchoolYear($conn) {
        $stmt = $conn->query("
            SELECT school_year_id, school_year, start_date, end_date
            FROM school_years
            WHERE sy_status = 'active'
            ORDER BY start_date DESC, school_year_id DESC
            LIMIT 1
        ");

        return $stmt ? ($stmt->fetch(PDO::FETCH_ASSOC) ?: null) : null;
    }

    private function buildMonthBounds($monthKey) {
        if (!$monthKey) {
            return null;
        }

        return [
            'start' => $monthKey . '-01',
            'end' => date('Y-m-t', strtotime($monthKey . '-01'))
        ];
    }

    private function resolveRecurringWindow($row, $monthKey, $activeSchoolYear) {
        $windowStart = $row['school_year_start'] ?? '';
        $windowEnd = $row['school_year_end'] ?? '';

        if (($windowStart === '' || $windowEnd === '') && is_array($activeSchoolYear)) {
            $windowStart = $windowStart !== '' ? $windowStart : ($activeSchoolYear['start_date'] ?? '');
            $windowEnd = $windowEnd !== '' ? $windowEnd : ($activeSchoolYear['end_date'] ?? '');
        }

        if ($windowStart === '' || $windowEnd === '') {
            $fallbackMonth = $monthKey ?: date('Y-m');
            $monthBounds = $this->buildMonthBounds($fallbackMonth);
            return $monthBounds ?: null;
        }

        $bounds = [
            'start' => $windowStart,
            'end' => $windowEnd
        ];

        if (!$monthKey) {
            return $bounds;
        }

        $monthBounds = $this->buildMonthBounds($monthKey);
        if (!$monthBounds) {
            return $bounds;
        }

        $start = max($bounds['start'], $monthBounds['start']);
        $end = min($bounds['end'], $monthBounds['end']);

        if ($start > $end) {
            return null;
        }

        return [
            'start' => $start,
            'end' => $end
        ];
    }

    private function generateRecurringDates($dayName, $startDate, $endDate) {
        $weekdayMap = [
            'sunday' => 0,
            'monday' => 1,
            'tuesday' => 2,
            'wednesday' => 3,
            'thursday' => 4,
            'friday' => 5,
            'saturday' => 6
        ];

        $targetWeekday = $weekdayMap[strtolower(trim((string) $dayName))] ?? null;
        if ($targetWeekday === null || !$startDate || !$endDate) {
            return [];
        }

        $start = DateTimeImmutable::createFromFormat('Y-m-d', $startDate);
        $end = DateTimeImmutable::createFromFormat('Y-m-d', $endDate);

        if (!$start || !$end || $start > $end) {
            return [];
        }

        $startWeekday = (int) $start->format('w');
        $offset = ($targetWeekday - $startWeekday + 7) % 7;
        $cursor = $start->modify('+' . $offset . ' days');

        $dates = [];
        while ($cursor <= $end) {
            $dates[] = $cursor->format('Y-m-d');
            $cursor = $cursor->modify('+7 days');
        }

        return $dates;
    }

    private function deriveRecurringStatus($dateKey) {
        $today = date('Y-m-d');
        if ($dateKey < $today) {
            return 'completed';
        }

        return 'scheduled';
    }

    private function buildScheduleKey($entry) {
        return implode('|', [
            (int) ($entry['enrollment_details_id'] ?? 0),
            (string) ($entry['date'] ?? ''),
            (string) ($entry['time'] ?? ''),
            (string) ($entry['endTime'] ?? ''),
            (string) ($entry['scheduleType'] ?? '')
        ]);
    }

    private function normalizeExplicitScheduleRow($row, $lastSessionDate = '') {
        $subject = trim((string) ($row['subject_name'] ?? ''));
        $program = trim((string) ($row['program_name'] ?? ''));
        $teacher = trim((string) ($row['teacher_name'] ?? ''));

        return [
            'enrollment_details_id' => (int) ($row['enrollment_details_id'] ?? 0),
            'preferred_teacher' => $row['preferred_teacher'] ?? null,
            'date' => $row['date'] ?? '',
            'last_session_date' => $lastSessionDate,
            'day' => $row['day'] ?? '',
            'time' => $row['start_time'] ?? '',
            'endTime' => $row['end_time'] ?? '',
            'program' => $program,
            'enrollmentType' => $this->deriveEnrollmentType($row),
            'subject' => $subject !== '' ? $subject : ($program !== '' ? $program : 'Scheduled class'),
            'teacher' => $teacher !== '' ? $teacher : 'To be assigned',
            'branch' => $row['branch_name'] ?? '',
            'status' => $row['status'] ?? 'pending',
            'isNotified' => (bool) ($row['is_notified'] ?? false),
            'scheduleType' => 'preferred',
            'sectionName' => $row['section_name'] ?? '',
            'schoolYear' => $row['school_year'] ?? '',
            'allowConfirmation' => true,
            'allowReschedule' => true,
            'allowNotification' => true
        ];
    }

    private function createRecurringScheduleEntry($row, $dateKey) {
        $subject = trim((string) ($row['subject_name'] ?? ''));
        $sectionName = trim((string) ($row['section_name'] ?? ''));
        $program = trim((string) ($row['program_name'] ?? ''));
        $teacher = trim((string) ($row['teacher_name'] ?? ''));

        return [
            'enrollment_details_id' => (int) ($row['enrollment_details_id'] ?? 0),
            'preferred_teacher' => $row['preferred_teacher'] ?? null,
            'date' => $dateKey,
            'day' => $row['day'] ?? '',
            'time' => $row['start_time'] ?? '',
            'endTime' => $row['end_time'] ?? '',
            'program' => $program,
            'enrollmentType' => $this->deriveEnrollmentType($row),
            'subject' => $subject !== '' ? $subject : ($sectionName !== '' ? $sectionName : ($program !== '' ? $program : 'Scheduled class')),
            'teacher' => $teacher !== '' ? $teacher : 'To be assigned',
            'branch' => $row['branch_name'] ?? '',
            'status' => $this->deriveRecurringStatus($dateKey),
            'isNotified' => false,
            'scheduleType' => 'section',
            'sectionName' => $sectionName,
            'schoolYear' => $row['school_year'] ?? '',
            'allowConfirmation' => false,
            'allowReschedule' => false,
            'allowNotification' => false
        ];
    }

    private function fetchPreferredSchedules($conn, $studentId, $monthKey) {
        $monthFilter = '';
        $params = [':student_id' => $studentId];

        if ($monthKey) {
            $monthFilter = " AND DATE_FORMAT(eps.date, '%Y-%m') = :month_key";
            $params[':month_key'] = $monthKey;
        }

        $sql = "SELECT ed.enrollment_details_id,
                       ed.preferred_teacher,
                       eps.date,
                       eps.day,
                       eps.start_time,
                       eps.end_time,
                       eps.status,
                       eps.is_notified,
                       p.name AS program_name,
                       p.program_type,
                       COALESCE(sub.subject_name, sec.section_name, p.name) AS subject_name,
                       " . $this->buildTeacherNameSql('teacher_name') . ",
                       b.branch_name,
                       sec.section_name,
                       sy.school_year
                FROM enrollment_details ed
                JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                JOIN enrollment_preferred_schedule eps ON ed.enrollment_details_id = eps.enrollment_details_id
                LEFT JOIN program p ON ed.program_id = p.program_id
                LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                LEFT JOIN sections sec ON ed.section_id = sec.section_id
                LEFT JOIN employee pref_t ON ed.preferred_teacher = pref_t.employee_id
                LEFT JOIN employee sec_t ON sec.employee_id = sec_t.employee_id
                LEFT JOIN branch b ON eh.branch_id = b.branch_id
                LEFT JOIN school_years sy ON eh.school_year_id = sy.school_year_id
                WHERE eh.student_id = :student_id
                  AND COALESCE(NULLIF(eh.status, ''), ed.status) IN ('active', 'pending', 'enrolled', 'completed')
                  {$monthFilter}
                ORDER BY eps.date ASC, eps.start_time ASC";

        $stmt = $conn->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $lastSessionDates = [];
        foreach ($rows as $row) {
            $enrollmentDetailsId = (int) ($row['enrollment_details_id'] ?? 0);
            $date = $row['date'] ?? '';
            if ($enrollmentDetailsId <= 0 || $date === '') {
                continue;
            }

            if (!isset($lastSessionDates[$enrollmentDetailsId]) || $date > $lastSessionDates[$enrollmentDetailsId]) {
                $lastSessionDates[$enrollmentDetailsId] = $date;
            }
        }

        return array_map(function ($row) use ($lastSessionDates) {
            $enrollmentDetailsId = (int) ($row['enrollment_details_id'] ?? 0);
            return $this->normalizeExplicitScheduleRow($row, $lastSessionDates[$enrollmentDetailsId] ?? '');
        }, $rows);
    }

    private function fetchRecurringSectionSchedules($conn, $studentId, $monthKey, $activeSchoolYear) {
        $sql = "SELECT ed.enrollment_details_id,
                       ed.preferred_teacher,
                       p.name AS program_name,
                       p.program_type,
                       COALESCE(sub.subject_name, sec.section_name, p.name) AS subject_name,
                       sec.section_name,
                       " . $this->buildTeacherNameSql('teacher_name') . ",
                       b.branch_name,
                       sch.day_of_week AS day,
                       sch.start_time,
                       sch.end_time,
                       sy.school_year,
                       sy.start_date AS school_year_start,
                       sy.end_date AS school_year_end
                FROM enrollment_details ed
                JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                JOIN program p ON ed.program_id = p.program_id
                JOIN sections sec ON ed.section_id = sec.section_id
                JOIN section_schedules sch ON sec.section_id = sch.section_id
                LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                LEFT JOIN employee pref_t ON ed.preferred_teacher = pref_t.employee_id
                LEFT JOIN employee sec_t ON sec.employee_id = sec_t.employee_id
                LEFT JOIN branch b ON eh.branch_id = b.branch_id
                LEFT JOIN school_years sy ON eh.school_year_id = sy.school_year_id
                WHERE eh.student_id = :student_id
                  AND COALESCE(NULLIF(eh.status, ''), ed.status) IN ('active', 'pending', 'enrolled', 'completed')
                  AND " . $this->buildPreschoolProgramFilter('p') . "
                  AND NOT EXISTS (
                      SELECT 1
                      FROM enrollment_preferred_schedule eps
                      WHERE eps.enrollment_details_id = ed.enrollment_details_id
                  )
                ORDER BY ed.enrollment_details_id ASC, " . $this->dayOrderSql('sch.day_of_week') . ", sch.start_time ASC";

        $stmt = $conn->prepare($sql);
        $stmt->execute([':student_id' => $studentId]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $generated = [];
        foreach ($rows as $row) {
            $window = $this->resolveRecurringWindow($row, $monthKey, $activeSchoolYear);
            if (!$window) {
                continue;
            }

            foreach ($this->generateRecurringDates($row['day'] ?? '', $window['start'], $window['end']) as $dateKey) {
                $generated[] = $this->createRecurringScheduleEntry($row, $dateKey);
            }
        }

        return $generated;
    }

    private function mergeSchedules($preferredSchedules, $recurringSchedules) {
        $seen = [];
        $merged = [];

        foreach (array_merge($preferredSchedules, $recurringSchedules) as $entry) {
            $key = $this->buildScheduleKey($entry);
            if (isset($seen[$key])) {
                continue;
            }

            $seen[$key] = true;
            $merged[] = $entry;
        }

        usort($merged, function ($left, $right) {
            $dateCompare = strcmp((string) ($left['date'] ?? ''), (string) ($right['date'] ?? ''));
            if ($dateCompare !== 0) {
                return $dateCompare;
            }

            $timeCompare = strcmp((string) ($left['time'] ?? ''), (string) ($right['time'] ?? ''));
            if ($timeCompare !== 0) {
                return $timeCompare;
            }

            return strcmp((string) ($left['program'] ?? ''), (string) ($right['program'] ?? ''));
        });

        return $merged;
    }

    public function getSchedules() {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }

        include "../admin/connection-pdo.php";

        try {
            $role = $this->normalizeRole($_SESSION['user_role'] ?? '');
            $studentId = intval($_SESSION['student_id'] ?? $_SESSION['user_id'] ?? 0);
            $monthKey = $this->formatMonthKey($_GET['month'] ?? '');

            if ($monthKey === false) {
                http_response_code(422);
                echo json_encode(['status' => 'error', 'message' => 'Invalid month filter.']);
                return;
            }

            if ($role !== 'student' || $studentId <= 0) {
                http_response_code(403);
                echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
                return;
            }

            $activeSchoolYear = $this->fetchActiveSchoolYear($conn);
            $preferredSchedules = $this->fetchPreferredSchedules($conn, $studentId, $monthKey);
            $recurringSchedules = $this->fetchRecurringSectionSchedules($conn, $studentId, $monthKey, $activeSchoolYear);
            $schedules = $this->mergeSchedules($preferredSchedules, $recurringSchedules);

            echo json_encode([
                'status' => 'success',
                'schedules' => $schedules,
                'count' => count($schedules)
            ]);
        } catch (Throwable $e) {
            http_response_code(500);
            echo json_encode([
                'status' => 'error',
                'message' => $e->getMessage()
            ]);
        }
    }
}

$operation = '';
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $operation = $_GET['operation'] ?? '';
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $operation = $_POST['operation'] ?? '';
}

$scheduleHandler = new StudentSchedule();

switch ($operation) {
    case 'getSchedules':
        $scheduleHandler->getSchedules();
        break;
    default:
        http_response_code(400);
        echo json_encode(["status" => "error", "message" => "Invalid Operation"]);
        break;
}
?>
