import { renderSchoolYearOverviewPanel } from "./school_year_overview.js";
import { canUseSchoolCalendarPermission, guardSchoolCalendarPermission } from "./school_calendar_rbac.js";

const weekdayDefinitions = [
    { key: 1, label: 'Mon' },
    { key: 2, label: 'Tue' },
    { key: 3, label: 'Wed' },
    { key: 4, label: 'Thu' },
    { key: 5, label: 'Fri' },
    { key: 6, label: 'Sat' },
    { key: 0, label: 'Sun' }
];
const calendarWeekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let schoolYears = [];
const schoolCalendarState = {
    focusedSchoolYearId: null,
    overviewMonth: null,
    stylesBound: false,
    eventsBound: false,
    expandedGuideSchoolYears: new Set()
};

export function loadSchoolYears() {
    ensureSchoolCalendarStyles();
    bindSchoolCalendarDashboardEvents();
    renderSchoolCalendarLoadingState();

    const guideBody = document.getElementById('school_calendar_table_body');
    if (guideBody) {
        guideBody.innerHTML = '<tr><td colspan="12" class="text-center">Loading guide map...</td></tr>';
    }

    axios.get('../../api/admin/school_year.php', { params: { operation: 'getSchoolYears' } })
        .then(res => {
            schoolYears = Array.isArray(res.data) ? res.data : [];
            syncSchoolCalendarState();
            renderSchoolCalendarDashboard();
            renderSchoolCalendarGuide();
        })
        .catch(err => {
            console.error('Error loading school years:', err);
            renderSchoolCalendarErrorState();
            if (guideBody) {
                guideBody.innerHTML = '<tr><td colspan="12" class="text-center text-danger">Failed to load school calendar guide</td></tr>';
            }
        });
}

function ensureSchoolCalendarStyles() {
    if (schoolCalendarState.stylesBound || !document.getElementById('schoolCalendarDashboardRoot')) return;

    const style = document.createElement('style');
    style.id = 'schoolCalendarStyles';
    style.textContent = `
        .tc-school-dashboard { display: grid; gap: 0.9rem; }
        .tc-school-toolbar { display: flex; justify-content: space-between; align-items: end; gap: 0.85rem; flex-wrap: wrap; }
        .tc-school-toolbar-copy h2 { margin: 0; font-size: 1.65rem; font-weight: 800; color: #172554; }
        .tc-school-toolbar-copy p { margin: 0.35rem 0 0; color: #64748b; }
        .tc-school-toolbar-control { min-width: 210px; }
        .tc-school-toolbar-label { display: block; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #94a3b8; margin-bottom: 0.35rem; }
        .tc-school-summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.8rem; }
        .tc-school-summary-card { border: 1px solid rgba(226, 232, 240, 0.95); border-radius: 20px; padding: 0.85rem 0.95rem; background: #fff; box-shadow: 0 14px 30px rgba(15, 23, 42, 0.05); display: flex; align-items: center; gap: 0.75rem; min-height: 88px; }
        .tc-school-summary-icon { width: 42px; height: 42px; border-radius: 14px; display: inline-flex; align-items: center; justify-content: center; background: linear-gradient(180deg, #fff1f4 0%, #ffe4ea 100%); color: #ff4d73; font-size: 1.05rem; flex-shrink: 0; }
        .tc-school-summary-label { font-size: 0.76rem; color: #64748b; font-weight: 600; margin-bottom: 0.18rem; }
        .tc-school-summary-value { font-size: 1.55rem; color: #172554; font-weight: 800; line-height: 1; }
        .tc-school-summary-meta { font-size: 0.7rem; color: #94a3b8; margin-top: 0.15rem; }
        .tc-school-main-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.9fr) minmax(260px, 0.82fr); gap: 0.8rem; align-items: start; }
        .tc-school-card { border: 1px solid rgba(226, 232, 240, 0.95); border-radius: 20px; padding: 0.8rem 0.9rem; background: #fff; box-shadow: 0 14px 30px rgba(15, 23, 42, 0.05); height: 100%; }
        .tc-school-card-header { display: flex; justify-content: space-between; align-items: start; gap: 0.7rem; margin-bottom: 0.75rem; }
        .tc-school-card-title { font-size: 1.1rem; font-weight: 800; color: #172554; margin: 0; }
        .tc-school-card-copy { margin: 0.2rem 0 0; color: #64748b; font-size: 0.8rem; }
        .tc-school-action-btn { min-height: 34px; border-radius: 999px; padding: 0.3rem 0.8rem; display: inline-flex; align-items: center; justify-content: center; gap: 0.38rem; font-size: 0.78rem; font-weight: 700; line-height: 1.1; white-space: nowrap; }
        .tc-school-action-btn i { font-size: 0.82rem; }
        .tc-school-calendar-nav { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; margin-bottom: 0.7rem; }
        .tc-school-overview-nav { display: grid; gap: 0.45rem; margin-bottom: 0.7rem; }
        .tc-school-overview-nav-main { display: grid; grid-template-columns: 34px minmax(0, 1fr) 34px; align-items: center; gap: 0.55rem; }
        .tc-school-overview-nav-main .tc-school-month-label { text-align: center; }
        .tc-school-nav-btn { width: 34px; height: 34px; border-radius: 999px; border: 1px solid #fda4af; background: #fff; color: #ff4d73; display: inline-flex; align-items: center; justify-content: center; }
        .tc-school-month-label { font-size: 1.2rem; font-weight: 800; color: #172554; }
        .tc-school-overview-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 0.28rem; }
        .tc-school-weekday { text-align: center; font-size: 0.72rem; font-weight: 700; color: #475569; padding-bottom: 0.2rem; }
        .tc-school-day { min-height: 62px; border-radius: 14px; border: 1px solid #e2e8f0; padding: 0.45rem; background: #fff; position: relative; }
        .tc-school-day.is-outside { color: #cbd5e1; background: #f8fafc; }
        .tc-school-day.is-inactive { background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%); }
        .tc-school-day.is-q1,
        .tc-school-day.is-q2,
        .tc-school-day.is-q3,
        .tc-school-day.is-q4 { background: linear-gradient(180deg, #fff5f7 0%, #ffe4eb 100%); }
        .tc-school-day.is-today { outline: 2px solid rgba(255, 77, 115, 0.35); outline-offset: -2px; }
        .tc-school-day-number { font-size: 0.84rem; font-weight: 700; color: #172554; }
        .tc-school-day.is-outside .tc-school-day-number { color: #94a3b8; }
        .tc-school-day-caption { font-size: 0.56rem; color: #64748b; margin-top: 0.18rem; }
        .tc-school-overview-legend { display: flex; flex-wrap: wrap; gap: 0.7rem; margin-top: 0.75rem; font-size: 0.72rem; color: #475569; }
        .tc-school-overview-legend span { display: inline-flex; align-items: center; gap: 0.35rem; }
        .tc-school-legend-swatch { width: 12px; height: 12px; border-radius: 4px; display: inline-block; border: 1px solid rgba(148, 163, 184, 0.25); }
        .tc-school-quarter-panel,
        .tc-school-activity-panel { display: grid; gap: 0.65rem; }
        .tc-school-quarter-card { border: 1px solid rgba(226, 232, 240, 0.95); border-radius: 15px; padding: 0.75rem; background: #fff; }
        .tc-school-activity-card { cursor: pointer; transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease; }
        .tc-school-activity-card:hover { transform: translateY(-2px); border-color: #fda4af; box-shadow: 0 12px 24px rgba(255, 77, 115, 0.1); }
        .tc-school-activity-card:focus-visible { outline: 3px solid rgba(255, 77, 115, 0.25); outline-offset: 2px; }
        .tc-school-quarter-top { display: flex; justify-content: space-between; gap: 0.6rem; align-items: center; margin-bottom: 0.6rem; }
        .tc-school-quarter-index { width: 28px; height: 28px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; margin-right: 0.55rem; font-size: 0.82rem; }
        .tc-school-quarter-name { font-size: 0.9rem; font-weight: 800; color: #172554; }
        .tc-school-quarter-date-label { display: block; font-size: 0.68rem; color: #64748b; margin-bottom: 0.22rem; }
        .tc-school-quarter-date-box { border: 1px solid #e2e8f0; border-radius: 12px; padding: 0.52rem 0.65rem; font-weight: 600; font-size: 0.88rem; color: #172554; background: #fff; }
        .tc-school-quarter-empty,
        .tc-school-activity-empty { border: 1px dashed #fbcfe8; border-radius: 15px; padding: 1rem 0.85rem; text-align: center; color: #64748b; background: linear-gradient(180deg, #fff 0%, #fff8fb 100%); }
        .tc-school-activity-empty i { font-size: 1.35rem; color: #16a34a; display: block; margin-bottom: 0.4rem; }
        .tc-school-guide-table thead th { background: linear-gradient(180deg, #ff8ca5 0%, #ff7a96 100%); color: #fff; border: 0; }
        .tc-school-guide-table tbody tr.table-success { --bs-table-bg: #effcf4; --bs-table-hover-bg: #e2f7ea; }
        .tc-school-guide-row { cursor: pointer; }
        .tc-school-guide-row:hover { --bs-table-bg: #f8fafc; }
        .tc-school-guide-row.table-success:hover { --bs-table-bg: #e2f7ea; }
        .tc-school-guide-detail { --bs-table-bg: #fcfcfd; }
        .tc-school-guide-toggle { display: inline-flex; align-items: center; gap: 0.5rem; }
        .tc-school-guide-toggle i { color: #ff4d73; font-size: 0.8rem; }
        .tc-school-status-badge { border-radius: 999px; padding: 0.28rem 0.55rem; font-size: 0.66rem; font-weight: 700; text-transform: lowercase; }
        .tc-school-status-badge.is-active { background: #dcfce7; color: #15803d; }
        .tc-school-status-badge.is-inactive { background: #e2e8f0; color: #475569; }
        @media (max-width: 1399px) {
            .tc-school-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .tc-school-main-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 767px) {
            .tc-school-toolbar-copy h2 { font-size: 1.5rem; }
            .tc-school-summary-grid { grid-template-columns: 1fr; }
            .tc-school-summary-card { min-height: 0; }
            .tc-school-day { min-height: 54px; padding: 0.4rem; }
            .tc-school-overview-grid { gap: 0.22rem; }
        }
    `;

    document.head.appendChild(style);
    schoolCalendarState.stylesBound = true;
}

