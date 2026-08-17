const ATTENDANCE_API_URL = window.location.pathname.includes('/teacher/')
    ? '../../api/teacher/attendance.php'
    : '../../api/admin/attendance.php';

const attendanceState = {
    sectionId: null,
    currentMonthDate: new Date(),
    dashboard: null,
    selectedDate: '',
    roster: null,
    rootSelector: '#sectionAttendanceRoot'
};

const weekdayLabels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayShortLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function navigateToSectionAttendancePage(sectionId, classId = '') {
    if (!sectionId) return;
    const targetUrl = new URL('attendance.html', window.location.href);
    targetUrl.searchParams.set('section_id', String(sectionId));
    if (classId) targetUrl.searchParams.set('class_id', String(classId));
    window.location.href = targetUrl.toString();
}

function getClassReturnUrl() {
    const currentUrl = new URL(window.location.href);
    const targetUrl = new URL('class.html', currentUrl);
    const classId = currentUrl.searchParams.get('class_id');
    const sectionId = currentUrl.searchParams.get('section_id');
    if (classId) targetUrl.searchParams.set('class_id', classId);
    if (sectionId) targetUrl.searchParams.set('section_id', sectionId);
    return targetUrl.toString();
}

export async function initSectionAttendancePage() {
    ensureAttendanceStyles();
    ensureRosterModalShell();

    const params = new URLSearchParams(window.location.search);
    const sectionId = Number(params.get('section_id') || 0);
    attendanceState.sectionId = sectionId;

    const root = getAttendanceRoot();
    if (!root) return;

    if (!sectionId) {
        root.innerHTML = renderAttendanceErrorState('No section was selected for attendance.');
        return;
    }

    const today = new Date();
    attendanceState.currentMonthDate = new Date(today.getFullYear(), today.getMonth(), 1);
    attendanceState.dashboard = null;
    attendanceState.roster = null;
    attendanceState.selectedDate = '';

    root.addEventListener('click', handleAttendanceRootClick);
    document.getElementById('attendanceRosterModalBody')?.addEventListener('change', handleRosterInputChange);
    document.getElementById('saveAttendanceRosterBtn')?.addEventListener('click', saveAttendanceRoster);

    await loadAttendanceDashboard();
}

function getAttendanceRoot() {
    return document.querySelector(attendanceState.rootSelector);
}

