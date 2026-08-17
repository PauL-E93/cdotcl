const SCHOOL_YEAR_OVERVIEW_API_URL = '../../api/admin/school_year.php';
import { canUseSchoolCalendarPermission, guardSchoolCalendarPermission } from './school_calendar_rbac.js';

const schoolYearOverviewState = {
    cache: new Map(),
    monthBySchoolYear: new Map(),
    stylesInjected: false,
    modalInjected: false
};

const overviewWeekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function renderSchoolYearOverviewPanel({ root, schoolYear, onEditCalendar } = {}) {
    if (!root) return;

    ensureOverviewStyles();
    ensureOverviewModal();

    if (!schoolYear?.school_year_id) {
        root.innerHTML = '<div class="text-muted text-center py-4">No school year selected.</div>';
        return;
    }

    root.innerHTML = '<div class="text-muted text-center py-4">Loading school year overview...</div>';

    try {
        const overviewPayload = await fetchSchoolYearOverview(schoolYear.school_year_id);
        const resolvedSchoolYear = {
            ...(overviewPayload.school_year || {}),
            ...schoolYear,
            activities: Array.isArray(schoolYear.activities) ? schoolYear.activities : (overviewPayload.school_year?.activities || [])
        };
        const sections = Array.isArray(overviewPayload.sections) ? overviewPayload.sections : [];
        const viewMonth = getActiveOverviewMonth(resolvedSchoolYear);

        root.innerHTML = buildOverviewMarkup(resolvedSchoolYear, sections, viewMonth);
        bindOverviewRootEvents(root, resolvedSchoolYear, sections, onEditCalendar);
    } catch (error) {
        console.error('Error loading school year overview:', error);
        root.innerHTML = '<div class="text-danger text-center py-4">Failed to load school year overview.</div>';
    }
}

async function fetchSchoolYearOverview(schoolYearId) {
    const cacheKey = String(schoolYearId);
    if (schoolYearOverviewState.cache.has(cacheKey)) {
        return schoolYearOverviewState.cache.get(cacheKey);
    }

    const res = await axios.get(SCHOOL_YEAR_OVERVIEW_API_URL, {
        params: {
            operation: 'getSchoolYearOverview',
            school_year_id: schoolYearId
        }
    });

    if (res.data?.status !== 'success') {
        throw new Error(res.data?.message || 'Unable to load school year overview.');
    }

    const payload = res.data.data || {};
    schoolYearOverviewState.cache.set(cacheKey, payload);
    return payload;
}

function bindOverviewRootEvents(root, schoolYear, sections, onEditCalendar) {
    root.onclick = event => {
        const navButton = event.target.closest('[data-overview-nav]');
        if (navButton) {
            const action = navButton.getAttribute('data-overview-nav');
            const currentMonth = getActiveOverviewMonth(schoolYear);
            let nextMonth = currentMonth;

            if (action === 'prev') {
                nextMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
            } else if (action === 'next') {
                nextMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
            }

            schoolYearOverviewState.monthBySchoolYear.set(String(schoolYear.school_year_id), clampMonthToSchoolYear(nextMonth, schoolYear));
            renderSchoolYearOverviewPanel({ root, schoolYear, onEditCalendar });
            return;
        }

        const editButton = event.target.closest('[data-overview-action="edit-calendar"]');
        if (editButton) {
            if (!guardSchoolCalendarPermission('edit', 'You do not have permission to update school calendars.')) {
                return;
            }
            onEditCalendar?.();
            return;
        }

        const dayButton = event.target.closest('[data-overview-date]');
        if (dayButton) {
            const dateKey = dayButton.getAttribute('data-overview-date');
            openOverviewDetailModal(schoolYear, sections, dateKey);
        }
    };
}

