<?php
// api/payment.php

session_start();

header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET");
header("Access-Control-Allow-Headers: Content-Type");

require_once __DIR__ . '/../notification_helper.php';
require_once __DIR__ . '/../billing_penalty_helper.php';

class PaymentAPI {

    private $conn;
    private $notifications;

    public function __construct() {
        include "connection-pdo.php";
        $this->conn = $conn;
        $this->notifications = new NotificationService($this->conn);
    }

    private function columnExists($table, $column) {
        $stmt = $this->conn->prepare("SHOW COLUMNS FROM `$table` LIKE ?");
        $stmt->execute([$column]);
        return (bool)$stmt->fetch(PDO::FETCH_ASSOC);
    }

    private function generateReceiptId() {
        if (!$this->columnExists('payment', 'receipt_id')) {
            return null;
        }

        $prefix = date('ymd');
        $min = intval($prefix . '000');
        $max = intval($prefix . '999');
        $stmt = $this->conn->prepare("SELECT MAX(receipt_id) FROM payment WHERE receipt_id BETWEEN ? AND ?");
        $stmt->execute([$min, $max]);
        $next = intval($stmt->fetchColumn() ?: $min) + 1;

        if ($next > $max) {
            throw new Exception("Receipt number limit reached for today.");
        }

        return $next;
    }

    private function getPaymentScreenshotDirectory() {
        return dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'payment_screenshots';
    }

    private function findPaymentScreenshotPath($paymentId = null, $receiptId = null) {
        $directory = $this->getPaymentScreenshotDirectory();
        if (!is_dir($directory)) {
            return null;
        }

        $candidates = [];
        if ($receiptId) {
            $candidates[] = 'receipt_' . preg_replace('/[^A-Za-z0-9_-]/', '', (string) $receiptId);
        }
        if ($paymentId) {
            $candidates[] = 'payment_' . preg_replace('/[^A-Za-z0-9_-]/', '', (string) $paymentId);
        }

        foreach ($candidates as $candidate) {
            $matches = glob($directory . DIRECTORY_SEPARATOR . $candidate . '.*');
            if (!empty($matches)) {
                return 'uploads/payment_screenshots/' . basename($matches[0]);
            }
        }

        return null;
    }

    private function getBranchAdminBranchId() {
        $role = strtolower(trim((string)($_SESSION['user_role'] ?? '')));
        $role = preg_replace('/[\s_-]+/', ' ', $role);
        if ($role !== 'branch admin') {
            return null;
        }

        $branchId = intval($_SESSION['branch_id'] ?? 0);
        if ($branchId <= 0) {
            throw new Exception("Branch admin account is not assigned to a branch.");
        }

        return $branchId;
    }

