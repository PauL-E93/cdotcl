<?php

if (session_status() === PHP_SESSION_NONE) session_start();
date_default_timezone_set('Asia/Manila');
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/../billing_assessment_helper.php';

class BillingAssessmentAPI
{
    private PDO $conn;

    public function __construct()
    {
        include __DIR__ . '/connection-pdo.php';
        $this->conn = $conn;
        ensureBillingAssessmentSchema($this->conn);
    }

    private function normalizeRole($value): string
    {
        return strtolower(trim((string)preg_replace('/[\s_-]+/', ' ', (string)$value)));
    }

    private function requireAdmin(bool $write = false): array
    {
        $role = $this->normalizeRole($_SESSION['user_role'] ?? '');
        if (!in_array($role, ['owner', 'secretary', 'branch admin', 'auditor'], true) || empty($_SESSION['employee_id'])) {
            throw new RuntimeException('Administrator login is required.', 401);
        }
        if ($write && $role === 'auditor') {
            throw new RuntimeException('Auditor accounts can view assessments but cannot change them.', 403);
        }
        return [
            'employee_id' => (int)$_SESSION['employee_id'],
            'role' => $role,
            'branch_id' => (int)($_SESSION['branch_id'] ?? 0)
        ];
    }

    public function payload(): array
    {
        if ($_SERVER['REQUEST_METHOD'] === 'GET') return $_GET;
        $body = json_decode(file_get_contents('php://input'), true);
        if (is_array($body)) {
            if (isset($body['json']) && is_string($body['json'])) {
                $decoded = json_decode($body['json'], true);
                return is_array($decoded) ? $decoded : [];
            }
            return $body;
        }
        $decoded = json_decode((string)($_POST['json'] ?? ''), true);
        return is_array($decoded) ? $decoded : $_POST;
    }

