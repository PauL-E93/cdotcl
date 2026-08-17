<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

function normalizeBranchAdminDashboardRole($role) {
    return preg_replace('/[\s_-]+/', ' ', strtolower(trim((string) $role)));
}

function getBranchAdminDashboardBranchId() {
    $role = normalizeBranchAdminDashboardRole($_SESSION['user_role'] ?? '');
    $branchId = intval($_SESSION['branch_id'] ?? 0);

    if ($role !== 'branch admin' || $branchId <= 0) {
        throw new Exception('Unauthorized - No branch access');
    }

    return $branchId;
}

function fetchBranchAdminDashboardRows($conn, $sql, $params = []) {
    $statement = $conn->prepare($sql);
    $statement->execute($params);
    return $statement->fetchAll(PDO::FETCH_ASSOC);
}

function fetchBranchAdminDashboardRow($conn, $sql, $params = []) {
    return fetchBranchAdminDashboardRows($conn, $sql, $params)[0] ?? [];
}

try {
    $branchId = getBranchAdminDashboardBranchId();
    require_once __DIR__ . '/../admin/connection-pdo.php';

    $params = [':branch_id' => $branchId];

    $branch = fetchBranchAdminDashboardRow($conn, "
        SELECT b.branch_id, b.branch_name, b.branch_location,
               COALESCE(CONCAT(manager.first_name, ' ', manager.last_name), 'No manager assigned') AS manager_name
        FROM branch b
        LEFT JOIN employee manager ON manager.employee_id = b.employee_id
        WHERE b.branch_id = :branch_id
        LIMIT 1
    ", $params);

    $summary = fetchBranchAdminDashboardRow($conn, "
        SELECT
            (
                SELECT COUNT(*)
                FROM enrollment_preferred_schedule eps
                JOIN enrollment_details ed ON ed.enrollment_details_id = eps.enrollment_details_id
                JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
                WHERE eh.branch_id = :branch_id
                  AND eps.date = CURDATE()
                  AND eps.status <> 'cancelled'
            ) AS today_sessions,
            (
                SELECT COUNT(DISTINCT ed.enrollment_details_id)
                FROM enrollment_details ed
                JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
                WHERE eh.branch_id = :branch_id
                  AND ed.status IN ('active', 'enrolled', 'pending')
            ) AS active_enrollments,
            (
                SELECT COUNT(*)
                FROM payment pay
                JOIN billing_schedule bs ON bs.billing_schedule_id = pay.billing_schedule_id
                JOIN enrollment_details ed ON ed.enrollment_details_id = bs.enrollment_details_id
                JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
                WHERE eh.branch_id = :branch_id
                  AND pay.payment_status = 'Pending'
            ) AS payments_to_receive,
            (
                SELECT COUNT(*)
                FROM class c
                WHERE c.branch_id = :branch_id
                  AND c.status IN ('open', 'full')
            ) AS open_classes,
            (
                SELECT COUNT(*)
                FROM enrollment_header eh
                WHERE eh.branch_id = :branch_id
                  AND eh.status = 'pending'
            ) AS pending_applications,
            (
                SELECT COUNT(*)
                FROM employee emp
                WHERE emp.branch_id = :branch_id
                  AND emp.status = 'active'
            ) AS active_employees
    ", $params);

    $todaySchedules = fetchBranchAdminDashboardRows($conn, "
        SELECT eps.preference_id,
               eps.start_time,
               eps.end_time,
               eps.status,
               TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
               COALESCE(p.name, 'Tutorial session') AS program_name,
               COALESCE(sub.subject_name, 'Subject not set') AS subject_name,
               COALESCE(CONCAT_WS(' ', teacher.first_name, teacher.last_name), 'Teacher not assigned') AS teacher_name
        FROM enrollment_preferred_schedule eps
        JOIN enrollment_details ed ON ed.enrollment_details_id = eps.enrollment_details_id
        JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
        JOIN student st ON st.student_id = eh.student_id
        LEFT JOIN program p ON p.program_id = ed.program_id
        LEFT JOIN subject sub ON sub.subject_id = ed.subject_id
        LEFT JOIN employee teacher ON teacher.employee_id = ed.preferred_teacher
        WHERE eh.branch_id = :branch_id
          AND eps.date = CURDATE()
          AND eps.status <> 'cancelled'
        ORDER BY eps.start_time ASC
    ", $params);

    $upcomingSchedules = fetchBranchAdminDashboardRows($conn, "
        SELECT eps.preference_id,
               eps.date,
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
        LEFT JOIN program p ON p.program_id = ed.program_id
        LEFT JOIN employee teacher ON teacher.employee_id = ed.preferred_teacher
        WHERE eh.branch_id = :branch_id
          AND eps.date > CURDATE()
          AND eps.status <> 'cancelled'
        ORDER BY eps.date ASC, eps.start_time ASC
        LIMIT 20
    ", $params);

    $billingQueue = fetchBranchAdminDashboardRows($conn, "
        SELECT bs.billing_schedule_id,
               bs.billing_type,
               bs.total_amount,
               bs.status,
               bs.due_date,
               TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
               COALESCE(p.name, 'Tutorial payment') AS program_name
        FROM billing_schedule bs
        JOIN enrollment_details ed ON ed.enrollment_details_id = bs.enrollment_details_id
        JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
        JOIN student st ON st.student_id = eh.student_id
        LEFT JOIN program p ON p.program_id = ed.program_id
        WHERE eh.branch_id = :branch_id
          AND bs.status IN ('unpaid', 'partial', 'overdue', 'pending')
        ORDER BY COALESCE(bs.due_date, '9999-12-31') ASC, bs.billing_schedule_id ASC
        LIMIT 100
    ", $params);

    $paymentsToReceive = fetchBranchAdminDashboardRows($conn, "
        SELECT pay.payment_id,
               pay.amount_paid,
               pay.payment_date,
               pay.payment_type,
               TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
               COALESCE(p.name, 'Tutorial payment') AS program_name
        FROM payment pay
        JOIN billing_schedule bs ON bs.billing_schedule_id = pay.billing_schedule_id
        JOIN enrollment_details ed ON ed.enrollment_details_id = bs.enrollment_details_id
        JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
        JOIN student st ON st.student_id = eh.student_id
        LEFT JOIN program p ON p.program_id = ed.program_id
        WHERE eh.branch_id = :branch_id
          AND pay.payment_status = 'Pending'
        ORDER BY pay.payment_date ASC, pay.payment_id ASC
        LIMIT 100
    ", $params);

    $activeEnrollments = fetchBranchAdminDashboardRows($conn, "
        SELECT ed.enrollment_details_id,
               eh.enrollment_header_id,
               TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
               COALESCE(p.name, 'Program not set') AS program_name,
               COALESCE(sub.subject_name, 'Subject not set') AS subject_name,
               COALESCE(CONCAT_WS(' ', teacher.first_name, teacher.last_name), 'Teacher not assigned') AS teacher_name,
               ed.status,
               DATE_FORMAT(eh.date_created, '%b %d, %Y') AS date_created
        FROM enrollment_details ed
        JOIN enrollment_header eh ON eh.enrollment_header_id = ed.enrollment_header_id
        JOIN student st ON st.student_id = eh.student_id
        LEFT JOIN program p ON p.program_id = ed.program_id
        LEFT JOIN subject sub ON sub.subject_id = ed.subject_id
        LEFT JOIN employee teacher ON teacher.employee_id = ed.preferred_teacher
        WHERE eh.branch_id = :branch_id
          AND ed.status IN ('active', 'enrolled', 'pending')
        ORDER BY eh.date_created DESC, ed.enrollment_details_id DESC
        LIMIT 100
    ", $params);

    $enrollmentPipeline = fetchBranchAdminDashboardRows($conn, "
        SELECT eh.status, COUNT(*) AS total
        FROM enrollment_header eh
        WHERE eh.branch_id = :branch_id
        GROUP BY eh.status
        ORDER BY eh.status
    ", $params);

    $classOverview = fetchBranchAdminDashboardRows($conn, "
        SELECT c.class_id,
               c.status,
               COALESCE(p.name, 'Program not set') AS program_name,
               COUNT(DISTINCT sec.section_id) AS sections_count,
               COUNT(DISTINCT ed.enrollment_details_id) AS enrolled_count
        FROM class c
        LEFT JOIN program p ON p.program_id = c.program_id
        LEFT JOIN sections sec ON sec.class_id = c.class_id
        LEFT JOIN enrollment_details ed ON ed.section_id = sec.section_id
        WHERE c.branch_id = :branch_id
        GROUP BY c.class_id, c.status, p.name
        ORDER BY FIELD(c.status, 'open', 'full', 'close', 'completed'), p.name
    ", $params);

    $recentEnrollments = fetchBranchAdminDashboardRows($conn, "
        SELECT eh.enrollment_header_id,
               TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
               COALESCE(GROUP_CONCAT(DISTINCT p.name ORDER BY p.name SEPARATOR ', '), 'No program selected') AS program_name,
               eh.status,
               DATE_FORMAT(eh.date_created, '%b %d, %Y') AS date_created
        FROM enrollment_header eh
        JOIN student st ON st.student_id = eh.student_id
        LEFT JOIN enrollment_details ed ON ed.enrollment_header_id = eh.enrollment_header_id
        LEFT JOIN program p ON p.program_id = ed.program_id
        WHERE eh.branch_id = :branch_id
        GROUP BY eh.enrollment_header_id, st.first_name, st.last_name, st.ext, eh.status, eh.date_created
        ORDER BY eh.date_created DESC
        LIMIT 50
    ", $params);

    $staffSummary = fetchBranchAdminDashboardRows($conn, "
        SELECT COALESCE(r.role_name, 'Employee') AS role_name, COUNT(*) AS total
        FROM employee emp
        LEFT JOIN role r ON r.role_id = emp.role_id
        WHERE emp.branch_id = :branch_id
          AND emp.status = 'active'
        GROUP BY r.role_name
        ORDER BY total DESC, r.role_name
    ", $params);

    echo json_encode([
        'status' => 'success',
        'branch' => $branch,
        'summary' => $summary,
        'today_schedules' => $todaySchedules,
        'upcoming_schedules' => $upcomingSchedules,
        'billing_queue' => $billingQueue,
        'payments_to_receive' => $paymentsToReceive,
        'active_enrollments_detail' => $activeEnrollments,
        'enrollment_pipeline' => $enrollmentPipeline,
        'class_overview' => $classOverview,
        'recent_enrollments' => $recentEnrollments,
        'staff_summary' => $staffSummary
    ]);
} catch (Throwable $error) {
    http_response_code($error->getMessage() === 'Unauthorized - No branch access' ? 401 : 500);
    echo json_encode([
        'status' => 'error',
        'message' => $error->getMessage()
    ]);
}