function bindSchoolCalendarDashboardEvents() {
    if (schoolCalendarState.eventsBound) return;

    document.addEventListener('click', event => {
        if (!document.getElementById('schoolCalendarDashboardRoot')) return;

        const navButton = event.target.closest('[data-school-calendar-nav]');
        if (navButton) {
            const focused = getFocusedSchoolYear();
            if (!focused) return;

            const action = navButton.getAttribute('data-school-calendar-nav');
            const baseMonth = schoolCalendarState.overviewMonth || getInitialOverviewMonth(focused);

            if (action === 'prev') {
                schoolCalendarState.overviewMonth = clampMonthToSchoolYear(new Date(baseMonth.getFullYear(), baseMonth.getMonth() - 1, 1), focused);
            } else if (action === 'next') {
                schoolCalendarState.overviewMonth = clampMonthToSchoolYear(new Date(baseMonth.getFullYear(), baseMonth.getMonth() + 1, 1), focused);
            } else if (action === 'today') {
                schoolCalendarState.overviewMonth = getInitialOverviewMonth(focused);
            }

            renderSchoolCalendarDashboard();
            return;
        }

        const guideRow = event.target.closest('[data-school-guide-toggle]');
        if (guideRow) {
            const schoolYearId = Number(guideRow.getAttribute('data-school-guide-toggle') || 0);
            if (schoolYearId > 0) {
                if (schoolCalendarState.expandedGuideSchoolYears.has(schoolYearId)) {
                    schoolCalendarState.expandedGuideSchoolYears.delete(schoolYearId);
                } else {
                    schoolCalendarState.expandedGuideSchoolYears.add(schoolYearId);
                }
                renderSchoolCalendarGuide();
            }
            return;
        }

        const activityCard = event.target.closest('[data-school-activity-view]');
        if (activityCard && !event.target.closest('[data-school-year-action]')) {
            const activityId = Number(activityCard.getAttribute('data-school-activity-view') || 0);
            if (activityId > 0) {
                openSchoolActivityDetailsModal(activityId);
            }
            return;
        }

        const actionButton = event.target.closest('[data-school-year-action]');
        if (!actionButton) return;

        const action = actionButton.getAttribute('data-school-year-action');
        const focused = getFocusedSchoolYear();

        if (action === 'edit-focused' && focused) {
            openEditSchoolYearModal(focused.school_year_id);
        } else if (action === 'open-add') {
            setupAddSchoolYearModal();
        } else if (action === 'open-add-activity' && focused) {
            setupAddSchoolActivityModal(focused.school_year_id);
        } else if (action === 'edit-activity') {
            const activityId = Number(actionButton.getAttribute('data-school-activity-id') || 0);
            if (activityId > 0) {
                openEditSchoolActivityModal(activityId);
            }
        } else if (action === 'archive-activity' || action === 'delete-activity') {
            const activityId = Number(actionButton.getAttribute('data-school-activity-id') || 0);
            if (activityId > 0) {
                archiveSchoolActivity(activityId);
            }
        }
    });

    document.addEventListener('change', event => {
        const picker = event.target.closest('[data-school-calendar-year-picker]');
        if (!picker) return;

        schoolCalendarState.focusedSchoolYearId = Number(picker.value) || null;
        const focused = getFocusedSchoolYear();
        schoolCalendarState.overviewMonth = focused ? getInitialOverviewMonth(focused) : null;
        renderSchoolCalendarDashboard();
    });

    document.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const activityCard = event.target.closest('[data-school-activity-view]');
        if (!activityCard || event.target.closest('[data-school-year-action]')) return;

        event.preventDefault();
        const activityId = Number(activityCard.getAttribute('data-school-activity-view') || 0);
        if (activityId > 0) {
            openSchoolActivityDetailsModal(activityId);
        }
    });

    schoolCalendarState.eventsBound = true;
}

function syncSchoolCalendarState() {
    if (schoolYears.length === 0) {
        schoolCalendarState.focusedSchoolYearId = null;
        schoolCalendarState.overviewMonth = null;
        return;
    }

    const selectedExists = schoolYears.some(sy => sy.school_year_id == schoolCalendarState.focusedSchoolYearId);
    if (!selectedExists) {
        const activeSchoolYear = schoolYears.find(sy => sy.sy_status === 'active');
        schoolCalendarState.focusedSchoolYearId = activeSchoolYear?.school_year_id || schoolYears[0]?.school_year_id || null;
    }

    const focused = getFocusedSchoolYear();
    if (!focused) {
        schoolCalendarState.overviewMonth = null;
        return;
    }

    if (!schoolCalendarState.overviewMonth || !isMonthWithinSchoolYear(schoolCalendarState.overviewMonth, focused)) {
        schoolCalendarState.overviewMonth = getInitialOverviewMonth(focused);
    } else {
        schoolCalendarState.overviewMonth = clampMonthToSchoolYear(schoolCalendarState.overviewMonth, focused);
    }

    schoolCalendarState.expandedGuideSchoolYears = new Set(
        Array.from(schoolCalendarState.expandedGuideSchoolYears)
            .filter(id => schoolYears.some(sy => sy.school_year_id == id))
    );
}

function getFocusedSchoolYear() {
    if (schoolYears.length === 0) return null;
    return schoolYears.find(sy => sy.school_year_id == schoolCalendarState.focusedSchoolYearId)
        || schoolYears.find(sy => sy.sy_status === 'active')
        || schoolYears[0];
}

