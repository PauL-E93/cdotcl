<?php

function cdoBuildAppUrl($path = '') {
    $configuredBaseUrl = getenv('APP_BASE_URL');
    if ($configuredBaseUrl !== false && trim($configuredBaseUrl) !== '') {
        return rtrim(trim($configuredBaseUrl), '/') . '/' . ltrim($path, '/');
    }

    $forwardedProto = $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '';
    $forwardedScheme = strtolower(trim(explode(',', $forwardedProto)[0]));
    $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || $forwardedScheme === 'https';
    $scheme = $isHttps ? 'https' : 'http';

    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    if (!preg_match('/^[a-z0-9.\-:\[\]]+$/i', $host)) {
        $host = 'localhost';
    }

    $scriptName = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '/api/index.php');
    $scriptDirectory = '/' . trim(dirname($scriptName), '/.');
    $appBasePath = preg_replace('#/api(?:/.*)?$#i', '', $scriptDirectory);
    $appBasePath = $appBasePath === '/' ? '' : rtrim($appBasePath, '/');

    return "{$scheme}://{$host}{$appBasePath}/" . ltrim($path, '/');
}
