<?php
// api/admin/learning_area.php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

require_once __DIR__ . '/../school_year_context.php';

function learningAreaJsonEncode($payload) {
    $json = json_encode($payload, JSON_INVALID_UTF8_SUBSTITUTE | JSON_UNESCAPED_UNICODE);
    return $json === false
        ? '{"status":"error","message":"Unable to encode the learning-area response."}'
        : $json;
}

// InfinityFree normally hides fatal PHP errors, which otherwise leaves Axios
// with an unexplained empty response. Keep API failures valid JSON and put the
// full diagnostic in the hosting error log.
register_shutdown_function(function() {
    $error = error_get_last();
    if (!$error || !in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        return;
    }

    error_log(sprintf(
        'Learning area API fatal error: %s in %s:%d',
        $error['message'],
        $error['file'],
        $error['line']
    ));

    if (!headers_sent()) {
        header('Content-Type: application/json');
        http_response_code(500);
    }

    echo learningAreaJsonEncode([
        'status' => 'error',
        'message' => 'The hosted server could not load the card management database setup.'
    ]);
});

class LearningAreaManager {
    private $preschoolDefaults = ['Writing', 'Reading', 'Speaking', 'Language', 'Counting/Numbering', 'Art and Craft', 'Playing/Sharing'];

    private function getDefaultAreas($category) {
        if ($category === 'play_school') {
            return [
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
            ];
        }

        return $this->preschoolDefaults;
    }

    private function getDefaultTransmutationRows() {
        return [
            ['min_percentage' => 95.00, 'max_percentage' => 100.00, 'transmuted_letter' => 'A+'],
            ['min_percentage' => 90.00, 'max_percentage' => 94.99, 'transmuted_letter' => 'A'],
            ['min_percentage' => 85.00, 'max_percentage' => 89.99, 'transmuted_letter' => 'B'],
            ['min_percentage' => 80.00, 'max_percentage' => 84.99, 'transmuted_letter' => 'C'],
            ['min_percentage' => 75.00, 'max_percentage' => 79.99, 'transmuted_letter' => 'D'],
            ['min_percentage' => 0.00, 'max_percentage' => 74.99, 'transmuted_letter' => 'F']
        ];
    }

    private function getDefaultPlaySchoolInterpretations() {
        return [
            ['scaled', 1, 3, 'monitor_3_months', 'Development in the domain must be monitored after 3 months', 'below_expected', 3],
            ['scaled', 4, 6, 'monitor_6_months', 'Development in the domain must be monitored after 6 months', 'below_expected', 6],
            ['scaled', 7, 13, 'average', 'Average development', 'average', null],
            ['scaled', 14, 16, 'slightly_advanced', 'Suggests slightly advanced development in the domain', 'advanced', null],
            ['scaled', 17, 19, 'highly_advanced', 'Suggests highly advanced development in the domain', 'advanced', null],
            ['standard', null, 69, 'monitor_3_months', 'Overall development must be monitored after 3 months', 'below_expected', 3],
            ['standard', 70, 79, 'monitor_6_months', 'Overall development must be monitored after 6 months', 'below_expected', 6],
            ['standard', 80, 119, 'average', 'Average overall development', 'average', null],
            ['standard', 120, 129, 'slightly_advanced', 'Slightly advanced overall development', 'advanced', null],
            ['standard', 130, null, 'highly_advanced', 'Highly advanced overall development', 'advanced', null]
        ];
    }

