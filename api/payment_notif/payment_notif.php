<?php

session_start();

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

require __DIR__ . '/../PHPMailer/src/Exception.php';
require __DIR__ . '/../PHPMailer/src/PHPMailer.php';
require __DIR__ . '/../PHPMailer/src/SMTP.php';
include __DIR__ . '/../admin/connection-pdo.php';

class PaymentNotification {
    private $conn;
    private $categoryLabels = [
        'pending' => 'Pending',
        'due_today' => 'Due Today',
        'due_tomorrow' => 'Due Tomorrow',
        'overdue' => 'Overdue'
    ];

    public function __construct() {
        global $conn;
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

    private function sendEmail($to, $subject, $message) {
        $mail = new PHPMailer(true);
        try {
            $mail->isSMTP();
            $mail->Host       = 'smtp.gmail.com';
            $mail->SMTPAuth   = true;
            $mail->Username   = 'espinosapaul810@gmail.com';
            $mail->Password   = 'yjds vbuo gxas knkm';
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
            $mail->Port       = 587;

            $mail->SMTPOptions = [
                'ssl' => [
                    'verify_peer' => false,
                    'verify_peer_name' => false,
                    'allow_self_signed' => true
                ]
            ];

            $mail->setFrom('espinosapaul810@gmail.com', 'CDO Tutorial Center');
            $mail->addAddress($to);
            $mail->isHTML(true);
            $mail->Subject = $subject;
            $mail->Body    = $message;

            return $mail->send();
        } catch (Exception $e) {
            error_log('Payment notification email failed: ' . $mail->ErrorInfo);
            return false;
        }
    }

    private function getCategoryQueryCondition(string $category): array {
        $today = date('Y-m-d');
        $tomorrow = date('Y-m-d', strtotime('+1 day'));

        switch ($category) {
            case 'pending':
                return [
                    'condition' => 'bs.due_date > :today',
                    'params' => [':today' => $today]
                ];
            case 'due_today':
                return [
                    'condition' => 'bs.due_date = :today',
                    'params' => [':today' => $today]
                ];
            case 'due_tomorrow':
                return [
                    'condition' => 'bs.due_date = :tomorrow',
                    'params' => [':tomorrow' => $tomorrow]
                ];
            case 'overdue':
                return [
                    'condition' => 'bs.due_date < :today',
                    'params' => [':today' => $today]
                ];
            default:
                return ['condition' => '', 'params' => []];
        }
    }

    private function getScopeQueryCondition(string $scope): array {
        switch ($scope) {
            case 'preplay':
                return [
                    'condition' => "AND (
                        LOWER(COALESCE(p.name, '')) LIKE '%preschool%'
                        OR LOWER(COALESCE(p.name, '')) LIKE '%playschool%'
                        OR LOWER(COALESCE(p.name, '')) LIKE '%pre-school%'
                        OR LOWER(COALESCE(p.name, '')) LIKE '%play-school%'
                        OR LOWER(COALESCE(p.name, '')) LIKE '%pre school%'
                        OR LOWER(COALESCE(p.name, '')) LIKE '%play school%'
                    )",
                    'params' => []
                ];
            default:
                return [
                    'condition' => "AND LOWER(COALESCE(p.name, '')) NOT LIKE '%preschool%'
                        AND LOWER(COALESCE(p.name, '')) NOT LIKE '%playschool%'
                        AND LOWER(COALESCE(p.name, '')) NOT LIKE '%pre-school%'
                        AND LOWER(COALESCE(p.name, '')) NOT LIKE '%play-school%'
                        AND LOWER(COALESCE(p.name, '')) NOT LIKE '%pre school%'
                        AND LOWER(COALESCE(p.name, '')) NOT LIKE '%play school%'",
                    'params' => []
                ];
        }
    }