    private function assertEnrollmentAccessibleToCurrentUser($enrollmentDetailsId) {
        $branchId = $this->getBranchAdminBranchId();
        if (!$branchId) {
            return;
        }

        $stmt = $this->conn->prepare("
            SELECT 1
            FROM enrollment_details ed
            INNER JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
            WHERE ed.enrollment_details_id = ? AND eh.branch_id = ?
            LIMIT 1
        ");
        $stmt->execute([$enrollmentDetailsId, $branchId]);
        if (!$stmt->fetchColumn()) {
            throw new Exception("Enrollment not found for your branch.");
        }
    }

    private function assertPaymentAccessibleToCurrentUser($paymentId) {
        $branchId = $this->getBranchAdminBranchId();
        if (!$branchId) {
            return;
        }

        $stmt = $this->conn->prepare("
            SELECT 1
            FROM payment p
            INNER JOIN billing_schedule bs ON p.billing_schedule_id = bs.billing_schedule_id
            INNER JOIN enrollment_details ed ON bs.enrollment_details_id = ed.enrollment_details_id
            INNER JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
            WHERE p.payment_id = ? AND eh.branch_id = ?
            LIMIT 1
        ");
        $stmt->execute([$paymentId, $branchId]);
        if (!$stmt->fetchColumn()) {
            throw new Exception("Payment record not found for your branch.");
        }
    }

    // --- GET PAYMENT METHODS (Lookup) ---
    public function getPaymentMethods() {
        try {
            $sql = "SELECT payment_method_id, payment_method FROM payment_method";
            $stmt = $this->conn->prepare($sql);
            $stmt->execute();
            $result = $stmt->fetchAll(PDO::FETCH_ASSOC);
            echo json_encode(["status" => "success", "data" => $result]);
        } catch (Exception $e) {
             echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    // --- PROCESS PAYMENT ---
    public function processPayment($json) {
        $input = json_decode($json, true);

        // --- INPUTS ---
        $enrollment_id = $input['enrollment_id']; // Changed from billing_id
        $amount = $input['amount'];
        $method_id = $input['method'];
        $ref = $input['ref'] ?? null;
        $pay_type = $input['payment_type'] ?? 'Tuition Fee';
        $employee_id = $_SESSION['employee_id'] ?? 1;
        
        // --- DETERMINE PAYMENT STATUS BASED ON PAYMENT METHOD ---
        $sqlGetMethod = "SELECT payment_method FROM payment_method WHERE payment_method_id = ?";
        $stmtGetMethod = $this->conn->prepare($sqlGetMethod);
        $stmtGetMethod->execute([$method_id]);
        $payment_method = $stmtGetMethod->fetchColumn();
        
        // Cash payments are immediately 'Received', Online payments are 'Pending'
        $payment_status = (strtolower($payment_method) === 'cash') ? 'Received' : 'Pending';

        try {
            $this->conn->beginTransaction();
            $this->assertEnrollmentAccessibleToCurrentUser($enrollment_id);
            refreshBillingSchedulePenalties($this->conn, $enrollment_id);

            $final_ref = $ref ?: null;
            if (stripos((string)$payment_method, 'gcash') !== false && !$final_ref) {
                throw new Exception("GCash reference number is required.");
            }
            $amount_to_pay = $amount; // Use a mutable variable for the payment amount

            // --- VALIDATE PAYMENT AMOUNT ---
            $sqlBalance = "SELECT COALESCE((SELECT SUM(bs_total.total_amount)
                                             FROM billing_schedule bs_total
                                             WHERE bs_total.enrollment_details_id = ed.enrollment_details_id), eh.total_of_program)
                                  - COALESCE(SUM(CASE WHEN p.payment_status != 'Declined' THEN p.amount_paid ELSE 0 END), 0) AS current_balance
                           FROM enrollment_details ed
                           JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                           LEFT JOIN billing_schedule bs ON ed.enrollment_details_id = bs.enrollment_details_id
                           LEFT JOIN payment p ON bs.billing_schedule_id = p.billing_schedule_id
                           WHERE ed.enrollment_details_id = ?";
            $stmtBalance = $this->conn->prepare($sqlBalance);
            $stmtBalance->execute([$enrollment_id]);
            $current_balance = floatval($stmtBalance->fetchColumn() ?: 0);

            if ($amount_to_pay > $current_balance) {
                throw new Exception("Payment amount exceeds the outstanding balance of ₱" . number_format($current_balance, 2) . ".");
            }
            
            // --- LOOP THROUGH BILLS AND APPLY PAYMENTS ---
            $sqlFindBills = "SELECT bs.billing_schedule_id, bs.billing_type, bs.total_amount, bs.penalty_amount,
                                   COALESCE(SUM(CASE WHEN p.payment_status != 'Declined' THEN p.amount_paid ELSE 0 END), 0) as total_paid,
                                   COALESCE(SUM(CASE WHEN p.payment_status != 'Declined' THEN p.penalty_paid ELSE 0 END), 0) as total_penalty_paid
                            FROM billing_schedule bs
                            LEFT JOIN payment p ON bs.billing_schedule_id = p.billing_schedule_id
                            WHERE bs.enrollment_details_id = ? AND bs.status IN ('unpaid', 'partial')
                            GROUP BY bs.billing_schedule_id, bs.billing_type, bs.total_amount, bs.penalty_amount, bs.due_date
                            ORDER BY
                                CASE
                                    WHEN LOWER(bs.billing_type) = 'registration fee' THEN 1
                                    WHEN LOWER(bs.billing_type) = 'downpayment' THEN 2
                                    WHEN LOWER(bs.billing_type) = 'month 1' THEN 3
                                    WHEN LOWER(bs.billing_type) = 'miscellaneous' THEN 4
                                    WHEN bs.billing_type RLIKE '^Month [0-9]+' THEN 5
                                    ELSE 6
                                END ASC,
                                CAST(REGEXP_REPLACE(bs.billing_type, '[^0-9]', '') AS UNSIGNED) ASC,
                                (bs.due_date IS NULL),
                                bs.due_date ASC";

            $stmtFind = $this->conn->prepare($sqlFindBills);
            $stmtFind->execute([$enrollment_id]);
            $outstanding_bills = $stmtFind->fetchAll(PDO::FETCH_ASSOC);

            if (empty($outstanding_bills) && $amount_to_pay > 0) {
                 throw new Exception("Could not find an unpaid bill for this enrollment, but payment was entered.");
            }

            $overall_new_balance = $current_balance;
            $line_items = [];
            $receipt_id = $this->generateReceiptId();

            foreach ($outstanding_bills as $bill) {
                if ($amount_to_pay <= 0) break;

                $billing_id_to_pay = $bill['billing_schedule_id'];
                $amount_due_for_bill = $bill['total_amount'] - $bill['total_paid'];
                $penalty_due_for_bill = max(0, floatval($bill['penalty_amount']) - floatval($bill['total_penalty_paid']));
                
                $payment_for_this_bill = 0;
                $new_bill_status = '';

                if ($amount_to_pay >= $amount_due_for_bill) {
                    // Pay this bill in full
                    $payment_for_this_bill = $amount_due_for_bill;
                    $new_bill_status = 'paid';
                    $amount_to_pay -= $amount_due_for_bill;
                } else {
                    // Partially pay this bill
                    $payment_for_this_bill = $amount_to_pay;
                    $new_bill_status = 'partial';
                    $amount_to_pay = 0;
                }

                if ($payment_for_this_bill > 0) {
                    $penalty_for_this_payment = min($payment_for_this_bill, $penalty_due_for_bill);
                    $base_for_this_payment = $payment_for_this_bill - $penalty_for_this_payment;
                    if ($base_for_this_payment > 0) {
                        $line_items[] = ["label" => $bill['billing_type'], "amount" => $base_for_this_payment];
                    }
                    if ($penalty_for_this_payment > 0) {
                        $line_items[] = ["label" => "Penalty - " . $bill['billing_type'], "amount" => $penalty_for_this_payment];
                    }

                    // 1. Insert into payment table
                    $overall_new_balance -= $payment_for_this_bill;
                    $columns = ['payment_method_id', 'billing_schedule_id', 'employee_id', 'payment_date', 'amount_paid', 'penalty_paid'];
                    $placeholders = [':meth', ':bill', ':emp', 'CURDATE()', ':amt', ':penalty'];
                    $params = [
                        ":meth" => $method_id,
                        ":bill" => $billing_id_to_pay,
                        ":emp" => $employee_id,
                        ":amt" => $payment_for_this_bill,
                        ":penalty" => $penalty_for_this_payment
                    ];

                    if ($this->columnExists('payment', 'payment_type')) {
                        $columns[] = 'payment_type';
                        $placeholders[] = ':ptype';
                        $params[':ptype'] = $pay_type;
                    }

                    if ($this->columnExists('payment', 'receipt_id')) {
                        $columns[] = 'receipt_id';
                        $placeholders[] = ':receipt';
                        $params[':receipt'] = $receipt_id;
                    }

                    $columns = array_merge($columns, ['reference_no', 'balance', 'payment_status']);
                    $placeholders = array_merge($placeholders, [':ref', ':bal', ':status']);
                    $params[':ref'] = $final_ref;
                    $params[':bal'] = $overall_new_balance;
                    $params[':status'] = $payment_status;

                    $sqlPay = "INSERT INTO payment (" . implode(", ", $columns) . ")
                               VALUES (" . implode(", ", $placeholders) . ")";
                    $stmtPay = $this->conn->prepare($sqlPay);
                    $stmtPay->execute($params);

                    // 2. Update billing_schedule status
                    $stmtUpd = $this->conn->prepare("UPDATE billing_schedule SET status = ? WHERE billing_schedule_id = ?");
                    $stmtUpd->execute([$new_bill_status, $billing_id_to_pay]);
                }
            }

            if ($payment_status === 'Pending') {
                $enrollment = $this->notifications->getEnrollmentContext($enrollment_id);
                $studentName = $enrollment['student_name'] ?? 'A student';
                $programName = $enrollment['program_name'] ?? 'an enrollment';
                $reference = $final_ref ? " Reference: {$final_ref}." : '';
                $this->notifications->notifyRole(
                    'auditor',
                    'Online Payment Awaiting Review',
                    "{$studentName} submitted an online payment of PHP " . number_format($amount, 2) . " for {$programName}.{$reference} Please review the payment."
                );
            }

            // Do not auto-change enrollment header/details status here.
            // This function should only record payment and update billing schedule states.

            $this->conn->commit();
            echo json_encode(["status" => "success", "message" => "Payment recorded successfully.", "line_items" => $line_items, "receipt_id" => $receipt_id]);

        } catch (Exception $e) {
            $this->conn->rollBack();
            // Provide a more specific error message if it's our custom exception
            if ($e->getMessage() === "Could not find an unpaid bill for this enrollment.") {
                echo json_encode(["status" => "error", "message" => "No outstanding bill was found for this enrollment. It might be fully paid or not yet billed."]);
            } else {
                echo json_encode(["status" => "error", "message" => $e->getMessage()]);
            }
        }
    }

    public function getPaymentHistory() {
        $enrollment_details_id = $_GET['enrollment_details_id'] ?? null;

        if (!$enrollment_details_id) {
            echo json_encode(["status" => "error", "message" => "Enrollment ID is required."]);
            return;
        }

        try {
            $this->assertEnrollmentAccessibleToCurrentUser($enrollment_details_id);
            backfillLegacyPaymentPenalties($this->conn, $enrollment_details_id);
            // Get student name
            $stmtStudent = $this->conn->prepare("
                SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))), ''), 'Unknown Student') AS student_name
                FROM student s
                JOIN enrollment_header eh ON s.student_id = eh.student_id
                JOIN enrollment_details ed ON eh.enrollment_header_id = ed.enrollment_header_id
                WHERE ed.enrollment_details_id = ?
            ");
            $stmtStudent->execute([$enrollment_details_id]);
            $student_name = $stmtStudent->fetchColumn();

