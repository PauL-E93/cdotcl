<?php
function ensureAgreementSchema(PDO $db): void
{
    static $ready = false;
    if ($ready) return;
    $db->exec(file_get_contents(__DIR__ . '/migrations/20261014_agreements.sql'));
    $column = $db->query("SHOW COLUMNS FROM enrollment_applications LIKE 'tutorial_setup'")->fetch();
    if (!$column) $db->exec("ALTER TABLE enrollment_applications ADD tutorial_setup ENUM('center','home','online') DEFAULT NULL");
    $ready = true;
}

function agreementTemplates(PDO $db, int $programId, string $setup, bool $all = false, bool $lock = false): array
{
    $sql = 'SELECT * FROM agreement_templates';
    $args = [];
    if (!$all) {
        $sql .= " WHERE status = 'active' AND (program_id IS NULL OR program_id = ?) AND (tutorial_setup = 'all' OR tutorial_setup = ?)";
        $args = [$programId, $setup];
    }
    $sql .= ' ORDER BY display_order, agreement_id' . ($lock ? ' FOR UPDATE' : '');
    $stmt = $db->prepare($sql);
    $stmt->execute($args);
    $records = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $clauses = $db->prepare('SELECT clause_id, clause_text, is_required, display_order FROM agreement_clauses WHERE agreement_id = ? ORDER BY display_order, clause_id');
    foreach ($records as &$record) {
        $clauses->execute([$record['agreement_id']]);
        $record['clauses'] = $clauses->fetchAll(PDO::FETCH_ASSOC);
        // A content fingerprint detects edits without retaining template versions.
        $record['content_hash'] = hash('sha256', json_encode($record, JSON_UNESCAPED_UNICODE));
    }
    return $records;
}

function programAgreementSetup(PDO $db, int $programId): ?string
{
    $stmt = $db->prepare('SELECT pt.type FROM program p JOIN program_type pt ON pt.program_type_id = p.program_type WHERE p.program_id = ?');
    $stmt->execute([$programId]);
    return agreementSetupFromProgramType((string)$stmt->fetchColumn());
}

function agreementSetupFromProgramType(string $programType): ?string
{
    $type = strtolower(trim($programType));
    if (preg_match('/home|house/', $type)) return 'home';
    if (str_contains($type, 'online')) return 'online';
    if (preg_match('/center|centre|pre.?school|play.?school/', $type)) return 'center';
    return null;
}

function saveAgreementAcceptances(PDO $db, int $applicationId, int $studentId, int $programId, array $data): void
{
    $setup = (string)($data['tutorial_setup'] ?? '');
    if (!in_array($setup, ['center', 'home', 'online'], true)) throw new InvalidArgumentException('Choose the tutorial setup.');
    $expected = programAgreementSetup($db, $programId);
    if ($expected && $setup !== $expected) throw new InvalidArgumentException('The tutorial setup must match the selected program.');
    $templates = agreementTemplates($db, $programId, $setup, false, true);
    $submitted = (array)($data['agreements'] ?? []);
    if (count($submitted) !== count($templates)) throw new InvalidArgumentException('The applicable agreements changed. Reload and review them before submitting.');
    $guardianName = trim((string)($data['agreement_guardian_name'] ?? ''));
    if ($templates && ($guardianName === '' || mb_strlen($guardianName) > 255)) throw new InvalidArgumentException('Enter the accepting parent/guardian name (up to 255 characters).');
    $insert = $db->prepare('INSERT INTO agreement_acceptances (agreement_id, application_id, student_id, guardian_name, tutorial_setup, checked_clauses_json, agreement_snapshot_json) VALUES (?, ?, ?, ?, ?, ?, ?)');
    foreach ($templates as $template) {
        $matches = array_values(array_filter($submitted, fn($item) => is_array($item) && (int)($item['agreement_id'] ?? 0) === (int)$template['agreement_id']));
        if (count($matches) !== 1 || !hash_equals($template['content_hash'], (string)($matches[0]['content_hash'] ?? ''))) {
            throw new InvalidArgumentException('An agreement changed. Reload and review the updated wording before submitting.');
        }
        $checked = array_values(array_unique(array_map('intval', (array)($matches[0]['checked_clause_ids'] ?? []))));
        $known = array_map('intval', array_column($template['clauses'], 'clause_id'));
        if (array_diff($checked, $known)) throw new InvalidArgumentException('Invalid agreement acknowledgment.');
        foreach ($template['clauses'] as $clause) {
            if ($clause['is_required'] && !in_array((int)$clause['clause_id'], $checked, true)) throw new InvalidArgumentException('Acknowledge every required agreement statement.');
        }
        $insert->execute([$template['agreement_id'], $applicationId, $studentId, $guardianName, $setup, json_encode($checked), json_encode($template, JSON_UNESCAPED_UNICODE)]);
    }
    $db->prepare('UPDATE enrollment_applications SET tutorial_setup = ? WHERE application_id = ?')->execute([$setup, $applicationId]);
}

