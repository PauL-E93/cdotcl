<?php
require_once __DIR__ . '/../security/PaymentPermission.php';
$actor = PaymentPermission::requirePermission('adjust_penalty');
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') AuthGuard::deny(405, 'This action requires POST.');
$conn = AuthGuard::connection();
require_once __DIR__ . '/../billing_penalty_helper.php';
header('Content-Type: application/json');
header('Cache-Control: no-store');

try {
    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) throw new InvalidArgumentException('Invalid adjustment details.');
    $billId = filter_var($data['billing_schedule_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$billId) throw new InvalidArgumentException('Select a valid bill.');
    ensurePenaltyAdjustmentSchema($conn);
    $conn->beginTransaction();
    // Use the same enrollment lock as payments before locking individual bills.
    $lookup = $conn->prepare('SELECT ed.enrollment_header_id FROM billing_schedule bs
        JOIN enrollment_details ed ON ed.enrollment_details_id = bs.enrollment_details_id
        WHERE bs.billing_schedule_id = ?');
    $lookup->execute([$billId]);
    $headerId = $lookup->fetchColumn();
    if (!$headerId) throw new InvalidArgumentException('Bill not found.');
    $conn->prepare('SELECT enrollment_header_id FROM enrollment_header WHERE enrollment_header_id = ? FOR UPDATE')->execute([$headerId]);
    $query = $conn->prepare('SELECT bs.*, eh.branch_id FROM billing_schedule bs
        JOIN enrollment_details ed ON ed.enrollment_details_id = bs.enrollment_details_id
        JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
        WHERE bs.billing_schedule_id = ? FOR UPDATE');
    $query->execute([$billId]);
    $bill = $query->fetch(PDO::FETCH_ASSOC);
    if (!$bill) throw new InvalidArgumentException('Bill not found.');
    if ($actor['role_name'] === 'branch admin'
        && ((int)($_SESSION['branch_id'] ?? 0) <= 0 || (int)$bill['branch_id'] !== (int)$_SESSION['branch_id'])) {
        $conn->rollBack();
        AuthGuard::deny(403, 'This bill belongs to another branch.');
    }
    refreshBillingSchedulePenalties($conn, $bill['enrollment_details_id']);
    $query->execute([$billId]);
    $bill = $query->fetch(PDO::FETCH_ASSOC);
    // Lock payment rows as well; pending payments must be resolved first.
    $queryPayments = $conn->prepare('SELECT amount_paid, penalty_paid, payment_status FROM payment WHERE billing_schedule_id = ? FOR UPDATE');
    $queryPayments->execute([$billId]);
    $payments = ['amount_paid' => 0, 'penalty_paid' => 0, 'pending_count' => 0];
    foreach ($queryPayments->fetchAll(PDO::FETCH_ASSOC) as $payment) {
        $status = strtolower((string)$payment['payment_status']);
        if ($status === 'pending') $payments['pending_count']++;
        if ($status !== 'declined') {
            $payments['amount_paid'] += (float)$payment['amount_paid'];
            $payments['penalty_paid'] += (float)$payment['penalty_paid'];
        }
    }
    if (!isset($data['expected_penalty']) || !is_numeric($data['expected_penalty'])
        || round((float)$data['expected_penalty'], 2) !== round((float)$bill['penalty_amount'], 2)) {
        throw new InvalidArgumentException('The penalty changed. Reopen the billing statement and review the current amount.');
    }
    $today = $conn->query('SELECT CURDATE()')->fetchColumn();
    $adjustment = validatePenaltyAdjustment($bill, $payments, $data, $today);
    $insert = $conn->prepare('INSERT INTO billing_penalty_adjustments
        (billing_schedule_id, adjustment_type, previous_penalty, agreed_penalty, waived_amount,
         guardian_name, reason, agreement_notes, pause_until, approved_by, approved_by_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $insert->execute([$billId, $adjustment['adjustment_type'], $adjustment['previous_penalty'], $adjustment['agreed_penalty'],
        $adjustment['waived_amount'], $adjustment['guardian_name'], $adjustment['reason'], $adjustment['agreement_notes'],
        $adjustment['pause_until'], $actor['user_id'], $actor['username']]);
    refreshBillingSchedulePenalties($conn, $bill['enrollment_details_id']);
    $conn->prepare("UPDATE billing_schedule SET status = 'paid' WHERE billing_schedule_id = ? AND total_amount <= ?")
        ->execute([$billId, round($payments['amount_paid'], 2)]);
    $conn->commit();
    echo json_encode(['status' => 'success', 'message' => 'Penalty adjustment saved.']);
} catch (InvalidArgumentException $error) {
    if ($conn->inTransaction()) $conn->rollBack();
    http_response_code(422);
    echo json_encode(['status' => 'error', 'message' => $error->getMessage()]);
} catch (Throwable $error) {
    if ($conn->inTransaction()) $conn->rollBack();
    error_log('Penalty adjustment failed: ' . $error->getMessage());
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Unable to save the penalty adjustment. Please try again.']);
}