function buildOverviewMarkup(schoolYear, sections, viewMonth) {
    const quarters = normalizeQuarterArray(schoolYear.quarters, schoolYear);

    return `
        <div class="tc-school-card-header">
            <div>
                <h3 class="tc-school-card-title">School Year Overview</h3>
                <p class="tc-school-card-copy">${escapeHtml(schoolYear.school_year || 'Selected school year')} overview calendar</p>
            </div>
            ${canUseSchoolCalendarPermission('edit')
                ? `<button type="button" class="btn btn-outline-danger rounded-pill px-3" data-overview-action="edit-calendar">
                    <i class="bi bi-pencil-square me-1"></i> Edit Calendar
                </button>`
                : ''
            }
        </div>
        <div class="tc-school-overview-nav">
            <div class="tc-school-overview-nav-main">
                <button type="button" class="tc-school-nav-btn" data-overview-nav="prev" aria-label="Previous month">
                    <i class="bi bi-chevron-left"></i>
                </button>
                <div class="tc-school-month-label">${escapeHtml(formatMonthTitle(viewMonth))}</div>
                <button type="button" class="tc-school-nav-btn" data-overview-nav="next" aria-label="Next month">
                    <i class="bi bi-chevron-right"></i>
                </button>
            </div>
        </div>
        <div class="tc-school-overview-grid tc-school-overview-grid--interactive">
            ${renderOverviewCalendarGrid(schoolYear, sections, quarters, viewMonth)}
        </div>
        <div class="tc-school-overview-legend">
            ${renderQuarterLegend(quarters)}
            <span><i class="tc-school-legend-swatch" style="background:#f8fafc;"></i> Inactive</span>
            <span><i class="tc-school-legend-swatch" style="background:#ffe4eb;"></i> Section schedule</span>
            <span><i class="tc-school-legend-swatch" style="background:#dcfce7;"></i> School activity</span>
        </div>
    `;
}