function applicationAgreements(PDO $db, int $applicationId): array
{
    $stmt = $db->prepare('SELECT acceptance_id, guardian_name, tutorial_setup, accepted_at, checked_clauses_json, agreement_snapshot_json FROM agreement_acceptances WHERE application_id = ? ORDER BY acceptance_id');
    $stmt->execute([$applicationId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$row) {
        $row['snapshot'] = json_decode($row['agreement_snapshot_json'], true);
        $row['checked_clause_ids'] = json_decode($row['checked_clauses_json'], true);
        unset($row['agreement_snapshot_json'], $row['checked_clauses_json']);
    }
    return $rows;
}

function enrollmentAgreementRecords(PDO $db, int $enrollmentId): array
{
    $stmt = $db->prepare("SELECT aa.guardian_name, aa.tutorial_setup, aa.accepted_at,
        aa.checked_clauses_json, aa.agreement_snapshot_json, ea.application_number
        FROM agreement_acceptances aa JOIN enrollment_applications ea ON ea.application_id = aa.application_id
        WHERE ea.enrollment_details_id = ?
        UNION ALL
        SELECT guardian_name, tutorial_setup, accepted_at, checked_clauses_json, agreement_snapshot_json, ''
        FROM enrollment_agreement_acceptances WHERE enrollment_details_id = ?
        ORDER BY accepted_at DESC");
    $stmt->execute([$enrollmentId, $enrollmentId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$row) {
        $row['snapshot'] = json_decode($row['agreement_snapshot_json'], true);
        $row['checked_clause_ids'] = json_decode($row['checked_clauses_json'], true);
        unset($row['agreement_snapshot_json'], $row['checked_clauses_json']);
    }
    return $rows;
}

function enrollmentAgreementState(PDO $db, int $enrollmentId, int $programId, string $setup = '', bool $lock = false): array
{
    $expected = programAgreementSetup($db, $programId);
    if ($expected) $setup = $expected;
    if (!$setup) {
        $choice = $db->prepare('SELECT tutorial_setup FROM enrollment_applications WHERE enrollment_details_id = ? ORDER BY application_id DESC LIMIT 1');
        $choice->execute([$enrollmentId]);
        $setup = $choice->fetchColumn() ?: '';
    }
    $accepted = enrollmentAgreementRecords($db, $enrollmentId);
    if (!$setup && $accepted) $setup = $accepted[0]['tutorial_setup'];
    $acceptedIds = array_map(fn($row) => (int)$row['snapshot']['agreement_id'], $accepted);
    $current = agreementTemplates($db, $programId, $setup, false, $lock);
    $pending = array_values(array_filter($current, fn($template) => !in_array((int)$template['agreement_id'], $acceptedIds, true)));
    return ['current' => $current, 'pending' => $pending, 'accepted' => $accepted, 'tutorial_setup' => $setup];
}

// The caller must hold a transaction; locking the enrollment serializes submits.
function acceptEnrollmentAgreements(PDO $db, int $enrollmentId, int $studentId, array $data): void
{
    $enrollment = $db->prepare('SELECT ed.program_id FROM enrollment_details ed
        JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
        WHERE ed.enrollment_details_id = ? AND eh.student_id = ? FOR UPDATE');
    $enrollment->execute([$enrollmentId, $studentId]);
    $programId = $enrollment->fetchColumn();
    if ($programId === false) throw new InvalidArgumentException('Enrollment not found.');
    $setup = (string)($data['tutorial_setup'] ?? '');
    if (!in_array($setup, ['center', 'home', 'online'], true)) throw new InvalidArgumentException('Choose the tutorial setup.');
    $state = enrollmentAgreementState($db, $enrollmentId, (int)$programId, $setup, true);
    if ($setup !== $state['tutorial_setup']) throw new InvalidArgumentException('The tutorial setup must match the selected program.');
    $templates = $state['pending'];
    $submitted = $data['agreements'] ?? [];
    if (!is_array($submitted) || !$templates || count($submitted) !== count($templates)) throw new InvalidArgumentException('The pending agreements changed. Reload and review them before submitting.');
    $guardian = trim((string)($data['agreement_guardian_name'] ?? ''));
    if ($guardian === '' || mb_strlen($guardian) > 255) throw new InvalidArgumentException('Enter the accepting parent/guardian name (up to 255 characters).');
    $insert = $db->prepare('INSERT INTO enrollment_agreement_acceptances
        (agreement_id, enrollment_details_id, student_id, guardian_name, tutorial_setup, checked_clauses_json, agreement_snapshot_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)');
    foreach ($templates as $template) {
        $matches = array_values(array_filter($submitted, fn($item) => is_array($item) && (int)($item['agreement_id'] ?? 0) === (int)$template['agreement_id']));
        if (count($matches) !== 1 || !hash_equals($template['content_hash'], (string)($matches[0]['content_hash'] ?? ''))) throw new InvalidArgumentException('An agreement changed. Reload and review the updated wording before submitting.');
        $checked = array_values(array_unique(array_map('intval', (array)($matches[0]['checked_clause_ids'] ?? []))));
        $known = array_map('intval', array_column($template['clauses'], 'clause_id'));
        if (array_diff($checked, $known)) throw new InvalidArgumentException('Invalid agreement acknowledgment.');
        foreach ($template['clauses'] as $clause) {
            if ($clause['is_required'] && !in_array((int)$clause['clause_id'], $checked, true)) throw new InvalidArgumentException('Acknowledge every required agreement statement.');
        }
        $insert->execute([$template['agreement_id'], $enrollmentId, $studentId, $guardian, $setup, json_encode($checked), json_encode($template, JSON_UNESCAPED_UNICODE)]);
    }
}
