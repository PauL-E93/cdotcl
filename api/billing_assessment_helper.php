<?php

function ensureBillingAssessmentSchema(PDO $conn): void
{
    static $ready = false;
    if ($ready) return;

    $tableCheck = $conn->prepare("SELECT COUNT(*) FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (
            'enrollment_application_financial_snapshots', 'enrollment_application_fee_items',
            'billing_schedule_items', 'enrollment_service_subscriptions', 'product_orders',
            'product_order_items', 'inventory_transactions'
        )");
    $tableCheck->execute();
    $statusCheck = $conn->query("SELECT COLUMN_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_schedule' AND COLUMN_NAME = 'status'")->fetchColumn();
    $headerStatusCheck = $conn->query("SELECT COLUMN_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'enrollment_header' AND COLUMN_NAME = 'status'")->fetchColumn();
    $detailsStatusCheck = $conn->query("SELECT COLUMN_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'enrollment_details' AND COLUMN_NAME = 'status'")->fetchColumn();
    if ((int)$tableCheck->fetchColumn() === 7
        && stripos((string)$statusCheck, "'cancelled'") !== false
        && stripos((string)$headerStatusCheck, "'incomplete'") !== false
        && stripos((string)$detailsStatusCheck, "'withdrawn'") !== false) {
        $ready = true;
        return;
    }

    $migration = __DIR__ . '/migrations/20260825_billing_assessment.sql';
    $sql = file_get_contents($migration);
    if ($sql === false) {
        throw new RuntimeException('Billing assessment migration could not be loaded.');
    }

    foreach (array_filter(array_map('trim', preg_split('/;\s*(?:\r?\n|$)/', $sql))) as $statement) {
        $conn->exec($statement);
    }
    $ready = true;
}

