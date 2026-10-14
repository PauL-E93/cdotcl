<?php
final class PasswordPolicy
{
    public const MIN_LENGTH = 12;
    // PASSWORD_DEFAULT currently uses bcrypt, which ignores bytes after 72.
    public const MAX_LENGTH = 72;

    public static function valid($password): bool
    {
        return is_string($password)
            && strlen($password) >= self::MIN_LENGTH
            && strlen($password) <= self::MAX_LENGTH
            && preg_match('/[A-Za-z]/', $password)
            && preg_match('/[A-Z]/', $password)
            && preg_match('/[0-9]/', $password)
            && preg_match('/[^A-Za-z0-9]/', $password);
    }

    public static function message(): string
    {
        return 'Password must be 12 to 72 bytes long and include an uppercase letter, a number, and a symbol.';
    }
}
