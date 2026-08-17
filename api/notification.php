<?php
header('Content-Type: application/json');

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

include __DIR__ . '/admin/connection-pdo.php';

class NotificationAPI {
    private $conn;
    private $userId;
    private $userType;
    private $alternateUserType;

    public function __construct(PDO $conn) {
        $this->conn = $conn;
        $this->userId = intval($_SESSION['user_id'] ?? 0);
        $this->userType = strtolower((string) ($_SESSION['user_type'] ?? ''));

        if ($this->userType !== 'student') {
            $this->userType = 'employee';
        }

        $role = preg_replace('/[\s_-]+/', ' ', strtolower(trim((string) ($_SESSION['user_role'] ?? ''))));
        $this->alternateUserType = $role === 'branch admin' ? 'branch_admin' : $this->userType;
    }

    public function getNotifications() {
        if (!$this->isAuthenticated()) {
            $this->respondUnauthorized();
            return;
        }

        $stmt = $this->conn->prepare("
            SELECT notification_id, title, message, is_read, created_at
            FROM notification
            WHERE user_id = :user_id AND user_type IN (:user_type, :alternate_user_type)
            ORDER BY created_at DESC
            LIMIT 100
        ");
        $stmt->execute($this->identityParams());
        $notifications = $stmt->fetchAll(PDO::FETCH_ASSOC);

        echo json_encode([
            'status' => 'success',
            'data' => $notifications,
            'count' => count($notifications)
        ]);
    }

    public function markAsRead($json) {
        $data = json_decode($json, true) ?: [];
        $notificationId = intval($data['notification_id'] ?? 0);

        if (!$this->isAuthenticated() || $notificationId <= 0) {
            $this->respondUnauthorized();
            return;
        }

        $stmt = $this->conn->prepare("
            UPDATE notification
            SET is_read = 1
            WHERE notification_id = :notification_id
              AND user_id = :user_id
              AND user_type IN (:user_type, :alternate_user_type)
        ");
        $stmt->execute(array_merge(
            [':notification_id' => $notificationId],
            $this->identityParams()
        ));

        echo json_encode(['status' => 'success', 'message' => 'Notification marked as read']);
    }

    public function markAllAsRead() {
        if (!$this->isAuthenticated()) {
            $this->respondUnauthorized();
            return;
        }

        $stmt = $this->conn->prepare("
            UPDATE notification
            SET is_read = 1
            WHERE user_id = :user_id
              AND user_type IN (:user_type, :alternate_user_type)
              AND is_read = 0
        ");
        $stmt->execute($this->identityParams());

        echo json_encode(['status' => 'success', 'message' => 'Notifications marked as read']);
    }

    public function deleteNotification($json) {
        $data = json_decode($json, true) ?: [];
        $notificationId = intval($data['notification_id'] ?? 0);

        if (!$this->isAuthenticated() || $notificationId <= 0) {
            $this->respondUnauthorized();
            return;
        }

        $stmt = $this->conn->prepare("
            DELETE FROM notification
            WHERE notification_id = :notification_id
              AND user_id = :user_id
              AND user_type IN (:user_type, :alternate_user_type)
        ");
        $stmt->execute(array_merge(
            [':notification_id' => $notificationId],
            $this->identityParams()
        ));

        echo json_encode(['status' => 'success', 'message' => 'Notification deleted']);
    }

    private function identityParams() {
        return [
            ':user_id' => $this->userId,
            ':user_type' => $this->userType,
            ':alternate_user_type' => $this->alternateUserType
        ];
    }

    private function isAuthenticated() {
        return $this->userId > 0 && isset($_SESSION['user_role']);
    }

    private function respondUnauthorized() {
        http_response_code(401);
        echo json_encode(['status' => 'error', 'message' => 'Authentication required']);
    }
}

$operation = $_GET['operation'] ?? $_POST['operation'] ?? '';
$json = $_GET['json'] ?? $_POST['json'] ?? '';
$notifications = new NotificationAPI($conn);

switch ($operation) {
    case 'getNotifications':
        $notifications->getNotifications();
        break;
    case 'markAsRead':
    case 'updateNotification':
        $notifications->markAsRead($json);
        break;
    case 'markAllAsRead':
        $notifications->markAllAsRead();
        break;
    case 'deleteNotification':
        $notifications->deleteNotification($json);
        break;
    default:
        echo json_encode(['status' => 'error', 'message' => 'Invalid operation']);
        break;
}
