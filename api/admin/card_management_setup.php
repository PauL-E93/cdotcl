<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

require_once __DIR__ . '/../school_year_context.php';

// Read-only bootstrap: no CREATE or ALTER statements are executed here.
function cardJsonResponse($payload, $statusCode = 200) {
    http_response_code($statusCode);
    $json = json_encode($payload, JSON_INVALID_UTF8_SUBSTITUTE | JSON_UNESCAPED_UNICODE);
    if ($json === false) {
        http_response_code(500);
        $json = '{"status":"error","message":"Unable to encode the card management response."}';
    }
    echo $json;
    exit;
}

function cardTableColumns(PDO $conn, $table) {
    $stmt = $conn->query("SHOW COLUMNS FROM `{$table}`");
    return $stmt ? $stmt->fetchAll(PDO::FETCH_COLUMN, 0) : [];
}

function cardHasColumn($columns, $column) {
    return in_array($column, $columns, true);
}

function cardSelectColumn($columns, $column, $fallbackSql) {
    return cardHasColumn($columns, $column) ? "`{$column}`" : "{$fallbackSql} AS `{$column}`";
}

function cardOptionalRows(PDO $conn, $sql) {
    try {
        $stmt = $conn->query($sql);
        return $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
    } catch (Throwable $e) {
        error_log('Optional card setup query skipped: ' . $e->getMessage());
        return [];
    }
}

try {
    ob_start();
    require __DIR__ . '/connection-pdo.php';
    ob_end_clean();

    $columns = cardTableColumns($conn, 'learning_areas');
    $schoolYear = tcGetActiveSchoolYearContext($conn);
    $scopeSchoolYearId = cardHasColumn($columns, 'school_year_id')
        ? tcResolveLearningAreaSchoolYearId($conn, $schoolYear['school_year_id'] ?? 0)
        : null;
    $select = [
        cardSelectColumn($columns, 'area_id', '0'),
        cardSelectColumn($columns, 'school_year_id', 'NULL'),
        cardSelectColumn($columns, 'area_name', "''"),
        cardSelectColumn($columns, 'category', "'play_school'"),
        cardSelectColumn($columns, 'domain_key', 'NULL'),
        cardSelectColumn($columns, 'domain_label', 'NULL'),
        cardSelectColumn($columns, 'introduced_quarter', '1'),
        cardSelectColumn($columns, 'order_index', '1'),
        cardSelectColumn($columns, 'is_active', '1'),
        cardSelectColumn($columns, 'weight_percentage', '0'),
        cardSelectColumn($columns, 'default_perfect_score', '100')
    ];
    $order = [];
    foreach (['category', 'order_index', 'area_id'] as $column) {
        if (cardHasColumn($columns, $column)) $order[] = "`{$column}` ASC";
    }
    $scopeSql = cardHasColumn($columns, 'school_year_id')
        ? ($scopeSchoolYearId === null ? ' WHERE `school_year_id` IS NULL' : ' WHERE `school_year_id` = ' . (int) $scopeSchoolYearId)
        : '';
    $sql = 'SELECT ' . implode(', ', $select) . ' FROM `learning_areas`' . $scopeSql
        . ($order ? ' ORDER BY ' . implode(', ', $order) : '');
    $learningAreas = cardOptionalRows($conn, $sql);

    $transmutation = cardOptionalRows($conn,
        'SELECT transmutation_id, min_percentage, max_percentage, transmuted_letter '
        . 'FROM transmutation_table ORDER BY max_percentage DESC, min_percentage DESC, transmutation_id ASC'
    );

    $playRows = cardOptionalRows($conn,
        'SELECT play_transmutation_id, age_key, age_label, age_order, scaled_score, '
        . 'gross_motor, fine_motor, self_help, receptive_language, expressive_language, '
        . 'cognitive, social_emotional, extra_ranges, order_index '
        . 'FROM play_school_transmutation_table WHERE COALESCE(is_archived, 0) = 0 '
        . 'ORDER BY age_order ASC, order_index ASC, scaled_score ASC'
    );
    $playTables = [];
    foreach ($playRows as $row) {
        $ageKey = (string) $row['age_key'];
        if (!isset($playTables[$ageKey])) {
            $playTables[$ageKey] = [
                'age_key' => $ageKey,
                'age_label' => $row['age_label'],
                'age_order' => (int) $row['age_order'],
                'rows' => []
            ];
        }
        $extra = json_decode((string) ($row['extra_ranges'] ?? ''), true);
        unset($row['age_key'], $row['age_label'], $row['age_order'], $row['extra_ranges']);
        $playTables[$ageKey]['rows'][] = array_merge($row, is_array($extra) ? $extra : []);
    }

    $standardScores = cardOptionalRows($conn,
        'SELECT standard_score_id, sum_scaled_score, standard_score, order_index '
        . 'FROM play_school_standard_score_table WHERE COALESCE(is_archived, 0) = 0 '
        . 'ORDER BY order_index ASC, sum_scaled_score ASC'
    );

    $interpretationRows = cardOptionalRows($conn,
        'SELECT interpretation_id, score_type, min_score, max_score, interpretation_code, '
        . 'interpretation_label, development_level, follow_up_months, order_index '
        . 'FROM play_school_score_interpretations WHERE COALESCE(is_archived, 0) = 0 '
        . 'ORDER BY score_type, order_index'
    );
    $interpretations = ['scaled' => [], 'standard' => []];
    foreach ($interpretationRows as $row) {
        $type = $row['score_type'] === 'standard' ? 'standard' : 'scaled';
        $interpretations[$type][] = [
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

    cardJsonResponse([
        'status' => 'success',
        'api_version' => 'hosted-readonly-v1',
        'school_year' => $schoolYear,
        'learning_areas' => $learningAreas,
        'transmutation' => $transmutation,
        'play_school_transmutation' => array_values($playTables),
        'play_school_standard_scores' => $standardScores,
        'play_school_interpretations' => $interpretations
    ]);
} catch (Throwable $e) {
    if (ob_get_level() > 0) ob_end_clean();
    error_log('Card management setup failed: ' . $e->getMessage());
    cardJsonResponse([
        'status' => 'error',
        'api_version' => 'hosted-readonly-v1',
        'message' => 'Unable to read the card management setup.',
        'detail' => $e->getMessage()
    ], 500);
}
