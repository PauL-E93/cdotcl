<?php

use PHPMailer\PHPMailer\Exception as MailException;
use PHPMailer\PHPMailer\PHPMailer;

require_once __DIR__ . '/PHPMailer/src/Exception.php';
require_once __DIR__ . '/PHPMailer/src/PHPMailer.php';
require_once __DIR__ . '/PHPMailer/src/SMTP.php';
require_once __DIR__ . '/config/runtime.php';
require_once __DIR__ . '/security/SecretCipher.php';

/**
 * Central email transport for the application.
 *
 * The active owner's employee email is the single source of truth for both
 * the SMTP account and From address. The matching Gmail app password is
 * encrypted in the owner employee record before it is stored.
 */
class EmailService
{
    private $conn;
    private $ownerEmail;

    public function __construct(PDO $conn)
    {
        $this->conn = $conn;
    }

    public function getOwnerEmail()
    {
        if ($this->ownerEmail !== null) {
            return $this->ownerEmail;
        }

        $statement = $this->conn->prepare(
            "SELECT TRIM(e.email)
             FROM employee e
             INNER JOIN role r ON r.role_id = e.role_id
             WHERE LOWER(TRIM(r.role_name)) = 'owner'
               AND LOWER(TRIM(COALESCE(e.status, 'active'))) = 'active'
               AND e.email IS NOT NULL
               AND TRIM(e.email) <> ''
             ORDER BY e.employee_id ASC
             LIMIT 1"
        );
        $statement->execute();
        $email = trim((string) $statement->fetchColumn());

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new RuntimeException('The active owner account does not have a valid email address.');
        }

        $this->ownerEmail = $email;
        return $this->ownerEmail;
    }

    private function getSmtpPassword($ownerEmail)
    {
        $encryptedPassword = '';

        try {
            $statement = $this->conn->prepare(
                "SELECT e.smtp_app_password_encrypted
                 FROM employee e
                 INNER JOIN role r ON r.role_id = e.role_id
                 WHERE LOWER(TRIM(r.role_name)) = 'owner'
                   AND LOWER(TRIM(COALESCE(e.status, 'active'))) = 'active'
                   AND TRIM(e.email) = ?
                 ORDER BY e.employee_id ASC
                 LIMIT 1"
            );
            $statement->execute([$ownerEmail]);
            $encryptedPassword = trim((string) $statement->fetchColumn());
        } catch (PDOException $error) {
            if ((int) ($error->errorInfo[1] ?? 0) !== 1054) {
                throw $error;
            }
            throw new RuntimeException('Owner SMTP credential column is missing. Apply api/migrations/20260922_owner_smtp_credential.sql.', 0, $error);
        }

        if ($encryptedPassword !== '') {
            try {
                $password = preg_replace('/\s+/', '', SecretCipher::decrypt($encryptedPassword));
                if ($password !== '') {
                    return $password;
                }
            } catch (RuntimeException $error) {
                // A copied database needs the original encryption key or a
                // credential saved again on the destination server.
                error_log('Stored owner SMTP credential could not be decrypted. Check CDO_TUTOR_SECRET_KEY or save the app password again in Owner Profile > Email Sending.');
                throw $error;
            }
        }

        throw new RuntimeException('No owner SMTP app password is configured. Save it in Owner Profile > Email Sending.');
    }

    public function send($to, $subject, $htmlBody, array $options = [])
    {
        $recipientEmail = trim((string) $to);
        if (!filter_var($recipientEmail, FILTER_VALIDATE_EMAIL)) {
            error_log('Email was not sent because the recipient address is invalid.');
            return false;
        }

        try {
            $ownerEmail = $this->getOwnerEmail();
            $smtpPassword = $this->getSmtpPassword($ownerEmail);

            $smtpHost = trim((string) cdoTutorConfig('CDO_TUTOR_SMTP_HOST', 'smtp.gmail.com'));
            $smtpPort = (int) cdoTutorConfig('CDO_TUTOR_SMTP_PORT', '587');
            if ($smtpHost === '') {
                throw new RuntimeException('CDO_TUTOR_SMTP_HOST is not configured.');
            }
            if ($smtpPort < 1 || $smtpPort > 65535) {
                $smtpPort = 587;
            }

            $mail = new PHPMailer(true);
            $mail->isSMTP();
            $mail->Host = $smtpHost;
            $mail->SMTPAuth = true;
            $mail->Username = $ownerEmail;
            $mail->Password = $smtpPassword;

            $encryption = strtolower(trim((string) cdoTutorConfig('CDO_TUTOR_SMTP_ENCRYPTION', 'tls')));
            if ($encryption === 'ssl' || $encryption === 'smtps') {
                $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
            } elseif ($encryption !== '' && $encryption !== 'none') {
                $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
            } else {
                $mail->SMTPSecure = '';
                $mail->SMTPAutoTLS = false;
            }

            $mail->Port = $smtpPort;
            $mail->Timeout = 20;
            $mail->Timelimit = 20;
            $mail->CharSet = 'UTF-8';

            if (cdoTutorBooleanConfig('CDO_TUTOR_SMTP_ALLOW_SELF_SIGNED', false)) {
                $mail->SMTPOptions = [
                    'ssl' => [
                        'verify_peer' => false,
                        'verify_peer_name' => false,
                        'allow_self_signed' => true
                    ]
                ];
            }

            $fromName = trim((string) ($options['from_name'] ?? cdoTutorConfig('CDO_TUTOR_SMTP_FROM_NAME', 'CDO Tutorial Center')));
            $mail->setFrom($ownerEmail, $fromName);
            $mail->addAddress($recipientEmail, trim((string) ($options['recipient_name'] ?? '')));
            $mail->isHTML(true);
            $mail->Subject = (string) $subject;
            $mail->Body = (string) $htmlBody;
            $mail->AltBody = isset($options['alt_body']) && trim((string) $options['alt_body']) !== ''
                ? (string) $options['alt_body']
                : trim(html_entity_decode(strip_tags((string) $htmlBody), ENT_QUOTES | ENT_HTML5, 'UTF-8'));

            return $mail->send();
        } catch (MailException $error) {
            error_log('Email delivery failed: ' . $error->getMessage());
        } catch (Throwable $error) {
            error_log('Email configuration failed: ' . $error->getMessage());
        }

        return false;
    }
}
