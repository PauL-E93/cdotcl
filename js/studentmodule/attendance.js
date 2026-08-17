const STUDENT_ATTENDANCE_API = '../../api/student/attendance.php';

const attendanceState = {
    enrollmentDetailsId: 0,
    currentMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    selectedDate: '',
    dashboard: null,
    loading: false
};

const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fullWeekdayLabels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const statusDefinitions = {
    present: { label: 'Present', icon: 'bi-check-circle-fill', tone: 'present' },
    absent: { label: 'Absent', icon: 'bi-x-circle', tone: 'absent' },
    late: { label: 'Late', icon: 'bi-clock-fill', tone: 'late' },
    excused: { label: 'Excused', icon: 'bi-shield-check', tone: 'excused' },
    unrecorded: { label: 'No attendance saved', icon: 'bi-dash-circle', tone: 'unrecorded' }
};

function initStudentAttendance() {
    const root = getRoot();
    if (!root) return;

    attendanceState.enrollmentDetailsId = Number(
        new URLSearchParams(window.location.search).get('enrollment_details_id') || 0
    );

    root.addEventListener('click', handleRootClick);
    ensureDetailsModal();

    if (!attendanceState.enrollmentDetailsId) {
        renderError('No enrollment was selected. Open Attendance from the action menu of an enrollment.');
        return;
    }

    loadDashboard();
}

async function loadDashboard({ preserveSelection = false } = {}) {
    const root = getRoot();
    if (!root || attendanceState.loading) return;

    attendanceState.loading = true;
    root.innerHTML = renderLoading();

    try {
        const requestedMonth = getMonthKey(attendanceState.currentMonth);
        const response = await axios.get(STUDENT_ATTENDANCE_API, {
            params: {
                operation: 'getAttendanceDashboard',
                enrollment_details_id: attendanceState.enrollmentDetailsId,
                month: requestedMonth
            }
        });

        if (response.data?.status !== 'success') {
            throw new Error(response.data?.message || 'Unable to load attendance.');
        }

        attendanceState.dashboard = response.data.data;
        const normalizedMonth = normalizeMonthToSchoolYear();

        if (normalizedMonth !== requestedMonth) {
            attendanceState.loading = false;
            await loadDashboard({ preserveSelection });
            return;
        }

        attendanceState.selectedDate = pickSelectedDate(preserveSelection);
        renderDashboard();
    } catch (error) {
        console.error('Unable to load student attendance:', error);
        renderError(error.response?.data?.message || error.message || 'Unable to load attendance.');
    } finally {
        attendanceState.loading = false;
    }
}

