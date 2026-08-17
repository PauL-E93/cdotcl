const ENDPOINT = '../../api/secretary/dashboard.php';
const ALL_CENTERS = 'all';
const state = {
    branches: [], centerWorkload: [], employeeSummary: [], enrollmentPipeline: [],
    pendingPayments: [], recentEnrollments: [], summaryAll: {}, todaySchedules: []
};

document.addEventListener('DOMContentLoaded', () => {
    if (!document.querySelector('.secretary-dashboard')) return;
    document.getElementById('secretary-center-filter')?.addEventListener('change', renderAll);
    setupDashboardModals();
    loadDashboard();
});

async function loadDashboard() {
    try {
        const response = await fetch(ENDPOINT, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        const payload = await response.json();
        if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'Request failed');
        state.branches = payload.branches || [];
        state.centerWorkload = payload.center_workload || [];
        state.employeeSummary = payload.employee_summary || [];
        state.enrollmentPipeline = payload.enrollment_pipeline || [];
        state.pendingPayments = payload.pending_payments || [];
        state.pendingPayments = payload.pending_payments || [];
        state.recentEnrollments = payload.recent_enrollments || [];
        state.summaryAll = payload.summary_all || {};
        state.todaySchedules = payload.today_schedules || [];
        populateCenterFilter();
        renderAll();
    } catch (error) {
        console.error('Error loading secretary dashboard:', error);
        document.getElementById('secretary-dashboard-error').textContent = 'Dashboard information could not be loaded. Please refresh the page.';
        renderAll();
    }
}

function populateCenterFilter() {
    const select = document.getElementById('secretary-center-filter');
    select.innerHTML = ['<option value="all">All Centers</option>', ...state.branches.map(branch => `<option value="${escapeHtml(branch.branch_id)}">${escapeHtml(branch.branch_name)}</option>`)].join('');
}

function renderAll() {
    renderSummary();
    renderPipeline();
    renderSchedules();
    renderCenterWorkload();
    renderRecentEnrollments();
    renderPendingPayments();
    renderStaffSummary();
    configureDashboardTriggers();
}

function renderSummary() {
    const selected = selectedCenter();
    const summary = selected === ALL_CENTERS ? state.summaryAll : state.centerWorkload.find(row => centerId(row.branch_id) === selected) || {};
    setText('secretary-pending-applications', formatNumber(summary.pending_applications));
    setText('secretary-today-sessions', formatNumber(summary.today_sessions));
    setText('secretary-pending-payments-total', formatNumber(summary.pending_payments));
    setText('secretary-active-employees', formatNumber(summary.active_employees));
}

function renderPipeline() {
    const rows = filterRows(state.enrollmentPipeline);
    const statuses = ['pending', 'approved', 'enrolled', 'incomplete', 'cancelled'];
    const values = Object.fromEntries(statuses.map(status => [status, rows.filter(row => normalize(row.status) === status).reduce((sum, row) => sum + number(row.total), 0)]));
    const colors = { pending:'#ef6f91', approved:'#348bd4', enrolled:'#4d9d5e', incomplete:'#ffb22d', cancelled:'#d2d7de' };
    const max = Math.max(1, ...Object.values(values));
    document.getElementById('secretary-enrollment-pipeline').innerHTML = statuses.map(status => `<div class="secretary-pipeline-row"><span>${label(status)}</span><div class="secretary-pipeline-bar"><i style="--bar-color:${colors[status]};width:${values[status] / max * 100}%"></i></div><strong>${formatNumber(values[status])}</strong></div>`).join('');
}

function renderSchedules() {
    const rows = filterRows(state.todaySchedules);
    document.getElementById('secretary-today-schedule').innerHTML = rows.slice(0, 7).map(row => `<div class="secretary-list-item"><div class="secretary-list-icon"><i class="bi bi-clock"></i></div><div><strong>${escapeHtml(row.student_name)} - ${escapeHtml(row.program_name)}</strong><small>${escapeHtml(row.teacher_name)} | ${escapeHtml(row.branch_name)}</small></div><div class="secretary-list-value">${time(row.start_time)}<small>${time(row.end_time)}</small></div></div>`).join('') || '<div class="secretary-empty">No tutorial sessions scheduled today.</div>';
}