function renderSchoolCalendarLoadingState() {
    const root = document.getElementById('schoolCalendarDashboardRoot');
    if (!root) return;

    root.innerHTML = `
        <div class="card content-panel">
            <div class="text-center text-muted py-5">Loading school calendar overview...</div>
        </div>
    `;
}

function renderSchoolCalendarErrorState() {
    const root = document.getElementById('schoolCalendarDashboardRoot');
    if (!root) return;

    root.innerHTML = `
        <div class="card content-panel">
            <div class="text-center text-danger py-5">Failed to load school calendar overview.</div>
        </div>
    `;
}

function renderSchoolCalendarDashboard() {
    const root = document.getElementById('schoolCalendarDashboardRoot');
    if (!root) return;

    if (schoolYears.length === 0) {
        root.innerHTML = `
            <div class="card content-panel">
                <div class="text-center py-5">
                    <div class="fw-bold fs-5 mb-2">No school calendar yet</div>
                    <div class="text-muted mb-3">Create your first school year to start the quarter map and attendance guide.</div>
                    ${canUseSchoolCalendarPermission('create')
                        ? `<button type="button" class="btn btn-add shadow-sm px-4" data-school-year-action="open-add">
                            <i class="bi bi-plus-lg me-1"></i> Add School Calendar
                        </button>`
                        : ''
                    }
                </div>
            </div>
        `;
        return;
    }

    const focused = getFocusedSchoolYear();
    const quarters = normalizeQuarterArray(focused.quarters, focused);
    const yearSummary = summarizeRange(focused.start_date, focused.end_date);
    const viewMonth = clampMonthToSchoolYear(schoolCalendarState.overviewMonth || getInitialOverviewMonth(focused), focused);
    schoolCalendarState.overviewMonth = viewMonth;

    root.innerHTML = `
        <div class="tc-school-dashboard">
            <div class="tc-school-toolbar">
                <div class="tc-school-toolbar-copy">
                    <h2>School Calendar</h2>
                    <p>Manage school year periods and attendance guide mapping.</p>
                </div>
                <div class="tc-school-toolbar-control">
                    <label class="tc-school-toolbar-label">Viewing school year</label>
                    <select class="form-select shadow-sm" data-school-calendar-year-picker>
                        ${schoolYears.map(sy => `
                            <option value="${escapeAttribute(sy.school_year_id)}" ${sy.school_year_id == focused.school_year_id ? 'selected' : ''}>
                                ${escapeHtml(sy.school_year || 'N/A')} (${escapeHtml(sy.sy_status || 'inactive')})
                            </option>
                        `).join('')}
                    </select>
                </div>
            </div>

            <div class="tc-school-summary-grid">
                ${renderSummaryCard('bi-calendar2-week', 'School Year Tag', focused.school_year || 'N/A', focused.sy_status === 'active' ? 'Active school year' : 'Inactive school year')}
                ${renderSummaryCard('bi-calendar-date', 'School Start', formatCompactDate(focused.start_date), yearSummary.totalDays !== null ? `${yearSummary.totalDays} total days` : 'School dates not complete')}
                ${renderSummaryCard('bi-calendar-check', 'School End', formatCompactDate(focused.end_date), yearSummary.label)}
                ${renderSummaryCard('bi-people', 'Active Quarters', String(quarters.length), quarters.length === 1 ? '1 active quarter period' : `${quarters.length} quarter periods`)}
            </div>

            <div class="tc-school-main-grid">
                <div class="tc-school-card" id="schoolYearOverviewCardRoot"></div>

                <div class="tc-school-card">
                <div class="tc-school-card-header">
                    <div>
                        <h3 class="tc-school-card-title">Quarter Periods</h3>
                        <p class="tc-school-card-copy">Add or remove periods depending on how your school year is divided.</p>
                    </div>
                    ${canUseSchoolCalendarPermission('edit')
                        ? `<button type="button" class="btn btn-outline-danger tc-school-action-btn" data-school-year-action="edit-focused">
                            <i class="bi bi-plus-lg"></i> Add Quarter
                        </button>`
                        : ''
                    }
                </div>
                    <div class="tc-school-quarter-panel">
                        ${renderQuarterPeriodCards(quarters, focused)}
                    </div>
                </div>

                <div class="tc-school-card">
                <div class="tc-school-card-header">
                    <div>
                        <h3 class="tc-school-card-title">School Schedule Log</h3>
                        <p class="tc-school-card-copy">Click an activity to view its complete schedule details.</p>
                    </div>
                    ${canUseSchoolCalendarPermission('create')
                        ? `<button type="button" class="btn btn-outline-danger tc-school-action-btn" data-school-year-action="open-add-activity">
                            <i class="bi bi-plus-lg"></i> Add Activity
                        </button>`
                        : ''
                    }
                </div>
                    <div class="tc-school-activity-panel">
                        ${renderSchoolActivitiesPanel(focused.activities || [], focused)}
                    </div>
                </div>
            </div>
        </div>
    `;

    const overviewRoot = document.getElementById('schoolYearOverviewCardRoot');
    renderSchoolYearOverviewPanel({
        root: overviewRoot,
        schoolYear: focused,
        onEditCalendar: () => openEditSchoolYearModal(focused.school_year_id)
    });
}

function renderSchoolCalendarGuide() {
    const tableBody = document.getElementById('school_calendar_table_body');
    if (!tableBody) return;

    if (schoolYears.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="12" class="text-center text-muted">Add a school year to build the attendance guide map.</td></tr>';
        return;
    }

    const rows = [];
    schoolYears.forEach(sy => {
        const periods = getGuidePeriods(sy);
        const wholeYear = periods[0] || { label: 'Whole School Year', start: sy.start_date, end: sy.end_date };
        const wholeYearSummary = summarizeRange(wholeYear.start, wholeYear.end);
        const wholeYearCounts = getWeekdayCounts(wholeYear.start, wholeYear.end);
        const isExpanded = schoolCalendarState.expandedGuideSchoolYears.has(Number(sy.school_year_id));
        const toggleIcon = isExpanded ? 'bi-chevron-up' : 'bi-chevron-down';

        rows.push(`
            <tr class="tc-school-guide-row ${sy.sy_status === 'active' ? 'table-success' : ''}" data-school-guide-toggle="${escapeAttribute(sy.school_year_id)}">
                <td class="fw-semibold">
                    <span class="tc-school-guide-toggle">
                        <i class="bi ${toggleIcon}"></i>
                        ${escapeHtml(sy.school_year || 'N/A')}
                    </span>
                </td>
                <td>${escapeHtml(wholeYear.label)}</td>
                <td>${escapeHtml(wholeYearSummary.label)}</td>
                <td>${wholeYearSummary.totalDays ?? '-'}</td>
                ${weekdayDefinitions.map(day => `<td>${wholeYearCounts ? wholeYearCounts[day.key] : '-'}</td>`).join('')}
                <td><span class="tc-school-status-badge ${sy.sy_status === 'active' ? 'is-active' : 'is-inactive'}">${escapeHtml(sy.sy_status || 'inactive')}</span></td>
            </tr>
        `);

        if (isExpanded) {
            periods.slice(1).forEach(period => {
                const summary = summarizeRange(period.start, period.end);
                const weekdayCounts = getWeekdayCounts(period.start, period.end);
                rows.push(`
                    <tr class="tc-school-guide-detail">
                        <td class="fw-semibold ps-4">${escapeHtml(sy.school_year || 'N/A')}</td>
                        <td>${escapeHtml(period.label)}</td>
                        <td>${escapeHtml(summary.label)}</td>
                        <td>${summary.totalDays ?? '-'}</td>
                        ${weekdayDefinitions.map(day => `<td>${weekdayCounts ? weekdayCounts[day.key] : '-'}</td>`).join('')}
                        <td><span class="tc-school-status-badge ${sy.sy_status === 'active' ? 'is-active' : 'is-inactive'}">${escapeHtml(sy.sy_status || 'inactive')}</span></td>
                    </tr>
                `);
            });
        }
    });

    tableBody.innerHTML = rows.join('');
}

