<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

class PaymentMethod {
    private function decodePayload($json) {
        $data = json_decode((string) $json, true);
        return is_array($data) ? $data : [];
    }

    private function validatePayload($data, $requireId = false) {
        if ($requireId && intval($data['payment_method_id'] ?? 0) < 1) {
            throw new InvalidArgumentException('Payment method ID is required.');
        }

        $method = trim((string) ($data['payment_method'] ?? ''));
        $accountName = trim((string) ($data['account_name'] ?? ''));
        $accountNumber = trim((string) ($data['account_number'] ?? ''));
        if ($method === '') {
            throw new InvalidArgumentException('Payment method name is required.');
        }
        if (mb_strlen($method) > 50 || mb_strlen($accountName) > 100 || mb_strlen($accountNumber) > 30) {
            throw new InvalidArgumentException('One or more values exceed the allowed length.');
        }

        return [
            'payment_method_id' => intval($data['payment_method_id'] ?? 0),
            'payment_method' => $method,
            'account_name' => $accountName === '' ? null : $accountName,
            'account_number' => $accountNumber === '' ? null : $accountNumber,
            'remove_qr' => filter_var($data['remove_qr'] ?? false, FILTER_VALIDATE_BOOLEAN)
        ];
    }

    private function ensureUniqueName($conn, $name, $excludeId = 0) {
        $sql = 'SELECT payment_method_id FROM payment_method WHERE LOWER(TRIM(payment_method)) = LOWER(TRIM(:name))';
        $params = [':name' => $name];
        if ($excludeId > 0) {
            $sql .= ' AND payment_method_id <> :id';
            $params[':id'] = $excludeId;
        }
        $stmt = $conn->prepare($sql . ' LIMIT 1');
        $stmt->execute($params);
        if ($stmt->fetchColumn()) {
            throw new InvalidArgumentException('A payment method with this name already exists.');
        }
    }

    private function saveQrCode($file) {
        if (!$file || intval($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            return null;
        }
        if (intval($file['error']) !== UPLOAD_ERR_OK) {
            throw new RuntimeException('The QR-code image could not be uploaded.');
        }
        if (intval($file['size'] ?? 0) > 5 * 1024 * 1024) {
            throw new InvalidArgumentException('The QR-code image must be 5 MB or smaller.');
        }

        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mimeType = $finfo->file($file['tmp_name']);
        $extensions = [
            'image/png' => 'png',
            'image/jpeg' => 'jpg',
            'image/webp' => 'webp',
            'image/gif' => 'gif'
        ];
        if (!isset($extensions[$mimeType])) {
            throw new InvalidArgumentException('QR code must be a PNG, JPG, WEBP, or GIF image.');
        }

        $relativeDirectory = 'uploads/payment_methods';
        $absoluteDirectory = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'payment_methods';
        if (!is_dir($absoluteDirectory) && !mkdir($absoluteDirectory, 0775, true) && !is_dir($absoluteDirectory)) {
            throw new RuntimeException('Unable to create the QR-code upload directory.');
        }

        $filename = 'payment-method-' . bin2hex(random_bytes(12)) . '.' . $extensions[$mimeType];
        $destination = $absoluteDirectory . DIRECTORY_SEPARATOR . $filename;
        if (!move_uploaded_file($file['tmp_name'], $destination)) {
            throw new RuntimeException('Unable to store the QR-code image.');
        }
        return $relativeDirectory . '/' . $filename;
    }

    private function deleteManagedQrCode($path) {
        $path = trim((string) $path);
        if ($path === '' || strpos(str_replace('\\', '/', $path), 'uploads/payment_methods/') !== 0) return;
        $absolutePath = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $path);
        $uploadRoot = realpath(dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'payment_methods');
        $resolvedPath = realpath($absolutePath);
        if ($uploadRoot && $resolvedPath && strpos($resolvedPath, $uploadRoot . DIRECTORY_SEPARATOR) === 0 && is_file($resolvedPath)) {
            unlink($resolvedPath);
        }
    }

