<?php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

function normalizeAuditorDashboardRole($role) {
    $role = strtolower(trim((string) $role));
    return preg_replace('/[\s_-]+/', ' ', $role);
}

function requireAuditorDashboardAccess() {
    if (normalizeAuditorDashboardRole($_SESSION['user_role'] ?? '') !== 'auditor') {
        throw new Exception('Unauthorized');
    }
}

function fetchAllRows($conn, $sql) {
    $stmt = $conn->prepare($sql);
    $stmt->execute();
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

try {
    requireAuditorDashboardAccess();
    include __DIR__ . '/../admin/connection-pdo.php';

    $branches = fetchAllRows($conn, "
        SELECT branch_id, branch_name
        FROM branch
        ORDER BY branch_name ASC
    ");

    $paymentOverview = fetchAllRows($conn, "
        SELECT eh.branch_id,
               COALESCE(NULLIF(pay.payment_status, ''), 'Pending') AS payment_status,
               COUNT(DISTINCT pay.payment_id) AS payment_count,
               COALESCE(SUM(pay.amount_paid), 0) AS total_amount
        FROM payment pay
        JOIN billing_schedule bs ON pay.billing_schedule_id = bs.billing_schedule_id
        JOIN enrollment_details ed ON bs.enrollment_details_id = ed.enrollment_details_id
        JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
        GROUP BY eh.branch_id, COALESCE(NULLIF(pay.payment_status, ''), 'Pending')
    ");

    $dueToday = fetchAllRows($conn, "
        SELECT bs.billing_schedule_id,
               eh.branch_id,
               TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
               p.name AS program_name,
               bs.billing_type,
               DATE_FORMAT(bs.due_date, '%b %d, %Y') AS due_date,
               COALESCE(bs.total_amount, 0) AS amount,
               bs.status
        FROM billing_schedule bs
        JOIN enrollment_details ed ON bs.enrollment_details_id = ed.enrollment_details_id
        JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
        JOIN student st ON eh.student_id = st.student_id
        LEFT JOIN program p ON ed.program_id = p.program_id
        WHERE bs.status IN ('unpaid', 'partial')
          AND bs.due_date = CURDATE()
        ORDER BY st.last_name ASC, st.first_name ASC, bs.billing_schedule_id ASC
    ");

    $overduePayments = fetchAllRows($conn, "
        SELECT bs.billing_schedule_id,
               eh.branch_id,
               TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
               p.name AS program_name,
               bs.billing_type,
               DATE_FORMAT(bs.due_date, '%b %d, %Y') AS due_date,
               DATEDIFF(CURDATE(), bs.due_date) AS days_overdue,
               COALESCE(bs.total_amount, 0) AS amount,
               bs.status
        FROM billing_schedule bs
        JOIN enrollment_details ed ON bs.enrollment_details_id = ed.enrollment_details_id
        JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
        JOIN student st ON eh.student_id = st.student_id
        LEFT JOIN program p ON ed.program_id = p.program_id
        WHERE bs.status IN ('unpaid', 'partial', 'overdue')
          AND bs.due_date < CURDATE()
        ORDER BY bs.due_date ASC, st.last_name ASC, st.first_name ASC, bs.billing_schedule_id ASC
    ");

    $recentEnrollments = fetchAllRows($conn, "
        SELECT ed.enrollment_details_id,
               eh.branch_id,
               TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
               p.name AS program_name,
               DATE_FORMAT(eh.date_created, '%b %d, %Y') AS enrollment_date,
               COALESCE(eh.total_of_program, 0) AS amount,
               COALESCE(NULLIF(eh.status, ''), ed.status, 'pending') AS status
        FROM enrollment_details ed
        JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
        JOIN student st ON eh.student_id = st.student_id
        LEFT JOIN program p ON ed.program_id = p.program_id
        ORDER BY eh.date_created DESC, ed.enrollment_details_id DESC
        LIMIT 300
    ");

    $pendingPayments = fetchAllRows($conn, "
        SELECT pay.payment_id,
               eh.branch_id,
               TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
               p.name AS program_name,
               bs.billing_type,
               DATE_FORMAT(pay.payment_date, '%b %d, %Y') AS payment_date,
               COALESCE(pay.amount_paid, 0) AS amount,
               pay.reference_no
        FROM payment pay
        JOIN billing_schedule bs ON pay.billing_schedule_id = bs.billing_schedule_id
        JOIN enrollment_details ed ON bs.enrollment_details_id = ed.enrollment_details_id
        JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
        JOIN student st ON eh.student_id = st.student_id
        LEFT JOIN program p ON ed.program_id = p.program_id
        WHERE pay.payment_status = 'Pending'
        ORDER BY pay.payment_date ASC, pay.payment_id ASC
    ");

    $programSummary = fetchAllRows($conn, "
        SELECT eh.branch_id,
               p.program_id,
               p.name AS program_name,
               COUNT(DISTINCT ed.enrollment_details_id) AS total_enrollments,
               COALESCE(SUM(payments.received_amount), 0) AS revenue
        FROM enrollment_details ed
        JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
        JOIN program p ON ed.program_id = p.program_id
        LEFT JOIN (
            SELECT bs.enrollment_details_id,
                   SUM(CASE WHEN pay.payment_status = 'Received' THEN pay.amount_paid ELSE 0 END) AS received_amount
            FROM billing_schedule bs
            LEFT JOIN payment pay ON bs.billing_schedule_id = pay.billing_schedule_id
            GROUP BY bs.enrollment_details_id
        ) payments ON ed.enrollment_details_id = payments.enrollment_details_id
        GROUP BY eh.branch_id, p.program_id, p.name
        ORDER BY total_enrollments DESC, p.name ASC
    ");

    $enrollmentTrend = fetchAllRows($conn, "
        SELECT eh.branch_id,
               DATE_FORMAT(eh.date_created, '%Y-%m-%d') AS enrollment_date,
               COUNT(DISTINCT ed.enrollment_details_id) AS total_enrollments
        FROM enrollment_details ed
        JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
        GROUP BY eh.branch_id, DATE_FORMAT(eh.date_created, '%Y-%m-%d')
        ORDER BY enrollment_date ASC
    ");

    $paymentTrend = fetchAllRows($conn, "
        SELECT eh.branch_id,
               DATE_FORMAT(pay.payment_date, '%Y-%m-%d') AS payment_date,
               COALESCE(NULLIF(TRIM(p.name), ''), 'Unassigned Program') AS program_name,
               COALESCE(SUM(pay.amount_paid), 0) AS total_amount
        FROM payment pay
        JOIN billing_schedule bs ON pay.billing_schedule_id = bs.billing_schedule_id
        JOIN enrollment_details ed ON bs.enrollment_details_id = ed.enrollment_details_id
        JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
        LEFT JOIN program p ON ed.program_id = p.program_id
        WHERE pay.payment_status = 'Received'
        GROUP BY eh.branch_id, DATE_FORMAT(pay.payment_date, '%Y-%m-%d'), COALESCE(NULLIF(TRIM(p.name), ''), 'Unassigned Program')
        ORDER BY payment_date ASC
    ");

    echo json_encode([
        'status' => 'success',
        'branches' => $branches,
        'payment_overview' => $paymentOverview,
        'due_today' => $dueToday,
        'overdue_payments' => $overduePayments,
        'recent_enrollments' => $recentEnrollments,
        'pending_payments' => $pendingPayments,
        'program_summary' => $programSummary,
        'enrollment_trend' => $enrollmentTrend,
        'payment_trend' => $paymentTrend
    ]);
} catch (Exception $e) {
    echo json_encode([
        'status' => 'error',
        'message' => $e->getMessage()
    ]);
}
?>
