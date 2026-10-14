import { birthdayToday, birthdayPeriod, birthdayRows } from '../utilities/student_birthdays.js';
import { startAutoRefresh } from '../utilities/auto_refresh.js';

export function setupBirthdayCard(card) {
    const periodSelect = card.querySelector('[data-birthday-period]');
    const body = card.querySelector('[data-birthday-rows]');
    const count = card.querySelector('[data-birthday-count]');
    const range = card.querySelector('[data-birthday-range]');
    const centerSelect = card.dataset.centerFilter ? document.getElementById(card.dataset.centerFilter) : null;
    let students = [];
    let loaded = false;
    let failed = false;

    function render() {
        const today = birthdayToday();
        const period = periodSelect.value || 'month';
        const { start, end } = birthdayPeriod(period, today);
        const format = date => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        range.textContent = period === 'year' ? String(today.getFullYear()) : period === 'month'
            ? today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
            : period === 'week' ? `${format(start)} - ${format(end)} (Mon-Sun)` : format(today);
        const center = centerSelect?.value || 'all';
        const scoped = center === 'all' ? students : students.filter(row => String(row.branch_id ?? 'unassigned') === center);
        const rows = birthdayRows(scoped, period, today);
        count.textContent = rows.length.toLocaleString('en-US');
        if (!loaded) {
            body.innerHTML = emptyRow(failed ? 'Birthdays could not be loaded. Please refresh the page.' : 'Loading birthdays...');
            return;
        }
        body.innerHTML = rows.length ? rows.map(row => `<tr>
            <td>${escapeHtml(row.student_name || 'Unnamed Student')}${row.isToday ? '<span class="birthday-today">Today</span>' : ''}</td>
            <td>${escapeHtml(row.birth.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}</td>
            <td>${row.age.toLocaleString('en-US')}</td>
            <td>${escapeHtml([...row.centers].join(', '))}</td>
        </tr>`).join('') : emptyRow('No student birthdays for this period.');
    }

    async function load() {
        try {
            const response = await fetch('../../api/dashboard_birthdays.php', {
                credentials: 'same-origin', headers: { Accept: 'application/json' }
            });
            const payload = await response.json();
            if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'Request failed');
            students = payload.student_birthdays || [];
            loaded = true;
            failed = false;
        } catch (error) {
            console.error('Error loading student birthdays:', error);
            failed = true;
        }
        render();
        if (loaded && failed) range.textContent += ' (Refresh failed; showing last loaded birthdays.)';
    }

    periodSelect.addEventListener('change', render);
    centerSelect?.addEventListener('change', render);
    // Dashboard refreshes may rebuild the center options without emitting a change event.
    if (centerSelect) new MutationObserver(render).observe(centerSelect, { childList: true });
    render();
    startAutoRefresh({ callback: load, intervalMs: 15000, runOnStart: true });
}

function emptyRow(text) { return `<tr><td colspan="4" class="birthday-empty">${text}</td></tr>`; }
function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-student-birthday-card]').forEach(setupBirthdayCard);
});