function renderSummaryCard(icon, label, value, meta) {
    return `
        <div class="tc-school-summary-card">
            <div class="tc-school-summary-icon">
                <i class="bi ${icon}"></i>
            </div>
            <div>
                <div class="tc-school-summary-label">${escapeHtml(label)}</div>
                <div class="tc-school-summary-value">${escapeHtml(value)}</div>
                <div class="tc-school-summary-meta">${escapeHtml(meta || '')}</div>
            </div>
        </div>
    `;
}

function renderQuarterPeriodCards(quarters, focusedSchoolYear) {
    if (!Array.isArray(quarters) || quarters.length === 0) {
        return `
            <div class="tc-school-quarter-empty">
                No quarter periods have been added yet for ${escapeHtml(focusedSchoolYear?.school_year || 'this school year')}.
            </div>
        `;
    }

    return quarters.map((quarter, index) => `
        <div class="tc-school-quarter-card">
            <div class="tc-school-quarter-top">
                <div class="d-flex align-items-center">
                    <span class="tc-school-quarter-index" style="${getQuarterIndexStyle(index)}">${index + 1}</span>
                    <div class="tc-school-quarter-name">${escapeHtml(quarter.label || buildDefaultQuarterLabel(index))}</div>
                </div>
                ${canUseSchoolCalendarPermission('edit')
                    ? `<button type="button" class="btn btn-sm btn-outline-danger rounded-circle" data-school-year-action="edit-focused" title="Edit school calendar">
                        <i class="bi bi-pencil"></i>
                    </button>`
                    : ''
                }
            </div>
            <div class="row g-2">
                <div class="col-6">
                    <span class="tc-school-quarter-date-label">Start</span>
                    <div class="tc-school-quarter-date-box">${escapeHtml(formatCompactDate(quarter.start_date))}</div>
                </div>
                <div class="col-6">
                    <span class="tc-school-quarter-date-label">End</span>
                    <div class="tc-school-quarter-date-box">${escapeHtml(formatCompactDate(quarter.end_date))}</div>
                </div>
            </div>
        </div>
    `).join('');
}

function openSchoolActivityDetailsModal(activityId) {
    const activity = findSchoolActivityById(activityId);
    if (!activity) return;

    const activitySchoolYear = schoolYears.find(schoolYear => schoolYear.school_year_id == activity.school_year_id)
        || getFocusedSchoolYear();
    const activityDate = formatFullDate(activity.activity_date);
    const parsedDate = toLocalDate(activity.activity_date);
    const dayLabel = parsedDate
        ? parsedDate.toLocaleDateString(undefined, { weekday: 'long' })
        : 'N/A';
    const status = activity.activity_status === 'inactive' ? 'Inactive' : 'Active';
    const content = `
        <div class="tc-detail-scroll">
            <div class="tc-detail-feature">
                <div class="tc-detail-feature-icon"><i class="bi bi-calendar-event"></i></div>
                <div>
                    <div class="tc-detail-feature-label">Activity Date</div>
                    <div class="tc-detail-feature-value">${escapeHtml(activityDate)}</div>
                </div>
            </div>
            <div class="tc-detail-grid">
                ${createSchoolActivityDetailTile('calendar3', 'Day', dayLabel)}
                ${createSchoolActivityDetailTile('calendar2-check', 'School Year', activitySchoolYear?.school_year || 'N/A')}
            </div>
            <div class="tc-detail-grid">
                ${createSchoolActivityDetailTile(getActivityIcon(activity.activity_title).replace('bi-', ''), 'Activity', activity.activity_title || 'School Activity')}
                ${createSchoolActivityDetailTile('check-circle', 'Status', status, true)}
            </div>
            <div class="tc-detail-grid tc-detail-grid-single">
                ${createSchoolActivityDetailTile('card-text', 'Notes', activity.activity_notes || 'No notes were added for this activity.')}
            </div>
        </div>
    `;

    Swal.fire({
        title: 'Schedule Details',
        html: content,
        showCloseButton: true,
        showConfirmButton: canUseSchoolCalendarPermission('edit'),
        showCancelButton: true,
        confirmButtonText: '<i class="bi bi-pencil-square"></i> Edit Activity',
        cancelButtonText: 'Close',
        width: 920,
        heightAuto: false,
        customClass: {
            popup: 'calendar-schedule-popup tc-detail-popup',
            title: 'tc-detail-title',
            htmlContainer: 'tc-detail-body',
            closeButton: 'tc-detail-close',
            actions: 'tc-detail-actions tc-detail-actions-end',
            confirmButton: 'tc-detail-btn tc-detail-btn-primary',
            cancelButton: 'tc-detail-btn tc-detail-btn-outline'
        }
    }).then(result => {
        if (result.isConfirmed) {
            openEditSchoolActivityModal(activityId);
        }
    });
}

function createSchoolActivityDetailTile(icon, label, value, highlightValue = false) {
    return `
        <div class="tc-detail-tile">
            <div class="tc-detail-tile-icon"><i class="bi bi-${escapeAttribute(icon)}"></i></div>
            <div class="tc-detail-tile-copy">
                <div class="tc-detail-tile-label">${escapeHtml(label)}</div>
                <div class="tc-detail-tile-value${highlightValue ? ' is-highlighted' : ''}">${escapeHtml(value)}</div>
            </div>
        </div>
    `;
}

function renderQuarterLegend(quarters) {
    if (!Array.isArray(quarters) || quarters.length === 0) {
        return '<span><i class="tc-school-legend-swatch" style="background:#ffe4eb;"></i> No quarter periods yet</span>';
    }

    return quarters.slice(0, 4).map((quarter, index) => `
        <span><i class="tc-school-legend-swatch" style="${getQuarterLegendStyle(index)}"></i> ${escapeHtml(quarter.label || buildDefaultQuarterLabel(index))}</span>
    `).join('');
}

function renderSchoolActivitiesPanel(activities, focusedSchoolYear) {
    if (!Array.isArray(activities) || activities.length === 0) {
        return `
            <div class="tc-school-activity-empty">
                <i class="bi bi-calendar-event"></i>
                <div class="fw-semibold mb-1">No school activities yet</div>
                <div class="small mb-3">Create events and important dates for ${escapeHtml(focusedSchoolYear?.school_year || 'this school year')}.</div>
                ${canUseSchoolCalendarPermission('create')
                    ? `<button type="button" class="btn btn-outline-danger tc-school-action-btn" data-school-year-action="open-add-activity">
                        <i class="bi bi-plus-lg"></i> Add Activity
                    </button>`
                    : ''
                }
            </div>
        `;
    }

    return activities.map((activity, index) => `
        <div class="tc-school-quarter-card tc-school-activity-card" data-school-activity-view="${escapeAttribute(activity.school_activity_id)}" role="button" tabindex="0" aria-label="View ${escapeAttribute(activity.activity_title || 'school activity')} details">
            <div class="tc-school-quarter-top">
                <div class="d-flex align-items-center">
                    <span class="tc-school-quarter-index" style="${getActivityIndexStyle(index)}">
                        <i class="bi ${getActivityIcon(activity.activity_title)}"></i>
                    </span>
                    <div>
                        <div class="tc-school-quarter-name">${escapeHtml(activity.activity_title || 'School Activity')}</div>
                        <div class="tc-school-quarter-date-label mt-1">${escapeHtml(activity.activity_notes || 'School activity')}</div>
                    </div>
                </div>
                ${canUseSchoolCalendarPermission('edit')
                    ? `<div class="d-flex gap-2">
                        <button type="button" class="btn btn-sm btn-outline-primary rounded-circle" data-school-year-action="edit-activity" data-school-activity-id="${escapeAttribute(activity.school_activity_id)}" title="Edit activity">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-warning rounded-circle" data-school-year-action="archive-activity" data-school-activity-id="${escapeAttribute(activity.school_activity_id)}" title="Archive activity">
                            <i class="bi bi-archive"></i>
                        </button>
                    </div>`
                    : ''
                }
            </div>
            <div class="tc-school-quarter-date-box">${escapeHtml(formatFullDate(activity.activity_date))}</div>
        </div>
    `).join('');
}

