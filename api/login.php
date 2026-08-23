<?php
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
// Set headers for JSON content and CORS
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");

class Login {
    private const SESSION_IDLE_TIMEOUT_SECONDS = 600;
    private const CAPTCHA_TTL_SECONDS = 300;
    private const MAX_CAPTCHA_CHALLENGES = 5;
    private $captchaFailureMessage = 'CAPTCHA verification failed';

    private function normalizeRole($role) {
        return preg_replace('/[\s_-]+/', ' ', strtolower(trim((string) $role)));
    }

    private function clearSessionState() {
        $_SESSION = [];

        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(
                session_name(),
                '',
                time() - 42000,
                $params['path'],
                $params['domain'],
                $params['secure'],
                $params['httponly']
            );
        }

        session_destroy();
    }

    private function handleSessionTimeout() {
        if (empty($_SESSION['user_id'])) {
            return true;
        }   

        $now = time();
        $lastActivity = isset($_SESSION['last_activity']) ? (int) $_SESSION['last_activity'] : $now;

        if (($now - $lastActivity) > self::SESSION_IDLE_TIMEOUT_SECONDS) {
            $this->clearSessionState();
            return false;
        }

        $_SESSION['last_activity'] = $now;
        return true;
    }

    private function generateCaptchaChallenge() {
        $firstNumber = random_int(10, 99);
        $secondNumber = random_int(1, 9);
        $challengeId = bin2hex(random_bytes(16));
        $now = time();
        $challenges = $_SESSION['captcha_challenges'] ?? [];

        if (!is_array($challenges)) {
            $challenges = [];
        }

        foreach ($challenges as $id => $challenge) {
            if (!is_array($challenge) || ($challenge['expires_at'] ?? 0) < $now) {
                unset($challenges[$id]);
            }
        }

        $challenges[$challengeId] = [
            'answer' => (string) ($firstNumber + $secondNumber),
            'expires_at' => $now + self::CAPTCHA_TTL_SECONDS
        ];

        if (count($challenges) > self::MAX_CAPTCHA_CHALLENGES) {
            uasort($challenges, function ($a, $b) {
                return ($a['expires_at'] ?? 0) <=> ($b['expires_at'] ?? 0);
            });
            $challenges = array_slice($challenges, -self::MAX_CAPTCHA_CHALLENGES, null, true);
        }

        $_SESSION['captcha_challenges'] = $challenges;
        unset($_SESSION['captcha_answer']);

        return [
            'challenge_id' => $challengeId,
            'first_number' => $firstNumber,
            'second_number' => $secondNumber,
            'expires_in_seconds' => self::CAPTCHA_TTL_SECONDS
        ];
    }

    private function verifyCaptcha($submittedAnswer, $challengeId) {
        $challengeId = trim((string) $challengeId);
        $submittedAnswer = trim((string) $submittedAnswer);
        $challenges = $_SESSION['captcha_challenges'] ?? [];
        $challenge = is_array($challenges) && $challengeId !== ''
            ? ($challenges[$challengeId] ?? null)
            : null;

        if (is_array($challenge) && is_array($challenges)) {
            // Every challenge is single-use, including an incorrect attempt.
            unset($challenges[$challengeId]);
            $_SESSION['captcha_challenges'] = $challenges;
        }

        $expectedAnswer = is_array($challenge) ? ($challenge['answer'] ?? null) : null;
        $expiresAt = is_array($challenge) ? (int) ($challenge['expires_at'] ?? 0) : 0;

        if (!is_string($expectedAnswer) || $expiresAt < time()) {
            $this->captchaFailureMessage = 'CAPTCHA expired. Please solve the new challenge.';
            return false;
        }

        if ($submittedAnswer === '' || !hash_equals($expectedAnswer, $submittedAnswer)) {
            $this->captchaFailureMessage = 'CAPTCHA answer is incorrect.';
            return false;
        }

        return true;
    }

    private function generateSessionToken($userId) {
        $seed = random_bytes(32);
        $tokenBody = bin2hex($seed) . '|' . (int) $userId . '|' . session_id();
        return 'sess_' . substr(hash('sha256', $tokenBody), 0, 64);
    }

    private function sessionUserFromDatabase() {
        if (empty($_SESSION['user_id']) || empty($_SESSION['user_role'])) {
            return null;
        }

        include "admin/connection-pdo.php";

        $role = $this->normalizeRole($_SESSION['user_role']);
        $userType = $_SESSION['user_type'] ?? ($role === 'student' ? 'student' : 'employee');
        $userId = (int) $_SESSION['user_id'];

        if ($userType === 'student') {
            $stmt = $conn->prepare("
                SELECT
                    s.student_id AS user_id,
                    s.username,
                    r.role_name,
                    'student' AS user_type
                FROM student s
                JOIN role r ON s.role_id = r.role_id
                WHERE s.student_id = :user_id
                LIMIT 1
            ");
        } else {
            $stmt = $conn->prepare("
                SELECT
                    e.employee_id AS user_id,
                    e.username,
                    e.status,
                    r.role_name,
                    'employee' AS user_type
                FROM employee e
                JOIN role r ON e.role_id = r.role_id
                WHERE e.employee_id = :user_id
                LIMIT 1
            ");
        }

        $stmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
        $stmt->execute();
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$user || (($user['status'] ?? 'active') === 'inactive')) {
            return null;
        }

        unset($user['status']);
        return $this->rememberSessionUser($user);
    }

    private function rememberSessionUser($user) {
        $sessionUser = [
            'user_id' => (int) $user['user_id'],
            'username' => $user['username'],
            'role_name' => $this->normalizeRole($user['role_name']),
            'user_type' => $user['user_type']
        ];

        $_SESSION['last_activity'] = time();

        if (empty($_SESSION['session_token'])) {
            $_SESSION['session_token'] = $this->generateSessionToken($sessionUser['user_id']);
        }

        $sessionUser['session_token'] = $_SESSION['session_token'];
        $_SESSION['auth_user'] = $sessionUser;

        return $sessionUser;
    }

    private function getSessionUser() {
        if (empty($_SESSION['user_id']) || empty($_SESSION['user_role'])) {
            return null;
        }

        if (!$this->handleSessionTimeout()) {
            return null;
        }

        if (!empty($_SESSION['auth_user']) && is_array($_SESSION['auth_user'])) {
            $user = $_SESSION['auth_user'];
            $user['user_id'] = (int) ($user['user_id'] ?? $_SESSION['user_id']);
            $user['role_name'] = $this->normalizeRole($user['role_name'] ?? $_SESSION['user_role']);
            $user['user_type'] = $user['user_type'] ?? ($_SESSION['user_type'] ?? ($user['role_name'] === 'student' ? 'student' : 'employee'));
            return $user;
        }

        return $this->sessionUserFromDatabase();
    }

    private function rejectIfAlreadyLoggedIn() {
        $user = $this->getSessionUser();

        if (!$user) {
            return false;
        }

        echo json_encode([
            "status" => "already_authenticated",
            "message" => "You are already logged in. Please log out before using another account.",
            "user" => $user
        ]);
        return true;
    }

    function captcha() {
        echo json_encode([
            "status" => "success",
            "captcha" => $this->generateCaptchaChallenge()
        ]);
    }

    function session() {
        $user = $this->getSessionUser();

        if (!$user) {
            echo json_encode([
                "status" => "error",
                "message" => "Not authenticated"
            ]);
            return;
        }

        echo json_encode([
            "status" => "success",
            "user" => $user,
            "session_token" => $_SESSION['session_token'] ?? null
        ]);
    }

    // --- LOGIN FUNCTION ---
    function login($json) {
        if ($this->rejectIfAlreadyLoggedIn()) {
            return;
        }

        include "admin/connection-pdo.php";

        $data = json_decode($json, true);

        if (empty($data['username']) || empty($data['password'])) {
            echo json_encode([
                "status" => "error",
                "message" => "Username and password are required"
            ]);
            return;
        }

        if (!$this->verifyCaptcha(
            $data['captcha_answer'] ?? null,
            $data['captcha_challenge_id'] ?? null
        )) {
            echo json_encode([
                "status" => "error",
                "message" => $this->captchaFailureMessage
            ]);
            return;
        }

        $username = $data['username'];
        $password = $data['password'];

        /* =======================
           1. CHECK STUDENT
        ======================= */
        $sqlStudent = "
            SELECT 
                s.student_id AS user_id,
                s.username,
                s.password_hash,
                r.role_name,
                'student' AS user_type
            FROM student s
            JOIN role r ON s.role_id = r.role_id
            WHERE s.username = :username
            LIMIT 1
        ";

        $stmt = $conn->prepare($sqlStudent);
        $stmt->bindParam(":username", $username);
        $stmt->execute();
        $student = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($student && password_verify($password, $student['password_hash'])) {
            session_regenerate_id(true);
            unset($_SESSION['employee_id'], $_SESSION['branch_id']);
            $_SESSION['user_id'] = $student['user_id'];
            $_SESSION['user_role'] = 'student';
            $_SESSION['user_type'] = 'student';
            $_SESSION['student_id'] = $student['user_id'];

            unset($student['password_hash']);
            $student = $this->rememberSessionUser($student);
            echo json_encode([
                "status" => "success",
                "user" => $student,
                "session_token" => $student['session_token'] ?? null
            ]);
            return;
        }

        /* =======================
           2. CHECK EMPLOYEE
        ======================= */
        $sqlEmployee = "
            SELECT 
                e.employee_id AS user_id,
                e.username,
                e.password_hash,
                e.status,
                r.role_name,
                'employee' AS user_type
            FROM employee e
            JOIN role r ON e.role_id = r.role_id
            WHERE e.username = :username
            LIMIT 1
        ";

        $stmt = $conn->prepare($sqlEmployee);
        $stmt->bindParam(":username", $username);
        $stmt->execute();
        $employee = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($employee && password_verify($password, $employee['password_hash'])) {
            if ($employee['status'] === 'inactive') {
                echo json_encode([
                    "status" => "error",
                    "message" => "Employee account is inactive"
                ]);
                return;
            }

            session_regenerate_id(true);
            unset($_SESSION['student_id'], $_SESSION['branch_id']);
            $_SESSION['user_id'] = $employee['user_id'];
            $_SESSION['user_role'] = $this->normalizeRole($employee['role_name']);
            $_SESSION['user_type'] = 'employee';
            $_SESSION['employee_id'] = $employee['user_id'];

            // Get branch_id for the employee
            $branchStmt = $conn->prepare("SELECT branch_id FROM employee WHERE employee_id = :eid");
            $branchStmt->bindParam(":eid", $employee['user_id']);
            $branchStmt->execute();
            $branch = $branchStmt->fetch(PDO::FETCH_ASSOC);
            if ($branch && $branch['branch_id']) {
                $_SESSION['branch_id'] = $branch['branch_id'];
            }

            unset($employee['password_hash'], $employee['status']);
            $employee = $this->rememberSessionUser($employee);
            echo json_encode([
                "status" => "success",
                "user" => $employee,
                "session_token" => $employee['session_token'] ?? null
            ]);
            return;
        }

        echo json_encode([
            "status" => "error",
            "message" => "Invalid username or password"
        ]);
    }

    // --- SIGNUP FUNCTION (Must be INSIDE the class) ---
    function signup($json) {
        include "admin/connection-pdo.php"; // ensure this file creates $conn

        $data = json_decode($json, true);

        if (empty($data['first_name']) || empty($data['last_name']) || empty($data['username']) || empty($data['password'])) {
            echo json_encode(["status" => "error", "message" => "Missing required fields"]);
            return;
        }

        $first_name = $data['first_name'];
        $middle_name = $data['middle_name'] ?? null;
        $last_name = $data['last_name'];
        $username = $data['username'];
        $password = password_hash($data['password'], PASSWORD_DEFAULT);

        // Get STUDENT role_id
        $roleStmt = $conn->prepare("SELECT role_id FROM role WHERE role_name = 'student' LIMIT 1");
        $roleStmt->execute();
        $role = $roleStmt->fetch(PDO::FETCH_ASSOC);

        if (!$role) {
            echo json_encode(["status" => "error", "message" => "Student role not found"]);
            return;
        }

        $role_id = $role['role_id'];

        // Check username
        $check = $conn->prepare("SELECT COUNT(*) FROM student WHERE username = :username");
        $check->bindParam(":username", $username);
        $check->execute();

        if ($check->fetchColumn() > 0) {
            echo json_encode(["status" => "error", "message" => "Username already exists"]);
            return;
        }

        // Insert student
        $sql = "INSERT INTO student 
            (first_name, middle_name, last_name, ext, username, password_hash, role_id, status, date_created)
            VALUES 
            (:first_name, :middle_name, :last_name, '', :username, :password, :role_id, 'active', NOW())";

        $stmt = $conn->prepare($sql);
        $stmt->execute([
            ":first_name" => $first_name,
            ":middle_name" => $middle_name,
            ":last_name" => $last_name,
            ":username" => $username,
            ":password" => $password,
            ":role_id" => $role_id
        ]);

        echo json_encode(["status" => "success", "message" => "Account created successfully"]);
    }

    function logout() {
        $this->clearSessionState();
        echo json_encode(["status" => "success", "message" => "Logged out successfully"]);
    }
} // <--- CLOSE THE CLASS HERE, NOT EARLIER

// --- MAIN EXECUTION ---
$operation = "";
$json = "";

if ($_SERVER['REQUEST_METHOD'] == 'GET'){
    $operation = $_GET['operation'] ?? "";
    $json = $_GET['json'] ?? "";
} else if($_SERVER['REQUEST_METHOD'] == 'POST'){
    $operation = $_POST['operation'] ?? "";
    $json = $_POST['json'] ?? "";
}

$login = new Login();
switch($operation){
    case "login":
        $login->login($json);
        break;
    case "captcha":
        $login->captcha();
        break;
    case "session":
        $login->session();
        break;
    case "signup":
        $login->signup($json); // This will now work
        break;
    case "logout":
        $login->logout();
        break;
    default:
        echo json_encode(["status" => "error", "message" => "Invalid Operation"]);
        break;
}
?>  
