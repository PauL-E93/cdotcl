const SCHEDULE_ENDPOINT = '../../api/student/schedule.php?operation=getSchedules';
const ENROLLMENT_STATS_ENDPOINT = '../../api/student/enrollment.php?operation=getEnrollmentStats';
const ENROLLMENTS_ENDPOINT = '../../api/student/enrollment.php?operation=getEnrollments&limit=100';
const SCHEDULE_PAGE = 'schedule.html';

const state = {
    calendarDate: new Date(),
    enrollments: [],
    enrollmentStats: {},
    schedules: [],
    searchTerm: ''
};

const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

document.addEventListener('DOMContentLoaded', () => {
    if (!document.querySelector('.student-dashboard')) return;

    bindDashboardEvents();
    loadDashboard();
});

function bindDashboardEvents() {
    document.getElementById('student-calendar-prev')?.addEventListener('click', () => {
        shiftCalendarMonth(-1);
        renderCalendar();
    });

    document.getElementById('student-calendar-next')?.addEventListener('click', () => {
        shiftCalendarMonth(1);
        renderCalendar();
    });

    document.getElementById('student-dashboard-search')?.addEventListener('input', (event) => {
        state.searchTerm = event.target.value.trim().toLowerCase();
        renderTodaySchedule();
    });

    setupDashboardModals();
}

function shiftCalendarMonth(amount) {
    state.calendarDate.setDate(1);
    state.calendarDate.setMonth(state.calendarDate.getMonth() + amount);
}

async function loadDashboard() {
    const [scheduleResult, statsResult, enrollmentsResult] = await Promise.allSettled([
        fetchJson(SCHEDULE_ENDPOINT),
        fetchJson(ENROLLMENT_STATS_ENDPOINT),
        fetchJson(ENROLLMENTS_ENDPOINT)
    ]);

    if (scheduleResult.status === 'fulfilled') {
        const payload = scheduleResult.value;
        state.schedules = Array.isArray(payload.schedules)
            ? payload.schedules.map(normalizeSchedule)
            : [];
    } else {
        showDashboardError('Schedule information could not be loaded. Please refresh the page.');
    }

    if (statsResult.status === 'fulfilled') {
        state.enrollmentStats = statsResult.value.data || {};
    } else {
        showDashboardError('Enrollment totals could not be loaded.');
    }

    if (enrollmentsResult.status === 'fulfilled') {
        state.enrollments = Array.isArray(enrollmentsResult.value.data) ? enrollmentsResult.value.data : [];
    } else {
        showDashboardError('Enrollment list could not be loaded.');
    }

    renderSummary();
    renderTodaySchedule();
    renderCalendar();
    configureDashboardTriggers();
}

async function fetchJson(url) {
    const response = await fetch(url, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
    }

    const payload = await response.json();
    if (payload?.status === 'error') {
        throw new Error(payload.message || 'Request failed');
    }

    return payload;
}

function normalizeSchedule(schedule) {
    return {
        date: schedule.date || '',
        endTime: schedule.endTime || schedule.end_time || '',
        program: schedule.program || schedule.program_name || '',
        startTime: schedule.time || schedule.start_time || '',
        status: schedule.status || 'pending',
        subject: schedule.subject || schedule.program || 'Scheduled class',
        teacher: schedule.teacher || 'To be assigned'
    };
}

function renderSummary() {
    const today = toDateKey(new Date());
    const todaySchedules = state.schedules.filter((schedule) => schedule.date === today);
    const upcomingSchedules = state.schedules.filter((schedule) => {
        return schedule.date > today && schedule.status !== 'cancelled';
    });
    const completedSchedules = state.schedules.filter((schedule) => {
        return ['done', 'completed'].includes(schedule.status);
    });

    setText('student-today-classes-count', todaySchedules.length);
    setText('student-total-enrollments-count', state.enrollmentStats.total || 0);
    setText('student-upcoming-classes-count', upcomingSchedules.length);
    setText('student-completed-sessions-count', completedSchedules.length);
}

