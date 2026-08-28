<?php
// api/enrollment.php

error_reporting(E_ERROR | E_PARSE);
session_start();

header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET");
header("Access-Control-Allow-Headers: Content-Type");

require_once __DIR__ . '/../notification_helper.php';
require_once __DIR__ . '/../grade_level_helper.php';
require_once __DIR__ . '/../billing_assessment_helper.php';

class EnrollmentAPI {

    private $conn;
    private $notifications;

    public function __construct() {
        include "connection-pdo.php"; 
        $this->conn = $conn;
        ensureGradeLevelSchema($this->conn);
        ensureBillingAssessmentSchema($this->conn);
        $this->notifications = new NotificationService($this->conn);
    }

    private function getCurrentEnrollmentEmployeeId() {
        $role = strtolower(trim((string)($_SESSION['user_role'] ?? '')));
        if ($role === 'student') {
            return null;
        }

        $employeeId = intval($_SESSION['employee_id'] ?? 0);
        if ($employeeId <= 0) {
            throw new Exception("A logged-in staff account is required to record who performed this enrollment.");
        }

        $stmt = $this->conn->prepare("SELECT 1 FROM employee WHERE employee_id = ? LIMIT 1");
        $stmt->execute([$employeeId]);
        if (!$stmt->fetchColumn()) {
            throw new Exception("The logged-in staff account could not be found.");
        }
        return $employeeId;
    }

