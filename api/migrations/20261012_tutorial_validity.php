<?php
// Run: C:\xampp\php\php.exe api/migrations/20261012_tutorial_validity.php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/../admin/connection-pdo.php';
require_once __DIR__ . '/../tutorial_validity_helper.php';
ensureTutorialValiditySchema($conn);
echo "Tutorial validity schema ready. Existing programs and enrollments have not been assigned deadlines.\n";
