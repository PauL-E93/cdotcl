<?php
require_once __DIR__ . '/enrollment_completion_helper.php';
require_once __DIR__ . '/session_status_email_helper.php';

function ensureSessionAutomationSchema(PDO $conn): void
{
    $sql = file_get_contents(__DIR__ . '/migrations/20261011_session_automation.sql');
    foreach (explode(';', $sql) as $statement) {
        if (trim($statement) !== '') $conn->exec($statement);
    }
}

function sessionAutomationLockName(PDO $conn): string
{
    return 'session_automation_' . substr(hash('sha256', (string) $conn->query('SELECT DATABASE()')->fetchColumn()), 0, 32);
}

/** Group the same consecutive slots that the session page presents as one meeting. */
function groupAutomationMeetings(array $rows): array
{
    $groups = [];
    foreach ($rows as $row) {
        $last = count($groups) - 1;
        $previous = $last >= 0 ? $groups[$last][count($groups[$last]) - 1] : null;
        $consecutive = $previous
            && (int) $previous['enrollment_details_id'] === (int) $row['enrollment_details_id']
            && $previous['date'] === $row['date']
            && (string) $previous['preferred_teacher'] === (string) $row['preferred_teacher']
            && (string) $previous['substitute_teacher_id'] === (string) $row['substitute_teacher_id']
            && $previous['end_time'] === $row['start_time'];
        if ($consecutive) $groups[$last][] = $row;
        else $groups[] = [$row];
    }
    return $groups;
}

/** Return a transition only for an eligible, fully unresolved meeting. */
function automationMeetingTransition(array $rows, array $policy, DateTimeImmutable $now): ?string
{
    if (!$rows) return null;
    $zone = new DateTimeZone('Asia/Manila');
    $first = $rows[0];
    $last = $rows[count($rows) - 1];
    $start = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $first['date'] . ' ' . $first['start_time'], $zone);
    $end = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $last['date'] . ' ' . $last['end_time'], $zone);
    if (!$start || !$end || $start->format('Y-m-d H:i:s') !== $first['date'] . ' ' . $first['start_time']
        || $end->format('Y-m-d H:i:s') !== $last['date'] . ' ' . $last['end_time']) return null;
    if ($end < $start) $end = $end->modify('+1 day');
    if ($end == $start || $start < new DateTimeImmutable($policy['effective_from'], $zone)) return null;
    $statuses = array_column($rows, 'status');
    if ((int) $policy['auto_no_show'] === 1
        && !array_diff($statuses, ['pending', 'confirmed'])
        && $now >= $start->modify('+' . (int) $policy['no_show_minutes'] . ' minutes')) return 'no-show';
    if ((int) $policy['auto_done'] === 1 && !array_diff($statuses, ['ongoing'])
        && $now >= $end->modify('+' . (int) $policy['done_delay_minutes'] . ' minutes')) return 'done';
    return null;
}

