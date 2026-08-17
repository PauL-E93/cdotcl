<?php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

class SchoolYear {
    private function getNormalizedSessionRole() {
        $role = strtolower(trim((string) ($_SESSION['user_role'] ?? '')));
        return preg_replace('/[\s_-]+/', ' ', $role);
    }

    private function getTeacherOverviewScope() {
        $role = $this->getNormalizedSessionRole();
        $teacherId = intval($_SESSION['employee_id'] ?? 0);

        if ($role !== 'teacher' || $teacherId <= 0) {
            return null;
        }

        return $teacherId;
    }

    private function getConnection() {
        include "connection-pdo.php";
        $this->ensureSchema($conn);
        return $conn;
    }

    private function ensureSchema($conn) {
        $conn->exec("
            CREATE TABLE IF NOT EXISTS school_years (
                school_year_id INT(11) NOT NULL AUTO_INCREMENT,
                school_year VARCHAR(255) DEFAULT NULL,
                start_date DATE DEFAULT NULL,
                end_date DATE DEFAULT NULL,
                quarter_1_start DATE DEFAULT NULL,
                quarter_1_end DATE DEFAULT NULL,
                quarter_2_start DATE DEFAULT NULL,
                quarter_2_end DATE DEFAULT NULL,
                quarter_3_start DATE DEFAULT NULL,
                quarter_3_end DATE DEFAULT NULL,
                quarter_4_start DATE DEFAULT NULL,
                quarter_4_end DATE DEFAULT NULL,
                quarters_json LONGTEXT DEFAULT NULL,
                sy_status ENUM('active', 'inactive') DEFAULT 'inactive',
                PRIMARY KEY (school_year_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        ");

        $conn->exec("
            CREATE TABLE IF NOT EXISTS school_activities (
                school_activity_id INT(11) NOT NULL AUTO_INCREMENT,
                school_year_id INT(11) NOT NULL,
                activity_title VARCHAR(255) NOT NULL,
                activity_date DATE NOT NULL,
                activity_notes TEXT DEFAULT NULL,
                activity_status ENUM('active', 'inactive') DEFAULT 'active',
                created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (school_activity_id),
                KEY idx_school_activities_school_year (school_year_id),
                CONSTRAINT fk_school_activities_school_year
                    FOREIGN KEY (school_year_id) REFERENCES school_years (school_year_id)
                    ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        ");

        $columns = [
            'start_date' => "DATE DEFAULT NULL AFTER school_year",
            'end_date' => "DATE DEFAULT NULL AFTER start_date",
            'quarter_1_start' => "DATE DEFAULT NULL AFTER end_date",
            'quarter_1_end' => "DATE DEFAULT NULL AFTER quarter_1_start",
            'quarter_2_start' => "DATE DEFAULT NULL AFTER quarter_1_end",
            'quarter_2_end' => "DATE DEFAULT NULL AFTER quarter_2_start",
            'quarter_3_start' => "DATE DEFAULT NULL AFTER quarter_2_end",
            'quarter_3_end' => "DATE DEFAULT NULL AFTER quarter_3_start",
            'quarter_4_start' => "DATE DEFAULT NULL AFTER quarter_3_end",
            'quarter_4_end' => "DATE DEFAULT NULL AFTER quarter_4_start",
            'quarters_json' => "LONGTEXT DEFAULT NULL AFTER quarter_4_end"
        ];

        foreach ($columns as $column => $definition) {
            $stmt = $conn->query("SHOW COLUMNS FROM school_years LIKE " . $conn->quote($column));
            if (!$stmt->fetch(PDO::FETCH_ASSOC)) {
                $conn->exec("ALTER TABLE school_years ADD COLUMN {$column} {$definition}");
            }
        }

        $learningAreasTable = $conn->query("SHOW TABLES LIKE 'learning_areas'")->fetchColumn();
        if ($learningAreasTable) {
            $columnStmt = $conn->query("SHOW COLUMNS FROM learning_areas LIKE 'school_year_id'");
            if (!$columnStmt->fetch(PDO::FETCH_ASSOC)) {
                $conn->exec("ALTER TABLE learning_areas ADD COLUMN school_year_id INT(11) NULL AFTER area_id");
            }

            $indexStmt = $conn->prepare("SELECT COUNT(*)
                                         FROM INFORMATION_SCHEMA.STATISTICS
                                         WHERE TABLE_SCHEMA = DATABASE()
                                           AND TABLE_NAME = 'learning_areas'
                                           AND INDEX_NAME = 'idx_learning_areas_school_year'");
            $indexStmt->execute();
            if ((int) $indexStmt->fetchColumn() === 0) {
                $conn->exec("CREATE INDEX idx_learning_areas_school_year
                             ON learning_areas (school_year_id, category, is_active, order_index)");
            }
        }
    }

    private function normalizeDate($value) {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }

        $date = DateTime::createFromFormat('Y-m-d', $value);
        return $date && $date->format('Y-m-d') === $value ? $value : false;
    }

    private function buildSchoolYearLabel($startDate, $endDate) {
        if (!$startDate || !$endDate) {
            return '';
        }

        return 'SY ' . date('Y', strtotime($startDate)) . '-' . date('Y', strtotime($endDate));
    }

    private function buildDefaultQuarterLabel($index) {
        $number = $index + 1;
        $mod10 = $number % 10;
        $mod100 = $number % 100;

        if ($mod10 === 1 && $mod100 !== 11) return $number . 'st Quarter';
        if ($mod10 === 2 && $mod100 !== 12) return $number . 'nd Quarter';
        if ($mod10 === 3 && $mod100 !== 13) return $number . 'rd Quarter';
        return $number . 'th Quarter';
    }

    private function dayOrderSql($fieldName = 'ss.day_of_week') {
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

    private function parseStoredQuarters($row) {
        $quarters = [];

        if (!empty($row['quarters_json'])) {
            $decoded = json_decode($row['quarters_json'], true);
            if (is_array($decoded)) {
                foreach ($decoded as $index => $quarter) {
                    if (!is_array($quarter)) {
                        continue;
                    }

                    $quarters[] = [
                        'label' => trim((string) ($quarter['label'] ?? $this->buildDefaultQuarterLabel($index))),
                        'start_date' => $quarter['start_date'] ?? null,
                        'end_date' => $quarter['end_date'] ?? null
                    ];
                }
            }
        }

        if (!empty($quarters)) {
            return $quarters;
        }

        for ($index = 0; $index < 4; $index++) {
            $start = $row['quarter_' . ($index + 1) . '_start'] ?? null;
            $end = $row['quarter_' . ($index + 1) . '_end'] ?? null;
            if (!$start && !$end) {
                continue;
            }

            $quarters[] = [
                'label' => $this->buildDefaultQuarterLabel($index),
                'start_date' => $start,
                'end_date' => $end
            ];
        }

        return $quarters;
    }

    private function validatePayload($data) {
        $schoolYear = isset($data['school_year']) ? trim($data['school_year']) : '';
        $status = isset($data['sy_status']) && trim($data['sy_status']) === 'active' ? 'active' : 'inactive';
        $startDate = $this->normalizeDate($data['start_date'] ?? '');
        $endDate = $this->normalizeDate($data['end_date'] ?? '');

        if ($startDate === false || $endDate === false) {
            return ['valid' => false, 'message' => 'Invalid school year date format.'];
        }

        if (!$startDate || !$endDate) {
            return ['valid' => false, 'message' => 'School year start and end dates are required.'];
        }

        if ($startDate > $endDate) {
            return ['valid' => false, 'message' => 'School year start date must be before the end date.'];
        }

        if ($schoolYear === '') {
            $schoolYear = $this->buildSchoolYearLabel($startDate, $endDate);
        }

        $quartersInput = $data['quarters'] ?? [];
        if (!is_array($quartersInput) || count($quartersInput) === 0) {
            return ['valid' => false, 'message' => 'Please add at least one quarter period.'];
        }

        $quarters = [];
        $previousQuarterEnd = null;

        foreach (array_values($quartersInput) as $index => $quarter) {
            if (!is_array($quarter)) {
                return ['valid' => false, 'message' => 'Invalid quarter payload.'];
            }

            $label = trim((string) ($quarter['label'] ?? ''));
            $label = $label !== '' ? $label : $this->buildDefaultQuarterLabel($index);
            $quarterStart = $this->normalizeDate($quarter['start_date'] ?? '');
            $quarterEnd = $this->normalizeDate($quarter['end_date'] ?? '');

            if ($quarterStart === false || $quarterEnd === false) {
                return ['valid' => false, 'message' => "{$label} has an invalid date format."];
            }

            if (!$quarterStart || !$quarterEnd) {
                return ['valid' => false, 'message' => "{$label} needs both start and end dates."];
            }

            if ($quarterStart > $quarterEnd) {
                return ['valid' => false, 'message' => "{$label} start date must be before the end date."];
            }

            if ($quarterStart < $startDate || $quarterEnd > $endDate) {
                return ['valid' => false, 'message' => "{$label} must stay inside the school year range."];
            }

            if ($previousQuarterEnd !== null && $quarterStart <= $previousQuarterEnd) {
                return ['valid' => false, 'message' => "{$label} must start after the previous quarter ends."];
            }

            $quarters[] = [
                'label' => $label,
                'start_date' => $quarterStart,
                'end_date' => $quarterEnd
            ];
            $previousQuarterEnd = $quarterEnd;
        }

        $legacyQuarterColumns = [];
        for ($index = 0; $index < 4; $index++) {
            $legacyQuarterColumns['quarter_' . ($index + 1) . '_start'] = $quarters[$index]['start_date'] ?? null;
            $legacyQuarterColumns['quarter_' . ($index + 1) . '_end'] = $quarters[$index]['end_date'] ?? null;
        }

        return [
            'valid' => true,
            'data' => array_merge([
                'school_year' => $schoolYear,
                'start_date' => $startDate,
                'end_date' => $endDate,
                'sy_status' => $status,
                'quarters' => $quarters,
                'quarters_json' => json_encode($quarters)
            ], $legacyQuarterColumns)
        ];
    }

    private function setActiveStatus($conn, $currentId = null) {
        if ($currentId) {
            $stmt = $conn->prepare("UPDATE school_years SET sy_status = 'inactive' WHERE school_year_id <> :id");
            $stmt->execute([':id' => $currentId]);
            return;
        }

        $conn->exec("UPDATE school_years SET sy_status = 'inactive'");
    }

    private function getActiveSchoolYearId($conn) {
        $stmt = $conn->query("SELECT school_year_id
                              FROM school_years
                              WHERE sy_status = 'active'
                              ORDER BY school_year_id DESC
                              LIMIT 1");
        return (int) ($stmt->fetchColumn() ?: 0);
    }

    /**
     * A newly opened school year starts a separate curriculum version. The
     * previous checklist is copied as a starting point, so later edits do not
     * rename or remove fields referenced by historical student cards.
     */
    private function ensureSchoolYearCurriculum($conn, $targetSchoolYearId, $sourceSchoolYearId = 0) {
        $targetSchoolYearId = (int) $targetSchoolYearId;
        $sourceSchoolYearId = (int) $sourceSchoolYearId;
        if ($targetSchoolYearId <= 0) return;

        $tableStmt = $conn->query("SHOW TABLES LIKE 'learning_areas'");
        if (!$tableStmt->fetchColumn()) return;
        $columnStmt = $conn->query("SHOW COLUMNS FROM learning_areas LIKE 'school_year_id'");
        if (!$columnStmt->fetch(PDO::FETCH_ASSOC)) return;

        $targetStmt = $conn->prepare("SELECT COUNT(*) FROM learning_areas WHERE school_year_id = :school_year_id");
        $targetStmt->execute([':school_year_id' => $targetSchoolYearId]);
        if ((int) $targetStmt->fetchColumn() > 0) return;

        // Historical years created before curriculum versioning continue to
        // use the NULL legacy curriculum. Never replace their established
        // card labels merely because an old year is reopened.
        $enrollmentStmt = $conn->prepare("SELECT COUNT(*) FROM enrollment_header WHERE school_year_id = :school_year_id");
        $enrollmentStmt->execute([':school_year_id' => $targetSchoolYearId]);
        if ((int) $enrollmentStmt->fetchColumn() > 0) return;

        $sourceWhere = 'school_year_id IS NULL';
        $sourceParams = [];
        if ($sourceSchoolYearId > 0) {
            $sourceCountStmt = $conn->prepare("SELECT COUNT(*) FROM learning_areas WHERE school_year_id = :school_year_id");
            $sourceCountStmt->execute([':school_year_id' => $sourceSchoolYearId]);
            if ((int) $sourceCountStmt->fetchColumn() > 0) {
                $sourceWhere = 'school_year_id = :source_school_year_id';
                $sourceParams[':source_school_year_id'] = $sourceSchoolYearId;
            }
        }

        $sql = "INSERT INTO learning_areas (
                    school_year_id, area_name, category, domain_key, domain_label,
                    introduced_quarter, order_index, is_active,
                    weight_percentage, default_perfect_score
                )
                SELECT :target_school_year_id, area_name, category, domain_key, domain_label,
                       introduced_quarter, order_index, is_active,
                       weight_percentage, default_perfect_score
                FROM learning_areas
                WHERE {$sourceWhere}";
        $stmt = $conn->prepare($sql);
        $stmt->execute(array_merge([
            ':target_school_year_id' => $targetSchoolYearId
        ], $sourceParams));
    }

    private function fetchSchoolYearsRaw($conn, $whereSql = '', $params = []) {
        $sql = "SELECT school_year_id, school_year, start_date, end_date,
                       quarter_1_start, quarter_1_end,
                       quarter_2_start, quarter_2_end,
                       quarter_3_start, quarter_3_end,
                       quarter_4_start, quarter_4_end,
                       quarters_json,
                       sy_status
                FROM school_years
                {$whereSql}
                ORDER BY CASE WHEN sy_status = 'active' THEN 0 ELSE 1 END,
                         start_date DESC,
                         school_year_id DESC";

        $stmt = $conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    private function formatSchoolYearRow($row) {
        $row['quarters'] = $this->parseStoredQuarters($row);
        unset($row['quarters_json']);
        return $row;
    }

    private function fetchActivitiesMap($conn, $schoolYearIds = []) {
        if (empty($schoolYearIds)) {
            return [];
        }

        $schoolYearIds = array_values(array_filter(array_map('intval', $schoolYearIds)));
        if (empty($schoolYearIds)) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($schoolYearIds), '?'));
        $sql = "SELECT school_activity_id, school_year_id, activity_title, activity_date, activity_notes, activity_status
                FROM school_activities
                WHERE school_year_id IN ($placeholders)
                  AND COALESCE(activity_status, 'active') <> 'inactive'
                ORDER BY activity_date ASC, school_activity_id ASC";
        $stmt = $conn->prepare($sql);
        $stmt->execute($schoolYearIds);

        $activityMap = [];
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $schoolYearId = intval($row['school_year_id']);
            if (!isset($activityMap[$schoolYearId])) {
                $activityMap[$schoolYearId] = [];
            }
            $activityMap[$schoolYearId][] = $row;
        }

        return $activityMap;
    }

    private function attachActivitiesToRows($conn, $rows) {
        if (empty($rows)) {
            return [];
        }

        $activityMap = $this->fetchActivitiesMap($conn, array_column($rows, 'school_year_id'));
        return array_map(function ($row) use ($activityMap) {
            $formatted = $this->formatSchoolYearRow($row);
            $schoolYearId = intval($formatted['school_year_id'] ?? 0);
            $formatted['activities'] = $activityMap[$schoolYearId] ?? [];
            return $formatted;
        }, $rows);
    }

    private function validateActivityPayload($conn, $data, $requireId = false) {
        $schoolYearId = intval($data['school_year_id'] ?? 0);
        $title = trim((string) ($data['activity_title'] ?? ''));
        $activityDate = $this->normalizeDate($data['activity_date'] ?? '');
        $notes = trim((string) ($data['activity_notes'] ?? ''));
        $status = trim((string) ($data['activity_status'] ?? 'active')) === 'inactive' ? 'inactive' : 'active';
        $activityId = intval($data['school_activity_id'] ?? 0);

        if ($requireId && $activityId <= 0) {
            return ['valid' => false, 'message' => 'Invalid school activity ID.'];
        }

        if ($schoolYearId <= 0) {
            return ['valid' => false, 'message' => 'Please select a school year for this activity.'];
        }

        if ($title === '') {
            return ['valid' => false, 'message' => 'Please enter an activity title.'];
        }

        if ($activityDate === false || !$activityDate) {
            return ['valid' => false, 'message' => 'Please enter a valid activity date.'];
        }

        $stmt = $conn->prepare("SELECT school_year_id, school_year, start_date, end_date FROM school_years WHERE school_year_id = :id LIMIT 1");
        $stmt->execute([':id' => $schoolYearId]);
        $schoolYear = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$schoolYear) {
            return ['valid' => false, 'message' => 'The selected school year was not found.'];
        }

        if (!empty($schoolYear['start_date']) && !empty($schoolYear['end_date'])) {
            if ($activityDate < $schoolYear['start_date'] || $activityDate > $schoolYear['end_date']) {
                return ['valid' => false, 'message' => 'Activity date must stay inside the selected school year range.'];
            }
        }

        return [
            'valid' => true,
            'data' => [
                'school_activity_id' => $activityId,
                'school_year_id' => $schoolYearId,
                'activity_title' => $title,
                'activity_date' => $activityDate,
                'activity_notes' => $notes !== '' ? $notes : null,
                'activity_status' => $status
            ]
        ];
    }

    function getSchoolYears() {
        $conn = $this->getConnection();
        $rows = $this->fetchSchoolYearsRaw($conn);
        echo json_encode($this->attachActivitiesToRows($conn, $rows));
    }

    function getSchoolYear($json) {
        $conn = $this->getConnection();
        $data = json_decode($json, true);
        $id = isset($data['school_year_id']) ? intval($data['school_year_id']) : 0;
        $rows = $this->fetchSchoolYearsRaw($conn, "WHERE school_year_id = :id", [':id' => $id]);
        $formattedRows = $this->attachActivitiesToRows($conn, $rows);
        echo json_encode($formattedRows[0] ?? null);
    }

    function getSchoolYearOverview() {
        $conn = $this->getConnection();
        $schoolYearId = intval($_GET['school_year_id'] ?? 0);
        $teacherScopeId = $this->getTeacherOverviewScope();

        if ($schoolYearId <= 0) {
            http_response_code(422);
            echo json_encode(['status' => 'error', 'message' => 'Invalid school year ID.']);
            return;
        }

        $rows = $this->fetchSchoolYearsRaw($conn, "WHERE school_year_id = :id", [':id' => $schoolYearId]);
        $formattedRows = $this->attachActivitiesToRows($conn, $rows);
        $schoolYear = $formattedRows[0] ?? null;

        if (!$schoolYear) {
            http_response_code(404);
            echo json_encode(['status' => 'error', 'message' => 'School year not found.']);
            return;
        }

        $sectionWhere = '';
        $sectionParams = [];
        if ($teacherScopeId !== null) {
            $sectionWhere = 'WHERE s.employee_id = :teacher_id';
            $sectionParams[':teacher_id'] = $teacherScopeId;
        }

        $sql = "SELECT s.section_id,
                       s.section_name,
                       s.status AS section_status,
                       c.class_id,
                       c.status AS class_status,
                       p.name AS program_name,
                       b.branch_name,
                       CONCAT(COALESCE(e.first_name, ''), CASE WHEN e.last_name IS NOT NULL AND e.last_name <> '' THEN ' ' ELSE '' END, COALESCE(e.last_name, '')) AS teacher_name
                FROM sections s
                JOIN class c ON s.class_id = c.class_id
                JOIN program p ON c.program_id = p.program_id
                JOIN branch b ON c.branch_id = b.branch_id
                LEFT JOIN employee e ON s.employee_id = e.employee_id
                {$sectionWhere}
                ORDER BY b.branch_name ASC, p.name ASC, s.section_name ASC";
        $stmt = $conn->prepare($sql);
        $stmt->execute($sectionParams);
        $sections = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $sectionIds = array_values(array_filter(array_map(function ($row) {
            return intval($row['section_id'] ?? 0);
        }, $sections)));

        $scheduleMap = [];
        if (!empty($sectionIds)) {
            $placeholders = implode(',', array_fill(0, count($sectionIds), '?'));
            $scheduleSql = "SELECT schedule_id, section_id, day_of_week, start_time, end_time
                            FROM section_schedules
                            WHERE section_id IN ($placeholders)
                            ORDER BY " . $this->dayOrderSql('day_of_week') . ", start_time";
            $scheduleStmt = $conn->prepare($scheduleSql);
            $scheduleStmt->execute($sectionIds);

            while ($schedule = $scheduleStmt->fetch(PDO::FETCH_ASSOC)) {
                $sectionId = intval($schedule['section_id']);
                if (!isset($scheduleMap[$sectionId])) {
                    $scheduleMap[$sectionId] = [];
                }
                $scheduleMap[$sectionId][] = $schedule;
            }
        }

        $sections = array_values(array_filter(array_map(function ($section) use ($scheduleMap) {
            $sectionId = intval($section['section_id'] ?? 0);
            $section['schedules'] = $scheduleMap[$sectionId] ?? [];
            return !empty($section['schedules']) ? $section : null;
        }, $sections)));

        echo json_encode([
            'status' => 'success',
            'data' => [
                'school_year' => $schoolYear,
                'sections' => $sections
            ]
        ]);
    }

    function insertSchoolYear($json) {
        $conn = $this->getConnection();
        $data = json_decode($json, true);
        $validated = $this->validatePayload($data ?: []);

        if (!$validated['valid']) {
            http_response_code(422);
            echo json_encode(['status' => 'error', 'message' => $validated['message']]);
            return;
        }

        $payload = $validated['data'];
        $previousActiveId = $this->getActiveSchoolYearId($conn);
        if ($previousActiveId <= 0) {
            $payload['sy_status'] = 'active';
        }

        try {
            $conn->beginTransaction();

            if ($payload['sy_status'] === 'active') {
                $this->setActiveStatus($conn);
            }

            $sql = "INSERT INTO school_years (
                        school_year, start_date, end_date,
                        quarter_1_start, quarter_1_end,
                        quarter_2_start, quarter_2_end,
                        quarter_3_start, quarter_3_end,
                        quarter_4_start, quarter_4_end,
                        quarters_json, sy_status
                    ) VALUES (
                        :school_year, :start_date, :end_date,
                        :quarter_1_start, :quarter_1_end,
                        :quarter_2_start, :quarter_2_end,
                        :quarter_3_start, :quarter_3_end,
                        :quarter_4_start, :quarter_4_end,
                        :quarters_json, :status
                    )";

            $stmt = $conn->prepare($sql);
            $stmt->execute([
                ':school_year' => $payload['school_year'],
                ':start_date' => $payload['start_date'],
                ':end_date' => $payload['end_date'],
                ':quarter_1_start' => $payload['quarter_1_start'],
                ':quarter_1_end' => $payload['quarter_1_end'],
                ':quarter_2_start' => $payload['quarter_2_start'],
                ':quarter_2_end' => $payload['quarter_2_end'],
                ':quarter_3_start' => $payload['quarter_3_start'],
                ':quarter_3_end' => $payload['quarter_3_end'],
                ':quarter_4_start' => $payload['quarter_4_start'],
                ':quarter_4_end' => $payload['quarter_4_end'],
                ':quarters_json' => $payload['quarters_json'],
                ':status' => $payload['sy_status']
            ]);

            $newSchoolYearId = (int) $conn->lastInsertId();
            if ($payload['sy_status'] === 'active') {
                $this->ensureSchoolYearCurriculum($conn, $newSchoolYearId, $previousActiveId);
            }

            $conn->commit();
            echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
        } catch (Throwable $e) {
            if ($conn->inTransaction()) {
                $conn->rollBack();
            }
            http_response_code(500);
            echo json_encode(['status' => 'error', 'message' => 'Unable to save school calendar.']);
        }
    }

    function updateSchoolYear($json) {
        $conn = $this->getConnection();
        $data = json_decode($json, true);
        $id = isset($data['school_year_id']) ? intval($data['school_year_id']) : 0;

        if ($id <= 0) {
            http_response_code(422);
            echo json_encode(['status' => 'error', 'message' => 'Invalid school year ID.']);
            return;
        }

        $validated = $this->validatePayload($data ?: []);
        if (!$validated['valid']) {
            http_response_code(422);
            echo json_encode(['status' => 'error', 'message' => $validated['message']]);
            return;
        }

        $payload = $validated['data'];
        $currentStmt = $conn->prepare("SELECT sy_status FROM school_years WHERE school_year_id = :id LIMIT 1");
        $currentStmt->execute([':id' => $id]);
        $currentStatus = $currentStmt->fetchColumn();
        if ($currentStatus === false) {
            http_response_code(404);
            echo json_encode(['status' => 'error', 'message' => 'School year not found.']);
            return;
        }
        if ($currentStatus === 'active' && $payload['sy_status'] !== 'active') {
            http_response_code(422);
            echo json_encode([
                'status' => 'error',
                'message' => 'One school year must remain active. Open another school year before closing this one.'
            ]);
            return;
        }
        $previousActiveId = $this->getActiveSchoolYearId($conn);

        try {
            $conn->beginTransaction();

            if ($payload['sy_status'] === 'active') {
                $this->setActiveStatus($conn, $id);
            }

            $sql = "UPDATE school_years
                    SET school_year = :school_year,
                        start_date = :start_date,
                        end_date = :end_date,
                        quarter_1_start = :quarter_1_start,
                        quarter_1_end = :quarter_1_end,
                        quarter_2_start = :quarter_2_start,
                        quarter_2_end = :quarter_2_end,
                        quarter_3_start = :quarter_3_start,
                        quarter_3_end = :quarter_3_end,
                        quarter_4_start = :quarter_4_start,
                        quarter_4_end = :quarter_4_end,
                        quarters_json = :quarters_json,
                        sy_status = :status
                    WHERE school_year_id = :id";

            $stmt = $conn->prepare($sql);
            $stmt->execute([
                ':school_year' => $payload['school_year'],
                ':start_date' => $payload['start_date'],
                ':end_date' => $payload['end_date'],
                ':quarter_1_start' => $payload['quarter_1_start'],
                ':quarter_1_end' => $payload['quarter_1_end'],
                ':quarter_2_start' => $payload['quarter_2_start'],
                ':quarter_2_end' => $payload['quarter_2_end'],
                ':quarter_3_start' => $payload['quarter_3_start'],
                ':quarter_3_end' => $payload['quarter_3_end'],
                ':quarter_4_start' => $payload['quarter_4_start'],
                ':quarter_4_end' => $payload['quarter_4_end'],
                ':quarters_json' => $payload['quarters_json'],
                ':status' => $payload['sy_status'],
                ':id' => $id
            ]);

            if ($payload['sy_status'] === 'active') {
                $this->ensureSchoolYearCurriculum($conn, $id, $previousActiveId === $id ? 0 : $previousActiveId);
            }

            $conn->commit();
            echo json_encode(1);
        } catch (Throwable $e) {
            if ($conn->inTransaction()) {
                $conn->rollBack();
            }
            http_response_code(500);
            echo json_encode(['status' => 'error', 'message' => 'Unable to update school calendar.']);
        }
    }

    function deleteSchoolYear($json) {
        $conn = $this->getConnection();
        $data = json_decode($json, true);
        $id = isset($data['school_year_id']) ? intval($data['school_year_id']) : 0;
        $statusStmt = $conn->prepare("SELECT sy_status FROM school_years WHERE school_year_id = :id LIMIT 1");
        $statusStmt->execute([':id' => $id]);
        if ($statusStmt->fetchColumn() === 'active') {
            http_response_code(422);
            echo json_encode([
                'status' => 'error',
                'message' => 'The active school year cannot be deleted. Open another school year first.'
            ]);
            return;
        }
        $sql = "DELETE FROM school_years WHERE school_year_id = :id";
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(':id', $id, PDO::PARAM_INT);
        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    function insertSchoolActivity($json) {
        $conn = $this->getConnection();
        $data = json_decode($json, true);
        $validated = $this->validateActivityPayload($conn, $data ?: []);

        if (!$validated['valid']) {
            http_response_code(422);
            echo json_encode(['status' => 'error', 'message' => $validated['message']]);
            return;
        }

        $payload = $validated['data'];
        $sql = "INSERT INTO school_activities (school_year_id, activity_title, activity_date, activity_notes, activity_status)
                VALUES (:school_year_id, :activity_title, :activity_date, :activity_notes, :activity_status)";
        $stmt = $conn->prepare($sql);
        $stmt->execute([
            ':school_year_id' => $payload['school_year_id'],
            ':activity_title' => $payload['activity_title'],
            ':activity_date' => $payload['activity_date'],
            ':activity_notes' => $payload['activity_notes'],
            ':activity_status' => $payload['activity_status']
        ]);

        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    function updateSchoolActivity($json) {
        $conn = $this->getConnection();
        $data = json_decode($json, true);
        $validated = $this->validateActivityPayload($conn, $data ?: [], true);

        if (!$validated['valid']) {
            http_response_code(422);
            echo json_encode(['status' => 'error', 'message' => $validated['message']]);
            return;
        }

        $payload = $validated['data'];
        $sql = "UPDATE school_activities
                SET school_year_id = :school_year_id,
                    activity_title = :activity_title,
                    activity_date = :activity_date,
                    activity_notes = :activity_notes,
                    activity_status = :activity_status
                WHERE school_activity_id = :school_activity_id";
        $stmt = $conn->prepare($sql);
        $stmt->execute([
            ':school_year_id' => $payload['school_year_id'],
            ':activity_title' => $payload['activity_title'],
            ':activity_date' => $payload['activity_date'],
            ':activity_notes' => $payload['activity_notes'],
            ':activity_status' => $payload['activity_status'],
            ':school_activity_id' => $payload['school_activity_id']
        ]);

        echo json_encode(1);
    }

    function archiveSchoolActivity($json) {
        $conn = $this->getConnection();
        $data = json_decode($json, true);
        $activityId = intval($data['school_activity_id'] ?? 0);

        if ($activityId <= 0) {
            http_response_code(422);
            echo json_encode(['status' => 'error', 'message' => 'Invalid school activity ID.']);
            return;
        }

        $stmt = $conn->prepare("UPDATE school_activities SET activity_status = 'inactive' WHERE school_activity_id = :id");
        $stmt->execute([':id' => $activityId]);
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }
}

$operation = "";
if ($_SERVER['REQUEST_METHOD'] == 'GET') {
    $operation = $_GET['operation'] ?? "";
    $json = $_GET['json'] ?? "";
} else if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    $operation = $_POST['operation'] ?? "";
    $json = $_POST['json'] ?? "";
}

$sy = new SchoolYear();
switch ($operation) {
    case "getSchoolYears": $sy->getSchoolYears(); break;
    case "getSchoolYear": $sy->getSchoolYear($json); break;
    case "getSchoolYearOverview": $sy->getSchoolYearOverview(); break;
    case "insertSchoolYear": $sy->insertSchoolYear($json); break;
    case "updateSchoolYear": $sy->updateSchoolYear($json); break;
    case "deleteSchoolYear": $sy->deleteSchoolYear($json); break;
    case "insertSchoolActivity": $sy->insertSchoolActivity($json); break;
    case "updateSchoolActivity": $sy->updateSchoolActivity($json); break;
    case "archiveSchoolActivity": $sy->archiveSchoolActivity($json); break;
    default: echo json_encode(["error" => "Invalid Operation"]); break;
}
