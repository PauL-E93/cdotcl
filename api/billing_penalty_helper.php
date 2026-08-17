<?php

function refreshBillingSchedulePenalties(PDO $conn, $enrollmentDetailsId = null, $studentId = null, $programId = null) {
    $params = [];
    $where = [];

    if ($enrollmentDetailsId !== null) {
        $where[] = "bs.enrollment_details_id = ?";
        $params[] = $enrollmentDetailsId;
    }

    if ($studentId !== null) {
        $where[] = "eh.student_id = ?";
        $params[] = $studentId;
    }

    if ($programId !== null) {
        $where[] = "ed.program_id = ?";
        $params[] = $programId;
    }

    $baseAmount = "CASE
        WHEN COALESCE(bs.original_amount, 0) > 0 THEN bs.original_amount
        ELSE GREATEST(COALESCE(bs.total_amount, 0) - COALESCE(bs.penalty_amount, 0), 0)
    END";
    // The due date itself is followed by the configured number of grace days.
    // Example: due July 1 with 2 grace days => July 2-3 are grace days and
    // the first penalty is charged on July 4.
    $penaltyStartDate = "DATE_ADD(bs.due_date, INTERVAL (COALESCE(pp.grace_period_days, 2) + 1) DAY)";
    $chargeablePenaltyDays = "DATEDIFF(CURDATE(), $penaltyStartDate) + 1";
    $penaltyAmount = "CASE
        WHEN bs.status IN ('unpaid', 'partial', 'overdue')
             AND bs.due_date IS NOT NULL
             AND CURDATE() >= $penaltyStartDate
             AND ($baseAmount) > 0
             THEN ($chargeablePenaltyDays) * COALESCE(pp.penalty_amount, 0)
        WHEN bs.status = 'paid' THEN COALESCE(bs.penalty_amount, 0)
        ELSE 0
    END";

    $sql = "UPDATE billing_schedule bs
            JOIN enrollment_details ed ON bs.enrollment_details_id = ed.enrollment_details_id
            JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
            LEFT JOIN program_penalty pp ON ed.program_id = pp.program_id
            SET bs.original_amount = $baseAmount,
                bs.penalty_amount = $penaltyAmount,
                bs.penalty_applied_date = CASE
                    WHEN bs.status = 'paid' AND COALESCE(bs.penalty_amount, 0) > 0 THEN COALESCE(bs.penalty_applied_date, CURDATE())
                    WHEN ($penaltyAmount) > 0 THEN $penaltyStartDate
                    ELSE NULL
                END,
                bs.total_amount = ($baseAmount) + ($penaltyAmount)";

    if (!empty($where)) {
        $sql .= " WHERE " . implode(" AND ", $where);
    }

    $stmt = $conn->prepare($sql);
    $stmt->execute($params);
}

function backfillLegacyPaymentPenalties(PDO $conn, $enrollmentDetailsId = null) {
    $sql = "SELECT billing_schedule_id, penalty_amount, due_date
            FROM billing_schedule
            WHERE status = 'paid'
              AND penalty_amount > 0";
    $params = [];

    if ($enrollmentDetailsId !== null) {
        $sql .= " AND enrollment_details_id = ?";
        $params[] = $enrollmentDetailsId;
    }

    $stmtSchedules = $conn->prepare($sql);
    $stmtSchedules->execute($params);
    $schedules = $stmtSchedules->fetchAll(PDO::FETCH_ASSOC);

    foreach ($schedules as $schedule) {
        $billingScheduleId = $schedule['billing_schedule_id'];
        $stmtAllocated = $conn->prepare("SELECT COALESCE(SUM(penalty_paid), 0)
                                        FROM payment
                                        WHERE billing_schedule_id = ?
                                          AND payment_status != 'Declined'");
        $stmtAllocated->execute([$billingScheduleId]);
        $remainingPenalty = max(0, floatval($schedule['penalty_amount']) - floatval($stmtAllocated->fetchColumn() ?: 0));

        if ($remainingPenalty <= 0) {
            continue;
        }

        $stmtPayments = $conn->prepare("SELECT payment_id, amount_paid, penalty_paid
                                        FROM payment
                                        WHERE billing_schedule_id = ?
                                          AND payment_status != 'Declined'
                                          AND payment_date >= ?
                                        ORDER BY payment_date DESC, payment_id DESC");
        $stmtPayments->execute([$billingScheduleId, $schedule['due_date']]);

        foreach ($stmtPayments->fetchAll(PDO::FETCH_ASSOC) as $payment) {
            if ($remainingPenalty <= 0) {
                break;
            }

            $availableAmount = max(0, floatval($payment['amount_paid']) - floatval($payment['penalty_paid']));
            $penaltyForPayment = min($remainingPenalty, $availableAmount);
            if ($penaltyForPayment <= 0) {
                continue;
            }

            $stmtUpdate = $conn->prepare("UPDATE payment SET penalty_paid = penalty_paid + ? WHERE payment_id = ?");
            $stmtUpdate->execute([$penaltyForPayment, $payment['payment_id']]);
            $remainingPenalty -= $penaltyForPayment;
        }
    }
}

?>