/** Send one selected preview email without applying its simulated status change. */
function sendSessionTimingPreviewEmail(PDO $conn, EmailService $email, DateTimeImmutable $time, array $ids): array
{
    if (!$ids || count($ids) > 100) throw new DomainException('Select a valid preview meeting.');
    foreach ($ids as $id) {
        if (filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) === false) throw new DomainException('Invalid session identifier.');
    }
    $ids = array_values(array_unique(array_map('intval', $ids)));
    sort($ids);
    $preview = runSessionAutomation($conn, true, 0, $time);
    if (!empty($preview['busy'])) throw new DomainException('A session check is running. Try again shortly.');
    $selected = null;
    foreach ($preview['preview'] as $meeting) {
        $meetingIds = $meeting['preference_ids'];
        sort($meetingIds);
        if ($meetingIds === $ids) { $selected = $meeting; break; }
    }
    if (!$selected) throw new DomainException('This meeting no longer matches the timing preview. Run Test Timing again.');
    $marks = implode(',', array_fill(0, count($ids), '?'));
    $statement = $conn->prepare("SELECT eps.*, ed.preferred_teacher, s.email AS student_email,
        CONCAT_WS(' ', s.first_name, s.last_name) AS student_name, p.name AS program_name,
        pt.type AS program_type, sub.subject_name, b.branch_name,
        CONCAT_WS(' ', t.first_name, t.last_name) AS teacher_name
        FROM enrollment_preferred_schedule eps
        JOIN enrollment_details ed ON ed.enrollment_details_id = eps.enrollment_details_id
        JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
        JOIN student s ON s.student_id = eh.student_id
        JOIN program p ON p.program_id = ed.program_id
        LEFT JOIN sections sec ON sec.section_id = ed.section_id
        LEFT JOIN program_type pt ON pt.program_type_id = p.program_type
        LEFT JOIN subject sub ON sub.subject_id = ed.subject_id
        LEFT JOIN branch b ON b.branch_id = eh.branch_id
        LEFT JOIN employee t ON t.employee_id = COALESCE(eps.substitute_teacher_id, ed.preferred_teacher, sec.employee_id)
        WHERE eps.preference_id IN ($marks) AND ed.status IN ('enrolled', 'completed')
          AND eh.status IN ('enrolled', 'completed') AND p.program_type IN (1, 2)
        ORDER BY eps.date, eps.start_time, eps.preference_id");
    $statement->execute($ids);
    $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    $policy = $conn->query('SELECT * FROM session_automation WHERE automation_id = 1')->fetch(PDO::FETCH_ASSOC);
    if (count($rows) !== count($ids) || count(groupAutomationMeetings($rows)) !== 1 || !$policy
        || automationMeetingTransition($rows, $policy, $time) !== $selected['new_status']) {
        throw new DomainException('The session or policy changed. Run Test Timing again.');
    }
    $schedule = $rows[0];
    $schedule['end_time'] = $rows[count($rows) - 1]['end_time'];
    if (!filter_var(trim((string) $schedule['student_email']), FILTER_VALIDATE_EMAIL)) throw new DomainException('This student has no valid email address.');
    if (!sendSessionStatusEmail($email, $schedule, $selected['new_status'])) throw new RuntimeException('The email could not be sent. Check the SMTP settings and try again.');
    return ['new_status' => $selected['new_status'], 'student_name' => $schedule['student_name'], 'email_sent' => true];
}

