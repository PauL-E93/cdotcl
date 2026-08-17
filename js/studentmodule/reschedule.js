import { initEnrollmentDatePicker } from '../modules/enrollmentDatePicker.js';
import { buildAppUrl } from '../utilities/app_url.js';

export function openRescheduleModal(schedule, onSuccess, options = {}) {
    const isAdminAction = Boolean(options?.isAdminAction);
    const cutoffDateValue = schedule.last_session_date || schedule.lastSessionDate || schedule.latest_session_date || schedule.date;
    const minDate = addDaysToDateString(cutoffDateValue, 1);
    const currentStartTime = schedule.start_time || schedule.time || '';
    const currentEndTime = schedule.endTime || schedule.end_time || '';

    const content = `
        <div style="max-height: 520px; overflow-y: auto; text-align: left;">
            <div class="alert alert-info mb-3">
                <i class="bi bi-info-circle"></i>
                <strong>Current Schedule:</strong> ${schedule.day}, ${schedule.date} at ${formatTime(currentStartTime)}${currentEndTime ? ' - ' + formatTime(currentEndTime) : ''}
            </div>

            <div class="card p-3 bg-light">
                <input type="hidden" id="preferredTeacher" value="${schedule.preferred_teacher || ''}">
                <input type="hidden" id="schedDate" value="">

                <div class="row align-items-start g-3">
                    <div class="col-md-6 position-relative">
                        <label class="form-label small fw-bold">Select Date</label>
                        <input type="text" id="schedDateInput" class="form-control" placeholder="Loading available dates..." readonly>
                        <div id="dateCalendarContainer"></div>
                    </div>
                    <div class="col-md-3">
                        <label class="form-label small fw-bold">Start Time</label>
                        <input type="time" id="schedTime" class="form-control" value="${currentStartTime}" required>
                    </div>
                    <div class="col-md-3">
                        <label class="form-label small fw-bold">End Time</label>
                        <input type="time" id="schedEndTime" class="form-control" value="${currentEndTime}" required>
                    </div>
                </div>

                <div id="rescheduleSlotsInfo" class="mt-3 small text-muted"></div>
            </div>

            <div class="mt-3">
                <label class="form-label">Reason for Reschedule <small class="text-muted">(Optional)</small></label>
                <textarea class="form-control" id="reschedule-reason" rows="2" placeholder="Tell us why you need to reschedule..."></textarea>
            </div>
        </div>
    `;

    Swal.fire({
        title: 'Reschedule Session',
        html: content,
        width: 920,
        heightAuto: false,
        showCancelButton: true,
        confirmButtonText: isAdminAction ? 'Save Reschedule' : 'Submit Reschedule Request',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#6c757d',
        didOpen: async () => {
            wireReschedulePicker(schedule, minDate);
        },
        preConfirm: () => {
            const dateInput = document.getElementById('schedDate')?.value || '';
            const timeInput = document.getElementById('schedTime')?.value || '';
            const endTimeInput = document.getElementById('schedEndTime')?.value || '';

            if (!dateInput || !timeInput || !endTimeInput) {
                Swal.showValidationMessage('Please select a date, start time, and end time.');
                return false;
            }

            if (endTimeInput <= timeInput) {
                Swal.showValidationMessage('End time must be after start time.');
                return false;
            }

            if (!validateRescheduleSelection(dateInput, timeInput, endTimeInput)) {
                return false;
            }

            const dateObj = new Date(`${dateInput}T00:00:00`);
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            return {
                date: dateInput,
                day: days[dateObj.getDay()],
                time: timeInput,
                endTime: endTimeInput
            };
        }
    }).then((result) => {
        if (!result.isConfirmed) return;

        const reason = document.getElementById('reschedule-reason')?.value || '';
        submitRescheduleRequest(schedule, [result.value], reason, onSuccess, { isAdminAction });
    });
}