    private function fetchPaymentDueItems(string $category, string $scope = 'tutorial'): array {
        $categoryQuery = $this->getCategoryQueryCondition($category);
        if (empty($categoryQuery['condition'])) {
            return [];
        }

        $scopeQuery = $this->getScopeQueryCondition($scope);
        $branchId = $this->getBranchAdminBranchId();

        $sql = "SELECT
                    bs.billing_schedule_id AS id,
                    bs.enrollment_details_id,
                    TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                    s.email AS student_email,
                    p.name AS program_name,
                    bs.billing_type,
                    bs.total_amount AS amount,
                    bs.status,
                    bs.due_date
                FROM billing_schedule bs
                JOIN enrollment_details ed ON bs.enrollment_details_id = ed.enrollment_details_id
                JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                JOIN student s ON eh.student_id = s.student_id
                LEFT JOIN program p ON ed.program_id = p.program_id
                WHERE bs.status IN ('unpaid', 'partial')
                  AND {$categoryQuery['condition']}
                  {$scopeQuery['condition']}
                  " . ($branchId ? "AND eh.branch_id = :branch_id" : "") . "
                ORDER BY COALESCE(bs.due_date, '9999-12-31') ASC, bs.billing_type ASC";

        $stmt = $this->conn->prepare($sql);
        $params = array_merge($categoryQuery['params'], $scopeQuery['params']);
        if ($branchId) {
            $params[':branch_id'] = $branchId;
        }
        $stmt->execute($params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    private function buildPaymentNotificationBody(string $studentName, string $categoryLabel, array $items): string {
        $rows = '';
        foreach ($items as $item) {
            $formattedDate = empty($item['due_date']) ? 'No due date' : date('M j, Y', strtotime($item['due_date']));
            $formattedAmount = number_format($item['amount'] ?? 0, 2);
            $rows .= "
                <tr>
                    <td style='padding:8px; border:1px solid #e2e8f0;'>{$item['program_name']}</td>
                    <td style='padding:8px; border:1px solid #e2e8f0;'>{$item['billing_type']}</td>
                    <td style='padding:8px; border:1px solid #e2e8f0;'>{$formattedDate}</td>
                    <td style='padding:8px; border:1px solid #e2e8f0; text-align:right;'>PHP {$formattedAmount}</td>
                    <td style='padding:8px; border:1px solid #e2e8f0;'>{$item['status']}</td>
                </tr>
            ";
        }

        return "
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; color: #333; }
                .container { max-width: 640px; margin: 0 auto; padding: 20px; }
                .header { background: #ea9aa6; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
                .content { background: #fff5f8; padding: 20px; border-radius: 0 0 8px 8px; }
                .details { margin-top: 16px; }
                .summary-table { width: 100%; border-collapse: collapse; margin-top: 16px; }
                .summary-table th { background: #f8d8e0; color: #831843; padding: 12px; border: 1px solid #f0c9d4; text-align: left; }
                .summary-table td { padding: 10px; border: 1px solid #f0c9d4; }
                .summary-table tbody tr:nth-child(even) { background: #fff0f5; }
            </style>
        </head>
        <body>
            <div class='container'>
                <div class='header'>
                    <h2>Payment Reminder</h2>
                    <p>CDO Tutorial Center</p>
                </div>
                <div class='content'>
                    <p>Hi {$studentName},</p>
                    <p>We found payment(s) that are currently <strong style='color:#a23b6c;'>{$categoryLabel}</strong>. Please review the details below and settle the amount as soon as possible.</p>
                    <div class='details'>
                        <table class='summary-table'>
                            <thead>
                                <tr>
                                    <th>Program</th>
                                    <th>Billing Type</th>
                                    <th>Due Date</th>
                                    <th>Amount</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {$rows}
                            </tbody>
                        </table>
                    </div>
                    <p style='margin-top: 18px;'>If you have already paid, please disregard this message.</p>
                    <p>Thank you,<br>CDO Tutorial Center Team</p>
                </div>
            </div>
        </body>
        </html>
        ";
    }

    public function handle(): array {
        $input = json_decode(file_get_contents('php://input'), true);
        $operation = $_GET['operation'] ?? $input['operation'] ?? '';
        $category = $_GET['category'] ?? $input['category'] ?? '';
        $scope = $_GET['scope'] ?? $input['scope'] ?? 'tutorial';

        if ($operation !== 'sendPaymentDueNotification') {
            return ['status' => 'error', 'message' => 'Unsupported operation'];
        }

        if (!array_key_exists($category, $this->categoryLabels)) {
            return ['status' => 'error', 'message' => 'Invalid payment category'];
        }

        $items = $this->fetchPaymentDueItems($category, $scope);
        if (empty($items)) {
            return ['status' => 'error', 'message' => 'No payment records found for this category'];
        }

        $groups = [];
        foreach ($items as $item) {
            if (empty($item['student_email'])) {
                continue;
            }
            $email = trim($item['student_email']);
            if (!isset($groups[$email])) {
                $groups[$email] = [
                    'student_name' => $item['student_name'],
                    'items' => []
                ];
            }
            $groups[$email]['items'][] = $item;
        }

        if (empty($groups)) {
            return ['status' => 'error', 'message' => 'No student email addresses were found for this category'];
        }

        $sent = 0;
        $failed = [];
        $categoryLabel = $this->categoryLabels[$category];

        foreach ($groups as $email => $group) {
            $subject = "Payment Reminder - {$categoryLabel}";
            $body = $this->buildPaymentNotificationBody($group['student_name'], $categoryLabel, $group['items']);

            if ($this->sendEmail($email, $subject, $body)) {
                $sent++;
            } else {
                $failed[] = $email;
            }
        }

        return [
            'status' => 'success',
            'message' => "Payment reminder emails sent to {$sent} recipient(s)." . (!empty($failed) ? ' Failed for: ' . implode(', ', $failed) : ''),
            'sent' => $sent,
            'failed' => $failed
        ];
    }
}

$handler = new PaymentNotification();
echo json_encode($handler->handle());
