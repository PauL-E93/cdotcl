<?php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

require_once __DIR__ . '/../school_year_context.php';

class StudentEvaluation {
    private $preschoolDefaults = ['Writing', 'Reading', 'Speaking', 'Language', 'Counting/Numbering', 'Art and Craft', 'Playing/Sharing'];

    private function getDefaultLearningAreas($category = 'pre_school') {
        $names = $category === 'play_school'
            ? [
                'Social & Emotional Development: Settles comfortably in class',
                'Social & Emotional Development: Plays alongside and with other children',
                'Social & Emotional Development: Shares toys with support',
                'Social & Emotional Development: Expresses feelings using words/actions',
                'Social & Emotional Development: Shows confidence in activities',
                'Communication & Language: Understands simple instructions',
                'Communication & Language: Uses words to express needs',
                'Communication & Language: Speaks in short sentences',
                'Communication & Language: Participates in group conversations',
                'Cognitive & Early Learning: Recognizes basic colors',
                'Cognitive & Early Learning: Identifies common shapes',
                'Cognitive & Early Learning: Counts orally (1-5 / 1-10)',
                'Cognitive & Early Learning: Matches objects and pictures',
                'Cognitive & Early Learning: Shows curiosity and asks questions',
                'Fine Motor Skills: Holds crayon/pencil correctly',
                'Fine Motor Skills: Colors within space (developing)',
                'Fine Motor Skills: Builds blocks / completes simple puzzles',
                'Gross Motor Skills: Runs and jumps confidently',
                'Gross Motor Skills: Climbs and balances',
                'Gross Motor Skills: Participates in outdoor play',
                'Self-Help & Independence: Eats independently',
                'Self-Help & Independence: Uses toilet with support (if applicable)',
                'Self-Help & Independence: Packs away toys after play',
                'Creativity & Play: Enjoys pretend/role play',
                'Creativity & Play: Participates in art activities',
                'Creativity & Play: Enjoys music and movement',
                'Creativity & Play: Uses imagination during play',
                'Behavior & Routine: Follows classroom rules',
                'Behavior & Routine: Listens to teacher guidance',
                'Behavior & Routine: Manages transitions well',
                'Behavior & Routine: Shows care for friends and materials'
            ]
            : $this->preschoolDefaults;
        return array_map(function($name, $index) use ($category) {
            return ['area_id' => $index + 1, 'area_name' => $name, 'category' => $category, 'order_index' => $index + 1];
        }, $names, array_keys($names));
    }