function renderDashboard() {
    const root = getRoot();
    const data = attendanceState.dashboard;
    if (!root || !data) return;

    const enrollment = data.enrollment || {};
    const selectedRecord = data.attendance_by_date?.[attendanceState.selectedDate] || null;
    const selectedStatus = getStatusDefinition(selectedRecord?.status || 'unrecorded');
    const selectedSchedules = getSchedulesForDate(attendanceState.selectedDate);
    const selectedDateLabel = attendanceState.selectedDate
        ? formatLongDate(attendanceState.selectedDate)
        : 'Select a scheduled date';

    root.innerHTML = `
        <div class="sa-page">
            <section class="sa-card sa-hero">
                <div class="sa-hero-panel">
                    <h1 class="sa-title">${escapeHtml(enrollment.section_name || 'Class Attendance')}</h1>
                    <p class="sa-subtitle">View your attendance for ${escapeHtml(enrollment.program_name || 'your class')} at ${escapeHtml(enrollment.branch_name || 'your branch')}.</p>

                    <div class="sa-label">Selected section</div>
                    <div class="sa-value">${escapeHtml(enrollment.program_name || 'Program')}</div>
                    <div class="sa-label">Student</div>
                    <div class="sa-value">${escapeHtml(enrollment.student_name || 'Student')}</div>
                    <div class="sa-label">Schedules</div>
                    <div class="sa-schedules">${renderSchedulePills(enrollment.schedules || [])}</div>
                </div>

                <div class="sa-hero-panel">
                    <div class="sa-selected-header">
                        <div class="sa-label">Selected date</div>
                        <a class="btn btn-sm btn-outline-secondary sa-back-btn" href="./enrollement_pre_play.html">
                            <i class="bi bi-chevron-left me-1"></i> Back to Class
                        </a>
                    </div>
                    <div class="sa-selected-date">${escapeHtml(selectedDateLabel)}</div>
                    <div class="sa-school-year">${renderSchoolYear(enrollment)}</div>
                    ${attendanceState.selectedDate ? `
                        <div class="sa-status-badge sa-status-${selectedStatus.tone}">
                            <i class="bi ${selectedStatus.icon}"></i> ${escapeHtml(selectedStatus.label)}
                        </div>
                        <div>
                            <button type="button" class="btn btn-sm btn-outline-primary sa-details-btn" data-view-attendance-details>
                                <i class="bi bi-calendar2 me-1"></i> View Attendance Details
                            </button>
                        </div>
                    ` : '<div class="sa-muted small">There are no scheduled class dates in this month.</div>'}
                    ${selectedSchedules.length > 1 ? `<div class="sa-muted small mt-2">${selectedSchedules.length} schedules on this date</div>` : ''}
                </div>
            </section>

            <div class="sa-content-grid">
                <section class="sa-card sa-calendar-card">
                    <div class="sa-calendar-toolbar">
                        <div class="sa-month-controls">
                            <button type="button" class="btn btn-sm btn-outline-secondary sa-nav-btn" data-month-nav="prev" aria-label="Previous month" ${canNavigateMonth(-1) ? '' : 'disabled'}>
                                <i class="bi bi-chevron-left"></i>
                            </button>
                            <div class="sa-month-title">${escapeHtml(formatMonthTitle(attendanceState.currentMonth))}</div>
                            <button type="button" class="btn btn-sm btn-outline-secondary sa-nav-btn" data-month-nav="next" aria-label="Next month" ${canNavigateMonth(1) ? '' : 'disabled'}>
                                <i class="bi bi-chevron-right"></i>
                            </button>
                        </div>
                        <button type="button" class="btn btn-sm btn-outline-danger sa-today-btn" data-month-nav="today">Today</button>
                    </div>
                    <div class="sa-calendar-scroll">
                        <div class="sa-calendar-grid">${renderCalendar()}</div>
                    </div>
                </section>

                <aside class="sa-sidebar">
                    <section class="sa-card sa-sidebar-card">
                        <h2 class="sa-sidebar-title">Attendance Summary</h2>
                        ${renderSummary(data.summary || {})}
                    </section>
                    <section class="sa-card sa-sidebar-card">
                        <h2 class="sa-sidebar-title">Recent Attendance</h2>
                        <div class="sa-recent-list">${renderRecentAttendance(data.recent_attendance || [], enrollment.program_name)}</div>
                    </section>
                </aside>
            </div>
        </div>
    `;
}

function renderCalendar() {
    const cells = weekdayLabels.map(label => `<div class="sa-weekday">${label}</div>`);
    const year = attendanceState.currentMonth.getFullYear();
    const month = attendanceState.currentMonth.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const previousMonthDays = new Date(year, month, 0).getDate();

    for (let index = 0; index < 42; index += 1) {
        let date;
        let isCurrentMonth = true;

        if (index < firstWeekday) {
            date = new Date(year, month - 1, previousMonthDays - firstWeekday + index + 1);
            isCurrentMonth = false;
        } else if (index >= firstWeekday + daysInMonth) {
            date = new Date(year, month + 1, index - firstWeekday - daysInMonth + 1);
            isCurrentMonth = false;
        } else {
            date = new Date(year, month, index - firstWeekday + 1);
        }

        const dateKey = formatDateKey(date);
        const schedules = isCurrentMonth ? getSchedulesForDate(dateKey) : [];
        const isScheduled = schedules.length > 0;
        const record = attendanceState.dashboard?.attendance_by_date?.[dateKey] || null;
        const status = record ? getStatusDefinition(record.status) : null;
        const classes = [
            'sa-day',
            isCurrentMonth ? '' : 'is-outside',
            isSameDate(date, new Date()) ? 'is-today' : '',
            attendanceState.selectedDate === dateKey ? 'is-selected' : '',
            status ? `status-${status.tone}` : ''
        ].filter(Boolean).join(' ');

        if (!isCurrentMonth) {
            cells.push(`
                <div class="${classes}">
                    <span class="sa-date-number">${date.getDate()}</span>
                    <span class="sa-no-class">No class</span>
                </div>
            `);
            continue;
        }

        cells.push(`
            <button type="button" class="${classes}" data-attendance-date="${dateKey}" ${isScheduled ? '' : 'disabled'}>
                <span class="sa-date-number">${date.getDate()}</span>
                ${isScheduled ? `
                    <span class="sa-day-status sa-status-${status?.tone || 'unrecorded'}">
                        <i class="bi ${status?.icon || statusDefinitions.unrecorded.icon}"></i>
                        ${escapeHtml(status?.label || statusDefinitions.unrecorded.label)}
                    </span>
                    <span class="sa-day-time">${escapeHtml(formatScheduleWindow(schedules))}</span>
                ` : '<span class="sa-no-class">No class</span>'}
            </button>
        `);
    }

    return cells.join('');
}