function ensureAttendanceStyles() {
    if (document.getElementById('sectionAttendanceStyles')) return;

    const style = document.createElement('style');
    style.id = 'sectionAttendanceStyles';
    style.textContent = `
        .tc-attendance-shell { background: linear-gradient(180deg, #fff 0%, #fffafc 100%); }
        .tc-attendance-page-card { border: 1px solid rgba(226, 232, 240, 0.9); border-radius: 16px; background: #fff; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.045); padding: 0.5rem; }
        .tc-attendance-page-grid { display: grid; grid-template-columns: minmax(0, 1.95fr) minmax(220px, 0.68fr); gap: 0.5rem; align-items: stretch; }
        .tc-attendance-page-grid > * { min-height: 0; }
        .tc-attendance-main-column { display: grid; gap: 0.5rem; min-height: 0; height: 100%; }
        .tc-attendance-hero,
        .tc-attendance-card { border: 1px solid rgba(226, 232, 240, 0.9); border-radius: 16px; background: #fff; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.045); }
        .tc-attendance-hero { padding: 0.55rem; }
        .tc-attendance-calendar-card { padding: 0.6rem; display: flex; flex-direction: column; min-height: 0; height: 100%; }
        .tc-attendance-sidebar { display: grid; gap: 0.5rem; min-height: 0; height: 100%; grid-template-rows: repeat(2, minmax(0, 1fr)); }
        .tc-attendance-stat { padding: 0.6rem 0.7rem; display: flex; flex-direction: column; min-height: 0; }
        .tc-attendance-stat-value { font-size: 1.32rem; font-weight: 700; line-height: 1; }
        .tc-attendance-stat-soft { font-size: 0.72rem; color: #64748b; }
        .tc-attendance-calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 0.28rem; }
        .tc-attendance-weekday { text-align: center; font-size: 0.62rem; font-weight: 700; color: #334155; padding-bottom: 0.02rem; display: flex; align-items: center; justify-content: center; }
        .tc-attendance-day {
            min-height: 58px;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 0.28rem;
            background: #fff;
            display: flex;
            flex-direction: column;
            gap: 0.08rem;
            transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
        }
        .tc-attendance-day.is-empty { background: #f8fafc; color: #cbd5e1; min-height: 44px; }
        .tc-attendance-day.is-scheduled { border-color: rgba(34, 197, 94, 0.35); background: linear-gradient(180deg, #ffffff 0%, #f0fdf4 100%); cursor: pointer; }
        .tc-attendance-day.is-scheduled:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(34, 197, 94, 0.12); }
        .tc-attendance-day.is-selected { border-color: #fb7185; box-shadow: 0 0 0 2px rgba(251, 113, 133, 0.15); }
        .tc-attendance-day.is-today .tc-attendance-date-number { background: #0f172a; color: #fff; }
        .tc-attendance-day.is-outside-year { opacity: 0.55; }
        .tc-attendance-date-row { display: flex; align-items: center; justify-content: space-between; gap: 0.2rem; }
        .tc-attendance-date-number {
            width: 20px;
            height: 20px;
            border-radius: 999px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            color: #1e293b;
            background: #f8fafc;
            font-size: 0.68rem;
        }
        .tc-attendance-chip {
            display: inline-flex;
            align-items: center;
            gap: 0.2rem;
            font-size: 0.48rem;
            font-weight: 600;
            border-radius: 999px;
            padding: 0.12rem 0.3rem;
            background: #dcfce7;
            color: #15803d;
            width: fit-content;
        }
        .tc-attendance-summary-mini { font-size: 0.54rem; color: #475569; font-weight: 600; line-height: 1.05; }
        .tc-attendance-summary-dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; }
        .tc-attendance-list { display: grid; gap: 0.35rem; }
        .tc-attendance-list-item { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; min-height: 2.85rem; padding: 0.12rem 0; }
        .tc-attendance-list-name { font-weight: 600; color: #0f172a; font-size: 0.74rem; line-height: 1.05; }
        .tc-attendance-list-meta { font-size: 0.64rem; color: #64748b; }
        .tc-attendance-legend { display: flex; flex-wrap: wrap; gap: 0.45rem; font-size: 0.66rem; color: #475569; margin-top: 0.35rem; }
        .tc-attendance-legend span { display: inline-flex; align-items: center; gap: 0.4rem; }
        .tc-attendance-legend-dot { width: 10px; height: 10px; border-radius: 999px; display: inline-block; }
        .tc-attendance-schedule-list { display: flex; flex-wrap: wrap; gap: 0.28rem; }
        .tc-attendance-schedule-pill { border-radius: 999px; padding: 0.2rem 0.42rem; background: #f8fafc; color: #334155; font-size: 0.6rem; font-weight: 600; border: 1px solid #e2e8f0; }
        .tc-attendance-inline-stat { border-left: 1px solid #e2e8f0; padding-left: 1rem; }
        .tc-attendance-selected-date { font-size: 0.84rem; font-weight: 700; color: #0f172a; }
        .tc-attendance-action-btn { border-radius: 999px; }
        .tc-attendance-roster-summary { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1rem; }
        .tc-attendance-roster-pill { border-radius: 999px; padding: 0.4rem 0.85rem; font-size: 0.82rem; font-weight: 700; }
        .tc-attendance-info-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(200px, 0.95fr); gap: 0.5rem; }
        .tc-attendance-info-card { border: 1px solid #e2e8f0; border-radius: 14px; padding: 0.5rem; height: 100%; }
        .tc-attendance-title-row { display: flex; align-items: start; justify-content: space-between; gap: 0.45rem; margin-bottom: 0.15rem; }
        .tc-attendance-page-heading { font-size: 1.12rem; font-weight: 800; color: #0f172a; line-height: 1; }
        .tc-attendance-page-subtitle { color: #64748b; font-size: 0.68rem; margin-top: 0.1rem; }
        .tc-attendance-info-card .fs-4 { font-size: 0.82rem !important; }
        .tc-attendance-info-card .small { font-size: 0.58rem !important; }
        .tc-attendance-info-card .text-muted { line-height: 1.25; }
        .tc-attendance-day .small { font-size: 0.54rem !important; line-height: 1.05; }
        .tc-attendance-card .badge { font-size: 0.6rem; }
        .tc-attendance-card .btn,
        .tc-attendance-hero .btn { font-size: 0.62rem; padding: 0.28rem 0.55rem; }
        .tc-attendance-calendar-card .fs-4.fw-bold { font-size: 0.82rem !important; }
        .tc-attendance-stat-list { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding-right: 0.2rem; }
        .tc-attendance-stat-list--limit { max-height: calc((2.85rem * 5) + (0.35rem * 4) + 0.24rem); scrollbar-gutter: stable; }
        .tc-attendance-stat-list::-webkit-scrollbar { width: 6px; }
        .tc-attendance-stat-list::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.75); border-radius: 999px; }
        .attendance-main-content #sectionAttendanceRoot { min-height: 100%; }
        .attendance-main-content #sectionAttendanceRoot > .tc-attendance-page-card { min-height: 100%; }
        .attendance-main-content #sectionAttendanceRoot > .tc-attendance-page-card > .tc-attendance-shell { width: 100%; display: grid; gap: 0.6rem; min-height: 0; }
        @media (min-width: 992px) {
            .attendance-main-content { padding: 8px 10px 12px; min-height: calc(100vh - 80px); overflow-y: auto; overflow-x: hidden; }
            .tc-attendance-card,
            .tc-attendance-hero { box-shadow: 0 6px 16px rgba(15, 23, 42, 0.035); }
            .tc-attendance-calendar-grid {
                flex: 1;
                min-height: 0;
                align-content: stretch;
                grid-template-rows: auto repeat(6, minmax(0, 1fr));
            }
            .tc-attendance-day,
            .tc-attendance-day.is-empty {
                height: 100%;
                min-height: 0;
            }
        }
        @media (min-width: 992px) and (max-height: 860px) {
            .tc-attendance-page-card { padding: 0.42rem; }
            .tc-attendance-hero { padding: 0.45rem; }
            .tc-attendance-calendar-card,
            .tc-attendance-stat { padding: 0.5rem 0.58rem; }
            .tc-attendance-day { min-height: 52px; padding: 0.24rem; }
            .tc-attendance-day.is-empty { min-height: 40px; }
            .tc-attendance-page-heading { font-size: 1rem; }
            .tc-attendance-selected-date { font-size: 0.76rem; }
            .tc-attendance-stat-value { font-size: 1.15rem; }
        }
        @media (max-width: 991px) {
            .tc-attendance-page-grid { grid-template-columns: 1fr; }
            .tc-attendance-info-grid { grid-template-columns: 1fr; }
            .tc-attendance-inline-stat { border-left: 0; padding-left: 0; }
            .tc-attendance-main-column,
            .tc-attendance-sidebar,
            .tc-attendance-calendar-card { height: auto; }
            .tc-attendance-day { min-height: 110px; }
        }
    `;
    document.head.appendChild(style);
}

