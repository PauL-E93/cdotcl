<?php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

function normalizeOwnerDashboardRole($role) {
    $role = strtolower(trim((string) $role));
    return preg_replace('/[\s_-]+/', ' ', $role);
}

function requireOwnerDashboardAccess() {
    if (normalizeOwnerDashboardRole($_SESSION['user_role'] ?? '') !== 'owner') {
        throw new Exception('Unauthorized');
    }
}

function fetchOwnerDashboardRows($conn, $sql) {
    $stmt = $conn->prepare($sql);
    $stmt->execute();
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

function fetchOwnerDashboardRow($conn, $sql) {
    return fetchOwnerDashboardRows($conn, $sql)[0] ?? [];
}

try {
    requireOwnerDashboardAccess();
    include __DIR__ . '/../admin/connection-pdo.php';

    $branches = fetchOwnerDashboardRows($conn, "
        SELECT branch_id, branch_name, branch_location
        FROM branch
        ORDER BY branch_name ASC
    ");

    $summaryAll = fetchOwnerDashboardRow($conn, "
        SELECT (SELECT COUNT(*) FROM branch) AS total_branches,
               (SELECT COUNT(*) FROM employee WHERE status = 'active') AS active_employees,
               (SELECT COUNT(*) FROM program WHERE status = 'active') AS active_programs,
               (SELECT COUNT(*) FROM class WHERE status IN ('open', 'full')) AS active_classes,
               (SELECT COUNT(DISTINCT enrollment_details_id) FROM enrollment_details) AS total_enrollments,
               (SELECT COALESCE(SUM(amount_paid), 0) FROM payment WHERE payment_status = 'Received') AS received_revenue,
               (SELECT COUNT(*) FROM payment WHERE payment_status = 'Pending') AS pending_payments,
               (SELECT COUNT(*) FROM product WHERE quantity <= 10 OR status IN ('low stacks', 'critical stacks')) AS low_stock_products
    ");

    $branchPerformance = fetchOwnerDashboardRows($conn, "
        SELECT b.branch_id,
               b.branch_name,
               b.branch_location,
               (SELECT COUNT(*) FROM employee emp WHERE emp.branch_id = b.branch_id AND emp.status = 'active') AS active_employees,
               (SELECT COUNT(*) FROM class cls WHERE cls.branch_id = b.branch_id AND cls.status IN ('open', 'full')) AS active_classes,
               (SELECT COUNT(DISTINCT ed.enrollment_details_id)
                FROM enrollment_details ed
                JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                WHERE eh.branch_id = b.branch_id) AS total_enrollments,
               (SELECT COALESCE(SUM(pay.amount_paid), 0)
                FROM payment pay
                JOIN billing_schedule bs ON pay.billing_schedule_id = bs.billing_schedule_id
                JOIN enrollment_details ed ON bs.enrollment_details_id = ed.enrollment_details_id
                JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                WHERE eh.branch_id = b.branch_id AND pay.payment_status = 'Received') AS received_revenue,
               (SELECT COUNT(*)
                FROM payment pay
                JOIN billing_schedule bs ON pay.billing_schedule_id = bs.billing_schedule_id
                JOIN enrollment_details ed ON bs.enrollment_details_id = ed.enrollment_details_id
                JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                WHERE eh.branch_id = b.branch_id AND pay.payment_status = 'Pending') AS pending_payments
        FROM branch b
        ORDER BY b.branch_name ASC
    ");

    $paymentOverview = fetchOwnerDashboardRows($conn, "
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

    $recentEnrollments = fetchOwnerDashboardRows($conn, "
        SELECT ed.enrollment_details_id,
               eh.branch_id,
               COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name,
               TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
               p.name AS program_name,
               DATE_FORMAT(eh.date_created, '%b %d, %Y') AS enrollment_date,
               COALESCE(NULLIF(eh.status, ''), ed.status, 'pending') AS status
        FROM enrollment_details ed
        JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
        JOIN student st ON eh.student_id = st.student_id
        LEFT JOIN branch b ON eh.branch_id = b.branch_id
        LEFT JOIN program p ON ed.program_id = p.program_id
        ORDER BY eh.date_created DESC, ed.enrollment_details_id DESC
        LIMIT 300
    ");

    $pendingPayments = fetchOwnerDashboardRows($conn, "
        SELECT pay.payment_id,
               eh.branch_id,
               COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name,
               TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
               p.name AS program_name,
               bs.billing_type,
               DATE_FORMAT(pay.payment_date, '%b %d, %Y') AS payment_date,
               COALESCE(pay.amount_paid, 0) AS amount
        FROM payment pay
        JOIN billing_schedule bs ON pay.billing_schedule_id = bs.billing_schedule_id
        JOIN enrollment_details ed ON bs.enrollment_details_id = ed.enrollment_details_id
        JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
        JOIN student st ON eh.student_id = st.student_id
        LEFT JOIN branch b ON eh.branch_id = b.branch_id
        LEFT JOIN program p ON ed.program_id = p.program_id
        WHERE pay.payment_status = 'Pending'
        ORDER BY pay.payment_date ASC, pay.payment_id ASC
    ");

    $recentEmployees = fetchOwnerDashboardRows($conn, "
        SELECT emp.employee_id,
               emp.branch_id,
               COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name,
               CONCAT(emp.first_name, ' ', emp.last_name) AS employee_name,
               r.role_name,
               emp.status,
               DATE_FORMAT(emp.date_created, '%b %d, %Y') AS date_created
        FROM employee emp
        JOIN role r ON emp.role_id = r.role_id
        LEFT JOIN branch b ON emp.branch_id = b.branch_id
        ORDER BY emp.date_created DESC, emp.employee_id DESC
        LIMIT 100
    ");

    $lowStockProducts = fetchOwnerDashboardRows($conn, "
        SELECT product_id, name, quantity, status
        FROM product
        WHERE quantity <= 10 OR status IN ('low stacks', 'critical stacks')
        ORDER BY quantity ASC, name ASC
        LIMIT 30
    ");

    $enrollmentTrend = fetchOwnerDashboardRows($conn, "
        SELECT eh.branch_id,
               DATE_FORMAT(eh.date_created, '%Y-%m-%d') AS enrollment_date,
               COUNT(DISTINCT ed.enrollment_details_id) AS total_enrollments
        FROM enrollment_details ed
        JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
        GROUP BY eh.branch_id, DATE_FORMAT(eh.date_created, '%Y-%m-%d')
        ORDER BY enrollment_date ASC
    ");

    $programEnrollments = fetchOwnerDashboardRows($conn, "
        SELECT eh.branch_id,
               DATE_FORMAT(eh.date_created, '%Y-%m-%d') AS enrollment_date,
               COALESCE(NULLIF(TRIM(p.name), ''), 'Unassigned Program') AS program_name,
               COUNT(DISTINCT ed.enrollment_details_id) AS total_enrollments
        FROM enrollment_details ed
        JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
        LEFT JOIN program p ON ed.program_id = p.program_id
        GROUP BY eh.branch_id, DATE_FORMAT(eh.date_created, '%Y-%m-%d'), COALESCE(NULLIF(TRIM(p.name), ''), 'Unassigned Program')
        ORDER BY enrollment_date ASC, program_name ASC
    ");

    $paymentTrend = fetchOwnerDashboardRows($conn, "
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
        'summary_all' => $summaryAll,
        'branch_performance' => $branchPerformance,
        'payment_overview' => $paymentOverview,
        'recent_enrollments' => $recentEnrollments,
        'pending_payments' => $pendingPayments,
        'recent_employees' => $recentEmployees,
        'low_stock_products' => $lowStockProducts,
        'enrollment_trend' => $enrollmentTrend,
        'program_enrollments' => $programEnrollments,
        'payment_trend' => $paymentTrend
    ]);
} catch (Exception $e) {
    echo json_encode([
        'status' => 'error',
        'message' => $e->getMessage()
    ]);
}
?>
