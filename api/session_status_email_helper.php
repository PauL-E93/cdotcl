<?php
require_once __DIR__ . '/email_service.php';

/** One student-facing template for manual and time-based attendance changes. */
function buildSessionStatusEmail(array $schedule, string $status): array
{
    if (!in_array($status, ['no-show', 'done'], true)) throw new InvalidArgumentException('Unsupported session email status.');
    $escape = static fn($value) => htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    $zone = new DateTimeZone('Asia/Manila');
    $date = (new DateTimeImmutable($schedule['date'], $zone))->format('F j, Y');
    $time = (new DateTimeImmutable($schedule['date'] . ' ' . $schedule['start_time'], $zone))->format('g:i A');
    if (!empty($schedule['end_time'])) $time .= ' - ' . (new DateTimeImmutable($schedule['date'] . ' ' . $schedule['end_time'], $zone))->format('g:i A');
    $studentName = trim((string) ($schedule['student_name'] ?? '')) ?: 'Student';
    $houseBased = preg_replace('/[\s_-]+/', ' ', strtolower(trim((string) ($schedule['program_type'] ?? '')))) === 'house based';
    $title = $status === 'no-show' ? 'Session No-show' : 'Session Completed';
    $notice = $status === 'no-show'
        ? 'Your tutorial session has been marked as No-show.'
        : ($houseBased ? 'Your house-based tutorial session has been completed.'
            : 'Your tutorial session has been completed. The student is now ready for pickup.');
    $closing = $status === 'no-show'
        ? 'If you believe this attendance record is incorrect, please contact your teacher or tutorial center.'
        : ($houseBased ? "Thank you for completing today's house-based session." : 'Please arrange to pick up the student from the tutorial center.');
    $subject = $status === 'done'
        ? ($houseBased ? 'House-Based Session Completed' : 'Session Completed - Student Ready for Pickup')
        : $title;
    $details = ['Student' => $studentName, 'Date' => $date, 'Time' => $time . ' (Philippine time)',
        'Program' => ($schedule['program_name'] ?? '') ?: 'Tutorial',
        'Subject' => ($schedule['subject_name'] ?? '') ?: 'N/A',
        'Teacher' => ($schedule['teacher_name'] ?? '') ?: 'Assigned teacher',
        'Center' => ($schedule['branch_name'] ?? '') ?: 'N/A',
        'Status' => $status === 'no-show' ? 'No-show' : 'Done'];
    if ($status === 'done') {
        // Preserve the owner's existing Done-action email for both delivery paths.
        $details['Session Type'] = $houseBased ? 'House Based' : 'Center';
        unset($details['Status']);
        $details['Status'] = 'Done';
        $rows = '';
        foreach ($details as $label => $value) {
            $rows .= '<tr><th style="text-align:left;padding:8px">' . $escape($label) . '</th><td style="padding:8px">'
                . $escape($value) . '</td></tr>';
        }
        $html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="background:#f8fafc;font-family:Arial,sans-serif;color:#334155">'
            . '<div style="max-width:600px;margin:auto;padding:24px"><h2 style="background:#ea9aa6;color:white;padding:22px;text-align:center">' . $title . '</h2>'
            . '<div style="background:white;padding:24px"><p>' . $escape($notice) . '</p>'
            . '<table style="width:100%;border-collapse:collapse">' . $rows . '</table>'
            . '<p>' . $escape($closing) . '</p></div></div></body></html>';
        $plain = $notice . "\n";
        foreach ($details as $label => $value) $plain .= "{$label}: {$value}\n";
        $plain .= $closing;
        $subject = $houseBased ? $title : 'Session Completed - Student Ready for Pickup';
        return ['subject' => $subject . ' - ' . $date, 'html' => $html, 'plain' => $plain, 'recipient_name' => $studentName];
    }
    $rows = '';
    foreach ($details as $label => $value) {
        $rows .= '<tr><th scope="row" style="width:100px;text-align:left;vertical-align:top;padding:11px 14px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:13px;font-weight:600">'
            . $escape($label) . '</th><td style="padding:11px 14px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:14px;word-break:break-word">'
            . $escape($value) . '</td></tr>';
    }
    $html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
        . '<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;color:#334155">'
        . '<table role="presentation" style="width:100%;border-collapse:collapse;background:#f8fafc"><tr><td style="padding:24px 12px">'
        . '<table role="presentation" align="center" style="width:100%;max-width:600px;border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px">'
        . '<tr><td style="padding:24px;background:#ea9aa6;color:#ffffff;border-radius:12px 12px 0 0;text-align:center">'
        . '<p style="margin:0 0 8px;font-size:12px;letter-spacing:1px;font-weight:700">CDO TUTOR</p>'
        . '<h1 style="margin:0;font-size:24px;line-height:1.3">' . $escape($title) . '</h1></td></tr>'
        . '<tr><td style="padding:24px"><p style="margin:0 0 18px;font-size:15px">Hi ' . $escape($studentName) . ',</p>'
        . '<div style="padding:16px;background:#fdf2f4;border-left:4px solid #ea9aa6;border-radius:4px;font-size:15px;line-height:1.6">'
        . $escape($notice) . '</div><h2 style="font-size:16px;margin:24px 0 12px">Session details</h2>'
        . '<table style="width:100%;border-collapse:collapse;background:#f8fafc">' . $rows . '</table>'
        . '<p style="margin:20px 0 0;font-size:14px;line-height:1.6">' . $escape($closing) . '</p></td></tr>'
        . '<tr><td style="padding:16px 24px;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;color:#64748b">CDO Tutor &middot; Session Notification</td></tr>'
        . '</table></td></tr></table></body></html>';
    $plain = "Hi {$studentName},\n\n{$notice}\n\n";
    foreach ($details as $label => $value) $plain .= "{$label}: {$value}\n";
    $plain .= "\n{$closing}";
    return ['subject' => $subject . ' - ' . $date, 'html' => $html, 'plain' => $plain, 'recipient_name' => $studentName];
}

function sendSessionStatusEmail(EmailService $email, array $schedule, string $status): bool
{
    $recipient = trim((string) ($schedule['student_email'] ?? ''));
    if (!filter_var($recipient, FILTER_VALIDATE_EMAIL)) return false;
    $message = buildSessionStatusEmail($schedule, $status);
    return $email->send($recipient, $message['subject'], $message['html'], [
        'from_name' => 'CDO Tutor Session Notification', 'recipient_name' => $message['recipient_name'], 'alt_body' => $message['plain']
    ]);
}