function renderSummary(summary) {
    const rows = [
        ['present', 'Total Present', Number(summary.present || 0)],
        ['absent', 'Total Absent', Number(summary.absent || 0)],
        ['late', 'Total Late', Number(summary.late || 0)],
        ['excused', 'Total Excused', Number(summary.excused || 0)]
    ];

    const statusRows = rows.map(([key, label, value]) => {
        const status = statusDefinitions[key];
        return `
            <div class="sa-summary-row">
                <i class="bi ${status.icon} sa-summary-icon sa-status-${status.tone}"></i>
                <span>${label}</span>
                <span class="sa-summary-value sa-status-${status.tone}">${value}</span>
            </div>
        `;
    }).join('');

    return `${statusRows}
        <div class="sa-summary-row">
            <i class="bi bi-bar-chart-fill sa-summary-icon text-primary"></i>
            <span>Attendance Rate</span>
            <span class="sa-summary-value bg-primary-subtle text-primary-emphasis">${Number(summary.attendance_rate || 0).toFixed(1)}%</span>
        </div>`;
}

function renderRecentAttendance(records, programName) {
    if (!Array.isArray(records) || records.length === 0) {
        return '<div class="sa-muted small py-3">No attendance has been recorded yet.</div>';
    }

    return records.map(record => {
        const status = getStatusDefinition(record.status);
        return `
            <button type="button" class="sa-recent-item" data-recent-date="${escapeAttribute(record.attendance_date)}">
                <span>
                    <span class="sa-recent-date d-block">${escapeHtml(formatRecentDate(record.attendance_date))}</span>
                    <span class="sa-recent-program d-block">${escapeHtml(programName || 'Class')}</span>
                </span>
                <span class="sa-recent-status sa-status-${status.tone}">
                    <i class="bi ${status.icon}"></i> ${escapeHtml(status.label)}
                </span>
            </button>
        `;
    }).join('');
}

function renderSchedulePills(schedules) {
    if (!Array.isArray(schedules) || schedules.length === 0) {
        return '<span class="sa-muted small">No class schedule assigned</span>';
    }

    return schedules.map(schedule => `
        <span class="sa-schedule-pill">${escapeHtml(schedule.day || 'Day')} - ${escapeHtml(formatTimeRange(schedule.start_time, schedule.end_time))}</span>
    `).join('');
}

function handleRootClick(event) {
    const navigationButton = event.target.closest('[data-month-nav]');
    if (navigationButton && !navigationButton.disabled) {
        const direction = navigationButton.dataset.monthNav;
        if (direction === 'today') {
            const today = new Date();
            attendanceState.currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            attendanceState.selectedDate = '';
            loadDashboard();
        } else {
            const offset = direction === 'prev' ? -1 : 1;
            attendanceState.currentMonth = new Date(
                attendanceState.currentMonth.getFullYear(),
                attendanceState.currentMonth.getMonth() + offset,
                1
            );
            loadDashboard({ preserveSelection: true });
        }
        return;
    }

    const dateButton = event.target.closest('[data-attendance-date]');
    if (dateButton && !dateButton.disabled) {
        attendanceState.selectedDate = dateButton.dataset.attendanceDate;
        renderDashboard();
        return;
    }

    const recentButton = event.target.closest('[data-recent-date]');
    if (recentButton) {
        const dateKey = recentButton.dataset.recentDate;
        const date = parseDateKey(dateKey);
        if (!date) return;

        attendanceState.selectedDate = dateKey;
        attendanceState.currentMonth = new Date(date.getFullYear(), date.getMonth(), 1);
        loadDashboard({ preserveSelection: true });
        return;
    }

    if (event.target.closest('[data-view-attendance-details]')) {
        showAttendanceDetails();
    }
}