function renderOverviewCalendarGrid(focusedSchoolYear, quarters, viewMonth) {
    const cells = [];
    calendarWeekdayLabels.forEach(label => {
        cells.push(`<div class="tc-school-weekday">${escapeHtml(label)}</div>`);
    });

    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const prevMonthLastDate = new Date(year, month, 0).getDate();

    for (let index = 0; index < 42; index += 1) {
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
        const withinSchoolYear = isDateWithinRange(dateKey, focusedSchoolYear.start_date, focusedSchoolYear.end_date);
        const isSunday = date.getDay() === 0;
        const isSchoolDay = withinSchoolYear && !isSunday;
        const quarterIndex = isSchoolDay ? getQuarterIndexForDate(dateKey, quarters) : -1;
        const classes = [
            'tc-school-day',
            !isCurrentMonth ? 'is-outside' : '',
            !isSchoolDay ? 'is-inactive' : '',
            quarterIndex >= 0 ? `is-q${quarterIndex + 1}` : '',
            isSameDate(date, new Date()) ? 'is-today' : ''
        ].filter(Boolean).join(' ');

        cells.push(`
            <div class="${classes}">
                <div class="tc-school-day-number">${date.getDate()}</div>
            </div>
        `);
    }

    return cells.join('');
}

function formatMonthTitle(value) {
    return value.toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric'
    });
}

function formatCompactDate(value) {
    const date = toLocalDate(value);
    if (!date) return 'Not set';

    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
}

function formatFullDate(value) {
    const date = toLocalDate(value);
    if (!date) return 'Not set';
    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function getInitialOverviewMonth(focusedSchoolYear) {
    const today = new Date();
    const todayKey = formatDateKey(today);

    if (isDateWithinRange(todayKey, focusedSchoolYear.start_date, focusedSchoolYear.end_date)) {
        return new Date(today.getFullYear(), today.getMonth(), 1);
    }

    const startDate = toLocalDate(focusedSchoolYear.start_date);
    return startDate ? new Date(startDate.getFullYear(), startDate.getMonth(), 1) : new Date();
}

function clampMonthToSchoolYear(monthDate, focusedSchoolYear) {
    const startDate = toLocalDate(focusedSchoolYear.start_date);
    const endDate = toLocalDate(focusedSchoolYear.end_date);
    const normalized = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);

    if (!startDate || !endDate) return normalized;

    const startMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

    if (normalized < startMonth) return startMonth;
    if (normalized > endMonth) return endMonth;
    return normalized;
}

function isMonthWithinSchoolYear(monthDate, focusedSchoolYear) {
    const startDate = toLocalDate(focusedSchoolYear.start_date);
    const endDate = toLocalDate(focusedSchoolYear.end_date);
    if (!startDate || !endDate) return true;

    const normalized = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    return normalized >= new Date(startDate.getFullYear(), startDate.getMonth(), 1)
        && normalized <= new Date(endDate.getFullYear(), endDate.getMonth(), 1);
}

function getQuarterIndexForDate(dateKey, quarters) {
    if (!Array.isArray(quarters)) return -1;
    return quarters.findIndex(quarter => isDateWithinRange(dateKey, quarter.start_date, quarter.end_date));
}

function isDateWithinRange(dateKey, start, end) {
    if (!dateKey || !start || !end) return false;
    return dateKey >= start && dateKey <= end;
}

function getQuarterIndexStyle(index) {
    return getQuarterLegendStyle(index).replace('background:', 'background:');
}

function getQuarterLegendStyle(index) {
    return 'background:#ffe4eb;color:#ff4d73;';
}

function getActivityIndexStyle(index) {
    return 'background:#dcfce7;color:#16a34a;';
}

function getActivityIcon(title) {
    const text = String(title || '').toLowerCase();
    if (text.includes('class')) return 'bi-mortarboard';
    if (text.includes('nutrition') || text.includes('food')) return 'bi-cup-hot';
    if (text.includes('break') || text.includes('vacation')) return 'bi-briefcase';
    if (text.includes('christmas') || text.includes('tree')) return 'bi-tree';
    if (text.includes('recognition') || text.includes('award')) return 'bi-award';
    return 'bi-calendar-event';
}

export function setupAddSchoolActivityModal(defaultSchoolYearId = null) {
    if (!guardSchoolCalendarPermission('create', 'You do not have permission to add school activities.')) {
        return;
    }

    const modalEl = document.getElementById('addProgramModal');
    if (!modalEl) return;

    const modal = new bootstrap.Modal(modalEl);
    document.getElementById('dynamicModalLabel').innerText = 'Add School Activity';
    document.getElementById('dynamicForm').innerHTML = getSchoolActivityFormHTML({
        school_year_id: defaultSchoolYearId || schoolCalendarState.focusedSchoolYearId || ''
    });
    document.getElementById('dynamicModalFooter').innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn btn-primary" id="btnSaveSchoolActivity">Save Activity</button>
    `;
    document.getElementById('btnSaveSchoolActivity').onclick = saveSchoolActivity;
    modal.show();
}

function openEditSchoolActivityModal(activityId) {
    if (!guardSchoolCalendarPermission('edit', 'You do not have permission to update school activities.')) {
        return;
    }

    const activity = findSchoolActivityById(activityId);
    if (!activity) return;

    const modalEl = document.getElementById('addProgramModal');
    if (!modalEl) return;

    const modal = new bootstrap.Modal(modalEl);
    document.getElementById('dynamicModalLabel').innerText = 'Edit School Activity';
    document.getElementById('dynamicForm').innerHTML = getSchoolActivityFormHTML(activity);
    document.getElementById('dynamicModalFooter').innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn btn-success" id="btnUpdateSchoolActivity">Update Activity</button>
    `;
    document.getElementById('btnUpdateSchoolActivity').onclick = () => updateSchoolActivity(activityId);
    modal.show();
}

function getSchoolActivityFormHTML(data = {}) {
    const schoolYearId = data.school_year_id || schoolCalendarState.focusedSchoolYearId || '';
    return `
        <div class="row g-3">
            <input type="hidden" id="schoolActivitySchoolYearId" value="${escapeAttribute(schoolYearId)}">
            <div class="col-md-8">
                <label class="form-label">Activity Title</label>
                <input type="text" class="form-control" id="schoolActivityTitle" value="${escapeAttribute(data.activity_title || '')}" placeholder="e.g. Opening of Classes">
            </div>
            <div class="col-md-4">
                <label class="form-label">Activity Date</label>
                <input type="date" class="form-control" id="schoolActivityDate" value="${escapeAttribute(data.activity_date || '')}">
            </div>
            <div class="col-md-12">
                <label class="form-label">Notes</label>
                <textarea class="form-control" id="schoolActivityNotes" rows="3" placeholder="Optional short description">${escapeHtml(data.activity_notes || '')}</textarea>
            </div>
            <div class="col-md-12">
                <label class="form-label">Status</label>
                <select class="form-select" id="schoolActivityStatus">
                    <option value="active" ${data.activity_status === 'inactive' ? '' : 'selected'}>Active</option>
                    <option value="inactive" ${data.activity_status === 'inactive' ? 'selected' : ''}>Inactive</option>
                </select>
            </div>
        </div>
    `;
}

