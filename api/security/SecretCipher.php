<?php

require_once __DIR__ . '/../config/runtime.php';

final class SecretCipher
{
    private const PREFIX = 'v1:';
    private const CIPHER = 'aes-256-gcm';

    private static function key()
    {
        $encodedKey = trim((string) cdoTutorConfig('CDO_TUTOR_SECRET_KEY', ''));
        $key = base64_decode($encodedKey, true);

        if ($key === false || strlen($key) !== 32) {
            throw new RuntimeException('CDO_TUTOR_SECRET_KEY must be a base64-encoded 32-byte key.');
        }

        return $key;
    }

    public static function encrypt($plainText)
    {
        $value = (string) $plainText;
        $iv = random_bytes(12);
        $tag = '';
        $cipherText = openssl_encrypt(
            $value,
            self::CIPHER,
            self::key(),
            OPENSSL_RAW_DATA,
            $iv,
            $tag
        );

        if ($cipherText === false) {
            throw new RuntimeException('Unable to encrypt the SMTP credential.');
        }

        return self::PREFIX . base64_encode($iv . $tag . $cipherText);
    }

    public static function decrypt($encryptedValue)
    {
        $value = (string) $encryptedValue;
        if (strpos($value, self::PREFIX) !== 0) {
            throw new RuntimeException('The stored SMTP credential has an unsupported format.');
        }

        $payload = base64_decode(substr($value, strlen(self::PREFIX)), true);
        if ($payload === false || strlen($payload) < 29) {
            throw new RuntimeException('The stored SMTP credential is invalid.');
        }

        $iv = substr($payload, 0, 12);
        $tag = substr($payload, 12, 16);
        $cipherText = substr($payload, 28);
        $plainText = openssl_decrypt(
            $cipherText,
            self::CIPHER,
            self::key(),
            OPENSSL_RAW_DATA,
            $iv,
            $tag
        );

        if ($plainText === false) {
            throw new RuntimeException('Unable to decrypt the SMTP credential.');
        }

        return $plainText;
    }
}