function showAttendanceDetails() {
    if (!attendanceState.selectedDate || !attendanceState.dashboard) return;

    const modalElement = document.getElementById('studentAttendanceDetailsModal');
    const modalBody = document.getElementById('studentAttendanceDetailsBody');
    if (!modalElement || !modalBody) return;

    const enrollment = attendanceState.dashboard.enrollment || {};
    const record = attendanceState.dashboard.attendance_by_date?.[attendanceState.selectedDate] || null;
    const status = getStatusDefinition(record?.status || 'unrecorded');
    const schedules = getSchedulesForDate(attendanceState.selectedDate);

    modalBody.innerHTML = `
        <div class="sa-status-badge sa-status-${status.tone}">
            <i class="bi ${status.icon}"></i> ${escapeHtml(status.label)}
        </div>
        <div class="sa-details-grid">
            <div class="sa-muted">Date</div>
            <div class="fw-semibold">${escapeHtml(formatLongDate(attendanceState.selectedDate))}</div>
            <div class="sa-muted">Student</div>
            <div>${escapeHtml(enrollment.student_name || 'Student')}</div>
            <div class="sa-muted">Section</div>
            <div>${escapeHtml(enrollment.section_name || 'Class')}</div>
            <div class="sa-muted">Schedule</div>
            <div>${escapeHtml(formatScheduleWindow(schedules) || 'No schedule')}</div>
            <div class="sa-muted">Recorded</div>
            <div>${record?.marked_at ? escapeHtml(formatMarkedAt(record.marked_at)) : 'Not recorded yet'}</div>
        </div>
    `;

    bootstrap.Modal.getOrCreateInstance(modalElement).show();
}

function ensureDetailsModal() {
    if (document.getElementById('studentAttendanceDetailsModal')) return;

    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="studentAttendanceDetailsModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2 class="modal-title fs-5">Attendance Details</h2>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body" id="studentAttendanceDetailsBody"></div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        </div>
    `);
}

function getSchedulesForDate(dateKey) {
    const date = parseDateKey(dateKey);
    const enrollment = attendanceState.dashboard?.enrollment;
    if (!date || !enrollment || !isDateWithinSchoolYear(dateKey)) return [];

    const weekday = fullWeekdayLabels[date.getDay()];
    return (enrollment.schedules || []).filter(schedule =>
        String(schedule.day || '').toLowerCase() === weekday.toLowerCase()
    );
}

function pickSelectedDate(preserveSelection) {
    if (preserveSelection && attendanceState.selectedDate && isDateInVisibleMonth(attendanceState.selectedDate)) {
        if (getSchedulesForDate(attendanceState.selectedDate).length > 0) {
            return attendanceState.selectedDate;
        }
    }

    const todayKey = formatDateKey(new Date());
    if (isDateInVisibleMonth(todayKey) && getSchedulesForDate(todayKey).length > 0) {
        return todayKey;
    }

    const recordedDates = Object.keys(attendanceState.dashboard?.attendance_by_date || {}).sort().reverse();
    if (recordedDates.length > 0) {
        return recordedDates[0];
    }

    const year = attendanceState.currentMonth.getFullYear();
    const month = attendanceState.currentMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day += 1) {
        const dateKey = formatDateKey(new Date(year, month, day));
        if (getSchedulesForDate(dateKey).length > 0) return dateKey;
    }

    return '';
}

function normalizeMonthToSchoolYear() {
    const enrollment = attendanceState.dashboard?.enrollment || {};
    const start = parseDateKey(enrollment.school_year_start);
    const end = parseDateKey(enrollment.school_year_end);
    let normalized = new Date(attendanceState.currentMonth);

    if (start) {
        const startMonth = new Date(start.getFullYear(), start.getMonth(), 1);
        if (normalized < startMonth) normalized = startMonth;
    }

    if (end) {
        const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
        if (normalized > endMonth) normalized = endMonth;
    }

    attendanceState.currentMonth = normalized;
    return getMonthKey(normalized);
}

function canNavigateMonth(offset) {
    const enrollment = attendanceState.dashboard?.enrollment || {};
    const target = new Date(
        attendanceState.currentMonth.getFullYear(),
        attendanceState.currentMonth.getMonth() + offset,
        1
    );
    const start = parseDateKey(enrollment.school_year_start);
    const end = parseDateKey(enrollment.school_year_end);

    if (start && target < new Date(start.getFullYear(), start.getMonth(), 1)) return false;
    if (end && target > new Date(end.getFullYear(), end.getMonth(), 1)) return false;
    return true;
}

function isDateWithinSchoolYear(dateKey) {
    const enrollment = attendanceState.dashboard?.enrollment || {};
    if (enrollment.school_year_start && dateKey < enrollment.school_year_start) return false;
    if (enrollment.school_year_end && dateKey > enrollment.school_year_end) return false;
    return true;
}

function renderSchoolYear(enrollment) {
    const label = enrollment.school_year || 'School year';
    const start = enrollment.school_year_start ? formatShortDate(enrollment.school_year_start) : '';
    const end = enrollment.school_year_end ? formatShortDate(enrollment.school_year_end) : '';
    const range = start && end ? ` &bull; ${escapeHtml(start)} - ${escapeHtml(end)}` : '';
    return `${escapeHtml(label)}${range}`;
}

function getStatusDefinition(status) {
    const key = String(status || '').toLowerCase();
    return statusDefinitions[key] || {
        label: key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Unrecorded',
        icon: 'bi-info-circle',
        tone: 'unrecorded'
    };
}

function formatScheduleWindow(schedules) {
    if (!Array.isArray(schedules) || schedules.length === 0) return '';
    return schedules.map(schedule => formatTimeRange(schedule.start_time, schedule.end_time)).join(', ');
}

function formatTimeRange(startTime, endTime) {
    return `${formatTime(startTime)} - ${formatTime(endTime)}`;
}

function formatTime(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
    if (!match) return value || 'Time not set';
    const hour = Number(match[1]);
    const minute = match[2];
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minute} ${suffix}`;
}

