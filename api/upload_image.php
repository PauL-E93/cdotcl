<?php
// These image folders were already publicly readable. Serve only verified raster
// images through PHP when a hosting provider restricts direct upload requests.
$path = $_GET['path'] ?? '';
if (!is_string($path) || !preg_match('#\Auploads/(employee_profiles|student_profiles|payment_screenshots|payment_methods)/[a-zA-Z0-9_-]+\.(?:jpe?g|png|gif|webp|bmp)\z#i', $path)) {
    http_response_code(404);
    exit;
}
$root = realpath(dirname(__DIR__) . '/uploads');
$file = realpath(dirname(__DIR__) . '/' . $path);
if (!$root || !$file || strpos($file, $root . DIRECTORY_SEPARATOR) !== 0 || !is_file($file) || !is_readable($file)) {
    http_response_code(404);
    exit;
}
$image = @getimagesize($file);
if (!$image || !in_array($image['mime'] ?? '', ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/x-ms-bmp'], true)) {
    http_response_code(404);
    exit;
}
header('Content-Type: ' . $image['mime']);
header('Content-Length: ' . filesize($file));
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, max-age=300');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') readfile($file);
