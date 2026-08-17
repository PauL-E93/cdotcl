<?php
// api/student/payment.php

session_start();

header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET");
header("Access-Control-Allow-Headers: Content-Type");

require_once __DIR__ . '/../notification_helper.php';
require_once __DIR__ . '/../billing_penalty_helper.php';

class StudentPaymentAPI {

    private $conn;
    private $notifications;

    public function __construct() {
        include "../admin/connection-pdo.php";
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
                $fileName = basename($matches[0]);
                return 'uploads/payment_screenshots/' . $fileName;
            }
        }

        return null;
    }

    private function storePaymentScreenshot($uploadedFile, $receiptId = null, $paymentId = null) {
        if (!$uploadedFile || !isset($uploadedFile['tmp_name']) || !is_uploaded_file($uploadedFile['tmp_name'])) {
            return null;
        }

        if (($uploadedFile['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            throw new Exception('Failed to upload the GCash payment screenshot.');
        }

        $mimeType = mime_content_type($uploadedFile['tmp_name']) ?: '';
        $allowedMimeTypes = [
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
            'image/bmp' => 'bmp'
        ];

        if (!isset($allowedMimeTypes[$mimeType])) {
            throw new Exception('The uploaded payment screenshot must be a JPG, PNG, WEBP, or BMP image.');
        }

        $directory = $this->getPaymentScreenshotDirectory();
        if (!is_dir($directory) && !mkdir($directory, 0777, true) && !is_dir($directory)) {
            throw new Exception('Unable to create the payment screenshot directory.');
        }

        $baseName = $receiptId
            ? 'receipt_' . preg_replace('/[^A-Za-z0-9_-]/', '', (string) $receiptId)
            : 'payment_' . preg_replace('/[^A-Za-z0-9_-]/', '', (string) $paymentId);

        if (!$baseName) {
            $baseName = 'payment_' . time();
        }

        foreach (glob($directory . DIRECTORY_SEPARATOR . $baseName . '.*') ?: [] as $existingFile) {
            @unlink($existingFile);
        }

        $fileName = $baseName . '.' . $allowedMimeTypes[$mimeType];
        $targetPath = $directory . DIRECTORY_SEPARATOR . $fileName;

        if (!move_uploaded_file($uploadedFile['tmp_name'], $targetPath)) {
            throw new Exception('Unable to save the payment screenshot.');
        }

        return 'uploads/payment_screenshots/' . $fileName;
    }

    private function getPendingPaymentsForSummary($studentId, $isPrePlay = false) {
        $programTypeFilter = $isPrePlay
            ? " AND (
                    LOWER(COALESCE(prog.name, '')) LIKE '%preschool%'
                    OR LOWER(COALESCE(prog.name, '')) LIKE '%playschool%'
                    OR LOWER(COALESCE(prog.name, '')) LIKE '%pre-school%'
                    OR LOWER(COALESCE(prog.name, '')) LIKE '%play-school%'
                    OR LOWER(COALESCE(prog.name, '')) LIKE '%pre school%'
                    OR LOWER(COALESCE(prog.name, '')) LIKE '%play school%'
                )"
            : " AND LOWER(COALESCE(prog.name, '')) NOT LIKE '%preschool%'
                AND LOWER(COALESCE(prog.name, '')) NOT LIKE '%playschool%'
                AND LOWER(COALESCE(prog.name, '')) NOT LIKE '%pre-school%'
                AND LOWER(COALESCE(prog.name, '')) NOT LIKE '%play-school%'
                AND LOWER(COALESCE(prog.name, '')) NOT LIKE '%pre school%'
                AND LOWER(COALESCE(prog.name, '')) NOT LIKE '%play school%'";

        $sql = "SELECT
                    pay.payment_id AS id,
                    bs.enrollment_details_id,
                    TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                    prog.name AS program_name,
                    bs.billing_type,
                    pay.amount_paid AS amount,
                    pay.payment_status AS status,
                    pay.payment_date AS due_date
                FROM payment pay
                JOIN billing_schedule bs ON pay.billing_schedule_id = bs.billing_schedule_id
                JOIN enrollment_details ed ON bs.enrollment_details_id = ed.enrollment_details_id
                JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                JOIN student s ON eh.student_id = s.student_id
                LEFT JOIN program prog ON ed.program_id = prog.program_id
                WHERE eh.student_id = ?
                  AND pay.payment_status = 'Pending'
                  $programTypeFilter
                ORDER BY pay.payment_date ASC, pay.payment_id ASC";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute([$studentId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // --- GET PAYMENT METHODS (Lookup) ---
    public function getPaymentMethods() {
        try {
            $sql = "SELECT payment_method_id, payment_method, account_name, account_number, qr_code FROM payment_method ORDER BY payment_method_id ASC";
            $stmt = $this->conn->prepare($sql);
            $stmt->execute();
            $result = $stmt->fetchAll(PDO::FETCH_ASSOC);
            echo json_encode(["status" => "success", "data" => $result]);
        } catch (Exception $e) {
             echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    // --- GET STUDENT'S ENROLLMENT BILLING DETAILS ---
    public function getBillingDetails() {
        $enrollment_id = $_GET['enrollment_id'] ?? null;
        $student_id = $_SESSION['student_id'] ?? null;

        if (!$enrollment_id) {
            echo json_encode(["status" => "error", "message" => "Enrollment ID required"]);
            return;
        }

        if (!$student_id) {
            echo json_encode(["status" => "error", "message" => "Student authentication required"]);
            return;
        }

        try {
            // Verify enrollment belongs to student
            $sqlVerify = "SELECT ed.enrollment_details_id
                         FROM enrollment_details ed
                         JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                         WHERE ed.enrollment_details_id = ? AND eh.student_id = ?";
            $stmtVerify = $this->conn->prepare($sqlVerify);
            $stmtVerify->execute([$enrollment_id, $student_id]);

            if (!$stmtVerify->fetch()) {
                echo json_encode(["status" => "error", "message" => "Access denied: Enrollment does not belong to you"]);
                return;
            }

            refreshBillingSchedulePenalties($this->conn, $enrollment_id);

            // Get enrollment and student info
            $sql = "SELECT
                        ed.enrollment_details_id,
                        p.program_id,
                        TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                        p.name AS program_name,
                        p.tuition AS program_tuition,
                        p.total_units AS program_session,
                        p.program_type,
                        COALESCE(pp.penalty_amount, 0) AS penalty_rate,
                        COALESCE(pp.grace_period_days, 2) AS grace_period_days,
                        ed.services,
                        ed.discount_name,
                        ed.discount_amount,
                        ed.registration_fee,
                        d.discount_type,
                        d.discount_value,
                        gl.grade_level,
                        sub.subject_name,
                        ed.goal,
                        eh.total_of_program AS total_amount
                    FROM enrollment_details ed
                    JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                    JOIN student s ON eh.student_id = s.student_id
                    LEFT JOIN program p ON ed.program_id = p.program_id
                    LEFT JOIN program_penalty pp ON ed.program_id = pp.program_id
                    LEFT JOIN discount d ON ed.discount_id = d.discount_id
                    LEFT JOIN grade_level gl ON ed.grade_level_id = gl.grade_level_id
                    LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                    WHERE ed.enrollment_details_id = ?";
            $stmt = $this->conn->prepare($sql);
            $stmt->execute([$enrollment_id]);
            $enrollment = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$enrollment) {
                echo json_encode(["status" => "error", "message" => "Enrollment not found"]);
                return;
            }

            // Get billing schedule
            $sqlSchedule = "SELECT
                                bs.billing_schedule_id AS id,
                                bs.billing_type AS billing_type,
                                bs.total_amount AS amount,
                                bs.original_amount,
                                bs.penalty_amount,
                                COALESCE(pp.penalty_amount, 0) AS penalty_rate,
                                COALESCE(pp.grace_period_days, 2) AS grace_period_days,
                                DATE_ADD(bs.due_date, INTERVAL (COALESCE(pp.grace_period_days, 2) + 1) DAY) AS penalty_effective_date,
                                GREATEST(DATEDIFF(CURDATE(), DATE_ADD(bs.due_date, INTERVAL (COALESCE(pp.grace_period_days, 2) + 1) DAY)) + 1, 0) AS penalty_chargeable_days,
                                DATEDIFF(CURDATE(), bs.due_date) AS overdue_days,
                                bs.status,
                                bs.due_date,
                                COALESCE(SUM(CASE WHEN p.payment_status != 'Declined' THEN p.amount_paid ELSE 0 END), 0) AS paid_amount,
                                COALESCE(SUM(CASE WHEN p.payment_status != 'Declined' THEN GREATEST(p.amount_paid - p.penalty_paid, 0) ELSE 0 END), 0) AS base_paid_amount,
                                COALESCE(SUM(CASE WHEN p.payment_status != 'Declined' THEN p.penalty_paid ELSE 0 END), 0) AS penalty_paid_amount,
                                GREATEST(bs.total_amount - COALESCE(SUM(CASE WHEN p.payment_status != 'Declined' THEN p.amount_paid ELSE 0 END), 0), 0) AS remaining_amount
                            FROM billing_schedule bs
                            JOIN enrollment_details ed_penalty ON bs.enrollment_details_id = ed_penalty.enrollment_details_id
                            LEFT JOIN program_penalty pp ON ed_penalty.program_id = pp.program_id
                            LEFT JOIN payment p ON bs.billing_schedule_id = p.billing_schedule_id
                            WHERE bs.enrollment_details_id = ?
                            GROUP BY bs.billing_schedule_id, bs.billing_type, bs.total_amount, bs.original_amount, bs.penalty_amount,
                                     pp.penalty_amount, pp.grace_period_days, bs.status, bs.due_date
                            ORDER BY bs.billing_schedule_id ASC";
            $stmtSchedule = $this->conn->prepare($sqlSchedule);
            $stmtSchedule->execute([$enrollment_id]);
            $schedule = $stmtSchedule->fetchAll(PDO::FETCH_ASSOC);

            // Calculate total paid across ALL schedules for overview
            $total_paid_global = 0;

            // Include every non-declined payment, matching the schedule aggregation
            // and the admin billing API. Pending GCash payments are blocked in the UI
            // until review, so they must reserve their submitted amount here.
            $sqlGlobalPay = "SELECT SUM(amount_paid) FROM payment p
                            JOIN billing_schedule bs ON p.billing_schedule_id = bs.billing_schedule_id
                            WHERE bs.enrollment_details_id = ? AND p.payment_status != 'Declined'";
            $stmtGlobal = $this->conn->prepare($sqlGlobalPay);
            $stmtGlobal->execute([$enrollment_id]);
            $total_paid_global = floatval($stmtGlobal->fetchColumn() ?: 0);

            $total_penalty = array_reduce($schedule, function($sum, $item) {
                return $sum + floatval($item['penalty_amount'] ?? 0);
            }, 0);
            $schedule_total = array_reduce($schedule, function($sum, $item) {
                return $sum + floatval($item['amount'] ?? 0);
            }, 0);
            $total_amount = $schedule_total > 0 ? $schedule_total : floatval($enrollment['total_amount']);

            // Calculate month 1 and miscellaneous due, then first payment due for preschool blueprint
            $month1_amount = 0;
            $misc_amount = 0;

            foreach ($schedule as $item) {
                $billingType = strtolower($item['billing_type'] ?? '');
                if ($billingType === 'month 1') {
                    $month1_amount = floatval($item['amount']);
                } elseif ($billingType === 'miscellaneous') {
                    $misc_amount = floatval($item['amount']);
                }
            }

            $first_due_amount = $month1_amount + $misc_amount;

            // Use true outstanding balance (total - payments) for all programs
            $balance = $total_amount - $total_paid_global;

            $data = [
                'program_id' => $enrollment['program_id'],
                'student_name' => $enrollment['student_name'],
                'program_name' => $enrollment['program_name'],
                'program_tuition' => $enrollment['program_tuition'],
                'services' => $enrollment['services'] ?? null,
                'discount_name' => $enrollment['discount_name'] ?? null,
                'discount_amount' => floatval($enrollment['discount_amount'] ?? 0),
                'discount_type' => $enrollment['discount_type'] ?? null,
                'discount_value' => floatval($enrollment['discount_value'] ?? 0),
                'registration_fee' => floatval($enrollment['registration_fee'] ?? 0),
                'program_session' => $enrollment['program_session'] ?? 10,
                'program_type' => $enrollment['program_type'] ?? 'N/A',
                'penalty_rate' => floatval($enrollment['penalty_rate'] ?? 0),
                'grace_period_days' => intval($enrollment['grace_period_days'] ?? 2),
                'grade_level' => $enrollment['grade_level'],
                'subject_name' => $enrollment['subject_name'] ?? 'N/A',
                'goal' => $enrollment['goal'] ?? 'N/A',
                'total_amount' => $total_amount,
                'total_paid' => $total_paid_global,
                'total_penalty' => $total_penalty,
                'balance' => $balance,
                'first_due' => $first_due_amount,
                'month1_amount' => $month1_amount,
                'misc_amount' => $misc_amount,
                'schedule' => $schedule
            ];

            echo json_encode(["status" => "success", "data" => $data]);
        } catch (Exception $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    // --- GET STUDENT'S PAYMENT HISTORY ---
    public function getPaymentHistory() {
        $enrollment_details_id = $_GET['enrollment_details_id'] ?? null;
        $student_id = $_SESSION['student_id'] ?? null;

        if (!$enrollment_details_id) {
            echo json_encode(["status" => "error", "message" => "Enrollment ID is required."]);
            return;
        }

        if (!$student_id) {
            echo json_encode(["status" => "error", "message" => "Student authentication required"]);
            return;
        }

        try {
            // Verify enrollment belongs to student
            $sqlVerify = "SELECT ed.enrollment_details_id
                         FROM enrollment_details ed
                         JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                         WHERE ed.enrollment_details_id = ? AND eh.student_id = ?";
            $stmtVerify = $this->conn->prepare($sqlVerify);
            $stmtVerify->execute([$enrollment_details_id, $student_id]);

            if (!$stmtVerify->fetch()) {
                echo json_encode(["status" => "error", "message" => "Access denied: Enrollment does not belong to you"]);
                return;
            }

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
            $stmtHistory = $this->conn->prepare("
                SELECT p.payment_id, p.payment_date, p.amount_paid, p.penalty_paid, p.balance,
                       GREATEST(p.amount_paid - p.penalty_paid, 0) AS base_amount_paid,
                       pm.payment_method, p.reference_no, p.payment_status,
                       $paymentTypeSelect
                       $receiptIdSelect
                       $proofPicSelect
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

    // --- GET PAYMENT DUE SUMMARY ---
    public function getPaymentDueSummary() {
        $student_id = $_SESSION['student_id'] ?? null;

        if (!$student_id) {
            echo json_encode(["status" => "error", "message" => "Student authentication required"]);
            return;
        }

        try {
            refreshBillingSchedulePenalties($this->conn, null, $student_id);
            $today = (new DateTime('today'))->format('Y-m-d');
            $tomorrow = (new DateTime('tomorrow'))->format('Y-m-d');

            $sql = "SELECT
                        bs.billing_schedule_id AS id,
                        bs.enrollment_details_id,
                        TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                        p.name AS program_name,
                        bs.billing_type,
                        bs.total_amount AS amount,
                        bs.status,
                        bs.due_date
                    FROM billing_schedule bs
                    JOIN enrollment_details ed ON bs.enrollment_details_id = ed.enrollment_details_id
                    JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                    JOIN student s ON eh.student_id = s.student_id
                    LEFT JOIN program p ON ed.program_id = p.program_id
                    WHERE eh.student_id = ?
                      AND bs.status IN ('unpaid', 'partial')
                      AND LOWER(COALESCE(p.name, '')) NOT LIKE '%preschool%'
                      AND LOWER(COALESCE(p.name, '')) NOT LIKE '%playschool%'
                      AND LOWER(COALESCE(p.name, '')) NOT LIKE '%pre-school%'
                      AND LOWER(COALESCE(p.name, '')) NOT LIKE '%play-school%'
                      AND LOWER(COALESCE(p.name, '')) NOT LIKE '%pre school%'
                      AND LOWER(COALESCE(p.name, '')) NOT LIKE '%play school%'
                    ORDER BY COALESCE(bs.due_date, '9999-12-31') ASC, bs.billing_type ASC";

            $stmt = $this->conn->prepare($sql);
            $stmt->execute([$student_id]);
            $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

            $summary = [
                'pending' => [],
                'due_today' => [],
                'due_tomorrow' => [],
                'overdue' => [],
                'pending_review' => $this->getPendingPaymentsForSummary($student_id, false)
            ];

            foreach ($items as $item) {
                $dueDate = $item['due_date'] ? substr($item['due_date'], 0, 10) : null;
                if (!$dueDate) {
                    $category = 'pending';
                } elseif ($dueDate < $today) {
                    $category = 'overdue';
                } elseif ($dueDate === $today) {
                    $category = 'due_today';
                } elseif ($dueDate === $tomorrow) {
                    $category = 'due_tomorrow';
                } else {
                    $category = 'pending';
                }

                $summary[$category][] = $item;
            }

            echo json_encode(["status" => "success", "data" => $summary]);
        } catch (Exception $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    public function getPrePlayPaymentDueSummary() {
        $student_id = $_SESSION['student_id'] ?? null;

        if (!$student_id) {
            echo json_encode(["status" => "error", "message" => "Student authentication required"]);
            return;
        }

        try {
            refreshBillingSchedulePenalties($this->conn, null, $student_id);
            $today = (new DateTime('today'))->format('Y-m-d');
            $tomorrow = (new DateTime('tomorrow'))->format('Y-m-d');

            $sql = "SELECT
                        bs.billing_schedule_id AS id,
                        bs.enrollment_details_id,
                        TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                        p.name AS program_name,
                        bs.billing_type,
                        bs.total_amount AS amount,
                        bs.status,
                        bs.due_date
                    FROM billing_schedule bs
                    JOIN enrollment_details ed ON bs.enrollment_details_id = ed.enrollment_details_id
                    JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                    JOIN student s ON eh.student_id = s.student_id
                    LEFT JOIN program p ON ed.program_id = p.program_id
                    WHERE eh.student_id = ?
                      AND bs.status IN ('unpaid', 'partial')
                      AND (
                            LOWER(COALESCE(p.name, '')) LIKE '%preschool%'
                            OR LOWER(COALESCE(p.name, '')) LIKE '%playschool%'
                            OR LOWER(COALESCE(p.name, '')) LIKE '%pre-school%'
                            OR LOWER(COALESCE(p.name, '')) LIKE '%play-school%'
                            OR LOWER(COALESCE(p.name, '')) LIKE '%pre school%'
                            OR LOWER(COALESCE(p.name, '')) LIKE '%play school%'
                      )
                    ORDER BY COALESCE(bs.due_date, '9999-12-31') ASC, bs.billing_type ASC";

            $stmt = $this->conn->prepare($sql);
            $stmt->execute([$student_id]);
            $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

            $summary = [
                'pending' => [],
                'due_today' => [],
                'due_tomorrow' => [],
                'overdue' => [],
                'pending_review' => $this->getPendingPaymentsForSummary($student_id, true)
            ];

            foreach ($items as $item) {
                $dueDate = $item['due_date'] ? substr($item['due_date'], 0, 10) : null;
                if (!$dueDate) {
                    $category = 'pending';
                } elseif ($dueDate < $today) {
                    $category = 'overdue';
                } elseif ($dueDate === $today) {
                    $category = 'due_today';
                } elseif ($dueDate === $tomorrow) {
                    $category = 'due_tomorrow';
                } else {
                    $category = 'pending';
                }

                $summary[$category][] = $item;
            }

            echo json_encode(["status" => "success", "data" => $summary]);
        } catch (Exception $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    // --- GET STUDENT'S ENROLLMENTS WITH PAYMENT SUMMARY ---
    public function getStudentEnrollments() {
        $student_id = $_SESSION['student_id'] ?? null;
        $type = strtolower(trim($_GET['type'] ?? ''));

        if (!$student_id) {
            echo json_encode(["status" => "error", "message" => "Student authentication required"]);
            return;
        }

        try {
            refreshBillingSchedulePenalties($this->conn, null, $student_id);
            $programFilterSql = "";

            if ($type === 'tutorial') {
                $programFilterSql = "
                    AND LOWER(COALESCE(p.name, '')) NOT LIKE '%preschool%'
                    AND LOWER(COALESCE(p.name, '')) NOT LIKE '%playschool%'
                    AND LOWER(COALESCE(p.name, '')) NOT LIKE '%pre-school%'
                    AND LOWER(COALESCE(p.name, '')) NOT LIKE '%play-school%'
                    AND LOWER(COALESCE(p.name, '')) NOT LIKE '%pre school%'
                    AND LOWER(COALESCE(p.name, '')) NOT LIKE '%play school%'";
            } elseif ($type === 'preplay') {
                $programFilterSql = "
                    AND (
                        LOWER(COALESCE(p.name, '')) LIKE '%preschool%'
                        OR LOWER(COALESCE(p.name, '')) LIKE '%playschool%'
                        OR LOWER(COALESCE(p.name, '')) LIKE '%pre-school%'
                        OR LOWER(COALESCE(p.name, '')) LIKE '%play-school%'
                        OR LOWER(COALESCE(p.name, '')) LIKE '%pre school%'
                        OR LOWER(COALESCE(p.name, '')) LIKE '%play school%'
                    )";
            }

            $sql = "SELECT
                        ed.enrollment_details_id,
                        p.name AS program_name,
                        COALESCE(NULLIF(TRIM(esub.subject_names), ''), NULLIF(TRIM(sub.subject_name), ''), p.name) AS subject_name,
                        COALESCE(NULLIF(TRIM(CONCAT_WS(' ', e.first_name, e.last_name)), ''), NULLIF(TRIM(CONCAT_WS(' ', sec_e.first_name, sec_e.last_name)), '')) AS teacher_name,
                        ed.goal,
                        COALESCE(NULLIF(eh.status, ''), ed.status) AS status,
                        COALESCE(NULLIF(eh.status, ''), ed.status) AS enrollment_status,
                        eh.total_of_program
                            + COALESCE((SELECT SUM(bs_penalty.penalty_amount)
                                        FROM billing_schedule bs_penalty
                                        WHERE bs_penalty.enrollment_details_id = ed.enrollment_details_id), 0) AS total_amount,
                        COALESCE(SUM(CASE WHEN pay.payment_status = 'Received' THEN pay.amount_paid ELSE 0 END), 0) AS total_paid,
                        (eh.total_of_program
                            + COALESCE((SELECT SUM(bs_penalty.penalty_amount)
                                        FROM billing_schedule bs_penalty
                                        WHERE bs_penalty.enrollment_details_id = ed.enrollment_details_id), 0)
                            - COALESCE(SUM(CASE WHEN pay.payment_status = 'Received' THEN pay.amount_paid ELSE 0 END), 0)) AS balance,
                        CASE
                            WHEN SUM(CASE WHEN pay.payment_status = 'Pending' THEN 1 ELSE 0 END) > 0 THEN 'Pending'
                            WHEN (eh.total_of_program
                                    + COALESCE((SELECT SUM(bs_penalty.penalty_amount)
                                                FROM billing_schedule bs_penalty
                                                WHERE bs_penalty.enrollment_details_id = ed.enrollment_details_id), 0)
                                    - COALESCE(SUM(CASE WHEN pay.payment_status = 'Received' THEN pay.amount_paid ELSE 0 END), 0)) <= 0 THEN 'Fully Paid'
                            WHEN COALESCE(SUM(CASE WHEN pay.payment_status = 'Received' THEN pay.amount_paid ELSE 0 END), 0) > 0 THEN 'Partial'
                            ELSE 'Unpaid'
                        END AS payment_status
                    FROM enrollment_details ed
                    JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                    LEFT JOIN program p ON ed.program_id = p.program_id
                    LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                    LEFT JOIN (SELECT es.enrollment_details_id, GROUP_CONCAT(s.subject_name ORDER BY s.subject_name SEPARATOR ', ') AS subject_names FROM enrollment_subjects es JOIN subject s ON es.subject_id = s.subject_id GROUP BY es.enrollment_details_id) esub ON ed.enrollment_details_id = esub.enrollment_details_id
                    LEFT JOIN employee e ON ed.preferred_teacher = e.employee_id
                    LEFT JOIN sections sec ON ed.section_id = sec.section_id
                    LEFT JOIN employee sec_e ON sec.employee_id = sec_e.employee_id
                    LEFT JOIN billing_schedule bs ON ed.enrollment_details_id = bs.enrollment_details_id
                    LEFT JOIN payment pay ON bs.billing_schedule_id = pay.billing_schedule_id
                    WHERE eh.student_id = ?
                    $programFilterSql
                    GROUP BY ed.enrollment_details_id, p.name, esub.subject_names, sub.subject_name, e.first_name, e.last_name, sec_e.first_name, sec_e.last_name, ed.goal, eh.total_of_program, eh.status, ed.status
                    ORDER BY ed.enrollment_details_id DESC";

            $stmt = $this->conn->prepare($sql);
            $stmt->execute([$student_id]);
            $enrollments = $stmt->fetchAll(PDO::FETCH_ASSOC);

            echo json_encode(["status" => "success", "data" => $enrollments]);
        } catch (Exception $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    // --- PROCESS STUDENT PAYMENT (GCash only) ---
    public function processPayment($json) {
        $input = json_decode($json, true);
        $student_id = $_SESSION['student_id'] ?? null;

        if (!$student_id) {
            echo json_encode(["status" => "error", "message" => "Student authentication required"]);
            return;
        }

        // --- INPUTS ---
        $enrollment_id = $input['enrollment_id'];
        $amount = floatval($input['amount']);
        $method_id = $input['method'] ?? null;
        $ref = $input['ref'] ?? null;
        $uploadedScreenshot = $_FILES['payment_screenshot'] ?? null;

        // Validate required fields
        if (!$method_id) {
            echo json_encode(["status" => "error", "message" => "Payment method is required"]);
            return;
        }

        try {
            $this->conn->beginTransaction();

            // Verify enrollment belongs to student
            $sqlVerify = "SELECT ed.enrollment_details_id
                         FROM enrollment_details ed
                         JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                         WHERE ed.enrollment_details_id = ? AND eh.student_id = ?";
            $stmtVerify = $this->conn->prepare($sqlVerify);
            $stmtVerify->execute([$enrollment_id, $student_id]);

            if (!$stmtVerify->fetch()) {
                throw new Exception("Access denied: Enrollment does not belong to you");
            }

            refreshBillingSchedulePenalties($this->conn, $enrollment_id);

            // Verify payment method exists and determine status behavior
            $stmtMethod = $this->conn->prepare("SELECT LOWER(payment_method) FROM payment_method WHERE payment_method_id = ?");
            $stmtMethod->execute([$method_id]);
            $methodName = strtolower($stmtMethod->fetchColumn() ?: '');
            if (!$methodName) {
                throw new Exception("Invalid payment method selected");
            }

            $payment_status = $methodName === 'gcash' ? 'Pending' : 'Received';
            $isPendingPayment = $payment_status === 'Pending';

            if ($methodName === 'gcash' && (!$uploadedScreenshot || ($uploadedScreenshot['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE)) {
                throw new Exception("GCash payment screenshot is required.");
            }

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

            if ($amount > $current_balance) {
                throw new Exception("Payment amount exceeds the outstanding balance of ₱" . number_format($current_balance, 2) . ".");
            }

            if ($amount <= 0) {
                throw new Exception("Payment amount must be greater than zero.");
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
                                    WHEN LOWER(bs.billing_type) = 'month 1' THEN 1
                                    WHEN LOWER(bs.billing_type) = 'miscellaneous' THEN 2
                                    WHEN bs.billing_type RLIKE '^Month [0-9]+' THEN 3
                                    ELSE 4
                                END ASC,
                                CAST(REGEXP_REPLACE(bs.billing_type, '[^0-9]', '') AS UNSIGNED) ASC,
                                (bs.due_date IS NULL),
                                bs.due_date ASC";

            $stmtFind = $this->conn->prepare($sqlFindBills);
            $stmtFind->execute([$enrollment_id]);
            $outstanding_bills = $stmtFind->fetchAll(PDO::FETCH_ASSOC);

            if (empty($outstanding_bills) && $amount > 0) {
                 throw new Exception("Could not find an unpaid bill for this enrollment. It might be fully paid or not yet billed.");
            }

            $overall_new_balance = $current_balance;
            $amount_to_pay = $amount;
            $line_items = [];
            $receipt_id = $this->generateReceiptId();
            $first_inserted_payment_id = null;
            $inserted_payment_ids = [];
            $storedScreenshotPath = null;

            foreach ($outstanding_bills as $bill) {
                if ($amount_to_pay <= 0) break;

                $billing_id_to_pay = $bill['billing_schedule_id'];
                $amount_due_for_bill = $bill['total_amount'] - $bill['total_paid'];
                $penalty_due_for_bill = max(0, floatval($bill['penalty_amount']) - floatval($bill['total_penalty_paid']));

                $payment_for_this_bill = 0;
                $new_bill_status = '';

                if ($amount_to_pay >= $amount_due_for_bill) {
                    $payment_for_this_bill = $amount_due_for_bill;
                    $new_bill_status = 'paid';
                    $amount_to_pay -= $amount_due_for_bill;
                } else {
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

                    $overall_new_balance = max(0, $overall_new_balance - $payment_for_this_bill);

                    // Insert payment record
                    $columns = ['billing_schedule_id', 'amount_paid', 'penalty_paid', 'payment_date', 'payment_method_id', 'reference_no', 'payment_status'];
                    $placeholders = ['?', '?', '?', 'NOW()', '?', '?', '?'];
                    $values = [$billing_id_to_pay, $payment_for_this_bill, $penalty_for_this_payment, $method_id, $ref, $payment_status];

                    if ($this->columnExists('payment', 'balance')) {
                        $columns[] = 'balance';
                        $placeholders[] = '?';
                        $values[] = $overall_new_balance;
                    }

                    if ($this->columnExists('payment', 'receipt_id')) {
                        $columns[] = 'receipt_id';
                        $placeholders[] = '?';
                        $values[] = $receipt_id;
                    }

                    $sqlInsertPayment = "INSERT INTO payment (" . implode(", ", $columns) . ")
                                        VALUES (" . implode(", ", $placeholders) . ")";
                    $stmtInsert = $this->conn->prepare($sqlInsertPayment);
                    $stmtInsert->execute($values);
                    $insertedPaymentId = intval($this->conn->lastInsertId() ?: 0) ?: null;
                    if ($first_inserted_payment_id === null) {
                        $first_inserted_payment_id = $insertedPaymentId;
                    }
                    if ($insertedPaymentId !== null) {
                        $inserted_payment_ids[] = $insertedPaymentId;
                    }

                    if (!$isPendingPayment) {
                        // Update billing schedule status only for received payments
                        $sqlUpdateBill = "UPDATE billing_schedule SET status = ? WHERE billing_schedule_id = ?";
                        $stmtUpdate = $this->conn->prepare($sqlUpdateBill);
                        $stmtUpdate->execute([$new_bill_status, $billing_id_to_pay]);
                    }
                }
            }

            if ($uploadedScreenshot && ($uploadedScreenshot['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
                $storedScreenshotPath = $this->storePaymentScreenshot($uploadedScreenshot, $receipt_id, $first_inserted_payment_id);
                if ($storedScreenshotPath && $this->columnExists('payment', 'proof_pic') && !empty($inserted_payment_ids)) {
                    $placeholders = implode(', ', array_fill(0, count($inserted_payment_ids), '?'));
                    $sqlUpdateProof = "UPDATE payment SET proof_pic = ? WHERE payment_id IN ($placeholders)";
                    $stmtUpdateProof = $this->conn->prepare($sqlUpdateProof);
                    $stmtUpdateProof->execute(array_merge([$storedScreenshotPath], $inserted_payment_ids));
                }
            }

            if ($isPendingPayment) {
                $enrollment = $this->notifications->getEnrollmentContext($enrollment_id);
                $studentName = $enrollment['student_name'] ?? 'A student';
                $programName = $enrollment['program_name'] ?? 'an enrollment';
                $reference = $ref ? " Reference: {$ref}." : '';
                $this->notifications->notifyRole(
                    'auditor',
                    'GCash Payment Awaiting Review',
                    "{$studentName} submitted a GCash payment of PHP " . number_format($amount, 2) . " for {$programName}.{$reference} Please review the payment."
                );
            }

            // --- LOGIC TO UPDATE OVERALL ENROLLMENT HEADER STATUS ---
            // Note: For student self-enrollment, keep status as 'pending' until admin approval
            // Removed header status update to maintain 'pending' status

            $this->conn->commit();
            echo json_encode([
                "status" => "success",
                "message" => "Payment recorded successfully. Please wait for admin verification.",
                "line_items" => $line_items,
                "receipt_id" => $receipt_id,
                "payment_screenshot_path" => $storedScreenshotPath
            ]);

        } catch (Exception $e) {
            $this->conn->rollBack();
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }
}

// ROUTER
if ($_SERVER['REQUEST_METHOD'] == 'GET') {
    $op = $_GET['operation'] ?? null;
    if ($op === 'getPaymentHistory' || $op === 'getBillingDetails' || $op === 'getStudentEnrollments') {
        // No JSON body for GET request, but the operation is clear
    } else {
        $json = $_GET['json'] ?? "";
    }
} else {
    if (!empty($_POST)) {
        $op = $_POST['operation'] ?? null;
        $json = $_POST['json'] ?? "";
    } else {
        $content = file_get_contents('php://input');
        $postData = json_decode($content, true);
        $op = $postData['operation'] ?? null;
        $json = $postData['json'] ?? "";
    }
}

$api = new StudentPaymentAPI();
switch($op){
    case "getPaymentMethods": $api->getPaymentMethods(); break;
    case "getBillingDetails": $api->getBillingDetails(); break;
    case "getPaymentHistory": $api->getPaymentHistory(); break;
    case "getPaymentDueSummary": $api->getPaymentDueSummary(); break;
    case "getPrePlayPaymentDueSummary": $api->getPrePlayPaymentDueSummary(); break;
    case "getStudentEnrollments": $api->getStudentEnrollments(); break;
    case "processPayment": $api->processPayment($json); break;
    default: echo json_encode(["status" => "error", "message" => "Invalid Operation"]); break;
}
?>
