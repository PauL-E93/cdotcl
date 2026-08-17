<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

function normalizeSecretaryDashboardRole($role) {
    return preg_replace('/[\s_-]+/', ' ', strtolower(trim((string) $role)));
}

function requireSecretaryDashboardAccess() {
    if (normalizeSecretaryDashboardRole($_SESSION['user_role'] ?? '') !== 'secretary') {
        throw new Exception('Unauthorized');
    }
}

function fetchSecretaryDashboardRows($conn, $sql) {
    $statement = $conn->prepare($sql);
    $statement->execute();
    return $statement->fetchAll(PDO::FETCH_ASSOC);
}

function fetchSecretaryDashboardRow($conn, $sql) {
    return fetchSecretaryDashboardRows($conn, $sql)[0] ?? [];
}

try {
    requireSecretaryDashboardAccess();
    require_once __DIR__ . '/../admin/connection-pdo.php';

    $branches = fetchSecretaryDashboardRows($conn, "
        SELECT branch_id, branch_name, branch_location
        FROM branch
        ORDER BY branch_name
    ");

    $summaryAll = fetchSecretaryDashboardRow($conn, "
        SELECT
            (SELECT COUNT(*) FROM enrollment_header WHERE status = 'pending') AS pending_applications,
            (SELECT COUNT(*) FROM enrollment_preferred_schedule WHERE date = CURDATE() AND status <> 'cancelled') AS today_sessions,
            (SELECT COUNT(*) FROM payment WHERE payment_status = 'Pending') AS pending_payments,
            (SELECT COUNT(*) FROM employee WHERE status = 'active') AS active_employees,
            (SELECT COUNT(*) FROM enrollment_header) AS total_enrollments,
            (SELECT COUNT(*) FROM branch) AS total_centers
    ");

    $centerWorkload = fetchSecretaryDashboardRows($conn, "
        SELECT
            b.branch_id,
            b.branch_name,
            b.branch_location,
            (
                SELECT COUNT(*)
                FROM enrollment_header eh
                WHERE eh.branch_id = b.branch_id
            ) AS total_enrollments,
            (
                SELECT COUNT(*)
                FROM enrollment_header eh
                WHERE eh.branch_id = b.branch_id AND eh.status = 'pending'
            ) AS pending_applications,
            (
                SELECT COUNT(*)
                FROM employee emp
                WHERE emp.branch_id = b.branch_id AND emp.status = 'active'
            ) AS active_employees,
            (
                SELECT COUNT(*)
                FROM enrollment_preferred_schedule eps
                JOIN enrollment_details ed ON ed.enrollment_details_id = eps.enrollment_details_id
                JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
                WHERE eh.branch_id = b.branch_id
                  AND eps.date = CURDATE()
                  AND eps.status <> 'cancelled'
            ) AS today_sessions,
            (
                SELECT COUNT(*)
                FROM payment pay
                JOIN billing_schedule bs ON bs.billing_schedule_id = pay.billing_schedule_id
                JOIN enrollment_details ed ON ed.enrollment_details_id = bs.enrollment_details_id
                JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
                WHERE eh.branch_id = b.branch_id AND pay.payment_status = 'Pending'
            ) AS pending_payments
        FROM branch b
        ORDER BY b.branch_name
    ");

    $enrollmentPipeline = fetchSecretaryDashboardRows($conn, "
        SELECT branch_id, status, COUNT(*) AS total
        FROM enrollment_header
        GROUP BY branch_id, status
        ORDER BY status
    ");

    $enrollmentTrend = fetchSecretaryDashboardRows($conn, "
        SELECT branch_id, DATE_FORMAT(date_created, '%Y-%m-%d') AS enrollment_date, COUNT(*) AS total
        FROM enrollment_header
        WHERE DATE(date_created) >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
        GROUP BY branch_id, DATE_FORMAT(date_created, '%Y-%m-%d')
        ORDER BY enrollment_date
    ");

    $todaySchedules = fetchSecretaryDashboardRows($conn, "
        SELECT
            eh.branch_id,
            COALESCE(b.branch_name, 'Unassigned Center') AS branch_name,
            eps.preference_id,
            eps.start_time,
            eps.end_time,
            eps.status,
            TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
            COALESCE(p.name, 'Tutorial session') AS program_name,
            COALESCE(CONCAT_WS(' ', teacher.first_name, teacher.last_name), 'Teacher not assigned') AS teacher_name
        FROM enrollment_preferred_schedule eps
        JOIN enrollment_details ed ON ed.enrollment_details_id = eps.enrollment_details_id
        JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
        JOIN student st ON st.student_id = eh.student_id
        LEFT JOIN branch b ON b.branch_id = eh.branch_id
        LEFT JOIN program p ON p.program_id = ed.program_id
        LEFT JOIN employee teacher ON teacher.employee_id = ed.preferred_teacher
        WHERE eps.date = CURDATE() AND eps.status <> 'cancelled'
        ORDER BY eps.start_time
    ");

    $recentEnrollments = fetchSecretaryDashboardRows($conn, "
        SELECT
            eh.enrollment_header_id,
            eh.branch_id,
            COALESCE(b.branch_name, 'Unassigned Center') AS branch_name,
            TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
            COALESCE(GROUP_CONCAT(DISTINCT p.name ORDER BY p.name SEPARATOR ', '), 'No program selected') AS program_name,
            eh.status,
            DATE_FORMAT(eh.date_created, '%b %d, %Y') AS date_created
        FROM enrollment_header eh
        JOIN student st ON st.student_id = eh.student_id
        LEFT JOIN branch b ON b.branch_id = eh.branch_id
        LEFT JOIN enrollment_details ed ON ed.enrollment_header_id = eh.enrollment_header_id
        LEFT JOIN program p ON p.program_id = ed.program_id
        GROUP BY eh.enrollment_header_id, eh.branch_id, b.branch_name, st.first_name, st.last_name, st.ext, eh.status, eh.date_created
        ORDER BY eh.date_created DESC
        LIMIT 150
    ");

    $pendingPayments = fetchSecretaryDashboardRows($conn, "
        SELECT
            eh.branch_id,
            COALESCE(b.branch_name, 'Unassigned Center') AS branch_name,
            TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
            COALESCE(p.name, 'Tutorial payment') AS program_name,
            bs.billing_type,
            pay.amount_paid,
            DATE_FORMAT(pay.payment_date, '%b %d, %Y') AS payment_date
        FROM payment pay
        JOIN billing_schedule bs ON bs.billing_schedule_id = pay.billing_schedule_id
        JOIN enrollment_details ed ON ed.enrollment_details_id = bs.enrollment_details_id
        JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
        JOIN student st ON st.student_id = eh.student_id
        LEFT JOIN branch b ON b.branch_id = eh.branch_id
        LEFT JOIN program p ON p.program_id = ed.program_id
        WHERE pay.payment_status = 'Pending'
        ORDER BY pay.payment_date, pay.payment_id
        LIMIT 150
    ");

    $employeeSummary = fetchSecretaryDashboardRows($conn, "
        SELECT emp.branch_id, COALESCE(r.role_name, 'Employee') AS role_name, COUNT(*) AS total
        FROM employee emp
        LEFT JOIN role r ON r.role_id = emp.role_id
        WHERE emp.status = 'active'
        GROUP BY emp.branch_id, r.role_name
        ORDER BY total DESC, r.role_name
    ");

    echo json_encode([
        'status' => 'success',
        'branches' => $branches,
        'summary_all' => $summaryAll,
        'center_workload' => $centerWorkload,
        'enrollment_pipeline' => $enrollmentPipeline,
        'enrollment_trend' => $enrollmentTrend,
        'today_schedules' => $todaySchedules,
        'recent_enrollments' => $recentEnrollments,
        'pending_payments' => $pendingPayments,
        'employee_summary' => $employeeSummary
    ]);
} catch (Throwable $error) {
    http_response_code($error->getMessage() === 'Unauthorized' ? 401 : 500);
    echo json_encode([
        'status' => 'error',
        'message' => $error->getMessage()
    ]);
}
