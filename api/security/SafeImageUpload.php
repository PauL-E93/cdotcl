<?php
final class SafeImageUpload
{
    public static function store(array $file, string $folder): string
    {
        if (!in_array($folder, ['employee_profiles', 'student_profiles', 'payment_screenshots', 'payment_methods'], true)) {
            throw new RuntimeException('Invalid upload destination.');
        }
        if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK
            || !is_uploaded_file($file['tmp_name'] ?? '') || filesize($file['tmp_name']) > 5 * 1024 * 1024) {
            throw new RuntimeException('Upload a valid image no larger than 5 MB.');
        }
        $bytes = file_get_contents($file['tmp_name']);
        $clean = self::sanitize($bytes);
        $directory = dirname(__DIR__, 2) . '/uploads/' . $folder;
        if (!is_dir($directory) && !mkdir($directory, 0755, true)) throw new RuntimeException('Image storage is unavailable.');
        $type = (int) getimagesizefromstring($bytes)[2];
        $extension = function_exists('imagecreatefromstring') ? 'png'
            : [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_GIF => 'gif'][$type];
        $name = bin2hex(random_bytes(24)) . '.' . $extension;
        if (file_put_contents($directory . '/' . $name, $clean, LOCK_EX) === false) throw new RuntimeException('Unable to save image.');
        return 'uploads/' . $folder . '/' . $name;
    }

    public static function sanitize(string $bytes): string
    {
        if (strlen($bytes) > 5 * 1024 * 1024) throw new RuntimeException('Image exceeds 5 MB.');
        $info = @getimagesizefromstring($bytes);
        if (!$info || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_GIF], true)
            || $info[0] < 1 || $info[1] < 1 || $info[0] > 4096 || $info[1] > 4096
            || $info[0] * $info[1] > 8000000) throw new RuntimeException('Choose a JPEG, PNG or GIF image up to 8 megapixels.');
        // GD strips all metadata and trailing payloads when it is enabled.
        // Without GD, the verified image is stored under a server-generated
        // image-only extension; Apache also disables script execution here.
        if (!function_exists('imagecreatefromstring')) return $bytes;
        $image = @imagecreatefromstring($bytes);
        if (!$image) throw new RuntimeException('The image cannot be decoded.');
        imagesavealpha($image, true);
        ob_start();
        $ok = imagepng($image);
        $result = ob_get_clean();
        imagedestroy($image);
        if (!$ok) throw new RuntimeException('The image cannot be processed.');
        return $result;
    }
}