function ensureRosterModalShell() {
    if (document.getElementById('attendanceRosterModal')) return;

    const html = `
        <div class="modal fade" id="attendanceRosterModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="attendanceRosterModalTitle">Attendance Roster</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body" id="attendanceRosterModalBody"></div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-success" id="saveAttendanceRosterBtn">Save Attendance</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
}

async function loadAttendanceDashboard({ preserveSelection = false } = {}) {
    const root = getAttendanceRoot();
    if (!root || !attendanceState.sectionId) return;

    root.innerHTML = renderAttendanceLoadingState('Loading attendance calendar...');

    try {
        const requestedMonthKey = getMonthKey(attendanceState.currentMonthDate);
        const res = await axios.get(ATTENDANCE_API_URL, {
            params: {
                operation: 'getSectionAttendanceDashboard',
                section_id: attendanceState.sectionId,
                month: requestedMonthKey
            }
        });

        if (res.data?.status !== 'success') {
            throw new Error(res.data?.message || 'Unable to load attendance dashboard.');
        }

        attendanceState.dashboard = res.data.data;
        normalizeVisibleMonthToSchoolYear();
        if (requestedMonthKey !== getMonthKey(attendanceState.currentMonthDate)) {
            await loadAttendanceDashboard({ preserveSelection });
            return;
        }

        attendanceState.selectedDate = pickSelectedDate(preserveSelection);

        if (attendanceState.selectedDate) {
            await loadAttendanceRosterSummary(attendanceState.selectedDate);
        } else {
            attendanceState.roster = null;
        }

        renderAttendanceDashboard();
    } catch (error) {
        console.error('Error loading attendance dashboard:', error);
        root.innerHTML = renderAttendanceErrorState(error.response?.data?.message || error.message || 'Unable to load attendance.');
    }
}

async function loadAttendanceRosterSummary(dateKey) {
    if (!dateKey || !attendanceState.sectionId) {
        attendanceState.roster = null;
        return;
    }

    try {
        const res = await axios.get(ATTENDANCE_API_URL, {
            params: {
                operation: 'getAttendanceRoster',
                section_id: attendanceState.sectionId,
                attendance_date: dateKey
            }
        });

        if (res.data?.status !== 'success') {
            throw new Error(res.data?.message || 'Unable to load attendance roster.');
        }

        const roster = res.data.data;
        roster.students = (roster.students || []).map(student => ({
            ...student,
            is_present: student.attendance_status === 'present'
        }));
        attendanceState.roster = roster;
    } catch (error) {
        console.error('Error loading attendance roster:', error);
        attendanceState.roster = null;
        Swal.fire('Error', error.response?.data?.message || error.message || 'Unable to load attendance roster.', 'error');
    }
}

function renderAttendanceDashboard() {
    const root = getAttendanceRoot();
    if (!root || !attendanceState.dashboard) return;

    const section = attendanceState.dashboard.section || {};
    const roster = attendanceState.roster;
    const totalStudents = Number(section.total_students || roster?.students?.length || 0);
    const presentCount = Number(roster?.present_count || 0);
    const absentCount = Number(roster?.absent_count || Math.max(totalStudents - presentCount, 0));
    const attendanceRate = totalStudents > 0 ? ((presentCount / totalStudents) * 100).toFixed(1) : '0.0';
    const absenceRate = totalStudents > 0 ? ((absentCount / totalStudents) * 100).toFixed(1) : '0.0';
    const selectedDateLabel = attendanceState.selectedDate ? formatLongDate(attendanceState.selectedDate) : 'Select a scheduled date';

    root.innerHTML = `
        <div class="tc-attendance-page-card">
            <div class="tc-attendance-shell">
                <div class="tc-attendance-hero mb-3">
                    <div class="tc-attendance-info-grid">
                        <div class="tc-attendance-info-card">
                            <div class="tc-attendance-title-row">
                                <div>
                                    <div class="tc-attendance-page-heading">${escapeHtml(section.section_name || 'Section Attendance')}</div>
                                    <div class="tc-attendance-page-subtitle">Manage attendance for ${escapeHtml(section.program_name || 'the selected class')} at ${escapeHtml(section.branch_name || 'the assigned branch')}.</div>
                                </div>
                            </div>
                            <div class="small text-uppercase text-muted fw-semibold mb-1">Selected Section</div>
                            <div class="fs-4 fw-bold mb-1">${escapeHtml(section.program_name || 'Program')}</div>
                            <div class="text-muted mb-3">${escapeHtml(section.section_name || 'Section')} - ${escapeHtml(section.teacher_name || 'Instructor')}</div>
                            <div class="small text-uppercase text-muted fw-semibold mb-2">Schedules</div>
                            <div class="tc-attendance-schedule-list">
                                ${renderSchedulePills(section.schedules || [])}
                            </div>
                        </div>
                        <div class="tc-attendance-info-card">
                            <div class="d-flex justify-content-between align-items-start gap-2 mb-3">
                                <div class="small text-uppercase text-muted fw-semibold">Selected Date</div>
                                <a class="btn btn-outline-secondary btn-sm tc-attendance-action-btn" href="${escapeHtml(getClassReturnUrl())}">
                                    <i class="bi bi-arrow-left me-1"></i> Back to Class
                                </a>
                            </div>
                            <div class="tc-attendance-selected-date mb-2">${escapeHtml(selectedDateLabel)}</div>
                            <div class="text-muted small mb-3">${renderSchoolYearLabel(section.school_year)}</div>
                            <button type="button" class="btn btn-outline-danger tc-attendance-action-btn" data-open-roster ${attendanceState.selectedDate ? '' : 'disabled'}>
                                <i class="bi bi-check2-square me-1"></i> Mark Attendance
                            </button>
                        </div>
                    </div>
                </div>
                <div class="tc-attendance-page-grid">
                    <div class="tc-attendance-main-column">
                        <div class="tc-attendance-card tc-attendance-calendar-card">
                            <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                                <div class="d-flex align-items-center gap-2">
                                    <button type="button" class="btn btn-outline-secondary btn-sm rounded-circle" data-attendance-nav="prev" aria-label="Previous month">
                                        <i class="bi bi-chevron-left"></i>
                                    </button>
                                    <div class="fs-4 fw-bold">${escapeHtml(formatMonthTitle(attendanceState.currentMonthDate))}</div>
                                    <button type="button" class="btn btn-outline-secondary btn-sm rounded-circle" data-attendance-nav="next" aria-label="Next month">
                                        <i class="bi bi-chevron-right"></i>
                                    </button>
                                </div>
                                <button type="button" class="btn btn-outline-danger tc-attendance-action-btn" data-attendance-nav="today">Today</button>
                            </div>
                            <div class="tc-attendance-calendar-grid mb-3">
                                ${renderAttendanceCalendarGrid()}
                            </div>
                            <div class="tc-attendance-legend">
                                <span><i class="bi bi-calendar-event text-success"></i> Scheduled class day</span>
                                <span><span class="tc-attendance-legend-dot" style="background:#22c55e;"></span> Present count saved</span>
                                <span><span class="tc-attendance-legend-dot" style="background:#ef4444;"></span> Absent count saved</span>
                            </div>
                        </div>
                    </div>
                    <div class="tc-attendance-sidebar">
                        <div class="tc-attendance-card tc-attendance-stat">
                            <div class="d-flex justify-content-between align-items-start gap-3">
                                <div>
                                    <div class="text-muted small text-uppercase fw-semibold mb-1">Present Students</div>
                                    <div class="tc-attendance-stat-value text-success">${presentCount}</div>
                                    <div class="tc-attendance-stat-soft">${presentCount} / ${totalStudents} students</div>
                                </div>
                                <span class="badge bg-success-subtle text-success-emphasis">${attendanceRate}% present</span>
                            </div>
                            <div class="tc-attendance-stat-list tc-attendance-stat-list--limit mt-3">
                                ${renderStudentList(roster?.present_students || [], 'No students marked present for this date yet.', 'success')}
                            </div>
                        </div>
                        <div class="tc-attendance-card tc-attendance-stat">
                            <div class="d-flex justify-content-between align-items-start gap-3">
                                <div>
                                    <div class="text-muted small text-uppercase fw-semibold mb-1">Absent Students</div>
                                    <div class="tc-attendance-stat-value text-danger">${absentCount}</div>
                                    <div class="tc-attendance-stat-soft">${absentCount} / ${totalStudents} students</div>
                                </div>
                                <span class="badge bg-danger-subtle text-danger-emphasis">${absenceRate}% absent</span>
                            </div>
                            <div class="tc-attendance-stat-list tc-attendance-stat-list--limit mt-3">
                                ${renderStudentList(roster?.absent_students || [], 'No absent students for this date.', 'danger')}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderAttendanceCalendarGrid() {
    const cells = [];
    weekdayShortLabels.forEach(label => {
        cells.push(`<div class="tc-attendance-weekday">${label}</div>`);
    });

    const viewDate = new Date(attendanceState.currentMonthDate);
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const prevMonthLastDate = new Date(year, month, 0).getDate();
    const totalCells = 42;

    for (let index = 0; index < totalCells; index += 1) {
        let date;
        let isCurrentMonth = true;

        if (index < firstDay) {
            date = new Date(year, month - 1, prevMonthLastDate - firstDay + index + 1);
            isCurrentMonth = false;
        } else if (index >= firstDay + lastDate) {
            date = new Date(year, month + 1, index - (firstDay + lastDate) + 1);
            isCurrentMonth = false;
        } else {
            date = new Date(year, month, index - firstDay + 1);
        }

        const dateKey = formatDateKey(date);
        const isToday = isSameDate(date, new Date());
        const schedules = isCurrentMonth ? getSchedulesForDate(dateKey) : [];
        const isScheduled = schedules.length > 0;
        const isSelected = attendanceState.selectedDate === dateKey;
        const isWithinYear = isDateWithinSchoolYear(dateKey);
        const savedSummary = attendanceState.dashboard?.attendance_by_date?.[dateKey] || null;

        const classes = [
            'tc-attendance-day',
            !isCurrentMonth ? 'is-empty' : '',
            isToday ? 'is-today' : '',
            isScheduled ? 'is-scheduled' : '',
            isSelected ? 'is-selected' : '',
            isCurrentMonth && !isWithinYear ? 'is-outside-year' : ''
        ].filter(Boolean).join(' ');

        if (!isCurrentMonth) {
            cells.push(`
                <div class="${classes}">
                    <div class="tc-attendance-date-row">
                        <span class="tc-attendance-date-number">${date.getDate()}</span>
                    </div>
                </div>
            `);
            continue;
        }

        cells.push(`
            <button type="button" class="${classes}" data-attendance-date="${escapeAttribute(dateKey)}" ${isScheduled ? '' : 'disabled'}>
                <div class="tc-attendance-date-row">
                    <span class="tc-attendance-date-number">${date.getDate()}</span>
                </div>
                ${isScheduled ? `<span class="tc-attendance-chip"><i class="bi bi-calendar-check"></i>${escapeHtml(schedules.length > 1 ? `${schedules.length} schedules` : 'Scheduled')}</span>` : '<span class="small text-muted">No class</span>'}
                ${isScheduled ? `<div class="small text-muted">${escapeHtml(formatScheduleWindow(schedules))}</div>` : ''}
                ${savedSummary ? `
                    <div class="tc-attendance-summary-mini">
                        <span class="tc-attendance-summary-dot" style="background:#22c55e;"></span> P ${savedSummary.present_count}
                        &nbsp; <span class="tc-attendance-summary-dot" style="background:#ef4444;"></span> A ${savedSummary.absent_count}
                    </div>
                ` : (isScheduled ? '<div class="tc-attendance-summary-mini">No attendance saved</div>' : '')}
            </button>
        `);
    }

    return cells.join('');
}

function renderSchedulePills(schedules) {
    if (!Array.isArray(schedules) || schedules.length === 0) {
        return '<span class="text-muted small">No schedules set</span>';
    }

    return schedules.map(schedule => `
        <span class="tc-attendance-schedule-pill">${escapeHtml(schedule.day || 'Day')} - ${escapeHtml(formatTimeRange(schedule.start_time, schedule.end_time))}</span>
    `).join('');
}

function renderStudentList(list, emptyMessage, tone = 'success') {
    if (!Array.isArray(list) || list.length === 0) {
        return `<div class="text-muted small">${escapeHtml(emptyMessage)}</div>`;
    }

    return `
        <div class="tc-attendance-list">
            ${list.map(item => `
                <div class="tc-attendance-list-item">
                    <div>
                        <div class="tc-attendance-list-name">${escapeHtml(item.student_name || 'Student')}</div>
                        <div class="tc-attendance-list-meta">${escapeHtml(item.program_name || 'Program')}</div>
                    </div>
                    <i class="bi bi-${tone === 'success' ? 'check-circle' : 'x-circle'} text-${tone}"></i>
                </div>
            `).join('')}
        </div>
    `;
}

function renderAttendanceLoadingState(message) {
    return `
        <div class="d-flex align-items-center justify-content-center py-5">
            <div class="text-center">
                <div class="spinner-border text-danger mb-3" role="status"></div>
                <div class="text-muted">${escapeHtml(message)}</div>
            </div>
        </div>
    `;
}

function renderAttendanceErrorState(message) {
    return `
        <div class="alert alert-danger mb-0">
            <div class="fw-semibold mb-1">Unable to load attendance</div>
            <div>${escapeHtml(message)}</div>
        </div>
    `;
}

function handleAttendanceRootClick(event) {
    const navButton = event.target.closest('[data-attendance-nav]');
    if (navButton) {
        const action = navButton.dataset.attendanceNav;
        if (action === 'prev') {
            attendanceState.currentMonthDate = new Date(attendanceState.currentMonthDate.getFullYear(), attendanceState.currentMonthDate.getMonth() - 1, 1);
            loadAttendanceDashboard({ preserveSelection: true });
        } else if (action === 'next') {
            attendanceState.currentMonthDate = new Date(attendanceState.currentMonthDate.getFullYear(), attendanceState.currentMonthDate.getMonth() + 1, 1);
            loadAttendanceDashboard({ preserveSelection: true });
        } else if (action === 'today') {
            const today = new Date();
            attendanceState.currentMonthDate = new Date(today.getFullYear(), today.getMonth(), 1);
            loadAttendanceDashboard({ preserveSelection: true });
        }
        return;
    }

    const dateButton = event.target.closest('[data-attendance-date]');
    if (dateButton && !dateButton.disabled) {
        openRosterForDate(dateButton.dataset.attendanceDate);
        return;
    }

    if (event.target.closest('[data-open-roster]') && attendanceState.selectedDate) {
        openRosterForDate(attendanceState.selectedDate, { skipRosterReload: true });
    }
}

async function openRosterForDate(dateKey, { skipRosterReload = false } = {}) {
    if (!dateKey) return;

    attendanceState.selectedDate = dateKey;
    if (!skipRosterReload) {
        await loadAttendanceRosterSummary(dateKey);
    }

    renderAttendanceDashboard();
    renderRosterModal();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('attendanceRosterModal')).show();
}

