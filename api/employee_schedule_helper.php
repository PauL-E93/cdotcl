<?php

function employeeScheduleValidationError($schedules) {
    if (!is_array($schedules)) {
        return 'Schedules must be a list of shifts.';
    }

    $days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    $seen = [];
    foreach ($schedules as $index => $shift) {
        if (!is_array($shift) || !in_array($shift['day'] ?? null, $days, true)) {
            return 'Please select a valid day for every shift.';
        }
        $times = [];
        foreach (['start', 'end'] as $field) {
            $time = $shift[$field] ?? null;
            if (!is_string($time) || !preg_match('/^(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?$/D', $time)) {
                return 'Please enter a valid start and end time for every shift.';
            }
            $times[$field] = strlen($time) === 5 ? $time . ':00' : $time;
        }
        if ($times['start'] >= $times['end']) {
            return 'End time must be later than start time for every shift.';
        }
        $key = $shift['day'] . '|' . $times['start'] . '|' . $times['end'];
        if (isset($seen[$key])) {
            return 'Duplicate schedule on ' . $shift['day'] . '. This start and end time is already listed. Remove the duplicate shift before saving.';
        }
        $seen[$key] = true;
    }
    return null;
}
