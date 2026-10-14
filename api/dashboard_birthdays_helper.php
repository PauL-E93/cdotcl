<?php

function fetchDashboardBirthdays(PDO $conn, string $role, int $employeeId, int $branchId): array
{
    if (!in_array($role, ['owner', 'auditor', 'secretary', 'branch admin', 'teacher'], true) || $employeeId <= 0) {
        throw new RuntimeException('Administrator login is required.', 403);
    }
    if ($role === 'branch admin' && $branchId <= 0) {
        throw new RuntimeException('No branch access.', 403);
    }

    $sql = "SELECT DISTINCT st.student_id,
                   TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
                   st.birthday, eh.branch_id,
                   COALESCE(b.branch_name, 'Unassigned Center') AS branch_name
            FROM student st
            LEFT JOIN enrollment_header eh ON eh.student_id = st.student_id
            LEFT JOIN branch b ON eh.branch_id = b.branch_id
            WHERE st.birthday IS NOT NULL AND st.birthday > '0000-00-00'";
    $params = [];
    if ($role === 'branch admin') {
        $sql .= ' AND eh.branch_id = :branch_id';
        $params[':branch_id'] = $branchId;
    } elseif ($role === 'teacher') {
        // Restrict both students and center metadata to enrollments assigned to this teacher.
        $sql .= ' AND EXISTS (
            SELECT 1 FROM enrollment_details ed
            LEFT JOIN sections sec ON sec.section_id = ed.section_id
            WHERE ed.enrollment_header_id = eh.enrollment_header_id
              AND (ed.preferred_teacher = :preferred_teacher_id OR sec.employee_id = :section_teacher_id)
        )';
        $params[':preferred_teacher_id'] = $employeeId;
        $params[':section_teacher_id'] = $employeeId;
    }
    $sql .= ' ORDER BY st.birthday ASC, student_name ASC';
    $statement = $conn->prepare($sql);
    $statement->execute($params);
    return $statement->fetchAll(PDO::FETCH_ASSOC);
}