function renderRosterModal() {
    const roster = attendanceState.roster;
    const modalTitle = document.getElementById('attendanceRosterModalTitle');
    const modalBody = document.getElementById('attendanceRosterModalBody');
    const saveButton = document.getElementById('saveAttendanceRosterBtn');

    if (!modalTitle || !modalBody || !saveButton) return;

    modalTitle.textContent = attendanceState.selectedDate
        ? `Attendance Roster - ${formatLongDate(attendanceState.selectedDate)}`
        : 'Attendance Roster';

    if (!roster) {
        modalBody.innerHTML = renderAttendanceLoadingState('Loading attendance roster...');
        saveButton.disabled = true;
        return;
    }

    const presentCount = roster.students.filter(student => student.is_present).length;
    const absentCount = roster.students.length - presentCount;

    modalBody.innerHTML = `
        <div class="tc-attendance-roster-summary">
            <span class="tc-attendance-roster-pill bg-success-subtle text-success-emphasis">Present: ${presentCount}</span>
            <span class="tc-attendance-roster-pill bg-danger-subtle text-danger-emphasis">Absent: ${absentCount}</span>
            <span class="tc-attendance-roster-pill bg-light text-dark border">Total: ${roster.students.length}</span>
        </div>
        <div class="table-responsive">
            <table class="table table-hover align-middle">
                <thead>
                    <tr>
                        <th>Student</th>
                        <th>Program</th>
                        <th class="text-center">Present</th>
                    </tr>
                </thead>
                <tbody>
                    ${roster.students.map((student, index) => `
                        <tr>
                            <td>
                                <div class="fw-semibold">${escapeHtml(student.student_name || buildStudentName(student))}</div>
                                <div class="small text-muted">Enrollment #${escapeHtml(student.enrollment_details_id)}</div>
                            </td>
                            <td>${escapeHtml(student.program_name || roster.section?.program_name || 'Program')}</td>
                            <td class="text-center">
                                <div class="form-check d-inline-flex justify-content-center">
                                    <input class="form-check-input attendance-roster-checkbox" type="checkbox" data-roster-index="${index}" ${student.is_present ? 'checked' : ''}>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    saveButton.disabled = roster.students.length === 0;
}