/** Shared rules serialize settings changes and worker runs. Row locks protect manual actions. */
function runSessionAutomation(PDO $conn, bool $dryRun = false, int $minimumIntervalSeconds = 0, ?DateTimeImmutable $previewTime = null, ?DateTimeImmutable $clientTime = null): array
{
    if ($previewTime !== null && !$dryRun) throw new InvalidArgumentException('A test time is allowed only for a preview.');
    $lockName = sessionAutomationLockName($conn);
    $lock = $conn->prepare('SELECT GET_LOCK(?, 0)');
    $lock->execute([$lockName]);
    if ((int) $lock->fetchColumn() !== 1) return ['changed' => 0, 'meetings' => 0, 'busy' => true];
    $result = ['changed' => 0, 'meetings' => 0, 'dry_run' => $dryRun];
    if ($dryRun) $result['preview'] = [];
    $deliveries = [];
    try {
        if (!$dryRun && $minimumIntervalSeconds > 0) {
            $recent = $conn->prepare('SELECT 1 FROM session_automation_worker WHERE worker_id = 1 AND last_error IS NULL AND last_run_at > DATE_SUB(NOW(), INTERVAL ? SECOND)');
            $recent->execute([$minimumIntervalSeconds]);
            if ($recent->fetchColumn()) return array_merge($result, ['throttled' => true]);
        }
        $policy = $conn->query('SELECT * FROM session_automation WHERE automation_id = 1')->fetch(PDO::FETCH_ASSOC);
        $clock = $previewTime ?? $clientTime;
        $now = $clock ? $clock->setTimezone(new DateTimeZone('Asia/Manila')) : new DateTimeImmutable('now', new DateTimeZone('Asia/Manila'));
        if ($dryRun) {
            $result['preview_at'] = $now->format('Y-m-d H:i:s');
            $result['effective_from'] = $policy['effective_from'] ?? null;
            $result['policy_enabled'] = $policy && ((int) $policy['auto_no_show'] || (int) $policy['auto_done']);
        }
        if ($policy && ((int) $policy['auto_no_show'] || (int) $policy['auto_done'])) {
            // Include all slots of each enrollment, including terminal neighbors, before grouping.
            $ids = $conn->prepare("SELECT DISTINCT eps.enrollment_details_id
                FROM enrollment_preferred_schedule eps
                JOIN enrollment_details ed ON ed.enrollment_details_id = eps.enrollment_details_id
                JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
                JOIN program p ON p.program_id = ed.program_id
                WHERE eps.status IN ('pending', 'confirmed', 'ongoing')
                  AND eps.date BETWEEN DATE(?) AND DATE(?)
                  AND ed.status IN ('enrolled', 'completed')
                  AND eh.status IN ('enrolled', 'completed') AND p.program_type IN (1, 2)");
            $ids->execute([$policy['effective_from'], $now->format('Y-m-d H:i:s')]);
            foreach ($ids->fetchAll(PDO::FETCH_COLUMN) as $enrollmentId) {
                $conn->beginTransaction();
                try {
                    // Use the same enrollment-first lock order as enrollment completion.
                    $enrollment = $conn->prepare('SELECT status FROM enrollment_details WHERE enrollment_details_id = ? FOR UPDATE');
                    $enrollment->execute([$enrollmentId]);
                    if (!in_array($enrollment->fetchColumn(), ['enrolled', 'completed'], true)) {
                        $conn->rollBack();
                        continue;
                    }
                    $slots = $conn->prepare("SELECT eps.*, ed.preferred_teacher, eh.student_id, eh.branch_id,
                        s.email AS student_email, CONCAT_WS(' ', s.first_name, s.last_name) AS student_name,
                        p.name AS program_name, pt.type AS program_type, sub.subject_name,
                        CONCAT_WS(' ', t.first_name, t.last_name) AS teacher_name, b.branch_name,
                        COALESCE(eps.substitute_teacher_id, ed.preferred_teacher, sec.employee_id) AS teacher_id
                        FROM enrollment_preferred_schedule eps
                        JOIN enrollment_details ed ON ed.enrollment_details_id = eps.enrollment_details_id
                        JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
                        JOIN student s ON s.student_id = eh.student_id
                        JOIN program p ON p.program_id = ed.program_id
                        LEFT JOIN sections sec ON sec.section_id = ed.section_id
                        LEFT JOIN program_type pt ON pt.program_type_id = p.program_type
                        LEFT JOIN subject sub ON sub.subject_id = ed.subject_id
                        LEFT JOIN employee t ON t.employee_id = COALESCE(eps.substitute_teacher_id, ed.preferred_teacher, sec.employee_id)
                        LEFT JOIN branch b ON b.branch_id = eh.branch_id
                        WHERE eps.enrollment_details_id = ? AND eh.status IN ('enrolled', 'completed')
                        ORDER BY eps.date, eps.start_time, eps.preference_id FOR UPDATE");
                    $slots->execute([$enrollmentId]);
                    $enrollmentChanged = false;
                    foreach (groupAutomationMeetings($slots->fetchAll(PDO::FETCH_ASSOC)) as $meeting) {
                        $newStatus = automationMeetingTransition($meeting, $policy, $now);
                        if (!$newStatus) continue;
                        $result['changed'] += count($meeting);
                        $result['meetings']++;
                        if ($dryRun) {
                            if (count($result['preview']) < 50) {
                                $first = $meeting[0];
                                $last = $meeting[count($meeting) - 1];
                                $result['preview'][] = [
                                    'student_name' => $first['student_name'], 'program_name' => $first['program_name'],
                                    'branch_name' => $first['branch_name'], 'date' => $first['date'],
                                    'start_time' => $first['start_time'], 'end_time' => $last['end_time'],
                                    'current_status' => implode(' / ', array_unique(array_column($meeting, 'status'))),
                                    'new_status' => $newStatus, 'slot_count' => count($meeting),
                                    'preference_ids' => array_map('intval', array_column($meeting, 'preference_id'))
                                ];
                            }
                            continue;
                        }
                        $reason = $newStatus === 'no-show'
                            ? 'Automatically marked no-show after ' . $policy['no_show_minutes'] . ' minutes past scheduled start.'
                            : 'Automatically completed at scheduled end plus ' . $policy['done_delay_minutes'] . ' minutes.';
                        $logIds = [];
                        foreach ($meeting as $slot) {
                            $update = $conn->prepare('UPDATE enrollment_preferred_schedule SET status = ? WHERE preference_id = ? AND status = ?');
                            $update->execute([$newStatus, $slot['preference_id'], $slot['status']]);
                            if ($update->rowCount() !== 1) throw new RuntimeException('Session changed concurrently; retry on next run.');
                            $audit = $conn->prepare('INSERT INTO session_automation_log (preference_id, enrollment_details_id, old_status, new_status, reason, changed_at) VALUES (?, ?, ?, ?, ?, ?)');
                            $audit->execute([$slot['preference_id'], $enrollmentId, $slot['status'], $newStatus, $reason, $now->format('Y-m-d H:i:s')]);
                            $logIds[] = (int) $conn->lastInsertId();
                        }
                        // Notifications are committed with attendance, once per merged meeting.
                        $schedule = $meeting[0];
                        $schedule['end_time'] = $meeting[count($meeting) - 1]['end_time'];
                        $message = ($newStatus === 'done' ? 'Your tutorial session has been completed. ' : 'Your tutorial session has been marked as No-show. ')
                            . $schedule['program_name'] . ' on ' . $schedule['date']
                            . ' (' . $schedule['start_time'] . '–' . $schedule['end_time'] . ', Philippine time).';
                        $notice = $conn->prepare("INSERT INTO notification (user_id, user_type, title, message, is_read, created_at) VALUES (?, ?, ?, ?, 0, NOW())");
                        $title = $newStatus === 'done' ? 'Session Completed' : 'Session No-show';
                        $notice->execute([$schedule['student_id'], 'student', $title, $message]);
                        if ((int) $schedule['teacher_id'] > 0) $notice->execute([$schedule['teacher_id'], 'employee', $title, $message]);
                        $deliveries[] = compact('schedule', 'newStatus', 'logIds');
                        $enrollmentChanged = true;
                    }
                    if ($dryRun) $conn->rollBack();
                    else {
                        if ($enrollmentChanged) syncEnrollmentCompletionStatus($conn, (int) $enrollmentId);
                        $conn->commit();
                    }
                } catch (Throwable $error) {
                    if ($conn->inTransaction()) $conn->rollBack();
                    throw $error;
                }
            }
        }
        if (!$dryRun) {
            $conn->prepare('UPDATE session_automation_worker SET last_run_at = NOW(), last_changed = ?, last_error = NULL WHERE worker_id = 1')->execute([$result['changed']]);
            require_once __DIR__ . '/email_service.php';
            $email = new EmailService($conn);
            foreach ($deliveries as $delivery) {
                $sent = false;
                try {
                    $sent = sendSessionStatusEmail($email, $delivery['schedule'], $delivery['newStatus']);
                } catch (Throwable $error) { error_log('Automation email failed: ' . $error->getMessage()); }
                $marks = implode(',', array_fill(0, count($delivery['logIds']), '?'));
                $conn->prepare("UPDATE session_automation_log SET email_status = ? WHERE log_id IN ($marks)")
                    ->execute(array_merge([$sent ? 'sent' : 'failed'], $delivery['logIds']));
            }
        }
        return $result;
    } catch (Throwable $error) {
        if (!$dryRun) $conn->prepare('UPDATE session_automation_worker SET last_run_at = NOW(), last_error = ? WHERE worker_id = 1')
            ->execute([substr($error->getMessage(), 0, 255)]);
        throw $error;
    } finally {
        $conn->prepare('SELECT RELEASE_LOCK(?)')->execute([$lockName]);
    }
}
