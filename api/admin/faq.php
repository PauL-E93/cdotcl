<?php
require_once __DIR__ . '/../security/AuthGuard.php';
AuthGuard::requireUser();

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

class FaqApi {
    private $conn;

    public function __construct() {
        include __DIR__ . '/connection-pdo.php';
        $this->conn = $conn;
    }

    private function respond($status, $message = '', $data = null, $httpCode = 200) {
        http_response_code($httpCode);
        $response = ['status' => $status];
        if ($message !== '') $response['message'] = $message;
        if ($data !== null) $response['data'] = $data;
        echo json_encode($response, JSON_UNESCAPED_UNICODE);
    }

    private function requireOwner() {
        $role = strtolower(trim((string) ($_SESSION['user_role'] ?? '')));
        if (empty($_SESSION['user_id']) || $role !== 'owner') {
            $this->respond('error', 'Owner access is required to manage FAQs.', null, 403);
            exit;
        }
    }

    private function decodePayload($json) {
        $data = json_decode((string) $json, true);
        return is_array($data) ? $data : [];
    }

    private function validate($data, $requireId = false) {
        $id = (int) ($data['faq_id'] ?? 0);
        $question = trim((string) ($data['question'] ?? ''));
        $answer = trim((string) ($data['answer'] ?? ''));
        $order = max(0, (int) ($data['display_order'] ?? 0));
        $status = strtolower(trim((string) ($data['status'] ?? 'active')));

        if ($requireId && $id < 1) throw new InvalidArgumentException('FAQ ID is required.');
        if ($question === '' || $answer === '') throw new InvalidArgumentException('Question and answer are required.');
        if (mb_strlen($question) > 500) throw new InvalidArgumentException('The question must be 500 characters or fewer.');
        if (!in_array($status, ['active', 'inactive'], true)) throw new InvalidArgumentException('Invalid FAQ status.');

        return compact('id', 'question', 'answer', 'order', 'status');
    }

    public function getPublicFaqs() {
        $stmt = $this->conn->query("SELECT faq_id, question, answer FROM faq WHERE status = 'active' ORDER BY display_order, faq_id");
        $this->respond('success', '', $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    public function getFaqs() {
        $this->requireOwner();
        $stmt = $this->conn->query('SELECT faq_id, question, answer, display_order, status, created_at, updated_at FROM faq ORDER BY display_order, faq_id');
        $this->respond('success', '', $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    public function insertFaq($json) {
        $this->requireOwner();
        try {
            $data = $this->validate($this->decodePayload($json));
            $stmt = $this->conn->prepare('INSERT INTO faq (question, answer, display_order, status) VALUES (:question, :answer, :display_order, :status)');
            $stmt->execute([':question' => $data['question'], ':answer' => $data['answer'], ':display_order' => $data['order'], ':status' => $data['status']]);
            $this->respond('success', 'FAQ added successfully.', ['faq_id' => (int) $this->conn->lastInsertId()]);
        } catch (InvalidArgumentException $error) {
            $this->respond('error', $error->getMessage(), null, 422);
        } catch (Throwable $error) {
            error_log('FAQ insert failed: ' . $error->getMessage());
            $this->respond('error', 'Unable to add the FAQ.', null, 500);
        }
    }

    public function updateFaq($json) {
        $this->requireOwner();
        try {
            $data = $this->validate($this->decodePayload($json), true);
            $stmt = $this->conn->prepare('UPDATE faq SET question = :question, answer = :answer, display_order = :display_order, status = :status WHERE faq_id = :id');
            $stmt->execute([':question' => $data['question'], ':answer' => $data['answer'], ':display_order' => $data['order'], ':status' => $data['status'], ':id' => $data['id']]);
            if ($stmt->rowCount() === 0) {
                $check = $this->conn->prepare('SELECT 1 FROM faq WHERE faq_id = ?');
                $check->execute([$data['id']]);
                if (!$check->fetchColumn()) throw new InvalidArgumentException('FAQ not found.');
            }
            $this->respond('success', 'FAQ updated successfully.');
        } catch (InvalidArgumentException $error) {
            $this->respond('error', $error->getMessage(), null, 422);
        } catch (Throwable $error) {
            error_log('FAQ update failed: ' . $error->getMessage());
            $this->respond('error', 'Unable to update the FAQ.', null, 500);
        }
    }

    public function archiveFaq($json) {
        $this->requireOwner();
        $id = (int) ($this->decodePayload($json)['faq_id'] ?? 0);
        if ($id < 1) {
            $this->respond('error', 'FAQ ID is required.', null, 422);
            return;
        }
        $stmt = $this->conn->prepare("UPDATE faq SET status = 'inactive' WHERE faq_id = ? AND status <> 'inactive'");
        $stmt->execute([$id]);
        if ($stmt->rowCount() === 0) {
            $check = $this->conn->prepare('SELECT 1 FROM faq WHERE faq_id = ?');
            $check->execute([$id]);
            if (!$check->fetchColumn()) {
                $this->respond('error', 'FAQ not found.', null, 404);
                return;
            }
        }
        $this->respond('success', 'FAQ archived successfully.');
    }
}

$operation = $_GET['operation'] ?? '';
$json = $_GET['json'] ?? '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);
    if (is_array($body)) {
        $operation = $body['operation'] ?? '';
        $json = $body['json'] ?? '';
    } else {
        $operation = $_POST['operation'] ?? '';
        $json = $_POST['json'] ?? '';
    }
}

try {
    $api = new FaqApi();
    switch ($operation) {
        case 'getPublicFaqs': $api->getPublicFaqs(); break;
        case 'getFaqs': $api->getFaqs(); break;
        case 'insertFaq': $api->insertFaq($json); break;
        case 'updateFaq': $api->updateFaq($json); break;
        case 'archiveFaq':
        case 'deleteFaq': $api->archiveFaq($json); break;
        default: http_response_code(400); echo json_encode(['status' => 'error', 'message' => 'Invalid operation.']);
    }
} catch (Throwable $error) {
    error_log('FAQ API failed: ' . $error->getMessage());
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'FAQ service is unavailable.']);
}