function handleRosterInputChange(event) {
    const checkbox = event.target.closest('.attendance-roster-checkbox');
    if (!checkbox || !attendanceState.roster) return;

    const index = Number(checkbox.dataset.rosterIndex);
    if (Number.isNaN(index) || !attendanceState.roster.students[index]) return;

    attendanceState.roster.students[index].is_present = checkbox.checked;
    attendanceState.roster.students[index].attendance_status = checkbox.checked ? 'present' : 'absent';
    attendanceState.roster.present_count = attendanceState.roster.students.filter(student => student.is_present).length;
    attendanceState.roster.absent_count = attendanceState.roster.students.length - attendanceState.roster.present_count;
    attendanceState.roster.present_students = attendanceState.roster.students
        .filter(student => student.is_present)
        .map(student => ({
            student_name: student.student_name || buildStudentName(student),
            program_name: student.program_name
        }));
    attendanceState.roster.absent_students = attendanceState.roster.students
        .filter(student => !student.is_present)
        .map(student => ({
            student_name: student.student_name || buildStudentName(student),
            program_name: student.program_name
        }));

    renderRosterModal();
    renderAttendanceDashboard();
}

async function saveAttendanceRoster() {
    if (!attendanceState.roster || !attendanceState.selectedDate || !attendanceState.sectionId) return;

    const saveButton = document.getElementById('saveAttendanceRosterBtn');
    if (saveButton) {
        saveButton.disabled = true;
        saveButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving...';
    }

    try {
        const payload = {
            section_id: attendanceState.sectionId,
            attendance_date: attendanceState.selectedDate,
            records: attendanceState.roster.students.map(student => ({
                enrollment_details_id: student.enrollment_details_id,
                status: student.is_present ? 'present' : 'absent'
            }))
        };

        const params = new URLSearchParams();
        params.append('operation', 'saveAttendance');
        params.append('json', JSON.stringify(payload));

        const res = await axios.post(ATTENDANCE_API_URL, params);
        if (res.data?.status !== 'success') {
            throw new Error(res.data?.message || 'Unable to save attendance.');
        }

        await loadAttendanceDashboard({ preserveSelection: true });
        renderRosterModal();
        Swal.fire('Saved', 'Attendance saved successfully.', 'success');
    } catch (error) {
        console.error('Error saving attendance:', error);
        Swal.fire('Error', error.response?.data?.message || error.message || 'Unable to save attendance.', 'error');
    } finally {
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent = 'Save Attendance';
        }
    }
}

