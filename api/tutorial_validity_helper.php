<?php

/** Add nullable fields without assigning deadlines to existing packages. Run before transactions. */
function ensureTutorialValiditySchema(PDO $conn): void
{
    static $ready = [];
    $key = spl_object_id($conn);
    if (isset($ready[$key])) return;
    foreach (['program' => ['validity_days' => 'INT UNSIGNED NULL'],
        'enrollment_details' => ['validity_days' => 'INT UNSIGNED NULL',
            'validity_start_date' => 'DATE NULL', 'validity_end_date' => 'DATE NULL']] as $table => $columns) {
        foreach ($columns as $column => $definition) {
            $check = $conn->prepare("SHOW COLUMNS FROM `$table` LIKE ?");
            $check->execute([$column]);
            if (!$check->fetch()) {
                try { $conn->exec("ALTER TABLE `$table` ADD COLUMN `$column` $definition"); }
                catch (PDOException $error) {
                    if ((int) ($error->errorInfo[1] ?? 0) !== 1060) throw $error;
                }
            }
        }
    }
    $conn->exec("CREATE TABLE IF NOT EXISTS enrollment_validity_history (
        history_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        enrollment_details_id INT NOT NULL,
        action VARCHAR(20) NOT NULL,
        previous_end_date DATE NULL,
        new_end_date DATE NOT NULL,
        reason VARCHAR(1000) NOT NULL,
        employee_id INT NOT NULL,
        changed_at DATETIME NOT NULL,
        INDEX (enrollment_details_id, history_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $ready[$key] = true;
}

function tutorialValidityDate(string $value): DateTimeImmutable
{
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, new DateTimeZone('Asia/Manila'));
    if (!$date || $date->format('Y-m-d') !== $value) throw new DomainException('Choose a valid session date.');
    return $date;
}

function tutorialValidityDays($value): int
{
    $days = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 3650]]);
    if ($days === false) throw new DomainException('Tutorial validity must be between 1 and 3650 whole days.');
    return $days;
}

function tutorialValidityLabel(string $value): string
{
    return tutorialValidityDate($value)->format('F j, Y');
}

function tutorialValidityWindow(string $start, $days): array
{
    $duration = tutorialValidityDays($days);
    return ['validity_days' => $duration, 'validity_start_date' => $start,
        'validity_end_date' => tutorialValidityDate($start)->modify('+' . ($duration - 1) . ' days')->format('Y-m-d')];
}

function assertTutorialValidityDates(array $window, array $dates, ?string $today = null): void
{
    if (empty($window['validity_end_date'])) return; // Existing packages await explicit review.
    $today = $today ?? (new DateTimeImmutable('now', new DateTimeZone('Asia/Manila')))->format('Y-m-d');
    if ($today > $window['validity_end_date']) {
        throw new DomainException('This tutorial package expired on ' . tutorialValidityLabel($window['validity_end_date']) . '. An authorized validity extension is required.');
    }
    foreach ($dates as $date) {
        tutorialValidityDate((string) $date);
        if ($date < $window['validity_start_date'] || $date > $window['validity_end_date']) {
            throw new DomainException('Sessions must be scheduled between ' . tutorialValidityLabel($window['validity_start_date']) . ' and ' . tutorialValidityLabel($window['validity_end_date']) . ' (inclusive).');
        }
    }
}