    public function getPaymentMethods() {
        include 'connection-pdo.php';
        try {
            $stmt = $conn->prepare('SELECT payment_method_id, payment_method, account_name, account_number, qr_code FROM payment_method ORDER BY payment_method_id ASC');
            $stmt->execute();
            echo json_encode(['status' => 'success', 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        } catch (Throwable $error) {
            echo json_encode(['status' => 'error', 'message' => 'Unable to load payment methods.']);
        }
    }

    public function getPaymentMethod($json) {
        include 'connection-pdo.php';
        $data = $this->decodePayload($json);
        $id = intval($data['payment_method_id'] ?? 0);
        if ($id < 1) {
            echo json_encode(['status' => 'error', 'message' => 'Payment method ID is required.']);
            return;
        }
        $stmt = $conn->prepare('SELECT payment_method_id, payment_method, account_name, account_number, qr_code FROM payment_method WHERE payment_method_id = :id');
        $stmt->execute([':id' => $id]);
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        echo json_encode($result
            ? ['status' => 'success', 'data' => $result]
            : ['status' => 'error', 'message' => 'Payment method not found.']);
    }

    public function insertPaymentMethod($json, $file = null) {
        include 'connection-pdo.php';
        $newQrCode = null;
        try {
            $data = $this->validatePayload($this->decodePayload($json));
            $this->ensureUniqueName($conn, $data['payment_method']);
            $newQrCode = $this->saveQrCode($file);
            $stmt = $conn->prepare('INSERT INTO payment_method (payment_method, account_name, account_number, qr_code) VALUES (:method, :account_name, :account_number, :qr_code)');
            $stmt->execute([
                ':method' => $data['payment_method'],
                ':account_name' => $data['account_name'],
                ':account_number' => $data['account_number'],
                ':qr_code' => $newQrCode
            ]);
            echo json_encode(['status' => 'success', 'message' => 'Payment method added successfully.', 'payment_method_id' => $conn->lastInsertId()]);
        } catch (Throwable $error) {
            if ($newQrCode) $this->deleteManagedQrCode($newQrCode);
            $message = ($error instanceof InvalidArgumentException || $error instanceof RuntimeException)
                ? $error->getMessage()
                : 'Unable to add the payment method.';
            echo json_encode(['status' => 'error', 'message' => $message]);
        }
    }

    public function updatePaymentMethod($json, $file = null) {
        include 'connection-pdo.php';
        $newQrCode = null;
        try {
            $data = $this->validatePayload($this->decodePayload($json), true);
            $this->ensureUniqueName($conn, $data['payment_method'], $data['payment_method_id']);
            $existingStmt = $conn->prepare('SELECT qr_code FROM payment_method WHERE payment_method_id = :id');
            $existingStmt->execute([':id' => $data['payment_method_id']]);
            $existingQrCode = $existingStmt->fetchColumn();
            if ($existingQrCode === false) throw new InvalidArgumentException('Payment method not found.');

            $newQrCode = $this->saveQrCode($file);
            $qrCode = $newQrCode ?: ($data['remove_qr'] ? null : $existingQrCode);
            $stmt = $conn->prepare('UPDATE payment_method SET payment_method = :method, account_name = :account_name, account_number = :account_number, qr_code = :qr_code WHERE payment_method_id = :id');
            $stmt->execute([
                ':method' => $data['payment_method'],
                ':account_name' => $data['account_name'],
                ':account_number' => $data['account_number'],
                ':qr_code' => $qrCode,
                ':id' => $data['payment_method_id']
            ]);
            if (($newQrCode || $data['remove_qr']) && $existingQrCode) $this->deleteManagedQrCode($existingQrCode);
            echo json_encode(['status' => 'success', 'message' => 'Payment method updated successfully.']);
        } catch (Throwable $error) {
            if ($newQrCode) $this->deleteManagedQrCode($newQrCode);
            $message = ($error instanceof InvalidArgumentException || $error instanceof RuntimeException)
                ? $error->getMessage()
                : 'Unable to update the payment method.';
            echo json_encode(['status' => 'error', 'message' => $message]);
        }
    }

    public function deletePaymentMethod($json) {
        include 'connection-pdo.php';
        $data = $this->decodePayload($json);
        $id = intval($data['payment_method_id'] ?? 0);
        if ($id < 1) {
            echo json_encode(['status' => 'error', 'message' => 'Payment method ID is required.']);
            return;
        }

        try {
            $existingStmt = $conn->prepare('SELECT qr_code FROM payment_method WHERE payment_method_id = :id');
            $existingStmt->execute([':id' => $id]);
            $qrCode = $existingStmt->fetchColumn();
            if ($qrCode === false) throw new InvalidArgumentException('Payment method not found.');
            $stmt = $conn->prepare('DELETE FROM payment_method WHERE payment_method_id = :id');
            $stmt->execute([':id' => $id]);
            if ($stmt->rowCount() > 0 && $qrCode) $this->deleteManagedQrCode($qrCode);
            echo json_encode(['status' => 'success', 'message' => 'Payment method deleted successfully.']);
        } catch (PDOException $error) {
            $message = $error->getCode() === '23000'
                ? 'This payment method is already used by payment records and cannot be deleted.'
                : 'Unable to delete the payment method.';
            echo json_encode(['status' => 'error', 'message' => $message]);
        } catch (Throwable $error) {
            echo json_encode(['status' => 'error', 'message' => $error->getMessage()]);
        }
    }
}

$operation = '';
$json = '';
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $operation = $_GET['operation'] ?? '';
    $json = $_GET['json'] ?? '';
} else {
    $operation = $_POST['operation'] ?? '';
    $json = $_POST['json'] ?? '';
    if ($operation === '') {
        $postData = json_decode(file_get_contents('php://input'), true);
        if (is_array($postData)) {
            $operation = $postData['operation'] ?? '';
            $json = $postData['json'] ?? '';
        }
    }
}

$api = new PaymentMethod();
switch ($operation) {
    case 'getPaymentMethods': $api->getPaymentMethods(); break;
    case 'getPaymentMethod': $api->getPaymentMethod($json); break;
    case 'insertPaymentMethod': $api->insertPaymentMethod($json, $_FILES['qr_code'] ?? null); break;
    case 'updatePaymentMethod': $api->updatePaymentMethod($json, $_FILES['qr_code'] ?? null); break;
    case 'deletePaymentMethod': $api->deletePaymentMethod($json); break;
    default: echo json_encode(['status' => 'error', 'message' => 'Invalid operation.']); break;
}
?>