function normalizeVisibleMonthToSchoolYear() {
    const schoolYear = attendanceState.dashboard?.section?.school_year;
    if (!schoolYear?.start_date || !schoolYear?.end_date) return;

    const start = parseDateKey(schoolYear.start_date);
    const end = parseDateKey(schoolYear.end_date);
    if (!start || !end) return;

    const current = new Date(attendanceState.currentMonthDate.getFullYear(), attendanceState.currentMonthDate.getMonth(), 1);
    if (current < new Date(start.getFullYear(), start.getMonth(), 1)) {
        attendanceState.currentMonthDate = new Date(start.getFullYear(), start.getMonth(), 1);
        return;
    }

    if (current > new Date(end.getFullYear(), end.getMonth(), 1)) {
        attendanceState.currentMonthDate = new Date(end.getFullYear(), end.getMonth(), 1);
    }
}

function pickSelectedDate(preserveSelection = false) {
    if (preserveSelection && attendanceState.selectedDate) {
        const existingSchedules = getSchedulesForDate(attendanceState.selectedDate);
        if (isDateInVisibleMonth(attendanceState.selectedDate) && existingSchedules.length > 0) {
            return attendanceState.selectedDate;
        }
    }

    const todayKey = formatDateKey(new Date());
    if (isDateInVisibleMonth(todayKey) && getSchedulesForDate(todayKey).length > 0) {
        return todayKey;
    }

    return findFirstScheduledDateInMonth() || '';
}

