<?php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/../admin/connection-pdo.php';
require_once __DIR__ . '/../agreement_helper.php';
ensureAgreementSchema($conn);
$defaults = [
    'home' => [
        'Agreement for Home-based Tutorial Set-up',
        [
            'Tutoring sessions will be conducted at the agreed location.',
            'Parent/Guardian must provide a safe, clean, and suitable learning space.',
            'Any applicable transportation or additional fees will be communicated before the session.',
            'The tutor and parent may request to reschedule due to emergencies or unavoidable circumstances.',
            'Same-day cancellation or absence without prior notice may be considered a consumed session.'
        ]
    ],
    'online' => [
        'Agreement for Online-based Tutorial Set-up',
        [
            'Sessions will be conducted through an agreed platform such as Zoom or Google Meet.',
            'The Parent/Guardian is responsible for providing a stable internet connection and suitable device.',
            'The student should stay in a quiet and appropriate learning environment.',
            'The student should join the session on time and give the teacher a lesson before the session.',
            'Recording or distributing tutoring sessions requires prior consent.'
        ]
    ]
];
$conn->beginTransaction();
try {
    foreach ($defaults as $setup => [$title, $clauses]) {
        $exists = $conn->prepare('SELECT agreement_id FROM agreement_templates WHERE tutorial_setup = ? AND title = ?');
        $exists->execute([$setup, $title]);
        if ($exists->fetchColumn()) continue;
        $conn->prepare("INSERT INTO agreement_templates (title, tutorial_setup, status) VALUES (?, ?, 'inactive')")->execute([$title, $setup]);
        $id = (int)$conn->lastInsertId();
        $insert = $conn->prepare('INSERT INTO agreement_clauses (agreement_id, clause_text, display_order) VALUES (?, ?, ?)');
        foreach ($clauses as $order => $text) $insert->execute([$id, $text, $order]);
    }
    $conn->commit();
} catch (Throwable $e) { $conn->rollBack(); throw $e; }
echo "Agreement tables and tutorial setup ready. Home/online templates are inactive for owner review. Existing enrollments remain unchanged.\n";
