<?php

/**
 * Return the first unresolved session scheduled before the selected session.
 * Sessions marked done or no-show are terminal and do not block progression.
 */
function findEarlierUnresolvedSession(
    PDO $conn,
    $preferenceId = null,
    array $preferenceIds = [],
    $enrollmentDetailsId = null,
    $scheduleDate = null,
    bool $lockForUpdate = false
) {
    $targetIds = array_values(array_unique(array_filter(
        array_map('intval', $preferenceIds),
        static fn($id) => $id > 0
    )));
    if (!$targetIds && (int) $preferenceId > 0) {
        $targetIds = [(int) $preferenceId];
    }

    $lockSql = $lockForUpdate ? ' FOR UPDATE' : '';

    if ($targetIds) {
        $placeholders = [];
        $targetParams = [];
        foreach ($targetIds as $index => $id) {
            $placeholder = ':target_preference_' . $index;
            $placeholders[] = $placeholder;
            $targetParams[$placeholder] = $id;
        }
        $targetSql = "SELECT preference_id, enrollment_details_id, date, start_time
                      FROM enrollment_preferred_schedule
                      WHERE preference_id IN (" . implode(',', $placeholders) . ")
                      ORDER BY date ASC, start_time ASC, preference_id ASC
                      LIMIT 1{$lockSql}";
    } else {
        $targetSql = "SELECT preference_id, enrollment_details_id, date, start_time
                      FROM enrollment_preferred_schedule
                      WHERE enrollment_details_id = :target_enrollment_details_id
                        AND date = :target_schedule_date
                      ORDER BY start_time ASC, preference_id ASC
                      LIMIT 1{$lockSql}";
        $targetParams = [
            ':target_enrollment_details_id' => $enrollmentDetailsId,
            ':target_schedule_date' => $scheduleDate
        ];
    }

    $targetStmt = $conn->prepare($targetSql);
    $targetStmt->execute($targetParams);
    $target = $targetStmt->fetch(PDO::FETCH_ASSOC);
    if (!$target) {
        return null;
    }

    $blockingSql = "SELECT preference_id, date, start_time, status
                    FROM enrollment_preferred_schedule
                    WHERE enrollment_details_id = :blocking_enrollment_details_id
                      AND (
                          date < :blocking_date_before
                          OR (date = :blocking_date_time AND start_time < :blocking_start_time_before)
                          OR (date = :blocking_date_id AND start_time = :blocking_start_time_id AND preference_id < :blocking_preference_id)
                      )
                      AND COALESCE(status, 'pending') NOT IN ('done', 'no-show')
                    ORDER BY date ASC, start_time ASC, preference_id ASC
                    LIMIT 1{$lockSql}";
    $blockingStmt = $conn->prepare($blockingSql);
    $blockingStmt->execute([
        ':blocking_enrollment_details_id' => $target['enrollment_details_id'],
        ':blocking_date_before' => $target['date'],
        ':blocking_date_time' => $target['date'],
        ':blocking_start_time_before' => $target['start_time'],
        ':blocking_date_id' => $target['date'],
        ':blocking_start_time_id' => $target['start_time'],
        ':blocking_preference_id' => $target['preference_id']
    ]);

    return $blockingStmt->fetch(PDO::FETCH_ASSOC) ?: null;
}