function formatLongDate(dateKey) {
    const date = parseDateKey(dateKey);
    return date ? date.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    }) : dateKey;
}

function formatRecentDate(dateKey) {
    const date = parseDateKey(dateKey);
    return date ? date.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', weekday: 'short'
    }) : dateKey;
}

function formatShortDate(dateKey) {
    const date = parseDateKey(dateKey);
    return date ? date.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
    }) : dateKey;
}

function formatMarkedAt(value) {
    const parsed = new Date(String(value || '').replace(' ', 'T'));
    return Number.isNaN(parsed.getTime())
        ? value
        : parsed.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatMonthTitle(date) {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function getMonthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateKey(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
}

function isDateInVisibleMonth(dateKey) {
    return String(dateKey || '').slice(0, 7) === getMonthKey(attendanceState.currentMonth);
}

function isSameDate(left, right) {
    return left.getFullYear() === right.getFullYear()
        && left.getMonth() === right.getMonth()
        && left.getDate() === right.getDate();
}

function renderLoading() {
    return `
        <div class="sa-card sa-loading">
            <div>
                <div class="spinner-border text-danger mb-3" role="status"></div>
                <div class="sa-muted">Loading your attendance...</div>
            </div>
        </div>
    `;
}

function renderError(message) {
    const root = getRoot();
    if (!root) return;
    root.innerHTML = `
        <div class="sa-card sa-error">
            <div>
                <i class="bi bi-exclamation-circle fs-2 text-danger"></i>
                <h1 class="h5 mt-3">Unable to load attendance</h1>
                <p class="sa-muted mb-3">${escapeHtml(message)}</p>
                <a class="btn btn-outline-secondary" href="./enrollement_pre_play.html">Back to Enrollment</a>
            </div>
        </div>
    `;
}

function getRoot() {
    return document.getElementById('sectionAttendanceRoot');
}

function escapeHtml(value) {
    const element = document.createElement('div');
    element.textContent = String(value ?? '');
    return element.innerHTML;
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStudentAttendance, { once: true });
} else {
    initStudentAttendance();
}