async function wireReschedulePicker(schedule, minDate) {
    const dateInput = document.getElementById('schedDateInput');
    const hiddenDate = document.getElementById('schedDate');
    const calendarContainer = document.getElementById('dateCalendarContainer');
    const startTimeInput = document.getElementById('schedTime');
    const endTimeInput = document.getElementById('schedEndTime');

    if (!dateInput || !hiddenDate || !calendarContainer || !startTimeInput || !endTimeInput) {
        return;
    }

    if (!schedule.preferred_teacher) {
        dateInput.value = '';
        dateInput.placeholder = 'No teacher assigned';
        renderAvailableSlots('');
        return;
    }

    window.parseTimeToMinutes = parseTimeToMinutes;
    window.minutesToTime = minutesToTime;
    window.subtractInterval = subtractInterval;

    const pickerKey = 'schedDateInput|schedDate|dateCalendarContainer';
    if (window.__enrollmentDatePickerInstances instanceof Map) {
        window.__enrollmentDatePickerInstances.delete(pickerKey);
    }

    window.teacherAvailableSlots = [];
    window.teacherBookedSlots = [];
    window.teacherAvailableDates = [];
    window.teacherAvailableSlotsPerDate = {};
    window.teacherFullShiftsPerDate = {};

    const validateCallback = () => {
        const selectedDate = hiddenDate.value;
        if (!selectedDate) return true;

        if (!window.teacherAvailableDates.includes(selectedDate)) {
            hiddenDate.value = '';
            dateInput.value = '';
            renderAvailableSlots('');
            Swal.fire({
                icon: 'warning',
                title: 'Date Not Available',
                text: 'Please select from the available dates shown for this teacher.',
                timer: 3000
            });
            return false;
        }

        renderAvailableSlots(selectedDate);
        return true;
    };

    initEnrollmentDatePicker({
        dateInputId: 'schedDateInput',
        hiddenDateId: 'schedDate',
        containerId: 'dateCalendarContainer',
        validateCallback,
        parseTimeToMinutes,
        containerMaxWidth: '460px'
    });

    dateInput.value = 'Loading...';
    dateInput.placeholder = 'Loading available dates...';
    hiddenDate.value = '';
    calendarContainer.style.display = 'none';

    try {
        const response = await axios.get(buildAppUrl(`api/admin/enrollment.php?operation=getTeacherAvailableSlots&teacher_id=${encodeURIComponent(schedule.preferred_teacher)}`));
        if (response.data.status !== 'success') {
            dateInput.value = '';
            dateInput.placeholder = 'No available dates';
            return;
        }

        window.teacherAvailableSlots = response.data.data.slots || [];
        window.teacherBookedSlots = response.data.data.bookings || [];

        const availableDates = getAvailableTeacherDates(window.teacherAvailableSlots, window.teacherBookedSlots, minDate, 180);
        window.teacherAvailableDates = availableDates;

        dateInput.value = '';
        dateInput.placeholder = availableDates.length > 0 ? 'Click to pick date' : 'No available dates';
        renderAvailableSlots('');

        startTimeInput.addEventListener('change', () => renderAvailableSlots(hiddenDate.value));
        endTimeInput.addEventListener('change', () => renderAvailableSlots(hiddenDate.value));
    } catch (error) {
        console.error('Error fetching teacher slots:', error);
        dateInput.value = '';
        dateInput.placeholder = 'Unable to load dates';
    }
}