function saveApplicationFinancialSnapshot(PDO $conn, int $applicationId, array $snapshot): void
{
    ensureBillingAssessmentSchema($conn);
    $program = $snapshot['program'] ?? [];
    $stmt = $conn->prepare("INSERT INTO enrollment_application_financial_snapshots
        (application_id, program_name, program_type_name, unit_type, total_units, tuition_amount,
         tuition_only_subtotal, misc_amount, service_id, service_name, service_amount, service_total,
         discount_id, discount_name, discount_amount, registration_fee, downpayment_amount,
         total_after_discount, grand_total, initial_payment)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE program_name = VALUES(program_name), program_type_name = VALUES(program_type_name),
        unit_type = VALUES(unit_type), total_units = VALUES(total_units), tuition_amount = VALUES(tuition_amount),
        tuition_only_subtotal = VALUES(tuition_only_subtotal), misc_amount = VALUES(misc_amount),
        service_id = VALUES(service_id), service_name = VALUES(service_name), service_amount = VALUES(service_amount),
        service_total = VALUES(service_total), discount_id = VALUES(discount_id), discount_name = VALUES(discount_name),
        discount_amount = VALUES(discount_amount), registration_fee = VALUES(registration_fee),
        downpayment_amount = VALUES(downpayment_amount), total_after_discount = VALUES(total_after_discount),
        grand_total = VALUES(grand_total), initial_payment = VALUES(initial_payment)");
    $stmt->execute([
        $applicationId, $program['name'] ?? 'Program', $program['program_type_name'] ?? $program['type_name'] ?? null,
        $program['unit_type'] ?? null, (int)($snapshot['total_units'] ?? $program['total_units'] ?? 1),
        (float)($snapshot['tuition_amount'] ?? 0), (float)($snapshot['tuition_only_subtotal'] ?? 0),
        (float)($snapshot['misc_amount'] ?? 0), $snapshot['service_id'] ?? null,
        $snapshot['service_name'] ?? null, (float)($snapshot['service_amount'] ?? 0),
        (float)($snapshot['service_total'] ?? 0), $snapshot['discount_id'] ?? null,
        $snapshot['discount_name'] ?? null, (float)($snapshot['discount_amount'] ?? 0),
        (float)($snapshot['registration_fee'] ?? 0), (float)($snapshot['downpayment_amount'] ?? 0),
        (float)($snapshot['total_after_discount'] ?? 0), (float)($snapshot['grand_total'] ?? 0),
        (float)($snapshot['initial_payment'] ?? 0)
    ]);

    $conn->prepare('DELETE FROM enrollment_application_fee_items WHERE application_id = ?')->execute([$applicationId]);
    $insert = $conn->prepare('INSERT INTO enrollment_application_fee_items
        (application_id, item_type, reference_id, description, quantity, unit_price, line_total, is_recurring, recurrence_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $units = max(1, (int)($snapshot['total_units'] ?? 1));
    $insert->execute([$applicationId, 'tuition', $program['program_id'] ?? null, 'Tuition', $units,
        (float)($snapshot['tuition_amount'] ?? 0), (float)($snapshot['tuition_only_subtotal'] ?? 0), $units > 1 ? 1 : 0, $units]);
    if (!empty($snapshot['service_id']) && (float)($snapshot['service_total'] ?? 0) > 0) {
        $insert->execute([$applicationId, 'service', (int)$snapshot['service_id'], (string)$snapshot['service_name'], $units,
            (float)$snapshot['service_amount'], (float)$snapshot['service_total'], 1, $units]);
    }
    foreach ((array)($snapshot['other_fees'] ?? []) as $product) {
        $insert->execute([$applicationId, 'product', (int)($product['product_id'] ?? 0),
            (string)($product['product_name'] ?? $product['name'] ?? 'Product'), 1,
            (float)($product['price'] ?? 0), (float)($product['price'] ?? 0), 0, 1]);
    }
    if ((float)($snapshot['registration_fee'] ?? 0) > 0) {
        $insert->execute([$applicationId, 'registration', null, 'Registration Fee', 1,
            (float)$snapshot['registration_fee'], (float)$snapshot['registration_fee'], 0, 1]);
    }
    if ((float)($snapshot['discount_amount'] ?? 0) > 0) {
        $insert->execute([$applicationId, 'discount', $snapshot['discount_id'] ?? null,
            (string)($snapshot['discount_name'] ?? 'Discount'), 1, -(float)$snapshot['discount_amount'],
            -(float)$snapshot['discount_amount'], 0, 1]);
    }
}

function loadApplicationFinancialSnapshot(PDO $conn, int $applicationId, int $programId): ?array
{
    ensureBillingAssessmentSchema($conn);
    $stmt = $conn->prepare('SELECT * FROM enrollment_application_financial_snapshots WHERE application_id = ? LIMIT 1');
    $stmt->execute([$applicationId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) return null;

    $items = $conn->prepare("SELECT reference_id AS product_id, description AS product_name, unit_price AS price
        FROM enrollment_application_fee_items WHERE application_id = ? AND item_type = 'product' ORDER BY application_fee_item_id");
    $items->execute([$applicationId]);
    $service = !empty($row['service_id']) ? [
        'service_id' => (int)$row['service_id'],
        'service_name' => $row['service_name'],
        'amount' => (float)$row['service_amount']
    ] : null;

    return [
        'program' => [
            'program_id' => $programId,
            'name' => $row['program_name'],
            'program_type_name' => $row['program_type_name'],
            'unit_type' => $row['unit_type'],
            'total_units' => (int)$row['total_units']
        ],
        'tuition_amount' => (float)$row['tuition_amount'],
        'tuition_subtotal' => (float)$row['tuition_only_subtotal'] + (float)$row['service_total'],
        'tuition_only_subtotal' => (float)$row['tuition_only_subtotal'],
        'misc_amount' => (float)$row['misc_amount'],
        'other_fees' => $items->fetchAll(PDO::FETCH_ASSOC),
        'available_service' => $service,
        'service_id' => $row['service_id'] ? (int)$row['service_id'] : null,
        'service_name' => $row['service_name'],
        'service_amount' => (float)$row['service_amount'],
        'service_total' => (float)$row['service_total'],
        'total_units' => (int)$row['total_units'],
        'discount_id' => $row['discount_id'] ? (int)$row['discount_id'] : null,
        'discount_name' => $row['discount_name'],
        'discount_amount' => (float)$row['discount_amount'],
        'registration_fee' => (float)$row['registration_fee'],
        'downpayment_amount' => (float)$row['downpayment_amount'],
        'total_after_discount' => (float)$row['total_after_discount'],
        'grand_total' => (float)$row['grand_total'],
        'initial_payment' => (float)$row['initial_payment']
    ];
}

function insertBillingScheduleItem(PDO $conn, int $billingId, string $type, ?int $referenceId,
    string $description, float $quantity, float $unitPrice, float $lineTotal, bool $penaltyEligible = true): void
{
    ensureBillingAssessmentSchema($conn);
    $stmt = $conn->prepare('INSERT INTO billing_schedule_items
        (billing_schedule_id, item_type, reference_id, description, quantity, unit_price, line_total, penalty_eligible)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    $stmt->execute([$billingId, $type, $referenceId, $description, $quantity, $unitPrice, $lineTotal, $penaltyEligible ? 1 : 0]);
}

function ensureEnrollmentServiceSubscription(PDO $conn, int $detailsId, array $snapshot, ?int $employeeId = null): void
{
    if (empty($snapshot['service_id']) || (float)($snapshot['service_amount'] ?? 0) <= 0) return;
    ensureBillingAssessmentSchema($conn);
    $exists = $conn->prepare("SELECT 1 FROM enrollment_service_subscriptions
        WHERE enrollment_details_id = ? AND status IN ('active','scheduled_stop') LIMIT 1");
    $exists->execute([$detailsId]);
    if ($exists->fetchColumn()) return;
    $stmt = $conn->prepare("INSERT INTO enrollment_service_subscriptions
        (enrollment_details_id, service_id, service_name, monthly_amount, effective_start_date, status, created_by)
        VALUES (?, ?, ?, ?, CURDATE(), 'active', ?)");
    $stmt->execute([$detailsId, (int)$snapshot['service_id'], (string)$snapshot['service_name'],
        (float)$snapshot['service_amount'], $employeeId]);
}

function ensureEnrollmentBundleOrders(PDO $conn, int $detailsId, ?int $applicationId, array $snapshot,
    ?int $employeeId = null): void
{
    ensureBillingAssessmentSchema($conn);
    foreach ((array)($snapshot['other_fees'] ?? []) as $product) {
        $productId = (int)($product['product_id'] ?? 0);
        if ($productId <= 0) continue;
        $exists = $conn->prepare("SELECT 1 FROM product_orders po
            JOIN product_order_items poi ON poi.product_order_id = po.product_order_id
            WHERE po.enrollment_details_id = ? AND po.order_type = 'enrollment_bundle'
              AND po.status != 'cancelled' AND poi.product_id = ? LIMIT 1");
        $exists->execute([$detailsId, $productId]);
        if ($exists->fetchColumn()) continue;
        $order = $conn->prepare("INSERT INTO product_orders
            (enrollment_details_id, application_id, order_type, status, requested_by)
            VALUES (?, ?, 'enrollment_bundle', 'included', ?)");
        $order->execute([$detailsId, $applicationId, $employeeId]);
        $orderId = (int)$conn->lastInsertId();
        $price = (float)($product['price'] ?? 0);
        $item = $conn->prepare('INSERT INTO product_order_items
            (product_order_id, product_id, product_name, quantity, unit_price, line_total)
            VALUES (?, ?, ?, 1, ?, ?)');
        $item->execute([$orderId, $productId, (string)($product['product_name'] ?? $product['name'] ?? 'Product'), $price, $price]);
    }
}

function ensureEnrollmentBundleOrdersForProgram(PDO $conn, int $detailsId, int $programId,
    ?int $applicationId = null, ?int $employeeId = null): void
{
    if ($detailsId <= 0 || $programId <= 0) return;
    $stmt = $conn->prepare('SELECT p.product_id, p.name AS product_name, p.price
        FROM program_products pp
        JOIN product p ON p.product_id = pp.product_id
        WHERE pp.program_id = ? ORDER BY p.name, p.product_id');
    $stmt->execute([$programId]);
    ensureEnrollmentBundleOrders($conn, $detailsId, $applicationId, [
        'other_fees' => $stmt->fetchAll(PDO::FETCH_ASSOC)
    ], $employeeId);
}