    private function assertActiveGradeLevel($gradeLevelId) {
        $gradeLevelId = intval($gradeLevelId ?? 0);
        if ($gradeLevelId <= 0) {
            throw new Exception("Grade level is required for a Tutorial enrollment.");
        }

        $stmt = $this->conn->prepare("SELECT 1 FROM grade_level WHERE grade_level_id = ? AND status = 'active' LIMIT 1");
        $stmt->execute([$gradeLevelId]);
        if (!$stmt->fetchColumn()) {
            throw new Exception("The selected grade level is no longer available. Please choose another grade.");
        }
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

    private function getEnrollmentBranchId($data, $fallbackBranchId = null) {
        $requestedBranchId = isset($data['preferred_branch_id']) && $data['preferred_branch_id'] !== '' && $data['preferred_branch_id'] !== null
            ? intval($data['preferred_branch_id'])
            : 0;

        if ($requestedBranchId > 0) {
            return $requestedBranchId;
        }

        return !empty($fallbackBranchId) ? intval($fallbackBranchId) : null;
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

    private function updateStudentAddressFromEnrollmentData($studentId, $data) {
        $addressKeys = ['adr_street', 'adr_barangay', 'adr_city', 'adr_province', 'adr_note'];
        $hasAddressInput = false;
        foreach ($addressKeys as $key) {
            if (array_key_exists($key, $data)) {
                $hasAddressInput = true;
                break;
            }
        }

        if (!$hasAddressInput || empty($studentId)) {
            return;
        }

        $stmt = $this->conn->prepare("
            UPDATE student
            SET adr_street = ?, adr_barangay = ?, adr_city = ?, adr_province = ?, adr_note = ?
            WHERE student_id = ?
        ");
        $stmt->execute([
            isset($data['adr_street']) && trim((string)$data['adr_street']) !== '' ? trim((string)$data['adr_street']) : null,
            isset($data['adr_barangay']) && trim((string)$data['adr_barangay']) !== '' ? trim((string)$data['adr_barangay']) : null,
            isset($data['adr_city']) && trim((string)$data['adr_city']) !== '' ? trim((string)$data['adr_city']) : null,
            isset($data['adr_province']) && trim((string)$data['adr_province']) !== '' ? trim((string)$data['adr_province']) : null,
            isset($data['adr_note']) && trim((string)$data['adr_note']) !== '' ? trim((string)$data['adr_note']) : null,
            $studentId
        ]);
    }

    private function getProgramTypeCondition($type, $alias = 'p') {
        $name = "LOWER(CONCAT_WS(' ', COALESCE($alias.name, ''), COALESCE((SELECT pt_filter.type FROM program_type pt_filter WHERE pt_filter.program_type_id = $alias.program_type LIMIT 1), '')))";
        if ($type === 'tutorial') {
            return "$name NOT LIKE '%preschool%' AND $name NOT LIKE '%playschool%' AND $name NOT LIKE '%pre-school%' AND $name NOT LIKE '%play-school%' AND $name NOT LIKE '%pre school%' AND $name NOT LIKE '%play school%'";
        }
        if ($type === 'preschool') {
            return "($name LIKE '%preschool%' OR $name LIKE '%playschool%' OR $name LIKE '%pre-school%' OR $name LIKE '%play-school%' OR $name LIKE '%pre school%' OR $name LIKE '%play school%')";
        }

        return "1=1";
    }

    private function normalizeDayName($day) {
        $day = trim(strtolower($day));
        return ucfirst($day);
    }

    private function getDayNumber($day) {
        $days = [
            'Monday' => 1,
            'Tuesday' => 2,
            'Wednesday' => 3,
            'Thursday' => 4,
            'Friday' => 5,
            'Saturday' => 6,
            'Sunday' => 7
        ];
        $dayName = $this->normalizeDayName($day);
        return $days[$dayName] ?? null;
    }

    private function getNextDateForDay($currentDate, $targetDay) {
        $current = strtotime($currentDate);
        if ($current === false) {
            return null;
        }
        $currentDayNum = intval(date('N', $current));
        $targetDayNum = $this->getDayNumber($targetDay);
        if (!$targetDayNum) {
            return null;
        }

        $delta = $targetDayNum - $currentDayNum;
        if ($delta <= 0) {
            $delta += 7;
        }

        return date('Y-m-d', strtotime("+$delta days", $current));
    }

    private function getNextOrSameDate($day) {
        $dayName = $this->normalizeDayName($day);
        if (!$this->getDayNumber($dayName)) {
            return null;
        }

        $today = date('Y-m-d');
        $candidate = date('Y-m-d', strtotime("this $dayName"));
        if ($candidate < $today) {
            $candidate = date('Y-m-d', strtotime("next $dayName"));
        }
        return $candidate;
    }

    private function parseClockTimeToMinutes($time) {
        $value = trim((string)$time);
        if ($value === '' || !preg_match('/^(\d{1,2}):(\d{2})$/', $value, $matches)) {
            return null;
        }

        $hours = intval($matches[1]);
        $minutes = intval($matches[2]);
        if ($hours < 0 || $hours > 23 || $minutes < 0 || $minutes > 59) {
            return null;
        }

        return ($hours * 60) + $minutes;
    }

    private function formatSessionUnitCount($minutes) {
        $units = max(0, intval($minutes)) / 60;
        if (abs($units - round($units)) < 0.00001) {
            return (string)intval(round($units));
        }

        return rtrim(rtrim(number_format($units, 2, '.', ''), '0'), '.');
    }

    private function buildSessionScheduleRows($preferences, $totalSessions) {
        $rows = [];
        if (!is_array($preferences) || empty($preferences) || $totalSessions <= 0) {
            return $rows;
        }

        $cleanPrefs = [];
        $totalScheduledMinutes = 0;
        foreach ($preferences as $pref) {
            if (empty($pref['day']) || empty($pref['time']) || empty($pref['date'])) {
                continue;
            }

            $endTime = $pref['endTime'] ?? $pref['end_time'] ?? null;
            if (empty($endTime)) {
                throw new Exception("Each schedule preference for a session-based tutorial must include an end time.");
            }

            $startMinutes = $this->parseClockTimeToMinutes($pref['time']);
            $endMinutes = $this->parseClockTimeToMinutes($endTime);
            if ($startMinutes === null || $endMinutes === null || $endMinutes <= $startMinutes) {
                throw new Exception("Each schedule preference for a session-based tutorial must have a valid start and end time.");
            }

            $totalScheduledMinutes += ($endMinutes - $startMinutes);
            $cleanPrefs[] = [
                'day' => $this->normalizeDayName($pref['day']),
                'start_time' => $pref['time'],
                'end_time' => $endTime,
                'date' => $pref['date']
            ];
        }

        if (empty($cleanPrefs)) {
            throw new Exception("Schedule preferences are required for session-based tutorials.");
        }

        $requiredMinutes = intval($totalSessions) * 60;
        if ($totalScheduledMinutes !== $requiredMinutes) {
            $requiredLabel = $this->formatSessionUnitCount($requiredMinutes);
            $currentLabel = $this->formatSessionUnitCount($totalScheduledMinutes);
            throw new Exception("Schedule preferences must total exactly {$requiredLabel} session unit(s) for this tutorial. Current total: {$currentLabel}.");
        }

        // Store each preferred time block once.
        foreach ($cleanPrefs as $pref) {
            $rows[] = [
                'day' => $pref['day'],
                'start_time' => $pref['start_time'],
                'end_time' => $pref['end_time'],
                'date' => $pref['date']
            ];
        }

        return $rows;
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

    private function tableExists($table) {
        $stmt = $this->conn->prepare("SHOW TABLES LIKE ?");
        $stmt->execute([$table]);
        return (bool)$stmt->fetch(PDO::FETCH_NUM);
    }

    private function normalizeSubjectIds($data) {
        $rawSubjects = $data['subject_ids'] ?? $data['subject_id'] ?? [];
        if (!is_array($rawSubjects)) {
            $rawSubjects = explode(',', (string)$rawSubjects);
        }

        $subjectIds = [];
        foreach ($rawSubjects as $subjectId) {
            $subjectId = intval($subjectId);
            if ($subjectId > 0 && !in_array($subjectId, $subjectIds, true)) {
                $subjectIds[] = $subjectId;
            }
        }

        return $subjectIds;
    }

    private function saveEnrollmentSubjects($detailsId, $subjectIds) {
        if (!$this->tableExists('enrollment_subjects')) {
            return;
        }

        $stmtDelete = $this->conn->prepare("DELETE FROM enrollment_subjects WHERE enrollment_details_id = ?");
        $stmtDelete->execute([$detailsId]);

        if (empty($subjectIds)) {
            return;
        }

        $stmtInsert = $this->conn->prepare("INSERT INTO enrollment_subjects (enrollment_details_id, subject_id) VALUES (?, ?)");
        foreach ($subjectIds as $subjectId) {
            $stmtInsert->execute([$detailsId, $subjectId]);
        }
    }

    private function insertEnrollmentPreferredScheduleRows($detailsId, $scheduleRows) {
        if (empty($scheduleRows) || !is_array($scheduleRows)) {
            return;
        }

        $hasRescheduleReason = $this->columnExists('enrollment_preferred_schedule', 'reschedule_reason');
        $sql = $hasRescheduleReason
            ? "INSERT INTO enrollment_preferred_schedule (enrollment_details_id, day, start_time, end_time, date, reschedule_reason) VALUES (?, ?, ?, ?, ?, ?)"
            : "INSERT INTO enrollment_preferred_schedule (enrollment_details_id, day, start_time, end_time, date) VALUES (?, ?, ?, ?, ?)";
        $stmt = $this->conn->prepare($sql);

        foreach ($scheduleRows as $row) {
            $params = [$detailsId, $row['day'], $row['start_time'], $row['end_time'], $row['date']];
            if ($hasRescheduleReason) {
                $reason = isset($row['reschedule_reason']) && trim((string)$row['reschedule_reason']) !== ''
                    ? trim((string)$row['reschedule_reason'])
                    : 'Initial enrollment schedule';
                $params[] = $reason;
            }
            $stmt->execute($params);
        }
    }

    private function getAllowedColumnValues($table, $column) {
        $stmt = $this->conn->prepare("SHOW COLUMNS FROM `$table` LIKE ?");
        $stmt->execute([$column]);
        $columnInfo = $stmt->fetch(PDO::FETCH_ASSOC);
        $type = $columnInfo['Type'] ?? '';

        if (!preg_match("/^(enum|set)\((.*)\)$/i", $type, $matches)) {
            return [];
        }

        $values = str_getcsv($matches[2], ',', "'");
        return array_map('strval', $values);
    }

    private function getAllowedStatus($table, $preferred, $fallback = 'pending') {
        $allowed = $this->getAllowedColumnValues($table, 'status');
        if (empty($allowed) || in_array($preferred, $allowed, true)) {
            return $preferred;
        }

        return in_array($fallback, $allowed, true) ? $fallback : ($allowed[0] ?? $fallback);
    }

    private function getActiveSchoolYearId($providedSchoolYearId = null) {
        if (!empty($providedSchoolYearId) && is_numeric($providedSchoolYearId)) {
            return intval($providedSchoolYearId);
        }

        $activeSchoolYear = $this->conn->query("SELECT school_year_id FROM school_years WHERE sy_status = 'active' LIMIT 1")->fetch(PDO::FETCH_ASSOC);
        if ($activeSchoolYear && !empty($activeSchoolYear['school_year_id'])) {
            return intval($activeSchoolYear['school_year_id']);
        }

        throw new Exception("Active school year not found. Please activate a school year before creating enrollments.");
    }

    private function getProgram($programId) {
        $stmt = $this->conn->prepare("
            SELECT p.program_id, p.name, p.tuition, p.total_units, p.unit_type, p.program_type,
                   p.registration_fee, p.default_discount_id, p.downpayment, p.service_id,
                   s.service_name, s.amount AS service_amount, s.status AS service_status,
                   pt.type AS type_name
            FROM program p
            LEFT JOIN program_type pt ON p.program_type = pt.program_type_id
            LEFT JOIN service s ON p.service_id = s.service_id
            WHERE p.program_id = ?
            LIMIT 1
        ");
        $stmt->execute([$programId]);
        $program = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$program) {
            throw new Exception("Selected program was not found.");
        }

        return $program;
    }

    private function isServiceAvailableAtBranch($serviceId, $branchId) {
        if (empty($branchId) || !$this->tableExists('branch_services')) {
            return true;
        }

        $stmt = $this->conn->prepare("SELECT 1 FROM branch_services WHERE branch_id = ? AND service_id = ? LIMIT 1");
        $stmt->execute([$branchId, $serviceId]);
        return (bool)$stmt->fetchColumn();
    }

    private function getServiceSnapshotForProgram($program, $requestedServiceId = null, $branchId = null) {
        $programServiceId = intval($program['service_id'] ?? 0);
        if ($requestedServiceId === null || $requestedServiceId === '') {
            return ['service_id' => null, 'service_name' => null, 'service_amount' => 0];
        }
        $serviceId = intval($requestedServiceId);

        if ($serviceId <= 0 || $serviceId !== $programServiceId) {
            throw new Exception("Selected service is not available for this program.");
        }

        if (!$this->isServiceAvailableAtBranch($serviceId, $branchId)) {
            throw new Exception("Selected service is not offered by this branch.");
        }

        $stmt = $this->conn->prepare("SELECT service_id, service_name, amount FROM service WHERE service_id = ? AND status = 'active' LIMIT 1");
        $stmt->execute([$serviceId]);
        $service = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$service) {
            return ['service_id' => null, 'service_name' => null, 'service_amount' => 0];
        }

        return [
            'service_id' => intval($service['service_id']),
            'service_name' => $service['service_name'],
            'service_amount' => max(0, floatval($service['amount'] ?? 0))
        ];
    }

    private function getDiscountSnapshot($discountId, $baseAmount) {
        if (empty($discountId) || !$this->tableExists('discount')) {
            return [
                'discount_id' => null,
                'discount_name' => null,
                'discount_amount' => 0
            ];
        }

        $stmt = $this->conn->prepare("SELECT * FROM discount WHERE discount_id = ? LIMIT 1");
        $stmt->execute([$discountId]);
        $discount = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$discount) {
            return [
                'discount_id' => null,
                'discount_name' => null,
                'discount_amount' => 0
            ];
        }

        $value = floatval($discount['discount_value'] ?? $discount['price'] ?? 0);
        $type = strtolower($discount['discount_type'] ?? 'fixed');
        if ($type === 'percentage') {
            $amount = max(0, floatval($baseAmount) * ($value / 100));
        } elseif ($type === 'full_waiver') {
            $amount = max(0, floatval($baseAmount));
        } else {
            $amount = max(0, $value);
        }

        return [
            'discount_id' => intval($discount['discount_id']),
            'discount_name' => $discount['discount_name'] ?? null,
            'discount_amount' => min($amount, max(0, floatval($baseAmount)))
        ];
    }

    private function getProgramProductTotal($programId) {
        $stmt = $this->conn->prepare("SELECT SUM(prd.price) AS total_misc FROM program_products pp INNER JOIN product prd ON pp.product_id = prd.product_id WHERE pp.program_id = ?");
        $stmt->execute([$programId]);
        return floatval(($stmt->fetch(PDO::FETCH_ASSOC)['total_misc'] ?? 0));
    }

    private function getProgramFinancialSnapshot($program, $includeRegistrationFee = true, $requestedServiceId = null, $branchId = null) {
        $programId = intval($program['program_id'] ?? 0);
        $tuition = floatval($program['tuition'] ?? 0);
        $units = intval($program['total_units'] ?? 0);
        $isPreschool = $this->isPreschoolProgramName($program['name'] ?? '');
        $miscAmount = 0;
        $serviceSnapshot = $isPreschool ? $this->getServiceSnapshotForProgram($program, $requestedServiceId, $branchId) : ['service_id' => null, 'service_name' => null, 'service_amount' => 0];
        $serviceMonthlyAmount = floatval($serviceSnapshot['service_amount'] ?? 0);

        if ($isPreschool) {
            $months = $units > 0 ? $units : 10;
            $tuitionSubtotal = ($tuition + $serviceMonthlyAmount) * $months;
            $miscAmount = $this->getProgramProductTotal($programId);
        } else {
            $tuitionSubtotal = $tuition;
        }

        $discount = $this->getDiscountSnapshot($program['default_discount_id'] ?? null, $tuitionSubtotal + $miscAmount);
        $registrationFee = $includeRegistrationFee ? max(0, floatval($program['registration_fee'] ?? 0)) : 0;
        $downpayment = max(0, floatval($program['downpayment'] ?? 0));

        return array_merge($discount, [
            'registration_fee' => $registrationFee,
            'downpayment_amount' => $downpayment,
            'service_id' => $serviceSnapshot['service_id'],
            'service_name' => $serviceSnapshot['service_name'],
            'service_amount' => $serviceMonthlyAmount,
            'tuition_subtotal' => $tuitionSubtotal,
            'misc_amount' => $miscAmount,
            'total_after_discount' => max(0, $tuitionSubtotal + $miscAmount - $discount['discount_amount']),
            'grand_total' => max(0, $tuitionSubtotal + $miscAmount + $registrationFee - $discount['discount_amount'])
        ]);
    }

    private function addFinancialSnapshotColumns(&$columns, &$placeholders, &$values, $snapshot) {
        $optional = [
            'discount_id' => $snapshot['discount_id'],
            'discount_name' => $snapshot['discount_name'],
            'discount_amount' => $snapshot['discount_amount'],
            'registration_fee' => $snapshot['registration_fee'],
            'downpayment_amount' => $snapshot['downpayment_amount'],
            'services' => $snapshot['service_name'] ?? null
        ];

        foreach ($optional as $column => $value) {
            if ($this->columnExists('enrollment_details', $column)) {
                $columns[] = $column;
                $placeholders[] = '?';
                $values[] = $value;
            }
        }
    }

    private function getProgramDisplayName($program) {
        $name = $program['name'] ?? 'Program';
        $type = $program['type_name'] ?? null;
        return $type ? $name . " (" . $type . ")" : $name;
    }

    private function isPreschoolProgramName($programName) {
        $name = strtolower($programName ?? '');
        return strpos($name, 'preschool') !== false ||
            strpos($name, 'playschool') !== false ||
            strpos($name, 'play school') !== false ||
            strpos($name, 'pre-school') !== false ||
            strpos($name, 'pre school') !== false;
    }

    private function insertPaymentRecord($billingScheduleId, $paymentMethodId, $amount, $referenceNo, $balance, $employeeId, $paymentStatus = 'Received', $paymentType = null, $receiptId = null) {
        $columns = ['payment_method_id', 'billing_schedule_id'];
        $placeholders = ['?', '?'];
        $values = [$paymentMethodId, $billingScheduleId];

        if ($this->columnExists('payment', 'employee_id')) {
            $columns[] = 'employee_id';
            $placeholders[] = '?';
            $values[] = $employeeId;
        }

        if ($this->columnExists('payment', 'payment_date')) {
            $columns[] = 'payment_date';
            $placeholders[] = 'CURDATE()';
        }

        if ($this->columnExists('payment', 'amount_paid')) {
            $columns[] = 'amount_paid';
            $placeholders[] = '?';
            $values[] = $amount;
        }

        if ($this->columnExists('payment', 'payment_type')) {
            $columns[] = 'payment_type';
            $placeholders[] = '?';
            $values[] = $paymentType;
        }

        if ($this->columnExists('payment', 'receipt_id')) {
            $columns[] = 'receipt_id';
            $placeholders[] = '?';
            $values[] = $receiptId ?: $this->generateReceiptId();
        }

        if ($this->columnExists('payment', 'reference_no')) {
            $columns[] = 'reference_no';
            $placeholders[] = '?';
            $values[] = $referenceNo;
        }

        if ($this->columnExists('payment', 'balance')) {
            $columns[] = 'balance';
            $placeholders[] = '?';
            $values[] = $balance;
        }

        if ($this->columnExists('payment', 'payment_status')) {
            $columns[] = 'payment_status';
            $placeholders[] = '?';
            $values[] = $paymentStatus;
        }

        $sql = "INSERT INTO payment (" . implode(", ", $columns) . ") VALUES (" . implode(", ", $placeholders) . ")";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($values);

        return $this->conn->lastInsertId();
    }

    private function getPaymentMethodName($paymentMethodId) {
        $stmt = $this->conn->prepare("SELECT payment_method FROM payment_method WHERE payment_method_id = ? LIMIT 1");
        $stmt->execute([$paymentMethodId]);
        return $stmt->fetchColumn() ?: 'Payment';
    }

    private function getPaidDownpaymentAmount($detailsId) {
        $statusFilter = $this->columnExists('payment', 'payment_status')
            ? "AND COALESCE(p.payment_status, 'Received') = 'Received'"
            : "";

        $stmt = $this->conn->prepare("
            SELECT COALESCE(SUM(p.amount_paid), 0)
            FROM payment p
            JOIN billing_schedule bs ON p.billing_schedule_id = bs.billing_schedule_id
            WHERE bs.enrollment_details_id = ?
              AND LOWER(bs.billing_type) = 'downpayment'
              $statusFilter
        ");
        $stmt->execute([$detailsId]);
        return floatval($stmt->fetchColumn() ?: 0);
    }

    private function getInitialEnrollmentScheduleIds($detailsId) {
        $stmt = $this->conn->prepare("
            SELECT billing_schedule_id
            FROM billing_schedule
            WHERE enrollment_details_id = ?
              AND LOWER(billing_type) IN ('registration fee', 'downpayment')
        ");
        $stmt->execute([$detailsId]);
        return array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
    }

    private function moveInitialEnrollmentPaymentsToBill($detailsId, $targetBillingId, $initialScheduleIds = []) {
        if (empty($initialScheduleIds)) {
            return;
        }

        $placeholders = implode(',', array_fill(0, count($initialScheduleIds), '?'));
        $params = array_merge([$targetBillingId], $initialScheduleIds);
        $stmtMovePayments = $this->conn->prepare("UPDATE payment SET billing_schedule_id = ? WHERE billing_schedule_id IN ($placeholders)");
        $stmtMovePayments->execute($params);

        $stmtPaid = $this->conn->prepare("SELECT COALESCE(SUM(amount_paid), 0) FROM payment WHERE billing_schedule_id = ?");
        $stmtPaid->execute([$targetBillingId]);
        $paidAmount = floatval($stmtPaid->fetchColumn() ?: 0);

        $stmtBill = $this->conn->prepare("SELECT total_amount FROM billing_schedule WHERE billing_schedule_id = ? LIMIT 1");
        $stmtBill->execute([$targetBillingId]);
        $billAmount = floatval($stmtBill->fetchColumn() ?: 0);
        $status = $paidAmount <= 0 ? 'unpaid' : ($paidAmount + 0.01 >= $billAmount ? 'paid' : 'partial');

        $stmtUpdate = $this->conn->prepare("UPDATE billing_schedule SET status = ? WHERE billing_schedule_id = ?");
        $stmtUpdate->execute([$status, $targetBillingId]);

        $deleteParams = array_merge([$detailsId], $initialScheduleIds);
        $stmtDeleteInitial = $this->conn->prepare("DELETE FROM billing_schedule WHERE enrollment_details_id = ? AND billing_schedule_id IN ($placeholders)");
        $stmtDeleteInitial->execute($deleteParams);
    }

    private function hasPendingPayment($detailsId) {
        if (!$this->columnExists('payment', 'payment_status')) {
            return false;
        }

        $stmt = $this->conn->prepare("
            SELECT COUNT(*)
            FROM payment p
            JOIN billing_schedule bs ON p.billing_schedule_id = bs.billing_schedule_id
            WHERE bs.enrollment_details_id = ?
              AND p.payment_status = 'Pending'
        ");
        $stmt->execute([$detailsId]);
        return intval($stmt->fetchColumn() ?: 0) > 0;
    }

    private function insertBillingRow($detailsId, $billingType, $amount, $dueDate, $status = 'unpaid') {
        $stmt = $this->conn->prepare("INSERT INTO billing_schedule (enrollment_details_id, billing_type, original_amount, penalty_amount, total_amount, status, due_date) VALUES (?, ?, ?, 0, ?, ?, ?)");
        $stmt->execute([$detailsId, $billingType, $amount, $amount, $status, $dueDate]);
        return $this->conn->lastInsertId();
    }

    private function generateRemainingBilling($detailsId, $program, $totalFee, $scheduleRows = [], $snapshot = null) {
        $snapshot = $snapshot ?: $this->getProgramFinancialSnapshot($program);
        $paidDownpayment = $this->getPaidDownpaymentAmount($detailsId);
        $programName = $program['name'] ?? '';
        $programTuition = floatval($program['tuition'] ?? 0);
        $programUnits = intval($program['total_units'] ?? 0);
        $today = date('Y-m-d');
        $initialScheduleIds = $this->getInitialEnrollmentScheduleIds($detailsId);

        $stmtDelete = $this->conn->prepare("DELETE FROM billing_schedule WHERE enrollment_details_id = ? AND LOWER(billing_type) NOT IN ('downpayment', 'registration fee')");
        $stmtDelete->execute([$detailsId]);

        if ($this->isPreschoolProgramName($programName)) {
            $monthlyAmount = $programTuition + floatval($snapshot['service_amount'] ?? 0);
            $numMonths = $programUnits > 0 ? $programUnits : 10;
            $startDate = date('Y-m-17', strtotime('first day of next month', strtotime($today)));

            $miscAmount = floatval($snapshot['misc_amount'] ?? 0);
            $registrationFee = floatval($snapshot['registration_fee'] ?? 0);

            $discountCredit = floatval($snapshot['discount_amount'] ?? 0);
            $monthOneBillingId = null;
            for ($month = 1; $month <= $numMonths; $month++) {
                $dueDate = date('Y-m-d', strtotime("+" . ($month - 1) . " months", strtotime($startDate)));
                $baseAmount = $monthlyAmount;
                if ($month === 1) {
                    $baseAmount += $miscAmount + $registrationFee;
                }
                $amountDue = max(0, $baseAmount - $discountCredit);
                $discountCredit = max(0, $discountCredit - $baseAmount);

                if ($amountDue > 0) {
                    $billingId = $this->insertBillingRow($detailsId, "Month " . $month, $amountDue, $dueDate);
                    if ($month === 1) {
                        $monthOneBillingId = $billingId;
                    }
                }
            }

            if ($monthOneBillingId && !empty($initialScheduleIds)) {
                $this->moveInitialEnrollmentPaymentsToBill($detailsId, $monthOneBillingId, $initialScheduleIds);
            }

            return floatval($snapshot['grand_total'] ?? (($monthlyAmount * $numMonths) + $miscAmount));
        }

        $remainingFee = max(0, floatval($snapshot['total_after_discount'] ?? $totalFee) - $paidDownpayment);
        $midtermAmount = $remainingFee * 0.5;
        $finalAmount = $remainingFee * 0.5;

        $sessionDates = [];
        if (!empty($scheduleRows)) {
            $sessionDates = array_values(array_filter(array_column($scheduleRows, 'date')));
        }

        if (!empty($sessionDates)) {
            $midtermDate = null;
            foreach ($sessionDates as $date) {
                if (date('l', strtotime($date)) === 'Thursday') {
                    $midtermDate = $date;
                    break;
                }
            }
            if (!$midtermDate) {
                $midtermDate = $sessionDates[floor(count($sessionDates) / 2) - 1] ?? end($sessionDates);
            }
            $finalDate = end($sessionDates);
        } else {
            $midtermDate = null;
            $finalDate = null;
        }

        if ($midtermAmount > 0) {
            $this->insertBillingRow($detailsId, 'Midterm', $midtermAmount, $midtermDate);
        }
        if ($finalAmount > 0) {
            $this->insertBillingRow($detailsId, 'Final', $finalAmount, $finalDate);
        }

        return $totalFee;
    }

    public function createPendingDownpaymentEnrollment($json) {
        $data = json_decode($json, true);

        try {
            $this->conn->beginTransaction();
            $uploadedScreenshot = $_FILES['payment_screenshot'] ?? null;

            if (isset($_SESSION['user_role']) && $_SESSION['user_role'] == 'student') {
                $studentId = intval($_SESSION['user_id']);
            } else {
                $studentId = isset($data['student_id']) ? intval($data['student_id']) : 0;
            }

            $programId = isset($data['program_id']) ? intval($data['program_id']) : 0;
            $amount = floatval($data['amount'] ?? 0);
            $methodId = isset($data['method']) ? intval($data['method']) : 0;
            $referenceNo = isset($data['ref']) && trim((string)$data['ref']) !== '' ? trim((string)$data['ref']) : null;
            $isNewStudent = !empty($data['is_new_student']);

            if ($studentId <= 0) {
                throw new Exception("Student is required before downpayment.");
            }
            if ($programId <= 0) {
                throw new Exception("Program is required before downpayment.");
            }
            if ($amount <= 0) {
                throw new Exception("Please enter a valid downpayment amount.");
            }
            if ($methodId <= 0) {
                throw new Exception("Payment method is required.");
            }

            $program = $this->getProgram($programId);
            $branchId = $_SESSION['branch_id'] ?? null;
            $requestedServiceId = !empty($data['include_service']) ? ($data['service_id'] ?? null) : null;
            $snapshot = $this->getProgramFinancialSnapshot($program, $isNewStudent, $requestedServiceId, $branchId);
            $employeeId = $this->getCurrentEnrollmentEmployeeId();
            $schoolYearId = $this->getActiveSchoolYearId($data['school_year_id'] ?? null);
            $totalFee = floatval($snapshot['grand_total']);
            $registrationFee = floatval($snapshot['registration_fee']);
            $configuredDownpayment = floatval($snapshot['downpayment_amount']);
            $expectedInitialPayment = $registrationFee + $configuredDownpayment;

            if ($expectedInitialPayment > 0 && abs($amount - $expectedInitialPayment) > 0.01) {
                throw new Exception("Payment must match the program's required registration fee and downpayment.");
            }

            $incompleteHeaderStatus = $this->getAllowedStatus('enrollment_header', 'incomplete', 'pending');
            $incompleteDetailsStatus = $this->getAllowedStatus('enrollment_details', 'incomplete', 'pending');

            $stmt = $this->conn->prepare("INSERT INTO enrollment_header (student_id, employee_id, branch_id, school_year_id, status, total_of_program, date_created) VALUES (?, ?, ?, ?, ?, ?, NOW())");
            $stmt->execute([$studentId, $employeeId, $branchId, $schoolYearId, $incompleteHeaderStatus, $totalFee]);
            $headerId = $this->conn->lastInsertId();

            $detailColumns = ['enrollment_header_id', 'program_id', 'status'];
            $detailPlaceholders = ['?', '?', '?'];
            $detailValues = [$headerId, $programId, $incompleteDetailsStatus];

            if ($this->columnExists('enrollment_details', 'grade_level_id')) {
                $detailColumns[] = 'grade_level_id';
                $detailPlaceholders[] = 'NULL';
            }
            if ($this->columnExists('enrollment_details', 'subject_id')) {
                $detailColumns[] = 'subject_id';
                $detailPlaceholders[] = 'NULL';
            }
            $this->addFinancialSnapshotColumns($detailColumns, $detailPlaceholders, $detailValues, $snapshot);

            $stmt = $this->conn->prepare("INSERT INTO enrollment_details (" . implode(", ", $detailColumns) . ") VALUES (" . implode(", ", $detailPlaceholders) . ")");
            $stmt->execute($detailValues);
            $detailsId = $this->conn->lastInsertId();
            ensureEnrollmentBundleOrdersForProgram($this->conn, (int)$detailsId, $programId, null, $employeeId);

            $paymentMethodName = $this->getPaymentMethodName($methodId);
            $paymentStatus = (strtolower($paymentMethodName) === 'cash') ? 'Received' : 'Pending';
            $billingStatus = $paymentStatus === 'Received' ? 'paid' : 'unpaid';
            $isStudentPayment = strtolower(trim((string)($_SESSION['user_role'] ?? ''))) === 'student';
            $isGcashPayment = stripos($paymentMethodName, 'gcash') !== false;

            if ($isGcashPayment && !$isStudentPayment && !$referenceNo) {
                throw new Exception("GCash reference number is required.");
            }

            if ($isGcashPayment && $isStudentPayment && (!$uploadedScreenshot || ($uploadedScreenshot['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE)) {
                throw new Exception("GCash payment screenshot is required.");
            }

            $balance = $totalFee;
            $paymentId = null;
            $receiptId = $this->generateReceiptId();
            $registrationBillingId = null;
            $firstPaymentId = null;
            $insertedPaymentIds = [];
            $storedScreenshotPath = null;
            if ($registrationFee > 0) {
                $registrationBillingId = $this->insertBillingRow($detailsId, 'Registration Fee', $registrationFee, date('Y-m-d'), $billingStatus);
                $balance = max($balance - $registrationFee, 0);
                $paymentId = $this->insertPaymentRecord($registrationBillingId, $methodId, $registrationFee, $referenceNo, $balance, $employeeId, $paymentStatus, 'Registration Fee', $receiptId);
                if ($firstPaymentId === null) {
                    $firstPaymentId = $paymentId;
                }
                if ($paymentId) {
                    $insertedPaymentIds[] = $paymentId;
                }
            }

            $billingId = null;
            if ($configuredDownpayment > 0) {
                $billingId = $this->insertBillingRow($detailsId, 'Downpayment', $configuredDownpayment, date('Y-m-d'), $billingStatus);
                $balance = max($balance - $configuredDownpayment, 0);
                $paymentId = $this->insertPaymentRecord($billingId, $methodId, $configuredDownpayment, $referenceNo, $balance, $employeeId, $paymentStatus, 'Downpayment', $receiptId);
                if ($firstPaymentId === null) {
                    $firstPaymentId = $paymentId;
                }
                if ($paymentId) {
                    $insertedPaymentIds[] = $paymentId;
                }
            }

            if ($uploadedScreenshot && ($uploadedScreenshot['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
                $storedScreenshotPath = $this->storePaymentScreenshot($uploadedScreenshot, $receiptId, $firstPaymentId);
                if ($storedScreenshotPath && $this->columnExists('payment', 'proof_pic') && !empty($insertedPaymentIds)) {
                    $placeholders = implode(', ', array_fill(0, count($insertedPaymentIds), '?'));
                    $sqlUpdateProof = "UPDATE payment SET proof_pic = ? WHERE payment_id IN ($placeholders)";
                    $stmtUpdateProof = $this->conn->prepare($sqlUpdateProof);
                    $stmtUpdateProof->execute(array_merge([$storedScreenshotPath], $insertedPaymentIds));
                }
            }

            $stmtStudent = $this->conn->prepare("SELECT TRIM(CONCAT_WS(' ', first_name, last_name, NULLIF(TRIM(ext), ''))) AS student_name FROM student WHERE student_id = ? LIMIT 1");
            $stmtStudent->execute([$studentId]);
            $studentName = $stmtStudent->fetchColumn() ?: 'Student';

            if ($paymentStatus === 'Pending') {
                $reference = $referenceNo ? " Reference: {$referenceNo}." : '';
                $this->notifications->notifyRole(
                    'auditor',
                    'Online Downpayment Awaiting Review',
                    "{$studentName} submitted an online initial payment of PHP " . number_format($amount, 2) . " for {$program['name']}.{$reference} Please review the payment."
                );
            }

            $this->conn->commit();

            echo json_encode([
                "status" => "success",
                "message" => "Downpayment submitted and pending admin approval. You may now continue the enrollment details.",
                "enrollment_id" => $detailsId,
                "enrollment_header_id" => $headerId,
                "billing_schedule_id" => $billingId,
                "registration_billing_schedule_id" => $registrationBillingId,
                "payment_id" => $paymentId,
                "student_name" => $studentName,
                "program_id" => $programId,
                "program_name" => $program['name'],
                "program_type" => $program['type_name'] ?? null,
                "program_display_name" => $this->getProgramDisplayName($program),
                "amount_paid" => $amount,
                "registration_fee" => $registrationFee,
                "downpayment_amount" => $configuredDownpayment,
                "discount_amount" => floatval($snapshot['discount_amount']),
                "balance" => $balance,
                "payment_method" => $this->getPaymentMethodName($methodId),
                "payment_status" => $paymentStatus,
                "reference_no" => $referenceNo,
                "receipt_id" => $receiptId,
                "payment_screenshot_path" => $storedScreenshotPath
            ]);
        } catch (Exception $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    public function completePendingEnrollment($json) {
        $data = json_decode($json, true);

        try {
            $enrolledByEmployeeId = $this->getCurrentEnrollmentEmployeeId();
            $this->conn->beginTransaction();

            $detailsId = isset($data['pending_enrollment_id']) ? intval($data['pending_enrollment_id']) : 0;
            if ($detailsId <= 0) {
                throw new Exception("Pending enrollment ID is required.");
            }
            $this->assertEnrollmentAccessibleToCurrentUser($detailsId);

            $stmtExisting = $this->conn->prepare("SELECT ed.enrollment_header_id, eh.student_id, eh.branch_id FROM enrollment_details ed JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id WHERE ed.enrollment_details_id = ? LIMIT 1");
            $stmtExisting->execute([$detailsId]);
            $existing = $stmtExisting->fetch(PDO::FETCH_ASSOC);
            if (!$existing) {
                throw new Exception("Pending enrollment was not found.");
            }

            $programId = isset($data['program_id']) && $data['program_id'] !== null ? intval($data['program_id']) : 0;
            if ($programId <= 0) {
                throw new Exception("Program is required to complete enrollment.");
            }

            $subjectIds = $this->normalizeSubjectIds($data);
            $isTutorialEnrollment = ($data['enrollment_category'] ?? 'tutorial') !== 'preschool';
            if ($isTutorialEnrollment && empty($subjectIds)) {
                throw new Exception("At least one subject is required to complete enrollment.");
            }
            if ($isTutorialEnrollment) {
                $this->assertActiveGradeLevel($data['grade_level_id'] ?? null);
            }

            $program = $this->getProgram($programId);
            $includeRegistrationFee = !empty($data['is_new_student']);
            if ($this->columnExists('enrollment_details', 'registration_fee')) {
                $stmtSnapshotRegistration = $this->conn->prepare("SELECT registration_fee FROM enrollment_details WHERE enrollment_details_id = ? LIMIT 1");
                $stmtSnapshotRegistration->execute([$detailsId]);
                $includeRegistrationFee = floatval($stmtSnapshotRegistration->fetchColumn() ?: 0) > 0;
            }
            $requestedServiceId = !empty($data['include_service']) ? ($data['service_id'] ?? null) : null;
            $branchId = $this->getEnrollmentBranchId($data, $existing['branch_id'] ?? ($_SESSION['branch_id'] ?? null));
            $snapshot = $this->getProgramFinancialSnapshot($program, $includeRegistrationFee, $requestedServiceId, $branchId);
            $totalFee = floatval($snapshot['grand_total']);
            $schoolYearId = $this->getActiveSchoolYearId($data['school_year_id'] ?? null);
            $headerId = intval($existing['enrollment_header_id']);

            $sectionId = isset($data['section_id']) && $data['section_id'] !== '' ? $data['section_id'] : null;
            $classId = isset($data['class_id']) && $data['class_id'] !== '' ? $data['class_id'] : null;
            if (!$classId && $sectionId) {
                $sectionStmt = $this->conn->prepare("SELECT class_id FROM sections WHERE section_id = ? LIMIT 1");
                $sectionStmt->execute([$sectionId]);
                $sectionRow = $sectionStmt->fetch(PDO::FETCH_ASSOC);
                if ($sectionRow) {
                    $classId = $sectionRow['class_id'];
                }
            }

            $preferredTimeDay = $data['preferred_time_day'] ?? null;
            if (empty($preferredTimeDay) && isset($data['preferences']) && is_array($data['preferences'])) {
                $parts = [];
                foreach ($data['preferences'] as $pref) {
                    $day = $pref['day'] ?? '';
                    $start = $pref['time'] ?? '';
                    $end = $pref['endTime'] ?? $pref['end_time'] ?? '';
                    if ($day && $start) {
                        $parts[] = trim($day . ' ' . $start . ($end ? ' - ' . $end : ''));
                    }
                }
                $preferredTimeDay = !empty($parts) ? implode(', ', $parts) : null;
            }

            $hasPendingPayment = $this->hasPendingPayment($detailsId);
            $completedDetailsStatus = $hasPendingPayment
                ? $this->getAllowedStatus('enrollment_details', 'pending', 'pending')
                : $this->getAllowedStatus('enrollment_details', 'enrolled', 'pending');
            $completedHeaderStatus = $hasPendingPayment
                ? $this->getAllowedStatus('enrollment_header', 'pending', 'pending')
                : $this->getAllowedStatus('enrollment_header', 'enrolled', 'pending');

            $updateFields = [
                "program_id = ?",
                "grade_level_id = ?",
                "subject_id = ?",
                "goal = ?",
                "preferred_time_day = ?",
                "preferred_teacher = ?",
                "status = ?"
            ];
            $updateValues = [
                $programId,
                $data['grade_level_id'] ?? null,
                $subjectIds[0] ?? null,
                $data['goal'] ?? null,
                $preferredTimeDay,
                $data['preferred_teacher'] ?? null,
                $completedDetailsStatus
            ];

            if ($this->columnExists('enrollment_details', 'class_id')) {
                $updateFields[] = "class_id = ?";
                $updateValues[] = $classId;
            }

            if ($this->columnExists('enrollment_details', 'section_id')) {
                $updateFields[] = "section_id = ?";
                $updateValues[] = $sectionId;
            }

            if ($this->columnExists('enrollment_details', 'health_note')) {
                $updateFields[] = "health_note = ?";
                $updateValues[] = isset($data['health_note']) && trim((string)$data['health_note']) !== "" ? trim((string)$data['health_note']) : null;
            }

            $snapshotColumns = [];
            $snapshotPlaceholders = [];
            $snapshotValues = [];
            $this->addFinancialSnapshotColumns($snapshotColumns, $snapshotPlaceholders, $snapshotValues, $snapshot);
            foreach ($snapshotColumns as $index => $column) {
                $updateFields[] = "$column = ?";
                $updateValues[] = $snapshotValues[$index];
            }

            $updateValues[] = $detailsId;
            $stmtUpdateDetails = $this->conn->prepare("UPDATE enrollment_details SET " . implode(", ", $updateFields) . " WHERE enrollment_details_id = ?");
            $stmtUpdateDetails->execute($updateValues);
            $this->saveEnrollmentSubjects($detailsId, $subjectIds);
            ensureEnrollmentBundleOrdersForProgram($this->conn, $detailsId, $programId, null, (int)($_SESSION['employee_id'] ?? 0) ?: null);

            if ($this->columnExists('student', 'health_note') && isset($data['health_note']) && trim((string)$data['health_note']) !== "") {
                $stmtHealth = $this->conn->prepare("UPDATE student SET health_note = ? WHERE student_id = ?");
                $stmtHealth->execute([trim((string)$data['health_note']), $existing['student_id']]);
            }

            $this->updateStudentAddressFromEnrollmentData($existing['student_id'], $data);

            $stmtDeleteSchedules = $this->conn->prepare("DELETE FROM enrollment_preferred_schedule WHERE enrollment_details_id = ?");
            $stmtDeleteSchedules->execute([$detailsId]);

            $scheduleRows = [];
            $programUnits = intval($program['total_units'] ?? 0);
            $unitType = $program['unit_type'] ?? '';
            $isUnitTutorial = ($unitType === 'session' && $programUnits > 0);

            if (isset($data['preferences']) && is_array($data['preferences'])) {
                if ($isUnitTutorial) {
                    $scheduleRows = $this->buildSessionScheduleRows($data['preferences'], $programUnits);
                } else {
                    foreach ($data['preferences'] as $pref) {
                        if (empty($pref['day']) || empty($pref['time'])) {
                            continue;
                        }
                        $scheduleRows[] = [
                            'day' => $this->normalizeDayName($pref['day']),
                            'start_time' => $pref['time'],
                            'end_time' => $pref['endTime'] ?? $pref['end_time'] ?? null,
                            'date' => $pref['date'] ?? $this->getNextOrSameDate($pref['day'])
                        ];
                    }
                }

                $this->insertEnrollmentPreferredScheduleRows($detailsId, $scheduleRows);
            }

            $actualTotal = $this->generateRemainingBilling($detailsId, $program, $totalFee, $scheduleRows, $snapshot);

            $stmtUpdateHeader = $this->conn->prepare("UPDATE enrollment_header SET employee_id = COALESCE(?, employee_id), branch_id = ?, school_year_id = ?, total_of_program = ?, status = ? WHERE enrollment_header_id = ?");
            $stmtUpdateHeader->execute([$enrolledByEmployeeId, $branchId, $schoolYearId, $actualTotal, $completedHeaderStatus, $headerId]);

            $this->conn->commit();

            echo json_encode([
                "status" => "success",
                "message" => "Enrollment completed from saved downpayment.",
                "enrollment_id" => $detailsId,
                "enrollment_status" => $completedHeaderStatus
            ]);
        } catch (Exception $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }



    // --- STEP 2: ADD ENROLLMENT & GENERATE BILLING ---
    public function addEnrollment($json) {
        $data = json_decode($json, true);
        
        foreach ($data as $key => $value) {
            if ($value === "" && $key !== 'preferences') $data[$key] = null;
        }

        try {
            $this->conn->beginTransaction();

            if (isset($_SESSION['user_role']) && $_SESSION['user_role'] == 'student') {
                $student_id = $_SESSION['user_id'];
            } else {
                $student_id = isset($data['student_id']) ? trim($data['student_id']) : null;
            }

            if ($student_id !== null && is_numeric($student_id)) {
                $student_id = intval($student_id);
            }

            if (empty($student_id) || $student_id <= 0) {
                throw new Exception("Student ID is required to create an enrollment. Please select or create a student before proceeding.");
            }

            $employee_id = $this->getCurrentEnrollmentEmployeeId();
            $branch_id = $this->getEnrollmentBranchId($data, $_SESSION['branch_id'] ?? null);
            $program = $this->getProgram($data['program_id'] ?? 0);
            $requestedServiceId = !empty($data['include_service']) ? ($data['service_id'] ?? null) : null;
            $snapshot = $this->getProgramFinancialSnapshot($program, !empty($data['is_new_student']), $requestedServiceId, $branch_id);
            $total_fee = floatval($snapshot['grand_total']);
            $school_year_id = isset($data['school_year_id']) && is_numeric($data['school_year_id']) ? intval($data['school_year_id']) : null;
            $subjectIds = $this->normalizeSubjectIds($data);
            $isTutorialEnrollment = ($data['enrollment_category'] ?? 'tutorial') !== 'preschool';

            if ($isTutorialEnrollment && empty($subjectIds)) {
                throw new Exception("At least one subject is required to create an enrollment.");
            }
            if ($isTutorialEnrollment) {
                $this->assertActiveGradeLevel($data['grade_level_id'] ?? null);
            }

            if (empty($school_year_id)) {
                $activeSchoolYear = $this->conn->query("SELECT school_year_id FROM school_years WHERE sy_status = 'active' LIMIT 1")->fetch(PDO::FETCH_ASSOC);
                if ($activeSchoolYear && !empty($activeSchoolYear['school_year_id'])) {
                    $school_year_id = intval($activeSchoolYear['school_year_id']);
                } else {
                    throw new Exception("Active school year not found. Please activate a school year before creating enrollments.");
                }
            }

            // 1. Insert Header
            $stmt = $this->conn->prepare("INSERT INTO enrollment_header (student_id, employee_id, branch_id, school_year_id, status, total_of_program, date_created) VALUES (:sid, :eid, :bid, :sy, 'pending', :total, NOW())");
            $stmt->execute([":sid" => $student_id, ":eid" => $employee_id, ":bid" => $branch_id, ":sy" => $school_year_id, ":total" => $total_fee]);
            $header_id = $this->conn->lastInsertId();

            // 2. Insert Details
            $class_id = $data['class_id'] ?? null;
            $section_id = $data['section_id'] ?? null;

            // If section is provided and class is not, resolve class from section
            if (!$class_id && $section_id) {
                $sectionStmt = $this->conn->prepare("SELECT class_id FROM sections WHERE section_id = ? LIMIT 1");
                $sectionStmt->execute([$section_id]);
                $secRow = $sectionStmt->fetch(PDO::FETCH_ASSOC);
                if ($secRow) {
                    $class_id = $secRow['class_id'];
                }
            }

            // check if enrollment_details has section_id and health_note columns in this schema
            $hasSectionId = false;
            $checkSectionStmt = $this->conn->prepare("SHOW COLUMNS FROM enrollment_details LIKE 'section_id'");
            $checkSectionStmt->execute();
            if ($checkSectionStmt->fetch()) {
                $hasSectionId = true;
            }

            $hasHealthNote = false;
            $checkHealthStmt = $this->conn->prepare("SHOW COLUMNS FROM enrollment_details LIKE 'health_note'");
            $checkHealthStmt->execute();
            if ($checkHealthStmt->fetch()) {
                $hasHealthNote = true;
            }

            $hasStudentHealthNote = false;
            $checkStudentHealthStmt = $this->conn->prepare("SHOW COLUMNS FROM student LIKE 'health_note'");
            $checkStudentHealthStmt->execute();
            if ($checkStudentHealthStmt->fetch()) {
                $hasStudentHealthNote = true;
            }

            $preferred_time_day = $data['preferred_time_day'] ?? null;
            if (empty($preferred_time_day) && isset($data['preferences']) && is_array($data['preferences'])) {
                $parts = [];
                foreach ($data['preferences'] as $pref) {
                    $day = $pref['day'] ?? '';
                    $start = $pref['time'] ?? '';
                    $end = $pref['endTime'] ?? $pref['end_time'] ?? '';
                    if ($day && $start) {
                        $parts[] = trim($day . ' ' . $start . ($end ? ' - ' . $end : ''));
                    }
                }
                $preferred_time_day = !empty($parts) ? implode(', ', $parts) : null;
            }

            $detailColumns = ['enrollment_header_id', 'program_id', 'grade_level_id', 'subject_id', 'goal', 'preferred_time_day', 'preferred_teacher', 'status'];
            $detailPlaceholders = ['?', '?', '?', '?', '?', '?', '?', "'pending'"];
            $detailValues = [
                $header_id,
                $data['program_id'],
                $data['grade_level_id'],
                $subjectIds[0] ?? null,
                $data['goal'] ?? null,
                $preferred_time_day,
                $data['preferred_teacher'] ?? null
            ];

            if ($hasSectionId) {
                $detailColumns[] = 'section_id';
                $detailPlaceholders[] = '?';
                $detailValues[] = $section_id;
            }

            if ($hasHealthNote) {
                $detailColumns[] = 'health_note';
                $detailPlaceholders[] = '?';
                $detailValues[] = isset($data['health_note']) && trim((string)$data['health_note']) !== "" ? trim((string)$data['health_note']) : null;
            }

            $this->addFinancialSnapshotColumns($detailColumns, $detailPlaceholders, $detailValues, $snapshot);

            $stmt = $this->conn->prepare("INSERT INTO enrollment_details (" . implode(", ", $detailColumns) . ") VALUES (" . implode(", ", $detailPlaceholders) . ")");
            $stmt->execute($detailValues);
            $details_id = $this->conn->lastInsertId();
            $this->saveEnrollmentSubjects($details_id, $subjectIds);
            ensureEnrollmentBundleOrdersForProgram($this->conn, (int)$details_id, (int)$data['program_id'], null, (int)$employee_id);

            if ($hasStudentHealthNote && isset($data['health_note']) && trim((string)$data['health_note']) !== "") {
                $healthNote = trim((string)$data['health_note']);
                $studentHealthStmt = $this->conn->prepare("UPDATE student SET health_note = ? WHERE student_id = ?");
                $studentHealthStmt->execute([$healthNote, $student_id]);
            }

            $this->updateStudentAddressFromEnrollmentData($student_id, $data);

            // 3. Insert Schedule and store exact session dates
            $scheduleRows = [];
            $program_name = $program['name'] ?? '';
            $program_tuition = floatval($program['tuition'] ?? 0);
            $program_units = intval($program['total_units'] ?? 0);
            $unit_type = $program['unit_type'] ?? '';

            $downpayment_details = $data['downpayment_details'] ?? null; // Get downpayment details from payload
            $isUnitTutorial = ($unit_type === 'session' && $program_units > 0);

            if (isset($data['preferences']) && is_array($data['preferences'])) {
                if ($isUnitTutorial && $program_units > 0) {
                    $scheduleRows = $this->buildSessionScheduleRows($data['preferences'], $program_units);
                } else {
                    foreach ($data['preferences'] as $pref) {
                        if (empty($pref['day']) || empty($pref['time'])) {
                            continue;
                        }
                        $scheduleRows[] = [
                            'day' => $this->normalizeDayName($pref['day']),
                            'start_time' => $pref['time'],
                            'end_time' => $pref['endTime'] ?? $pref['end_time'] ?? null,
                            'date' => $pref['date'] ?? $this->getNextOrSameDate($pref['day'])
                        ];
                    }
                }

                $this->insertEnrollmentPreferredScheduleRows($details_id, $scheduleRows);
            }

            // 4. GENERATE BILLING SCHEDULE (Updated for units)
            $isPreschool = (
                stripos($program_name, 'preschool') !== false ||
                stripos($program_name, 'playschool') !== false ||
                stripos($program_name, 'play school') !== false ||
                stripos($program_name, 'pre-school') !== false ||
                stripos($program_name, 'pre school') !== false
            );

            $today = date('Y-m-d');
            $registrationFee = floatval($snapshot['registration_fee']);
            if (!$isPreschool && $registrationFee > 0) {
                $this->insertBillingRow($details_id, 'Registration Fee', $registrationFee, $today);
            }

            if ($isPreschool) {
                // PRESCHOOL: Monthly payments based on program units (assuming unit_type='month')
                // Tuition is per unit/month, total_units is number of months
                $monthly_amount = $program_tuition + floatval($snapshot['service_amount'] ?? 0); // Tuition plus selected monthly service
                $num_months = $program_units > 0 ? $program_units : 10; // Default to 10 if not set
                $today = date('Y-m-d');
                $misc_amount = floatval($snapshot['misc_amount']);
                $credit = floatval($snapshot['discount_amount']);

                // Always start from 17th of next month
                $start_date = date('Y-m-d', strtotime('first day of next month', strtotime($today)));
                $start_date = date('Y-m-17', strtotime($start_date));

                for ($month = 1; $month <= $num_months; $month++) {
                    $billing_type = "Month " . $month;
                    $due_date = date('Y-m-d', strtotime("+" . ($month - 1) . " months", strtotime($start_date)));
                    $baseAmount = $monthly_amount;
                    if ($month === 1) {
                        $baseAmount += $misc_amount + $registrationFee;
                    }
                    $amountDue = max(0, $baseAmount - $credit);
                    $credit = max(0, $credit - $baseAmount);
                    if ($amountDue > 0) {
                        $this->insertBillingRow($details_id, $billing_type, $amountDue, $due_date);
                    }
                }

                $actual_total = floatval($snapshot['grand_total']);
                $updateStmt = $this->conn->prepare("UPDATE enrollment_header SET total_of_program = ? WHERE enrollment_header_id = ?");
                $updateStmt->execute([$actual_total, $header_id]);
            } else {
                // Always Down/Mid/Final structure
                $downpayment = floatval($snapshot['downpayment_amount']);
                $remaining_fee = max(0, floatval($snapshot['total_after_discount']) - $downpayment);
                $midterm_amount = $remaining_fee * 0.5;
                $final_amount = $remaining_fee * 0.5;

                // Generate session dates using the stored schedule rows when available
                $session_dates = [];
                if (!empty($scheduleRows)) {
                    $session_dates = array_column($scheduleRows, 'date');
                }

                if (empty($session_dates)) {
                    $schedules = $this->conn->prepare("
                        SELECT DISTINCT day FROM enrollment_preferred_schedule eps 
                        WHERE enrollment_details_id = ?
                        ORDER BY FIELD(day, 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')
                    ");
                    $schedules->execute([$details_id]);
                    $days = $schedules->fetchAll(PDO::FETCH_COLUMN);
                    $total_sessions = $program_units;

                    if (count($days) > 0 && $total_sessions > 0) {
                        $current_date = $this->getNextOrSameDate($days[0]);
                        $session_dates = [$current_date];
                        for ($i = 1; $i < $total_sessions; $i++) {
                            $next_day_index = $i % count($days);
                            $next_day = $days[$next_day_index];
                            $session_dates[] = $this->getNextDateForDay($session_dates[$i - 1], $next_day);
                        }
                    }
                }

                if (!empty($session_dates)) {
                    $downpayment_date = $session_dates[0];
                    $midterm_date = null;
                    foreach ($session_dates as $date) {
                        if (date('l', strtotime($date)) === 'Thursday') {
                            $midterm_date = $date;
                            break;
                        }
                    }
                    if (!$midterm_date) {
                        $midterm_date = $session_dates[floor(count($session_dates) / 2) - 1] ?? end($session_dates);
                    }
                    // Final payment is always on the last session date
                    $final_date = end($session_dates);
                } else {
                    $downpayment_date = $today;
                    $midterm_date = null;
                    $final_date = null;
                }

                if ($downpayment > 0) {
                    $this->insertBillingRow($details_id, 'Downpayment', $downpayment, $downpayment_date);
                }
                if ($midterm_amount > 0) {
                    $this->insertBillingRow($details_id, 'Midterm', $midterm_amount, $midterm_date);
                }
                if ($final_amount > 0) {
                    $this->insertBillingRow($details_id, 'Final', $final_amount, $final_date);
                }
            }

            // Process downpayment if provided (for both preschool and non-preschool)
            if (isset($data['downpayment_details']) && !empty($data['downpayment_details'])) {
                $downpayment_amount = floatval($data['downpayment_details']['amount'] ?? 0);
                $payment_method_id = intval($data['downpayment_details']['method'] ?? 1);
                $reference_no = $data['downpayment_details']['ref'] ?? null;

                if ($downpayment_amount > 0) {
                    // Apply downpayment to unpaid bills in order (Month 1, Misc, etc. for preschool; Downpayment for others)
                    $sqlFindBills = "SELECT bs.billing_schedule_id, bs.total_amount, COALESCE(SUM(p.amount_paid), 0) as total_paid
                                    FROM billing_schedule bs
                                    LEFT JOIN payment p ON bs.billing_schedule_id = p.billing_schedule_id
                                    WHERE bs.enrollment_details_id = ? AND bs.status IN ('unpaid', 'partial')
                                    GROUP BY bs.billing_schedule_id, bs.total_amount, bs.due_date, bs.billing_type
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
                    $stmtFind->execute([$details_id]);
                    $unpaid_bills = $stmtFind->fetchAll(PDO::FETCH_ASSOC);

                    $remaining_payment = $downpayment_amount;
                    $overall_payment_balance = $total_fee;
                    $receiptId = $this->generateReceiptId();

                    foreach ($unpaid_bills as $bill) {
                        if ($remaining_payment <= 0) break;

                        $billing_id = $bill['billing_schedule_id'];
                        $amount_due = $bill['total_amount'] - $bill['total_paid'];
                        $payment_for_this_bill = min($remaining_payment, $amount_due);

                        if ($payment_for_this_bill > 0) {
                            $new_status = ($payment_for_this_bill >= $amount_due) ? 'paid' : 'partial';

                            // Update billing_schedule status; paid amounts are computed from payment rows.
                            $stmtUpdateBill = $this->conn->prepare("UPDATE billing_schedule SET status = ? WHERE billing_schedule_id = ?");
                            $stmtUpdateBill->execute([$new_status, $billing_id]);

                            // Insert into payment table using the current schema columns.
                            $overall_payment_balance = max(0, $overall_payment_balance - $payment_for_this_bill);
                            $this->insertPaymentRecord($billing_id, $payment_method_id, $payment_for_this_bill, $reference_no, $overall_payment_balance, $employee_id, 'Received', 'Downpayment', $receiptId);

                            $remaining_payment -= $payment_for_this_bill;
                        }
                    }
                }
            }

            $this->conn->commit();
            
            echo json_encode([
                "status" => "success", 
                "message" => "Enrollment finalized with schedule units logic. Billing generated.",
                "enrollment_id" => $details_id
            ]);

        } catch (Exception $e) {
            $this->conn->rollBack();
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    // ... (Keep existing GET functions: getEnrollmentStats, getEnrollments, getEnrollmentDetails, getLookups, searchStudents, deleteEnrollment) ...
    // Note: Ensure getEnrollmentDetails and getEnrollments are the FIXED versions from previous steps (no duplicates).
    
    // --- GET STATS ---
    public function getEnrollmentStats() {
        try {
            $type = isset($_GET['type']) ? $_GET['type'] : null;
            $includeApplications = !empty($_GET['include_applications']) && in_array($type, ['tutorial', 'preschool'], true);
            $branchId = $this->getBranchAdminBranchId();
            $conditions = [$this->getProgramTypeCondition($type)];
            $params = [];
            if ($branchId) {
                $conditions[] = "eh.branch_id = :branch_id";
                $params[':branch_id'] = $branchId;
            }

            $baseSql = " FROM enrollment_details ed
                         INNER JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                         INNER JOIN program p ON ed.program_id = p.program_id
                         WHERE " . implode(" AND ", $conditions);
            $statusExpression = "COALESCE(NULLIF(eh.status, ''), ed.status)";
            $getCount = function($extraCondition = "") use ($baseSql, $params) {
                $stmt = $this->conn->prepare("SELECT COUNT(*)" . $baseSql . $extraCondition);
                $stmt->execute($params);
                return intval($stmt->fetchColumn() ?: 0);
            };

            $total = $getCount();
            $pending = $getCount(" AND $statusExpression = 'pending'");
            $incomplete = $getCount(" AND $statusExpression = 'incomplete'");
            $cancelled = $getCount(" AND $statusExpression = 'cancelled'");
            $new = $getCount(" AND eh.date_created >= DATE_SUB(NOW(), INTERVAL 30 DAY)");
            if ($includeApplications) {
                $applicationConditions = [
                    "ea.enrollment_details_id IS NULL",
                    "ea.status IN ('pending_review', 'approved_for_payment')",
                    $this->getProgramTypeCondition($type)
                ];
                $applicationParams = [];
                if ($branchId) {
                    $applicationConditions[] = 'ea.branch_id = :application_branch_id';
                    $applicationParams[':application_branch_id'] = $branchId;
                }
                $applicationBase = " FROM enrollment_applications ea JOIN program p ON ea.program_id = p.program_id WHERE " . implode(' AND ', $applicationConditions);
                $applicationCount = function($extraCondition = '') use ($applicationBase, $applicationParams) {
                    $stmt = $this->conn->prepare('SELECT COUNT(*)' . $applicationBase . $extraCondition);
                    $stmt->execute($applicationParams);
                    return intval($stmt->fetchColumn() ?: 0);
                };
                $activeApplications = $applicationCount();
                $total += $activeApplications;
                $pending += $activeApplications;
                $new += $applicationCount(' AND ea.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)');

                $readyConditions = [
                    "ea.enrollment_details_id IS NOT NULL",
                    "ea.status = 'ready_for_scheduling'",
                    $this->getProgramTypeCondition($type)
                ];
                $readyParams = [];
                if ($branchId) {
                    $readyConditions[] = 'ea.branch_id = :ready_branch_id';
                    $readyParams[':ready_branch_id'] = $branchId;
                }
                $readyStmt = $this->conn->prepare("SELECT COUNT(*) FROM enrollment_applications ea JOIN program p ON ea.program_id = p.program_id WHERE " . implode(' AND ', $readyConditions));
                $readyStmt->execute($readyParams);
                $readyApplications = intval($readyStmt->fetchColumn() ?: 0);
                $pending += $readyApplications;
                $incomplete = max(0, $incomplete - $readyApplications);
            }
            echo json_encode(["status" => "success", "data" => ["total" => $total, "new" => $new, "pending" => $pending, "incomplete" => $incomplete, "cancelled" => $cancelled]]);
        } catch (Exception $e) { echo json_encode(["status" => "error", "message" => $e->getMessage()]); }
    }

    // --- GET RELEASE STUDENTS ---
    public function getReleaseStudents() {
        try {
            $search = isset($_GET['search']) ? trim($_GET['search']) : '';
            $type = isset($_GET['type']) ? $_GET['type'] : null;
            $branchId = $this->getBranchAdminBranchId();

            $where = "WHERE COALESCE(NULLIF(eh.status, ''), ed.status) IN ('enrolled', 'pending', 'approved', 'active')";
            if ($search !== '') {
                $where .= " AND (st.student_id_number LIKE :search OR TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) LIKE :search OR p.name LIKE :search)";
            }

            $where .= " AND " . $this->getProgramTypeCondition($type);
            if ($branchId) {
                $where .= " AND eh.branch_id = :branch_id";
            }

            $sql = "SELECT ed.enrollment_details_id, st.student_id, st.student_id_number, TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name, p.program_id, p.name AS program_name, DATE_FORMAT(eh.date_created, '%Y-%m-%d') AS enrollment_date, COALESCE(NULLIF(eh.status, ''), ed.status) AS status " .
                "FROM enrollment_details ed " .
                "JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id " .
                "JOIN student st ON eh.student_id = st.student_id " .
                "JOIN program p ON ed.program_id = p.program_id " .
                "$where " .
                "ORDER BY eh.date_created DESC";

            $stmt = $this->conn->prepare($sql);
            if ($search !== '') {
                $searchParam = "%$search%";
                $stmt->bindParam(':search', $searchParam);
            }
            if ($branchId) {
                $stmt->bindValue(':branch_id', $branchId, PDO::PARAM_INT);
            }
            $stmt->execute();
            $data = $stmt->fetchAll(PDO::FETCH_ASSOC);

            echo json_encode(["status" => "success", "data" => $data]);
        } catch (Exception $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    // --- GET LIST ---
    public function getEnrollments() {
        try {
            $page = isset($_GET['page']) ? (int)$_GET['page'] : 1;
            $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 10;
            $offset = ($page - 1) * $limit;
            $type = isset($_GET['type']) ? $_GET['type'] : null;
            $includeApplications = !empty($_GET['include_applications']) && in_array($type, ['tutorial', 'preschool'], true);
            $summaryFilter = isset($_GET['summary_filter']) ? strtolower(trim($_GET['summary_filter'])) : 'total';
            $search = isset($_GET['search']) ? trim($_GET['search']) : '';
            $status = isset($_GET['status']) ? trim($_GET['status']) : '';
            $applicationStatusMap = [
                'application_pending_review' => 'pending_review',
                'application_approved_for_payment' => 'approved_for_payment',
                'application_ready_for_scheduling' => 'ready_for_scheduling',
                'application_enrolled' => 'enrolled',
                'application_rejected' => 'rejected',
                'application_cancelled' => 'cancelled'
            ];
            $applicationStatus = $applicationStatusMap[strtolower($status)] ?? null;
            if ($status === 'pending_application') {
                $status = 'pending';
            }
            $subject = isset($_GET['subject']) ? trim($_GET['subject']) : '';
            $enrollmentDate = isset($_GET['enrollment_date']) ? trim($_GET['enrollment_date']) : '';
            $sessionBranchId = $this->getBranchAdminBranchId();
            $requestedBranchId = isset($_GET['branch_id']) ? intval($_GET['branch_id']) : 0;
            $branchId = $sessionBranchId ?: ($requestedBranchId > 0 ? $requestedBranchId : null);

            // Build WHERE clause for filtering
            $whereClause = " AND " . $this->getProgramTypeCondition($type);
            $statusExpression = "COALESCE(NULLIF(eh.status, ''), ed.status)";
            $subjectExpression = "COALESCE(esub.subject_names, sub.subject_name)";

            if ($summaryFilter === 'new') {
                $whereClause .= " AND eh.date_created >= DATE_SUB(NOW(), INTERVAL 30 DAY)";
            } elseif ($summaryFilter === 'pending') {
                $whereClause .= $includeApplications
                    ? " AND ($statusExpression = 'pending' OR ea.status IN ('pending_review', 'approved_for_payment', 'ready_for_scheduling'))"
                    : " AND $statusExpression = 'pending'";
            } elseif ($summaryFilter === 'incomplete') {
                $whereClause .= $includeApplications
                    ? " AND $statusExpression = 'incomplete' AND (ea.application_id IS NULL OR ea.status = 'enrolled')"
                    : " AND $statusExpression = 'incomplete'";
            }

            if ($applicationStatus !== null) {
                $whereClause .= $includeApplications
                    ? ' AND ea.status = :application_status'
                    : ' AND 1=0';
            } elseif (strtolower($status) === 'pending') {
                $whereClause .= $includeApplications
                    ? " AND ($statusExpression = 'pending' OR ea.status IN ('pending_review', 'approved_for_payment', 'ready_for_scheduling'))"
                    : " AND LOWER($statusExpression) = 'pending'";
            } elseif ($status !== '') {
                $whereClause .= " AND LOWER($statusExpression) = LOWER(:status)";
            }
            if ($search !== '') {
                $whereClause .= " AND (st.student_id_number LIKE :search OR TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) LIKE :search OR p.name LIKE :search OR $subjectExpression LIKE :search OR CONCAT(e.first_name, ' ', e.last_name) LIKE :search OR COALESCE(b.branch_name, '') LIKE :search)";
            }
            if ($subject !== '') {
                $whereClause .= " AND $subjectExpression LIKE :subject";
            }
            if ($enrollmentDate !== '') {
                $whereClause .= " AND DATE(eh.date_created) = :enrollment_date";
            }
            if ($branchId) {
                $whereClause .= " AND eh.branch_id = :branch_id";
            }

            // Get total count
            $countSql = "SELECT COUNT(*) FROM enrollment_details ed " .
                "JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id " .
                "JOIN student st ON eh.student_id = st.student_id " .
                "LEFT JOIN subject sub ON ed.subject_id = sub.subject_id " .
                "LEFT JOIN (SELECT es.enrollment_details_id, GROUP_CONCAT(s.subject_name ORDER BY s.subject_name SEPARATOR ', ') AS subject_names FROM enrollment_subjects es JOIN subject s ON es.subject_id = s.subject_id GROUP BY es.enrollment_details_id) esub ON ed.enrollment_details_id = esub.enrollment_details_id " .
                "LEFT JOIN employee e ON ed.preferred_teacher = e.employee_id " .
                "LEFT JOIN branch b ON eh.branch_id = b.branch_id " .
                "LEFT JOIN enrollment_applications ea ON ea.enrollment_details_id = ed.enrollment_details_id " .
                "JOIN program p ON ed.program_id = p.program_id " .
                "WHERE 1=1" . $whereClause;
            $countStmt = $this->conn->prepare($countSql);
            if ($applicationStatus !== null) {
                if ($includeApplications) {
                    $countStmt->bindValue(':application_status', $applicationStatus, PDO::PARAM_STR);
                }
            } elseif ($status !== '' && strtolower($status) !== 'pending') {
                $countStmt->bindValue(':status', $status, PDO::PARAM_STR);
            }
            if ($search !== '') {
                $countStmt->bindValue(':search', "%$search%", PDO::PARAM_STR);
            }
            if ($subject !== '') {
                $countStmt->bindValue(':subject', "%$subject%", PDO::PARAM_STR);
            }
            if ($enrollmentDate !== '') {
                $countStmt->bindValue(':enrollment_date', $enrollmentDate, PDO::PARAM_STR);
            }
            if ($branchId) {
                $countStmt->bindValue(':branch_id', $branchId, PDO::PARAM_INT);
            }
            $countStmt->execute();
            $total = $countStmt->fetchColumn();

            // Get paginated data
            $sql = "SELECT ed.enrollment_details_id, ed.program_id, p.name AS program_name, st.student_id_number, TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name, COALESCE(esub.subject_names, sub.subject_name) AS subject_name, CONCAT(e.first_name, ' ', e.last_name) AS teacher_name, TRIM(CONCAT_WS(' ', enrolled_by.first_name, enrolled_by.last_name)) AS enrolled_by_name, enrolled_by_role.role_name AS enrolled_by_role, b.branch_id, b.branch_name, DATE_FORMAT(eh.date_created, '%M %d, %Y') AS enrollment_date, eh.date_created AS sort_date, COALESCE(NULLIF(eh.status, ''), ed.status) AS status, ea.application_id, ea.status AS application_status, " .
                "CASE " .
                    "WHEN COALESCE(pt.pending_payment_count, 0) > 0 THEN 'Pending' " .
                    "WHEN (COALESCE(eh.total_of_program, 0) + COALESCE(bt.total_penalty, 0) - COALESCE(pt.total_paid, 0)) <= 0 THEN 'Fully Paid' " .
                    "WHEN COALESCE(pt.total_paid, 0) > 0 THEN 'Partial' " .
                    "ELSE 'Unpaid' " .
                "END AS payment_status " .
                "FROM enrollment_details ed " .
                "JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id " .
                "JOIN student st ON eh.student_id = st.student_id " .
                "LEFT JOIN subject sub ON ed.subject_id = sub.subject_id " .
                "LEFT JOIN (SELECT es.enrollment_details_id, GROUP_CONCAT(s.subject_name ORDER BY s.subject_name SEPARATOR ', ') AS subject_names FROM enrollment_subjects es JOIN subject s ON es.subject_id = s.subject_id GROUP BY es.enrollment_details_id) esub ON ed.enrollment_details_id = esub.enrollment_details_id " .
                "LEFT JOIN employee e ON ed.preferred_teacher = e.employee_id " .
                "LEFT JOIN employee enrolled_by ON eh.employee_id = enrolled_by.employee_id " .
                "LEFT JOIN role enrolled_by_role ON enrolled_by.role_id = enrolled_by_role.role_id " .
                "LEFT JOIN branch b ON eh.branch_id = b.branch_id " .
                "LEFT JOIN enrollment_applications ea ON ea.enrollment_details_id = ed.enrollment_details_id " .
                "JOIN program p ON ed.program_id = p.program_id " .
                "LEFT JOIN (SELECT enrollment_details_id, SUM(penalty_amount) AS total_penalty FROM billing_schedule GROUP BY enrollment_details_id) bt ON ed.enrollment_details_id = bt.enrollment_details_id " .
                "LEFT JOIN (SELECT bs.enrollment_details_id, SUM(CASE WHEN pay.payment_status = 'Received' THEN pay.amount_paid ELSE 0 END) AS total_paid, SUM(CASE WHEN pay.payment_status = 'Pending' THEN 1 ELSE 0 END) AS pending_payment_count FROM billing_schedule bs LEFT JOIN payment pay ON bs.billing_schedule_id = pay.billing_schedule_id GROUP BY bs.enrollment_details_id) pt ON ed.enrollment_details_id = pt.enrollment_details_id " .
                "WHERE 1=1" . $whereClause . " ORDER BY eh.date_created DESC" . ($includeApplications ? '' : " LIMIT :limit OFFSET :offset");
            $stmt = $this->conn->prepare($sql);
            if ($applicationStatus !== null) {
                if ($includeApplications) {
                    $stmt->bindValue(':application_status', $applicationStatus, PDO::PARAM_STR);
                }
            } elseif ($status !== '' && strtolower($status) !== 'pending') {
                $stmt->bindValue(':status', $status, PDO::PARAM_STR);
            }
            if ($search !== '') {
                $stmt->bindValue(':search', "%$search%", PDO::PARAM_STR);
            }
            if ($subject !== '') {
                $stmt->bindValue(':subject', "%$subject%", PDO::PARAM_STR);
            }
            if ($enrollmentDate !== '') {
                $stmt->bindValue(':enrollment_date', $enrollmentDate, PDO::PARAM_STR);
            }
            if ($branchId) {
                $stmt->bindValue(':branch_id', $branchId, PDO::PARAM_INT);
            }
            if (!$includeApplications) {
                $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
                $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
            }
            $stmt->execute();
            $result = $stmt->fetchAll(PDO::FETCH_ASSOC);

            if ($includeApplications) {
                $applicationWhere = [
                    "ea.enrollment_details_id IS NULL",
                    $this->getProgramTypeCondition($type)
                ];
                $applicationParams = [];
                if ($applicationStatus !== null) {
                    $applicationWhere[] = 'ea.status = :application_filter_status';
                    $applicationParams[':application_filter_status'] = $applicationStatus;
                } else {
                    $applicationWhere[] = "ea.status IN ('pending_review', 'approved_for_payment')";
                }
                if ($summaryFilter === 'new') {
                    $applicationWhere[] = 'ea.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
                } elseif ($summaryFilter === 'pending'
                    && $applicationStatus !== null
                    && !in_array($applicationStatus, ['pending_review', 'approved_for_payment', 'ready_for_scheduling'], true)) {
                    $applicationWhere[] = '1=0';
                } elseif ($summaryFilter === 'incomplete') {
                    $applicationWhere[] = '1=0';
                }
                if ($applicationStatus === null && $status !== '' && strtolower($status) !== 'pending') {
                    $applicationWhere[] = '1=0';
                }
                if ($search !== '') {
                    $applicationWhere[] = "(ea.application_number LIKE :application_search OR st.student_id_number LIKE :application_search OR TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) LIKE :application_search OR p.name LIKE :application_search OR COALESCE(easub.subject_names, '') LIKE :application_search OR COALESCE(b.branch_name, '') LIKE :application_search)";
                    $applicationParams[':application_search'] = "%$search%";
                }
                if ($subject !== '') {
                    $applicationWhere[] = "COALESCE(easub.subject_names, '') LIKE :application_subject";
                    $applicationParams[':application_subject'] = "%$subject%";
                }
                if ($enrollmentDate !== '') {
                    $applicationWhere[] = 'DATE(ea.created_at) = :application_date';
                    $applicationParams[':application_date'] = $enrollmentDate;
                }
                if ($branchId) {
                    $applicationWhere[] = 'ea.branch_id = :application_branch_id';
                    $applicationParams[':application_branch_id'] = $branchId;
                }
                $applicationSql = "SELECT NULL AS enrollment_details_id, ea.program_id, p.name AS program_name,
                        st.student_id_number,
                        TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
                        COALESCE(easub.subject_names, 'N/A') AS subject_name,
                        NULL AS teacher_name, b.branch_id, b.branch_name,
                        DATE_FORMAT(ea.created_at, '%M %d, %Y') AS enrollment_date,
                        ea.created_at AS sort_date, ea.status, ea.application_id,
                        ea.status AS application_status, 'Unpaid' AS payment_status,
                        pm.payment_method AS application_payment_method,
                        eap.amount AS application_payment_amount,
                        eap.payment_status AS application_payment_review_status
                    FROM enrollment_applications ea
                    JOIN student st ON ea.student_id = st.student_id
                    JOIN program p ON ea.program_id = p.program_id
                    LEFT JOIN branch b ON ea.branch_id = b.branch_id
                    LEFT JOIN enrollment_application_payments eap ON eap.application_id = ea.application_id
                    LEFT JOIN payment_method pm ON pm.payment_method_id = eap.payment_method_id
                    LEFT JOIN (
                        SELECT eas.application_id, GROUP_CONCAT(s.subject_name ORDER BY s.subject_name SEPARATOR ', ') AS subject_names
                        FROM enrollment_application_subjects eas
                        JOIN subject s ON eas.subject_id = s.subject_id
                        GROUP BY eas.application_id
                    ) easub ON ea.application_id = easub.application_id
                    WHERE " . implode(' AND ', $applicationWhere);
                $applicationStmt = $this->conn->prepare($applicationSql);
                $applicationStmt->execute($applicationParams);
                $result = array_merge($result, $applicationStmt->fetchAll(PDO::FETCH_ASSOC));
                usort($result, fn($a, $b) => strcmp((string)($b['sort_date'] ?? ''), (string)($a['sort_date'] ?? '')));
                $total = count($result);
                $result = array_slice($result, $offset, $limit);
            }

            foreach ($result as &$row) {
                unset($row['sort_date']);
            }
            unset($row);

            echo json_encode([
                "status" => "success",
                "data" => $result,
                "pagination" => [
                    "current_page" => $page,
                    "per_page" => $limit,
                    "total" => (int)$total,
                    "total_pages" => ceil($total / $limit)
                ]
            ]);
        } catch (Exception $e) { echo json_encode(["status" => "error", "message" => $e->getMessage()]); }
    }

    // --- DELETE ---
    public function deleteEnrollment($json) {
        $data = json_decode($json, true);
        try {
            $this->assertEnrollmentAccessibleToCurrentUser($data['id'] ?? null);
            $this->conn->beginTransaction();

            // First, delete related billing schedules
            $stmtBill = $this->conn->prepare("DELETE FROM billing_schedule WHERE enrollment_details_id = ?");
            $stmtBill->execute([$data['id']]);

            // Then, delete related preferred schedules
            $stmtSched = $this->conn->prepare("DELETE FROM enrollment_preferred_schedule WHERE enrollment_details_id = ?");
            $stmtSched->execute([$data['id']]);

            // Finally, delete the enrollment details
            $stmt = $this->conn->prepare("DELETE FROM enrollment_details WHERE enrollment_details_id = ?");
            $stmt->execute([$data['id']]);

            $this->conn->commit();
            echo json_encode(["status" => "success", "message" => "Deleted successfully"]);
        } catch (Exception $e) {
            $this->conn->rollBack();
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    // --- LOOKUPS ---
    public function getLookups() {
        $data = ['genders'=>[], 'programs'=>[], 'subjects'=>[], 'branches'=>[], 'grade_levels'=>[], 'grade_levels_all'=>[], 'teachers'=>[], 'program_types'=>[], 'services'=>[], 'classes'=>[], 'sections'=>[], 'current_branch'=>null];
        try {
            $branchId = isset($_SESSION['branch_id']) ? intval($_SESSION['branch_id']) : null;
            $restrictedBranchId = $this->getBranchAdminBranchId();
            $data['genders'] = $this->conn->query("SELECT * FROM gender")->fetchAll(PDO::FETCH_ASSOC);
            $data['programs'] = $this->conn->query("
                SELECT p.*, pt.type as type_name,
                       s.service_name AS default_service_name,
                       s.amount AS default_service_amount,
                       s.status AS default_service_status
                FROM program p
                LEFT JOIN program_type pt ON p.program_type = pt.program_type_id
                LEFT JOIN service s ON p.service_id = s.service_id
                WHERE p.status = 'active'
                ORDER BY p.name
            ")->fetchAll(PDO::FETCH_ASSOC);
            $data['subjects'] = $this->conn->query("SELECT * FROM subject")->fetchAll(PDO::FETCH_ASSOC);
            $data['statuses'] = $this->conn->query("SELECT DISTINCT COALESCE(NULLIF(eh.status, ''), ed.status) AS status FROM enrollment_details ed JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id ORDER BY status")->fetchAll(PDO::FETCH_COLUMN);
            if ($restrictedBranchId) {
                $stmt = $this->conn->prepare("SELECT branch_id, branch_name FROM branch WHERE branch_id = ? ORDER BY branch_name");
                $stmt->execute([$restrictedBranchId]);
                $data['branches'] = $stmt->fetchAll(PDO::FETCH_ASSOC);
            } else {
                $data['branches'] = $this->conn->query("SELECT branch_id, branch_name FROM branch ORDER BY branch_name")->fetchAll(PDO::FETCH_ASSOC);
            }
            $data['grade_levels'] = $this->conn->query("SELECT grade_level_id, grade_level, status FROM grade_level WHERE status = 'active' ORDER BY grade_level_id")->fetchAll(PDO::FETCH_ASSOC);
            $data['grade_levels_all'] = $this->conn->query("SELECT grade_level_id, grade_level, status FROM grade_level ORDER BY grade_level_id")->fetchAll(PDO::FETCH_ASSOC);
            $data['teachers'] = $this->conn->query("SELECT employee_id, CONCAT(first_name, ' ', COALESCE(middle_name, ''), ' ', last_name) as name FROM employee WHERE status = 'active' AND role_id IN (SELECT role_id FROM role WHERE role_name = 'teacher')")->fetchAll(PDO::FETCH_ASSOC);
            $data['program_types'] = $this->conn->query("SELECT * FROM program_type")->fetchAll(PDO::FETCH_ASSOC);
            if ($branchId && $this->tableExists('branch_services')) {
                $stmt = $this->conn->prepare("
                    SELECT s.*
                    FROM service s
                    INNER JOIN branch_services bs ON s.service_id = bs.service_id
                    WHERE s.status = 'active' AND bs.branch_id = ?
                    ORDER BY s.service_name
                ");
                $stmt->execute([$branchId]);
                $data['services'] = $stmt->fetchAll(PDO::FETCH_ASSOC);
            } else {
                $data['services'] = $this->conn->query("SELECT * FROM service WHERE status = 'active' ORDER BY service_name")->fetchAll(PDO::FETCH_ASSOC);
            }
            $activeSchoolYear = $this->conn->query("SELECT * FROM school_years WHERE sy_status = 'active' LIMIT 1")->fetch(PDO::FETCH_ASSOC);
            $data['active_school_year'] = $activeSchoolYear ?: null;
            $data['school_years'] = $activeSchoolYear ? [$activeSchoolYear] : [];
            
            // Classes query
            $classSql = "SELECT c.class_id, c.branch_id, c.program_id, c.status, p.name AS program_name, b.branch_name
                         FROM class c
                         JOIN program p ON c.program_id = p.program_id
                         JOIN branch b ON c.branch_id = b.branch_id";
            if ($restrictedBranchId) {
                $classSql .= " WHERE c.branch_id = ?";
                $classStmt = $this->conn->prepare($classSql . " ORDER BY c.class_id ASC");
                $classStmt->execute([$restrictedBranchId]);
            } else {
                $classStmt = $this->conn->query($classSql . " ORDER BY c.class_id ASC");
            }
            if ($classStmt) {
                $data['classes'] = $classStmt->fetchAll(PDO::FETCH_ASSOC);
            }
            
            // Sections query
            $sectionSql = "SELECT s.section_id, s.class_id, s.employee_id, s.section_name, s.status, CONCAT(e.first_name, ' ', e.last_name) as teacher_name
                           FROM sections s
                           LEFT JOIN employee e ON s.employee_id = e.employee_id";
            if ($restrictedBranchId) {
                $sectionSql .= " INNER JOIN class c ON s.class_id = c.class_id WHERE c.branch_id = ?";
                $sectStmt = $this->conn->prepare($sectionSql . " ORDER BY s.section_name ASC");
                $sectStmt->execute([$restrictedBranchId]);
            } else {
                $sectStmt = $this->conn->query($sectionSql . " ORDER BY s.section_name ASC");
            }
            if ($sectStmt) {
                $data['sections'] = $sectStmt->fetchAll(PDO::FETCH_ASSOC);
            }

            // Get current branch if employee is logged in
            if ($branchId) {
                $stmt = $this->conn->prepare("SELECT branch_id, branch_name FROM branch WHERE branch_id = ?");
                $stmt->execute([$branchId]);
                $data['current_branch'] = $stmt->fetch(PDO::FETCH_ASSOC);
            }
        } catch (Exception $e) {
            error_log("getLookups error: " . $e->getMessage());
        }
        echo json_encode($data);
    }

    // --- NEW: FILTER TEACHERS BY PROGRAM + SUBJECT + AVAILABILITY ---
    public function getFilteredTeachers() {
        $program_id = $_GET['program_id'] ?? null;
        $subjectIds = $this->normalizeSubjectIds([
            'subject_ids' => $_GET['subject_ids'] ?? ($_GET['subject_id'] ?? [])
        ]);
        $branch_id = $this->getBranchAdminBranchId() ?: ($_GET['branch_id'] ?? null);
        $excludeEnrollmentId = isset($_GET['exclude_enrollment_id']) ? intval($_GET['exclude_enrollment_id']) : 0;
        $preferred_schedules_json = $_GET['preferred_schedules'] ?? null;
        
        if (!$program_id || empty($subjectIds)) {
            echo json_encode(["status" => "error", "message" => "Both program_id and at least one subject are required"]);
            return;
        }

        $schedule_filter = "";
        $availability_filter = "";
        $subjectPlaceholders = implode(',', array_fill(0, count($subjectIds), '?'));
        $branch_filter = $branch_id ? " AND e.branch_id = ?" : "";
        $params = [$program_id];
        if ($branch_id) {
            $params[] = $branch_id;
        }
        $params = array_merge($params, $subjectIds, [count($subjectIds)]);
        
        if ($preferred_schedules_json) {
            $preferred_schedules = json_decode($preferred_schedules_json, true);
            if (is_array($preferred_schedules) && !empty($preferred_schedules)) {
                // First: Filter based on teacher's predefined schedule (employee_schedule)
                // Require that for EACH preferred schedule, there exists a matching teacher schedule
                foreach ($preferred_schedules as $pref) {
                    $day = $pref['day'] ?? '';
                    $start_time = $pref['time'] ?? '';
                    $end_time = $pref['endTime'] ?? '';
                    
                    if ($day && $start_time && $end_time) {
                        $schedule_filter .= " AND EXISTS (
                            SELECT 1 FROM employee_schedule es 
                            WHERE es.employee_id = e.employee_id 
                            AND es.day_of_week = ? 
                            AND TIME(es.start_time) <= ? 
                            AND TIME(es.end_time) >= ? 
                            AND TIME(?) <= es.end_time 
                            AND TIME(?) >= es.start_time
                        )";
                        $params[] = $day;
                        $params[] = $start_time;  // teacher_start <= student_end
                        $params[] = $end_time;    // teacher_end >= student_start
                        $params[] = $start_time;  // student_start <= teacher_end  
                        $params[] = $end_time;    // student_end >= teacher_start
                    }
                }

                // Second: Filter out teachers who have conflicting bookings (enrollment_preferred_schedule)
                $conflict_conditions = [];
                foreach ($preferred_schedules as $pref) {
                    $date = $pref['date'] ?? '';
                    $start_time = $pref['time'] ?? '';
                    $end_time = $pref['endTime'] ?? '';
                    
                    if ($date && $start_time && $end_time) {
                        // Check for conflicts: existing schedules that overlap with the new preferred time
                        $conflict_conditions[] = "(eps.date = ? AND TIME(eps.start_time) < TIME(?) AND TIME(eps.end_time) > TIME(?))";
                        $params[] = $date;        // eps.date = ?
                        $params[] = $end_time;    // existing start < new end
                        $params[] = $start_time;  // existing end > new start
                    }
                }
                
                if (!empty($conflict_conditions)) {
                    $availability_filter = "AND NOT EXISTS (
                        SELECT 1 FROM enrollment_preferred_schedule eps
                        JOIN enrollment_details ed_conflict ON eps.enrollment_details_id = ed_conflict.enrollment_details_id
                        WHERE ed_conflict.preferred_teacher = e.employee_id
                        AND ed_conflict.status IN ('active', 'pending', 'enrolled')
                        AND (" . implode(' OR ', $conflict_conditions) . ")
                        " . ($excludeEnrollmentId > 0 ? "AND ed_conflict.enrollment_details_id <> ?" : "") . "
                    )";
                    if ($excludeEnrollmentId > 0) {
                        $params[] = $excludeEnrollmentId;
                    }
                }
            }
        }

        try {
$sql = "SELECT DISTINCT e.employee_id, TRIM(CONCAT_WS(' ', e.first_name, NULLIF(TRIM(COALESCE(e.middle_name, '')), ''), e.last_name)) as name
                    FROM employee e
                    JOIN program_teacher pt ON e.employee_id = pt.employee_id
                    WHERE pt.program_id = ?{$branch_filter}
                    AND e.employee_id IN (
                        SELECT st.employee_id
                        FROM subject_teacher st
                        WHERE st.subject_id IN ($subjectPlaceholders)
                        GROUP BY st.employee_id
                        HAVING COUNT(DISTINCT st.subject_id) = ?
                    )
                    AND e.role_id IN (SELECT role_id FROM role WHERE role_name = 'teacher')
                    AND e.status = 'active'
                    $schedule_filter
                    $availability_filter
                    ORDER BY name";
            
            $stmt = $this->conn->prepare($sql);
            $stmt->execute($params);
            $teachers = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            echo json_encode(["status" => "success", "data" => $teachers]);
        } catch (Exception $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    // --- GET TEACHER AVAILABLE SCHEDULE SLOTS ---
    public function getTeacherAvailableSlots() {
        $teacher_id = $_GET['teacher_id'] ?? null;
        $excludeEnrollmentId = isset($_GET['exclude_enrollment_id'])
            ? (int) $_GET['exclude_enrollment_id']
            : 0;
        if (!$teacher_id) {
            echo json_encode(["status" => "error", "message" => "Teacher ID required"]);
            return;
        }

        try {
            $stmt = $this->conn->prepare("SELECT day_of_week, start_time, end_time FROM employee_schedule WHERE employee_id = ? ORDER BY FIELD(day_of_week, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')");
            $stmt->execute([$teacher_id]);
            $slots = $stmt->fetchAll(PDO::FETCH_ASSOC);

            $bookingSql = "SELECT eps.date, eps.start_time, eps.end_time
                 FROM enrollment_preferred_schedule eps
                 JOIN enrollment_details ed ON eps.enrollment_details_id = ed.enrollment_details_id
                 WHERE ed.preferred_teacher = ?
                 AND ed.status IN ('active', 'pending', 'enrolled')
                 " . ($excludeEnrollmentId > 0 ? "AND ed.enrollment_details_id <> ?\n" : "") .
                 "ORDER BY eps.date, eps.start_time";
            $bookingStmt = $this->conn->prepare($bookingSql);
            $bookingParams = [$teacher_id];
            if ($excludeEnrollmentId > 0) {
                $bookingParams[] = $excludeEnrollmentId;
            }
            $bookingStmt->execute($bookingParams);
            $bookings = $bookingStmt->fetchAll(PDO::FETCH_ASSOC);
            
            echo json_encode(["status" => "success", "data" => ["slots" => $slots, "bookings" => $bookings]]);
        } catch (Exception $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    // --- GET STUDENT BRANCH ---
    public function getStudentBranch() {
        $student_id = $_GET['student_id'] ?? null;
        if (!$student_id) {
            echo json_encode(["status" => "error", "message" => "Student ID required"]);
            return;
        }
        try {
            // Get branch from last enrollment
            $stmt = $this->conn->prepare("SELECT b.branch_name FROM enrollment_header eh LEFT JOIN branch b ON eh.branch_id = b.branch_id WHERE eh.student_id = ? ORDER BY eh.date_created DESC LIMIT 1");
            $stmt->execute([$student_id]);
            $branch = $stmt->fetch(PDO::FETCH_ASSOC);
            echo json_encode(["status" => "success", "branch_name" => $branch ? $branch['branch_name'] : 'Not Assigned']);
        } catch (Exception $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    public function searchStudents() {
        $q = "%" . ($_GET['query'] ?? '') . "%";
        $stmt = $this->conn->prepare("
            SELECT student_id, student_id_number, first_name, last_name, ext
            FROM student
            WHERE student_id_number LIKE ?
               OR first_name LIKE ?
               OR last_name LIKE ?
               OR ext LIKE ?
            LIMIT 10
        ");
        $stmt->execute([$q, $q, $q, $q]);
        echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    // --- GET ENROLLMENT DETAILS ---
    public function getEnrollmentDetails() {
        $id = $_GET['id'] ?? null;
        if (!$id) {
            echo json_encode(["status" => "error", "message" => "ID required"]);
            return;
        }
        try {
            $branchId = $this->getBranchAdminBranchId();
            // Detect if enrollment_details has class_id column
            $hasClassColStmt = $this->conn->prepare("SHOW COLUMNS FROM enrollment_details LIKE 'class_id'");
            $hasClassColStmt->execute();
            $hasClassCol = (bool)$hasClassColStmt->fetch();

            $hasHealthNoteColStmt = $this->conn->prepare("SHOW COLUMNS FROM enrollment_details LIKE 'health_note'");
            $hasHealthNoteColStmt->execute();
            $hasHealthNoteCol = (bool)$hasHealthNoteColStmt->fetch();

            $hasStudentHealthNoteColStmt = $this->conn->prepare("SHOW COLUMNS FROM student LIKE 'health_note'");
            $hasStudentHealthNoteColStmt->execute();
            $hasStudentHealthNoteCol = (bool)$hasStudentHealthNoteColStmt->fetch();

            $hasServicesColStmt = $this->conn->prepare("SHOW COLUMNS FROM enrollment_details LIKE 'services'");
            $hasServicesColStmt->execute();
            $hasServicesCol = (bool)$hasServicesColStmt->fetch();

            if ($hasHealthNoteCol && $hasStudentHealthNoteCol) {
                $healthNoteSelect = ", COALESCE(NULLIF(ed.health_note, ''), s.health_note) AS health_note";
            } elseif ($hasHealthNoteCol) {
                $healthNoteSelect = ", ed.health_note";
            } elseif ($hasStudentHealthNoteCol) {
                $healthNoteSelect = ", s.health_note";
            } else {
                $healthNoteSelect = "";
            }

            $servicesSelect = $hasServicesCol ? ", ed.services" : "";

            if ($hasClassCol) {
                $sql = "SELECT ed.enrollment_details_id, eh.student_id, ed.program_id, ed.grade_level_id, ed.subject_id, COALESCE(esub.subject_ids, ed.subject_id) AS subject_ids, ed.goal, ed.preferred_time_day, ed.preferred_teacher, COALESCE(NULLIF(eh.status, ''), ed.status) AS status, eh.status AS header_status, ed.status AS details_status, ed.class_id, ed.section_id{$healthNoteSelect}{$servicesSelect},
                               s.student_id_number, s.first_name, s.last_name, s.ext, s.adr_street, s.adr_barangay, s.adr_city, s.adr_province, s.adr_note, eh.total_of_program as total_fee, eh.school_year_id, sy.school_year AS school_year_label, DATE_FORMAT(eh.date_created, '%M %d, %Y') as enrollment_date,
                               p.name as program_name,
                               COALESCE(esub.subject_names, sub.subject_name) AS subject_name,
                               gl.grade_level,
                               CONCAT(e.first_name, ' ', e.last_name) as teacher_name,
                               TRIM(CONCAT_WS(' ', enrolled_by.first_name, enrolled_by.last_name)) AS enrolled_by_name,
                               enrolled_by_role.role_name AS enrolled_by_role,
                               CONCAT(sec_e.first_name, ' ', sec_e.last_name) as section_teacher_name,
                               eh.branch_id, b.branch_name,
                               COALESCE(sec.section_name, '') as section_name,
                               COALESCE(ed.class_id, sec.class_id) as class_id_from_section,
                               COALESCE(cls.program_id, p.program_id) as class_program_id
                        FROM enrollment_details ed
                        JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                        JOIN student s ON eh.student_id = s.student_id
                        LEFT JOIN branch b ON eh.branch_id = b.branch_id
                        LEFT JOIN school_years sy ON eh.school_year_id = sy.school_year_id
                        LEFT JOIN program p ON ed.program_id = p.program_id
                        LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                        LEFT JOIN (SELECT es.enrollment_details_id, GROUP_CONCAT(es.subject_id ORDER BY s.subject_name SEPARATOR ',') AS subject_ids, GROUP_CONCAT(s.subject_name ORDER BY s.subject_name SEPARATOR ', ') AS subject_names FROM enrollment_subjects es JOIN subject s ON es.subject_id = s.subject_id GROUP BY es.enrollment_details_id) esub ON ed.enrollment_details_id = esub.enrollment_details_id
                        LEFT JOIN grade_level gl ON ed.grade_level_id = gl.grade_level_id
                        LEFT JOIN employee e ON ed.preferred_teacher = e.employee_id
                        LEFT JOIN employee enrolled_by ON eh.employee_id = enrolled_by.employee_id
                        LEFT JOIN role enrolled_by_role ON enrolled_by.role_id = enrolled_by_role.role_id
                        LEFT JOIN sections sec ON ed.section_id = sec.section_id
                        LEFT JOIN class cls ON COALESCE(ed.class_id, sec.class_id) = cls.class_id
                        LEFT JOIN employee sec_e ON sec.employee_id = sec_e.employee_id
                        WHERE ed.enrollment_details_id = ?";
            } else {
                $sql = "SELECT ed.enrollment_details_id, eh.student_id, ed.program_id, ed.grade_level_id, ed.subject_id, COALESCE(esub.subject_ids, ed.subject_id) AS subject_ids, ed.goal, ed.preferred_time_day, ed.preferred_teacher, COALESCE(NULLIF(eh.status, ''), ed.status) AS status, eh.status AS header_status, ed.status AS details_status, ed.section_id{$healthNoteSelect}{$servicesSelect},
                               s.student_id_number, s.first_name, s.last_name, s.ext, s.adr_street, s.adr_barangay, s.adr_city, s.adr_province, s.adr_note, eh.total_of_program as total_fee, eh.school_year_id, sy.school_year AS school_year_label, DATE_FORMAT(eh.date_created, '%M %d, %Y') as enrollment_date,
                               p.name as program_name,
                               COALESCE(esub.subject_names, sub.subject_name) AS subject_name,
                               gl.grade_level,
                               CONCAT(e.first_name, ' ', e.last_name) as teacher_name,
                               TRIM(CONCAT_WS(' ', enrolled_by.first_name, enrolled_by.last_name)) AS enrolled_by_name,
                               enrolled_by_role.role_name AS enrolled_by_role,
                               CONCAT(sec_e.first_name, ' ', sec_e.last_name) as section_teacher_name,
                               eh.branch_id, b.branch_name,
                               COALESCE(sec.section_name, '') as section_name,
                               COALESCE(sec.class_id, cls.class_id) as class_id_from_section,
                               COALESCE(cls.program_id, p.program_id) as class_program_id
                        FROM enrollment_details ed
                        JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                        JOIN student s ON eh.student_id = s.student_id
                        LEFT JOIN branch b ON eh.branch_id = b.branch_id
                        LEFT JOIN school_years sy ON eh.school_year_id = sy.school_year_id
                        LEFT JOIN program p ON ed.program_id = p.program_id
                        LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                        LEFT JOIN (SELECT es.enrollment_details_id, GROUP_CONCAT(es.subject_id ORDER BY s.subject_name SEPARATOR ',') AS subject_ids, GROUP_CONCAT(s.subject_name ORDER BY s.subject_name SEPARATOR ', ') AS subject_names FROM enrollment_subjects es JOIN subject s ON es.subject_id = s.subject_id GROUP BY es.enrollment_details_id) esub ON ed.enrollment_details_id = esub.enrollment_details_id
                        LEFT JOIN grade_level gl ON ed.grade_level_id = gl.grade_level_id
                        LEFT JOIN employee e ON ed.preferred_teacher = e.employee_id
                        LEFT JOIN employee enrolled_by ON eh.employee_id = enrolled_by.employee_id
                        LEFT JOIN role enrolled_by_role ON enrolled_by.role_id = enrolled_by_role.role_id
                        LEFT JOIN sections sec ON ed.section_id = sec.section_id
                        LEFT JOIN class cls ON sec.class_id = cls.class_id
                        LEFT JOIN employee sec_e ON sec.employee_id = sec_e.employee_id
                        WHERE ed.enrollment_details_id = ?";
            }

            $params = [$id];
            if ($branchId) {
                $sql .= " AND eh.branch_id = ?";
                $params[] = $branchId;
            }
            $stmt = $this->conn->prepare($sql);
            $stmt->execute($params);
            $details = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$details) {
                throw new Exception("Enrollment not found for your branch.");
            }

            // Get preferred schedule
            $stmtSched = $this->conn->prepare("SELECT day, start_time, end_time, date FROM enrollment_preferred_schedule WHERE enrollment_details_id = ?");
            $stmtSched->execute([$id]);
            $schedule = $stmtSched->fetchAll(PDO::FETCH_ASSOC);

            // Get section schedule (if linked to section)
            $section_schedule = [];
            if (!empty($details['section_id'])) {
                $sqlSectionSched = "SELECT day_of_week AS day, start_time, end_time FROM section_schedules WHERE section_id = ? ORDER BY FIELD(day_of_week, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')";
                $stmtSectionSched = $this->conn->prepare($sqlSectionSched);
                $stmtSectionSched->execute([$details['section_id']]);
                $section_schedule = $stmtSectionSched->fetchAll(PDO::FETCH_ASSOC);
            }

            echo json_encode(["status" => "success", "data" => ["details" => $details, "schedule" => $schedule, "section_schedule" => $section_schedule]]);
        } catch (Exception $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    // --- UPDATE ENROLLMENT ---
    public function updateEnrollment($json) {
        $data = json_decode($json, true);
        try {
            $this->conn->beginTransaction();

            $enrollmentId = $data['enrollment_details_id'] ?? null;
            if (!$enrollmentId) {
                throw new Exception("Enrollment ID is required");
            }
            $this->assertEnrollmentAccessibleToCurrentUser($enrollmentId);

            $preferredTeacher = isset($data['preferred_teacher']) && $data['preferred_teacher'] !== '' ? $data['preferred_teacher'] : null;
            $preferredTimeDay = $data['preferred_time_day'] ?? '';
            $programId = isset($data['program_id']) && $data['program_id'] !== '' ? intval($data['program_id']) : null;
            $gradeLevelId = array_key_exists('grade_level_id', $data) && $data['grade_level_id'] !== '' ? $data['grade_level_id'] : null;
            $goal = array_key_exists('goal', $data) ? $data['goal'] : null;
            $subjectIds = $this->normalizeSubjectIds($data);
            $classId = isset($data['class_id']) && $data['class_id'] !== '' ? $data['class_id'] : null;
            $sectionId = isset($data['section_id']) && $data['section_id'] !== '' ? $data['section_id'] : null;

            $stmtExisting = $this->conn->prepare("
                SELECT ed.program_id, ed.grade_level_id, ed.subject_id, ed.goal, ed.enrollment_header_id
                FROM enrollment_details ed
                WHERE ed.enrollment_details_id = ?
                LIMIT 1
            ");
            $stmtExisting->execute([$enrollmentId]);
            $existing = $stmtExisting->fetch(PDO::FETCH_ASSOC);
            if (!$existing) {
                throw new Exception("Enrollment was not found");
            }

            if ($programId === null) {
                $programId = intval($existing['program_id'] ?? 0) ?: null;
            }
            if (!array_key_exists('grade_level_id', $data)) {
                $gradeLevelId = $existing['grade_level_id'] ?? null;
            }
            if (!array_key_exists('goal', $data)) {
                $goal = $existing['goal'] ?? null;
            }
            if ($gradeLevelId !== null && (string)$gradeLevelId !== (string)($existing['grade_level_id'] ?? '')) {
                $this->assertActiveGradeLevel($gradeLevelId);
            }
            if (empty($subjectIds) && !empty($existing['subject_id'])) {
                $subjectIds = [intval($existing['subject_id'])];
            }

            if ($sectionId) {
                $sectionStmt = $this->conn->prepare("SELECT class_id FROM sections WHERE section_id = ? LIMIT 1");
                $sectionStmt->execute([$sectionId]);
                $sectionRow = $sectionStmt->fetch(PDO::FETCH_ASSOC);

                if (!$sectionRow) {
                    throw new Exception("Selected section was not found");
                }

                if ($classId && (string)$sectionRow['class_id'] !== (string)$classId) {
                    throw new Exception("Selected section does not belong to the selected class");
                }

                $classId = $sectionRow['class_id'];
            }

            $hasClassColStmt = $this->conn->prepare("SHOW COLUMNS FROM enrollment_details LIKE 'class_id'");
            $hasClassColStmt->execute();
            $hasClassCol = (bool)$hasClassColStmt->fetch();

            $hasSectionColStmt = $this->conn->prepare("SHOW COLUMNS FROM enrollment_details LIKE 'section_id'");
            $hasSectionColStmt->execute();
            $hasSectionCol = (bool)$hasSectionColStmt->fetch();

            // Update enrollment details
            $updateFields = [
                "program_id = ?",
                "grade_level_id = ?",
                "subject_id = ?",
                "goal = ?",
                "preferred_teacher = ?",
                "preferred_time_day = ?"
            ];
            $updateValues = [
                $programId,
                $gradeLevelId,
                $subjectIds[0] ?? null,
                $goal,
                $preferredTeacher,
                $preferredTimeDay
            ];

            if ($hasClassCol) {
                $updateFields[] = "class_id = ?";
                $updateValues[] = $classId;
            }

            if ($hasSectionCol) {
                $updateFields[] = "section_id = ?";
                $updateValues[] = $sectionId;
            }

            $updateValues[] = $enrollmentId;
            $stmt = $this->conn->prepare("UPDATE enrollment_details SET " . implode(", ", $updateFields) . " WHERE enrollment_details_id = ?");
            $stmt->execute($updateValues);
            $this->saveEnrollmentSubjects($enrollmentId, $subjectIds);

            if ($programId) {
                $program = $this->getProgram($programId);
                $totalFee = array_key_exists('total_of_program', $data)
                    ? floatval($data['total_of_program'])
                    : floatval($program['tuition'] ?? 0);
                $stmtHeader = $this->conn->prepare("UPDATE enrollment_header SET total_of_program = ? WHERE enrollment_header_id = ?");
                $stmtHeader->execute([$totalFee, $existing['enrollment_header_id']]);
            }

            // School year is automatically determined by the active school year and is not editable through enrollment updates.

            // Only update schedules if preferences are explicitly provided
            if (isset($data['preferences']) && is_array($data['preferences'])) {
                // Delete existing schedules only when updating with new preferences
                $stmtDel = $this->conn->prepare("DELETE FROM enrollment_preferred_schedule WHERE enrollment_details_id = ?");
                $stmtDel->execute([$enrollmentId]);

                // Insert new schedules and store exact session dates
                $scheduleRows = [];
                $progStmt = $this->conn->prepare("SELECT total_units, unit_type FROM program WHERE program_id = ? LIMIT 1");
                $progStmt->execute([$programId]);
                $progResult = $progStmt->fetch(PDO::FETCH_ASSOC);
                $program_units = intval($progResult['total_units'] ?? 0);
                $unit_type = $progResult['unit_type'] ?? '';
                $isUnitTutorial = ($unit_type === 'session' && $program_units > 0);

                if ($isUnitTutorial && $program_units > 0) {
                    $scheduleRows = $this->buildSessionScheduleRows($data['preferences'], $program_units);
                } else {
                    foreach ($data['preferences'] as $pref) {
                        if (empty($pref['day']) || empty($pref['time'])) {
                            continue;
                        }
                        $scheduleRows[] = [
                            'day' => $this->normalizeDayName($pref['day']),
                            'start_time' => $pref['time'],
                            'end_time' => $pref['endTime'] ?? $pref['end_time'] ?? null,
                            'date' => $this->getNextOrSameDate($pref['day'])
                        ];
                    }
                }

                $this->insertEnrollmentPreferredScheduleRows($enrollmentId, $scheduleRows);
            }
            // If no preferences provided, existing schedules are preserved

            $this->conn->commit();
            echo json_encode(["status" => "success", "message" => "Enrollment updated successfully"]);
        } catch (Exception $e) {
            $this->conn->rollBack();
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    // --- CHECK TEACHER AVAILABILITY FOR RESCHEDULE ---
    public function checkTeacherAvailability() {
        $teacher_id = $_GET['teacher_id'] ?? null;
        $date = $_GET['date'] ?? null;
        $day = $_GET['day'] ?? null;
        $start_time = $_GET['start_time'] ?? null;
        $end_time = $_GET['end_time'] ?? null;

        if (!$teacher_id || !$date || !$day || !$start_time || !$end_time) {
            echo json_encode(["status" => "error", "message" => "Missing required parameters"]);
            return;
        }

        try {
            // Get teacher's working hours for this day
            $sql = "SELECT TIME(start_time) as work_start, TIME(end_time) as work_end
                    FROM employee_schedule
                    WHERE employee_id = ? AND day_of_week = ?
                    LIMIT 1";
            $stmt = $this->conn->prepare($sql);
            $stmt->execute([$teacher_id, $day]);
            $schedule = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$schedule) {
                echo json_encode([
                    "status" => "success",
                    "available" => false,
                    "message" => "Teacher does not work on $day"
                ]);
                return;
            }

            $workStart = $schedule['work_start'];
            $workEnd = $schedule['work_end'];

            // Check if the requested time falls within working hours
            $available = ($start_time >= $workStart && $end_time <= $workEnd);

            echo json_encode([
                "status" => "success",
                "available" => $available,
                "work_start" => $workStart,
                "work_end" => $workEnd,
                "message" => $available
                    ? "Teacher is available at this time"
                    : "Teacher works from " . date('g:i A', strtotime($workStart)) . " to " . date('g:i A', strtotime($workEnd)) . " on $day"
            ]);
        } catch (Exception $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    public function updateEnrollmentStatus($json) {
        $data = json_decode($json, true);
        $enrollment_details_id = $data['enrollment_details_id'];
        try {
            $enrolledByEmployeeId = $this->getCurrentEnrollmentEmployeeId();
            $this->assertEnrollmentAccessibleToCurrentUser($enrollment_details_id);
            $this->conn->beginTransaction();
            
            // Update enrollment_details status
            $stmt = $this->conn->prepare("UPDATE enrollment_details SET status = 'enrolled' WHERE enrollment_details_id = ?");
            $stmt->execute([$enrollment_details_id]);
            
            // Update enrollment_header status
            $stmt2 = $this->conn->prepare("UPDATE enrollment_header SET employee_id = COALESCE(?, employee_id), status = 'enrolled' WHERE enrollment_header_id = (SELECT enrollment_header_id FROM enrollment_details WHERE enrollment_details_id = ?)");
            $stmt2->execute([$enrolledByEmployeeId, $enrollment_details_id]);
            
            // Get section_id from enrollment_details
            $detailSql = "SELECT section_id FROM enrollment_details WHERE enrollment_details_id = ?";
            $detailStmt = $this->conn->prepare($detailSql);
            $detailStmt->execute([$enrollment_details_id]);
            $detailResult = $detailStmt->fetch(PDO::FETCH_ASSOC);
            
            // Check if section is now full and update status
            if ($detailResult && $detailResult['section_id']) {
                $section_id = $detailResult['section_id'];
                
                // Count enrolled students in this section
                $countSql = "SELECT COUNT(*) as count FROM enrollment_details WHERE section_id = ? AND status = 'enrolled'";
                $countStmt = $this->conn->prepare($countSql);
                $countStmt->execute([$section_id]);
                $countResult = $countStmt->fetch(PDO::FETCH_ASSOC);
                $currentCount = (int)$countResult['count'];
                
                // Get max capacity
                $maxSql = "SELECT max FROM sections WHERE section_id = ?";
                $maxStmt = $this->conn->prepare($maxSql);
                $maxStmt->execute([$section_id]);
                $maxResult = $maxStmt->fetch(PDO::FETCH_ASSOC);
                $maxCapacity = $maxResult ? (int)$maxResult['max'] : 0;
                
                // Update section status to full if capacity reached
                if ($maxCapacity > 0 && $currentCount >= $maxCapacity) {
                    $updateSql = "UPDATE sections SET status = 'full' WHERE section_id = ?";
                    $updateStmt = $this->conn->prepare($updateSql);
                    $updateStmt->execute([$section_id]);
                }
            }

            $enrollment = $this->notifications->getEnrollmentContext($enrollment_details_id);
            if ($enrollment) {
                $programName = $enrollment['program_name'] ?: 'your program';
                $this->notifications->notifyStudent(
                    $enrollment['student_id'],
                    'Enrollment Confirmed',
                    "Your enrollment for {$programName} has been confirmed."
                );

                if (!empty($enrollment['teacher_id'])) {
                    $this->notifications->notifyEmployee(
                        $enrollment['teacher_id'],
                        'Student Enrollment Confirmed',
                        "{$enrollment['student_name']}'s enrollment for {$programName} has been confirmed."
                    );
                }
            }
            
            $this->conn->commit();
            echo json_encode(["status" => "success", "message" => "Enrollment confirmed"]);
        } catch (Exception $e) {
            $this->conn->rollBack();
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }

    public function getSectionEnrollmentCount() {
        $section_id = isset($_GET['section_id']) ? (int)$_GET['section_id'] : null;
        if (!$section_id) {
            echo json_encode(["status" => "error", "message" => "Section ID is required"]);
            return;
        }
        try {
            $branchId = $this->getBranchAdminBranchId();
            $countSql = "SELECT COUNT(*) as count
                         FROM enrollment_details ed
                         INNER JOIN sections sec ON ed.section_id = sec.section_id
                         INNER JOIN class c ON sec.class_id = c.class_id
                         WHERE ed.section_id = ? AND ed.status = 'enrolled'"
                         . ($branchId ? " AND c.branch_id = ?" : "");
            $countStmt = $this->conn->prepare($countSql);
            $countStmt->execute($branchId ? [$section_id, $branchId] : [$section_id]);
            $countResult = $countStmt->fetch(PDO::FETCH_ASSOC);
            $currentCount = (int)$countResult['count'];

            $maxSql = "SELECT sec.max
                       FROM sections sec
                       INNER JOIN class c ON sec.class_id = c.class_id
                       WHERE sec.section_id = ?"
                       . ($branchId ? " AND c.branch_id = ?" : "");
            $maxStmt = $this->conn->prepare($maxSql);
            $maxStmt->execute($branchId ? [$section_id, $branchId] : [$section_id]);
            $maxResult = $maxStmt->fetch(PDO::FETCH_ASSOC);
            $maxCapacity = $maxResult ? (int)$maxResult['max'] : 0;

            echo json_encode(["status" => "success", "count" => $currentCount, "max" => $maxCapacity]);
        } catch (Exception $e) {
            echo json_encode(["status" => "error", "message" => $e->getMessage()]);
        }
    }
}



    // ROUTER
if ($_SERVER['REQUEST_METHOD'] == 'GET') {
        $op = $_GET['operation'] ?? null; $json = $_GET['json'] ?? "";
    } else {
        if (!empty($_POST)) {
            $op = $_POST['operation'] ?? null;
            $json = $_POST['json'] ?? "";
        } else {
            $content = file_get_contents('php://input'); $postData = json_decode($content, true);
            $op = $postData['operation'] ?? null; 
            $json = isset($postData['json']) ? $postData['json'] : json_encode($postData);
        }
    }

        $api = new EnrollmentAPI();
    switch($op){
        case "addEnrollment": $api->addEnrollment($json); break;
        case "createPendingDownpaymentEnrollment": $api->createPendingDownpaymentEnrollment($json); break;
        case "completePendingEnrollment": $api->completePendingEnrollment($json); break;
        case "getFilteredTeachers": $api->getFilteredTeachers(); break;
        case "getTeacherAvailableSlots": $api->getTeacherAvailableSlots(); break;
        case "getLookups": $api->getLookups(); break;
        case "getStudentBranch": $api->getStudentBranch(); break;
        case "searchStudents": $api->searchStudents(); break;
        case "getEnrollments": $api->getEnrollments(); break;
        case "getEnrollmentStats": $api->getEnrollmentStats(); break;
        case "getReleaseStudents": $api->getReleaseStudents(); break;
        case "getEnrollmentDetails": $api->getEnrollmentDetails(); break;
        case "updateEnrollment": $api->updateEnrollment($json); break;
        case "deleteEnrollment": $api->deleteEnrollment($json); break;
        case "checkTeacherAvailability": $api->checkTeacherAvailability(); break;
        case "updateEnrollmentStatus": $api->updateEnrollmentStatus($json); break;
        case "getSectionEnrollmentCount": $api->getSectionEnrollmentCount(); break;
        default: echo json_encode(["status" => "error", "message" => "Invalid Operation"]); break;
    }
    ?>
