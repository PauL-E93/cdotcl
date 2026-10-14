<?php
// api/landing_page.php
require_once __DIR__ . '/security/AuthGuard.php';
if (($_REQUEST['operation'] ?? '') !== 'getLandingPage') AuthGuard::requireRoles(['owner']);
header('Content-Type: application/json');

class LandingPage {
    private $conn;

    public function __construct() {
        include "admin/connection-pdo.php";
        $this->conn = $conn;
        $this->ensureEditableContentColumns();
    }

    /**
     * Keep local/XAMPP installations compatible without requiring a separate
     * migration command before the expanded landing-page editor is opened.
     */
    private function ensureEditableContentColumns() {
        $columns = [
            'hero_eyebrow' => "VARCHAR(255) NULL AFTER `landingpage_id`",
            'hero_title' => "TEXT NULL AFTER `hero_eyebrow`",
            'hero_tagline' => "VARCHAR(255) NULL AFTER `hero_title`",
            'hero_description' => "TEXT NULL AFTER `hero_tagline`",
            'highlight_1_value' => "VARCHAR(100) NULL AFTER `hero_description`",
            'highlight_1_label' => "VARCHAR(255) NULL AFTER `highlight_1_value`",
            'highlight_2_value' => "VARCHAR(100) NULL AFTER `highlight_1_label`",
            'highlight_2_label' => "VARCHAR(255) NULL AFTER `highlight_2_value`",
            'highlight_3_value' => "VARCHAR(100) NULL AFTER `highlight_2_label`",
            'highlight_3_label' => "VARCHAR(255) NULL AFTER `highlight_3_value`",
            'highlight_4_value' => "VARCHAR(100) NULL AFTER `highlight_3_label`",
            'highlight_4_label' => "VARCHAR(255) NULL AFTER `highlight_4_value`"
        ];

        $existingColumns = array_fill_keys(
            $this->conn->query("SHOW COLUMNS FROM landingpage")->fetchAll(PDO::FETCH_COLUMN),
            true
        );
        foreach ($columns as $name => $definition) {
            if (!isset($existingColumns[$name])) {
                $this->conn->exec("ALTER TABLE landingpage ADD COLUMN `{$name}` {$definition}");
            }
        }
    }

    public function getLandingPage($json = "") {
        $params = json_decode($json, true);
        if (!empty($params['landingpage_id'])) {
            $sql = "SELECT * FROM landingpage WHERE landingpage_id = :landingpage_id LIMIT 1";
            $stmt = $this->conn->prepare($sql);
            $stmt->bindParam(':landingpage_id', $params['landingpage_id']);
        } else {
            $sql = "SELECT * FROM landingpage ORDER BY landingpage_id DESC LIMIT 1";
            $stmt = $this->conn->prepare($sql);
        }

        $stmt->execute();
        $result = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode($result);
    }

    public function insertLandingPage($json) {
        $data = json_decode($json, true);

        $sql = "INSERT INTO landingpage(
                    hero_eyebrow,
                    hero_title,
                    hero_tagline,
                    hero_description,
                    highlight_1_value,
                    highlight_1_label,
                    highlight_2_value,
                    highlight_2_label,
                    highlight_3_value,
                    highlight_3_label,
                    highlight_4_value,
                    highlight_4_label,
                    announcement_1,
                    announcement_2,
                    announcement_3,
                    picture_1,
                    picture_2,
                    picture_3,
                    mission,
                    vision,
                    core_values,
                    gmail,
                    contact_number,
                    facebook,
                    created_at,
                    updated_at
                ) VALUES(
                    :hero_eyebrow,
                    :hero_title,
                    :hero_tagline,
                    :hero_description,
                    :highlight_1_value,
                    :highlight_1_label,
                    :highlight_2_value,
                    :highlight_2_label,
                    :highlight_3_value,
                    :highlight_3_label,
                    :highlight_4_value,
                    :highlight_4_label,
                    :announcement_1,
                    :announcement_2,
                    :announcement_3,
                    :picture_1,
                    :picture_2,
                    :picture_3,
                    :mission,
                    :vision,
                    :core_values,
                    :gmail,
                    :contact_number,
                    :facebook,
                    NOW(),
                    NOW()
                )";

