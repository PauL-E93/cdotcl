<?php

function ensurePenaltyAdjustmentSchema(PDO $conn): void {
    static $ready = false;
    if ($ready) return;
    $check = $conn->query("SELECT COUNT(*) FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_penalty_adjustments'");
    if (!(int)$check->fetchColumn()) {
        if ($conn->inTransaction()) throw new RuntimeException('Load the billing statement first to initialize penalty adjustments.');
        $conn->exec(file_get_contents(__DIR__ . '/migrations/20261014_penalty_adjustments.sql'));
    }
    $ready = true;
}

// All amounts are bill-level penalty totals, including any penalty already paid.
function validatePenaltyAdjustment(array $bill, array $payments, array $data, string $today): array {
    if (!in_array(strtolower((string)$bill['status']), ['unpaid', 'partial', 'overdue'], true)) {
        throw new InvalidArgumentException('Only outstanding bills can have their penalty adjusted.');
    }
    if ((int)$payments['pending_count'] > 0) {
        throw new InvalidArgumentException('Approve or decline pending payments for this bill before adjusting its penalty.');
    }
    $type = $data['adjustment_type'] ?? '';
    if (!in_array($type, ['waiver', 'reduction'], true)) {
        throw new InvalidArgumentException('Choose a full waiver or partial reduction.');
    }
    $paid = round((float)$payments['penalty_paid'], 2);
    $previous = round((float)$bill['penalty_amount'], 2);
    $value = $type === 'waiver' ? (string)$paid : (string)($data['agreed_penalty'] ?? '');
    if (!preg_match('/^\d+(?:\.\d{1,2})?$/D', $value)) {
        throw new InvalidArgumentException('Enter a valid remaining penalty with at most two decimal places.');
    }
    $agreed = round((float)$value, 2);
    if ($agreed < $paid || $agreed >= $previous || $agreed > 9999999999.99) {
        throw new InvalidArgumentException('The revised penalty must be lower than the current penalty and cannot remove amounts already paid.');
    }
    $base = (float)$bill['original_amount'] > 0 ? (float)$bill['original_amount'] : max(0, (float)$bill['total_amount'] - $previous);
    if ($base + $agreed < round((float)$payments['amount_paid'], 2)) {
        throw new InvalidArgumentException('This adjustment would reduce the bill below payments already recorded.');
    }
    $result = ['adjustment_type' => $type, 'previous_penalty' => $previous, 'agreed_penalty' => $agreed,
        'waived_amount' => round($previous - $agreed, 2)];
    foreach (['guardian_name' => 255, 'reason' => 2000, 'agreement_notes' => 4000] as $key => $limit) {
        if (!is_string($data[$key] ?? null) || trim($data[$key]) === '' || strlen($data[$key]) > $limit) {
            throw new InvalidArgumentException('Parent/guardian name, reason, and agreement notes are required and must fit the field limits.');
        }
        $result[$key] = trim($data[$key]);
    }
    if (($data['acknowledged'] ?? false) !== true) {
        throw new InvalidArgumentException('Confirm that the parent/guardian agreed to the recorded terms.');
    }
    $date = $data['pause_until'] ?? null;
    if ($date !== null && $date !== '') {
        if (!is_string($date)) throw new InvalidArgumentException('Invalid settlement deadline.');
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        if (!$parsed || $parsed->format('Y-m-d') !== $date || $date < $today) {
            throw new InvalidArgumentException('The settlement deadline must be today or a future date.');
        }
    }
    $result['pause_until'] = $date ?: null;
    return $result;
}

function attachPenaltyAdjustments(PDO $conn, array &$schedule): void {
    ensurePenaltyAdjustmentSchema($conn);
    $ids = array_column($schedule, 'id');
    if (!$ids) return;
    $query = $conn->prepare('SELECT * FROM billing_penalty_adjustments WHERE billing_schedule_id IN ('
        . implode(',', array_fill(0, count($ids), '?')) . ') ORDER BY adjustment_id DESC');
    $query->execute($ids);
    $history = [];
    foreach ($query->fetchAll(PDO::FETCH_ASSOC) as $row) $history[$row['billing_schedule_id']][] = $row;
    foreach ($schedule as &$bill) $bill['penalty_adjustments'] = $history[$bill['id']] ?? [];
}