function renderCenterWorkload() {
    const selected = selectedCenter();
    const rows = selected === ALL_CENTERS ? state.centerWorkload : state.centerWorkload.filter(row => centerId(row.branch_id) === selected);
    document.getElementById('secretary-center-workload').innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeHtml(row.branch_name)}</td><td>${escapeHtml(row.branch_location || 'No location')}</td><td>${formatNumber(row.total_enrollments)}</td><td>${formatNumber(row.pending_applications)}</td><td>${formatNumber(row.today_sessions)}</td><td>${formatNumber(row.active_employees)}</td><td>${formatNumber(row.pending_payments)}</td></tr>`).join('') : emptyRow(7, 'No center workload records available.');
}

function renderRecentEnrollments() {
    const rows = filterRows(state.recentEnrollments).slice(0, 6);
    document.getElementById('secretary-recent-enrollments').innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeHtml(row.student_name)}</td><td>${escapeHtml(row.program_name)}</td><td>${escapeHtml(row.branch_name)}</td><td><span class="secretary-status ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td></tr>`).join('') : emptyRow(4, 'No recent applications available.');
}

function renderPendingPayments() {
    const rows = filterRows(state.pendingPayments);
    setText('secretary-payment-count', formatNumber(rows.length));
    document.getElementById('secretary-pending-payments').innerHTML = rows.slice(0, 5).map(row => `<div class="secretary-list-item"><div class="secretary-list-icon"><i class="bi bi-credit-card"></i></div><div><strong>${escapeHtml(row.student_name)}</strong><small>${escapeHtml(row.branch_name)} | ${escapeHtml(row.billing_type || row.program_name)}</small></div><span class="secretary-list-value">${currency(row.amount_paid)}</span></div>`).join('') || '<div class="secretary-empty">No pending payments need follow-up.</div>';
}

function renderStaffSummary() {
    const rows = filterRows(state.employeeSummary);
    const totals = new Map();
    rows.forEach(row => totals.set(row.role_name, (totals.get(row.role_name) || 0) + number(row.total)));
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    document.getElementById('secretary-staff-summary').innerHTML = sorted.map(([role, total]) => `<div class="secretary-list-item"><div class="secretary-list-icon"><i class="bi bi-person-badge"></i></div><div><strong>${escapeHtml(role)}</strong><small>Active employees</small></div><span class="secretary-list-value">${formatNumber(total)}</span></div>`).join('') || '<div class="secretary-empty">No active employee records available.</div>';
}