        $stmt = $this->conn->prepare($sql);
        $this->bindExpandedContent($stmt, $data);
        $stmt->bindParam(':announcement_1', $data['announcement_1']);
        $stmt->bindParam(':announcement_2', $data['announcement_2']);
        $stmt->bindParam(':announcement_3', $data['announcement_3']);
        $stmt->bindParam(':picture_1', $data['picture_1']);
        $stmt->bindParam(':picture_2', $data['picture_2']);
        $stmt->bindParam(':picture_3', $data['picture_3']);
        $stmt->bindParam(':mission', $data['mission']);
        $stmt->bindParam(':vision', $data['vision']);
        $stmt->bindParam(':core_values', $data['core_values']);
        $stmt->bindParam(':gmail', $data['gmail']);
        $stmt->bindParam(':contact_number', $data['contact_number']);
        $stmt->bindParam(':facebook', $data['facebook']);

        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    public function updateLandingPage($json) {
        $data = json_decode($json, true);

        $sql = "UPDATE landingpage SET
                    hero_eyebrow = :hero_eyebrow,
                    hero_title = :hero_title,
                    hero_tagline = :hero_tagline,
                    hero_description = :hero_description,
                    highlight_1_value = :highlight_1_value,
                    highlight_1_label = :highlight_1_label,
                    highlight_2_value = :highlight_2_value,
                    highlight_2_label = :highlight_2_label,
                    highlight_3_value = :highlight_3_value,
                    highlight_3_label = :highlight_3_label,
                    highlight_4_value = :highlight_4_value,
                    highlight_4_label = :highlight_4_label,
                    announcement_1 = :announcement_1,
                    announcement_2 = :announcement_2,
                    announcement_3 = :announcement_3,
                    picture_1 = :picture_1,
                    picture_2 = :picture_2,
                    picture_3 = :picture_3,
                    mission = :mission,
                    vision = :vision,
                    core_values = :core_values,
                    gmail = :gmail,
                    contact_number = :contact_number,
                    facebook = :facebook,
                    updated_at = NOW()
                WHERE landingpage_id = :landingpage_id";

        $stmt = $this->conn->prepare($sql);
        $this->bindExpandedContent($stmt, $data);
        $stmt->bindParam(':announcement_1', $data['announcement_1']);
        $stmt->bindParam(':announcement_2', $data['announcement_2']);
        $stmt->bindParam(':announcement_3', $data['announcement_3']);
        $stmt->bindParam(':picture_1', $data['picture_1']);
        $stmt->bindParam(':picture_2', $data['picture_2']);
        $stmt->bindParam(':picture_3', $data['picture_3']);
        $stmt->bindParam(':mission', $data['mission']);
        $stmt->bindParam(':vision', $data['vision']);
        $stmt->bindParam(':core_values', $data['core_values']);
        $stmt->bindParam(':gmail', $data['gmail']);
        $stmt->bindParam(':contact_number', $data['contact_number']);
        $stmt->bindParam(':facebook', $data['facebook']);
        $stmt->bindParam(':landingpage_id', $data['landingpage_id']);

        $stmt->execute();
        echo json_encode($stmt->rowCount() > 0 ? 1 : 0);
    }

    private function bindExpandedContent($stmt, $data) {
        $fields = [
            'hero_eyebrow', 'hero_title', 'hero_tagline', 'hero_description',
            'highlight_1_value', 'highlight_1_label', 'highlight_2_value', 'highlight_2_label',
            'highlight_3_value', 'highlight_3_label', 'highlight_4_value', 'highlight_4_label'
        ];
        foreach ($fields as $field) {
            $stmt->bindValue(':' . $field, $data[$field] ?? null, PDO::PARAM_STR);
        }
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $operation = isset($_GET['operation']) ? $_GET['operation'] : '';
    $json = isset($_GET['json']) ? $_GET['json'] : '';
} else {
    $operation = isset($_POST['operation']) ? $_POST['operation'] : '';
    $json = isset($_POST['json']) ? $_POST['json'] : '';
}

$landingPage = new LandingPage();
switch ($operation) {
    case 'getLandingPage':
        $landingPage->getLandingPage($json);
        break;
    case 'insertLandingPage':
        $landingPage->insertLandingPage($json);
        break;
    case 'updateLandingPage':
        $landingPage->updateLandingPage($json);
        break;
    default:
        echo json_encode(['error' => 'Invalid operation']);
        break;
}