function renderTodaySchedule() {
    const tableBody = document.getElementById('student-today-schedule');
    if (!tableBody) return;

    const today = toDateKey(new Date());
    const visibleSchedules = state.schedules
        .filter((schedule) => schedule.date === today)
        .filter((schedule) => {
            if (!state.searchTerm) return true;

            return [schedule.subject, schedule.teacher, schedule.status]
                .some((value) => value.toLowerCase().includes(state.searchTerm));
        });

    if (visibleSchedules.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="4" class="student-table-message">
                    ${state.searchTerm ? 'No matching classes found.' : 'No classes scheduled for today.'}
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = visibleSchedules.map((schedule) => `
        <tr>
            <td class="student-time-cell">
                <i class="bi bi-clock"></i>${escapeHtml(formatTime(schedule.startTime))} - ${escapeHtml(formatTime(schedule.endTime))}
            </td>
            <td>${escapeHtml(schedule.subject)}</td>
            <td>${escapeHtml(schedule.teacher)}</td>
            <td><span class="student-schedule-status">${escapeHtml(schedule.status)}</span></td>
        </tr>
    `).join('');
}

function renderCalendar() {
    const title = document.getElementById('student-calendar-title');
    const grid = document.getElementById('student-calendar-grid');
    if (!title || !grid) return;

    const year = state.calendarDate.getFullYear();
    const month = state.calendarDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const calendarStart = new Date(year, month, 1 - firstDay.getDay());
    const today = toDateKey(new Date());
    const scheduledDates = new Set(state.schedules.map((schedule) => schedule.date));

    title.textContent = `${monthNames[month]} ${year}`;
    grid.innerHTML = '';

    for (let offset = 0; offset < 42; offset++) {
        const date = new Date(calendarStart);
        date.setDate(calendarStart.getDate() + offset);

        const dateKey = toDateKey(date);
        const dayButton = document.createElement('button');
        const hasSchedule = scheduledDates.has(dateKey);
        const isMuted = date.getMonth() !== month;

        dayButton.type = 'button';
        dayButton.className = [
            'student-calendar-day',
            isMuted ? 'is-muted' : '',
            dateKey === today ? 'is-today' : '',
            hasSchedule ? 'has-schedule' : ''
        ].filter(Boolean).join(' ');
        dayButton.textContent = String(date.getDate());
        dayButton.setAttribute('aria-label', `${dateKey}${hasSchedule ? ', scheduled class' : ''}`);
        dayButton.addEventListener('click', () => {
            openDashboardModal('calendar-date', dateKey);
        });

        grid.appendChild(dayButton);
    }
}

function setupDashboardModals() {
    const dashboard = document.querySelector('.student-dashboard');
    if (!dashboard) return;

    dashboard.addEventListener('click', event => {
        if (event.target.closest('a,button,input,select')) return;
        const trigger = event.target.closest('[data-dashboard-modal]');
        if (!trigger || !dashboard.contains(trigger)) return;
        openDashboardModal(trigger.dataset.dashboardModal);
    });

    dashboard.addEventListener('keydown', event => {
        if (!['Enter', ' '].includes(event.key)) return;
        const trigger = event.target.closest('[data-dashboard-modal]');
        if (!trigger || !dashboard.contains(trigger)) return;
        event.preventDefault();
        openDashboardModal(trigger.dataset.dashboardModal);
    });
}

function configureDashboardTriggers() {
    document.querySelectorAll('.student-dashboard [data-dashboard-modal]').forEach(trigger => {
        trigger.setAttribute('role', 'button');
        if (!trigger.hasAttribute('tabindex')) trigger.setAttribute('tabindex', '0');
    });
}

function openDashboardModal(key, date = null) {
    const modal = getDashboardModal();
    const content = getDashboardModalContent(key, date);
    modal.querySelector('.modal-title').innerHTML = content.title;
    modal.querySelector('.modal-body').innerHTML = content.body;

    const link = modal.querySelector('.student-modal-link');
    if (content.href) {
        link.href = content.href;
        link.textContent = content.linkText || 'Open page';
        link.classList.remove('d-none');
    } else {
        link.classList.add('d-none');
    }

    bootstrap.Modal.getOrCreateInstance(modal).show();
}

function getDashboardModal() {
    let modal = document.getElementById('studentDashboardModal');
    if (modal) return modal;

    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="studentDashboardModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Dashboard Details</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body"></div>
                    <div class="modal-footer">
                        <a class="btn btn-theme student-modal-link d-none" href="#">Open page</a>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        </div>
    `);
    return document.getElementById('studentDashboardModal');
}

function getDashboardModalContent(key, date = null) {
    const today = toDateKey(new Date());
    const upcoming = state.schedules.filter(schedule => schedule.date > today && schedule.status !== 'cancelled');
    const completed = state.schedules.filter(schedule => ['done', 'completed'].includes(schedule.status));
    const modalMap = {
        'today-classes': () => ({
            title: '<i class="bi bi-calendar3 me-2"></i>Today\'s Classes',
            href: SCHEDULE_PAGE,
            linkText: 'View full schedule',
            body: scheduleTable(state.schedules.filter(schedule => schedule.date === today), 'No classes scheduled for today.')
        }),
        'total-enrollments': () => ({
            title: '<i class="bi bi-journal-check me-2"></i>Total Enrollments',
            href: 'enrollement.html',
            linkText: 'Open enrollments',
            body: table(['Program', 'Subject', 'Teacher', 'Date', 'Status'], state.enrollments, row => [row.program_name, row.subject_name || 'No subject', row.teacher_name || 'To be assigned', row.enrollment_date, statusPill(row.status)], 'No enrollments are available.')
        }),
        'upcoming-classes': () => ({
            title: '<i class="bi bi-calendar2-week me-2"></i>Upcoming Classes',
            href: SCHEDULE_PAGE,
            linkText: 'View full schedule',
            body: scheduleTable(upcoming, 'No upcoming classes are scheduled.')
        }),
        'completed-sessions': () => ({
            title: '<i class="bi bi-check2-circle me-2"></i>Completed Sessions',
            href: SCHEDULE_PAGE,
            linkText: 'View full schedule',
            body: scheduleTable(completed, 'No completed sessions are available.')
        }),
        'calendar': () => ({
            title: '<i class="bi bi-calendar-month me-2"></i>Schedule Calendar',
            href: SCHEDULE_PAGE,
            linkText: 'Open schedule',
            body: scheduleTable(upcoming, 'No upcoming calendar entries are scheduled.')
        }),
        'calendar-date': () => ({
            title: `<i class="bi bi-calendar-event me-2"></i>${escapeHtml(date || 'Schedule Date')}`,
            href: SCHEDULE_PAGE,
            linkText: 'Open schedule',
            body: scheduleTable(state.schedules.filter(schedule => schedule.date === date), 'No classes are scheduled on this date.')
        }),
        'announcements': () => ({
            title: '<i class="bi bi-megaphone me-2"></i>Recent Announcements',
            body: emptyState('No announcements available yet.')
        }),
        'tasks': () => ({
            title: '<i class="bi bi-clipboard2 me-2"></i>Upcoming Tasks',
            body: emptyState('No tasks available yet.')
        }),
        'attendance': () => ({
            title: '<i class="bi bi-people me-2"></i>Attendance Overview',
            body: table(['Metric', 'Total'], [
                { label: 'Completed Sessions', total: completed.length },
                { label: 'Upcoming Classes', total: upcoming.length },
                { label: 'Today\'s Classes', total: state.schedules.filter(schedule => schedule.date === today).length }
            ], row => [row.label, row.total], 'Attendance data is not available yet.')
        })
    };
    return (modalMap[key] || modalMap['today-classes'])();
}

function scheduleTable(rows, emptyText) {
    return table(['Date', 'Time', 'Subject', 'Teacher', 'Status'], rows, row => [
        row.date,
        `${formatTime(row.startTime)} - ${formatTime(row.endTime)}`,
        row.subject,
        row.teacher,
        statusPill(row.status)
    ], emptyText);
}

function table(headers, rows, mapRow, emptyText) {
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeRows.length) return emptyState(emptyText);
    return `<div class="student-table-wrapper"><table class="student-schedule-table"><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${safeRows.map(row => `<tr>${mapRow(row).map(cell => `<td>${modalCell(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function emptyState(text) {
    return `<div class="student-empty-state"><i class="bi bi-inbox"></i><p>${escapeHtml(text)}</p></div>`;
}

function statusPill(value) {
    return `<span class="student-schedule-status">${escapeHtml(value || 'pending')}</span>`;
}

function modalCell(value) {
    const text = String(value ?? '');
    if (text.startsWith('<span class="student-schedule-status')) return text;
    return escapeHtml(text);
}

function toDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatTime(time) {
    if (!time) return 'TBA';

    const [hourValue, minute = '00'] = time.split(':');
    const hour = Number.parseInt(hourValue, 10);
    if (Number.isNaN(hour)) return time;

    const suffix = hour >= 12 ? 'PM' : 'AM';
    const normalizedHour = hour % 12 || 12;
    return `${normalizedHour}:${minute} ${suffix}`;
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
}

function showDashboardError(message) {
    const errorElement = document.getElementById('student-dashboard-error');
    if (!errorElement) return;

    errorElement.textContent = errorElement.textContent
        ? `${errorElement.textContent} ${message}`
        : message;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}