    private function getDefaultPlaySchoolTransmutationRows() {
        $columns = ['gross_motor', 'fine_motor', 'self_help', 'receptive_language', 'expressive_language', 'cognitive', 'social_emotional'];
        $tables = [
            ['3_1_to_4_0', 'Ages 3.1 - 4.0 years', [
                [1, '0-3', '-', '0-9', '-', '0-2', '-', '0-9'],
                [2, '4', '0-3', '10', '-', '-', '-', '10-11'],
                [3, '5', '-', '11', '0-1', '3', '0', '12'],
                [4, '-', '4', '12', '-', '4', '1', '13'],
                [5, '6', '5', '13-14', '2', '-', '2-3', '14'],
                [6, '7', '-', '15', '-', '5', '4', '15'],
                [7, '8', '6', '16', '3', '-', '5', '16'],
                [8, '9', '-', '17', '-', '6', '6', '17-18'],
                [9, '-', '7', '18-19', '-', '-', '7', '19'],
                [10, '10', '8', '20', '4', '7', '8-9', '20'],
                [11, '11', '-', '21', '-', '-', '10', '21'],
                [12, '12', '9', '22', '5', '8', '11', '22'],
                [13, '-', '-', '23-24', '-', '-', '12', '23'],
                [14, '13', '10', '25', '-', '-', '13-14', '24'],
                [15, '-', '11', '26', '-', '-', '15', '-'],
                [16, '-', '-', '27', '-', '-', '16', '-'],
                [17, '-', '-', '-', '-', '-', '17', '-'],
                [18, '-', '-', '-', '-', '-', '18', '-'],
                [19, '-', '-', '-', '-', '-', '19-21', '-']
            ]],
            ['4_1_to_5_0', 'Ages 4.1 - 5.0 years', [
                [1, '0-5', '0-3', '0-15', '0-1', '-', '0', '0-13'],
                [2, '6', '4', '16', '-', '0-5', '1', '14'],
                [3, '-', '-', '17', '2', '-', '2-3', '15'],
                [4, '7', '5', '18', '-', '-', '4', '16'],
                [5, '8', '6', '19', '-', '6', '5', '17'],
                [6, '-', '-', '20', '3', '-', '6-7', '-'],
                [7, '9', '7', '-', '-', '-', '8', '18'],
                [8, '10', '-', '21', '-', '7', '9-10', '19'],
                [9, '-', '8', '22', '4', '-', '11', '20'],
                [10, '11', '9', '23', '-', '8', '12', '21'],
                [11, '12', '-', '24', '5', '-', '13-14', '22'],
                [12, '-', '10', '25', '-', '-', '15', '23'],
                [13, '13', '-', '26', '-', '-', '16-17', '24'],
                [14, '-', '11', '27', '-', '-', '18', '-'],
                [15, '-', '-', '-', '-', '-', '19-20', '-'],
                [16, '-', '-', '-', '-', '-', '21', '-'],
                [17, '-', '-', '-', '-', '-', '-', '-'],
                [18, '-', '-', '-', '-', '-', '-', '-'],
                [19, '-', '-', '-', '-', '-', '-', '-']
            ]],
            ['5_1_to_5_11', 'Ages 5.1 - 5.11 years', [
                [1, '0-10', '0-5', '-', '0-2', '-', '0-9', '0-15'],
                [2, '-', '-', '0-19', '-', '-', '10', '16'],
                [3, '-', '6', '20', '-', '-', '11', '17'],
                [4, '11', '-', '21', '3', '-', '12', '-'],
                [5, '-', '7', '-', '-', '0-7', '13', '18'],
                [6, '-', '-', '22', '-', '-', '14', '19'],
                [7, '12', '8', '23', '-', '-', '15', '20'],
                [8, '-', '9', '-', '4', '-', '16', '-'],
                [9, '-', '-', '24', '-', '-', '17', '21'],
                [10, '-', '10', '25', '-', '-', '18', '22'],
                [11, '13', '-', '-', '5', '8', '19', '23'],
                [12, '-', '11', '26', '-', '-', '20', '-'],
                [13, '-', '-', '27', '-', '-', '21', '24'],
                [14, '-', '-', '-', '-', '-', '-', '-'],
                [15, '-', '-', '-', '-', '-', '-', '-'],
                [16, '-', '-', '-', '-', '-', '-', '-'],
                [17, '-', '-', '-', '-', '-', '-', '-'],
                [18, '-', '-', '-', '-', '-', '-', '-'],
                [19, '-', '-', '-', '-', '-', '-', '-']
            ]]
        ];

        $rows = [];
        foreach ($tables as $ageIndex => $table) {
            foreach ($table[2] as $rowIndex => $values) {
                $row = [
                    'age_key' => $table[0],
                    'age_label' => $table[1],
                    'age_order' => $ageIndex + 1,
                    'scaled_score' => $values[0],
                    'order_index' => $rowIndex + 1
                ];

                foreach ($columns as $columnIndex => $column) {
                    $row[$column] = $values[$columnIndex + 1];
                }

                $rows[] = $row;
            }
        }

        return $rows;
    }