function getAvailableTeacherDates(slots, bookings, minDate, daysAhead = 180) {
    if (!Array.isArray(slots) || slots.length === 0) return [];

    const bookingsByDate = {};
    (bookings || []).forEach(booking => {
        if (!bookingsByDate[booking.date]) {
            bookingsByDate[booking.date] = [];
        }

        bookingsByDate[booking.date].push({
            start: booking.start_time,
            end: booking.end_time
        });
    });

    const dates = [];
    const today = new Date();
    const minDateValue = minDate || formatLocalDate(today);

    window.teacherAvailableSlotsPerDate = {};
    window.teacherFullShiftsPerDate = {};

    for (let offset = 0; offset <= daysAhead; offset += 1) {
        const current = new Date(today);
        current.setDate(today.getDate() + offset);

        const formatted = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
        if (formatted < minDateValue) {
            continue;
        }

        const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][current.getDay()];
        const daySlots = slots.filter(slot => slot.day_of_week === dayName);
        if (daySlots.length === 0) {
            continue;
        }

        const shift = daySlots[0];
        window.teacherFullShiftsPerDate[formatted] = {
            start: shift.start_time,
            end: shift.end_time
        };

        const shiftStart = parseTimeToMinutes(shift.start_time);
        const shiftEnd = parseTimeToMinutes(shift.end_time);
        let remaining = [{ start: shiftStart, end: shiftEnd }];

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

function addDaysToDateString(dateString, days) {
    const parts = String(dateString || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!parts) {
        return formatLocalDate(new Date());
    }

    const [, year, month, day] = parts;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    date.setDate(date.getDate() + days);
    return formatLocalDate(date);
}

function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function validateRescheduleSelection(dateInput, timeInput, endTimeInput) {
    const teacherId = document.getElementById('preferredTeacher')?.value;
    if (!teacherId) return true;

    const available = window.teacherAvailableSlotsPerDate?.[dateInput];
    if (!available) {
        Swal.showValidationMessage('This date is not available for the selected teacher.');
        return false;
    }

    const start = parseTimeToMinutes(timeInput);
    const end = parseTimeToMinutes(endTimeInput);
    const overlaps = available.some(slot => {
        const slotStart = parseTimeToMinutes(slot.start);
        const slotEnd = parseTimeToMinutes(slot.end);
        return start < slotEnd && end > slotStart;
    });

    if (!overlaps) {
        Swal.showValidationMessage('The selected time is not within the available slots for this teacher.');
        return false;
    }

    return true;
}

function renderAvailableSlots(dateValue) {
    const info = document.getElementById('rescheduleSlotsInfo');
    if (!info) return;

    if (!dateValue) {
        info.innerHTML = 'Pick a date to load the teacher&apos;s open slots.';
        return;
    }

    const available = window.teacherAvailableSlotsPerDate?.[dateValue] || [];
    if (available.length === 0) {
        info.innerHTML = 'No open slots left for this date.';
        return;
    }

    const slots = available
        .map(slot => `${formatTime(slot.start)} - ${formatTime(slot.end)}`)
        .join(', ');

    info.innerHTML = `<strong>Available slots:</strong> ${slots}`;
}

function formatTime(time24) {
    if (!time24) return '';
    const [hours, minutes] = time24.split(':');
    const hour12 = parseInt(hours, 10) % 12 || 12;
    const ampm = parseInt(hours, 10) >= 12 ? 'PM' : 'AM';
    return `${hour12}:${minutes} ${ampm}`;
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
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
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

function submitRescheduleRequest(originalSchedule, newSchedules, reason, onSuccess, options = {}) {
    const isAdminAction = Boolean(options?.isAdminAction);

    Swal.fire({
        title: 'Submitting Request...',
        text: 'Please wait while we process your reschedule request.',
        allowOutsideClick: false,
        allowEscapeKey: false,
        showConfirmButton: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });

    axios.post(buildAppUrl('api/schedule_reschedule.php'), {
        operation: 'submitRescheduleRequest',
        original_enrollment_details_id: originalSchedule.enrollment_details_id,
        original_date: originalSchedule.date,
        new_schedules: newSchedules,
        reason: reason
    }, {
        withCredentials: true
    }).then(res => {
        Swal.close();

        if (res.data.status === 'success') {
            Swal.fire({
                icon: 'success',
                title: isAdminAction ? 'Session Rescheduled!' : 'Reschedule Request Submitted!',
                text: (!isAdminAction && window.location.pathname.includes('/student/'))
                    ? 'Your reschedule request has been sent to the admin for approval. You will be notified once it is reviewed.'
                    : 'The session schedule has been updated successfully.',
                confirmButtonText: 'OK'
            }).then(() => {
                if (typeof onSuccess === 'function') {
                    onSuccess();
                }
            });
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: res.data.message || 'Failed to submit reschedule request.'
            });
        }
    }).catch(err => {
        Swal.close();
        console.error('Reschedule error:', err);
        const errorMessage = err.response?.data?.message || err.message || 'Failed to submit reschedule request. Please try again.';
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: errorMessage
        });
    });
}