    private function replaceLegacyPlaySchoolDefaults($conn) {
        $stmt = $conn->prepare("SELECT area_id, area_name FROM learning_areas WHERE category = 'play_school' ORDER BY order_index ASC, area_id ASC");
        $stmt->execute();
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        if (count($rows) !== count($this->preschoolDefaults)) {
            return;
        }

        foreach ($rows as $index => $row) {
            if (($row['area_name'] ?? '') !== $this->preschoolDefaults[$index]) {
                return;
            }
        }

        $defaults = $this->getDefaultLearningAreas('play_school');
        $updateStmt = $conn->prepare("UPDATE learning_areas
                                      SET area_name = :area_name, order_index = :order_index, is_active = 1
                                      WHERE area_id = :area_id");
        foreach ($rows as $index => $row) {
            $updateStmt->execute([
                ':area_name' => $defaults[$index]['area_name'],
                ':order_index' => $index + 1,
                ':area_id' => $row['area_id']
            ]);
        }

        $insertStmt = $conn->prepare("INSERT INTO learning_areas(area_name, category, order_index, is_active)
                                      VALUES(:area_name, 'play_school', :order_index, 1)");
        for ($index = count($rows); $index < count($defaults); $index++) {
            $insertStmt->execute([
                ':area_name' => $defaults[$index]['area_name'],
                ':order_index' => $index + 1
            ]);
        }
    }

    private function ensureReportCardTables($conn) {
        $conn->exec("CREATE TABLE IF NOT EXISTS learning_areas (
                        area_id INT(11) NOT NULL AUTO_INCREMENT,
                        area_name VARCHAR(100) NOT NULL,
                        category VARCHAR(50) NOT NULL DEFAULT 'pre_school',
                        order_index INT(11) NOT NULL DEFAULT 1,
                        is_active TINYINT(1) NOT NULL DEFAULT 1,
                        PRIMARY KEY (area_id),
                        KEY idx_learning_areas_category (category, is_active, order_index)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");

        $conn->exec("CREATE TABLE IF NOT EXISTS student_grades (
                        grade_id INT(11) NOT NULL AUTO_INCREMENT,
                        enrollment_details_id INT(11) NOT NULL,
                        area_id INT(11) NOT NULL,
                        quarter TINYINT(1) NOT NULL,
                        grade_value VARCHAR(10) NOT NULL,
                        PRIMARY KEY (grade_id),
                        KEY idx_student_grades_enrollment (enrollment_details_id, quarter),
                        KEY idx_student_grades_area (area_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");

        $this->ensureColumn($conn, 'remarks', 'quarter', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER employee_id');
        $this->ensureColumn($conn, 'remarks', 'overall_grade', 'VARCHAR(10) DEFAULT NULL AFTER status');
        $this->ensureColumn($conn, 'remarks', 'attendance', 'INT(11) DEFAULT NULL AFTER overall_grade');
        $this->ensureColumn($conn, 'remarks', 'total_school_days', 'INT(11) DEFAULT NULL AFTER attendance');
        $this->ensureColumn($conn, 'learning_areas', 'domain_key', 'VARCHAR(80) DEFAULT NULL AFTER category');
        $this->ensureColumn($conn, 'learning_areas', 'domain_label', 'VARCHAR(120) DEFAULT NULL AFTER domain_key');
        $this->ensureColumn($conn, 'learning_areas', 'introduced_quarter', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER domain_label');
        $this->ensureColumn($conn, 'learning_areas', 'school_year_id', 'INT(11) NULL AFTER area_id');

        $conn->exec("CREATE TABLE IF NOT EXISTS play_school_transmutation_table (
                        play_transmutation_id INT(11) NOT NULL AUTO_INCREMENT,
                        age_key VARCHAR(30) NOT NULL,
                        age_label VARCHAR(60) NOT NULL,
                        age_order INT(11) NOT NULL DEFAULT 1,
                        scaled_score TINYINT(2) NOT NULL,
                        gross_motor VARCHAR(20) NOT NULL DEFAULT '-',
                        fine_motor VARCHAR(20) NOT NULL DEFAULT '-',
                        self_help VARCHAR(20) NOT NULL DEFAULT '-',
                        receptive_language VARCHAR(20) NOT NULL DEFAULT '-',
                        expressive_language VARCHAR(20) NOT NULL DEFAULT '-',
                        cognitive VARCHAR(20) NOT NULL DEFAULT '-',
                        social_emotional VARCHAR(20) NOT NULL DEFAULT '-',
                        extra_ranges TEXT DEFAULT NULL,
                        order_index INT(11) NOT NULL DEFAULT 1,
                        PRIMARY KEY (play_transmutation_id),
                        UNIQUE KEY uq_play_school_transmutation_age_score (age_key, scaled_score),
                        KEY idx_play_school_transmutation_order (age_order, order_index)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");
        $this->ensureColumn($conn, 'play_school_transmutation_table', 'extra_ranges', 'TEXT DEFAULT NULL AFTER social_emotional');
        $this->ensureColumn($conn, 'play_school_transmutation_table', 'is_archived', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER order_index');

        $conn->exec("CREATE TABLE IF NOT EXISTS play_school_standard_score_table (
                        standard_score_id INT(11) NOT NULL AUTO_INCREMENT,
                        sum_scaled_score INT(11) NOT NULL,
                        standard_score INT(11) NOT NULL,
                        order_index INT(11) NOT NULL DEFAULT 1,
                        PRIMARY KEY (standard_score_id),
                        UNIQUE KEY uq_play_school_standard_sum (sum_scaled_score),
                        KEY idx_play_school_standard_order (order_index)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");
        $this->ensureColumn($conn, 'play_school_standard_score_table', 'is_archived', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER order_index');

        $conn->exec("CREATE TABLE IF NOT EXISTS play_school_score_interpretations (
                        interpretation_id INT(11) NOT NULL AUTO_INCREMENT,
                        score_type ENUM('scaled','standard') NOT NULL,
                        min_score INT(11) DEFAULT NULL,
                        max_score INT(11) DEFAULT NULL,
                        interpretation_code VARCHAR(50) NOT NULL,
                        interpretation_label VARCHAR(500) NOT NULL,
                        development_level VARCHAR(30) NOT NULL DEFAULT 'average',
                        follow_up_months TINYINT(2) DEFAULT NULL,
                        order_index INT(11) NOT NULL DEFAULT 1,
                        PRIMARY KEY (interpretation_id),
                        UNIQUE KEY uq_play_school_interpretation (score_type, order_index)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");
        $this->ensureColumn($conn, 'play_school_score_interpretations', 'is_archived', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER order_index');
    }

    private function ensureColumn($conn, $table, $column, $definition) {
        $stmt = $conn->prepare("SELECT COUNT(*)
                                FROM INFORMATION_SCHEMA.COLUMNS
                                WHERE TABLE_SCHEMA = DATABASE()
                                  AND TABLE_NAME = :table_name
                                  AND COLUMN_NAME = :column_name");
        $stmt->execute([
            ':table_name' => $table,
            ':column_name' => $column
        ]);

        if ((int) $stmt->fetchColumn() === 0) {
            $conn->exec("ALTER TABLE `{$table}` ADD COLUMN `{$column}` {$definition}");
        }
    }

    private function getReportCardCategory($programName) {
        return 'play_school';
    }

    private function getLearningAreas($conn, $category = 'pre_school', $schoolYearId = 0) {
        try {
            $this->ensureReportCardTables($conn);
            if ($category === 'play_school') {
                $this->replaceLegacyPlaySchoolDefaults($conn);
            }
            $scopeSchoolYearId = tcResolveLearningAreaSchoolYearId($conn, $schoolYearId);
            $scopeSql = $scopeSchoolYearId === null
                ? 'school_year_id IS NULL'
                : 'school_year_id = :school_year_id';
            $sql = "SELECT area_id, area_name, category, domain_key, domain_label, introduced_quarter, order_index
                    FROM learning_areas
                    WHERE category = :category AND is_active = 1 AND {$scopeSql}
                    ORDER BY order_index ASC, area_id ASC";
            $stmt = $conn->prepare($sql);
            $params = [':category' => $category];
            if ($scopeSchoolYearId !== null) $params[':school_year_id'] = $scopeSchoolYearId;
            $stmt->execute($params);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            return $rows ?: $this->getDefaultLearningAreas($category);
        } catch (Exception $e) {
            return $this->getDefaultLearningAreas($category);
        }
    }

    private function ensureSession() {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }
    }

    private function requireStudent() {
        $this->ensureSession();

        if (!isset($_SESSION['user_id'])) {
            echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
            return null;
        }

        return (int) $_SESSION['user_id'];
    }

    private function studentOwnsEnrollment($conn, $studentId, $enrollmentDetailsId) {
        $sql = "SELECT ed.enrollment_details_id
                FROM enrollment_details ed
                JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                WHERE ed.enrollment_details_id = :enrollment_details_id
                  AND eh.student_id = :student_id
                LIMIT 1";
        $stmt = $conn->prepare($sql);
        $stmt->execute([
            ':enrollment_details_id' => $enrollmentDetailsId,
            ':student_id' => $studentId
        ]);

        return (bool) $stmt->fetch(PDO::FETCH_ASSOC);
    }

    private function getEnrollmentDetails($conn, $enrollmentDetailsId) {
        $sql = "SELECT ed.enrollment_details_id,
                       TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
                       p.name AS program_name,
                       sec.section_name,
                       CONCAT(sec_teacher.first_name, ' ', sec_teacher.last_name) AS section_teacher,
                       eh.school_year_id,
                       sy.school_year
                FROM enrollment_details ed
                JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                JOIN student st ON eh.student_id = st.student_id
                LEFT JOIN program p ON ed.program_id = p.program_id
                LEFT JOIN sections sec ON ed.section_id = sec.section_id
                LEFT JOIN employee sec_teacher ON sec.employee_id = sec_teacher.employee_id
                LEFT JOIN school_years sy ON eh.school_year_id = sy.school_year_id
                WHERE ed.enrollment_details_id = :enrollment_details_id
                LIMIT 1";
        $stmt = $conn->prepare($sql);
        $stmt->execute([':enrollment_details_id' => $enrollmentDetailsId]);
        return $stmt->fetch(PDO::FETCH_ASSOC);
    }

    private function formatQuarter($row, $gradeRows = [], $learningAreas = []) {
        if (!$row) {
            return null;
        }

        $grades = [];
        $gradeMap = [];
        foreach ($gradeRows as $gradeRow) {
            $gradeMap[(int) $gradeRow['area_id']] = $gradeRow['grade_value'] ?? '';
        }

        foreach ($learningAreas as $index => $area) {
            $areaId = (int) ($area['area_id'] ?? ($index + 1));
            $grades[] = [
                'area_id' => $areaId,
                'label' => $area['area_name'],
                'grade' => $gradeMap[$areaId] ?? ''
            ];
        }

        return [
            'quarter' => (int) ($row['quarter'] ?? 1),
            'overall_grade' => $row['overall_grade'] ?? '',
            'status' => $row['status'] ?? '',
            'attendance' => isset($row['attendance']) ? (int) $row['attendance'] : null,
            'total_school_days' => isset($row['total_school_days']) ? (int) $row['total_school_days'] : null,
            'remarks' => $row['remarks'] ?? '',
            'teacher_name' => $row['teacher_name'] ?? 'Teacher',
            'grades' => $grades
        ];
    }

    private function getQuarter($conn, $enrollmentDetailsId, $quarter) {
        $sql = "SELECT r.quarter,
                       r.status,
                       r.overall_grade,
                       r.attendance,
                       r.total_school_days,
                       r.evaluation AS remarks,
                       CONCAT(emp.first_name, ' ', emp.last_name) AS teacher_name
                FROM remarks r
                LEFT JOIN employee emp ON r.employee_id = emp.employee_id
                WHERE r.enrollment_details_id = :enrollment_details_id
                  AND r.quarter = :quarter
                ORDER BY r.remarks_id DESC
                LIMIT 1";
        $stmt = $conn->prepare($sql);
        $stmt->execute([
            ':enrollment_details_id' => $enrollmentDetailsId,
            ':quarter' => $quarter
        ]);

        $remark = $stmt->fetch(PDO::FETCH_ASSOC);

        $gradeSql = "SELECT sg.area_id, sg.grade_value, la.area_name, la.order_index
                     FROM student_grades sg
                     JOIN learning_areas la ON sg.area_id = la.area_id
                     WHERE sg.enrollment_details_id = :enrollment_details_id
                       AND sg.quarter = :quarter
                     ORDER BY la.order_index ASC, la.area_id ASC";
        $gradeStmt = $conn->prepare($gradeSql);
        $gradeStmt->execute([
            ':enrollment_details_id' => $enrollmentDetailsId,
            ':quarter' => $quarter
        ]);
        $gradeRows = $gradeStmt->fetchAll(PDO::FETCH_ASSOC);

        if (!$remark && !$gradeRows) return null;

        if (!$remark) {
            $remark = [
                'quarter' => $quarter,
                'status' => '',
                'overall_grade' => '',
                'attendance' => null,
                'total_school_days' => null,
                'remarks' => '',
                'teacher_name' => 'Teacher'
            ];
        }

        return ['remark' => $remark, 'grades' => $gradeRows];
    }

    private function getPlaySchoolTransmutationTables($conn) {
        try {
            $sql = "SELECT play_transmutation_id,
                           age_key,
                           age_label,
                           age_order,
                           scaled_score,
                           gross_motor,
                           fine_motor,
                           self_help,
                           receptive_language,
                           expressive_language,
                           cognitive,
                           social_emotional,
                           extra_ranges,
                           order_index
                FROM play_school_transmutation_table
                WHERE COALESCE(is_archived, 0) = 0
                ORDER BY age_order ASC, order_index ASC, scaled_score ASC";
            $stmt = $conn->prepare($sql);
            $stmt->execute();
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            $tables = [];

            foreach ($rows as $row) {
                $ageKey = $row['age_key'];
                if (!isset($tables[$ageKey])) {
                    $tables[$ageKey] = [
                        'age_key' => $ageKey,
                        'age_label' => $row['age_label'],
                        'age_order' => (int) $row['age_order'],
                        'rows' => []
                    ];
                }

                $extraRanges = json_decode((string) ($row['extra_ranges'] ?? ''), true);
                $dynamicRanges = is_array($extraRanges) ? $extraRanges : [];

                $tables[$ageKey]['rows'][] = array_merge([
                    'play_transmutation_id' => (int) $row['play_transmutation_id'],
                    'scaled_score' => (int) $row['scaled_score'],
                    'gross_motor' => $row['gross_motor'],
                    'fine_motor' => $row['fine_motor'],
                    'self_help' => $row['self_help'],
                    'receptive_language' => $row['receptive_language'],
                    'expressive_language' => $row['expressive_language'],
                    'cognitive' => $row['cognitive'],
                    'social_emotional' => $row['social_emotional'],
                    'order_index' => (int) $row['order_index']
                ], $dynamicRanges);
            }

            return array_values($tables);
        } catch (Exception $e) {
            return [];
        }
    }

    private function getPlaySchoolStandardScoreRows($conn) {
        try {
            $sql = "SELECT standard_score_id,
                           sum_scaled_score,
                           standard_score,
                           order_index
                    FROM play_school_standard_score_table
                    WHERE COALESCE(is_archived, 0) = 0
                    ORDER BY order_index ASC, sum_scaled_score ASC";
            $stmt = $conn->prepare($sql);
            $stmt->execute();

            return array_map(function($row) {
                return [
                    'standard_score_id' => (int) $row['standard_score_id'],
                    'sum_scaled_score' => (int) $row['sum_scaled_score'],
                    'standard_score' => (int) $row['standard_score'],
                    'order_index' => (int) $row['order_index']
                ];
            }, $stmt->fetchAll(PDO::FETCH_ASSOC));
        } catch (Exception $e) {
            return [];
        }
    }

    private function getPlaySchoolInterpretations($conn) {
        try {
            $rows = $conn->query("SELECT interpretation_id, score_type, min_score, max_score,
                                        interpretation_code, interpretation_label, development_level,
                                        follow_up_months, order_index
                                 FROM play_school_score_interpretations
                                 WHERE COALESCE(is_archived, 0) = 0
                                 ORDER BY score_type, order_index")
                         ->fetchAll(PDO::FETCH_ASSOC);
            $result = ['scaled' => [], 'standard' => []];
            foreach ($rows as $row) {
                $result[$row['score_type']][] = [
                    'interpretation_id' => (int) $row['interpretation_id'],
                    'min' => $row['min_score'] === null ? null : (int) $row['min_score'],
                    'max' => $row['max_score'] === null ? null : (int) $row['max_score'],
                    'code' => $row['interpretation_code'], 'label' => $row['interpretation_label'],
                    'level' => $row['development_level'],
                    'follow_up_months' => $row['follow_up_months'] === null ? null : (int) $row['follow_up_months'],
                    'order_index' => (int) $row['order_index']
                ];
            }
            return $result;
        } catch (Exception $e) {
            return [];
        }
    }

    private function getReportCard($conn, $enrollmentDetailsId, $category = 'pre_school') {
        $schoolYear = tcGetEnrollmentSchoolYearContext($conn, $enrollmentDetailsId);
        $learningAreas = $this->getLearningAreas($conn, $category, $schoolYear['school_year_id'] ?? 0);
        $quarters = [];
        $quarterCount = max(1, (int) ($schoolYear['quarter_count'] ?? 3));
        for ($quarter = 1; $quarter <= $quarterCount; $quarter++) {
            $quarterData = $this->getQuarter($conn, $enrollmentDetailsId, $quarter);
            $quarters[(string) $quarter] = $quarterData
                ? $this->formatQuarter($quarterData['remark'], $quarterData['grades'], $learningAreas)
                : null;
        }

        $reportCard = [
            'school_year' => $schoolYear,
            'learning_areas' => array_map(function($area) {
                return [
                    'area_id' => (int) $area['area_id'],
                    'label' => $area['area_name'],
                    'domain_key' => $area['domain_key'] ?? '',
                    'domain_label' => $area['domain_label'] ?? '',
                    'introduced_quarter' => (int) ($area['introduced_quarter'] ?? 1)
                ];
            }, $learningAreas),
            'quarters' => $quarters,
            'grading_system' => [
                ['grade' => 'A+', 'label' => 'Excellent'],
                ['grade' => 'A', 'label' => 'Outstanding'],
                ['grade' => 'B', 'label' => 'Very Good'],
                ['grade' => 'C', 'label' => 'Good'],
                ['grade' => 'D', 'label' => 'Satisfaction'],
                ['grade' => 'F', 'label' => 'Fair']
            ]
        ];

        if ($category === 'play_school') {
            $reportCard['play_school_transmutation'] = $this->getPlaySchoolTransmutationTables($conn);
            $reportCard['play_school_standard_scores'] = $this->getPlaySchoolStandardScoreRows($conn);
            $reportCard['play_school_interpretations'] = $this->getPlaySchoolInterpretations($conn);
        }

        return $reportCard;
    }

    function getPreschoolReportCard() {
        $studentId = $this->requireStudent();
        if ($studentId === null) return;
        include "../admin/connection-pdo.php";

        $enrollmentDetailsId = isset($_GET['enrollment_details_id']) ? (int) $_GET['enrollment_details_id'] : 0;
        if ($enrollmentDetailsId <= 0) {
            echo json_encode(['status' => 'error', 'message' => 'Missing enrollment_details_id']);
            return;
        }

        if (!$this->studentOwnsEnrollment($conn, $studentId, $enrollmentDetailsId)) {
            echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
            return;
        }

        $details = $this->getEnrollmentDetails($conn, $enrollmentDetailsId);
        $category = $this->getReportCardCategory($details['program_name'] ?? '');
        echo json_encode([
            'status' => 'success',
            'data' => [
                'details' => $details,
                'report_card' => $this->getReportCard($conn, $enrollmentDetailsId, $category)
            ]
        ]);
    }
}

$operation = $_GET['operation'] ?? '';
$evaluation = new StudentEvaluation();

switch ($operation) {
    case 'getPreschoolReportCard':
        $evaluation->getPreschoolReportCard();
        break;
    default:
        echo json_encode(['status' => 'error', 'message' => 'Invalid Operation']);
        break;
}
?>