function renderOverviewCalendarGrid(schoolYear, sections, quarters, viewMonth) {
    const cells = [];
    overviewWeekdayLabels.forEach(label => {
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
        const withinSchoolYear = isDateWithinRange(dateKey, schoolYear.start_date, schoolYear.end_date);
        const isSunday = date.getDay() === 0;
        const isSchoolDay = withinSchoolYear && !isSunday;
        const quarterIndex = isSchoolDay ? getQuarterIndexForDate(dateKey, quarters) : -1;
        const dayActivities = isCurrentMonth ? getActivitiesForDate(dateKey, schoolYear.activities || []) : [];
        const daySchedules = isCurrentMonth ? getSectionsForDate(date, sections, schoolYear) : [];
        const hasData = dayActivities.length > 0 || daySchedules.length > 0;

        const classes = [
            'tc-school-day',
            !isCurrentMonth ? 'is-outside' : '',
            !isSchoolDay ? 'is-inactive' : '',
            quarterIndex >= 0 ? `is-q${quarterIndex + 1}` : '',
            isSameDate(date, new Date()) ? 'is-today' : '',
            hasData ? 'has-detail' : ''
        ].filter(Boolean).join(' ');

        const markerHtml = hasData ? `
            <div class="tc-school-overview-markers">
                ${daySchedules.length > 0 ? `<span class="tc-school-overview-marker is-schedule" title="${escapeAttribute(`${daySchedules.length} section schedule${daySchedules.length === 1 ? '' : 's'}`)}"><i class="bi bi-collection-play-fill"></i>${daySchedules.length}</span>` : ''}
                ${dayActivities.length > 0 ? `<span class="tc-school-overview-marker is-activity" title="${escapeAttribute(`${dayActivities.length} school activit${dayActivities.length === 1 ? 'y' : 'ies'}`)}"><i class="bi bi-calendar-event-fill"></i>${dayActivities.length}</span>` : ''}
            </div>
        ` : '';

        if (!isCurrentMonth) {
            cells.push(`
                <div class="${classes}">
                    <div class="tc-school-day-number">${date.getDate()}</div>
                </div>
            `);
            continue;
        }

        cells.push(`
            <button type="button" class="${classes}" data-overview-date="${escapeAttribute(dateKey)}">
                <div class="tc-school-day-number">${date.getDate()}</div>
                ${markerHtml}
            </button>
        `);
    }

    return cells.join('');
}

function openOverviewDetailModal(schoolYear, sections, dateKey) {
    const modalEl = document.getElementById('schoolYearOverviewDetailModal');
    const titleEl = document.getElementById('schoolYearOverviewDetailTitle');
    const bodyEl = document.getElementById('schoolYearOverviewDetailBody');
    if (!modalEl || !titleEl || !bodyEl) return;

    const date = toLocalDate(dateKey);
    const activities = getActivitiesForDate(dateKey, schoolYear.activities || []);
    const sectionSchedules = getSectionsForDate(date, sections, schoolYear);
    const isSunday = date ? date.getDay() === 0 : false;
    const withinSchoolYear = isDateWithinRange(dateKey, schoolYear.start_date, schoolYear.end_date);

    titleEl.textContent = formatFullDate(dateKey);
    bodyEl.innerHTML = `
        <div class="mb-3">
            <div class="small text-uppercase text-muted fw-semibold mb-2">School Day Status</div>
            <div class="tc-overview-detail-status">
                ${withinSchoolYear ? (isSunday ? 'Sunday is excluded from school days.' : 'Inside school year calendar.') : 'Outside of the selected school year range.'}
            </div>
        </div>
        <div class="mb-4">
            <div class="d-flex justify-content-between align-items-center mb-2">
                <div class="fw-bold">School Activities</div>
                <span class="badge bg-danger-subtle text-danger-emphasis">${activities.length}</span>
            </div>
            ${activities.length === 0 ? '<div class="text-muted small">No school activities for this date.</div>' : activities.map(activity => `
                <div class="tc-overview-detail-item is-activity">
                    <div class="fw-semibold">${escapeHtml(activity.activity_title || 'School Activity')}</div>
                    <div class="small text-muted">${escapeHtml(activity.activity_notes || 'No additional notes')}</div>
                </div>
            `).join('')}
        </div>
        <div>
            <div class="d-flex justify-content-between align-items-center mb-2">
                <div class="fw-bold">Section Schedules</div>
                <span class="badge bg-primary-subtle text-primary-emphasis">${sectionSchedules.length}</span>
            </div>
            ${sectionSchedules.length === 0 ? '<div class="text-muted small">No section schedules for this date.</div>' : sectionSchedules.map(section => `
                <div class="tc-overview-detail-item is-schedule">
                    <div class="fw-semibold">${escapeHtml(section.program_name || 'Program')} - ${escapeHtml(section.section_name || 'Section')}</div>
                    <div class="small text-muted">${escapeHtml(section.branch_name || 'Branch')} | ${escapeHtml(section.teacher_name || 'No teacher assigned')}</div>
                    <div class="small mt-1">${section.time_ranges.map(time => `<span class="tc-overview-time-pill">${escapeHtml(time)}</span>`).join(' ')}</div>
                </div>
            `).join('')}
        </div>
    `;

    bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function getSectionsForDate(date, sections, schoolYear) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return [];

    const dateKey = formatDateKey(date);
    if (!isDateWithinRange(dateKey, schoolYear.start_date, schoolYear.end_date) || date.getDay() === 0) {
        return [];
    }

    const weekday = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    return (Array.isArray(sections) ? sections : []).map(section => {
        const matches = (section.schedules || []).filter(schedule => String(schedule.day_of_week || '').trim().toLowerCase() === weekday);
        if (matches.length === 0) return null;

        return {
            ...section,
            time_ranges: matches.map(schedule => formatTimeRange(schedule.start_time, schedule.end_time))
        };
    }).filter(Boolean);
}

function getActivitiesForDate(dateKey, activities) {
    return (Array.isArray(activities) ? activities : []).filter(activity => activity.activity_date === dateKey);
}

function getActiveOverviewMonth(schoolYear) {
    const cacheKey = String(schoolYear.school_year_id);
    const cachedMonth = schoolYearOverviewState.monthBySchoolYear.get(cacheKey);
    if (cachedMonth && isMonthWithinSchoolYear(cachedMonth, schoolYear)) {
        return cachedMonth;
    }

    const initial = getInitialOverviewMonth(schoolYear);
    schoolYearOverviewState.monthBySchoolYear.set(cacheKey, initial);
    return initial;
}

function getInitialOverviewMonth(schoolYear) {
    const today = new Date();
    const todayKey = formatDateKey(today);
    if (isDateWithinRange(todayKey, schoolYear.start_date, schoolYear.end_date)) {
        return new Date(today.getFullYear(), today.getMonth(), 1);
    }

    const startDate = toLocalDate(schoolYear.start_date);
    return startDate ? new Date(startDate.getFullYear(), startDate.getMonth(), 1) : new Date();
}

function clampMonthToSchoolYear(monthDate, schoolYear) {
    const startDate = toLocalDate(schoolYear.start_date);
    const endDate = toLocalDate(schoolYear.end_date);
    const normalized = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);

    if (!startDate || !endDate) return normalized;

    const startMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

    if (normalized < startMonth) return startMonth;
    if (normalized > endMonth) return endMonth;
    return normalized;
}

function isMonthWithinSchoolYear(monthDate, schoolYear) {
    const startDate = toLocalDate(schoolYear.start_date);
    const endDate = toLocalDate(schoolYear.end_date);
    if (!startDate || !endDate) return true;

    const normalized = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    return normalized >= new Date(startDate.getFullYear(), startDate.getMonth(), 1)
        && normalized <= new Date(endDate.getFullYear(), endDate.getMonth(), 1);
}