/** Lock the package before any session write; initialize only on a new/finalized enrollment. */
function prepareTutorialEnrollmentSchedule(PDO $conn, int $id, array $rows, bool $initialize = false): void
{
    $query = $conn->prepare('SELECT ed.validity_days, ed.validity_start_date, ed.validity_end_date,
        p.validity_days AS program_validity_days, p.unit_type
        FROM enrollment_details ed JOIN program p ON p.program_id = ed.program_id
        WHERE ed.enrollment_details_id = ? FOR UPDATE');
    $query->execute([$id]);
    $package = $query->fetch(PDO::FETCH_ASSOC);
    if (!$package) throw new DomainException('Enrollment package not found.');
    if (!$initialize || !empty($package['validity_end_date'])) {
        assertTutorialValidityDates($package, array_column($rows, 'date'));
        return;
    }
    if (strtolower((string) $package['unit_type']) !== 'session') return;
    $dates = array_column($rows, 'date');
    if (!$dates) throw new DomainException('A first agreed session date is required for tutorial validity.');
    sort($dates);
    $window = tutorialValidityWindow((string) $dates[0], $package['program_validity_days']);
    assertTutorialValidityDates($window, $dates);
    $conn->prepare('UPDATE enrollment_details SET validity_days = ?, validity_start_date = ?, validity_end_date = ? WHERE enrollment_details_id = ?')
        ->execute([$window['validity_days'], $window['validity_start_date'], $window['validity_end_date'], $id]);
}

function assertTutorialReschedule(PDO $conn, int $id, string $date): void
{
    $query = $conn->prepare('SELECT validity_days, validity_start_date, validity_end_date FROM enrollment_details WHERE enrollment_details_id = ? FOR UPDATE');
    $query->execute([$id]);
    $package = $query->fetch(PDO::FETCH_ASSOC);
    if (!$package) throw new DomainException('Enrollment package not found.');
    assertTutorialValidityDates($package, [$date]);
}

function assertTutorialSessionStart(array $schedule, ?string $today = null): void
{
    $today = $today ?? (new DateTimeImmutable('now', new DateTimeZone('Asia/Manila')))->format('Y-m-d');
    assertTutorialValidityDates($schedule, [(string) $schedule['date'], $today], $today);
}

function assertTutorialScheduleStart(PDO $conn, int $preferenceId, int $enrollmentId, string $date): void
{
    $filter = $preferenceId > 0 ? 'eps.preference_id = ?' : 'eps.enrollment_details_id = ? AND eps.date = ?';
    $query = $conn->prepare('SELECT ed.validity_start_date, ed.validity_end_date, eps.date
        FROM enrollment_preferred_schedule eps JOIN enrollment_details ed ON ed.enrollment_details_id = eps.enrollment_details_id
        WHERE ' . $filter . ' LIMIT 1' . ($conn->inTransaction() ? ' FOR UPDATE' : ''));
    $query->execute($preferenceId > 0 ? [$preferenceId] : [$enrollmentId, $date]);
    $schedule = $query->fetch(PDO::FETCH_ASSOC);
    if (!$schedule) throw new DomainException('Session not found.');
    assertTutorialSessionStart($schedule);
}

/** Caller must authorize and hold the enrollment lock inside a transaction. */
function saveTutorialValidityChange(PDO $conn, int $id, array $package, array $input, int $employeeId): string
{
    if (!$conn->inTransaction()) throw new LogicException('A validity change requires a transaction.');
    if (strtolower((string) $package['unit_type']) !== 'session') throw new DomainException('Validity applies to session-based tutorial packages.');
    $reason = trim((string) ($input['reason'] ?? ''));
    if ($reason === '' || strlen($reason) > 1000) throw new DomainException('Enter a reason of up to 1000 characters.');
    $previous = $package['validity_end_date'];
    if ($previous) {
        $end = tutorialValidityDate((string) ($input['validity_end_date'] ?? ''))->format('Y-m-d');
        if ($end <= $previous) throw new DomainException('The new deadline must be later than the current deadline.');
        $conn->prepare('UPDATE enrollment_details SET validity_end_date = ? WHERE enrollment_details_id = ?')->execute([$end, $id]);
        $action = 'extend';
    } else {
        $window = tutorialValidityWindow((string) ($input['validity_start_date'] ?? ''), $input['validity_days'] ?? null);
        $end = $window['validity_end_date'];
        $check = $conn->prepare("SELECT date FROM enrollment_preferred_schedule WHERE enrollment_details_id = ? AND status IN ('pending', 'confirmed', 'ongoing')");
        $check->execute([$id]);
        foreach ($check->fetchAll(PDO::FETCH_COLUMN) as $date) {
            if ($date < $window['validity_start_date'] || $date > $end) throw new DomainException('Existing unresolved sessions fall outside this window. Review their dates first.');
        }
        $conn->prepare('UPDATE enrollment_details SET validity_days = ?, validity_start_date = ?, validity_end_date = ? WHERE enrollment_details_id = ?')
            ->execute([$window['validity_days'], $window['validity_start_date'], $end, $id]);
        $action = 'initialize';
    }
    $conn->prepare('INSERT INTO enrollment_validity_history (enrollment_details_id, action, previous_end_date, new_end_date, reason, employee_id, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        ->execute([$id, $action, $previous, $end, $reason, $employeeId, (new DateTimeImmutable('now', new DateTimeZone('Asia/Manila')))->format('Y-m-d H:i:s')]);
    return $end;
}