    private function enrollment(int $detailsId, array $admin, bool $lock = false): array
    {
        if ($detailsId <= 0) throw new InvalidArgumentException('Enrollment is required.');
        $sql = "SELECT ed.enrollment_details_id, ed.enrollment_header_id, ed.program_id, ed.services,
                ed.discount_id, ed.discount_name, ed.discount_amount, ed.registration_fee,
                COALESCE(NULLIF(eh.status, ''), ed.status) enrollment_status, eh.branch_id,
                eh.date_created, eh.total_of_program, p.name program_name, p.service_id program_service_id,
                TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) student_name,
                s.student_id_number, ea.application_id
            FROM enrollment_details ed
            JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
            JOIN student s ON s.student_id = eh.student_id
            JOIN program p ON p.program_id = ed.program_id
            LEFT JOIN enrollment_applications ea ON ea.enrollment_details_id = ed.enrollment_details_id
            WHERE ed.enrollment_details_id = ?";
        $params = [$detailsId];
        if ($admin['role'] === 'branch admin') {
            if ($admin['branch_id'] <= 0) throw new RuntimeException('Branch admin account is not assigned to a branch.');
            $sql .= ' AND eh.branch_id = ?';
            $params[] = $admin['branch_id'];
        }
        $sql .= ' LIMIT 1' . ($lock ? ' FOR UPDATE' : '');
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('Enrollment was not found or is outside your branch.', 404);
        return $row;
    }

    private function currentService(array $enrollment): ?array
    {
        $stmt = $this->conn->prepare("SELECT * FROM enrollment_service_subscriptions
            WHERE enrollment_details_id = ? ORDER BY subscription_id DESC LIMIT 1");
        $stmt->execute([(int)$enrollment['enrollment_details_id']]);
        $subscription = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($subscription && in_array($subscription['status'], ['active', 'scheduled_stop'], true)) {
            return [
                'subscription_id' => (int)$subscription['subscription_id'],
                'service_id' => $subscription['service_id'] ? (int)$subscription['service_id'] : null,
                'service_name' => $subscription['service_name'],
                'monthly_amount' => (float)$subscription['monthly_amount'],
                'status' => $subscription['status'],
                'effective_start_date' => $subscription['effective_start_date'],
                'effective_end_date' => $subscription['effective_end_date'],
                'stop_reason' => $subscription['stop_reason']
            ];
        }
        if (trim((string)$enrollment['services']) === '') return null;
        $lookup = $this->conn->prepare('SELECT service_id, service_name, amount FROM service WHERE service_name = ? LIMIT 1');
        $lookup->execute([$enrollment['services']]);
        $service = $lookup->fetch(PDO::FETCH_ASSOC);
        return [
            'subscription_id' => null,
            'service_id' => $service ? (int)$service['service_id'] : null,
            'service_name' => $enrollment['services'],
            'monthly_amount' => (float)($service['amount'] ?? 0),
            'status' => 'active',
            'effective_start_date' => substr((string)$enrollment['date_created'], 0, 10),
            'effective_end_date' => null,
            'stop_reason' => null
        ];
    }

    private function availableServices(array $enrollment): array
    {
        $sql = "SELECT s.service_id, s.service_name, s.amount
            FROM service s
            WHERE s.status = 'active' AND s.service_id = ?";
        $params = [(int)$enrollment['program_service_id']];
        if ((int)$enrollment['branch_id'] > 0) {
            $sql .= ' AND (NOT EXISTS (SELECT 1 FROM branch_services) OR EXISTS
                (SELECT 1 FROM branch_services bs WHERE bs.branch_id = ? AND bs.service_id = s.service_id))';
            $params[] = (int)$enrollment['branch_id'];
        }
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return array_map(fn($row) => [
            'service_id' => (int)$row['service_id'],
            'service_name' => $row['service_name'],
            'amount' => (float)$row['amount']
        ], $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    private function adjustableBills(int $detailsId): array
    {
        $stmt = $this->conn->prepare("SELECT bs.billing_schedule_id, bs.billing_type, bs.due_date,
                bs.original_amount, bs.total_amount, bs.status,
                COALESCE(SUM(CASE WHEN pay.payment_status != 'Declined' THEN pay.amount_paid ELSE 0 END), 0) paid_amount,
                COALESCE(SUM(CASE WHEN pay.payment_status = 'Pending' THEN 1 ELSE 0 END), 0) pending_payments
            FROM billing_schedule bs
            LEFT JOIN payment pay ON pay.billing_schedule_id = bs.billing_schedule_id
            WHERE bs.enrollment_details_id = ? AND bs.billing_type REGEXP '^Month [0-9]+'
              AND bs.status = 'unpaid' AND (bs.due_date IS NULL OR bs.due_date >= CURDATE())
            GROUP BY bs.billing_schedule_id
            HAVING paid_amount = 0 AND pending_payments = 0
            ORDER BY bs.due_date, bs.billing_schedule_id");
        $stmt->execute([$detailsId]);
        return array_map(function ($row) {
            $row['billing_schedule_id'] = (int)$row['billing_schedule_id'];
            $row['original_amount'] = (float)$row['original_amount'];
            $row['total_amount'] = (float)$row['total_amount'];
            $row['paid_amount'] = (float)$row['paid_amount'];
            return $row;
        }, $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    private function adjustEnrollmentTotal(int $headerId, float $delta): void
    {
        $stmt = $this->conn->prepare('UPDATE enrollment_header
            SET total_of_program = GREATEST(COALESCE(total_of_program, 0) + ?, 0)
            WHERE enrollment_header_id = ?');
        $stmt->execute([$delta, $headerId]);
    }

    private function availableDiscounts(): array
    {
        $stmt = $this->conn->query("SELECT discount_id, discount_name, discount_value, discount_type
            FROM discount WHERE status = 'active' ORDER BY discount_name, discount_id");
        return array_map(fn($row) => [
            'discount_id' => (int)$row['discount_id'],
            'discount_name' => $row['discount_name'],
            'discount_value' => (float)$row['discount_value'],
            'discount_type' => $row['discount_type']
        ], $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    private function includedProducts(array $enrollment): array
    {
        $stmt = $this->conn->prepare("SELECT p.product_id, p.name product_name, p.price, p.quantity stock_quantity,
                po.product_order_id, po.status order_status, po.released_at
            FROM program_products pp JOIN product p ON p.product_id = pp.product_id
            LEFT JOIN product_order_items poi ON poi.product_id = p.product_id
            LEFT JOIN product_orders po ON po.product_order_id = poi.product_order_id
                AND po.enrollment_details_id = ? AND po.order_type = 'enrollment_bundle' AND po.status != 'cancelled'
            WHERE pp.program_id = ? ORDER BY p.name, po.product_order_id DESC");
        $stmt->execute([(int)$enrollment['enrollment_details_id'], (int)$enrollment['program_id']]);
        $seen = [];
        $rows = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $id = (int)$row['product_id'];
            if (isset($seen[$id])) continue;
            $seen[$id] = true;
            $rows[] = [
                'product_id' => $id, 'product_name' => $row['product_name'], 'price' => (float)$row['price'],
                'stock_quantity' => (int)$row['stock_quantity'],
                'product_order_id' => $row['product_order_id'] ? (int)$row['product_order_id'] : null,
                'status' => $row['order_status'] ?: 'included', 'released_at' => $row['released_at']
            ];
        }
        return $rows;
    }

    private function additionalOrders(int $detailsId): array
    {
        $stmt = $this->conn->prepare("SELECT po.product_order_id, po.billing_schedule_id, po.status stored_status,
                po.notes, po.requested_at, po.released_at, poi.product_id, poi.product_name, poi.quantity,
                poi.unit_price, poi.line_total, poi.item_note, p.quantity stock_quantity, bs.status bill_status,
                COALESCE(SUM(CASE WHEN pay.payment_status != 'Declined' THEN pay.amount_paid ELSE 0 END), 0) paid_amount,
                COALESCE(SUM(CASE WHEN pay.payment_status = 'Pending' THEN 1 ELSE 0 END), 0) pending_payments
            FROM product_orders po JOIN product_order_items poi ON poi.product_order_id = po.product_order_id
            JOIN product p ON p.product_id = poi.product_id
            LEFT JOIN billing_schedule bs ON bs.billing_schedule_id = po.billing_schedule_id
            LEFT JOIN payment pay ON pay.billing_schedule_id = bs.billing_schedule_id
            WHERE po.enrollment_details_id = ? AND po.order_type = 'additional_request'
            GROUP BY po.product_order_id, poi.product_order_item_id
            ORDER BY po.product_order_id DESC");
        $stmt->execute([$detailsId]);
        return array_map(function ($row) {
            $status = $row['stored_status'];
            if ($status === 'awaiting_payment' && $row['bill_status'] === 'paid' && (int)$row['pending_payments'] === 0) $status = 'paid';
            return [
                'product_order_id' => (int)$row['product_order_id'],
                'billing_schedule_id' => $row['billing_schedule_id'] ? (int)$row['billing_schedule_id'] : null,
                'product_id' => (int)$row['product_id'], 'product_name' => $row['product_name'],
                'quantity' => (int)$row['quantity'], 'unit_price' => (float)$row['unit_price'],
                'line_total' => (float)$row['line_total'], 'item_note' => $row['item_note'],
                'stock_quantity' => (int)$row['stock_quantity'], 'status' => $status,
                'bill_status' => $row['bill_status'], 'paid_amount' => (float)$row['paid_amount'],
                'pending_payments' => (int)$row['pending_payments'],
                'requested_at' => $row['requested_at'], 'released_at' => $row['released_at']
            ];
        }, $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    public function getAssessment(array $data): void
    {
        $admin = $this->requireAdmin(false);
        $enrollment = $this->enrollment((int)($data['enrollment_id'] ?? 0), $admin);
        $products = $this->conn->query("SELECT product_id, name product_name, price, quantity, status
            FROM product WHERE status != 'inactive' ORDER BY name")->fetchAll(PDO::FETCH_ASSOC);
        $this->respond('success', '', [
            'data' => [
                'enrollment' => $enrollment,
                'current_service' => $this->currentService($enrollment),
                'available_services' => $this->availableServices($enrollment),
                'available_discounts' => $this->availableDiscounts(),
                'adjustable_bills' => $this->adjustableBills((int)$enrollment['enrollment_details_id']),
                'included_products' => $this->includedProducts($enrollment),
                'additional_orders' => $this->additionalOrders((int)$enrollment['enrollment_details_id']),
                'available_products' => array_map(fn($row) => [
                    'product_id' => (int)$row['product_id'], 'product_name' => $row['product_name'],
                    'price' => (float)$row['price'], 'quantity' => (int)$row['quantity'], 'status' => $row['status']
                ], $products),
                'read_only' => $admin['role'] === 'auditor'
            ]
        ]);
    }

    public function applyDiscount(array $data): void
    {
        $admin = $this->requireAdmin(true);
        $detailsId = (int)($data['enrollment_id'] ?? 0);
        $discountId = (int)($data['discount_id'] ?? 0);
        $this->conn->beginTransaction();
        try {
            $enrollment = $this->enrollment($detailsId, $admin, true);
            $currentAmount = max(0, (float)($enrollment['discount_amount'] ?? 0));
            $discount = null;
            if ($discountId > 0) {
                $stmt = $this->conn->prepare("SELECT discount_id, discount_name, discount_value, discount_type
                    FROM discount WHERE discount_id = ? AND status = 'active' LIMIT 1");
                $stmt->execute([$discountId]);
                $discount = $stmt->fetch(PDO::FETCH_ASSOC);
                if (!$discount) throw new RuntimeException('The selected discount is not active.');
            }

            $baseStmt = $this->conn->prepare("SELECT COALESCE(SUM(CASE
                        WHEN LOWER(bs.billing_type) != 'registration fee'
                         AND LOWER(bs.billing_type) NOT LIKE 'additional %'
                        THEN bs.original_amount ELSE 0 END), 0) schedule_base,
                    SUM(LOWER(bs.billing_type) = 'registration fee') registration_rows
                FROM billing_schedule bs
                WHERE bs.enrollment_details_id = ? AND bs.status != 'cancelled'");
            $baseStmt->execute([$detailsId]);
            $base = $baseStmt->fetch(PDO::FETCH_ASSOC);
            $embeddedRegistration = (int)($base['registration_rows'] ?? 0) === 0
                ? max(0, (float)($enrollment['registration_fee'] ?? 0)) : 0;
            $grossDiscountBase = max(0, (float)($base['schedule_base'] ?? 0) + $currentAmount - $embeddedRegistration);
            $newAmount = 0.0;
            if ($discount) {
                $value = max(0, (float)$discount['discount_value']);
                $type = strtolower((string)$discount['discount_type']);
                $newAmount = $type === 'percentage' ? $grossDiscountBase * ($value / 100)
                    : ($type === 'full_waiver' ? $grossDiscountBase : $value);
                $newAmount = round(min($newAmount, $grossDiscountBase), 2);
            }
            $delta = round($newAmount - $currentAmount, 2);

            if (abs($delta) >= 0.01) {
                $statusFilter = $delta > 0
                    ? "bs.status = 'unpaid'"
                    : "(bs.status = 'unpaid' OR (bs.status = 'cancelled' AND EXISTS (
                        SELECT 1 FROM billing_schedule_items discount_item
                        WHERE discount_item.billing_schedule_id = bs.billing_schedule_id
                          AND discount_item.item_type = 'discount_adjustment'
                    )))";
                $billStmt = $this->conn->prepare("SELECT bs.billing_schedule_id, bs.billing_type, bs.original_amount,
                        COALESCE(SUM(CASE WHEN pay.payment_status != 'Declined' THEN pay.amount_paid ELSE 0 END), 0) paid_amount,
                        COALESCE(SUM(CASE WHEN pay.payment_status = 'Pending' THEN 1 ELSE 0 END), 0) pending_payments
                    FROM billing_schedule bs
                    LEFT JOIN payment pay ON pay.billing_schedule_id = bs.billing_schedule_id
                    WHERE bs.enrollment_details_id = ? AND {$statusFilter}
                      AND LOWER(bs.billing_type) != 'registration fee'
                      AND LOWER(bs.billing_type) NOT LIKE 'additional %'
                    GROUP BY bs.billing_schedule_id
                    HAVING paid_amount = 0 AND pending_payments = 0
                    ORDER BY (bs.due_date IS NULL), bs.due_date, bs.billing_schedule_id");
                $billStmt->execute([$detailsId]);
                $bills = $billStmt->fetchAll(PDO::FETCH_ASSOC);
                if (!$bills) throw new RuntimeException('There are no untouched unpaid tuition bills available for a discount adjustment.');

                $remaining = abs($delta);
                foreach ($bills as $bill) {
                    if ($remaining < 0.01) break;
                    $oldBase = (float)$bill['original_amount'];
                    $adjustment = $delta > 0 ? min($remaining, $oldBase) : $remaining;
                    $newBase = $delta > 0 ? max(0, $oldBase - $adjustment) : $oldBase + $adjustment;
                    $status = $newBase <= 0 ? 'cancelled' : 'unpaid';
                    $this->conn->prepare('UPDATE billing_schedule SET original_amount = ?, total_amount = ?,
                        penalty_amount = 0, penalty_applied_date = NULL, status = ? WHERE billing_schedule_id = ?')
                        ->execute([$newBase, $newBase, $status, (int)$bill['billing_schedule_id']]);
                    insertBillingScheduleItem($this->conn, (int)$bill['billing_schedule_id'], 'discount_adjustment',
                        $discountId ?: null, $discount ? 'Discount: ' . $discount['discount_name'] : 'Discount removed',
                        1, $delta > 0 ? -$adjustment : $adjustment, $delta > 0 ? -$adjustment : $adjustment, false);
                    $remaining = round($remaining - $adjustment, 2);
                    if ($delta < 0) break;
                }
                if ($remaining >= 0.01) {
                    throw new RuntimeException('The discount is larger than the remaining untouched tuition bills.');
                }
            }

            $this->conn->prepare('UPDATE enrollment_details SET discount_id = ?, discount_name = ?, discount_amount = ?
                WHERE enrollment_details_id = ?')->execute([
                    $discount ? (int)$discount['discount_id'] : null,
                    $discount['discount_name'] ?? null,
                    $newAmount,
                    $detailsId
                ]);
            $this->adjustEnrollmentTotal((int)$enrollment['enrollment_header_id'], -$delta);
            if (!empty($enrollment['application_id'])) {
                $this->conn->prepare('UPDATE enrollment_application_financial_snapshots
                    SET discount_id = ?, discount_name = ?, discount_amount = ?,
                        total_after_discount = GREATEST(total_after_discount - ?, 0),
                        grand_total = GREATEST(grand_total - ?, 0)
                    WHERE application_id = ?')->execute([
                        $discount ? (int)$discount['discount_id'] : null,
                        $discount['discount_name'] ?? null,
                        $newAmount,
                        $delta,
                        $delta,
                        (int)$enrollment['application_id']
                    ]);
            }
            $this->conn->commit();
            $message = $discount ? $discount['discount_name'] . ' tagged to the student.' : 'Student discount removed.';
            $this->respond('success', $message, ['discount_amount' => $newAmount]);
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            throw $e;
        }
    }

    public function stopService(array $data): void
    {
        $admin = $this->requireAdmin(true);
        $detailsId = (int)($data['enrollment_id'] ?? 0);
        $effectiveBillId = (int)($data['effective_billing_id'] ?? 0);
        $reason = trim((string)($data['reason'] ?? ''));
        if ($reason === '') throw new InvalidArgumentException('A reason is required when stopping a service.');
        $this->conn->beginTransaction();
        try {
            $enrollment = $this->enrollment($detailsId, $admin, true);
            $service = $this->currentService($enrollment);
            if (!$service) throw new RuntimeException('This enrollment has no active service.');
            $bills = $this->adjustableBills($detailsId);
            $target = null;
            foreach ($bills as $bill) if ((int)$bill['billing_schedule_id'] === $effectiveBillId) $target = $bill;
            if (!$target) throw new RuntimeException('Select an unpaid future billing month.');
            $amount = round((float)$service['monthly_amount'], 2);
            if ($amount <= 0) throw new RuntimeException('The service monthly amount is not available.');
            $affected = array_values(array_filter($bills, fn($bill) => ($bill['due_date'] ?? '') >= ($target['due_date'] ?? '')));
            $totalDeduction = 0.0;
            foreach ($affected as $bill) {
                $deduction = min($amount, (float)$bill['original_amount']);
                $totalDeduction += $deduction;
                $newBase = max(0, (float)$bill['original_amount'] - $deduction);
                $status = $newBase <= 0 ? 'cancelled' : 'unpaid';
                $stmt = $this->conn->prepare('UPDATE billing_schedule SET original_amount = ?, total_amount = ?, penalty_amount = 0, penalty_applied_date = NULL, status = ? WHERE billing_schedule_id = ?');
                $stmt->execute([$newBase, $newBase, $status, (int)$bill['billing_schedule_id']]);
                insertBillingScheduleItem($this->conn, (int)$bill['billing_schedule_id'], 'service_adjustment',
                    $service['service_id'], 'Stop ' . $service['service_name'], 1, -$deduction, -$deduction, false);
            }
            if (empty($service['subscription_id'])) {
                $insert = $this->conn->prepare("INSERT INTO enrollment_service_subscriptions
                    (enrollment_details_id, service_id, service_name, monthly_amount, effective_start_date, status, created_by)
                    VALUES (?, ?, ?, ?, ?, 'active', ?)");
                $insert->execute([$detailsId, $service['service_id'], $service['service_name'], $amount,
                    $service['effective_start_date'] ?: date('Y-m-d'), $admin['employee_id']]);
                $service['subscription_id'] = (int)$this->conn->lastInsertId();
            }
            $endDate = date('Y-m-d', strtotime(($target['due_date'] ?: date('Y-m-d')) . ' -1 day'));
            $update = $this->conn->prepare("UPDATE enrollment_service_subscriptions SET status = 'stopped',
                effective_end_date = ?, stop_reason = ?, stopped_by = ? WHERE subscription_id = ?");
            $update->execute([$endDate, $reason, $admin['employee_id'], (int)$service['subscription_id']]);
            $this->conn->prepare('UPDATE enrollment_details SET services = NULL WHERE enrollment_details_id = ?')->execute([$detailsId]);
            $this->adjustEnrollmentTotal((int)$enrollment['enrollment_header_id'], -$totalDeduction);
            $this->conn->commit();
            $this->respond('success', 'Service stopped and ' . count($affected) . ' future bill(s) adjusted.');
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            throw $e;
        }
    }

    public function resumeService(array $data): void
    {
        $admin = $this->requireAdmin(true);
        $detailsId = (int)($data['enrollment_id'] ?? 0);
        $serviceId = (int)($data['service_id'] ?? 0);
        $effectiveBillId = (int)($data['effective_billing_id'] ?? 0);
        $this->conn->beginTransaction();
        try {
            $enrollment = $this->enrollment($detailsId, $admin, true);
            if ($this->currentService($enrollment)) throw new RuntimeException('This enrollment already has an active service.');
            $available = $this->availableServices($enrollment);
            $service = null;
            foreach ($available as $candidate) if ((int)$candidate['service_id'] === $serviceId) $service = $candidate;
            if (!$service) throw new RuntimeException('The selected service is not available for this program and branch.');
            $bills = $this->adjustableBills($detailsId);
            $target = null;
            foreach ($bills as $bill) if ((int)$bill['billing_schedule_id'] === $effectiveBillId) $target = $bill;
            if (!$target) throw new RuntimeException('Select an unpaid future billing month.');
            $affected = array_values(array_filter($bills, fn($bill) => ($bill['due_date'] ?? '') >= ($target['due_date'] ?? '')));
            foreach ($affected as $bill) {
                $newBase = (float)$bill['original_amount'] + (float)$service['amount'];
                $stmt = $this->conn->prepare("UPDATE billing_schedule SET original_amount = ?, total_amount = ?, penalty_amount = 0,
                    penalty_applied_date = NULL, status = 'unpaid' WHERE billing_schedule_id = ?");
                $stmt->execute([$newBase, $newBase, (int)$bill['billing_schedule_id']]);
                insertBillingScheduleItem($this->conn, (int)$bill['billing_schedule_id'], 'service',
                    (int)$service['service_id'], $service['service_name'], 1, (float)$service['amount'], (float)$service['amount'], false);
            }
            $this->conn->prepare("UPDATE enrollment_service_subscriptions SET status = 'stopped', effective_end_date = COALESCE(effective_end_date, CURDATE())
                WHERE enrollment_details_id = ? AND status IN ('active','scheduled_stop')")->execute([$detailsId]);
            $insert = $this->conn->prepare("INSERT INTO enrollment_service_subscriptions
                (enrollment_details_id, service_id, service_name, monthly_amount, effective_start_date, status, created_by)
                VALUES (?, ?, ?, ?, ?, 'active', ?)");
            $insert->execute([$detailsId, (int)$service['service_id'], $service['service_name'], (float)$service['amount'],
                $target['due_date'] ?: date('Y-m-d'), $admin['employee_id']]);
            $this->conn->prepare('UPDATE enrollment_details SET services = ? WHERE enrollment_details_id = ?')
                ->execute([$service['service_name'], $detailsId]);
            $this->adjustEnrollmentTotal((int)$enrollment['enrollment_header_id'], (float)$service['amount'] * count($affected));
            $this->conn->commit();
            $this->respond('success', 'Service resumed and ' . count($affected) . ' future bill(s) adjusted.');
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            throw $e;
        }
    }

    public function addProductCharge(array $data): void
    {
        $admin = $this->requireAdmin(true);
        $detailsId = (int)($data['enrollment_id'] ?? 0);
        $productId = (int)($data['product_id'] ?? 0);
        $quantity = max(1, min(20, (int)($data['quantity'] ?? 1)));
        $note = trim((string)($data['item_note'] ?? '')) ?: null;
        $this->conn->beginTransaction();
        try {
            $enrollment = $this->enrollment($detailsId, $admin, true);
            $productStmt = $this->conn->prepare("SELECT product_id, name, price, quantity, status FROM product
                WHERE product_id = ? AND status != 'inactive' LIMIT 1 FOR UPDATE");
            $productStmt->execute([$productId]);
            $product = $productStmt->fetch(PDO::FETCH_ASSOC);
            if (!$product) throw new RuntimeException('The selected product is not available.');
            if ((int)$product['quantity'] < $quantity) throw new RuntimeException('Requested quantity exceeds current stock.');
            $total = round((float)$product['price'] * $quantity, 2);
            $order = $this->conn->prepare("INSERT INTO product_orders
                (enrollment_details_id, application_id, order_type, status, notes, requested_by)
                VALUES (?, ?, 'additional_request', 'awaiting_payment', ?, ?)");
            $order->execute([$detailsId, $enrollment['application_id'] ?: null, $note, $admin['employee_id']]);
            $orderId = (int)$this->conn->lastInsertId();
            $item = $this->conn->prepare('INSERT INTO product_order_items
                (product_order_id, product_id, product_name, quantity, unit_price, line_total, item_note)
                VALUES (?, ?, ?, ?, ?, ?, ?)');
            $item->execute([$orderId, $productId, $product['name'], $quantity, (float)$product['price'], $total, $note]);
            $bill = $this->conn->prepare("INSERT INTO billing_schedule
                (enrollment_details_id, due_date, original_amount, penalty_amount, total_amount, status, billing_type)
                VALUES (?, CURDATE(), ?, 0, ?, 'unpaid', ?)");
            $label = substr('Additional ' . $product['name'] . ' #' . $orderId, 0, 50);
            $bill->execute([$detailsId, $total, $total, $label]);
            $billId = (int)$this->conn->lastInsertId();
            $this->conn->prepare('UPDATE product_orders SET billing_schedule_id = ? WHERE product_order_id = ?')
                ->execute([$billId, $orderId]);
            insertBillingScheduleItem($this->conn, $billId, 'product', $productId, $product['name'], $quantity,
                (float)$product['price'], $total, false);
            $this->adjustEnrollmentTotal((int)$enrollment['enrollment_header_id'], $total);
            $this->conn->commit();
            $this->respond('success', 'Additional product charge created.', ['product_order_id' => $orderId, 'billing_schedule_id' => $billId]);
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            throw $e;
        }
    }

    public function cancelProductOrder(array $data): void
    {
        $admin = $this->requireAdmin(true);
        $detailsId = (int)($data['enrollment_id'] ?? 0);
        $orderId = (int)($data['product_order_id'] ?? 0);
        $this->conn->beginTransaction();
        try {
            $enrollment = $this->enrollment($detailsId, $admin, true);
            $stmt = $this->conn->prepare("SELECT po.*, bs.status bill_status, bs.original_amount,
                    COALESCE(SUM(CASE WHEN pay.payment_status != 'Declined' THEN pay.amount_paid ELSE 0 END), 0) paid_amount
                FROM product_orders po LEFT JOIN billing_schedule bs ON bs.billing_schedule_id = po.billing_schedule_id
                LEFT JOIN payment pay ON pay.billing_schedule_id = bs.billing_schedule_id
                WHERE po.product_order_id = ? AND po.enrollment_details_id = ? AND po.order_type = 'additional_request'
                GROUP BY po.product_order_id LIMIT 1 FOR UPDATE");
            $stmt->execute([$orderId, $detailsId]);
            $order = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$order) throw new RuntimeException('Product order was not found.');
            if ((float)$order['paid_amount'] > 0 || in_array($order['status'], ['paid', 'released'], true)) {
                throw new RuntimeException('A paid or released product order cannot be cancelled here.');
            }
            $this->conn->prepare("UPDATE product_orders SET status = 'cancelled' WHERE product_order_id = ?")->execute([$orderId]);
            $this->conn->prepare("UPDATE billing_schedule SET status = 'cancelled', penalty_amount = 0, total_amount = original_amount
                WHERE billing_schedule_id = ?")->execute([(int)$order['billing_schedule_id']]);
            $this->adjustEnrollmentTotal((int)$enrollment['enrollment_header_id'], -(float)($order['original_amount'] ?? 0));
            $this->conn->commit();
            $this->respond('success', 'Product request cancelled.');
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            throw $e;
        }
    }

    private function respond(string $status, string $message = '', array $extra = [], int $code = 200): void
    {
        http_response_code($code);
        echo json_encode(array_merge(['status' => $status, 'message' => $message], $extra));
    }
}

if (realpath((string)($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
    try {
        $api = new BillingAssessmentAPI();
        $data = $api->payload();
        $operation = $_GET['operation'] ?? $data['operation'] ?? $_POST['operation'] ?? '';
        switch ($operation) {
            case 'getAssessment': $api->getAssessment($data); break;
            case 'applyDiscount': $api->applyDiscount($data); break;
            case 'stopService': $api->stopService($data); break;
            case 'resumeService': $api->resumeService($data); break;
            case 'addProductCharge': $api->addProductCharge($data); break;
            case 'cancelProductOrder': $api->cancelProductOrder($data); break;
            default: throw new InvalidArgumentException('Invalid assessment operation.');
        }
    } catch (Throwable $e) {
        http_response_code(in_array((int)$e->getCode(), [401, 403, 404, 422], true) ? (int)$e->getCode() : 422);
        echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
    }
}
