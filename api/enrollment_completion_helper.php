<?php

/**
 * Keep enrollment lifecycle statuses in sync with their scheduled sessions.
 * A no-show is terminal because session progress already counts it as completed.
 */
function syncEnrollmentCompletionStatus(PDO $conn, int $enrollmentDetailsId): array
{
    if ($enrollmentDetailsId <= 0) {
        return ['completed' => false, 'changed' => false];
    }

    $ownsTransaction = !$conn->inTransaction();
    if ($ownsTransaction) {
        $conn->beginTransaction();
    }

    try {
        $stmt = $conn->prepare("SELECT enrollment_header_id, status AS details_status
        FROM enrollment_details
        WHERE enrollment_details_id = ?
        FOR UPDATE");
        $stmt->execute([$enrollmentDetailsId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$row) {
            if ($ownsTransaction) {
                $conn->commit();
            }
            return ['completed' => false, 'changed' => false];
        }

        $sessionsStmt = $conn->prepare("SELECT status
            FROM enrollment_preferred_schedule
            WHERE enrollment_details_id = ?");
        $sessionsStmt->execute([$enrollmentDetailsId]);
        $sessionStatuses = $sessionsStmt->fetchAll(PDO::FETCH_COLUMN);
        $totalSessions = count($sessionStatuses);
        $unfinishedSessions = count(array_filter($sessionStatuses, static function ($status) {
            return !in_array(strtolower(trim((string) $status)), ['done', 'completed', 'no-show'], true);
        }));
        $isCompleted = $totalSessions > 0 && $unfinishedSessions === 0;
        $detailsStatus = strtolower(trim((string) $row['details_status']));
        $detailsChanged = false;

        if ($isCompleted && $detailsStatus !== 'completed') {
            $updateDetails = $conn->prepare("UPDATE enrollment_details SET status = 'completed' WHERE enrollment_details_id = ?");
            $updateDetails->execute([$enrollmentDetailsId]);
            $detailsChanged = $updateDetails->rowCount() > 0;
        } elseif (!$isCompleted && $detailsStatus === 'completed') {
            $updateDetails = $conn->prepare("UPDATE enrollment_details SET status = 'enrolled' WHERE enrollment_details_id = ?");
            $updateDetails->execute([$enrollmentDetailsId]);
            $detailsChanged = $updateDetails->rowCount() > 0;
        }

        $headerId = (int) $row['enrollment_header_id'];
        $headerStmt = $conn->prepare("SELECT status AS header_status
            FROM enrollment_header
            WHERE enrollment_header_id = ?
            FOR UPDATE");
        $headerStmt->execute([$headerId]);
        $header = $headerStmt->fetch(PDO::FETCH_ASSOC);
        $headerChanged = false;

        if ($header) {
            $detailsStmt = $conn->prepare("SELECT status FROM enrollment_details WHERE enrollment_header_id = ?");
            $detailsStmt->execute([$headerId]);
            $detailsStatuses = $detailsStmt->fetchAll(PDO::FETCH_COLUMN);
            $allDetailsCompleted = count($detailsStatuses) > 0
                && count(array_filter($detailsStatuses, static function ($status) {
                    return strtolower(trim((string) $status)) !== 'completed';
                })) === 0;
            $headerStatus = strtolower(trim((string) $header['header_status']));

            if ($allDetailsCompleted && $headerStatus !== 'completed') {
                $updateHeader = $conn->prepare("UPDATE enrollment_header SET status = 'completed' WHERE enrollment_header_id = ?");
                $updateHeader->execute([$headerId]);
                $headerChanged = $updateHeader->rowCount() > 0;
            } elseif (!$allDetailsCompleted && $headerStatus === 'completed') {
                $updateHeader = $conn->prepare("UPDATE enrollment_header SET status = 'enrolled' WHERE enrollment_header_id = ?");
                $updateHeader->execute([$headerId]);
                $headerChanged = $updateHeader->rowCount() > 0;
            }
        }

        if ($ownsTransaction) {
            $conn->commit();
        }

        return [
            'completed' => $isCompleted,
            'changed' => $detailsChanged || $headerChanged,
            'details_changed' => $detailsChanged,
            'header_changed' => $headerChanged
        ];
    } catch (Throwable $error) {
        if ($ownsTransaction && $conn->inTransaction()) {
            $conn->rollBack();
        }
        throw $error;
    }
}
