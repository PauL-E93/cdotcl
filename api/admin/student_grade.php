<?php
// api/admin/student_grades.php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

require_once __DIR__ . '/../school_year_context.php';

function studentGradeJsonEncode($payload) {
    $json = json_encode($payload, JSON_INVALID_UTF8_SUBSTITUTE | JSON_UNESCAPED_UNICODE);
    return $json === false
        ? '{"status":"error","message":"Unable to encode the report-card response."}'
        : $json;
}

// Shared hosts commonly hide fatal PHP output behind an empty response. Keep
// the API contract valid so the browser can show a useful error instead.
register_shutdown_function(function() {
    $error = error_get_last();
    if (!$error || !in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        return;
    }

    error_log(sprintf(
        'Student grade API fatal error: %s in %s:%d',
        $error['message'],
        $error['file'],
        $error['line']
    ));

    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
        http_response_code(500);
    }
    echo studentGradeJsonEncode([
        'status' => 'error',
        'message' => 'The hosted server could not load the ECCD checklist.'
    ]);
});

class StudentGradeManager {
    private $gradeOptions = ['A+', 'A', 'B', 'C', 'D', 'F'];
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
            $domain = $category === 'play_school' ? $this->inferDomainFromAreaName($name) : ['domain_key' => '', 'domain_label' => ''];
            return [
                'area_id' => $index + 1,
                'area_name' => $domain['area_name'] ?? $name,
                'category' => $category,
                'domain_key' => $domain['domain_key'] ?? '',
                'domain_label' => $domain['domain_label'] ?? '',
                'order_index' => $index + 1,
                'is_active' => 1
            ];
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

