<?php
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

require 'PHPMailer/src/Exception.php';
require 'PHPMailer/src/PHPMailer.php';
require 'PHPMailer/src/SMTP.php';
include "admin/connection-pdo.php";
require_once __DIR__ . '/security/AuthGuard.php';
require_once __DIR__ . '/security/ScheduleActionToken.php';
require_once __DIR__ . '/tutorial_validity_helper.php';

class RescheduleConfirm {
    private $conn;

    public function __construct() {
        global $conn;
        $this->conn = $conn;
        ensureTutorialValiditySchema($this->conn);
    }

    private function getSchedule($enrollmentDetailsId, $scheduleDate) {
        $sql = "SELECT
                    eps.enrollment_details_id,
                    eps.date,
                    eps.day,
                    eps.start_time,
                    eps.end_time,
                    eps.status, ed.validity_start_date, ed.validity_end_date,
                    COALESCE(eps.substitute_teacher_id, ed.preferred_teacher) AS preferred_teacher,
                    (
                        SELECT MAX(eps2.date)
                        FROM enrollment_preferred_schedule eps2
                        WHERE eps2.enrollment_details_id = eps.enrollment_details_id
                    ) AS last_session_date,
                    p.name AS program_name,
                    sub.subject_name,
                    TRIM(CONCAT_WS(' ', s.first_name, s.last_name, NULLIF(TRIM(s.ext), ''))) AS student_name,
                    s.student_id,
                    s.email AS student_email,
                    CONCAT(t.first_name, ' ', t.last_name) AS teacher_name,
                    t.email AS teacher_email,
                    b.branch_name,
                    eh.branch_id
                FROM enrollment_preferred_schedule eps
                JOIN enrollment_details ed ON eps.enrollment_details_id = ed.enrollment_details_id
                JOIN enrollment_header eh ON ed.enrollment_header_id = eh.enrollment_header_id
                JOIN student s ON eh.student_id = s.student_id
                LEFT JOIN program p ON ed.program_id = p.program_id
                LEFT JOIN subject sub ON ed.subject_id = sub.subject_id
                LEFT JOIN employee t ON COALESCE(eps.substitute_teacher_id, ed.preferred_teacher) = t.employee_id
                LEFT JOIN branch b ON eh.branch_id = b.branch_id
                WHERE eps.enrollment_details_id = :enrollment_id
                  AND eps.date = :schedule_date
                LIMIT 1";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute([
            ':enrollment_id' => $enrollmentDetailsId,
            ':schedule_date' => $scheduleDate
        ]);

        return $stmt->fetch(PDO::FETCH_ASSOC);
    }

    private function renderRescheduleForm($schedule) {
        $originalTime = date('g:i A', strtotime($schedule['start_time']));
        if (!empty($schedule['end_time'])) {
            $originalTime .= ' - ' . date('g:i A', strtotime($schedule['end_time']));
        }

        $lastSessionDateValue = $schedule['last_session_date'] ?: $schedule['date'];
        $originalDateLabel = (new DateTime($lastSessionDateValue))->format('F j, Y');
        $scheduleDate = new DateTime($lastSessionDateValue);
        $minDate = $scheduleDate->modify('+1 day')->format('Y-m-d');
        $today = (new DateTime())->format('Y-m-d');
        $minDate = !empty($schedule['validity_end_date'])
            ? max($today, $schedule['validity_start_date'] ?? '')
            : max($minDate, $today);
        $validUntil = $schedule['validity_end_date'] ?? '';
        $validityLabel = $validUntil ? 'Sessions are valid through ' . htmlspecialchars(tutorialValidityLabel($validUntil), ENT_QUOTES, 'UTF-8') . ', inclusive.' : '';

        return "
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset='UTF-8'>
            <meta name='viewport' content='width=device-width, initial-scale=1.0'>
            <title>Reschedule Session</title>
            <link href='https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css' rel='stylesheet'>
            <link href='https://cdn.jsdelivr.net/npm/bootstrap-icons@1.7.2/font/bootstrap-icons.css' rel='stylesheet'>
            <style>
                body { font-family: Arial, sans-serif; background: #f8fafc; padding: 20px; }
                .container { max-width: 700px; margin: 0 auto; }
                .card { border: none; border-radius: 18px; box-shadow: 0 8px 20px rgba(15,23,42,0.08); }
                .card-header { background: #ea9aa6; color: white; border-radius: 18px 18px 0 0; padding: 24px; }
                .card-header h2 { margin: 0; font-size: 1.5rem; }
                .card-body { padding: 30px; }
                .form-group { margin-bottom: 20px; }
                .form-label { font-weight: 600; color: #0f172a; margin-bottom: 8px; }
                .form-control { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
                .form-control:focus { border-color: #ea9aa6; box-shadow: 0 0 0 3px rgba(234, 154, 166, 0.15); }
                .btn { border-radius: 8px; padding: 12px 24px; font-weight: 600; }
                .btn-primary { background: #ea9aa6; border: none; }
                .btn-primary:hover { background: #d8879a; }
                .btn-secondary { background: #6c757d; border: none; }
                .alert { border-radius: 12px; padding: 16px; margin-bottom: 24px; }
                .schedule-info { background: #f1f5f9; padding: 16px; border-radius: 12px; margin-bottom: 24px; }
                .schedule-info p { margin: 8px 0; font-size: 0.95rem; }
                .error { color: #dc2626; }
                .success { color: #ea9aa6; }
            </style>
        </head>
        <body>
            <div class='container'>
                <div class='card'>
                    <div class='card-header'>
                        <h2><i class='bi bi-calendar-check'></i> Reschedule Your Session</h2>
                    </div>
                    <div class='card-body'>
                        <div class='schedule-info'>
                            <p><strong>Program:</strong> {$schedule['program_name']}</p>
                            <p><strong>Subject:</strong> {$schedule['subject_name']}</p>
                            <p><strong>Teacher:</strong> {$schedule['teacher_name']}</p>
                            <p><strong>Current Schedule:</strong> " . date('F j, Y', strtotime($schedule['date'])) . " at {$originalTime}</p>
                        </div>

                        <form id='rescheduleForm'>
                            <p class='small text-muted'>{$validityLabel}</p>
                            <input type='hidden' id='enrollmentId' value='{$schedule['enrollment_details_id']}'>
                            <input type='hidden' id='originalDate' value='{$schedule['date']}'>
                            <input type='hidden' id='authToken' value=''>
                            <input type='hidden' id='authExpires' value=''>
                            <input type='hidden' id='preferredTeacher' value='{$schedule['preferred_teacher']}'>

                            <div class='form-group'>
                                <label for='schedDateInput' class='form-label'>New Date</label>
                                <div class='position-relative'>
                                    <div class='input-group'>
                                        <input type='text' class='form-control' id='schedDateInput' placeholder='Loading available dates...' readonly>
                                        <input type='hidden' id='newDate'>
                                        <button class='btn btn-outline-secondary' type='button' id='datePickerBtn' title='Open Calendar'>
                                            <i class='bi bi-calendar3'></i>
                                        </button>
                                    </div>
                                    <div id='dateCalendarContainer'></div>
                                </div>
                                <small class='text-muted'>Must be after {$originalDateLabel}</small>
                            </div>

                            <div class='row'>
                                <div class='col-md-6'>
                                    <div class='form-group'>
                                        <label for='startTimeDisplay' class='form-label'>Start Time</label>
                                        <input type='hidden' id='startTime'>
                                        <button type='button' class='form-control enrollment-time-trigger' id='startTimeDisplay' aria-label='Choose start time' aria-haspopup='dialog' aria-expanded='false' disabled>Select a date</button>
                                    </div>
                                </div>
                                <div class='col-md-6'>
                                    <div class='form-group'>
                                        <label for='endTimeDisplay' class='form-label'>End Time</label>
                                        <input type='hidden' id='endTime'>
                                        <button type='button' class='form-control enrollment-time-trigger' id='endTimeDisplay' aria-label='Choose end time' aria-haspopup='dialog' aria-expanded='false' disabled>Select a date</button>
                                    </div>
                                </div>
                            </div>

                            <div class='form-group'>
                                <div id='availabilityInfo' class='small text-muted'>Pick a date to load the teacher's available time slots.</div>
                            </div>

                            <div class='form-group'>
                                <label for='reason' class='form-label'>Reason for Reschedule (Optional)</label>
                                <textarea class='form-control' id='reason' rows='3' placeholder='Tell us why you need to reschedule...'></textarea>
                            </div>

                            <div id='errorMessage' class='alert alert-danger' style='display:none;'></div>
                            <div id='successMessage' class='alert alert-success' style='display:none;'></div>

                            <div class='d-grid gap-2 d-md-flex justify-content-md-end'>
                                <a href='javascript:history.back()' class='btn btn-secondary'>Cancel</a>
                                <button type='submit' class='btn btn-primary'>
                                    <i class='bi bi-check-circle'></i> Submit Reschedule Request
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <script src='https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js'></script>
            <script type='module'>
                import { initStudentDatePicker } from '../js/studentmodule/studentDatePicker.js?v=20261012-email-reschedule';
                import { initEnrollmentTimePickers, refreshEnrollmentTimePickers } from '../js/modules/enrollment_time_picker.js?v=20261012-email-reschedule';

                const urlParams = new URLSearchParams(window.location.search);
                const tokenParam = urlParams.get('token') || '';
                document.getElementById('authExpires').value = urlParams.get('expires') || '';
                if (tokenParam) {
                    document.getElementById('authToken').value = tokenParam;
                }

                const minDate = '{$minDate}';
                const validUntil = '{$validUntil}';
                const teacherId = document.getElementById('preferredTeacher').value;

                window.parseTimeToMinutes = parseTimeToMinutes;
                window.minutesToTime = minutesToTime;
                window.subtractInterval = subtractInterval;
                initEnrollmentTimePickers({ startTimeId: 'startTime', endTimeId: 'endTime', hiddenDateId: 'newDate' });

                window.validateTeacherDateSelection = function validateTeacherDateSelection() {
                    const dateValue = document.getElementById('newDate')?.value || '';
                    if (!teacherId || !dateValue || !window.teacherAvailableDates?.length) return true;

                    if (!window.teacherAvailableDates.includes(dateValue)) {
                        document.getElementById('newDate').value = '';
                        document.getElementById('schedDateInput').value = '';
                        renderAvailabilityInfo('');
                        showError('Please select from the available dates shown for this teacher.');
                        return false;
                    }

                    renderAvailabilityInfo(dateValue);
                    hideMessages();
                    return true;
                };

                initStudentDatePicker({
                    dateInputId: 'schedDateInput',
                    hiddenDateId: 'newDate',
                    buttonId: 'datePickerBtn',
                    containerId: 'dateCalendarContainer',
                    startTimeId: 'startTime',
                    endTimeId: 'endTime',
                    validateCallback: window.validateTeacherDateSelection,
                    onDateSelected: refreshEnrollmentTimePickers,
                    parseTimeToMinutes,
                    containerMaxWidth: '460px'
                });

                initializeTeacherAvailability();

                document.getElementById('rescheduleForm').addEventListener('submit', async (e) => {
                    e.preventDefault();

                    const enrollmentId = document.getElementById('enrollmentId').value;
                    const originalDate = document.getElementById('originalDate').value;
                    const authToken = document.getElementById('authToken').value;
                    const newDate = document.getElementById('newDate').value;
                    const startTime = document.getElementById('startTime').value;
                    const endTime = document.getElementById('endTime').value;
                    const reason = document.getElementById('reason').value;

                    if (validUntil && (newDate < minDate || newDate > validUntil)) { showError('Choose a session date within the tutorial validity period.'); return; }
                    if (!newDate || !startTime || !endTime) {
                        showError('Please fill in all required fields.');
                        return;
                    }

                    if (endTime <= startTime) {
                        showError('End time must be after start time.');
                        return;
                    }

                    if (!window.validateTeacherDateSelection()) {
                        return;
                    }

                    const available = window.teacherAvailableSlotsPerDate?.[newDate];
                    if (!available) {
                        showError('This date is not available for the selected teacher.');
                        return;
                    }

                    const startMinutes = parseTimeToMinutes(startTime);
                    const endMinutes = parseTimeToMinutes(endTime);
                    const fitsAvailableSlot = available.some(slot => {
                        const slotStart = parseTimeToMinutes(slot.start);
                        const slotEnd = parseTimeToMinutes(slot.end);
                        return startMinutes >= slotStart && endMinutes <= slotEnd;
                    });

                    if (!fitsAvailableSlot) {
                        showError('The selected time is not within the available slots for this teacher.');
                        return;
                    }

                    const dateObj = new Date(newDate);
                    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                    const dayName = days[dateObj.getDay()];

                    const button = document.querySelector('button[type=\"submit\"]');
                    button.disabled = true;
                    button.innerHTML = '<i class=\"bi bi-hourglass-split\"></i> Submitting...';

                    try {
                        const response = await axios.post('schedule_reschedule.php', {
                            operation: 'submitRescheduleRequest',
                            original_enrollment_details_id: parseInt(enrollmentId),
                            original_date: originalDate,
                            token: authToken,
                            expires: document.getElementById('authExpires').value,
                            new_schedules: [{
                                date: newDate,
                                day: dayName,
                                time: startTime,
                                endTime: endTime
                            }],
                            reason: reason
                        }, {
                            withCredentials: true
                        });

                        if (response.data.status === 'success') {
                            showSuccess('Reschedule request submitted successfully! The teacher and branch admin have been notified.');
                            setTimeout(() => {
                                window.location.href = '../html/student/schedule.html';
                            }, 2000);
                        } else {
                            showError(response.data.message || 'Failed to submit reschedule request.');
                        }
                    } catch (error) {
                        const errorMsg = error.response?.data?.message || error.message || 'Failed to submit reschedule request.';
                        showError(errorMsg);
                    } finally {
                        button.disabled = false;
                    button.innerHTML = '<i class=\"bi bi-check-circle\"></i> Submit Reschedule Request';
                    }
                });

                async function initializeTeacherAvailability() {
                    const dateInput = document.getElementById('schedDateInput');
                    const hiddenDate = document.getElementById('newDate');
                    const calendarContainer = document.getElementById('dateCalendarContainer');

                    window.teacherAvailableSlots = [];
                    window.teacherBookedSlots = [];
                    window.teacherAvailableDates = [];
                    window.teacherAvailableSlotsPerDate = {};
                    window.teacherFullShiftsPerDate = {};

                    if (dateInput) {
                        dateInput.value = teacherId ? 'Loading...' : '';
                        dateInput.placeholder = teacherId ? 'Loading available dates...' : 'No teacher assigned';
                    }
                    if (hiddenDate) {
                        hiddenDate.value = '';
                    }
                    refreshEnrollmentTimePickers();
                    if (calendarContainer) {
                        calendarContainer.style.display = 'none';
                    }

                    if (!teacherId) {
                        renderAvailabilityInfo('');
                        return;
                    }

                    try {
                        const availabilityUrl = new URL('admin/enrollment.php', location.href);
                        availabilityUrl.searchParams.set('operation', 'getTeacherAvailableSlots');
                        availabilityUrl.searchParams.set('teacher_id', teacherId);
                        availabilityUrl.searchParams.set('enrollment_details_id', document.getElementById('enrollmentId').value);
                        availabilityUrl.searchParams.set('schedule_date', document.getElementById('originalDate').value);
                        availabilityUrl.searchParams.set('expires', document.getElementById('authExpires').value);
                        availabilityUrl.searchParams.set('token', document.getElementById('authToken').value);
                        const response = await axios.get(availabilityUrl.href);
                        if (response.data.status !== 'success') {
                            if (dateInput) {
                                dateInput.value = '';
                                dateInput.placeholder = 'No available dates';
                            }
                            return;
                        }

                        window.teacherAvailableSlots = response.data.data.slots || [];
                        window.teacherBookedSlots = response.data.data.bookings || [];
                        window.teacherAvailableDates = getAvailableTeacherDates(window.teacherAvailableSlots, window.teacherBookedSlots, minDate, 180).filter(date => !validUntil || date <= validUntil);

                        if (dateInput) {
                            dateInput.value = '';
                            dateInput.placeholder = window.teacherAvailableDates.length > 0 ? 'Click to pick date' : 'No available dates';
                        }
                        renderAvailabilityInfo('');
                    } catch (error) {
                        console.error('Error fetching teacher slots:', error);
                        if (dateInput) {
                            dateInput.value = '';
                            dateInput.placeholder = 'Unable to load dates';
                        }
                    }
                }

                function getAvailableTeacherDates(slots, bookings, minAllowedDate, daysAhead = 180) {
                    window.teacherAvailableSlotsPerDate = {};
                    window.teacherFullShiftsPerDate = {};
                    if (!Array.isArray(slots) || slots.length === 0) {
                        return [];
                    }

                    window.teacherAvailableSlotsPerDate = {};
                    window.teacherFullShiftsPerDate = {};

                    const bookingsByDate = {};
                    (bookings || []).forEach(booking => {
                        if (!bookingsByDate[booking.date]) {
                            bookingsByDate[booking.date] = [];
                        }
                        bookingsByDate[booking.date].push({ start: booking.start_time, end: booking.end_time });
                    });

                    const dates = [];
                    const today = new Date();
                    for (let i = 0; i <= daysAhead; i++) {
                        const current = new Date(today);
                        current.setDate(today.getDate() + i);

                        const formatted = current.getFullYear()
                            + '-' + String(current.getMonth() + 1).padStart(2, '0')
                            + '-' + String(current.getDate()).padStart(2, '0');
                        if (formatted < minAllowedDate) {
                            continue;
                        }

                        const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][current.getDay()];
                        const daySlots = slots.filter(slot => slot.day_of_week === dayName);
                        if (daySlots.length === 0) {
                            continue;
                        }

                        const shifts = daySlots.map(slot => ({ start: parseTimeToMinutes(slot.start_time), end: parseTimeToMinutes(slot.end_time) }))
                            .filter(slot => slot.end > slot.start)
                            .sort((a, b) => a.start - b.start)
                            .reduce((merged, slot) => {
                                const last = merged[merged.length - 1];
                                if (last && slot.start <= last.end) last.end = Math.max(last.end, slot.end);
                                else merged.push({ ...slot });
                                return merged;
                            }, []);
                        if (!shifts.length) continue;
                        window.teacherFullShiftsPerDate[formatted] = {
                            start: minutesToTime(shifts[0].start), end: minutesToTime(shifts[shifts.length - 1].end),
                            totalMinutes: shifts.reduce((total, shift) => total + shift.end - shift.start, 0)
                        };
                        let remaining = shifts.map(shift => ({ ...shift }));

                        const booked = bookingsByDate[formatted] || [];
                        booked.forEach(item => {
                            const bookedStart = parseTimeToMinutes(item.start);
                            const bookedEnd = parseTimeToMinutes(item.end);
                            remaining = subtractInterval(remaining, bookedStart, bookedEnd);
                        });

                        if (remaining.length > 0) {
                            window.teacherAvailableSlotsPerDate[formatted] = remaining.map(range => ({
                                start: minutesToTime(range.start),
                                end: minutesToTime(range.end)
                            }));
                            dates.push(formatted);
                        }
                    }

                    return dates;
                }

                function renderAvailabilityInfo(dateValue) {
                    const info = document.getElementById('availabilityInfo');
                    if (!info) return;

                    if (!dateValue) {
                        info.textContent = 'Pick a date to load the teacher\\'s available time slots.';
                        return;
                    }

                    const available = window.teacherAvailableSlotsPerDate?.[dateValue] || [];
                    if (available.length === 0) {
                        info.textContent = 'No open slots left for this date.';
                        return;
                    }

                    const slots = available
                        .map(slot => formatTime(slot.start) + ' - ' + formatTime(slot.end))
                        .join(', ');
                    info.innerHTML = '<strong>Available slots:</strong> ' + slots;
                }

                function parseTimeToMinutes(timeString) {
                    if (!timeString) return 0;
                    const parts = timeString.split(':');
                    const hours = parseInt(parts[0], 10) || 0;
                    const minutes = parseInt(parts[1], 10) || 0;
                    return hours * 60 + minutes;
                }

                function minutesToTime(minutes) {
                    const hours = Math.floor(minutes / 60);
                    const mins = minutes % 60;
                    return hours.toString().padStart(2, '0') + ':' + mins.toString().padStart(2, '0');
                }

                function subtractInterval(intervals, bookedStart, bookedEnd) {
                    const result = [];
                    intervals.forEach(interval => {
                        if (bookedEnd <= interval.start || bookedStart >= interval.end) {
                            result.push(interval);
                            return;
                        }

                        if (bookedStart > interval.start) {
                            result.push({ start: interval.start, end: bookedStart });
                        }

                        if (bookedEnd < interval.end) {
                            result.push({ start: bookedEnd, end: interval.end });
                        }
                    });
                    return result;
                }

                function formatTime(time24) {
                    if (!time24) return '';
                    const [hours, minutes] = time24.split(':');
                    const hour12 = parseInt(hours, 10) % 12 || 12;
                    const ampm = parseInt(hours, 10) >= 12 ? 'PM' : 'AM';
                    return hour12 + ':' + minutes + ' ' + ampm;
                }

                function hideMessages() {
                    document.getElementById('errorMessage').style.display = 'none';
                    document.getElementById('successMessage').style.display = 'none';
                }

                function showError(message) {
                    const errorDiv = document.getElementById('errorMessage');
                    errorDiv.textContent = message;
                    errorDiv.style.display = 'block';
                    document.getElementById('successMessage').style.display = 'none';
                }

                function showSuccess(message) {
                    const successDiv = document.getElementById('successMessage');
                    successDiv.textContent = message;
                    successDiv.style.display = 'block';
                    document.getElementById('errorMessage').style.display = 'none';
                }
            </script>
        </body>
        </html>
        ";
    }

    private function renderErrorPage($title, $message) {
        return "
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset='UTF-8'>
            <meta name='viewport' content='width=device-width, initial-scale=1.0'>
            <title>{$title}</title>
            <link href='https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css' rel='stylesheet'>
            <link href='https://cdn.jsdelivr.net/npm/bootstrap-icons@1.7.2/font/bootstrap-icons.css' rel='stylesheet'>
            <style>
                body { font-family: Arial, sans-serif; background: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
                .error-container { text-align: center; padding: 40px; background: white; border-radius: 18px; box-shadow: 0 8px 20px rgba(15,23,42,0.08); max-width: 500px; }
                .error-icon { font-size: 3rem; color: #ef4444; margin-bottom: 20px; }
                h1 { color: #0f172a; margin-bottom: 10px; }
                p { color: #475569; margin-bottom: 20px; }
                a { color: #ea9aa6; text-decoration: none; font-weight: 600; }
            </style>
        </head>
        <body>
            <div class='error-container'>
                <div class='error-icon'><i class='bi bi-exclamation-circle'></i></div>
                <h1>{$title}</h1>
                <p>{$message}</p>
                <a href='../html/student/schedule.html'>← Back to Schedule</a>
            </div>
        </body>
        </html>
        ";
    }

    public function run() {
        $enrollmentDetailsId = $_GET['enrollment_details_id'] ?? 0;
        $scheduleDate = $_GET['schedule_date'] ?? '';

        if (!$enrollmentDetailsId || !$scheduleDate) {
            echo $this->renderErrorPage('Invalid Request', 'Missing schedule details.');
            return;
        }

        $schedule = $this->getSchedule($enrollmentDetailsId, $scheduleDate);
        if (!$schedule) {
            echo $this->renderErrorPage('Schedule Not Found', 'Unable to locate the requested schedule.');
            return;
        }

        $user = AuthGuard::user();
        $signed = ScheduleActionToken::validReschedule((int) $enrollmentDetailsId, (string) $scheduleDate,
            (string) ($schedule['student_email'] ?? ''), $_GET['expires'] ?? null, $_GET['token'] ?? null);
        if ((!$user || $user['user_type'] !== 'student' || $user['user_id'] !== (int) $schedule['student_id'])
            && !$signed) {
            http_response_code(403);
            echo $this->renderErrorPage('Access Denied', 'Sign in as the student or use a current reschedule link.');
            return;
        }

        if (!empty($schedule['validity_end_date']) && (new DateTimeImmutable('now', new DateTimeZone('Asia/Manila')))->format('Y-m-d') > $schedule['validity_end_date']) {
            echo $this->renderErrorPage('Tutorial Expired', 'This package has expired. Contact the center to request an authorized validity extension.'); return;
        }
        echo $this->renderRescheduleForm($schedule);
    }
}

$reschedule = new RescheduleConfirm();
$reschedule->run();
?>
