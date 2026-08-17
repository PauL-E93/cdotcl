const SCHEDULE_ENDPOINT = '../../api/admin/schedule.php?operation=getSchedules';
const CLASSES_ENDPOINT = '../../api/teacher/class.php?operation=getAllClasses';
const ENROLLMENT_STATS_ENDPOINT = '../../api/admin/enrollment.php?operation=getEnrollmentStats&type=tutorial';
const SCHEDULE_PAGE = '../teacher/schedule.html';

const state = {
    calendarDate: new Date(),
    classes: [],
    schedules: [],
    enrollmentStats: { total: 0, new: 0, pending: 0, incomplete: 0, cancelled: 0 },
    searchTerm: ''
};

const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

document.addEventListener('DOMContentLoaded', () => {
    if (!document.querySelector('.teacher-dashboard')) return;

    bindDashboardEvents();
    loadDashboard();
});

function bindDashboardEvents() {
    document.getElementById('teacher-calendar-prev')?.addEventListener('click', () => {
        shiftCalendarMonth(-1);
        renderCalendar();
    });

    document.getElementById('teacher-calendar-next')?.addEventListener('click', () => {
        shiftCalendarMonth(1);
        renderCalendar();
    });

    document.getElementById('teacher-dashboard-search')?.addEventListener('input', (event) => {
        state.searchTerm = event.target.value.trim().toLowerCase();
        renderTodaySchedule();
    });

    document.querySelectorAll('.teacher-stat-card[data-detail-type]').forEach((card) => {
        card.addEventListener('click', () => openDashboardDetailModal(card.dataset.detailType));
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openDashboardDetailModal(card.dataset.detailType);
            }
        });
    });
}

function shiftCalendarMonth(amount) {
    state.calendarDate.setDate(1);
    state.calendarDate.setMonth(state.calendarDate.getMonth() + amount);
}

async function loadDashboard() {
    const [scheduleResult, classesResult, enrollmentStatsResult] = await Promise.allSettled([
        fetchJson(SCHEDULE_ENDPOINT),
        fetchJson(CLASSES_ENDPOINT),
        fetchJson(ENROLLMENT_STATS_ENDPOINT)
    ]);

    if (scheduleResult.status === 'fulfilled') {
        const payload = scheduleResult.value;
        state.schedules = Array.isArray(payload.schedules)
            ? payload.schedules.map(normalizeSchedule)
            : [];
    } else {
        showDashboardError('Schedule information could not be loaded. Please refresh the page.');
    }

    if (classesResult.status === 'fulfilled') {
        state.classes = Array.isArray(classesResult.value) ? classesResult.value : [];
    } else {
        showDashboardError('Class totals could not be loaded.');
    }

    if (enrollmentStatsResult.status === 'fulfilled') {
        state.enrollmentStats = enrollmentStatsResult.value?.data || state.enrollmentStats;
    } else {
        showDashboardError('Tutorial enrollment totals could not be loaded.');
    }

    renderSummary();
    renderTodaySchedule();
    renderCalendar();
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
        endTime: schedule.end_time || '',
        startTime: schedule.start_time || '',
        status: schedule.status || 'pending',
        student: schedule.student_name || 'To be assigned',
        subject: schedule.subject_name || schedule.program_name || 'Scheduled class'
    };
}

function renderSummary() {
    const todaySchedules = getTodaySchedules();
    const totalStudents = Number(state.enrollmentStats.total || 0);
    const totalClasses = state.classes.length;

    setText('today-classes-count', todaySchedules.length);
    setText('total-students-count', totalStudents);
    setText('total-classes-count', totalClasses);
}

function renderTodaySchedule() {
    const tableBody = document.getElementById('teacher-today-schedule');
    if (!tableBody) return;

    const visibleSchedules = getTodaySchedules().filter((schedule) => {
        if (!state.searchTerm) return true;

        return [schedule.subject, schedule.student, schedule.status]
            .some((value) => value.toLowerCase().includes(state.searchTerm));
    });

    if (visibleSchedules.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="4" class="teacher-table-message">
                    ${state.searchTerm ? 'No matching classes found.' : 'No classes scheduled for today.'}
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = visibleSchedules.map((schedule) => `
        <tr>
            <td class="teacher-time-cell">
                <i class="bi bi-clock"></i>${escapeHtml(formatTime(schedule.startTime))} - ${escapeHtml(formatTime(schedule.endTime))}
            </td>
            <td>${escapeHtml(schedule.subject)}</td>
            <td>${escapeHtml(schedule.student)}</td>
            <td><span class="teacher-schedule-status">${escapeHtml(schedule.status)}</span></td>
        </tr>
    `).join('');
}

function renderCalendar() {
    const title = document.getElementById('teacher-calendar-title');
    const grid = document.getElementById('teacher-calendar-grid');
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
            'teacher-calendar-day',
            isMuted ? 'is-muted' : '',
            dateKey === today ? 'is-today' : '',
            hasSchedule ? 'has-schedule' : ''
        ].filter(Boolean).join(' ');
        dayButton.textContent = String(date.getDate());
        dayButton.setAttribute('aria-label', `${dateKey}${hasSchedule ? ', scheduled class' : ''}`);
        dayButton.addEventListener('click', () => {
            window.location.href = SCHEDULE_PAGE;
        });

        grid.appendChild(dayButton);
    }
}

