<?php

/**
 * Read runtime settings from the server environment first, then from an
 * optional runtime.local.php file. This works on Ubuntu/VPS deployments and
 * on shared hosts where environment variables cannot be configured.
 */
function cdoTutorConfig($key, $default = null)
{
    static $localConfig = null;

    if ($localConfig === null) {
        $localConfig = [];
        $localConfigPath = __DIR__ . '/runtime.local.php';
        if (is_file($localConfigPath)) {
            $loadedConfig = require $localConfigPath;
            if (is_array($loadedConfig)) {
                $localConfig = $loadedConfig;
            }
        }
    }

    $environmentValue = getenv((string) $key);
    if ($environmentValue !== false && trim((string) $environmentValue) !== '') {
        return $environmentValue;
    }

    if (array_key_exists($key, $localConfig) && $localConfig[$key] !== '') {
        return $localConfig[$key];
    }

    return $default;
}

function cdoTutorBooleanConfig($key, $default = false)
{
    $value = cdoTutorConfig($key, $default ? '1' : '0');
    return filter_var($value, FILTER_VALIDATE_BOOLEAN);
}
