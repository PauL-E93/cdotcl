<?php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

class EvaluationCard {
    private $criteriaLabels = [
        'Lesson Understanding',
        'Activity Performance',
        'Participation',
        'Focus and Attention',
        'Homework / Practice',
        'Behavior',
        'Improvement'
    ];

    private $gradeOptions = ['A+', 'A', 'B', 'C', 'D', 'F'];

    private function getDefaultLearningAreas($category = 'pre_school') {
        $names = [
            'Writing',
            'Reading',
            'Speaking',
            'Language',
            'Counting/Numbering',
            'Art and Craft',
            'Playing/Sharing'
        ];

        return array_map(function($name, $index) use ($category) {
            return [
                'area_id' => $index + 1,
                'area_name' => $name,
                'category' => $category,
                'order_index' => $index + 1,
                'is_active' => 1
            ];
        }, $names, array_keys($names));
    }

    private function ensureReportCardTables($conn) {
        $conn->exec("CREATE TABLE IF NOT EXISTS learning_areas (
                        area_id INT(11) NOT NULL AUTO_INCREMENT,
                        area_name VARCHAR(100) NOT NULL,
                        category VARCHAR(50) NOT NULL DEFAULT 'pre_school',
                        order_index INT(11) NOT NULL DEFAULT 1,
                        is_active TINYINT(1) NOT NULL DEFAULT 1,
                        PRIMARY KEY (area_id),
                        KEY idx_learning_areas_category (category, is_active, order_index)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");

        $conn->exec("CREATE TABLE IF NOT EXISTS student_grades (
                        grade_id INT(11) NOT NULL AUTO_INCREMENT,
                        enrollment_details_id INT(11) NOT NULL,
                        area_id INT(11) NOT NULL,
                        quarter TINYINT(1) NOT NULL,
                        grade_value VARCHAR(10) NOT NULL,
                        PRIMARY KEY (grade_id),
                        KEY idx_student_grades_enrollment (enrollment_details_id, quarter),
                        KEY idx_student_grades_area (area_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");

        $this->ensureColumn($conn, 'remarks', 'evaluation_id', 'INT(11) DEFAULT NULL AFTER employee_id');
        $this->ensureColumn($conn, 'remarks', 'quarter', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER evaluation_id');
        $this->ensureColumn($conn, 'remarks', 'overall_grade', 'VARCHAR(10) DEFAULT NULL AFTER status');
        $this->ensureColumn($conn, 'remarks', 'attendance', 'INT(11) DEFAULT NULL AFTER overall_grade');
        $this->ensureColumn($conn, 'remarks', 'total_school_days', 'INT(11) DEFAULT NULL AFTER attendance');

        $hasAnyLearningAreas = (int) $conn->query("SELECT COUNT(*) FROM learning_areas")->fetchColumn() > 0;
        foreach (['pre_school', 'play_school'] as $category) {
            $countStmt = $conn->prepare("SELECT COUNT(*) FROM learning_areas WHERE category = :category");
            $countStmt->execute([':category' => $category]);
            if ((int) $countStmt->fetchColumn() > 0) {
                continue;
            }

            if ($hasAnyLearningAreas) {
                continue;
            }

            $insertStmt = $conn->prepare("INSERT INTO learning_areas(area_name, category, order_index, is_active)
                                          VALUES(:area_name, :category, :order_index, 1)");
            foreach ($this->getDefaultLearningAreas($category) as $area) {
                $insertStmt->execute([
                    ':area_name' => $area['area_name'],
                    ':category' => $category,
                    ':order_index' => $area['order_index']
                ]);
            }
        }
    }

    private function ensureColumn($conn, $table, $column, $definition) {
        $stmt = $conn->prepare("SELECT COUNT(*)
                                FROM INFORMATION_SCHEMA.COLUMNS
                                WHERE TABLE_SCHEMA = DATABASE()
                                  AND TABLE_NAME = :table_name
                                  AND COLUMN_NAME = :column_name");
        $stmt->execute([
            ':table_name' => $table,
            ':column_name' => $column
        ]);

        if ((int) $stmt->fetchColumn() === 0) {
            $conn->exec("ALTER TABLE `{$table}` ADD COLUMN `{$column}` {$definition}");
        }
    }

    private function getReportCardCategory($programName) {
        return 'play_school';
    }

    private function getLearningAreas($conn, $category = 'pre_school') {
        try {
            $this->ensureReportCardTables($conn);
            $sql = "SELECT area_id, area_name, category, order_index, is_active
                    FROM learning_areas
                    WHERE category = :category AND is_active = 1
                    ORDER BY order_index ASC, area_id ASC";
            $stmt = $conn->prepare($sql);
            $stmt->execute([':category' => $category]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            return $rows ?: $this->getDefaultLearningAreas($category);
        } catch (Exception $e) {
            return $this->getDefaultLearningAreas($category);
        }
    }

    private function ensureSession() {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }
    }

    private function getPayload() {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true);

        if (!is_array($data)) {
            $data = $_POST;
        }

        if (isset($data['json'])) {
            $jsonData = json_decode($data['json'], true);
            if (is_array($jsonData)) {
                $data = array_merge($data, $jsonData);
            }
        }

        return $data;
    }

    private function requireTeacher() {
        $this->ensureSession();

        if (!isset($_SESSION['user_id'])) {
            echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
            return null;
        }

        return (int) $_SESSION['user_id'];
    }

    private function getUserRole() {
        $this->ensureSession();
        return strtolower(trim($_SESSION['user_role'] ?? ''));
    }

    private function isAdminRole($role) {
        return in_array($role, ['owner', 'secretary', 'branch admin', 'auditor'], true);
    }

    private function canAccessSection($conn, $sectionId, $employeeId, $role) {
        if ($this->isAdminRole($role)) {
            return true;
        }

        $sql = "SELECT section_id
                FROM sections
                WHERE section_id = :section_id
                  AND employee_id = :employee_id
                LIMIT 1";
        $stmt = $conn->prepare($sql);
        $stmt->execute([
            ':section_id' => $sectionId,
            ':employee_id' => $employeeId
        ]);

        return (bool) $stmt->fetch(PDO::FETCH_ASSOC);
    }

    private function teacherCanAccessEnrollment($conn, $enrollmentDetailsId, $teacherId) {
        $role = $this->getUserRole();
        if ($this->isAdminRole($role)) {
            return true;
        }

        $sql = "SELECT ed.enrollment_details_id
                FROM enrollment_details ed
                LEFT JOIN sections sec ON ed.section_id = sec.section_id
                WHERE ed.enrollment_details_id = :enrollment_details_id
                  AND (ed.preferred_teacher = :teacher_id OR sec.employee_id = :teacher_id)
                LIMIT 1";
        $stmt = $conn->prepare($sql);
        $stmt->execute([
            ':enrollment_details_id' => $enrollmentDetailsId,
            ':teacher_id' => $teacherId
        ]);

        return (bool) $stmt->fetch(PDO::FETCH_ASSOC);
    }

    private function readLearningGrades($data, $learningAreas = null) {
        $gradesInput = $data['grades'] ?? $data['scores'] ?? [];
        $grades = [];
        $areas = is_array($learningAreas) && count($learningAreas) > 0 ? $learningAreas : $this->getDefaultLearningAreas();

        foreach ($areas as $index => $area) {
            $value = null;
            $areaId = (int) ($area['area_id'] ?? ($index + 1));

            if (is_array($gradesInput)) {
                if (array_key_exists($index, $gradesInput)) {
                    $item = $gradesInput[$index];
                    $value = is_array($item) ? ($item['grade_value'] ?? $item['grade'] ?? '') : $item;
                } elseif (array_key_exists($areaId, $gradesInput)) {
                    $value = $gradesInput[$areaId];
                } elseif (array_key_exists("question" . ($index + 1), $gradesInput)) {
                    $value = $gradesInput["question" . ($index + 1)];
                }
            }

            if ($value === null && array_key_exists("question" . ($index + 1), $data)) {
                $value = $data["question" . ($index + 1)];
            }

            $grade = strtoupper(trim((string) $value));
            if ($grade === '') {
                return ['error' => "Grade for {$area['area_name']} is required"];
            }

            if (!in_array($grade, $this->gradeOptions, true)) {
                return ['error' => 'Grades must be A+, A, B, C, D, or F'];
            }

            $grades[] = [
                'area_id' => $areaId,
                'area_name' => $area['area_name'],
                'grade_value' => $grade
            ];
        }

        return ['grades' => $grades];
    }

    private function readScores($data) {
        $scoresInput = $data['scores'] ?? [];
        $scores = [];

        for ($i = 1; $i <= 7; $i++) {
            $value = null;

            if (is_array($scoresInput)) {
                if (array_key_exists($i - 1, $scoresInput)) {
                    $value = $scoresInput[$i - 1];
                } elseif (array_key_exists("question{$i}", $scoresInput)) {
                    $value = $scoresInput["question{$i}"];
                }
            }

            if ($value === null && array_key_exists("question{$i}", $data)) {
                $value = $data["question{$i}"];
            }

            if ($value === null || $value === '' || !is_numeric($value)) {
                return ['error' => "Score {$i} is required"];
            }

            $score = (float) $value;
            if ($score < 0 || $score > 100) {
                return ['error' => 'Scores must be between 0 and 100'];
            }

            $scores[$i] = round($score, 2);
        }

        return ['scores' => $scores];
    }

    private function formatReportCard($row) {
        if (!$row) {
            return null;
        }

        $criteria = [];
        $total = 0;
        $count = 0;

        for ($i = 1; $i <= 7; $i++) {
            $score = is_numeric($row["question{$i}"] ?? null) ? (float) $row["question{$i}"] : null;
            if ($score !== null) {
                $total += $score;
                $count++;
            }

            $criteria[] = [
                'label' => $this->criteriaLabels[$i - 1],
                'score' => $score
            ];
        }

        return [
            'remarks_id' => (int) $row['remarks_id'],
            'evaluation_id' => (int) $row['evaluation_id'],
            'status' => $row['status'],
            'remarks' => $row['remarks'] ?? '',
            'teacher_name' => $row['teacher_name'] ?? 'Teacher',
            'overall_average' => $count > 0 ? round($total / $count, 1) : null,
            'criteria' => $criteria
        ];
    }

    private function formatPreschoolQuarter($row, $gradeRows = [], $learningAreas = []) {
        if (!$row) {
            return null;
        }

        $grades = [];
        $gradeMap = [];
        foreach ($gradeRows as $gradeRow) {
            $gradeMap[(int) $gradeRow['area_id']] = $gradeRow['grade_value'] ?? '';
        }

        foreach ($learningAreas as $index => $area) {
            $areaId = (int) ($area['area_id'] ?? ($index + 1));
            $fallback = $row["question" . ($index + 1)] ?? '';
            $grades[] = [
                'area_id' => $areaId,
                'label' => $area['area_name'],
                'grade' => $gradeMap[$areaId] ?? $fallback
            ];
        }

        return [
            'remarks_id' => (int) $row['remarks_id'],
            'evaluation_id' => (int) $row['evaluation_id'],
            'quarter' => (int) ($row['quarter'] ?? 1),
            'overall_grade' => $row['overall_grade'] ?? '',
            'status' => $row['status'] ?? '',
            'attendance' => isset($row['attendance']) ? (int) $row['attendance'] : null,
            'total_school_days' => isset($row['total_school_days']) ? (int) $row['total_school_days'] : null,
            'remarks' => $row['remarks'] ?? '',
            'teacher_name' => $row['teacher_name'] ?? 'Teacher',
            'grades' => $grades
        ];
    }

    private function fetchLatestReportCard($conn, $enrollmentDetailsId, $teacherId = null) {
        $params = [':enrollment_details_id' => $enrollmentDetailsId];
        $teacherSql = '';

        if ($teacherId !== null) {
            $teacherSql = ' AND r.employee_id = :teacher_id';
            $params[':teacher_id'] = $teacherId;
        }

        $sql = "SELECT r.remarks_id,
                       r.enrollment_details_id,
                       r.employee_id,
                       r.evaluation_id,
                       r.status,
                       r.evaluation AS remarks,
                       e.question1,
                       e.question2,
                       e.question3,
                       e.question4,
                       e.question5,
                       e.question6,
                       e.question7,
                       CONCAT(emp.first_name, ' ', emp.last_name) AS teacher_name
                FROM remarks r
                LEFT JOIN evaluation e ON r.evaluation_id = e.evaluation_id
                LEFT JOIN employee emp ON r.employee_id = emp.employee_id
                WHERE r.enrollment_details_id = :enrollment_details_id{$teacherSql}
                ORDER BY r.remarks_id DESC
                LIMIT 1";
        $stmt = $conn->prepare($sql);
        $stmt->execute($params);

        return $stmt->fetch(PDO::FETCH_ASSOC);
    }

    private function fetchPreschoolQuarter($conn, $enrollmentDetailsId, $quarter, $learningAreas = []) {
        $sql = "SELECT r.remarks_id,
                       r.enrollment_details_id,
                       r.employee_id,
                       r.evaluation_id,
                       r.quarter,
                       r.status,
                       r.overall_grade,
                       r.attendance,
                       r.total_school_days,
                       r.evaluation AS remarks,
                       e.question1,
                       e.question2,
                       e.question3,
                       e.question4,
                       e.question5,
                       e.question6,
                       e.question7,
                       CONCAT(emp.first_name, ' ', emp.last_name) AS teacher_name
                FROM remarks r
                LEFT JOIN evaluation e ON r.evaluation_id = e.evaluation_id
                LEFT JOIN employee emp ON r.employee_id = emp.employee_id
                WHERE r.enrollment_details_id = :enrollment_details_id
                  AND r.quarter = :quarter
                ORDER BY r.remarks_id DESC
                LIMIT 1";
        $stmt = $conn->prepare($sql);
        $stmt->execute([
            ':enrollment_details_id' => $enrollmentDetailsId,
            ':quarter' => $quarter
        ]);

        $remark = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$remark) {
            return null;
        }

        $gradeRows = [];
        try {
            $gradeSql = "SELECT sg.area_id, sg.grade_value, la.area_name, la.order_index
                         FROM student_grades sg
                         JOIN learning_areas la ON sg.area_id = la.area_id
                         WHERE sg.enrollment_details_id = :enrollment_details_id
                           AND sg.quarter = :quarter
                         ORDER BY la.order_index ASC, la.area_id ASC";
            $gradeStmt = $conn->prepare($gradeSql);
            $gradeStmt->execute([
                ':enrollment_details_id' => $enrollmentDetailsId,
                ':quarter' => $quarter
            ]);
            $gradeRows = $gradeStmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (Exception $e) {
            $gradeRows = [];
        }

        return [
            'remark' => $remark,
            'grades' => $gradeRows
        ];
    }

    private function fetchPreschoolReportCard($conn, $enrollmentDetailsId, $category = 'pre_school') {
        $learningAreas = $this->getLearningAreas($conn, $category);
        $quarters = [];
        for ($quarter = 1; $quarter <= 4; $quarter++) {
            $quarterData = $this->fetchPreschoolQuarter($conn, $enrollmentDetailsId, $quarter, $learningAreas);
            $quarters[(string) $quarter] = $quarterData
                ? $this->formatPreschoolQuarter($quarterData['remark'], $quarterData['grades'], $learningAreas)
                : null;
        }

        return [
            'learning_areas' => array_map(function($area) {
                return [
                    'area_id' => (int) $area['area_id'],
                    'label' => $area['area_name']
                ];
            }, $learningAreas),
            'quarters' => $quarters,
            'grading_system' => [
                ['grade' => 'A+', 'label' => 'Excellent'],
                ['grade' => 'A', 'label' => 'Outstanding'],
                ['grade' => 'B', 'label' => 'Very Good'],
                ['grade' => 'C', 'label' => 'Good'],
                ['grade' => 'D', 'label' => 'Satisfaction'],
                ['grade' => 'F', 'label' => 'Fair']
            ]
        ];
    }

    private function getEnrollmentSummary($conn, $enrollmentDetailsId) {
        $sql = "SELECT ed.enrollment_details_id,
                       ed.section_id,
                       TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
                       p.name AS program_name,
                       sec.section_name,
                       sy.school_year,
                       CONCAT(sec_teacher.first_name, ' ', sec_teacher.last_name) AS section_teacher
                FROM enrollment_details ed
                JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                JOIN student st ON eh.student_id = st.student_id
                LEFT JOIN program p ON ed.program_id = p.program_id
                LEFT JOIN sections sec ON ed.section_id = sec.section_id
                LEFT JOIN employee sec_teacher ON sec.employee_id = sec_teacher.employee_id
                LEFT JOIN school_years sy ON eh.school_year_id = sy.school_year_id
                WHERE ed.enrollment_details_id = :enrollment_details_id
                LIMIT 1";
        $stmt = $conn->prepare($sql);
        $stmt->execute([':enrollment_details_id' => $enrollmentDetailsId]);
        return $stmt->fetch(PDO::FETCH_ASSOC);
    }

    function getEvaluation() {
        $teacherId = $this->requireTeacher();
        if ($teacherId === null) return;
        include "connection-pdo.php";
        $this->ensureReportCardTables($conn);

        $enrollmentDetailsId = isset($_GET['enrollment_details_id']) ? (int) $_GET['enrollment_details_id'] : 0;
        if ($enrollmentDetailsId <= 0) {
            echo json_encode(['status' => 'error', 'message' => 'Missing enrollment_details_id']);
            return;
        }

        if (!$this->teacherCanAccessEnrollment($conn, $enrollmentDetailsId, $teacherId)) {
            echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
            return;
        }

        $row = $this->fetchLatestReportCard($conn, $enrollmentDetailsId, $teacherId);
        echo json_encode([
            'status' => 'success',
            'data' => $this->formatReportCard($row)
        ]);
    }

    function saveEvaluation() {
        $teacherId = $this->requireTeacher();
        if ($teacherId === null) return;
        include "connection-pdo.php";
        $this->ensureReportCardTables($conn);

        $data = $this->getPayload();
        $enrollmentDetailsId = isset($data['enrollment_details_id']) ? (int) $data['enrollment_details_id'] : 0;

        if ($enrollmentDetailsId <= 0) {
            echo json_encode(['status' => 'error', 'message' => 'Missing enrollment_details_id']);
            return;
        }

        if (!$this->teacherCanAccessEnrollment($conn, $enrollmentDetailsId, $teacherId)) {
            echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
            return;
        }

        $scoreResult = $this->readScores($data);
        if (isset($scoreResult['error'])) {
            echo json_encode(['status' => 'error', 'message' => $scoreResult['error']]);
            return;
        }

        $scores = $scoreResult['scores'];
        $average = array_sum($scores) / count($scores);
        $status = strtolower(trim($data['status'] ?? ''));
        if (!in_array($status, ['passed', 'failed'])) {
            $status = $average >= 75 ? 'passed' : 'failed';
        }

        $remarks = trim($data['remarks'] ?? '');

        try {
            $conn->beginTransaction();

            $existing = $this->fetchLatestReportCard($conn, $enrollmentDetailsId, $teacherId);

            if ($existing) {
                $evaluationSql = "UPDATE evaluation
                                  SET question1 = :q1,
                                      question2 = :q2,
                                      question3 = :q3,
                                      question4 = :q4,
                                      question5 = :q5,
                                      question6 = :q6,
                                      question7 = :q7
                                  WHERE evaluation_id = :evaluation_id";
                $evaluationStmt = $conn->prepare($evaluationSql);
                $evaluationStmt->execute([
                    ':q1' => $scores[1],
                    ':q2' => $scores[2],
                    ':q3' => $scores[3],
                    ':q4' => $scores[4],
                    ':q5' => $scores[5],
                    ':q6' => $scores[6],
                    ':q7' => $scores[7],
                    ':evaluation_id' => $existing['evaluation_id']
                ]);

                $remarksSql = "UPDATE remarks
                               SET status = :status,
                                   evaluation = :remarks
                               WHERE remarks_id = :remarks_id";
                $remarksStmt = $conn->prepare($remarksSql);
                $remarksStmt->execute([
                    ':status' => $status,
                    ':remarks' => $remarks,
                    ':remarks_id' => $existing['remarks_id']
                ]);
            } else {
                $evaluationSql = "INSERT INTO evaluation
                                  (question1, question2, question3, question4, question5, question6, question7)
                                  VALUES (:q1, :q2, :q3, :q4, :q5, :q6, :q7)";
                $evaluationStmt = $conn->prepare($evaluationSql);
                $evaluationStmt->execute([
                    ':q1' => $scores[1],
                    ':q2' => $scores[2],
                    ':q3' => $scores[3],
                    ':q4' => $scores[4],
                    ':q5' => $scores[5],
                    ':q6' => $scores[6],
                    ':q7' => $scores[7]
                ]);

                $evaluationId = (int) $conn->lastInsertId();

                $remarksSql = "INSERT INTO remarks
                               (enrollment_details_id, employee_id, evaluation_id, status, evaluation)
                               VALUES (:enrollment_details_id, :employee_id, :evaluation_id, :status, :remarks)";
                $remarksStmt = $conn->prepare($remarksSql);
                $remarksStmt->execute([
                    ':enrollment_details_id' => $enrollmentDetailsId,
                    ':employee_id' => $teacherId,
                    ':evaluation_id' => $evaluationId,
                    ':status' => $status,
                    ':remarks' => $remarks
                ]);
            }

            $conn->commit();

            $saved = $this->fetchLatestReportCard($conn, $enrollmentDetailsId, $teacherId);
            echo json_encode([
                'status' => 'success',
                'message' => 'Report card saved successfully',
                'data' => $this->formatReportCard($saved)
            ]);
        } catch (Exception $e) {
            if ($conn->inTransaction()) {
                $conn->rollBack();
            }

            echo json_encode([
                'status' => 'error',
                'message' => $e->getMessage()
            ]);
        }
    }

    function getSectionReportCards() {
        $employeeId = $this->requireTeacher();
        if ($employeeId === null) return;
        include "connection-pdo.php";
        $this->ensureReportCardTables($conn);

        $sectionId = isset($_GET['section_id']) ? (int) $_GET['section_id'] : 0;
        if ($sectionId <= 0) {
            echo json_encode(['status' => 'error', 'message' => 'Missing section_id']);
            return;
        }

        $role = $this->getUserRole();
        if (!$this->canAccessSection($conn, $sectionId, $employeeId, $role)) {
            echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
            return;
        }

        try {
            $sectionSql = "SELECT sec.section_id,
                                  sec.section_name,
                                  sec.class_id,
                                  CONCAT(emp.first_name, ' ', emp.last_name) AS teacher_name,
                                  p.name AS program_name,
                                  b.branch_name
                           FROM sections sec
                           LEFT JOIN employee emp ON sec.employee_id = emp.employee_id
                           LEFT JOIN class c ON sec.class_id = c.class_id
                           LEFT JOIN program p ON c.program_id = p.program_id
                           LEFT JOIN branch b ON c.branch_id = b.branch_id
                           WHERE sec.section_id = :section_id
                           LIMIT 1";
            $sectionStmt = $conn->prepare($sectionSql);
            $sectionStmt->execute([':section_id' => $sectionId]);
            $section = $sectionStmt->fetch(PDO::FETCH_ASSOC);

            if (!$section) {
                echo json_encode(['status' => 'error', 'message' => 'Section not found']);
                return;
            }

            $studentsSql = "SELECT ed.enrollment_details_id,
                                   st.student_id,
                                   TRIM(CONCAT_WS(' ', st.first_name, st.last_name, NULLIF(TRIM(st.ext), ''))) AS student_name,
                                   p.name AS program_name,
                                   sy.school_year,
                                   COALESCE(NULLIF(eh.status, ''), ed.status) AS status,
                                   eh.date_created AS enrollment_date
                            FROM enrollment_details ed
                            JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                            JOIN student st ON eh.student_id = st.student_id
                            LEFT JOIN program p ON ed.program_id = p.program_id
                            LEFT JOIN school_years sy ON eh.school_year_id = sy.school_year_id
                            WHERE ed.section_id = :section_id
                            ORDER BY st.last_name ASC, st.first_name ASC";
            $studentsStmt = $conn->prepare($studentsSql);
            $studentsStmt->execute([':section_id' => $sectionId]);
            $students = $studentsStmt->fetchAll(PDO::FETCH_ASSOC);

            $category = $this->getReportCardCategory($section['program_name'] ?? '');
            foreach ($students as &$student) {
                $student['report_card'] = $this->fetchPreschoolReportCard($conn, (int) $student['enrollment_details_id'], $category);
            }
            unset($student);
            $learningAreas = $this->getLearningAreas($conn, $category);

            echo json_encode([
                'status' => 'success',
                'data' => [
                    'section' => $section,
                    'students' => $students,
                    'learning_areas' => array_map(function($area) {
                        return ['area_id' => (int) $area['area_id'], 'label' => $area['area_name']];
                    }, $learningAreas),
                    'grade_options' => $this->gradeOptions
                ]
            ]);
        } catch (Exception $e) {
            echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
        }
    }

    function getPreschoolReportCard() {
        $employeeId = $this->requireTeacher();
        if ($employeeId === null) return;
        include "connection-pdo.php";
        $this->ensureReportCardTables($conn);

        $enrollmentDetailsId = isset($_GET['enrollment_details_id']) ? (int) $_GET['enrollment_details_id'] : 0;
        if ($enrollmentDetailsId <= 0) {
            echo json_encode(['status' => 'error', 'message' => 'Missing enrollment_details_id']);
            return;
        }

        if (!$this->teacherCanAccessEnrollment($conn, $enrollmentDetailsId, $employeeId)) {
            echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
            return;
        }

        $summary = $this->getEnrollmentSummary($conn, $enrollmentDetailsId);
        $category = $this->getReportCardCategory($summary['program_name'] ?? '');
        echo json_encode([
            'status' => 'success',
            'data' => [
                'details' => $summary,
                'report_card' => $this->fetchPreschoolReportCard($conn, $enrollmentDetailsId, $category)
            ]
        ]);
    }

    function savePreschoolReportCard() {
        $employeeId = $this->requireTeacher();
        if ($employeeId === null) return;
        include "connection-pdo.php";
        $this->ensureReportCardTables($conn);

        $data = $this->getPayload();
        $enrollmentDetailsId = isset($data['enrollment_details_id']) ? (int) $data['enrollment_details_id'] : 0;
        $quarter = isset($data['quarter']) ? (int) $data['quarter'] : 0;

        if ($enrollmentDetailsId <= 0) {
            echo json_encode(['status' => 'error', 'message' => 'Missing enrollment_details_id']);
            return;
        }

        if ($quarter < 1 || $quarter > 4) {
            echo json_encode(['status' => 'error', 'message' => 'Quarter must be from 1 to 4']);
            return;
        }

        if (!$this->teacherCanAccessEnrollment($conn, $enrollmentDetailsId, $employeeId)) {
            echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
            return;
        }

        $summary = $this->getEnrollmentSummary($conn, $enrollmentDetailsId);
        $category = $this->getReportCardCategory($summary['program_name'] ?? '');
        $learningAreas = $this->getLearningAreas($conn, $category);
        $gradeResult = $this->readLearningGrades($data, $learningAreas);
        if (isset($gradeResult['error'])) {
            echo json_encode(['status' => 'error', 'message' => $gradeResult['error']]);
            return;
        }

        $grades = $gradeResult['grades'];
        $overallGrade = strtoupper(trim((string) ($data['overall_grade'] ?? '')));
        if (!in_array($overallGrade, $this->gradeOptions, true)) {
            $overallGrade = $grades[0]['grade_value'] ?? 'C';
        }

        $attendance = isset($data['attendance']) && $data['attendance'] !== '' ? max(0, (int) $data['attendance']) : null;
        $totalSchoolDays = isset($data['total_school_days']) && $data['total_school_days'] !== '' ? max(0, (int) $data['total_school_days']) : null;
        $remarks = trim((string) ($data['remarks'] ?? ''));
        $status = $overallGrade === 'F' ? 'failed' : 'passed';

        try {
            $conn->beginTransaction();
            $existingQuarter = $this->fetchPreschoolQuarter($conn, $enrollmentDetailsId, $quarter, $learningAreas);
            $existing = $existingQuarter ? $existingQuarter['remark'] : null;
            $questionGrades = [];
            foreach ($grades as $index => $grade) {
                $questionGrades[$index + 1] = $grade['grade_value'];
            }

            if ($existing) {
                $evaluationSql = "UPDATE evaluation
                                  SET question1 = :q1,
                                      question2 = :q2,
                                      question3 = :q3,
                                      question4 = :q4,
                                      question5 = :q5,
                                      question6 = :q6,
                                      question7 = :q7
                                  WHERE evaluation_id = :evaluation_id";
                $evaluationStmt = $conn->prepare($evaluationSql);
                $evaluationStmt->execute([
                    ':q1' => $questionGrades[1] ?? '',
                    ':q2' => $questionGrades[2] ?? '',
                    ':q3' => $questionGrades[3] ?? '',
                    ':q4' => $questionGrades[4] ?? '',
                    ':q5' => $questionGrades[5] ?? '',
                    ':q6' => $questionGrades[6] ?? '',
                    ':q7' => $questionGrades[7] ?? '',
                    ':evaluation_id' => $existing['evaluation_id']
                ]);

                $remarksSql = "UPDATE remarks
                               SET employee_id = :employee_id,
                                   status = :status,
                                   overall_grade = :overall_grade,
                                   attendance = :attendance,
                                   total_school_days = :total_school_days,
                                   evaluation = :remarks
                               WHERE remarks_id = :remarks_id";
                $remarksStmt = $conn->prepare($remarksSql);
                $remarksStmt->execute([
                    ':employee_id' => $employeeId,
                    ':status' => $status,
                    ':overall_grade' => $overallGrade,
                    ':attendance' => $attendance,
                    ':total_school_days' => $totalSchoolDays,
                    ':remarks' => $remarks,
                    ':remarks_id' => $existing['remarks_id']
                ]);
            } else {
                $evaluationSql = "INSERT INTO evaluation
                                  (question1, question2, question3, question4, question5, question6, question7)
                                  VALUES (:q1, :q2, :q3, :q4, :q5, :q6, :q7)";
                $evaluationStmt = $conn->prepare($evaluationSql);
                $evaluationStmt->execute([
                    ':q1' => $questionGrades[1] ?? '',
                    ':q2' => $questionGrades[2] ?? '',
                    ':q3' => $questionGrades[3] ?? '',
                    ':q4' => $questionGrades[4] ?? '',
                    ':q5' => $questionGrades[5] ?? '',
                    ':q6' => $questionGrades[6] ?? '',
                    ':q7' => $questionGrades[7] ?? ''
                ]);

                $evaluationId = (int) $conn->lastInsertId();

                $remarksSql = "INSERT INTO remarks
                               (enrollment_details_id, employee_id, evaluation_id, quarter, status, overall_grade, attendance, total_school_days, evaluation)
                               VALUES (:enrollment_details_id, :employee_id, :evaluation_id, :quarter, :status, :overall_grade, :attendance, :total_school_days, :remarks)";
                $remarksStmt = $conn->prepare($remarksSql);
                $remarksStmt->execute([
                    ':enrollment_details_id' => $enrollmentDetailsId,
                    ':employee_id' => $employeeId,
                    ':evaluation_id' => $evaluationId,
                    ':quarter' => $quarter,
                    ':status' => $status,
                    ':overall_grade' => $overallGrade,
                    ':attendance' => $attendance,
                    ':total_school_days' => $totalSchoolDays,
                    ':remarks' => $remarks
                ]);
            }

            foreach ($grades as $grade) {
                $findGradeSql = "SELECT grade_id
                                 FROM student_grades
                                 WHERE enrollment_details_id = :enrollment_details_id
                                   AND area_id = :area_id
                                   AND quarter = :quarter
                                 LIMIT 1";
                $findGradeStmt = $conn->prepare($findGradeSql);
                $findGradeStmt->execute([
                    ':enrollment_details_id' => $enrollmentDetailsId,
                    ':area_id' => $grade['area_id'],
                    ':quarter' => $quarter
                ]);
                $gradeId = $findGradeStmt->fetchColumn();

                if ($gradeId) {
                    $updateGradeSql = "UPDATE student_grades
                                       SET grade_value = :grade_value
                                       WHERE grade_id = :grade_id";
                    $updateGradeStmt = $conn->prepare($updateGradeSql);
                    $updateGradeStmt->execute([
                        ':grade_value' => $grade['grade_value'],
                        ':grade_id' => $gradeId
                    ]);
                } else {
                    $insertGradeSql = "INSERT INTO student_grades(enrollment_details_id, area_id, quarter, grade_value)
                                       VALUES(:enrollment_details_id, :area_id, :quarter, :grade_value)";
                    $insertGradeStmt = $conn->prepare($insertGradeSql);
                    $insertGradeStmt->execute([
                        ':enrollment_details_id' => $enrollmentDetailsId,
                        ':area_id' => $grade['area_id'],
                        ':quarter' => $quarter,
                        ':grade_value' => $grade['grade_value']
                    ]);
                }
            }

            $conn->commit();

            $savedQuarter = $this->fetchPreschoolQuarter($conn, $enrollmentDetailsId, $quarter, $learningAreas);
            echo json_encode([
                'status' => 'success',
                'message' => 'Quarter report card saved successfully',
                'data' => $savedQuarter
                    ? $this->formatPreschoolQuarter($savedQuarter['remark'], $savedQuarter['grades'], $learningAreas)
                    : null
            ]);
        } catch (Exception $e) {
            if ($conn->inTransaction()) {
                $conn->rollBack();
            }

            echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
        }
    }
}

$operation = $_GET['operation'] ?? '';
if (!$operation && $_SERVER['REQUEST_METHOD'] !== 'GET') {
    $payload = json_decode(file_get_contents('php://input'), true);
    $operation = is_array($payload) ? ($payload['operation'] ?? '') : ($_POST['operation'] ?? '');
}

$evaluation = new EvaluationCard();

switch ($operation) {
    case 'getEvaluation':
        $evaluation->getEvaluation();
        break;
    case 'saveEvaluation':
        $evaluation->saveEvaluation();
        break;
    case 'getSectionReportCards':
        $evaluation->getSectionReportCards();
        break;
    case 'getPreschoolReportCard':
        $evaluation->getPreschoolReportCard();
        break;
    case 'savePreschoolReportCard':
        $evaluation->savePreschoolReportCard();
        break;
    default:
        echo json_encode(['status' => 'error', 'message' => 'Invalid Operation']);
        break;
}
?>