function renderQuarterLegend(quarters) {
    if (!Array.isArray(quarters) || quarters.length === 0) {
        return '<span><i class="tc-school-legend-swatch" style="background:#ffe4eb;"></i> No quarter periods yet</span>';
    }

    return quarters.slice(0, 4).map((quarter, index) => `
        <span><i class="tc-school-legend-swatch" style="${getQuarterLegendStyle(index)}"></i> ${escapeHtml(quarter.label || buildDefaultQuarterLabel(index))}</span>
    `).join('');
}

function ensureOverviewStyles() {
    if (schoolYearOverviewState.stylesInjected) return;

    const style = document.createElement('style');
    style.id = 'schoolYearOverviewStyles';
    style.textContent = `
        .tc-school-overview-grid--interactive .tc-school-day.has-detail { box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.12); }
        .tc-school-overview-grid--interactive button.tc-school-day { text-align: left; }
        .tc-school-overview-markers { display: flex; flex-wrap: wrap; gap: 0.2rem; margin-top: 0.3rem; }
        .tc-school-overview-marker { display: inline-flex; align-items: center; gap: 0.18rem; border-radius: 999px; padding: 0.1rem 0.28rem; font-size: 0.52rem; font-weight: 700; }
        .tc-school-overview-marker.is-schedule { background: #ffe4eb; color: #ff4d73; }
        .tc-school-overview-marker.is-activity { background: #dcfce7; color: #16a34a; }
        .tc-overview-detail-status { border: 1px solid #e2e8f0; background: #f8fafc; color: #334155; border-radius: 12px; padding: 0.65rem 0.75rem; font-size: 0.9rem; }
        .tc-overview-detail-item { border: 1px solid #e2e8f0; border-radius: 12px; padding: 0.7rem 0.8rem; margin-bottom: 0.55rem; background: #fff; }
        .tc-overview-detail-item.is-activity { border-left: 4px solid #16a34a; }
        .tc-overview-detail-item.is-schedule { border-left: 4px solid #ff4d73; }
        .tc-overview-time-pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 0.15rem 0.38rem; background: #ffe4eb; color: #ff4d73; font-size: 0.62rem; font-weight: 700; margin-right: 0.3rem; margin-top: 0.18rem; }
    `;
    document.head.appendChild(style);
    schoolYearOverviewState.stylesInjected = true;
}

function ensureOverviewModal() {
    if (schoolYearOverviewState.modalInjected) return;

    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="schoolYearOverviewDetailModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="schoolYearOverviewDetailTitle">Overview Details</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body" id="schoolYearOverviewDetailBody"></div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        </div>
    `);

    schoolYearOverviewState.modalInjected = true;
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

function getQuarterIndexForDate(dateKey, quarters) {
    if (!Array.isArray(quarters)) return -1;
    return quarters.findIndex(quarter => isDateWithinRange(dateKey, quarter.start_date, quarter.end_date));
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

function getQuarterLegendStyle(index) {
    const palette = [
        'background:#ffe4eb;color:#ff4d73;',
        'background:#ffeec9;color:#c97a00;',
        'background:#ece5ff;color:#7c3aed;',
        'background:#ddf5e5;color:#15803d;'
    ];
    return palette[index % palette.length];
}

function formatMonthTitle(value) {
    return value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function formatFullDate(value) {
    const date = toLocalDate(value);
    if (!date) return 'Not set';
    return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTimeRange(startTime, endTime) {
    const start = formatTime(startTime);
    const end = formatTime(endTime);
    if (!start && !end) return 'Time not set';
    if (!end) return start;
    if (!start) return end;
    return `${start} - ${end}`;
}

function formatTime(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const [hourString = '0', minuteString = '0'] = raw.split(':');
    const hour = Number(hourString);
    const minute = Number(minuteString);
    if (Number.isNaN(hour) || Number.isNaN(minute)) return raw;
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const normalizedHour = hour % 12 || 12;
    return `${normalizedHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function isDateWithinRange(dateKey, start, end) {
    if (!dateKey || !start || !end) return false;
    return dateKey >= start && dateKey <= end;
}

function formatDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function toLocalDate(value) {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function isSameDate(firstDate, secondDate) {
    return firstDate.getFullYear() === secondDate.getFullYear()
        && firstDate.getMonth() === secondDate.getMonth()
        && firstDate.getDate() === secondDate.getDate();
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
