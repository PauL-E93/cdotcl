<?php
// 1. Include PHPMailer classes
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

// Ensure these paths match where you placed the PHPMailer folder
require 'PHPMailer/src/Exception.php';
require 'PHPMailer/src/PHPMailer.php';
require 'PHPMailer/src/SMTP.php';

session_start();

header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

class ForgotPassword {
    private $conn;

    public function __construct() {
        include "admin/connection-pdo.php";
        $this->conn = $conn;
    }

    /**
     * Updated sendEmail using PHPMailer and Gmail SMTP
     */
    private function sendEmail($to, $subject, $message) {
        $mail = new PHPMailer(true);

        try {
            // Server settings
            $mail->isSMTP();
            $mail->Host       = 'smtp.gmail.com';
            $mail->SMTPAuth   = true;
            $mail->Username   = 'espinosapaul810@gmail.com'; // YOUR GMAIL
            $mail->Password   = 'yjds vbuo gxas knkm';   // YOUR 16-DIGIT APP PASSWORD  
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
            $mail->Port       = 587;

            // Fix for Localhost SSL certificate issues
            $mail->SMTPOptions = array(
                'ssl' => array(
                    'verify_peer' => false,
                    'verify_peer_name' => false,
                    'allow_self_signed' => true
                )
            );

            // Recipients
            $mail->setFrom('espinosapaul810@gmail.com', 'CDO Tutor');
            $mail->addAddress($to);

            // Content
            $mail->isHTML(false);
            $mail->Subject = $subject;
            $mail->Body    = $message;

            return $mail->send();
        } catch (Exception $e) {
            // You can log $mail->ErrorInfo here if you need to debug
            return false;
        }
    }

    private function findUserByEmail($email) {
        $sqlStudent = "SELECT student_id AS user_id, email, 'student' AS user_type FROM student WHERE email = :email LIMIT 1";
        $stmt = $this->conn->prepare($sqlStudent);
        $stmt->bindParam(":email", $email);
        $stmt->execute();
        $student = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($student) {
            return $student;
        }

        $sqlEmployee = "SELECT employee_id AS user_id, email, 'employee' AS user_type FROM employee WHERE email = :email LIMIT 1";
        $stmt = $this->conn->prepare($sqlEmployee);
        $stmt->bindParam(":email", $email);
        $stmt->execute();
        $employee = $stmt->fetch(PDO::FETCH_ASSOC);

        return $employee ?: null;
    }

    public function sendOtp($json) {
        $data = json_decode($json, true);

        $email = trim($data['email'] ?? '');
        if (empty($email)) {
            echo json_encode(["status" => "error", "message" => "Email address is required."]);
            return;
        }

        $user = $this->findUserByEmail($email);
        if (!$user) {
            echo json_encode(["status" => "error", "message" => "No account found for that email."]);
            return;
        }

        $otp = random_int(100000, 999999);
        $expiresAt = time() + 600; // Increased to 10 minutes for better user experience

        $_SESSION['forgot_password'] = [
            'email' => $email,
            'user_id' => $user['user_id'],
            'user_type' => $user['user_type'],
            'otp' => (string)$otp,
            'expires_at' => $expiresAt,
            'verified' => false
        ];

        $subject = "Your CDO Tutor password reset code";
        $message = "Use the following OTP to reset your password:\n\n";
        $message .= "OTP: $otp\n\n";
        $message .= "This code will expire in 10 minutes.\n";
        $message .= "If you did not request a password reset, please ignore this message.";

        $sent = $this->sendEmail($email, $subject, $message);
        
        if (!$sent) {
            echo json_encode(["status" => "error", "message" => "Failed to send email. Please check your SMTP settings."]);
            return;
        }

        echo json_encode(["status" => "success", "message" => "OTP sent to your email. Please check your inbox."]);
    }

    public function verifyOtp($json) {
        $data = json_decode($json, true);
        $email = trim($data['email'] ?? '');
        $otp = trim($data['otp'] ?? '');

        if (empty($email) || empty($otp)) {
            echo json_encode(["status" => "error", "message" => "Email and OTP are required."]);
            return;
        }

        if (!isset($_SESSION['forgot_password'])) {
            echo json_encode(["status" => "error", "message" => "OTP session not found. Please request a new code."]);
            return;
        }

        $sessionData = $_SESSION['forgot_password'];

        if ($sessionData['email'] !== $email) {
            echo json_encode(["status" => "error", "message" => "Email does not match the OTP request."]);
            return;
        }

        if (time() > $sessionData['expires_at']) {
            unset($_SESSION['forgot_password']);
            echo json_encode(["status" => "error", "message" => "OTP has expired. Please request a new one."]);
            return;
        }

        if ($sessionData['otp'] !== $otp) {
            echo json_encode(["status" => "error", "message" => "The OTP entered is invalid."]);
            return;
        }

        $_SESSION['forgot_password']['verified'] = true;
        echo json_encode(["status" => "success", "message" => "OTP verified. You may now reset your password."]);
    }

    public function resetPassword($json) {
        $data = json_decode($json, true);
        $email = trim($data['email'] ?? '');
        $password = trim($data['password'] ?? '');
        $confirmPassword = trim($data['confirm_password'] ?? '');

        if (empty($email) || empty($password) || empty($confirmPassword)) {
            echo json_encode(["status" => "error", "message" => "Email and both password fields are required."]);
            return;
        }

        if ($password !== $confirmPassword) {
            echo json_encode(["status" => "error", "message" => "Passwords do not match."]);
            return;
        }

        if (!isset($_SESSION['forgot_password']) || !$_SESSION['forgot_password']['verified']) {
            echo json_encode(["status" => "error", "message" => "OTP verification is required before updating password."]);
            return;
        }

        $sessionData = $_SESSION['forgot_password'];
        $hashedPassword = password_hash($password, PASSWORD_DEFAULT);
        $userType = $sessionData['user_type'];
        $userId = $sessionData['user_id'];

        if ($userType === 'student') {
            $sql = "UPDATE student SET password_hash = :password_hash WHERE student_id = :user_id";
        } else {
            $sql = "UPDATE employee SET password_hash = :password_hash WHERE employee_id = :user_id";
        }

        $stmt = $this->conn->prepare($sql);
        $stmt->bindParam(":password_hash", $hashedPassword);
        $stmt->bindParam(":user_id", $userId);
        $stmt->execute();

        unset($_SESSION['forgot_password']);

        echo json_encode(["status" => "success", "message" => "Your password was updated successfully."]);
    }
}

$operation = $_REQUEST['operation'] ?? '';
$json = $_REQUEST['json'] ?? '';
$forgot = new ForgotPassword();

switch ($operation) {
    case 'send_otp': $forgot->sendOtp($json); break;
    case 'verify_otp': $forgot->verifyOtp($json); break;
    case 'reset_password': $forgot->resetPassword($json); break;
    default: echo json_encode(["status" => "error", "message" => "Invalid operation."]); break;
}