function getTodaySchedules() {
    const today = toDateKey(new Date());
    return state.schedules.filter((schedule) => schedule.date === today);
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

function openDashboardDetailModal(detailType) {
    const modalElement = document.getElementById('teacher-detail-modal');
    const modalTitle = document.getElementById('teacher-detail-modal-label');
    const modalBody = document.getElementById('teacher-detail-modal-body');

    if (!modalElement || !modalTitle || !modalBody) return;

    let title = 'Dashboard Details';
    let content = '<p class="text-muted">No details available.</p>';

    if (detailType === 'today-classes') {
        title = "Today's Classes";
        const schedules = getTodaySchedules();
        content = buildTeacherModalTable(
            ['Time', 'Subject', 'Student', 'Status'],
            schedules,
            (schedule) => [
                `${escapeHtml(formatTime(schedule.startTime))} - ${escapeHtml(formatTime(schedule.endTime))}`,
                escapeHtml(schedule.subject),
                escapeHtml(schedule.student),
                `<span class="teacher-schedule-status">${escapeHtml(schedule.status)}</span>`
            ],
            'No classes are scheduled for today.'
        );
    }

    if (detailType === 'students') {
        title = 'Tutorial Student Overview';
        const totalStudents = Number(state.enrollmentStats.total || 0);
        const studentRows = state.schedules
            .filter((schedule) => schedule.student && schedule.student !== 'To be assigned')
            .map((schedule) => ({
                id: schedule.studentId || schedule.student_id || schedule.enrollment_details_id || '-',
                studentName: schedule.student || schedule.student_name || 'Unknown student',
                date: schedule.date || '-',
                status: schedule.status || 'pending'
            }));

        const summary = `
            <div class="teacher-modal-summary">
                <div><strong>Total students:</strong> ${escapeHtml(totalStudents)}</div>
                <div><strong>New this month:</strong> ${escapeHtml(state.enrollmentStats.new || 0)}</div>
                <div><strong>Pending:</strong> ${escapeHtml(state.enrollmentStats.pending || 0)}</div>
                <div><strong>Incomplete:</strong> ${escapeHtml(state.enrollmentStats.incomplete || 0)}</div>
            </div>
        `;

        content = `${summary}${buildTeacherModalTable(
            ['ID', 'Student name', 'Date', 'Status'],
            studentRows,
            (student) => [
                escapeHtml(student.id),
                escapeHtml(student.studentName),
                escapeHtml(student.date),
                `<span class="teacher-schedule-status">${escapeHtml(student.status)}</span>`
            ],
            'No enrolled students were found.'
        )}`;
    }

    if (detailType === 'classes-handled') {
        title = 'Classes Handled';
        content = buildTeacherModalTable(
            ['Class', 'Branch', 'Status', 'Sections', 'Students'],
            state.classes,
            (item) => [
                escapeHtml(item.program_name || 'Unnamed class'),
                escapeHtml(item.branch_name || '-'),
                escapeHtml(item.status || '-'),
                escapeHtml(item.section_count || 0),
                escapeHtml(item.student_count || 0)
            ],
            'No assigned classes were found.'
        );
    }

    modalTitle.textContent = title;
    modalBody.innerHTML = content;

    const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
    modal.show();
}

function buildTeacherModalTable(headers, rows, mapRow, emptyText) {
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeRows.length) {
        return `<div class="teacher-modal-empty">${escapeHtml(emptyText)}</div>`;
    }

    return `
        <div class="teacher-modal-table-wrap">
            <table class="teacher-modal-table">
                <thead>
                    <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
                </thead>
                <tbody>
                    ${safeRows.map((row) => `<tr>${mapRow(row).map((cell) => `<td>${modalCell(cell)}</td>`).join('')}</tr>`).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function modalCell(value) {
    const text = String(value ?? '');
    if (text.startsWith('<span class="teacher-schedule-status')) return text;
    return escapeHtml(text);
}

function showDashboardError(message) {
    const errorElement = document.getElementById('teacher-dashboard-error');
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
