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

class ProductReleaseAPI
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
            throw new RuntimeException('Auditor accounts cannot release products.', 403);
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
        return is_array($body) ? $body : $_POST;
    }

    private function syncRecentEnrollmentProducts(array $admin): void
    {
        $sql = "SELECT DISTINCT ed.enrollment_details_id, ed.program_id, ea.application_id
            FROM enrollment_details ed
            JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
            LEFT JOIN enrollment_applications ea ON ea.enrollment_details_id = ed.enrollment_details_id
            WHERE eh.date_created >= '2026-08-25 00:00:00'
              AND COALESCE(NULLIF(eh.status, ''), ed.status) NOT IN ('cancelled', 'withdrawn', 'completed')
              AND EXISTS (SELECT 1 FROM program_products pp WHERE pp.program_id = ed.program_id)";
        $params = [];
        if ($admin['role'] === 'branch admin') {
            $sql .= ' AND eh.branch_id = ?';
            $params[] = $admin['branch_id'];
        }
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $enrollment) {
            ensureEnrollmentBundleOrdersForProgram(
                $this->conn,
                (int)$enrollment['enrollment_details_id'],
                (int)$enrollment['program_id'],
                !empty($enrollment['application_id']) ? (int)$enrollment['application_id'] : null,
                $admin['employee_id']
            );
        }
    }

    public function listOrders(array $data): void
    {
        $admin = $this->requireAdmin(false);
        if ($admin['role'] !== 'auditor') $this->syncRecentEnrollmentProducts($admin);
        $search = trim((string)($data['search'] ?? ''));
        $sql = "SELECT po.product_order_id, po.enrollment_details_id, po.order_type, po.status stored_status,
                po.requested_at, po.released_at, po.notes, poi.product_order_item_id, poi.product_id,
                poi.product_name, poi.quantity, poi.unit_price, poi.line_total, poi.item_note,
                p.quantity stock_quantity, p.status product_status, bs.billing_schedule_id, bs.status bill_status,
                COALESCE(SUM(CASE WHEN pay.payment_status = 'Pending' THEN 1 ELSE 0 END), 0) pending_payments,
                TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) student_name,
                s.student_id_number, pr.name program_name, eh.branch_id,
                TRIM(CONCAT_WS(' ', released.first_name, released.last_name)) released_by_name
            FROM product_orders po
            JOIN product_order_items poi ON poi.product_order_id = po.product_order_id
            JOIN product p ON p.product_id = poi.product_id
            JOIN enrollment_details ed ON ed.enrollment_details_id = po.enrollment_details_id
            JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
            JOIN student s ON s.student_id = eh.student_id
            JOIN program pr ON pr.program_id = ed.program_id
            LEFT JOIN billing_schedule bs ON bs.billing_schedule_id = po.billing_schedule_id
            LEFT JOIN payment pay ON pay.billing_schedule_id = bs.billing_schedule_id
            LEFT JOIN employee released ON released.employee_id = po.released_by
            WHERE po.status != 'cancelled'";
        $params = [];
        if ($admin['role'] === 'branch admin') {
            if ($admin['branch_id'] <= 0) throw new RuntimeException('Branch admin account is not assigned to a branch.', 403);
            $sql .= ' AND eh.branch_id = ?';
            $params[] = $admin['branch_id'];
        }
        if ($search !== '') {
            $sql .= " AND (s.student_id_number LIKE ? OR TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) LIKE ?
                OR poi.product_name LIKE ? OR pr.name LIKE ? OR CAST(po.product_order_id AS CHAR) LIKE ?)";
            $like = '%' . $search . '%';
            array_push($params, $like, $like, $like, $like, $like);
        }
        $sql .= ' GROUP BY po.product_order_id, poi.product_order_item_id
            ORDER BY (po.status = \'released\') ASC, po.requested_at DESC, po.product_order_id DESC';
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        $orders = array_map(function (array $row): array {
            $status = $row['stored_status'];
            if ($status === 'awaiting_payment' && $row['bill_status'] === 'paid' && (int)$row['pending_payments'] === 0) {
                $status = 'paid';
            }
            $paymentReady = $status === 'included' || $status === 'paid';
            $requiresSize = str_contains(strtolower((string)$row['product_name']), 'uniform');
            $hasReleaseDetails = !$requiresSize || trim((string)($row['item_note'] ?? '')) !== '';
            $ready = $paymentReady && $hasReleaseDetails;
            return [
                'product_order_id' => (int)$row['product_order_id'],
                'enrollment_details_id' => (int)$row['enrollment_details_id'],
                'product_order_item_id' => (int)$row['product_order_item_id'],
                'product_id' => (int)$row['product_id'],
                'student_name' => $row['student_name'],
                'student_id_number' => $row['student_id_number'],
                'program_name' => $row['program_name'],
                'product_name' => $row['product_name'],
                'quantity' => (int)$row['quantity'],
                'unit_price' => (float)$row['unit_price'],
                'line_total' => (float)$row['line_total'],
                'item_note' => $row['item_note'],
                'order_type' => $row['order_type'],
                'status' => $status,
                'ready_to_release' => $ready,
                'payment_ready' => $paymentReady,
                'has_release_details' => $hasReleaseDetails,
                'requires_size' => $requiresSize,
                'stock_quantity' => (int)$row['stock_quantity'],
                'product_status' => $row['product_status'],
                'requested_at' => $row['requested_at'],
                'released_at' => $row['released_at'],
                'released_by_name' => $row['released_by_name'],
                'bill_status' => $row['bill_status']
            ];
        }, $stmt->fetchAll(PDO::FETCH_ASSOC));
        $this->respond('success', '', ['data' => $orders]);
    }

    public function updateOrderDetails(array $data): void
    {
        $admin = $this->requireAdmin(true);
        $orderId = (int)($data['product_order_id'] ?? 0);
        $itemId = (int)($data['product_order_item_id'] ?? 0);
        $size = trim((string)($data['size'] ?? ''));
        $details = trim((string)($data['details'] ?? ''));
        if ($orderId <= 0 || $itemId <= 0) throw new InvalidArgumentException('Product order item is required.');

        $sql = "SELECT po.status, poi.product_name
            FROM product_orders po
            JOIN product_order_items poi ON poi.product_order_id = po.product_order_id
            JOIN enrollment_details ed ON ed.enrollment_details_id = po.enrollment_details_id
            JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
            WHERE po.product_order_id = ? AND poi.product_order_item_id = ?";
        $params = [$orderId, $itemId];
        if ($admin['role'] === 'branch admin') {
            if ($admin['branch_id'] <= 0) throw new RuntimeException('Branch admin account is not assigned to a branch.', 403);
            $sql .= ' AND eh.branch_id = ?';
            $params[] = $admin['branch_id'];
        }
        $sql .= ' LIMIT 1';
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        $item = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$item) throw new RuntimeException('Product order item was not found or is outside your branch.', 404);
        if (in_array($item['status'], ['released', 'cancelled'], true)) {
            throw new RuntimeException('Details for a released or cancelled product cannot be changed.');
        }

        $requiresSize = str_contains(strtolower((string)$item['product_name']), 'uniform');
        if ($requiresSize && $size === '') throw new InvalidArgumentException('Uniform size is required.');
        if (!$requiresSize && $details === '') throw new InvalidArgumentException('Product details are required.');
        $note = $requiresSize ? 'Size: ' . $size : $details;
        if ($requiresSize && $details !== '') $note .= ' | ' . $details;
        if (mb_strlen($note) > 100) throw new InvalidArgumentException('Product details must not exceed 100 characters.');

        $this->conn->beginTransaction();
        try {
            $this->conn->prepare('UPDATE product_order_items SET item_note = ? WHERE product_order_item_id = ? AND product_order_id = ?')
                ->execute([$note, $itemId, $orderId]);
            $this->conn->prepare('UPDATE product_orders SET notes = ? WHERE product_order_id = ?')
                ->execute([$note, $orderId]);
            $this->conn->commit();
            $this->respond('success', 'Product details saved.');
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            throw $e;
        }
    }

    public function releaseOrder(array $data): void
    {
        $admin = $this->requireAdmin(true);
        $orderId = (int)($data['product_order_id'] ?? 0);
        if ($orderId <= 0) throw new InvalidArgumentException('Product order is required.');

        $this->conn->beginTransaction();
        try {
            $sql = "SELECT po.*, eh.branch_id, bs.status bill_status,
                    (SELECT COUNT(*) FROM payment pay WHERE pay.billing_schedule_id = po.billing_schedule_id
                        AND pay.payment_status = 'Pending') pending_payments
                FROM product_orders po
                JOIN enrollment_details ed ON ed.enrollment_details_id = po.enrollment_details_id
                JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
                LEFT JOIN billing_schedule bs ON bs.billing_schedule_id = po.billing_schedule_id
                WHERE po.product_order_id = ?";
            $params = [$orderId];
            if ($admin['role'] === 'branch admin') {
                $sql .= ' AND eh.branch_id = ?';
                $params[] = $admin['branch_id'];
            }
            $sql .= ' LIMIT 1 FOR UPDATE';
            $stmt = $this->conn->prepare($sql);
            $stmt->execute($params);
            $order = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$order) throw new RuntimeException('Product order was not found or is outside your branch.', 404);
            if ($order['status'] === 'released') throw new RuntimeException('This product order was already released.');
            if ($order['status'] === 'cancelled') throw new RuntimeException('A cancelled product order cannot be released.');
            if ($order['order_type'] === 'additional_request'
                && ($order['bill_status'] !== 'paid' || (int)$order['pending_payments'] > 0)) {
                throw new RuntimeException('Payment must be fully received before this product can be released.');
            }

            $items = $this->conn->prepare('SELECT product_order_item_id, product_id, product_name, quantity, item_note
                FROM product_order_items WHERE product_order_id = ? ORDER BY product_order_item_id FOR UPDATE');
            $items->execute([$orderId]);
            $orderItems = $items->fetchAll(PDO::FETCH_ASSOC);
            if (!$orderItems) throw new RuntimeException('This order has no products to release.');

            foreach ($orderItems as $item) {
                $requiresSize = str_contains(strtolower((string)$item['product_name']), 'uniform');
                if ($requiresSize && trim((string)($item['item_note'] ?? '')) === '') {
                    throw new RuntimeException($item['product_name'] . ' requires a uniform size before release.');
                }
            }

            foreach ($orderItems as $item) {
                $stock = $this->conn->prepare('SELECT quantity FROM product WHERE product_id = ? LIMIT 1 FOR UPDATE');
                $stock->execute([(int)$item['product_id']]);
                $current = $stock->fetchColumn();
                if ($current === false || (int)$current < (int)$item['quantity']) {
                    throw new RuntimeException($item['product_name'] . ' does not have enough stock.');
                }
                $balance = (int)$current - (int)$item['quantity'];
                $this->conn->prepare('UPDATE product SET quantity = ? WHERE product_id = ?')
                    ->execute([$balance, (int)$item['product_id']]);
                $inventory = $this->conn->prepare("INSERT INTO inventory_transactions
                    (product_id, product_order_item_id, transaction_type, quantity_change, balance_after, performed_by)
                    VALUES (?, ?, 'release', ?, ?, ?)");
                $inventory->execute([(int)$item['product_id'], (int)$item['product_order_item_id'],
                    -(int)$item['quantity'], $balance, $admin['employee_id']]);
            }

            $this->conn->prepare("UPDATE product_orders SET status = 'released', released_by = ?, released_at = NOW()
                WHERE product_order_id = ?")->execute([$admin['employee_id'], $orderId]);
            $this->conn->commit();
            $this->respond('success', 'Product released and inventory updated.');
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) $this->conn->rollBack();
            throw $e;
        }
    }

    private function respond(string $status, string $message = '', array $extra = []): void
    {
        echo json_encode(array_merge(['status' => $status, 'message' => $message], $extra));
    }
}

try {
    $api = new ProductReleaseAPI();
    $data = $api->payload();
    $operation = $_GET['operation'] ?? $data['operation'] ?? '';
    switch ($operation) {
        case 'listOrders': $api->listOrders($data); break;
        case 'updateOrderDetails': $api->updateOrderDetails($data); break;
        case 'releaseOrder': $api->releaseOrder($data); break;
        default: throw new InvalidArgumentException('Invalid product release operation.');
    }
} catch (Throwable $e) {
    http_response_code(in_array((int)$e->getCode(), [401, 403, 404, 422], true) ? (int)$e->getCode() : 422);
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}
