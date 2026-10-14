<?php

/** Explain the actual plotting result without treating every failure as a booking conflict. */
function scheduleSuggestionFailureMessage(int $requiredMinutes, int $scheduledMinutes, float $durationHours, ?int $validityDays, array $suggestions, array $failures): string
{
    $hours = static fn($minutes) => rtrim(rtrim(number_format($minutes / 60, 2, '.', ''), '0'), '.');
    $message = 'Could plot ' . $hours($scheduledMinutes) . ' of ' . $hours($requiredMinutes)
        . ' required hours using ' . $hours($durationHours * 60) . '-hour sessions. Still missing '
        . $hours($requiredMinutes - $scheduledMinutes) . ' hours.';
    $window = null;
    if ($validityDays && $suggestions) {
        $window = tutorialValidityWindow(min(array_column($suggestions, 'date')), $validityDays);
        $message .= '\nValidity window: ' . tutorialValidityLabel($window['validity_start_date']) . ' through '
            . tutorialValidityLabel($window['validity_end_date']) . ' (' . $validityDays . ' calendar days, inclusive). Later dates cannot be used.';
    } elseif ($validityDays) {
        $message .= '\nNo first session could be plotted, so the ' . $validityDays . '-day validity window has not started.';
    }
    $successfulDates = array_column($suggestions, 'date');
    $details = [];
    ksort($failures);
    foreach ($failures as $date => $slots) {
        if (in_array($date, $successfulDates, true)) continue;
        if ($window && ($date < $window['validity_start_date'] || $date > $window['validity_end_date'])) continue;
        foreach ($slots as $slot) {
            $timeLabel = static fn($time) => date('g:i A', strtotime($time));
            $range = $timeLabel($slot['start_time']) . '–' . $timeLabel($slot['end_time']);
            if ($slot['reason'] === 'short') {
                $reason = 'teacher/student overlap is only ' . $slot['available_minutes']
                    . ' minutes; this session needs ' . $slot['required_minutes'] . ' minutes.';
            } else {
                $booked = array_map(static fn($booking) => $timeLabel($booking['start_time']) . '–' . $timeLabel($booking['end_time']), $slot['bookings']);
                $reason = 'existing teacher bookings (' . implode(', ', array_unique($booked))
                    . ') leave no ' . $slot['required_minutes'] . '-minute opening at the supported 30-minute start intervals.';
            }
            $details[] = tutorialValidityLabel($date) . ' (' . $range . '): ' . $reason;
        }
    }
    if ($details) {
        $message .= '\nSkipped openings:\n' . implode('\n', array_slice($details, 0, 6));
        if (count($details) > 6) $message .= '\nPlus ' . (count($details) - 6) . ' other skipped openings.';
    } elseif ($window) {
        $message .= '\nNo matching opening inside this window was rejected for being too short or overlapping a booking. There were too few matching dates to finish the package.';
    }
    $message .= '\nThe generator plots at most one session per date. A skipped opening does not stop it from trying other dates.';
    return str_replace('\\n', "\n", $message);
}