function setupDashboardModals() {
    const dashboard = document.querySelector('.secretary-dashboard');
    if (!dashboard) return;

    dashboard.addEventListener('click', event => {
        if (event.target.closest('a,button,select,input')) return;
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
    document.querySelectorAll('.secretary-dashboard [data-dashboard-modal]').forEach(trigger => {
        trigger.setAttribute('role', 'button');
        if (!trigger.hasAttribute('tabindex')) trigger.setAttribute('tabindex', '0');
    });
}

function openDashboardModal(key) {
    const modal = getDashboardModal();
    const content = getDashboardModalContent(key);
    modal.querySelector('.modal-title').innerHTML = content.title;
    modal.querySelector('.modal-body').innerHTML = content.body;

    const link = modal.querySelector('.secretary-modal-link');
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
    let modal = document.getElementById('secretaryDashboardModal');
    if (modal) return modal;

    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="secretaryDashboardModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Dashboard Details</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body"></div>
                    <div class="modal-footer">
                        <a class="btn btn-theme secretary-modal-link d-none" href="#">Open page</a>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        </div>
    `);
    return document.getElementById('secretaryDashboardModal');
}

function getDashboardModalContent(key) {
    const pipelineRows = () => {
        const statuses = ['pending', 'approved', 'enrolled', 'incomplete', 'cancelled'];
        const rows = filterRows(state.enrollmentPipeline);
        return statuses.map(status => ({
            status,
            total: rows.filter(row => normalize(row.status) === status).reduce((sum, row) => sum + number(row.total), 0)
        }));
    };

    const staffRows = () => {
        const totals = new Map();
        filterRows(state.employeeSummary).forEach(row => totals.set(row.role_name, (totals.get(row.role_name) || 0) + number(row.total)));
        return [...totals.entries()].map(([role, total]) => ({ role, total })).sort((a, b) => b.total - a.total);
    };

    const modalMap = {
        'pending-applications': () => ({
            title: '<i class="bi bi-journal-plus me-2"></i>Pending Applications',
            href: 'enrollement.html',
            linkText: 'Manage enrollments',
            body: table(['Student', 'Program', 'Center', 'Date', 'Status'], filterRows(state.recentEnrollments).filter(row => normalize(row.status) === 'pending'), row => [row.student_name, row.program_name, row.branch_name, row.date_created, statusPill(row.status)], 'No pending applications are available.')
        }),
        'today-sessions': () => ({
            title: '<i class="bi bi-calendar-check me-2"></i>Today\'s Sessions',
            href: 'schedule.html',
            linkText: 'Open schedule',
            body: table(['Student', 'Program', 'Teacher', 'Center', 'Time', 'Status'], filterRows(state.todaySchedules), row => [row.student_name, row.program_name, row.teacher_name, row.branch_name, `${time(row.start_time)} - ${time(row.end_time)}`, statusPill(row.status)], 'No tutorial sessions are scheduled today.')
        }),
        'pending-payments': () => ({
            title: '<i class="bi bi-credit-card me-2"></i>Pending Payments',
            href: 'payment.html',
            linkText: 'Open payments',
            body: table(['Student', 'Center', 'Billing', 'Program', 'Date', 'Amount'], filterRows(state.pendingPayments), row => [row.student_name, row.branch_name, row.billing_type, row.program_name, row.payment_date, currency(row.amount_paid)], 'No pending payments need follow-up.')
        }),
        'active-employees': () => ({
            title: '<i class="bi bi-person-badge me-2"></i>Active Employees',
            href: 'employee.html',
            linkText: 'Open employees',
            body: table(['Role', 'Active Employees'], staffRows(), row => [row.role, formatNumber(row.total)], 'No active employee records are available.')
        }),
        'enrollment-pipeline': () => ({
            title: '<i class="bi bi-funnel me-2"></i>Enrollment Pipeline',
            href: 'enrollement.html',
            linkText: 'Manage enrollments',
            body: table(['Status', 'Total'], pipelineRows(), row => [statusPill(row.status), formatNumber(row.total)], 'No enrollment pipeline data is available.')
        }),
        'center-workload': () => ({
            title: '<i class="bi bi-shop-window me-2"></i>Center Workload',
            href: 'center.html',
            linkText: 'Manage centers',
            body: table(['Center', 'Location', 'Enrollments', 'Pending Applications', 'Today\'s Sessions', 'Active Employees', 'Pending Payments'], filterRows(state.centerWorkload), row => [row.branch_name, row.branch_location || 'No location', formatNumber(row.total_enrollments), formatNumber(row.pending_applications), formatNumber(row.today_sessions), formatNumber(row.active_employees), formatNumber(row.pending_payments)], 'No center workload records are available.')
        }),
        'recent-applications': () => ({
            title: '<i class="bi bi-person-plus me-2"></i>Recent Applications',
            href: 'enrollement.html',
            linkText: 'View all',
            body: table(['Student', 'Program', 'Center', 'Date', 'Status'], filterRows(state.recentEnrollments), row => [row.student_name, row.program_name, row.branch_name, row.date_created, statusPill(row.status)], 'No recent applications are available.')
        })
    };

    return (modalMap[key] || modalMap['pending-applications'])();
}

function table(headers, rows, mapRow, emptyText) {
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeRows.length) return `<div class="secretary-empty">${escapeHtml(emptyText)}</div>`;
    return `<div class="secretary-table-wrap"><table class="secretary-table"><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${safeRows.map(row => `<tr>${mapRow(row).map(cell => `<td>${modalCell(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function statusPill(value) {
    return `<span class="secretary-status ${statusClass(value)}">${escapeHtml(value || 'Pending')}</span>`;
}

function modalCell(value) {
    const text = String(value ?? '');
    if (text.startsWith('<span class="secretary-status')) return text;
    return escapeHtml(text);
}

function filterRows(rows) { const selected = selectedCenter(); return selected === ALL_CENTERS ? rows : rows.filter(row => centerId(row.branch_id) === selected); }
function selectedCenter() { return document.getElementById('secretary-center-filter')?.value || ALL_CENTERS; }
function centerId(value) { return value === null || value === undefined || value === '' ? 'unassigned' : String(value); }
function normalize(value) { return String(value || '').trim().toLowerCase(); }
function statusClass(value) { return normalize(value).replace(/[^a-z-]/g, ''); }
function label(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
function number(value) { return Number.parseFloat(value || 0) || 0; }
function formatNumber(value) { return Math.round(number(value)).toLocaleString('en-US'); }
function currency(value) { return `PHP ${number(value).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 })}`; }
function time(value) { if (!value) return 'TBD'; const [hour, minute] = value.split(':').map(Number); return new Date(2000, 0, 1, hour, minute).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' }); }
function setText(id, value) { const element = document.getElementById(id); if (element) element.textContent = String(value); }
function emptyRow(columns, text) { return `<tr><td colspan="${columns}" class="secretary-empty">${escapeHtml(text)}</td></tr>`; }
function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