function findFirstScheduledDateInMonth() {
    const viewDate = new Date(attendanceState.currentMonthDate);
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const lastDate = new Date(year, month + 1, 0).getDate();

    for (let day = 1; day <= lastDate; day += 1) {
        const dateKey = formatDateKey(new Date(year, month, day));
        if (getSchedulesForDate(dateKey).length > 0) {
            return dateKey;
        }
    }

    return '';
}

function getSchedulesForDate(dateKey) {
    if (!dateKey || !attendanceState.dashboard?.section?.schedules) return [];
    if (!isDateWithinSchoolYear(dateKey)) return [];

    const date = parseDateKey(dateKey);
    if (!date) return [];
    const weekday = weekdayLabels[date.getDay()];

    return (attendanceState.dashboard.section.schedules || []).filter(schedule => {
        return String(schedule.day || '').trim().toLowerCase() === weekday.toLowerCase();
    });
}

function isDateWithinSchoolYear(dateKey) {
    const schoolYear = attendanceState.dashboard?.section?.school_year;
    if (!schoolYear?.start_date || !schoolYear?.end_date) {
        return true;
    }

    return dateKey >= schoolYear.start_date && dateKey <= schoolYear.end_date;
}

function isDateInVisibleMonth(dateKey) {
    const date = parseDateKey(dateKey);
    if (!date) return false;

    return date.getFullYear() === attendanceState.currentMonthDate.getFullYear()
        && date.getMonth() === attendanceState.currentMonthDate.getMonth();
}