function collectSchoolActivityFormData() {
    const schoolYearId = Number(document.getElementById('schoolActivitySchoolYearId')?.value || 0);
    const activityTitle = document.getElementById('schoolActivityTitle')?.value.trim() || '';
    const activityDate = document.getElementById('schoolActivityDate')?.value || '';
    const activityNotes = document.getElementById('schoolActivityNotes')?.value.trim() || '';
    const activityStatus = document.getElementById('schoolActivityStatus')?.value || 'active';

    if (schoolYearId <= 0) {
        Swal.fire('Validation', 'No school year is selected for this activity.', 'warning');
        return null;
    }

    if (!activityTitle) {
        Swal.fire('Validation', 'Please enter an activity title.', 'warning');
        return null;
    }

    if (!activityDate) {
        Swal.fire('Validation', 'Please enter an activity date.', 'warning');
        return null;
    }

    return {
        school_year_id: schoolYearId,
        activity_title: activityTitle,
        activity_date: activityDate,
        activity_notes: activityNotes,
        activity_status: activityStatus
    };
}

function saveSchoolActivity() {
    if (!guardSchoolCalendarPermission('create', 'You do not have permission to add school activities.')) {
        return;
    }

    const data = collectSchoolActivityFormData();
    if (!data) return;

    const params = new URLSearchParams();
    params.append('operation', 'insertSchoolActivity');
    params.append('json', JSON.stringify(data));

    axios.post('../../api/admin/school_year.php', params)
        .then(res => {
            if (res.data == 1) {
                Swal.fire('Saved', 'School activity added successfully.', 'success');
                bootstrap.Modal.getInstance(document.getElementById('addProgramModal'))?.hide();
                loadSchoolYears();
            } else {
                Swal.fire('Error', res.data?.message || 'Unable to add school activity.', 'error');
            }
        })
        .catch(err => {
            console.error('Error saving school activity:', err);
            Swal.fire('Error', err.response?.data?.message || 'Request failed.', 'error');
        });
}

function updateSchoolActivity(activityId) {
    if (!guardSchoolCalendarPermission('edit', 'You do not have permission to update school activities.')) {
        return;
    }

    const data = collectSchoolActivityFormData();
    if (!data) return;

    data.school_activity_id = activityId;

    const params = new URLSearchParams();
    params.append('operation', 'updateSchoolActivity');
    params.append('json', JSON.stringify(data));

    axios.post('../../api/admin/school_year.php', params)
        .then(res => {
            if (res.data == 1) {
                Swal.fire('Updated', 'School activity updated successfully.', 'success');
                bootstrap.Modal.getInstance(document.getElementById('addProgramModal'))?.hide();
                loadSchoolYears();
            } else {
                Swal.fire('Error', res.data?.message || 'Unable to update school activity.', 'error');
            }
        })
        .catch(err => {
            console.error('Error updating school activity:', err);
            Swal.fire('Error', err.response?.data?.message || 'Request failed.', 'error');
        });
}

function archiveSchoolActivity(activityId) {
    if (!guardSchoolCalendarPermission('edit', 'You do not have permission to update school activities.')) {
        return;
    }

    Swal.fire({
        title: 'Archive this activity?',
        text: 'This school activity will be marked inactive.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Archive',
        confirmButtonColor: '#f59e0b'
    }).then(result => {
        if (!result.isConfirmed) return;

        const params = new URLSearchParams();
        params.append('operation', 'archiveSchoolActivity');
        params.append('json', JSON.stringify({ school_activity_id: activityId }));

        axios.post('../../api/admin/school_year.php', params)
            .then(res => {
                if (res.data == 1) {
                    Swal.fire('Archived', 'School activity marked inactive successfully.', 'success');
                    loadSchoolYears();
                } else {
                    Swal.fire('Error', res.data?.message || 'Unable to archive school activity.', 'error');
                }
            })
            .catch(err => {
                console.error('Error archiving school activity:', err);
                Swal.fire('Error', err.response?.data?.message || 'Request failed.', 'error');
            });
    });
}

function findSchoolActivityById(activityId) {
    for (const schoolYear of schoolYears) {
        const activities = Array.isArray(schoolYear.activities) ? schoolYear.activities : [];
        const found = activities.find(activity => Number(activity.school_activity_id) === Number(activityId));
        if (found) {
            return {
                ...found,
                school_year_id: schoolYear.school_year_id
            };
        }
    }

    return null;
}

function formatDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function isSameDate(firstDate, secondDate) {
    return firstDate.getFullYear() === secondDate.getFullYear()
        && firstDate.getMonth() === secondDate.getMonth()
        && firstDate.getDate() === secondDate.getDate();
}

export function setupAddSchoolYearModal() {
    if (!guardSchoolCalendarPermission('create', 'You do not have permission to add school calendars.')) {
        return;
    }

    const modalEl = document.getElementById('addProgramModal');
    if (!modalEl) return;

    const modal = new bootstrap.Modal(modalEl);
    document.getElementById('dynamicModalLabel').innerText = 'Add School Calendar';
    document.getElementById('dynamicForm').innerHTML = getSchoolYearFormHTML();
    document.getElementById('dynamicModalFooter').innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn btn-primary" id="btnSaveSchoolYear">Save School Calendar</button>
    `;
    document.getElementById('btnSaveSchoolYear').onclick = saveSchoolYear;
    bindSchoolYearHelpers();
    modal.show();
}

export function setupEditSchoolYearStatusModal(schoolYearId = null) {
    if (!guardSchoolCalendarPermission('edit', 'You do not have permission to update school calendar status.')) {
        return;
    }

    const modalEl = document.getElementById('addProgramModal');
    if (!modalEl) return;

    const targetSchoolYear = schoolYears.find(sy => sy.school_year_id == (schoolYearId || schoolCalendarState.focusedSchoolYearId))
        || getFocusedSchoolYear();

    if (!targetSchoolYear) {
        Swal.fire('Unavailable', 'No school year is selected to edit.', 'warning');
        return;
    }

    const modal = new bootstrap.Modal(modalEl);
    document.getElementById('dynamicModalLabel').innerText = 'Edit School Year Status';
    document.getElementById('dynamicForm').innerHTML = `
        <div class="row g-3">
            <div class="col-md-12">
                <label class="form-label">School Year</label>
                <input type="text" class="form-control" value="${escapeAttribute(targetSchoolYear.school_year || 'N/A')}" disabled>
                <input type="hidden" id="schoolYearStatusSchoolYearId" value="${escapeAttribute(targetSchoolYear.school_year_id)}">
            </div>
            <div class="col-md-12">
                <label class="form-label">Status</label>
                <select class="form-select" id="schoolYearStatusOnlyValue">
                    <option value="active" ${targetSchoolYear.sy_status === 'active' ? 'selected' : ''}>Active</option>
                    <option value="inactive" ${targetSchoolYear.sy_status === 'inactive' ? 'selected' : ''}>Inactive</option>
                </select>
                <small class="text-muted">This only updates whether the selected school year is active or inactive.</small>
            </div>
        </div>
    `;
    document.getElementById('dynamicModalFooter').innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn btn-primary" id="btnUpdateSchoolYearStatusOnly">Update Status</button>
    `;
    document.getElementById('btnUpdateSchoolYearStatusOnly').onclick = () => updateSchoolYearStatusOnly(targetSchoolYear.school_year_id);
    modal.show();
}

