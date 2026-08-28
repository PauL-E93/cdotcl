    <?php
    // api/billing.php

    session_start();

    header('Content-Type: application/json');
    header("Access-Control-Allow-Origin: *");
    header("Access-Control-Allow-Methods: POST, GET");
    header("Access-Control-Allow-Headers: Content-Type");

    require_once __DIR__ . '/../billing_penalty_helper.php';

    class BillingAPI {

        private $conn;

        public function __construct() {
            include "connection-pdo.php";
            $this->conn = $conn;
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

        private function getPaymentsToReceive($branchId, $isPrePlay = false) {
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
                        pay.penalty_paid AS penalty_amount,
                        COALESCE(pp.penalty_amount, 0) AS penalty_rate,
                        COALESCE(pp.grace_period_days, 2) AS grace_period_days,
                        DATE_ADD(bs.due_date, INTERVAL (COALESCE(pp.grace_period_days, 2) + 1) DAY) AS penalty_effective_date,
                        pay.payment_status AS status,
                        bs.due_date
                    FROM payment pay
                    JOIN billing_schedule bs ON pay.billing_schedule_id = bs.billing_schedule_id
                    JOIN enrollment_details ed ON bs.enrollment_details_id = ed.enrollment_details_id
                    JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                    JOIN student s ON eh.student_id = s.student_id
                    LEFT JOIN program prog ON ed.program_id = prog.program_id
                    LEFT JOIN program_penalty pp ON ed.program_id = pp.program_id
                    WHERE pay.payment_status = 'Pending'
                    $programTypeFilter
                    " . ($branchId ? " AND eh.branch_id = :branch_id" : "") . "
                    ORDER BY pay.payment_date ASC, pay.payment_id ASC";

            $stmt = $this->conn->prepare($sql);
            $stmt->execute($branchId ? [':branch_id' => $branchId] : []);
            return $stmt->fetchAll(PDO::FETCH_ASSOC);
        }

        // --- GET PAYMENT METHODS ---
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

        // --- GET PAYMENT DUE SUMMARY ---
        public function getPaymentDueSummary() {
            try {
                refreshBillingSchedulePenalties($this->conn);
                $today = (new DateTime('today'))->format('Y-m-d');
                $tomorrow = (new DateTime('tomorrow'))->format('Y-m-d');
                $branchId = $this->getBranchAdminBranchId();

                $sql = "SELECT
                            bs.billing_schedule_id AS id,
                            bs.enrollment_details_id,
                            TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                            p.name AS program_name,
                            bs.billing_type,
                            bs.total_amount AS amount,
                            bs.original_amount,
                            bs.penalty_amount,
                            COALESCE(pp.penalty_amount, 0) AS penalty_rate,
                            COALESCE(pp.grace_period_days, 2) AS grace_period_days,
                            DATE_ADD(bs.due_date, INTERVAL (COALESCE(pp.grace_period_days, 2) + 1) DAY) AS penalty_effective_date,
                            bs.status,
                            bs.due_date
                        FROM billing_schedule bs
                        JOIN enrollment_details ed ON bs.enrollment_details_id = ed.enrollment_details_id
                        JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                        JOIN student s ON eh.student_id = s.student_id
                        LEFT JOIN program p ON ed.program_id = p.program_id
                        LEFT JOIN program_penalty pp ON ed.program_id = pp.program_id
                        WHERE bs.status IN ('unpaid', 'partial')
                          AND LOWER(COALESCE(p.name, '')) NOT LIKE '%preschool%'
                          AND LOWER(COALESCE(p.name, '')) NOT LIKE '%playschool%'
                          AND LOWER(COALESCE(p.name, '')) NOT LIKE '%pre-school%'
                          AND LOWER(COALESCE(p.name, '')) NOT LIKE '%play-school%'
                          AND LOWER(COALESCE(p.name, '')) NOT LIKE '%pre school%'
                          AND LOWER(COALESCE(p.name, '')) NOT LIKE '%play school%'
                        " . ($branchId ? " AND eh.branch_id = :branch_id" : "") . "
                        ORDER BY COALESCE(bs.due_date, '9999-12-31') ASC, bs.billing_type ASC";

                $stmt = $this->conn->prepare($sql);
                $stmt->execute($branchId ? [':branch_id' => $branchId] : []);
                $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

                $summary = [
                    'pending' => [],
                    'due_today' => [],
                    'due_tomorrow' => [],
                    'overdue' => [],
                    'to_receive' => $this->getPaymentsToReceive($branchId)
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

        // --- GET PREPLAY PAYMENT DUE SUMMARY ---
        public function getPrePlayPaymentDueSummary() {
            try {
                refreshBillingSchedulePenalties($this->conn);
                $today = (new DateTime('today'))->format('Y-m-d');
                $tomorrow = (new DateTime('tomorrow'))->format('Y-m-d');
                $branchId = $this->getBranchAdminBranchId();

                $sql = "SELECT
                            bs.billing_schedule_id AS id,
                            bs.enrollment_details_id,
                            TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                            p.name AS program_name,
                            bs.billing_type,
                            bs.total_amount AS amount,
                            bs.original_amount,
                            bs.penalty_amount,
                            COALESCE(pp.penalty_amount, 0) AS penalty_rate,
                            COALESCE(pp.grace_period_days, 2) AS grace_period_days,
                            DATE_ADD(bs.due_date, INTERVAL (COALESCE(pp.grace_period_days, 2) + 1) DAY) AS penalty_effective_date,
                            bs.status,
                            bs.due_date
                        FROM billing_schedule bs
                        JOIN enrollment_details ed ON bs.enrollment_details_id = ed.enrollment_details_id
                        JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                        JOIN student s ON eh.student_id = s.student_id
                        LEFT JOIN program p ON ed.program_id = p.program_id
                        LEFT JOIN program_penalty pp ON ed.program_id = pp.program_id
                        WHERE bs.status IN ('unpaid', 'partial')
                          AND (
                                LOWER(COALESCE(p.name, '')) LIKE '%preschool%'
                                OR LOWER(COALESCE(p.name, '')) LIKE '%playschool%'
                                OR LOWER(COALESCE(p.name, '')) LIKE '%pre-school%'
                                OR LOWER(COALESCE(p.name, '')) LIKE '%play-school%'
                                OR LOWER(COALESCE(p.name, '')) LIKE '%pre school%'
                                OR LOWER(COALESCE(p.name, '')) LIKE '%play school%'
                          )
                        " . ($branchId ? " AND eh.branch_id = :branch_id" : "") . "
                        ORDER BY COALESCE(bs.due_date, '9999-12-31') ASC, bs.billing_type ASC";

                $stmt = $this->conn->prepare($sql);
                $stmt->execute($branchId ? [':branch_id' => $branchId] : []);
                $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

                $summary = [
                    'pending' => [],
                    'due_today' => [],
                    'due_tomorrow' => [],
                    'overdue' => [],
                    'to_receive' => $this->getPaymentsToReceive($branchId, true)
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

        // --- GET BILLING DETAILS ---
        public function getBillingDetails() {
            $enrollment_id = $_GET['enrollment_id'] ?? null;
            if (!$enrollment_id) {
                echo json_encode(["status" => "error", "message" => "Enrollment ID required"]);
                return;
            }

            try {
                $branchId = $this->getBranchAdminBranchId();
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
                        WHERE ed.enrollment_details_id = ?" .
                        ($branchId ? " AND eh.branch_id = ?" : "");
                $stmt = $this->conn->prepare($sql);
                $params = [$enrollment_id];
                if ($branchId) {
                    $params[] = $branchId;
                }
                $stmt->execute($params);
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
                                    COALESCE(SUM(CASE WHEN p.payment_status != 'Declined' THEN p.amount_paid ELSE 0 END), 0) AS paid_amount,
                                    COALESCE(SUM(CASE WHEN p.payment_status != 'Declined' THEN p.penalty_paid ELSE 0 END), 0) AS penalty_paid,
                                    GREATEST(bs.total_amount - COALESCE(SUM(CASE WHEN p.payment_status != 'Declined' THEN p.amount_paid ELSE 0 END), 0), 0) AS remaining_amount,
                                    bs.status,
                                    bs.due_date
                                FROM billing_schedule bs
                                JOIN enrollment_details ed_penalty ON bs.enrollment_details_id = ed_penalty.enrollment_details_id
                                LEFT JOIN program_penalty pp ON ed_penalty.program_id = pp.program_id
                                LEFT JOIN payment p ON bs.billing_schedule_id = p.billing_schedule_id
                                WHERE bs.enrollment_details_id = ?
                                GROUP BY bs.billing_schedule_id, bs.billing_type, bs.total_amount, bs.original_amount, bs.penalty_amount,
                                         pp.penalty_amount, pp.grace_period_days, bs.status, bs.due_date
                                ORDER BY (bs.due_date IS NULL), bs.due_date ASC, bs.billing_schedule_id ASC";
                $stmtSchedule = $this->conn->prepare($sqlSchedule);
                $stmtSchedule->execute([$enrollment_id]);
                $schedule = $stmtSchedule->fetchAll(PDO::FETCH_ASSOC);

                // Calculate total paid across ALL schedules for overview
                $total_paid_global = 0;
                
                // We need to query the actual payments to get an accurate total paid sum
                // because a schedule might be 'unpaid' but have partial payments on it.
                $sqlGlobalPay = "SELECT SUM(CASE WHEN p.payment_status != 'Declined' THEN p.amount_paid ELSE 0 END) FROM payment p 
                                JOIN billing_schedule bs ON p.billing_schedule_id = bs.billing_schedule_id 
                                WHERE bs.enrollment_details_id = ?";
                $stmtGlobal = $this->conn->prepare($sqlGlobalPay);
                $stmtGlobal->execute([$enrollment_id]);
                $total_paid_global = floatval($stmtGlobal->fetchColumn() ?: 0);

                $total_penalty = array_reduce($schedule, function($sum, $item) {
                    if (strtolower((string)($item['status'] ?? '')) === 'cancelled') {
                        return $sum;
                    }
                    return $sum + floatval($item['penalty_amount'] ?? 0);
                }, 0);
                $schedule_total = array_reduce($schedule, function($sum, $item) {
                    if (strtolower((string)($item['status'] ?? '')) === 'cancelled') {
                        return $sum;
                    }
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
    }

    $op = $_GET['operation'] ?? null;

    $api = new BillingAPI();
    switch($op){
        case "getBillingDetails": $api->getBillingDetails(); break;
        case "getPaymentMethods": $api->getPaymentMethods(); break;
        case "getPaymentDueSummary": $api->getPaymentDueSummary(); break;        case "getPrePlayPaymentDueSummary": $api->getPrePlayPaymentDueSummary(); break;        default: echo json_encode(["status" => "error", "message" => "Invalid Operation"]); break;
    }?>