            // Get payment history
            $paymentTypeSelect = $this->columnExists('payment', 'payment_type') ? "p.payment_type," : "NULL AS payment_type,";
            $receiptIdSelect = $this->columnExists('payment', 'receipt_id') ? "p.receipt_id," : "NULL AS receipt_id,";
            $proofPicSelect = $this->columnExists('payment', 'proof_pic') ? "p.proof_pic," : "NULL AS proof_pic,";
            $orNoSelect = $this->columnExists('payment', 'or_no') ? "p.or_no," : "NULL AS or_no,";
            $stmtHistory = $this->conn->prepare("
                SELECT p.payment_id, p.payment_date, p.amount_paid, p.penalty_paid, p.balance,
                       GREATEST(p.amount_paid - p.penalty_paid, 0) AS base_amount_paid,
                       pm.payment_method, p.reference_no, p.payment_status,
                       $receiptIdSelect
                       $proofPicSelect
                       $paymentTypeSelect
                       $orNoSelect
                       bs.billing_type
                FROM payment p
                JOIN payment_method pm ON p.payment_method_id = pm.payment_method_id
                JOIN billing_schedule bs ON p.billing_schedule_id = bs.billing_schedule_id
                WHERE bs.enrollment_details_id = ?
                ORDER BY p.payment_date DESC
            ");
            $stmtHistory->execute([$enrollment_details_id]);
            $history = $stmtHistory->fetchAll(PDO::FETCH_ASSOC);

            $hasProofPicColumn = $this->columnExists('payment', 'proof_pic');
            foreach ($history as &$payment) {
                $storedProof = $payment['proof_pic'] ?? null;
                $fallbackProof = $storedProof ? null : $this->findPaymentScreenshotPath(
                    $payment['payment_id'] ?? null,
                    $payment['receipt_id'] ?? null
                );
                $payment['payment_screenshot_path'] = $storedProof ?: $fallbackProof;

                if ($hasProofPicColumn && !$storedProof && $fallbackProof && !empty($payment['payment_id'])) {
                    $stmtUpdateProof = $this->conn->prepare("UPDATE payment SET proof_pic = ? WHERE payment_id = ?");
                    $stmtUpdateProof->execute([$fallbackProof, $payment['payment_id']]);
                    $payment['proof_pic'] = $fallbackProof;
                }
            }
            unset($payment);

            echo json_encode(["status" => "success", "student_name" => $student_name, "history" => $history]);
        } catch (Exception $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    public function updatePaymentOrNo($json) {
        $data = json_decode($json, true);
        $payment_id = $data['payment_id'] ?? null;
        $or_no = trim((string)($data['or_no'] ?? ''));

        if (!$payment_id) {
            echo json_encode(["status" => "error", "message" => "Payment ID is required."]);
            return;
        }

        if (!$this->columnExists('payment', 'or_no')) {
            echo json_encode(["status" => "error", "message" => "The database does not have an or_no column yet."]);
            return;
        }

        if ($or_no === '') {
            echo json_encode(["status" => "error", "message" => "OR number is required."]);
            return;
        }

        try {
            $this->conn->beginTransaction();
            $this->assertPaymentAccessibleToCurrentUser($payment_id);

            $stmt = $this->conn->prepare("UPDATE payment SET or_no = ? WHERE payment_id = ?");
            $stmt->execute([$or_no, $payment_id]);

            $this->conn->commit();
            echo json_encode(["status" => "success", "message" => "OR number saved successfully.", "or_no" => $or_no]);
        } catch (Exception $e) {
            $this->conn->rollBack();
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    public function updatePaymentStatus($json) {
        $data = json_decode($json, true);
        $payment_id = $data['payment_id'] ?? null;
        $new_status = $data['payment_status'] ?? '';

        if (!$payment_id || !in_array($new_status, ['Received', 'Declined'])) {
            echo json_encode(["status" => "error", "message" => "Valid payment ID and status are required."]);
            return;
        }

        try {
            $this->conn->beginTransaction();
            $this->assertPaymentAccessibleToCurrentUser($payment_id);

            $receiptIdSelect = $this->columnExists('payment', 'receipt_id') ? ", receipt_id" : ", NULL AS receipt_id";
            $stmtCheck = $this->conn->prepare("SELECT payment_id, payment_status, billing_schedule_id $receiptIdSelect FROM payment WHERE payment_id = ?");
            $stmtCheck->execute([$payment_id]);
            $payment = $stmtCheck->fetch(PDO::FETCH_ASSOC);

            if (!$payment) {
                throw new Exception("Payment record not found.");
            }

            if ($payment['payment_status'] !== 'Pending') {
                throw new Exception("Only pending payments can be updated.");
            }

            $paymentsToUpdate = [$payment];
            if (!empty($payment['receipt_id'])) {
                $stmtReceiptPayments = $this->conn->prepare("
                    SELECT payment_id, billing_schedule_id
                    FROM payment
                    WHERE receipt_id = ? AND payment_status = 'Pending'
                ");
                $stmtReceiptPayments->execute([$payment['receipt_id']]);
                $paymentsToUpdate = $stmtReceiptPayments->fetchAll(PDO::FETCH_ASSOC) ?: $paymentsToUpdate;
            }

            $paymentIds = array_values(array_unique(array_map('intval', array_column($paymentsToUpdate, 'payment_id'))));
            $billingScheduleIds = array_values(array_unique(array_map('intval', array_column($paymentsToUpdate, 'billing_schedule_id'))));
            if (empty($paymentIds) || empty($billingScheduleIds)) {
                throw new Exception("No pending payment rows found for this receipt.");
            }

            $paymentPlaceholders = implode(',', array_fill(0, count($paymentIds), '?'));
            $stmtUpdate = $this->conn->prepare("UPDATE payment SET payment_status = ? WHERE payment_id IN ($paymentPlaceholders)");
            $stmtUpdate->execute(array_merge([$new_status], $paymentIds));
            $paymentContext = $this->notifications->getPaymentContext($payment_id);

            foreach ($billingScheduleIds as $billing_schedule_id) {
                $stmtSum = $this->conn->prepare("SELECT COALESCE(SUM(amount_paid), 0) FROM payment WHERE billing_schedule_id = ? AND payment_status = 'Received'");
                $stmtSum->execute([$billing_schedule_id]);
                $received_amount = floatval($stmtSum->fetchColumn() ?: 0);

                $stmtBill = $this->conn->prepare("SELECT total_amount FROM billing_schedule WHERE billing_schedule_id = ?");
                $stmtBill->execute([$billing_schedule_id]);
                $bill = $stmtBill->fetch(PDO::FETCH_ASSOC);

                if ($bill) {
                    $new_bill_status = $received_amount >= floatval($bill['total_amount']) ? 'paid' : ($received_amount > 0 ? 'partial' : 'unpaid');
                    $stmtBillUpdate = $this->conn->prepare("UPDATE billing_schedule SET status = ? WHERE billing_schedule_id = ?");
                    $stmtBillUpdate->execute([$new_bill_status, $billing_schedule_id]);
                }
            }

            if ($new_status === 'Received') {
                $billing_schedule_id = $billingScheduleIds[0];
                $stmtEnrollment = $this->conn->prepare("
                    SELECT ed.enrollment_details_id, ed.enrollment_header_id, ed.status AS details_status, eh.status AS header_status
                    FROM billing_schedule bs
                    JOIN enrollment_details ed ON bs.enrollment_details_id = ed.enrollment_details_id
                    JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                    WHERE bs.billing_schedule_id = ?
                    LIMIT 1
                ");
                $stmtEnrollment->execute([$billing_schedule_id]);
                $enrollment = $stmtEnrollment->fetch(PDO::FETCH_ASSOC);

                if ($enrollment) {
                    $detailsStatus = strtolower($enrollment['details_status'] ?? '');
                    $headerStatus = strtolower($enrollment['header_status'] ?? '');
                    $enrollmentProperCompleted = $detailsStatus !== 'incomplete' && $headerStatus !== 'incomplete';

                    $stmtPending = $this->conn->prepare("
                        SELECT COUNT(*)
                        FROM payment p
                        JOIN billing_schedule bs ON p.billing_schedule_id = bs.billing_schedule_id
                        WHERE bs.enrollment_details_id = ?
                          AND p.payment_status = 'Pending'
                    ");
                    $stmtPending->execute([$enrollment['enrollment_details_id']]);

                    if ($enrollmentProperCompleted && intval($stmtPending->fetchColumn() ?: 0) === 0) {
                        $stmtDetails = $this->conn->prepare("UPDATE enrollment_details SET status = 'enrolled' WHERE enrollment_details_id = ?");
                        $stmtDetails->execute([$enrollment['enrollment_details_id']]);

                        $stmtHeader = $this->conn->prepare("UPDATE enrollment_header SET status = 'enrolled' WHERE enrollment_header_id = ?");
                        $stmtHeader->execute([$enrollment['enrollment_header_id']]);
                    }
                }
            }

            if ($paymentContext) {
                $statusLabel = $new_status === 'Received' ? 'received' : 'declined';
                $title = $new_status === 'Received' ? 'Payment Received' : 'Payment Declined';
                $programName = $paymentContext['program_name'] ?: 'your enrollment';
                $this->notifications->notifyStudent(
                    $paymentContext['student_id'],
                    $title,
                    "Your " . $paymentContext['payment_method'] . " payment of PHP " . number_format($paymentContext['amount_paid'], 2) . " for {$programName} was {$statusLabel}."
                );
            }

            $this->conn->commit();
            echo json_encode(["status" => "success", "message" => "Payment status updated successfully."]);
        } catch (Exception $e) {
            $this->conn->rollBack();
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }
}

// ROUTER
if ($_SERVER['REQUEST_METHOD'] == 'GET') {
    $op = $_GET['operation'] ?? null;
    if ($op === 'getPaymentHistory') {
        // No JSON body for GET request, but the operation is clear
    } else {
        $json = $_GET['json'] ?? "";
    }
} else {
    $content = file_get_contents('php://input');
    $postData = json_decode($content, true);
    $op = $postData['operation'] ?? null;
    $json = $postData['json'] ?? "";
}

$api = new PaymentAPI();
switch($op){
    case "getPaymentMethods": $api->getPaymentMethods(); break;
    case "processPayment": $api->processPayment($json); break;
    case "getPaymentHistory": $api->getPaymentHistory(); break;
    case "updatePaymentOrNo": $api->updatePaymentOrNo($json); break;
    case "updatePaymentStatus": $api->updatePaymentStatus($json); break;
    default: echo json_encode(["status" => "error", "message" => "Invalid Operation"]); break;
}
?>