export function openEditSchoolYearModal(schoolYearId) {
    if (!guardSchoolCalendarPermission('edit', 'You do not have permission to update school calendars.')) {
        return;
    }

    const data = schoolYears.find(sy => sy.school_year_id == schoolYearId);
    if (!data) return;

    const modalEl = document.getElementById('addProgramModal');
    if (!modalEl) return;

    const modal = new bootstrap.Modal(modalEl);
    document.getElementById('dynamicModalLabel').innerText = 'Edit School Calendar';
    document.getElementById('dynamicForm').innerHTML = getSchoolYearFormHTML(data);
    document.getElementById('dynamicModalFooter').innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn btn-success" id="btnUpdateSchoolYear">Update School Calendar</button>
    `;
    document.getElementById('btnUpdateSchoolYear').onclick = () => updateSchoolYear(schoolYearId);
    bindSchoolYearHelpers();
    modal.show();
}

function getSchoolYearFormHTML(data = {}) {
    return `
        <div class="row g-3">
            <div class="col-md-6">
                <label class="form-label">School Year Tag</label>
                <input type="text" class="form-control" id="schoolYearValue" value="${escapeAttribute(data.school_year || '')}" placeholder="e.g. SY 2026-2027">
                <small class="text-muted">This is the label used across enrollment, attendance, and report views.</small>
            </div>
            <div class="col-md-3">
                <label class="form-label">School Start</label>
                <input type="date" class="form-control" id="schoolYearStart" value="${escapeAttribute(data.start_date || '')}" required>
            </div>
            <div class="col-md-3">
                <label class="form-label">School End</label>
                <input type="date" class="form-control" id="schoolYearEnd" value="${escapeAttribute(data.end_date || '')}" required>
            </div>
            <div class="col-md-12">
                <div class="alert alert-light border mb-0">
                    <div class="fw-semibold mb-1">Attendance guide map</div>
                    <small class="text-muted">Weekday counts are generated from these dates so later a section schedule like Mon/Wed/Fri can use this as its attendance baseline. Holidays are not excluded yet.</small>
                </div>
            </div>
            <div class="col-md-12 d-flex justify-content-between align-items-center flex-wrap gap-2">
                <div>
                    <div class="fw-semibold">Quarter periods</div>
                    <small class="text-muted">Add or remove periods depending on how your school year is divided.</small>
                </div>
                <button type="button" class="btn btn-sm btn-outline-primary" id="btnAddQuarterPeriod">
                    <i class="bi bi-plus-lg me-1"></i> Add Quarter
                </button>
            </div>
            <div class="col-md-12">
                <div class="row g-3" id="quarterPeriodsContainer">
                    ${createQuarterCardsHTML(normalizeQuarterArray(data.quarters, data))}
                </div>
            </div>
            <div class="col-md-12">
                <label class="form-label">Status</label>
                <select class="form-select" id="schoolYearStatus">
                    <option value="active" ${data.sy_status === 'active' ? 'selected' : ''}>Active</option>
                    <option value="inactive" ${data.sy_status === 'inactive' || !data.sy_status ? 'selected' : ''}>Inactive</option>
                </select>
            </div>
        </div>
    `;
}

function bindSchoolYearHelpers() {
    const startInput = document.getElementById('schoolYearStart');
    const endInput = document.getElementById('schoolYearEnd');
    const tagInput = document.getElementById('schoolYearValue');
    const addQuarterButton = document.getElementById('btnAddQuarterPeriod');

    const syncSchoolYearLabel = () => {
        if (!tagInput || tagInput.value.trim()) return;
        if (!startInput?.value || !endInput?.value) return;
        tagInput.value = buildSchoolYearLabel(startInput.value, endInput.value);
    };

    startInput?.addEventListener('change', syncSchoolYearLabel);
    endInput?.addEventListener('change', syncSchoolYearLabel);

    addQuarterButton?.addEventListener('click', () => {
        appendQuarterCard();
        refreshQuarterCards();
    });

    document.getElementById('quarterPeriodsContainer')?.addEventListener('click', event => {
        const removeButton = event.target.closest('[data-remove-quarter]');
        if (!removeButton) return;

        const quarterCard = removeButton.closest('[data-quarter-card]');
        quarterCard?.remove();
        refreshQuarterCards();
    });

    refreshQuarterCards();
}

function createQuarterCardsHTML(quarters = []) {
    const safeQuarters = quarters.length > 0 ? quarters : [createEmptyQuarter(0)];
    return safeQuarters.map((quarter, index) => createQuarterCardHTML(quarter, index)).join('');
}

function createQuarterCardHTML(quarter = {}, index = 0) {
    return `
        <div class="col-md-6" data-quarter-card>
            <div class="border rounded p-3 h-100 bg-light">
                <div class="d-flex justify-content-between align-items-start gap-2 mb-3">
                    <div class="fw-semibold" data-quarter-heading>${escapeHtml(buildDefaultQuarterHeading(index))}</div>
                    <button type="button" class="btn btn-sm btn-outline-danger" data-remove-quarter title="Remove quarter">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
                <div class="mb-3">
                    <label class="form-label small">Label</label>
                    <input type="text" class="form-control" data-quarter-label value="${escapeAttribute(quarter.label || buildDefaultQuarterLabel(index))}" placeholder="e.g. 1st Quarter">
                </div>
                <div class="row g-2">
                    <div class="col-sm-6">
                        <label class="form-label small">Start</label>
                        <input type="date" class="form-control" data-quarter-start value="${escapeAttribute(quarter.start_date || '')}" required>
                    </div>
                    <div class="col-sm-6">
                        <label class="form-label small">End</label>
                        <input type="date" class="form-control" data-quarter-end value="${escapeAttribute(quarter.end_date || '')}" required>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function appendQuarterCard() {
    const container = document.getElementById('quarterPeriodsContainer');
    if (!container) return;

    const nextIndex = container.querySelectorAll('[data-quarter-card]').length;
    container.insertAdjacentHTML('beforeend', createQuarterCardHTML(createEmptyQuarter(nextIndex), nextIndex));
}

function refreshQuarterCards() {
    const cards = Array.from(document.querySelectorAll('[data-quarter-card]'));
    cards.forEach((card, index) => {
        const heading = card.querySelector('[data-quarter-heading]');
        const labelInput = card.querySelector('[data-quarter-label]');
        const removeButton = card.querySelector('[data-remove-quarter]');

        if (heading) {
            heading.textContent = buildDefaultQuarterHeading(index);
        }

        if (labelInput && !labelInput.value.trim()) {
            labelInput.value = buildDefaultQuarterLabel(index);
        }

        if (removeButton) {
            removeButton.disabled = cards.length === 1;
        }
    });
}

function saveSchoolYear() {
    if (!guardSchoolCalendarPermission('create', 'You do not have permission to add school calendars.')) {
        return;
    }

    const data = collectSchoolYearFormData();
    if (!data) return;

    const params = new URLSearchParams();
    params.append('operation', 'insertSchoolYear');
    params.append('json', JSON.stringify(data));

    axios.post('../../api/admin/school_year.php', params)
        .then(res => {
            if (res.data == 1) {
                Swal.fire('Saved', 'School calendar added successfully.', 'success');
                bootstrap.Modal.getInstance(document.getElementById('addProgramModal')).hide();
                loadSchoolYears();
            } else {
                Swal.fire('Error', res.data?.message || 'Unable to add school calendar.', 'error');
            }
        })
        .catch(err => {
            console.error('Error saving school year:', err);
            Swal.fire('Error', err.response?.data?.message || 'Request failed.', 'error');
        });
}

function updateSchoolYear(schoolYearId) {
    if (!guardSchoolCalendarPermission('edit', 'You do not have permission to update school calendars.')) {
        return;
    }

    const data = collectSchoolYearFormData();
    if (!data) return;

    data.school_year_id = schoolYearId;

    const params = new URLSearchParams();
    params.append('operation', 'updateSchoolYear');
    params.append('json', JSON.stringify(data));

    axios.post('../../api/admin/school_year.php', params)
        .then(res => {
            if (res.data == 1) {
                Swal.fire('Updated', 'School calendar updated successfully.', 'success');
                bootstrap.Modal.getInstance(document.getElementById('addProgramModal')).hide();
                loadSchoolYears();
            } else {
                Swal.fire('Error', res.data?.message || 'Unable to update school calendar.', 'error');
            }
        })
        .catch(err => {
            console.error('Error updating school year:', err);
            Swal.fire('Error', err.response?.data?.message || 'Request failed.', 'error');
        });
}

function updateSchoolYearStatusOnly(schoolYearId) {
    if (!guardSchoolCalendarPermission('edit', 'You do not have permission to update school calendar status.')) {
        return;
    }

    const existing = schoolYears.find(sy => sy.school_year_id == schoolYearId);
    if (!existing) {
        Swal.fire('Unavailable', 'The selected school year could not be found.', 'warning');
        return;
    }

    const status = document.getElementById('schoolYearStatusOnlyValue')?.value || existing.sy_status || 'inactive';
    const payload = {
        school_year_id: schoolYearId,
        school_year: existing.school_year || '',
        start_date: existing.start_date || '',
        end_date: existing.end_date || '',
        sy_status: status,
        quarters: normalizeQuarterArray(existing.quarters, existing)
    };

    const params = new URLSearchParams();
    params.append('operation', 'updateSchoolYear');
    params.append('json', JSON.stringify(payload));

    axios.post('../../api/admin/school_year.php', params)
        .then(res => {
            if (res.data == 1) {
                Swal.fire('Updated', 'School year status updated successfully.', 'success');
                bootstrap.Modal.getInstance(document.getElementById('addProgramModal'))?.hide();
                loadSchoolYears();
            } else {
                Swal.fire('Error', res.data?.message || 'Unable to update school year status.', 'error');
            }
        })
        .catch(err => {
            console.error('Error updating school year status:', err);
            Swal.fire('Error', err.response?.data?.message || 'Request failed.', 'error');
        });
}

function collectSchoolYearFormData() {
    const schoolYearStart = document.getElementById('schoolYearStart')?.value || '';
    const schoolYearEnd = document.getElementById('schoolYearEnd')?.value || '';
    const enteredLabel = document.getElementById('schoolYearValue')?.value.trim() || '';
    const schoolYearValue = enteredLabel || buildSchoolYearLabel(schoolYearStart, schoolYearEnd);
    const status = document.getElementById('schoolYearStatus')?.value || 'inactive';

    if (!schoolYearStart || !schoolYearEnd) {
        Swal.fire('Validation', 'Please set the school start and end dates.', 'warning');
        return null;
    }

    if (schoolYearStart > schoolYearEnd) {
        Swal.fire('Validation', 'School start date must be before the end date.', 'warning');
        return null;
    }

    if (!schoolYearValue) {
        Swal.fire('Validation', 'Please enter a school year tag or complete the date range.', 'warning');
        return null;
    }

    const quarterCards = Array.from(document.querySelectorAll('[data-quarter-card]'));
    if (quarterCards.length === 0) {
        Swal.fire('Validation', 'Please add at least one quarter period.', 'warning');
        return null;
    }

    const quarters = [];
    let previousQuarterEnd = null;

    for (const [index, card] of quarterCards.entries()) {
        const label = card.querySelector('[data-quarter-label]')?.value.trim() || buildDefaultQuarterLabel(index);
        const start = card.querySelector('[data-quarter-start]')?.value || '';
        const end = card.querySelector('[data-quarter-end]')?.value || '';

        if (!start || !end) {
            Swal.fire('Validation', `${label} needs both a start and end date.`, 'warning');
            return null;
        }

        if (start > end) {
            Swal.fire('Validation', `${label} start date must be before the end date.`, 'warning');
            return null;
        }

        if (start < schoolYearStart || end > schoolYearEnd) {
            Swal.fire('Validation', `${label} must stay inside the school year range.`, 'warning');
            return null;
        }

        if (previousQuarterEnd && start <= previousQuarterEnd) {
            Swal.fire('Validation', `${label} must start after the previous quarter ends.`, 'warning');
            return null;
        }

        quarters.push({
            label,
            start_date: start,
            end_date: end
        });
        previousQuarterEnd = end;
    }

    return {
        school_year: schoolYearValue,
        start_date: schoolYearStart,
        end_date: schoolYearEnd,
        sy_status: status,
        quarters
    };
}

function getGuidePeriods(sy) {
    return [
        { label: 'Whole School Year', start: sy.start_date, end: sy.end_date },
        ...normalizeQuarterArray(sy.quarters, sy).map((quarter, index) => ({
            label: quarter.label || buildDefaultQuarterLabel(index),
            start: quarter.start_date,
            end: quarter.end_date
        }))
    ];
}

function normalizeQuarterArray(quarters, fallbackRecord = {}) {
    if (Array.isArray(quarters) && quarters.length > 0) {
        return quarters
            .filter(item => item && (item.start_date || item.end_date || item.label))
            .map((item, index) => ({
                label: item.label || buildDefaultQuarterLabel(index),
                start_date: item.start_date || '',
                end_date: item.end_date || ''
            }));
    }

    const fallback = [];
    for (let index = 0; index < 4; index += 1) {
        const start = fallbackRecord[`quarter_${index + 1}_start`];
        const end = fallbackRecord[`quarter_${index + 1}_end`];
        if (!start && !end) continue;

        fallback.push({
            label: buildDefaultQuarterLabel(index),
            start_date: start || '',
            end_date: end || ''
        });
    }

    return fallback;
}

function createEmptyQuarter(index = 0) {
    return {
        label: buildDefaultQuarterLabel(index),
        start_date: '',
        end_date: ''
    };
}

function buildDefaultQuarterHeading(index = 0) {
    return `Quarter ${index + 1}`;
}

function buildDefaultQuarterLabel(index = 0) {
    return `${toOrdinal(index + 1)} Quarter`;
}

function toOrdinal(number) {
    const mod10 = number % 10;
    const mod100 = number % 100;
    if (mod10 === 1 && mod100 !== 11) return `${number}st`;
    if (mod10 === 2 && mod100 !== 12) return `${number}nd`;
    if (mod10 === 3 && mod100 !== 13) return `${number}rd`;
    return `${number}th`;
}

function summarizeRange(start, end) {
    if (!start || !end) {
        return { label: 'Not set', totalDays: null };
    }

    const startDate = toLocalDate(start);
    const endDate = toLocalDate(end);
    if (!startDate || !endDate || startDate > endDate) {
        return { label: 'Invalid date range', totalDays: null };
    }

    const totalDays = countSchoolDaysExcludingSunday(startDate, endDate);
    return {
        label: `${formatDateDisplay(start)} - ${formatDateDisplay(end)}`,
        totalDays
    };
}

function getWeekdayOverview(start, end) {
    const weekdayCounts = getWeekdayCounts(start, end);
    if (!weekdayCounts) return 'No range';

    return weekdayDefinitions
        .map(day => `${day.label}:${weekdayCounts[day.key]}`)
        .join(' ');
}

function getWeekdayCounts(start, end) {
    if (!start || !end) return null;

    const startDate = toLocalDate(start);
    const endDate = toLocalDate(end);
    if (!startDate || !endDate || startDate > endDate) return null;

    const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const cursor = new Date(startDate);

    while (cursor <= endDate) {
        const day = cursor.getDay();
        if (day !== 0) {
            counts[day] += 1;
        }
        cursor.setDate(cursor.getDate() + 1);
    }

    return counts;
}

function countSchoolDaysExcludingSunday(startDate, endDate) {
    const cursor = new Date(startDate);
    let total = 0;

    while (cursor <= endDate) {
        if (cursor.getDay() !== 0) {
            total += 1;
        }
        cursor.setDate(cursor.getDate() + 1);
    }

    return total;
}

function buildSchoolYearLabel(start, end) {
    if (!start || !end) return '';
    const startYear = toLocalDate(start)?.getFullYear();
    const endYear = toLocalDate(end)?.getFullYear();
    if (!startYear || !endYear) return '';
    return `SY ${startYear}-${endYear}`;
}

function formatDateDisplay(value) {
    const date = toLocalDate(value);
    if (!date) return 'N/A';
    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function toLocalDate(value) {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
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

window.openEditSchoolYearModal = openEditSchoolYearModal;
