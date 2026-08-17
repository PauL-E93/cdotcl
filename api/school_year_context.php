<?php

/**
 * Shared school-year helpers used by curriculum and report-card APIs.
 *
 * The JSON quarter map is the source of truth. The four legacy columns are
 * retained only as a fallback for calendars created before quarters_json.
 */
function tcDefaultQuarterLabel($number) {
    $number = max(1, (int) $number);
    $mod10 = $number % 10;
    $mod100 = $number % 100;
    if ($mod10 === 1 && $mod100 !== 11) return $number . 'st Quarter';
    if ($mod10 === 2 && $mod100 !== 12) return $number . 'nd Quarter';
    if ($mod10 === 3 && $mod100 !== 13) return $number . 'rd Quarter';
    return $number . 'th Quarter';
}

function tcParseSchoolYearQuarters($row, $fallbackCount = 3) {
    $quarters = [];
    $decoded = json_decode((string) ($row['quarters_json'] ?? ''), true);

    if (is_array($decoded)) {
        foreach (array_values($decoded) as $index => $quarter) {
            if (!is_array($quarter)) continue;
            $number = $index + 1;
            $quarters[] = [
                'number' => $number,
                'label' => trim((string) ($quarter['label'] ?? '')) ?: tcDefaultQuarterLabel($number),
                'start_date' => $quarter['start_date'] ?? null,
                'end_date' => $quarter['end_date'] ?? null
            ];
        }
    }

    if (!$quarters) {
        for ($number = 1; $number <= 4; $number++) {
            $start = $row['quarter_' . $number . '_start'] ?? null;
            $end = $row['quarter_' . $number . '_end'] ?? null;
            if (!$start && !$end) continue;
            $quarters[] = [
                'number' => $number,
                'label' => tcDefaultQuarterLabel($number),
                'start_date' => $start,
                'end_date' => $end
            ];
        }
    }

    if (!$quarters && $fallbackCount > 0) {
        for ($number = 1; $number <= $fallbackCount; $number++) {
            $quarters[] = [
                'number' => $number,
                'label' => tcDefaultQuarterLabel($number),
                'start_date' => null,
                'end_date' => null
            ];
        }
    }

    return $quarters;
}

function tcFormatSchoolYearContext($row, $fallbackCount = 3) {
    if (!$row) return null;
    $quarters = tcParseSchoolYearQuarters($row, $fallbackCount);
    return [
        'school_year_id' => (int) ($row['school_year_id'] ?? 0),
        'school_year' => (string) ($row['school_year'] ?? ''),
        'start_date' => $row['start_date'] ?? null,
        'end_date' => $row['end_date'] ?? null,
        'sy_status' => $row['sy_status'] ?? null,
        'quarter_count' => count($quarters),
        'quarters' => $quarters
    ];
}

function tcSchoolYearSelectSql() {
    return "school_year_id, school_year, start_date, end_date,
            quarter_1_start, quarter_1_end, quarter_2_start, quarter_2_end,
            quarter_3_start, quarter_3_end, quarter_4_start, quarter_4_end,
            quarters_json, sy_status";
}

function tcGetActiveSchoolYearContext(PDO $conn, $fallbackCount = 3) {
    $stmt = $conn->query('SELECT ' . tcSchoolYearSelectSql() . "
                          FROM school_years
                          WHERE sy_status = 'active'
                          ORDER BY school_year_id DESC
                          LIMIT 1");
    return tcFormatSchoolYearContext($stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : null, $fallbackCount);
}

function tcGetSchoolYearContext(PDO $conn, $schoolYearId, $fallbackCount = 3) {
    $schoolYearId = (int) $schoolYearId;
    if ($schoolYearId <= 0) return tcGetActiveSchoolYearContext($conn, $fallbackCount);

    $stmt = $conn->prepare('SELECT ' . tcSchoolYearSelectSql() . '
                            FROM school_years
                            WHERE school_year_id = :school_year_id
                            LIMIT 1');
    $stmt->execute([':school_year_id' => $schoolYearId]);
    return tcFormatSchoolYearContext($stmt->fetch(PDO::FETCH_ASSOC), $fallbackCount);
}

function tcGetEnrollmentSchoolYearContext(PDO $conn, $enrollmentDetailsId, $fallbackCount = 3) {
    $stmt = $conn->prepare("SELECT sy.school_year_id, sy.school_year, sy.start_date, sy.end_date,
                                  sy.quarter_1_start, sy.quarter_1_end,
                                  sy.quarter_2_start, sy.quarter_2_end,
                                  sy.quarter_3_start, sy.quarter_3_end,
                                  sy.quarter_4_start, sy.quarter_4_end,
                                  sy.quarters_json, sy.sy_status
                           FROM enrollment_details ed
                           JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                           LEFT JOIN school_years sy ON eh.school_year_id = sy.school_year_id
                           WHERE ed.enrollment_details_id = :enrollment_details_id
                           LIMIT 1");
    $stmt->execute([':enrollment_details_id' => (int) $enrollmentDetailsId]);
    $context = tcFormatSchoolYearContext($stmt->fetch(PDO::FETCH_ASSOC), $fallbackCount);
    return $context ?: tcGetActiveSchoolYearContext($conn, $fallbackCount);
}

function tcTableHasColumn(PDO $conn, $table, $column) {
    $stmt = $conn->prepare("SELECT COUNT(*)
                            FROM INFORMATION_SCHEMA.COLUMNS
                            WHERE TABLE_SCHEMA = DATABASE()
                              AND TABLE_NAME = :table_name
                              AND COLUMN_NAME = :column_name");
    $stmt->execute([':table_name' => $table, ':column_name' => $column]);
    return (int) $stmt->fetchColumn() > 0;
}

/**
 * Exact school-year rows win. NULL rows are the legacy curriculum shared by
 * school years that existed before curriculum versioning was introduced.
 */
function tcResolveLearningAreaSchoolYearId(PDO $conn, $schoolYearId) {
    $schoolYearId = (int) $schoolYearId;
    if ($schoolYearId <= 0 || !tcTableHasColumn($conn, 'learning_areas', 'school_year_id')) {
        return null;
    }

    $stmt = $conn->prepare('SELECT COUNT(*) FROM learning_areas WHERE school_year_id = :school_year_id');
    $stmt->execute([':school_year_id' => $schoolYearId]);
    return (int) $stmt->fetchColumn() > 0 ? $schoolYearId : null;
}

