<?php
require_once __DIR__ . '/security/AuthGuard.php';
require_once __DIR__ . '/agreement_helper.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
$operation = (string)($_GET['operation'] ?? '');
$body = json_decode(file_get_contents('php://input'), true) ?: [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') $operation = (string)($body['operation'] ?? '');
try {
    $db = AuthGuard::connection();
    if ($operation === 'applicable' && $_SERVER['REQUEST_METHOD'] === 'GET') {
        $program = (int)($_GET['program_id'] ?? 0);
        $setup = (string)($_GET['tutorial_setup'] ?? '');
        if ($program <= 0 || !in_array($setup, ['center','home','online'], true)) throw new InvalidArgumentException('Choose a program and tutorial setup.');
        ensureAgreementSchema($db);
        $data = agreementTemplates($db, $program, $setup);
    } elseif (in_array($operation, ['manage', 'save'], true)) {
        AuthGuard::requireRoles(['owner']);
        ensureAgreementSchema($db);
        if ($operation === 'save') {
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') AuthGuard::deny(405, 'Saving requires POST.');
            $record = $body['data'] ?? [];
            $id = (int)($record['agreement_id'] ?? 0);
            $title = trim((string)($record['title'] ?? ''));
            $status = (string)($record['status'] ?? 'inactive');
            $programSelection = (string)($record['program_id'] ?? '');
            if ($programSelection === '' || ($programSelection !== 'all' && !ctype_digit($programSelection))) throw new InvalidArgumentException('Select a program or All programs.');
            $program = (int)$programSelection ?: null;
            if ($program) {
                $programExists = $db->prepare('SELECT program_id FROM program WHERE program_id = ?');
                $programExists->execute([$program]);
                if (!$programExists->fetchColumn()) throw new InvalidArgumentException('Select an available program.');
            }
            $setup = $program ? (programAgreementSetup($db, $program) ?? 'all') : 'all';
            $clauses = $record['clauses'] ?? [];
            if ($title === '' || mb_strlen($title) > 255 || !in_array($status, ['active','inactive'], true)) throw new InvalidArgumentException('Enter a valid heading and status.');
            if (!is_array($clauses) || !$clauses || count($clauses) > 100) throw new InvalidArgumentException('Add between 1 and 100 statements.');
            foreach ($clauses as $clause) {
                if (!is_array($clause) || trim((string)($clause['clause_text'] ?? '')) === '' || mb_strlen((string)$clause['clause_text']) > 10000) throw new InvalidArgumentException('Each statement needs text of up to 10,000 characters.');
            }
            $db->beginTransaction();
            if ($id) {
                $exists = $db->prepare('SELECT agreement_id FROM agreement_templates WHERE agreement_id = ? FOR UPDATE');
                $exists->execute([$id]);
                if (!$exists->fetchColumn()) throw new InvalidArgumentException('Agreement not found.');
                $stmt = $db->prepare('UPDATE agreement_templates SET title = ?, tutorial_setup = ?, program_id = ?, status = ?, display_order = ? WHERE agreement_id = ?');
                $stmt->execute([$title, $setup, $program, $status, max(0, (int)($record['display_order'] ?? 0)), $id]);
                $db->prepare('DELETE FROM agreement_clauses WHERE agreement_id = ?')->execute([$id]);
            } else {
                $stmt = $db->prepare('INSERT INTO agreement_templates (title, tutorial_setup, program_id, status, display_order) VALUES (?, ?, ?, ?, ?)');
                $stmt->execute([$title, $setup, $program, $status, max(0, (int)($record['display_order'] ?? 0))]);
                $id = (int)$db->lastInsertId();
            }
            $insert = $db->prepare('INSERT INTO agreement_clauses (agreement_id, clause_text, is_required, display_order) VALUES (?, ?, ?, ?)');
            foreach ($clauses as $index => $clause) $insert->execute([$id, trim($clause['clause_text']), !empty($clause['is_required']) ? 1 : 0, $index]);
            $db->commit();
        }
        $programs = $db->query('SELECT p.program_id, p.name, pt.type AS program_type FROM program p LEFT JOIN program_type pt ON pt.program_type_id = p.program_type ORDER BY p.name, pt.type, p.program_id')->fetchAll(PDO::FETCH_ASSOC);
        foreach ($programs as &$programRow) $programRow['tutorial_setup'] = agreementSetupFromProgramType((string)($programRow['program_type'] ?? ''));
        unset($programRow);
        $data = ['templates' => agreementTemplates($db, 0, '', true), 'programs' => $programs];
    } elseif ($operation === 'acceptEnrollmentAgreements' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $user = AuthGuard::requireUser();
        if ($user['user_type'] !== 'student') AuthGuard::deny(403, 'Parents must accept agreements through the student account.');
        ensureAgreementSchema($db);
        $enrollmentId = (int)($body['enrollment_details_id'] ?? 0);
        if ($enrollmentId <= 0) throw new InvalidArgumentException('Choose an enrollment.');
        $db->beginTransaction();
        acceptEnrollmentAgreements($db, $enrollmentId, $user['user_id'], (array)($body['data'] ?? []));
        $db->commit();
        $data = ['message' => 'Agreements accepted.'];
    } elseif (in_array($operation, ['records', 'getEnrollmentAgreements'], true) && $_SERVER['REQUEST_METHOD'] === 'GET') {
        $user = AuthGuard::requireUser();
        ensureAgreementSchema($db);
        $where = [];
        $args = [];
        if ($user['user_type'] === 'student') {
            $where[] = 'ea.student_id = ?';
            $args[] = $user['user_id'];
        } else {
            $role = $user['role_name'];
            if (!in_array($role, ['owner','secretary','branch admin','auditor'], true)) AuthGuard::deny();
            $perms = $db->prepare("SELECT permissions_json FROM role_module_permissions WHERE role_name = ? AND module_key = 'enrollment'");
            $perms->execute([$role]);
            $permissions = json_decode((string)$perms->fetchColumn(), true) ?: [];
            $allowed = $permissions['view_online_applications'] ?? in_array($role, ['owner','secretary','branch admin','auditor'], true);
            if (!$allowed) AuthGuard::deny();
            if ($role === 'branch admin') {
                $where[] = 'ea.branch_id = ?';
                $args[] = (int)($_SESSION['branch_id'] ?? 0);
            }
        }
        foreach (['application_id', 'enrollment_details_id'] as $field) {
            if (isset($_GET[$field])) { $where[] = "ea.$field = ?"; $args[] = (int)$_GET[$field]; }
        }
        $sql = "SELECT aa.acceptance_id, aa.guardian_name, aa.accepted_at, aa.tutorial_setup,
            aa.agreement_snapshot_json, aa.checked_clauses_json, ea.application_number,
            ea.enrollment_details_id FROM agreement_acceptances aa
            JOIN enrollment_applications ea ON ea.application_id = aa.application_id";
        if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
        $sql .= ' ORDER BY aa.accepted_at DESC, aa.acceptance_id DESC LIMIT 500';
        $stmt = $db->prepare($sql);
        $stmt->execute($args);
        $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($data as &$row) {
            $row['snapshot'] = json_decode($row['agreement_snapshot_json'], true);
            $row['checked_clause_ids'] = json_decode($row['checked_clauses_json'], true);
            unset($row['agreement_snapshot_json'], $row['checked_clauses_json']);
        }
        unset($row);
        if ($operation === 'getEnrollmentAgreements') {
            $enrollmentId = (int)($_GET['enrollment_details_id'] ?? 0);
            if ($enrollmentId <= 0) throw new InvalidArgumentException('Choose an enrollment.');
            // Resolve the program on the server and apply the same account/branch
            // restrictions even for enrollments with no application or acceptances.
            $scope = ['ed.enrollment_details_id = ?'];
            $scopeArgs = [$enrollmentId];
            if ($user['user_type'] === 'student') {
                $scope[] = 'eh.student_id = ?';
                $scopeArgs[] = $user['user_id'];
            } elseif ($role === 'branch admin') {
                $scope[] = 'eh.branch_id = ?';
                $scopeArgs[] = (int)($_SESSION['branch_id'] ?? 0);
            }
            $enrollment = $db->prepare('SELECT ed.program_id FROM enrollment_details ed
                JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
                WHERE ' . implode(' AND ', $scope));
            $enrollment->execute($scopeArgs);
            $programId = $enrollment->fetchColumn();
            if ($programId === false) AuthGuard::deny(404, 'Enrollment not found.');
            $setup = (string)($_GET['tutorial_setup'] ?? '');
            if ($setup !== '' && !in_array($setup, ['center', 'home', 'online'], true)) throw new InvalidArgumentException('Choose a valid tutorial setup.');
            $data = enrollmentAgreementState($db, $enrollmentId, (int)$programId, $setup);
            $data['can_accept'] = $user['user_type'] === 'student';
        }
    } else {
        AuthGuard::deny(400, 'Unknown agreement operation.');
    }
    echo json_encode(['status' => 'success', 'data' => $data], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    $validation = $e instanceof InvalidArgumentException;
    if (!$validation) error_log('Agreement API: ' . $e->getMessage());
    http_response_code($validation ? 422 : 500);
    echo json_encode(['status' => 'error', 'message' => $validation ? $e->getMessage() : 'Unable to load or save agreements.']);
}