    private function getDefaultPlaySchoolStandardScoreRows() {
        $pairs = [
            [29, 37], [30, 38], [31, 40], [32, 41], [33, 43],
            [34, 44], [35, 45], [36, 47], [37, 48], [38, 50],
            [39, 51], [40, 53], [41, 54], [42, 56], [43, 57],
            [44, 59], [45, 60], [46, 62], [47, 63], [48, 65],
            [49, 66], [50, 67], [51, 69], [52, 70], [53, 72],
            [54, 73], [55, 75], [56, 76], [57, 78], [58, 79],
            [59, 81], [60, 82], [61, 84], [62, 85], [63, 86],
            [64, 88], [65, 89], [66, 91], [67, 92], [68, 94],
            [69, 95], [70, 97], [71, 98], [72, 100], [73, 101],
            [74, 103], [75, 104], [76, 105], [77, 107], [78, 108],
            [79, 110], [80, 111], [81, 113], [82, 114], [83, 116],
            [84, 117], [85, 119], [86, 120], [87, 122], [88, 123],
            [89, 124], [90, 126], [91, 127], [92, 129], [93, 130],
            [94, 132], [95, 133], [96, 135], [97, 136], [98, 138]
        ];

        return array_map(function($pair, $index) {
            return [
                'sum_scaled_score' => $pair[0],
                'standard_score' => $pair[1],
                'order_index' => $index + 1
            ];
        }, $pairs, array_keys($pairs));
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

    private function replaceLegacyPlaySchoolDefaults($conn) {
        $stmt = $conn->prepare("SELECT area_id, area_name FROM learning_areas WHERE category = 'play_school' ORDER BY order_index ASC, area_id ASC");
        $stmt->execute();
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        if (count($rows) !== count($this->preschoolDefaults)) {
            return false;
        }

        foreach ($rows as $index => $row) {
            if (($row['area_name'] ?? '') !== $this->preschoolDefaults[$index]) {
                return false;
            }
        }

        $defaults = $this->getDefaultAreas('play_school');
        $updateStmt = $conn->prepare("UPDATE learning_areas
                                      SET area_name = :area_name,
                                          order_index = :order_index,
                                          is_active = 1
                                      WHERE area_id = :area_id");
        foreach ($rows as $index => $row) {
            $updateStmt->execute([
                ':area_name' => $defaults[$index],
                ':order_index' => $index + 1,
                ':area_id' => $row['area_id']
            ]);
        }

        $insertStmt = $conn->prepare("INSERT INTO learning_areas(area_name, category, order_index, is_active, weight_percentage, default_perfect_score)
                                      VALUES(:area_name, 'play_school', :order_index, 1, 0, 100)");
        for ($index = count($rows); $index < count($defaults); $index++) {
            $insertStmt->execute([
                ':area_name' => $defaults[$index],
                ':order_index' => $index + 1
            ]);
        }

        return true;
    }

    private function ensureTable($conn) {
        $conn->exec("CREATE TABLE IF NOT EXISTS learning_areas (
                    area_id INT(11) NOT NULL AUTO_INCREMENT,
                    area_name VARCHAR(100) NOT NULL,
                    category VARCHAR(50) DEFAULT 'pre_school',
                    order_index INT(11) DEFAULT 1,
                    is_active TINYINT(1) DEFAULT 1,
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
                    extra_ranges TEXT NULL,
                    order_index INT(11) NOT NULL DEFAULT 1,
                    PRIMARY KEY (play_transmutation_id),
                    UNIQUE KEY uq_play_school_transmutation_age_score (age_key, scaled_score),
                    KEY idx_play_school_transmutation_order (age_order, order_index)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");
        $this->ensureColumn($conn, 'play_school_transmutation_table', 'extra_ranges', 'TEXT NULL AFTER social_emotional');
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

        $conn->exec("CREATE TABLE IF NOT EXISTS assessments (
                    assessment_id INT(11) NOT NULL AUTO_INCREMENT,
                    employee_id INT(11) NOT NULL,
                    area_id INT(11) NOT NULL,
                    title VARCHAR(255) NOT NULL,
                    highest_possible_score DECIMAL(5,2) NOT NULL,
                    date_given DATE DEFAULT NULL,
                    PRIMARY KEY (assessment_id),
                    KEY idx_assessments_area (area_id),
                    KEY idx_assessments_employee (employee_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");

        $conn->exec("CREATE TABLE IF NOT EXISTS student_scores (
                    score_id INT(11) NOT NULL AUTO_INCREMENT,
                    assessment_id INT(11) NOT NULL,
                    enrollment_details_id INT(11) NOT NULL,
                    raw_score DECIMAL(5,2) NOT NULL,
                    PRIMARY KEY (score_id),
                    KEY idx_student_scores_assessment (assessment_id),
                    KEY idx_student_scores_enrollment (enrollment_details_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");

        $hasAnyLearningAreas = (int) $conn->query("SELECT COUNT(*) FROM learning_areas")->fetchColumn() > 0;
        foreach (['pre_school', 'play_school'] as $category) {
            $countStmt = $conn->prepare("SELECT COUNT(*) FROM learning_areas WHERE category = :category");
            $countStmt->execute([":category" => $category]);
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
            $defaults = $this->getDefaultAreas($category);
            foreach ($defaults as $index => $name) {
                $insertStmt->execute([
                    ":area_name" => $name,
                    ":category" => $category,
                    ":order_index" => $index + 1
                ]);
            }
        }

        $transmutationCount = (int) $conn->query("SELECT COUNT(*) FROM transmutation_table")->fetchColumn();
        if ($transmutationCount === 0) {
            $insertTransmutation = $conn->prepare("INSERT INTO transmutation_table(min_percentage, max_percentage, transmuted_letter)
                                                   VALUES(:min_percentage, :max_percentage, :transmuted_letter)");
            foreach ($this->getDefaultTransmutationRows() as $row) {
                $insertTransmutation->execute([
                    ':min_percentage' => $row['min_percentage'],
                    ':max_percentage' => $row['max_percentage'],
                    ':transmuted_letter' => $row['transmuted_letter']
                ]);
            }
        }

        $playTransmutationCount = (int) $conn->query("SELECT COUNT(*) FROM play_school_transmutation_table")->fetchColumn();
        if ($playTransmutationCount === 0) {
            $this->seedDefaultPlaySchoolTransmutationRows($conn);
        }

        $standardScoreCount = (int) $conn->query("SELECT COUNT(*) FROM play_school_standard_score_table")->fetchColumn();
        if ($standardScoreCount === 0) {
            $this->seedDefaultPlaySchoolStandardScoreRows($conn);
        }

        $interpretationCount = (int) $conn->query("SELECT COUNT(*) FROM play_school_score_interpretations")->fetchColumn();
        if ($interpretationCount === 0) {
            $insertInterpretation = $conn->prepare("INSERT INTO play_school_score_interpretations
                (score_type, min_score, max_score, interpretation_code, interpretation_label, development_level, follow_up_months, order_index)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
            $orderByType = ['scaled' => 0, 'standard' => 0];
            foreach ($this->getDefaultPlaySchoolInterpretations() as $row) {
                $row[] = ++$orderByType[$row[0]];
                $insertInterpretation->execute($row);
            }
        }

        $this->backfillPlaySchoolLearningAreaDomains($conn);
    }

    private function decodePayload($json) {
        if (is_array($json)) {
            return $json;
        }

        $data = json_decode((string) $json, true);
        return is_array($data) ? $data : [];
    }

    private function fetchLearningAreas($conn) {
        $activeSchoolYear = tcGetActiveSchoolYearContext($conn);
        $scopeSchoolYearId = tcResolveLearningAreaSchoolYearId($conn, $activeSchoolYear['school_year_id'] ?? 0);
        $scopeSql = $scopeSchoolYearId === null
            ? 'school_year_id IS NULL'
            : 'school_year_id = :school_year_id';
        $sql = "SELECT area_id,
                       school_year_id,
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
                WHERE {$scopeSql}
                ORDER BY COALESCE(category, ''), order_index ASC, area_id ASC";
        $stmt = $conn->prepare($sql);
        $stmt->execute($scopeSchoolYearId === null ? [] : [':school_year_id' => $scopeSchoolYearId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /**
     * Read learning areas without running CREATE/ALTER statements first.
     *
     * This is the compatibility path for hosted databases whose account does
     * not allow an automatic schema migration. Missing newer columns receive
     * safe defaults in JavaScript until the SQL migration is imported.
     */
    private function fetchLearningAreasReadOnly($conn) {
        try {
            if (tcTableHasColumn($conn, 'learning_areas', 'school_year_id')) {
                return $this->fetchLearningAreas($conn);
            }
        } catch (PDOException $e) {
            error_log('Extended learning area query failed; using legacy columns: ' . $e->getMessage());
        }

        $sql = "SELECT area_id,
                       area_name,
                       category,
                       order_index,
                       is_active
                FROM learning_areas
                ORDER BY COALESCE(category, ''), order_index ASC, area_id ASC";
        $stmt = $conn->prepare($sql);
        $stmt->execute();

        return array_map(function($row) {
            return array_merge([
                'domain_key' => null,
                'domain_label' => null,
                'introduced_quarter' => 1,
                'weight_percentage' => 0,
                'default_perfect_score' => 100
            ], $row);
        }, $stmt->fetchAll(PDO::FETCH_ASSOC));
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

    private function fetchTransmutationRows($conn) {
        $sql = "SELECT transmutation_id, min_percentage, max_percentage, transmuted_letter
                FROM transmutation_table
                ORDER BY max_percentage DESC, min_percentage DESC, transmutation_id ASC";
        $stmt = $conn->prepare($sql);
        $stmt->execute();
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    private function normalizeRawScoreCell($value) {
        $value = preg_replace('/\s+/', '', trim((string) $value));
        return $value === '' ? '-' : $value;
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

    private function getLearningAreaDomainPayload($data) {
        $domainLabel = trim((string) ($data['domain_label'] ?? ''));
        $domainKey = $this->normalizeDomainKey($data['domain_key'] ?? $domainLabel);
        $areaName = trim((string) ($data['area_name'] ?? ''));

        if ($domainLabel === '' || $domainKey === '') {
            $inferred = $this->inferDomainFromAreaName($areaName);
            $domainLabel = $domainLabel ?: $inferred['domain_label'];
            $domainKey = $domainKey ?: $inferred['domain_key'];
        }

        return [
            'domain_key' => $domainKey ?: null,
            'domain_label' => $domainLabel ?: null
        ];
    }

    private function getIntroducedQuarter($data, $conn = null) {
        $quarter = (int) ($data['introduced_quarter'] ?? 1);
        $maximum = 4;
        if ($conn instanceof PDO) {
            $context = tcGetActiveSchoolYearContext($conn);
            $maximum = max(1, (int) ($context['quarter_count'] ?? 3));
        }
        return min($maximum, max(1, $quarter));
    }

    private function seedDefaultPlaySchoolTransmutationRows($conn) {
        $insertStmt = $conn->prepare("INSERT INTO play_school_transmutation_table(
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
                                        order_index
                                      )
                                      VALUES(
                                        :age_key,
                                        :age_label,
                                        :age_order,
                                        :scaled_score,
                                        :gross_motor,
                                        :fine_motor,
                                        :self_help,
                                        :receptive_language,
                                        :expressive_language,
                                        :cognitive,
                                        :social_emotional,
                                        :order_index
                                      )");

        foreach ($this->getDefaultPlaySchoolTransmutationRows() as $row) {
            $insertStmt->execute([
                ':age_key' => $row['age_key'],
                ':age_label' => $row['age_label'],
                ':age_order' => $row['age_order'],
                ':scaled_score' => $row['scaled_score'],
                ':gross_motor' => $row['gross_motor'],
                ':fine_motor' => $row['fine_motor'],
                ':self_help' => $row['self_help'],
                ':receptive_language' => $row['receptive_language'],
                ':expressive_language' => $row['expressive_language'],
                ':cognitive' => $row['cognitive'],
                ':social_emotional' => $row['social_emotional'],
                ':order_index' => $row['order_index']
            ]);
        }
    }

    private function seedDefaultPlaySchoolStandardScoreRows($conn) {
        $insertStmt = $conn->prepare("INSERT INTO play_school_standard_score_table(
                                        sum_scaled_score,
                                        standard_score,
                                        order_index
                                      )
                                      VALUES(
                                        :sum_scaled_score,
                                        :standard_score,
                                        :order_index
                                      )");

        foreach ($this->getDefaultPlaySchoolStandardScoreRows() as $row) {
            $insertStmt->execute([
                ':sum_scaled_score' => $row['sum_scaled_score'],
                ':standard_score' => $row['standard_score'],
                ':order_index' => $row['order_index']
            ]);
        }
    }

    private function fetchPlaySchoolTransmutationTables($conn) {
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

    private function fetchPlaySchoolStandardScoreRows($conn) {
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

    private function fetchPlaySchoolInterpretations($conn) {
        $stmt = $conn->query("SELECT interpretation_id, score_type, min_score, max_score,
                                    interpretation_code, interpretation_label, development_level,
                                    follow_up_months, order_index
                             FROM play_school_score_interpretations
                             WHERE COALESCE(is_archived, 0) = 0
                             ORDER BY score_type, order_index");
        $result = ['scaled' => [], 'standard' => []];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $result[$row['score_type']][] = [
                'interpretation_id' => (int) $row['interpretation_id'],
                'min' => $row['min_score'] === null ? null : (int) $row['min_score'],
                'max' => $row['max_score'] === null ? null : (int) $row['max_score'],
                'code' => $row['interpretation_code'],
                'label' => $row['interpretation_label'],
                'level' => $row['development_level'],
                'follow_up_months' => $row['follow_up_months'] === null ? null : (int) $row['follow_up_months'],
                'order_index' => (int) $row['order_index']
            ];
        }
        return $result;
    }

    function getCardManagementSetup() {
        include "connection-pdo.php";
        $this->ensureTable($conn);

        echo learningAreaJsonEncode([
            'status' => 'success',
            'school_year' => tcGetActiveSchoolYearContext($conn),
            'learning_areas' => $this->fetchLearningAreas($conn),
            'transmutation' => $this->fetchTransmutationRows($conn),
            'play_school_transmutation' => $this->fetchPlaySchoolTransmutationTables($conn),
            'play_school_standard_scores' => $this->fetchPlaySchoolStandardScoreRows($conn),
            'play_school_interpretations' => $this->fetchPlaySchoolInterpretations($conn)
        ]);
    }

    function getAllLearningAreas() {
        include "connection-pdo.php";
        echo learningAreaJsonEncode($this->fetchLearningAreasReadOnly($conn));
    }

    function getLearningAreaById() {
        include "connection-pdo.php";
        $this->ensureTable($conn);
        $area_id = $_GET['area_id'];
        $sql = "SELECT area_id, school_year_id, area_name, category, domain_key, domain_label, introduced_quarter, order_index, is_active, weight_percentage, default_perfect_score
                FROM learning_areas
                WHERE area_id = :id";
        $stmt = $conn->prepare($sql);
        $stmt->bindParam(":id", $area_id);
        $stmt->execute();
        echo learningAreaJsonEncode($stmt->fetch(PDO::FETCH_ASSOC));
    }

    function insertLearningArea($json) {
        include "connection-pdo.php";
        $this->ensureTable($conn);
        $data = $this->decodePayload($json);
        $domain = $this->getLearningAreaDomainPayload($data);
        $activeSchoolYear = tcGetActiveSchoolYearContext($conn);
        $scopeSchoolYearId = tcResolveLearningAreaSchoolYearId($conn, $activeSchoolYear['school_year_id'] ?? 0);

        $sql = "INSERT INTO learning_areas(school_year_id, area_name, category, domain_key, domain_label, introduced_quarter, order_index, is_active, weight_percentage, default_perfect_score)
                VALUES(:school_year_id, :area_name, :category, :domain_key, :domain_label, :introduced_quarter, :order_index, :is_active, :weight_percentage, :default_perfect_score)";
        $stmt = $conn->prepare($sql);
        $stmt->execute([
            ':school_year_id' => $scopeSchoolYearId,
            ':area_name' => trim((string) ($data['area_name'] ?? '')),
            ':category' => $data['category'] ?? 'pre_school',
            ':domain_key' => $domain['domain_key'],
            ':domain_label' => $domain['domain_label'],
            ':introduced_quarter' => $this->getIntroducedQuarter($data, $conn),
            ':order_index' => (int) ($data['order_index'] ?? 1),
            ':is_active' => (int) ($data['is_active'] ?? 1),
            ':weight_percentage' => round((float) ($data['weight_percentage'] ?? 0), 2),
            ':default_perfect_score' => max(0, round((float) ($data['default_perfect_score'] ?? 100), 2))
        ]);

        echo learningAreaJsonEncode($stmt->rowCount() > 0 ? 1 : 0);
    }

    function updateLearningArea($json) {
        include "connection-pdo.php";
        $this->ensureTable($conn);
        $data = $this->decodePayload($json);
        $domain = $this->getLearningAreaDomainPayload($data);

        $sql = "UPDATE learning_areas
                SET area_name = :area_name,
                    category = :category,
                    domain_key = :domain_key,
                    domain_label = :domain_label,
                    introduced_quarter = :introduced_quarter,
                    order_index = :order_index,
                    is_active = :is_active,
                    weight_percentage = :weight_percentage,
                    default_perfect_score = :default_perfect_score
                WHERE area_id = :id";
        $stmt = $conn->prepare($sql);
        $stmt->execute([
            ':area_name' => trim((string) ($data['area_name'] ?? '')),
            ':category' => $data['category'] ?? 'pre_school',
            ':domain_key' => $domain['domain_key'],
            ':domain_label' => $domain['domain_label'],
            ':introduced_quarter' => $this->getIntroducedQuarter($data, $conn),
            ':order_index' => (int) ($data['order_index'] ?? 1),
            ':is_active' => (int) ($data['is_active'] ?? 1),
            ':weight_percentage' => round((float) ($data['weight_percentage'] ?? 0), 2),
            ':default_perfect_score' => max(0, round((float) ($data['default_perfect_score'] ?? 100), 2)),
            ':id' => (int) ($data['area_id'] ?? 0)
        ]);

        echo learningAreaJsonEncode(1);
    }

    function deleteLearningArea($json) {
        include "connection-pdo.php";
        $this->ensureTable($conn);
        $data = $this->decodePayload($json);
        $sql = "DELETE FROM learning_areas WHERE area_id = :id";
        $stmt = $conn->prepare($sql);
        $stmt->execute([':id' => (int) ($data['area_id'] ?? 0)]);
        echo learningAreaJsonEncode($stmt->rowCount() > 0 ? 1 : 0);
    }

    function getAllTransmutationRows() {
        include "connection-pdo.php";
        $this->ensureTable($conn);
        echo learningAreaJsonEncode($this->fetchTransmutationRows($conn));
    }

    function getAllPlaySchoolTransmutationRows() {
        include "connection-pdo.php";
        $this->ensureTable($conn);
        echo learningAreaJsonEncode($this->fetchPlaySchoolTransmutationTables($conn));
    }

    function getAllPlaySchoolStandardScoreRows() {
        include "connection-pdo.php";
        $this->ensureTable($conn);
        echo learningAreaJsonEncode($this->fetchPlaySchoolStandardScoreRows($conn));
    }

    function saveTransmutationRows($json) {
        include "connection-pdo.php";
        $this->ensureTable($conn);
        $data = $this->decodePayload($json);
        $rows = is_array($data['rows'] ?? null) ? $data['rows'] : [];
        $deleteIds = is_array($data['delete_ids'] ?? null) ? $data['delete_ids'] : [];

        try {
            $conn->beginTransaction();

            if ($deleteIds) {
                $deleteStmt = $conn->prepare("DELETE FROM transmutation_table WHERE transmutation_id = :id");
                foreach ($deleteIds as $id) {
                    $deleteStmt->execute([':id' => (int) $id]);
                }
            }

            $updateStmt = $conn->prepare("UPDATE transmutation_table
                                          SET min_percentage = :min_percentage,
                                              max_percentage = :max_percentage,
                                              transmuted_letter = :transmuted_letter
                                          WHERE transmutation_id = :transmutation_id");
            $insertStmt = $conn->prepare("INSERT INTO transmutation_table(min_percentage, max_percentage, transmuted_letter)
                                          VALUES(:min_percentage, :max_percentage, :transmuted_letter)");

            foreach ($rows as $row) {
                $payload = [
                    ':min_percentage' => round((float) ($row['min_percentage'] ?? 0), 2),
                    ':max_percentage' => round((float) ($row['max_percentage'] ?? 0), 2),
                    ':transmuted_letter' => strtoupper(trim((string) ($row['transmuted_letter'] ?? '')))
                ];

                $id = (int) ($row['transmutation_id'] ?? 0);
                if ($id > 0) {
                    $payload[':transmutation_id'] = $id;
                    $updateStmt->execute($payload);
                } else {
                    $insertStmt->execute($payload);
                }
            }

            $conn->commit();
            echo learningAreaJsonEncode([
                'status' => 'success',
                'transmutation' => $this->fetchTransmutationRows($conn)
            ]);
        } catch (Exception $e) {
            if ($conn->inTransaction()) {
                $conn->rollBack();
            }

            echo learningAreaJsonEncode(['status' => 'error', 'message' => $e->getMessage()]);
        }
    }

    function savePlaySchoolTransmutationRows($json) {
        include "connection-pdo.php";
        $this->ensureTable($conn);
        $data = $this->decodePayload($json);
        $rows = is_array($data['rows'] ?? null) ? $data['rows'] : [];
        $standardRows = is_array($data['standard_rows'] ?? null) ? $data['standard_rows'] : [];
        $interpretations = is_array($data['interpretations'] ?? null) ? $data['interpretations'] : [];
        $archiveTransmutationIds = array_values(array_filter(array_map('intval', is_array($data['archive_transmutation_ids'] ?? null) ? $data['archive_transmutation_ids'] : [])));
        $archiveStandardIds = array_values(array_filter(array_map('intval', is_array($data['archive_standard_ids'] ?? null) ? $data['archive_standard_ids'] : [])));
        $archiveInterpretationIds = array_values(array_filter(array_map('intval', is_array($data['archive_interpretation_ids'] ?? null) ? $data['archive_interpretation_ids'] : [])));

        try {
            $conn->beginTransaction();

            $upsertStmt = $conn->prepare("INSERT INTO play_school_transmutation_table(
                                            play_transmutation_id,
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
                                            order_index,
                                            is_archived
                                          )
                                          VALUES(
                                            :play_transmutation_id,
                                            :age_key,
                                            :age_label,
                                            :age_order,
                                            :scaled_score,
                                            :gross_motor,
                                            :fine_motor,
                                            :self_help,
                                            :receptive_language,
                                            :expressive_language,
                                            :cognitive,
                                            :social_emotional,
                                            :extra_ranges,
                                            :order_index,
                                            :is_archived
                                          )
                                          ON DUPLICATE KEY UPDATE
                                            age_label = VALUES(age_label),
                                            age_order = VALUES(age_order),
                                            scaled_score = VALUES(scaled_score),
                                            gross_motor = VALUES(gross_motor),
                                            fine_motor = VALUES(fine_motor),
                                            self_help = VALUES(self_help),
                                            receptive_language = VALUES(receptive_language),
                                            expressive_language = VALUES(expressive_language),
                                            cognitive = VALUES(cognitive),
                                            social_emotional = VALUES(social_emotional),
                                            extra_ranges = VALUES(extra_ranges),
                                            order_index = VALUES(order_index),
                                            is_archived = VALUES(is_archived)");

            if ($archiveTransmutationIds) {
                $placeholders = implode(',', array_fill(0, count($archiveTransmutationIds), '?'));
                $archiveTransmutationStmt = $conn->prepare("UPDATE play_school_transmutation_table
                    SET is_archived = 1,
                        scaled_score = play_transmutation_id * -1
                    WHERE play_transmutation_id IN ($placeholders)");
                $archiveTransmutationStmt->execute($archiveTransmutationIds);
            }

            foreach ($rows as $row) {
                $id = (int) ($row['play_transmutation_id'] ?? 0);
                $knownKeys = [
                    'play_transmutation_id', 'age_key', 'age_label', 'age_order', 'scaled_score', 'order_index',
                    'gross_motor', 'fine_motor', 'self_help', 'receptive_language', 'expressive_language', 'cognitive', 'social_emotional'
                ];
                $extraRanges = [];
                foreach ($row as $key => $value) {
                    if (!in_array($key, $knownKeys, true)) {
                        $extraRanges[$this->normalizeDomainKey($key)] = $this->normalizeRawScoreCell($value);
                    }
                }
                $upsertStmt->execute([
                    ':play_transmutation_id' => $id > 0 ? $id : null,
                    ':age_key' => trim((string) ($row['age_key'] ?? '')),
                    ':age_label' => trim((string) ($row['age_label'] ?? '')),
                    ':age_order' => max(1, (int) ($row['age_order'] ?? 1)),
                    ':scaled_score' => max(1, (int) ($row['scaled_score'] ?? 1)),
                    ':gross_motor' => $this->normalizeRawScoreCell($row['gross_motor'] ?? '-'),
                    ':fine_motor' => $this->normalizeRawScoreCell($row['fine_motor'] ?? '-'),
                    ':self_help' => $this->normalizeRawScoreCell($row['self_help'] ?? '-'),
                    ':receptive_language' => $this->normalizeRawScoreCell($row['receptive_language'] ?? '-'),
                    ':expressive_language' => $this->normalizeRawScoreCell($row['expressive_language'] ?? '-'),
                    ':cognitive' => $this->normalizeRawScoreCell($row['cognitive'] ?? '-'),
                    ':social_emotional' => $this->normalizeRawScoreCell($row['social_emotional'] ?? '-'),
                    ':extra_ranges' => $extraRanges ? json_encode($extraRanges) : null,
                    ':order_index' => max(1, (int) ($row['order_index'] ?? 1)),
                    ':is_archived' => 0
                ]);
            }

            if ($archiveStandardIds) {
                $placeholders = implode(',', array_fill(0, count($archiveStandardIds), '?'));
                $archiveStandardStmt = $conn->prepare("UPDATE play_school_standard_score_table
                    SET is_archived = 1,
                        sum_scaled_score = standard_score_id * -1
                    WHERE standard_score_id IN ($placeholders)");
                $archiveStandardStmt->execute($archiveStandardIds);
            }

            $standardStmt = $conn->prepare("INSERT INTO play_school_standard_score_table(
                                                standard_score_id,
                                                sum_scaled_score,
                                                standard_score,
                                                order_index,
                                                is_archived
                                            )
                                            VALUES(
                                                :standard_score_id,
                                                :sum_scaled_score,
                                                :standard_score,
                                                :order_index,
                                                :is_archived
                                            )
                                            ON DUPLICATE KEY UPDATE
                                                standard_score = VALUES(standard_score),
                                                order_index = VALUES(order_index),
                                                is_archived = VALUES(is_archived)");

            foreach ($standardRows as $row) {
                $id = (int) ($row['standard_score_id'] ?? 0);
                $standardStmt->execute([
                    ':standard_score_id' => $id > 0 ? $id : null,
                    ':sum_scaled_score' => max(1, (int) ($row['sum_scaled_score'] ?? 1)),
                    ':standard_score' => max(1, (int) ($row['standard_score'] ?? 1)),
                    ':order_index' => max(1, (int) ($row['order_index'] ?? 1)),
                    ':is_archived' => 0
                ]);
            }

            if ($archiveInterpretationIds) {
                $placeholders = implode(',', array_fill(0, count($archiveInterpretationIds), '?'));
                $archiveInterpretationStmt = $conn->prepare("UPDATE play_school_score_interpretations
                    SET is_archived = 1,
                        order_index = interpretation_id + 1000
                    WHERE interpretation_id IN ($placeholders)");
                $archiveInterpretationStmt->execute($archiveInterpretationIds);
            }

            $interpretationStmt = $conn->prepare("INSERT INTO play_school_score_interpretations(
                    interpretation_id, score_type, min_score, max_score, interpretation_code,
                    interpretation_label, development_level, follow_up_months, order_index, is_archived)
                VALUES(:id, :type, :min_score, :max_score, :code, :label, :level, :follow_up, :order_index, :is_archived)
                ON DUPLICATE KEY UPDATE min_score = VALUES(min_score), max_score = VALUES(max_score),
                    interpretation_code = VALUES(interpretation_code), interpretation_label = VALUES(interpretation_label),
                    development_level = VALUES(development_level), follow_up_months = VALUES(follow_up_months),
                    order_index = VALUES(order_index), is_archived = VALUES(is_archived)");
            foreach (['scaled', 'standard'] as $type) {
                foreach (($interpretations[$type] ?? []) as $index => $row) {
                    $id = (int) ($row['interpretation_id'] ?? 0);
                    $min = $row['min'] ?? null;
                    $max = $row['max'] ?? null;
                    $interpretationStmt->execute([
                        ':id' => $id > 0 ? $id : null,
                        ':type' => $type,
                        ':min_score' => $min === null || $min === '' ? null : (int) $min,
                        ':max_score' => $max === null || $max === '' ? null : (int) $max,
                        ':code' => trim((string) ($row['code'] ?? "range_" . ($index + 1))),
                        ':label' => trim((string) ($row['label'] ?? '')),
                        ':level' => trim((string) ($row['level'] ?? 'average')),
                        ':follow_up' => ($row['follow_up_months'] ?? null) === null ? null : (int) $row['follow_up_months'],
                        ':order_index' => $index + 1,
                        ':is_archived' => 0
                    ]);
                }
            }

            $conn->commit();
            echo learningAreaJsonEncode([
                'status' => 'success',
                'play_school_transmutation' => $this->fetchPlaySchoolTransmutationTables($conn),
                'play_school_standard_scores' => $this->fetchPlaySchoolStandardScoreRows($conn),
                'play_school_interpretations' => $this->fetchPlaySchoolInterpretations($conn)
            ]);
        } catch (Exception $e) {
            if ($conn->inTransaction()) {
                $conn->rollBack();
            }

            echo learningAreaJsonEncode(['status' => 'error', 'message' => $e->getMessage()]);
        }
    }
}

if ($_SERVER['REQUEST_METHOD'] == 'GET') {
    $operation = $_GET['operation'] ?? '';
    $json = $_GET['json'] ?? "";
} else {
    $operation = $_POST['operation'] ?? '';
    $json = $_POST['json'] ?? "";
}

try {
    $manager = new LearningAreaManager();
    switch ($operation) {
        case "getCardManagementSetup": $manager->getCardManagementSetup(); break;
        case "getAllLearningAreas": $manager->getAllLearningAreas(); break;
        case "getLearningAreaById": $manager->getLearningAreaById(); break;
        case "insertLearningArea": $manager->insertLearningArea($json); break;
        case "updateLearningArea": $manager->updateLearningArea($json); break;
        case "deleteLearningArea": $manager->deleteLearningArea($json); break;
        case "getAllTransmutationRows": $manager->getAllTransmutationRows(); break;
        case "saveTransmutationRows": $manager->saveTransmutationRows($json); break;
        case "getAllPlaySchoolTransmutationRows": $manager->getAllPlaySchoolTransmutationRows(); break;
        case "getAllPlaySchoolStandardScoreRows": $manager->getAllPlaySchoolStandardScoreRows(); break;
        case "savePlaySchoolTransmutationRows": $manager->savePlaySchoolTransmutationRows($json); break;
        default: echo learningAreaJsonEncode(['status' => 'error', 'message' => 'Invalid Operation']); break;
    }
} catch (Throwable $e) {
    error_log('Learning area API failed: ' . $e->getMessage());
    if (!headers_sent()) {
        header('Content-Type: application/json');
        http_response_code(500);
    }
    echo learningAreaJsonEncode([
        'status' => 'error',
        'message' => 'Unable to load the card management database setup.',
        'detail' => $e->getMessage()
    ]);
}
?>