function renderSchoolYearLabel(schoolYear) {
    if (!schoolYear?.school_year && !schoolYear?.start_date && !schoolYear?.end_date) {
        return 'No active school year set.';
    }

    const range = schoolYear.start_date && schoolYear.end_date
        ? `${formatShortDate(schoolYear.start_date)} - ${formatShortDate(schoolYear.end_date)}`
        : 'School year dates not set';

    return `${schoolYear.school_year || 'Active School Year'} - ${range}`;
}

function formatMonthTitle(date) {
    return date.toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric'
    });
}

function formatLongDate(dateKey) {
    const date = parseDateKey(dateKey);
    if (!date) return 'N/A';
    return date.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });
}

function formatShortDate(dateKey) {
    const date = parseDateKey(dateKey);
    if (!date) return 'N/A';
    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function formatScheduleWindow(schedules) {
    if (!Array.isArray(schedules) || schedules.length === 0) {
        return 'No schedule';
    }

    return schedules.slice(0, 2).map(schedule => formatTimeRange(schedule.start_time, schedule.end_time)).join(' | ');
}

function formatTimeRange(start, end) {
    const formattedStart = formatTime(start);
    const formattedEnd = formatTime(end);
    if (formattedStart && formattedEnd) return `${formattedStart} - ${formattedEnd}`;
    return formattedStart || formattedEnd || 'Time not set';
}

function formatTime(value) {
    if (!value) return '';
    const safeValue = String(value).slice(0, 5);
    const [hourString, minuteString] = safeValue.split(':');
    const hour = Number(hourString);
    const minute = Number(minuteString);
    if (Number.isNaN(hour) || Number.isNaN(minute)) return safeValue;

    const suffix = hour >= 12 ? 'PM' : 'AM';
    const normalizedHour = hour % 12 || 12;
    return `${normalizedHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function buildStudentName(student) {
    return [student.first_name, student.last_name, student.ext]
        .filter(part => part && String(part).trim())
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getMonthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateKey(dateKey) {
    if (!dateKey) return null;
    const date = new Date(`${dateKey}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function isSameDate(left, right) {
    return left.getFullYear() === right.getFullYear()
        && left.getMonth() === right.getMonth()
        && left.getDate() === right.getDate();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
    return escapeHtml(value);
}