    private function ensureTable($conn) {
        $conn->exec("CREATE TABLE IF NOT EXISTS learning_areas (
                    area_id INT(11) NOT NULL AUTO_INCREMENT,
                    area_name VARCHAR(100) NOT NULL,
                    category VARCHAR(50) NOT NULL DEFAULT 'pre_school',
                    order_index INT(11) NOT NULL DEFAULT 1,
                    is_active TINYINT(1) NOT NULL DEFAULT 1,
                    weight_percentage DECIMAL(5,2) NOT NULL DEFAULT 0.00,
                    default_perfect_score DECIMAL(5,2) NOT NULL DEFAULT 100.00,
                    PRIMARY KEY (area_id),
                    KEY idx_learning_areas_category (category, is_active, order_index)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");
        $this->ensureColumn($conn, 'learning_areas', 'weight_percentage', 'DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER is_active');
        $this->ensureColumn($conn, 'learning_areas', 'default_perfect_score', 'DECIMAL(5,2) NOT NULL DEFAULT 100.00 AFTER weight_percentage');
        $this->ensureColumn($conn, 'learning_areas', 'domain_key', 'VARCHAR(80) DEFAULT NULL AFTER category');
        $this->ensureColumn($conn, 'learning_areas', 'domain_label', 'VARCHAR(120) DEFAULT NULL AFTER domain_key');
        $this->ensureColumn($conn, 'learning_areas', 'introduced_quarter', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER domain_label');
        $this->ensureColumn($conn, 'learning_areas', 'school_year_id', 'INT(11) NULL AFTER area_id');

        $conn->exec("CREATE TABLE IF NOT EXISTS transmutation_table (
                    transmutation_id INT(11) NOT NULL AUTO_INCREMENT,
                    min_percentage DECIMAL(5,2) NOT NULL,
                    max_percentage DECIMAL(5,2) NOT NULL,
                    transmuted_letter VARCHAR(5) NOT NULL,
                    PRIMARY KEY (transmutation_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");

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
        $interpretationCount = (int) $conn->query("SELECT COUNT(*) FROM play_school_score_interpretations")->fetchColumn();
        if ($interpretationCount === 0) {
            $defaults = [
                ['scaled', 1, 3, 'monitor_3_months', 'Development in the domain must be monitored after 3 months', 'below_expected', 3, 1],
                ['scaled', 4, 6, 'monitor_6_months', 'Development in the domain must be monitored after 6 months', 'below_expected', 6, 2],
                ['scaled', 7, 13, 'average', 'Average development', 'average', null, 3],
                ['scaled', 14, 16, 'slightly_advanced', 'Suggests slightly advanced development in the domain', 'advanced', null, 4],
                ['scaled', 17, 19, 'highly_advanced', 'Suggests highly advanced development in the domain', 'advanced', null, 5],
                ['standard', null, 69, 'monitor_3_months', 'Overall development must be monitored after 3 months', 'below_expected', 3, 1],
                ['standard', 70, 79, 'monitor_6_months', 'Overall development must be monitored after 6 months', 'below_expected', 6, 2],
                ['standard', 80, 119, 'average', 'Average overall development', 'average', null, 3],
                ['standard', 120, 129, 'slightly_advanced', 'Slightly advanced overall development', 'advanced', null, 4],
                ['standard', 130, null, 'highly_advanced', 'Highly advanced overall development', 'advanced', null, 5]
            ];
            $insert = $conn->prepare("INSERT INTO play_school_score_interpretations
                (score_type, min_score, max_score, interpretation_code, interpretation_label, development_level, follow_up_months, order_index)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
            foreach ($defaults as $row) $insert->execute($row);
        }

        $conn->exec("CREATE TABLE IF NOT EXISTS assessments (
                    assessment_id INT(11) NOT NULL AUTO_INCREMENT,
                    employee_id INT(11) NOT NULL,
                    area_id INT(11) NOT NULL,
                    quarter TINYINT(1) NOT NULL DEFAULT 1,
                    title VARCHAR(255) NOT NULL,
                    highest_possible_score DECIMAL(5,2) NOT NULL,
                    date_given DATE DEFAULT NULL,
                    PRIMARY KEY (assessment_id),
                    KEY idx_assessments_area_quarter (area_id, quarter),
                    KEY idx_assessments_employee (employee_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");
        $this->ensureColumn($conn, 'assessments', 'quarter', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER area_id');

        $conn->exec("CREATE TABLE IF NOT EXISTS student_scores (
                    score_id INT(11) NOT NULL AUTO_INCREMENT,
                    assessment_id INT(11) NOT NULL,
                    enrollment_details_id INT(11) NOT NULL,
                    raw_score DECIMAL(5,2) NOT NULL,
                    PRIMARY KEY (score_id),
                    KEY idx_student_scores_assessment (assessment_id),
                    KEY idx_student_scores_enrollment (enrollment_details_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");

        $sql = "CREATE TABLE IF NOT EXISTS student_grades (
                    grade_id INT(11) NOT NULL AUTO_INCREMENT,
                    enrollment_details_id INT(11) NOT NULL,
                    area_id INT(11) NOT NULL,
                    quarter TINYINT(1) NOT NULL,
                    grade_value VARCHAR(10) NOT NULL,
                    PRIMARY KEY (grade_id),
                    KEY idx_student_grades_enrollment (enrollment_details_id, quarter),
                    KEY idx_student_grades_area (area_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci";
        $conn->exec($sql);

        $this->ensureColumn($conn, 'remarks', 'quarter', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER employee_id');
        $this->ensureColumn($conn, 'remarks', 'overall_grade', 'VARCHAR(10) DEFAULT NULL AFTER status');
        $this->ensureColumn($conn, 'remarks', 'attendance', 'INT(11) DEFAULT NULL AFTER overall_grade');
        $this->ensureColumn($conn, 'remarks', 'total_school_days', 'INT(11) DEFAULT NULL AFTER attendance');

        $hasAnyLearningAreas = (int) $conn->query("SELECT COUNT(*) FROM learning_areas")->fetchColumn() > 0;
        foreach (['pre_school', 'play_school'] as $category) {
            $countStmt = $conn->prepare("SELECT COUNT(*) FROM learning_areas WHERE category = :category");
            $countStmt->execute([':category' => $category]);
            if ((int) $countStmt->fetchColumn() > 0) {
                if ($category === 'play_school') {
                    $this->replaceLegacyPlaySchoolDefaults($conn);
                }
                continue;
            }

            if ($hasAnyLearningAreas) {
                continue;
            }

            $insertStmt = $conn->prepare("INSERT INTO learning_areas(area_name, category, order_index, is_active, weight_percentage, default_perfect_score)
                                          VALUES(:area_name, :category, :order_index, 1, 0, 100)");
            foreach ($this->getDefaultLearningAreas($category) as $area) {
                $insertStmt->execute([
                    ':area_name' => $area['area_name'],
                    ':category' => $category,
                    ':order_index' => $area['order_index']
                ]);
            }
        }

        $this->backfillPlaySchoolLearningAreaDomains($conn);
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

    private function ensureSession() {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }
    }

    private function getPayload() {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true);

        if (!is_array($data)) {
            $data = $_POST;
        }

        if (isset($data['json'])) {
            $jsonData = json_decode($data['json'], true);
            if (is_array($jsonData)) {
                $data = array_merge($data, $jsonData);
            }
        }

        return $data;
    }

    private function requireTeacher() {
        $this->ensureSession();

        if (!isset($_SESSION['user_id'])) {
            echo studentGradeJsonEncode(['status' => 'error', 'message' => 'Unauthorized']);
            return null;
        }

        return (int) $_SESSION['user_id'];
    }

    private function getUserRole() {
        $this->ensureSession();
        return strtolower(trim($_SESSION['user_role'] ?? ''));
    }

    private function isAdminRole($role) {
        return in_array($role, ['owner', 'secretary', 'branch admin', 'auditor'], true);
    }

    private function getBranchAdminBranchId($role) {
        $role = preg_replace('/[\s_-]+/', ' ', strtolower(trim((string) $role)));
        if ($role !== 'branch admin') {
            return null;
        }

        $branchId = (int) ($_SESSION['branch_id'] ?? 0);
        return $branchId > 0 ? $branchId : -1;
    }

    private function canAccessSection($conn, $sectionId, $employeeId, $role) {
        $branchId = $this->getBranchAdminBranchId($role);
        if ($branchId) {
            $sql = "SELECT sec.section_id
                    FROM sections sec
                    JOIN class c ON sec.class_id = c.class_id
                    WHERE sec.section_id = :section_id
                      AND c.branch_id = :branch_id
                    LIMIT 1";
            $stmt = $conn->prepare($sql);
            $stmt->execute([
                ':section_id' => $sectionId,
                ':branch_id' => $branchId
            ]);

            return (bool) $stmt->fetch(PDO::FETCH_ASSOC);
        }

        if ($this->isAdminRole($role)) {
            return true;
        }

        $sql = "SELECT section_id
                FROM sections
                WHERE section_id = :section_id
                  AND employee_id = :employee_id
                LIMIT 1";
        $stmt = $conn->prepare($sql);
        $stmt->execute([
            ':section_id' => $sectionId,
            ':employee_id' => $employeeId
        ]);

        return (bool) $stmt->fetch(PDO::FETCH_ASSOC);
    }

    private function teacherCanAccessEnrollment($conn, $enrollmentDetailsId, $teacherId) {
        $role = $this->getUserRole();
        $branchId = $this->getBranchAdminBranchId($role);
        if ($branchId) {
            $sql = "SELECT ed.enrollment_details_id
                    FROM enrollment_details ed
                    JOIN sections sec ON ed.section_id = sec.section_id
                    JOIN class c ON sec.class_id = c.class_id
                    WHERE ed.enrollment_details_id = :enrollment_details_id
                      AND c.branch_id = :branch_id
                    LIMIT 1";
            $stmt = $conn->prepare($sql);
            $stmt->execute([
                ':enrollment_details_id' => $enrollmentDetailsId,
                ':branch_id' => $branchId
            ]);

            return (bool) $stmt->fetch(PDO::FETCH_ASSOC);
        }

        if ($this->isAdminRole($role)) {
            return true;
        }

        $sql = "SELECT ed.enrollment_details_id
                FROM enrollment_details ed
                LEFT JOIN sections sec ON ed.section_id = sec.section_id
                WHERE ed.enrollment_details_id = :enrollment_details_id
                  AND (ed.preferred_teacher = :teacher_id OR sec.employee_id = :teacher_id)
                LIMIT 1";
        $stmt = $conn->prepare($sql);
        $stmt->execute([
            ':enrollment_details_id' => $enrollmentDetailsId,
            ':teacher_id' => $teacherId
        ]);

        return (bool) $stmt->fetch(PDO::FETCH_ASSOC);
    }

    private function getReportCardCategory($programName) {
        return 'play_school';
    }

    private function normalizeDomainKey($value) {
        $value = strtolower(trim((string) $value));
        $value = str_replace('&', ' and ', $value);
        $value = preg_replace('/[^a-z0-9]+/', '_', $value);
        $value = trim($value, '_');
        return substr($value, 0, 80);
    }

    private function inferDomainFromAreaName($areaName) {
        $name = trim((string) $areaName);
        $domainLabel = '';
        $itemName = $name;

        if (strpos($name, ':') !== false) {
            $parts = explode(':', $name);
            $domainLabel = trim(array_shift($parts));
            $itemName = trim(implode(':', $parts));
        }

        $lower = strtolower($name);
        if (strpos($lower, 'gross') !== false) $domainLabel = 'Gross Motor';
        elseif (strpos($lower, 'fine') !== false) $domainLabel = 'Fine Motor';
        elseif (strpos($lower, 'self') !== false || strpos($lower, 'independence') !== false || strpos($lower, 'toilet') !== false || strpos($lower, 'eats') !== false) $domainLabel = 'Self-Help';
        elseif (strpos($lower, 'understand') !== false || strpos($lower, 'instruction') !== false || strpos($lower, 'receptive') !== false) $domainLabel = 'Receptive Language';
        elseif (strpos($lower, 'speak') !== false || strpos($lower, 'conversation') !== false || strpos($lower, 'uses words') !== false || strpos($lower, 'expressive') !== false) $domainLabel = 'Expressive Language';
        elseif (strpos($lower, 'social') !== false || strpos($lower, 'emotional') !== false || strpos($lower, 'behavior') !== false || strpos($lower, 'friend') !== false) $domainLabel = 'Social-Emotional';
        elseif (strpos($lower, 'cognitive') !== false || strpos($lower, 'color') !== false || strpos($lower, 'shape') !== false || strpos($lower, 'count') !== false || strpos($lower, 'creativity') !== false || strpos($lower, 'play') !== false) $domainLabel = 'Cognitive';

        return [
            'area_name' => $itemName !== '' ? $itemName : $name,
            'domain_label' => $domainLabel,
            'domain_key' => $this->normalizeDomainKey($domainLabel)
        ];
    }

    private function backfillPlaySchoolLearningAreaDomains($conn) {
        $stmt = $conn->prepare("SELECT area_id, area_name, domain_key, domain_label
                                FROM learning_areas
                                WHERE category = 'play_school'
                                  AND (domain_key IS NULL OR domain_key = '' OR domain_label IS NULL OR domain_label = '')");
        $stmt->execute();
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        if (!$rows) return;

        $updateStmt = $conn->prepare("UPDATE learning_areas
                                      SET area_name = :area_name,
                                          domain_key = :domain_key,
                                          domain_label = :domain_label
                                      WHERE area_id = :area_id");
        foreach ($rows as $row) {
            $inferred = $this->inferDomainFromAreaName($row['area_name']);
            if ($inferred['domain_key'] === '') continue;
            $updateStmt->execute([
                ':area_name' => $inferred['area_name'],
                ':domain_key' => $inferred['domain_key'],
                ':domain_label' => $inferred['domain_label'],
                ':area_id' => (int) $row['area_id']
            ]);
        }
    }

    private function getLearningAreas($conn, $category = 'pre_school', $schoolYearId = 0) {
        $scopeSchoolYearId = tcResolveLearningAreaSchoolYearId($conn, $schoolYearId);
        $scopeSql = $scopeSchoolYearId === null
            ? 'school_year_id IS NULL'
            : 'school_year_id = :school_year_id';
        $sql = "SELECT area_id,
                       area_name,
                       category,
                       domain_key,
                       domain_label,
                       introduced_quarter,
                       order_index,
                       is_active,
                       weight_percentage,
                       default_perfect_score
                FROM learning_areas
                WHERE category = :category AND is_active = 1 AND {$scopeSql}
                ORDER BY order_index ASC, area_id ASC";
        $stmt = $conn->prepare($sql);
        $params = [':category' => $category];
        if ($scopeSchoolYearId !== null) $params[':school_year_id'] = $scopeSchoolYearId;
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        return $rows ?: $this->getDefaultLearningAreas($category);
    }

    private function getTransmutationRows($conn) {
        $stmt = $conn->prepare("SELECT transmutation_id, min_percentage, max_percentage, transmuted_letter
                                FROM transmutation_table
                                ORDER BY max_percentage DESC, min_percentage DESC, transmutation_id ASC");
        $stmt->execute();
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        if ($rows) {
            return $rows;
        }

        return [
            ['min_percentage' => 95, 'max_percentage' => 100, 'transmuted_letter' => 'A+'],
            ['min_percentage' => 90, 'max_percentage' => 94.99, 'transmuted_letter' => 'A'],
            ['min_percentage' => 85, 'max_percentage' => 89.99, 'transmuted_letter' => 'B'],
            ['min_percentage' => 80, 'max_percentage' => 84.99, 'transmuted_letter' => 'C'],
            ['min_percentage' => 75, 'max_percentage' => 79.99, 'transmuted_letter' => 'D'],
            ['min_percentage' => 0, 'max_percentage' => 74.99, 'transmuted_letter' => 'F']
        ];
    }

    private function getTransmutedLetter($conn, $percentage) {
        foreach ($this->getTransmutationRows($conn) as $row) {
            $min = (float) ($row['min_percentage'] ?? 0);
            $max = (float) ($row['max_percentage'] ?? 0);
            if ($percentage >= $min && $percentage <= $max) {
                return strtoupper(trim((string) ($row['transmuted_letter'] ?? 'F')));
            }
        }

        return 'F';
    }

    private function getPlaySchoolTransmutationTables($conn) {
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
    }

    private function getPlaySchoolStandardScoreRows($conn) {
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
    }

    private function getPlaySchoolInterpretations($conn) {
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
    }

    private function calculateWeightedAverage($scores, $learningAreas) {
        $scoreMap = [];
        foreach ($scores as $score) {
            $scoreMap[(int) ($score['area_id'] ?? 0)] = $score;
        }

        $weightedTotal = 0;
        $weightTotal = 0;
        $simpleTotal = 0;
        $simpleCount = 0;

        foreach ($learningAreas as $area) {
            $areaId = (int) ($area['area_id'] ?? 0);
            if (!$areaId || !isset($scoreMap[$areaId])) {
                continue;
            }

            $perfectScore = max(1, (float) ($area['default_perfect_score'] ?? 100));
            $rawScore = (float) ($scoreMap[$areaId]['raw_score'] ?? 0);
            $percentage = max(0, min(100, ($rawScore / $perfectScore) * 100));
            $weight = max(0, (float) ($area['weight_percentage'] ?? 0));

            $simpleTotal += $percentage;
            $simpleCount++;

            if ($weight > 0) {
                $weightedTotal += $percentage * $weight;
                $weightTotal += $weight;
            }
        }

        if ($weightTotal > 0) {
            return round($weightedTotal / $weightTotal, 2);
        }

        return $simpleCount > 0 ? round($simpleTotal / $simpleCount, 2) : null;
    }

    private function ensureAssessment($conn, $employeeId, $area, $quarter) {
        $areaId = (int) ($area['area_id'] ?? 0);
        $title = (string) ($area['area_name'] ?? 'Assessment');
        $highestPossibleScore = max(1, (float) ($area['default_perfect_score'] ?? 100));

        $findSql = "SELECT assessment_id
                    FROM assessments
                    WHERE employee_id = :employee_id
                      AND area_id = :area_id
                      AND quarter = :quarter
                    LIMIT 1";
        $findStmt = $conn->prepare($findSql);
        $findStmt->execute([
            ':employee_id' => $employeeId,
            ':area_id' => $areaId,
            ':quarter' => $quarter
        ]);
        $assessmentId = $findStmt->fetchColumn();

        if ($assessmentId) {
            $updateStmt = $conn->prepare("UPDATE assessments
                                          SET title = :title,
                                              highest_possible_score = :highest_possible_score
                                          WHERE assessment_id = :assessment_id");
            $updateStmt->execute([
                ':title' => $title,
                ':highest_possible_score' => $highestPossibleScore,
                ':assessment_id' => $assessmentId
            ]);

            return (int) $assessmentId;
        }

        $insertStmt = $conn->prepare("INSERT INTO assessments(employee_id, area_id, quarter, title, highest_possible_score, date_given)
                                      VALUES(:employee_id, :area_id, :quarter, :title, :highest_possible_score, CURDATE())");
        $insertStmt->execute([
            ':employee_id' => $employeeId,
            ':area_id' => $areaId,
            ':quarter' => $quarter,
            ':title' => $title,
            ':highest_possible_score' => $highestPossibleScore
        ]);

        return (int) $conn->lastInsertId();
    }

    private function upsertStudentGrade($conn, $enrollmentDetailsId, $areaId, $quarter, $gradeValue) {
        $findStmt = $conn->prepare("SELECT grade_id
                                    FROM student_grades
                                    WHERE enrollment_details_id = :enrollment_details_id
                                      AND area_id = :area_id
                                      AND quarter = :quarter
                                    LIMIT 1");
        $findStmt->execute([
            ':enrollment_details_id' => $enrollmentDetailsId,
            ':area_id' => $areaId,
            ':quarter' => $quarter
        ]);
        $gradeId = $findStmt->fetchColumn();

        if ($gradeId) {
            $updateStmt = $conn->prepare("UPDATE student_grades
                                          SET grade_value = :grade_value
                                          WHERE grade_id = :grade_id");
            $updateStmt->execute([
                ':grade_value' => $gradeValue,
                ':grade_id' => $gradeId
            ]);
            return;
        }

        $insertStmt = $conn->prepare("INSERT INTO student_grades(enrollment_details_id, area_id, quarter, grade_value)
                                      VALUES(:enrollment_details_id, :area_id, :quarter, :grade_value)");
        $insertStmt->execute([
            ':enrollment_details_id' => $enrollmentDetailsId,
            ':area_id' => $areaId,
            ':quarter' => $quarter,
            ':grade_value' => $gradeValue
        ]);
    }

    private function readLearningGrades($data, $learningAreas, $quarter = 1, $category = 'pre_school') {
        $gradesInput = $data['grades'] ?? [];
        $grades = [];

        foreach ($learningAreas as $index => $area) {
            if ($category === 'play_school' && (int) ($area['introduced_quarter'] ?? 1) > $quarter) {
                continue;
            }
            $areaId = (int) ($area['area_id'] ?? ($index + 1));
            $value = '';

            if (is_array($gradesInput)) {
                foreach ($gradesInput as $item) {
                    if (is_array($item) && (int) ($item['area_id'] ?? 0) === $areaId) {
                        $value = $item['grade_value'] ?? $item['grade'] ?? '';
                        break;
                    }
                }

                if ($value === '' && array_key_exists($index, $gradesInput)) {
                    $item = $gradesInput[$index];
                    $value = is_array($item) ? ($item['grade_value'] ?? $item['grade'] ?? '') : $item;
                }
            }

            $grade = strtoupper(trim((string) $value));
            if ($grade === '') {
                return ['error' => "Grade for {$area['area_name']} is required"];
            }

            if (!in_array($grade, $this->gradeOptions, true)) {
                return ['error' => 'Grades must be A+, A, B, C, D, or F'];
            }

            $grades[] = [
                'area_id' => $areaId,
                'area_name' => $area['area_name'],
                'grade_value' => $grade
            ];
        }

        return ['grades' => $grades];
    }

    private function getEnrollmentSummary($conn, $enrollmentDetailsId) {
        $sql = "SELECT ed.enrollment_details_id,
                       ed.section_id,
                       TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
                       p.name AS program_name,
                       sec.section_name,
                       eh.school_year_id,
                       sy.school_year,
                       CONCAT(sec_teacher.first_name, ' ', sec_teacher.last_name) AS section_teacher
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

    private function fetchPreschoolQuarter($conn, $enrollmentDetailsId, $quarter, $learningAreas = []) {
        $remarkSql = "SELECT r.remarks_id,
                             r.enrollment_details_id,
                             r.employee_id,
                             r.quarter,
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
        $remarkStmt = $conn->prepare($remarkSql);
        $remarkStmt->execute([
            ':enrollment_details_id' => $enrollmentDetailsId,
            ':quarter' => $quarter
        ]);
        $remark = $remarkStmt->fetch(PDO::FETCH_ASSOC);

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

        $scoreSql = "SELECT a.area_id,
                            ss.raw_score,
                            a.highest_possible_score
                     FROM student_scores ss
                     JOIN assessments a ON ss.assessment_id = a.assessment_id
                     WHERE ss.enrollment_details_id = :enrollment_details_id
                       AND a.quarter = :quarter";
        $scoreStmt = $conn->prepare($scoreSql);
        $scoreStmt->execute([
            ':enrollment_details_id' => $enrollmentDetailsId,
            ':quarter' => $quarter
        ]);
        $scoreRows = $scoreStmt->fetchAll(PDO::FETCH_ASSOC);

        if (!$remark && !$gradeRows && !$scoreRows) {
            return null;
        }

        return [
            'remark' => $remark ?: [
                'remarks_id' => 0,
                'quarter' => $quarter,
                'overall_grade' => '',
                'status' => '',
                'attendance' => null,
                'total_school_days' => null,
                'remarks' => '',
                'teacher_name' => 'Teacher'
            ],
            'grades' => $gradeRows,
            'scores' => $scoreRows
        ];
    }

    private function formatPreschoolQuarter($row, $gradeRows = [], $learningAreas = [], $scoreRows = []) {
        if (!$row) {
            return null;
        }

        $gradeMap = [];
        foreach ($gradeRows as $gradeRow) {
            $gradeMap[(int) $gradeRow['area_id']] = $gradeRow['grade_value'] ?? '';
        }

        $scoreMap = [];
        foreach ($scoreRows as $scoreRow) {
            $scoreMap[(int) $scoreRow['area_id']] = [
                'raw_score' => isset($scoreRow['raw_score']) ? (float) $scoreRow['raw_score'] : null,
                'highest_possible_score' => isset($scoreRow['highest_possible_score']) ? (float) $scoreRow['highest_possible_score'] : null
            ];
        }

        $grades = [];
        foreach ($learningAreas as $index => $area) {
            $areaId = (int) ($area['area_id'] ?? ($index + 1));
            $grades[] = [
                'area_id' => $areaId,
                'label' => $area['area_name'],
                'domain_key' => $area['domain_key'] ?? '',
                'domain_label' => $area['domain_label'] ?? '',
                'introduced_quarter' => (int) ($area['introduced_quarter'] ?? 1),
                'grade' => $gradeMap[$areaId] ?? '',
                'raw_score' => $scoreMap[$areaId]['raw_score'] ?? null,
                'highest_possible_score' => $scoreMap[$areaId]['highest_possible_score'] ?? (isset($area['default_perfect_score']) ? (float) $area['default_perfect_score'] : 100)
            ];
        }

        return [
            'remarks_id' => (int) ($row['remarks_id'] ?? 0),
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

    private function fetchPreschoolReportCard($conn, $enrollmentDetailsId, $category = 'pre_school') {
        $schoolYear = tcGetEnrollmentSchoolYearContext($conn, $enrollmentDetailsId);
        $learningAreas = $this->getLearningAreas($conn, $category, $schoolYear['school_year_id'] ?? 0);
        $quarters = [];
        $quarterCount = max(1, (int) ($schoolYear['quarter_count'] ?? 3));

        for ($quarter = 1; $quarter <= $quarterCount; $quarter++) {
            $quarterData = $this->fetchPreschoolQuarter($conn, $enrollmentDetailsId, $quarter, $learningAreas);
            $quarters[(string) $quarter] = $quarterData
                ? $this->formatPreschoolQuarter($quarterData['remark'], $quarterData['grades'], $learningAreas, $quarterData['scores'] ?? [])
                : null;
        }

        return [
            'school_year' => $schoolYear,
            'learning_areas' => array_map(function($area) {
                return [
                    'area_id' => (int) $area['area_id'],
                    'label' => $area['area_name'],
                    'domain_key' => $area['domain_key'] ?? '',
                    'domain_label' => $area['domain_label'] ?? '',
                    'introduced_quarter' => (int) ($area['introduced_quarter'] ?? 1),
                    'weight_percentage' => isset($area['weight_percentage']) ? (float) $area['weight_percentage'] : 0,
                    'default_perfect_score' => isset($area['default_perfect_score']) ? (float) $area['default_perfect_score'] : 100
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
    }

    // Fetches a specific student's grades and joins the learning_areas table 
    // so your frontend knows exactly what subject the grade is for.
    function getGradesByEnrollment(){
        include "connection-pdo.php";
        $this->ensureTable($conn);
        $enrollment_details_id = $_GET['enrollment_details_id'];
        
        $sql = "SELECT sg.grade_id, sg.enrollment_details_id, sg.area_id, sg.quarter, sg.grade_value, 
                       la.area_name, la.order_index 
                FROM student_grades sg 
                JOIN learning_areas la ON sg.area_id = la.area_id 
                WHERE sg.enrollment_details_id = :id 
                ORDER BY sg.quarter ASC, la.order_index ASC";
                
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":id", $enrollment_details_id);
        $stmt->execute();
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    function insertStudentGrade($json){
        include "connection-pdo.php";
        $this->ensureTable($conn);
        $json = json_decode($json, true);
        
        $sql = "INSERT INTO student_grades(enrollment_details_id, area_id, quarter, grade_value) 
                VALUES(:enrollment_details_id, :area_id, :quarter, :grade_value)";
                
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":enrollment_details_id", $json['enrollment_details_id']);
        $stmt->bindParam(":area_id", $json['area_id']);
        $stmt->bindParam(":quarter", $json['quarter']);
        $stmt->bindParam(":grade_value", $json['grade_value']);
        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    function updateStudentGrade($json){
        include "connection-pdo.php";
        $this->ensureTable($conn);
        $json = json_decode($json, true);
        
        $sql = "UPDATE student_grades 
                SET enrollment_details_id = :enrollment_details_id, area_id = :area_id, 
                    quarter = :quarter, grade_value = :grade_value 
                WHERE grade_id = :id";
                
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":enrollment_details_id", $json['enrollment_details_id']);
        $stmt->bindParam(":area_id", $json['area_id']);
        $stmt->bindParam(":quarter", $json['quarter']);
        $stmt->bindParam(":grade_value", $json['grade_value']);
        $stmt->bindParam(":id", $json['grade_id']);
        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    function deleteStudentGrade($json){
        include "connection-pdo.php";
        $this->ensureTable($conn);
        $json = json_decode($json, true);
        
        $sql = "DELETE FROM student_grades WHERE grade_id = :id";
        
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":id", $json['grade_id']);
        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    function getSectionReportCards() {
        $employeeId = $this->requireTeacher();
        if ($employeeId === null) return;
        include "connection-pdo.php";

        $sectionId = isset($_GET['section_id']) ? (int) $_GET['section_id'] : 0;
        $requestedEnrollmentId = isset($_GET['enrollment_details_id'])
            ? (int) $_GET['enrollment_details_id']
            : 0;
        if ($sectionId <= 0) {
            echo studentGradeJsonEncode(['status' => 'error', 'message' => 'Missing section_id']);
            return;
        }

        if (!$this->canAccessSection($conn, $sectionId, $employeeId, $this->getUserRole())) {
            echo studentGradeJsonEncode(['status' => 'error', 'message' => 'Unauthorized']);
            return;
        }

        try {
            $sectionSql = "SELECT sec.section_id,
                                  sec.section_name,
                                  sec.class_id,
                                  CONCAT(emp.first_name, ' ', emp.last_name) AS teacher_name,
                                  p.name AS program_name,
                                  b.branch_name
                           FROM sections sec
                           LEFT JOIN employee emp ON sec.employee_id = emp.employee_id
                           LEFT JOIN class c ON sec.class_id = c.class_id
                           LEFT JOIN program p ON c.program_id = p.program_id
                           LEFT JOIN branch b ON c.branch_id = b.branch_id
                           WHERE sec.section_id = :section_id
                           LIMIT 1";
            $sectionStmt = $conn->prepare($sectionSql);
            $sectionStmt->execute([':section_id' => $sectionId]);
            $section = $sectionStmt->fetch(PDO::FETCH_ASSOC);

            if (!$section) {
                echo studentGradeJsonEncode(['status' => 'error', 'message' => 'Section not found']);
                return;
            }

            $studentsSql = "SELECT ed.enrollment_details_id,
                                   st.student_id,
                                   st.student_id_number,
                                   TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
                                   st.birthday,
                                   p.name AS program_name,
                                   eh.school_year_id,
                                   sy.school_year,
                                   COALESCE(NULLIF(eh.status, ''), ed.status) AS status,
                                   eh.date_created AS enrollment_date
                            FROM enrollment_details ed
                            JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                            JOIN student st ON eh.student_id = st.student_id
                            LEFT JOIN program p ON ed.program_id = p.program_id
                            LEFT JOIN school_years sy ON eh.school_year_id = sy.school_year_id
                            WHERE ed.section_id = :section_id"
                            . ($requestedEnrollmentId > 0
                                ? " AND ed.enrollment_details_id = :enrollment_details_id"
                                : "") .
                            "
                            ORDER BY st.last_name ASC, st.first_name ASC";
            $studentsStmt = $conn->prepare($studentsSql);
            $studentParams = [':section_id' => $sectionId];
            if ($requestedEnrollmentId > 0) {
                $studentParams[':enrollment_details_id'] = $requestedEnrollmentId;
            }
            $studentsStmt->execute($studentParams);
            $students = $studentsStmt->fetchAll(PDO::FETCH_ASSOC);

            $category = $this->getReportCardCategory($section['program_name'] ?? '');
            foreach ($students as &$student) {
                $student['report_card'] = $this->fetchPreschoolReportCard($conn, (int) $student['enrollment_details_id'], $category);
            }
            unset($student);

            $sectionSchoolYear = !empty($students)
                ? tcGetSchoolYearContext($conn, (int) ($students[0]['school_year_id'] ?? 0))
                : tcGetActiveSchoolYearContext($conn);
            $learningAreas = $this->getLearningAreas($conn, $category, $sectionSchoolYear['school_year_id'] ?? 0);
            echo studentGradeJsonEncode([
                'status' => 'success',
                'data' => [
                    'section' => $section,
                    'school_year' => $sectionSchoolYear,
                    'students' => $students,
                    'learning_areas' => array_map(function($area) {
                        return [
                            'area_id' => (int) $area['area_id'],
                            'label' => $area['area_name'],
                            'domain_key' => $area['domain_key'] ?? '',
                            'domain_label' => $area['domain_label'] ?? '',
                            'introduced_quarter' => (int) ($area['introduced_quarter'] ?? 1),
                            'weight_percentage' => isset($area['weight_percentage']) ? (float) $area['weight_percentage'] : 0,
                            'default_perfect_score' => isset($area['default_perfect_score']) ? (float) $area['default_perfect_score'] : 100
                        ];
                    }, $learningAreas),
                    'grade_options' => $this->gradeOptions,
                    'transmutation' => $this->getTransmutationRows($conn),
                    'play_school_transmutation' => $category === 'play_school' ? $this->getPlaySchoolTransmutationTables($conn) : [],
                    'play_school_standard_scores' => $category === 'play_school' ? $this->getPlaySchoolStandardScoreRows($conn) : [],
                    'play_school_interpretations' => $category === 'play_school' ? $this->getPlaySchoolInterpretations($conn) : []
                ]
            ]);
        } catch (Throwable $e) {
            error_log('Unable to load section report cards: ' . $e->getMessage());
            echo studentGradeJsonEncode([
                'status' => 'error',
                'message' => 'Unable to load the ECCD checklist records.',
                'detail' => $e->getMessage()
            ]);
        }
    }

    function savePreschoolReportCard() {
        $employeeId = $this->requireTeacher();
        if ($employeeId === null) return;
        include "connection-pdo.php";
        $this->ensureTable($conn);

        $data = $this->getPayload();
        $enrollmentDetailsId = isset($data['enrollment_details_id']) ? (int) $data['enrollment_details_id'] : 0;
        $quarter = isset($data['quarter']) ? (int) $data['quarter'] : 0;

        if ($enrollmentDetailsId <= 0) {
            echo studentGradeJsonEncode(['status' => 'error', 'message' => 'Missing enrollment_details_id']);
            return;
        }

        if (!$this->teacherCanAccessEnrollment($conn, $enrollmentDetailsId, $employeeId)) {
            echo studentGradeJsonEncode(['status' => 'error', 'message' => 'Unauthorized']);
            return;
        }

        $summary = $this->getEnrollmentSummary($conn, $enrollmentDetailsId);
        $schoolYear = tcGetEnrollmentSchoolYearContext($conn, $enrollmentDetailsId);
        $quarterCount = max(1, (int) ($schoolYear['quarter_count'] ?? 3));
        if ($quarter < 1 || $quarter > $quarterCount) {
            echo studentGradeJsonEncode([
                'status' => 'error',
                'message' => "Quarter must be from 1 to {$quarterCount} for " . ($schoolYear['school_year'] ?? 'this school year')
            ]);
            return;
        }
        $category = $this->getReportCardCategory($summary['program_name'] ?? '');
        $learningAreas = $this->getLearningAreas($conn, $category, $schoolYear['school_year_id'] ?? 0);
        $gradeResult = $this->readLearningGrades($data, $learningAreas, $quarter, $category);
        if (isset($gradeResult['error'])) {
            echo studentGradeJsonEncode(['status' => 'error', 'message' => $gradeResult['error']]);
            return;
        }

        $grades = $gradeResult['grades'];
        $overallGrade = strtoupper(trim((string) ($data['overall_grade'] ?? '')));
        if (!in_array($overallGrade, $this->gradeOptions, true)) {
            $overallGrade = $grades[0]['grade_value'] ?? 'C';
        }

        $attendance = isset($data['attendance']) && $data['attendance'] !== '' ? max(0, (int) $data['attendance']) : null;
        $totalSchoolDays = isset($data['total_school_days']) && $data['total_school_days'] !== '' ? max(0, (int) $data['total_school_days']) : null;
        $remarks = trim((string) ($data['remarks'] ?? ''));
        $status = $overallGrade === 'F' ? 'failed' : 'passed';

        try {
            $conn->beginTransaction();

            $existingSql = "SELECT remarks_id
                            FROM remarks
                            WHERE enrollment_details_id = :enrollment_details_id
                              AND quarter = :quarter
                            ORDER BY remarks_id DESC
                            LIMIT 1";
            $existingStmt = $conn->prepare($existingSql);
            $existingStmt->execute([
                ':enrollment_details_id' => $enrollmentDetailsId,
                ':quarter' => $quarter
            ]);
            $remarksId = $existingStmt->fetchColumn();

            if ($remarksId) {
                $remarksSql = "UPDATE remarks
                               SET employee_id = :employee_id,
                                   status = :status,
                                   overall_grade = :overall_grade,
                                   attendance = :attendance,
                                   total_school_days = :total_school_days,
                                   evaluation = :remarks
                               WHERE remarks_id = :remarks_id";
                $remarksStmt = $conn->prepare($remarksSql);
                $remarksStmt->execute([
                    ':employee_id' => $employeeId,
                    ':status' => $status,
                    ':overall_grade' => $overallGrade,
                    ':attendance' => $attendance,
                    ':total_school_days' => $totalSchoolDays,
                    ':remarks' => $remarks,
                    ':remarks_id' => $remarksId
                ]);
            } else {
                $remarksSql = "INSERT INTO remarks
                               (enrollment_details_id, employee_id, quarter, status, overall_grade, attendance, total_school_days, evaluation)
                               VALUES (:enrollment_details_id, :employee_id, :quarter, :status, :overall_grade, :attendance, :total_school_days, :remarks)";
                $remarksStmt = $conn->prepare($remarksSql);
                $remarksStmt->execute([
                    ':enrollment_details_id' => $enrollmentDetailsId,
                    ':employee_id' => $employeeId,
                    ':quarter' => $quarter,
                    ':status' => $status,
                    ':overall_grade' => $overallGrade,
                    ':attendance' => $attendance,
                    ':total_school_days' => $totalSchoolDays,
                    ':remarks' => $remarks
                ]);
            }

            foreach ($grades as $grade) {
                $findGradeSql = "SELECT grade_id
                                 FROM student_grades
                                 WHERE enrollment_details_id = :enrollment_details_id
                                   AND area_id = :area_id
                                   AND quarter = :quarter
                                 LIMIT 1";
                $findGradeStmt = $conn->prepare($findGradeSql);
                $findGradeStmt->execute([
                    ':enrollment_details_id' => $enrollmentDetailsId,
                    ':area_id' => $grade['area_id'],
                    ':quarter' => $quarter
                ]);
                $gradeId = $findGradeStmt->fetchColumn();

                if ($gradeId) {
                    $updateGradeSql = "UPDATE student_grades
                                       SET grade_value = :grade_value
                                       WHERE grade_id = :grade_id";
                    $updateGradeStmt = $conn->prepare($updateGradeSql);
                    $updateGradeStmt->execute([
                        ':grade_value' => $grade['grade_value'],
                        ':grade_id' => $gradeId
                    ]);
                } else {
                    $insertGradeSql = "INSERT INTO student_grades(enrollment_details_id, area_id, quarter, grade_value)
                                       VALUES(:enrollment_details_id, :area_id, :quarter, :grade_value)";
                    $insertGradeStmt = $conn->prepare($insertGradeSql);
                    $insertGradeStmt->execute([
                        ':enrollment_details_id' => $enrollmentDetailsId,
                        ':area_id' => $grade['area_id'],
                        ':quarter' => $quarter,
                        ':grade_value' => $grade['grade_value']
                    ]);
                }
            }

            $conn->commit();

            $savedQuarter = $this->fetchPreschoolQuarter($conn, $enrollmentDetailsId, $quarter, $learningAreas);
            echo studentGradeJsonEncode([
                'status' => 'success',
                'message' => 'Quarter report card saved successfully',
                'data' => $savedQuarter
                    ? $this->formatPreschoolQuarter($savedQuarter['remark'], $savedQuarter['grades'], $learningAreas)
                    : null
            ]);
        } catch (Exception $e) {
            if ($conn->inTransaction()) {
                $conn->rollBack();
            }

            echo studentGradeJsonEncode(['status' => 'error', 'message' => $e->getMessage()]);
        }
    }

    function saveGradebookScores() {
        $employeeId = $this->requireTeacher();
        if ($employeeId === null) return;
        include "connection-pdo.php";
        $this->ensureTable($conn);

        $data = $this->getPayload();
        $sectionId = isset($data['section_id']) ? (int) $data['section_id'] : 0;
        $quarter = isset($data['quarter']) ? (int) $data['quarter'] : 0;
        $students = is_array($data['students'] ?? null) ? $data['students'] : [];

        if ($sectionId <= 0) {
            echo json_encode(['status' => 'error', 'message' => 'Missing section_id']);
            return;
        }

        $schoolYear = tcGetActiveSchoolYearContext($conn);
        $quarterCount = max(1, (int) ($schoolYear['quarter_count'] ?? 3));
        if ($quarter < 1 || $quarter > $quarterCount) {
            echo json_encode(['status' => 'error', 'message' => "Quarter must be from 1 to {$quarterCount}"]);
            return;
        }

        if (!$this->canAccessSection($conn, $sectionId, $employeeId, $this->getUserRole())) {
            echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
            return;
        }

        $sectionSql = "SELECT sec.section_id,
                              p.name AS program_name
                       FROM sections sec
                       LEFT JOIN class c ON sec.class_id = c.class_id
                       LEFT JOIN program p ON c.program_id = p.program_id
                       WHERE sec.section_id = :section_id
                       LIMIT 1";
        $sectionStmt = $conn->prepare($sectionSql);
        $sectionStmt->execute([':section_id' => $sectionId]);
        $section = $sectionStmt->fetch(PDO::FETCH_ASSOC);

        if (!$section) {
            echo json_encode(['status' => 'error', 'message' => 'Section not found']);
            return;
        }

        $category = $this->getReportCardCategory($section['program_name'] ?? '');
        $learningAreas = $this->getLearningAreas($conn, $category, $schoolYear['school_year_id'] ?? 0);
        $areaMap = [];
        foreach ($learningAreas as $area) {
            $areaMap[(int) $area['area_id']] = $area;
        }

        try {
            $conn->beginTransaction();

            foreach ($students as $student) {
                $enrollmentDetailsId = (int) ($student['enrollment_details_id'] ?? 0);
                if ($enrollmentDetailsId <= 0) {
                    continue;
                }

                $belongsStmt = $conn->prepare("SELECT enrollment_details_id
                                                FROM enrollment_details
                                                WHERE enrollment_details_id = :enrollment_details_id
                                                  AND section_id = :section_id
                                                LIMIT 1");
                $belongsStmt->execute([
                    ':enrollment_details_id' => $enrollmentDetailsId,
                    ':section_id' => $sectionId
                ]);

                if (!$belongsStmt->fetch(PDO::FETCH_ASSOC)) {
                    continue;
                }

                $validScores = [];
                $scores = is_array($student['scores'] ?? null) ? $student['scores'] : [];

                foreach ($scores as $score) {
                    $areaId = (int) ($score['area_id'] ?? 0);
                    if (!$areaId || !isset($areaMap[$areaId])) {
                        continue;
                    }

                    $assessmentId = $this->ensureAssessment($conn, $employeeId, $areaMap[$areaId], $quarter);
                    $rawValue = $score['raw_score'] ?? '';

                    if ($rawValue === '' || $rawValue === null) {
                        $deleteScoreStmt = $conn->prepare("DELETE FROM student_scores
                                                           WHERE enrollment_details_id = :enrollment_details_id
                                                             AND assessment_id = :assessment_id");
                        $deleteScoreStmt->execute([
                            ':enrollment_details_id' => $enrollmentDetailsId,
                            ':assessment_id' => $assessmentId
                        ]);

                        $deleteGradeStmt = $conn->prepare("DELETE FROM student_grades
                                                           WHERE enrollment_details_id = :enrollment_details_id
                                                             AND area_id = :area_id
                                                             AND quarter = :quarter");
                        $deleteGradeStmt->execute([
                            ':enrollment_details_id' => $enrollmentDetailsId,
                            ':area_id' => $areaId,
                            ':quarter' => $quarter
                        ]);
                        continue;
                    }

                    if (!is_numeric($rawValue)) {
                        throw new Exception('Scores must be numeric.');
                    }

                    $rawScore = round((float) $rawValue, 2);
                    $perfectScore = max(1, (float) ($areaMap[$areaId]['default_perfect_score'] ?? 100));
                    if ($rawScore < 0 || $rawScore > $perfectScore) {
                        throw new Exception("Score for {$areaMap[$areaId]['area_name']} must be between 0 and {$perfectScore}.");
                    }

                    $findScoreStmt = $conn->prepare("SELECT score_id
                                                     FROM student_scores
                                                     WHERE enrollment_details_id = :enrollment_details_id
                                                       AND assessment_id = :assessment_id
                                                     LIMIT 1");
                    $findScoreStmt->execute([
                        ':enrollment_details_id' => $enrollmentDetailsId,
                        ':assessment_id' => $assessmentId
                    ]);
                    $scoreId = $findScoreStmt->fetchColumn();

                    if ($scoreId) {
                        $updateScoreStmt = $conn->prepare("UPDATE student_scores
                                                           SET raw_score = :raw_score
                                                           WHERE score_id = :score_id");
                        $updateScoreStmt->execute([
                            ':raw_score' => $rawScore,
                            ':score_id' => $scoreId
                        ]);
                    } else {
                        $insertScoreStmt = $conn->prepare("INSERT INTO student_scores(assessment_id, enrollment_details_id, raw_score)
                                                           VALUES(:assessment_id, :enrollment_details_id, :raw_score)");
                        $insertScoreStmt->execute([
                            ':assessment_id' => $assessmentId,
                            ':enrollment_details_id' => $enrollmentDetailsId,
                            ':raw_score' => $rawScore
                        ]);
                    }

                    $percentage = ($rawScore / $perfectScore) * 100;
                    $gradeValue = $this->getTransmutedLetter($conn, $percentage);
                    $this->upsertStudentGrade($conn, $enrollmentDetailsId, $areaId, $quarter, $gradeValue);

                    $validScores[] = [
                        'area_id' => $areaId,
                        'raw_score' => $rawScore
                    ];
                }

                $average = $this->calculateWeightedAverage($validScores, $learningAreas);
                $overallGrade = $average === null ? 'F' : $this->getTransmutedLetter($conn, $average);
                $status = ($average !== null && $overallGrade !== 'F' && $average >= 75) ? 'passed' : 'failed';

                $existingStmt = $conn->prepare("SELECT remarks_id
                                                FROM remarks
                                                WHERE enrollment_details_id = :enrollment_details_id
                                                  AND quarter = :quarter
                                                ORDER BY remarks_id DESC
                                                LIMIT 1");
                $existingStmt->execute([
                    ':enrollment_details_id' => $enrollmentDetailsId,
                    ':quarter' => $quarter
                ]);
                $remarksId = $existingStmt->fetchColumn();

                if ($remarksId) {
                    $remarksStmt = $conn->prepare("UPDATE remarks
                                                   SET employee_id = :employee_id,
                                                       status = :status,
                                                       overall_grade = :overall_grade,
                                                       evaluation = :remarks
                                                   WHERE remarks_id = :remarks_id");
                    $remarksStmt->execute([
                        ':employee_id' => $employeeId,
                        ':status' => $status,
                        ':overall_grade' => $overallGrade,
                        ':remarks' => '',
                        ':remarks_id' => $remarksId
                    ]);
                } else {
                    $remarksStmt = $conn->prepare("INSERT INTO remarks(enrollment_details_id, employee_id, quarter, status, overall_grade, evaluation)
                                                   VALUES(:enrollment_details_id, :employee_id, :quarter, :status, :overall_grade, :remarks)");
                    $remarksStmt->execute([
                        ':enrollment_details_id' => $enrollmentDetailsId,
                        ':employee_id' => $employeeId,
                        ':quarter' => $quarter,
                        ':status' => $status,
                        ':overall_grade' => $overallGrade,
                        ':remarks' => ''
                    ]);
                }
            }

            $conn->commit();
            echo studentGradeJsonEncode(['status' => 'success', 'message' => 'Gradebook saved successfully']);
        } catch (Exception $e) {
            if ($conn->inTransaction()) {
                $conn->rollBack();
            }

            echo studentGradeJsonEncode(['status' => 'error', 'message' => $e->getMessage()]);
        }
    }
}

// Router
$operation = $_GET['operation'] ?? ($_POST['operation'] ?? '');
$json = $_GET['json'] ?? ($_POST['json'] ?? '');

$manager = new StudentGradeManager();
switch($operation){
    case "getGradesByEnrollment": $manager->getGradesByEnrollment(); break;
    case "insertStudentGrade": $manager->insertStudentGrade($json); break;
    case "updateStudentGrade": $manager->updateStudentGrade($json); break;
    case "deleteStudentGrade": $manager->deleteStudentGrade($json); break;
    case "getSectionReportCards": $manager->getSectionReportCards(); break;
    case "savePreschoolReportCard": $manager->savePreschoolReportCard(); break;
    case "saveGradebookScores": $manager->saveGradebookScores(); break;
    default: echo studentGradeJsonEncode(['status' => 'error', 'message' => 'Invalid Operation']); break;
}
?>
