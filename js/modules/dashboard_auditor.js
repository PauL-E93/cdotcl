import { startAutoRefresh } from '../utilities/auto_refresh.js';

const ENDPOINT = '../../api/auditor/dashboard.php';
const ALL_BRANCHES = 'all';
const DASHBOARD_REFRESH_MS = 15000;
const state = {
    branches: [], dueToday: [], enrollmentTrend: [], overduePayments: [], paymentOverview: [], paymentTrend: [],
    pendingPayments: [], programSummary: [], recentEnrollments: [],
};

document.addEventListener('DOMContentLoaded', () => {
    if (!document.querySelector('.auditor-dashboard')) return;
    bindEvents();
    setupDashboardModals();
    populateBranchFilter();
    loadDashboard();
    startAutoRefresh({ callback: loadDashboard, intervalMs: DASHBOARD_REFRESH_MS });
});

function bindEvents() {
    document.getElementById('auditor-branch-filter')?.addEventListener('change', renderAll);
    document.getElementById('auditor-payment-period')?.addEventListener('change', renderPaymentOverview);
}

async function loadDashboard() {
    try {
        const response = await fetch(ENDPOINT, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        const payload = await response.json();
        if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'Request failed');
        state.branches = payload.branches || [];
        state.dueToday = payload.due_today || [];
        state.enrollmentTrend = payload.enrollment_trend || [];
        state.overduePayments = payload.overdue_payments || [];
        state.paymentOverview = payload.payment_overview || [];
        state.paymentTrend = payload.payment_trend || [];
        state.pendingPayments = payload.pending_payments || [];
        state.programSummary = payload.program_summary || [];
        state.recentEnrollments = payload.recent_enrollments || [];
        populateBranchFilter();
        renderAll();
    } catch (error) {
        console.error('Error loading auditor dashboard:', error);
        document.getElementById('auditor-dashboard-error').textContent = 'Dashboard information could not be loaded. Please refresh the page.';
        renderAll();
    }
}

function populateBranchFilter() {
    const select = document.getElementById('auditor-branch-filter');
    if (!select) return;
    const hasUnassigned = dataCollections().some(rows => rows.some(row => branchId(row.branch_id) === 'unassigned'));
    const currentValue = select.value || ALL_BRANCHES;
    select.innerHTML = [
        '<option value="all">All Branches</option>',
        ...state.branches.map(branch => `<option value="${escapeHtml(branch.branch_id)}">${escapeHtml(String(branch.branch_name || '').trim())}</option>`),
        hasUnassigned ? '<option value="unassigned">Unassigned Branch</option>' : ''
    ].join('');
    select.value = [...select.options].some(option => option.value === currentValue) ? currentValue : ALL_BRANCHES;
}

function dataCollections() {
    return [state.dueToday, state.overduePayments, state.paymentOverview, state.paymentTrend, state.pendingPayments, state.programSummary, state.recentEnrollments, state.enrollmentTrend];
}

function renderAll() {
    renderSummary('total-payments');
    renderSummary('due-today');
    renderSummary('overdue-payments');
    renderSummary('pending-payments-count');
    renderTrend();
    renderPaymentOverview();
    renderRecentEnrollments();
    renderPendingPayments();
    renderProgramSummary();
    configureDashboardTriggers();
}

function renderSummary(name) {
    if (name === 'due-today') {
        setText('auditor-due-today', formatNumber(filtered(state.dueToday).length));
        return;
    }
    if (name === 'overdue-payments') {
        setText('auditor-overdue-payments-count', formatNumber(filtered(state.overduePayments).length));
        return;
    }
    const rows = filtered(state.paymentOverview);
    if (name === 'total-payments') {
        const total = rows.filter(row => normalizeStatus(row.payment_status) === 'received').reduce((sum, row) => sum + number(row.total_amount), 0);
        setText('auditor-total-payments', currency(total));
        return;
    }
    const count = rows.filter(row => normalizeStatus(row.payment_status) === 'pending').reduce((sum, row) => sum + number(row.payment_count), 0);
    setText('auditor-pending-payments-count', formatNumber(count));
}

function renderTrend() {
    const rows = filtered(state.enrollmentTrend);
    const config = trendConfig('week');
    const totals = aggregateTrend(rows, config.current);
    const previous = aggregateTrend(rows, config.previous);
    document.getElementById('auditor-enrollment-trend').innerHTML = trendChart(config.labels, totals, previous);
}

function trendConfig(period) {
    const today = startOfDay(new Date());
    if (period === 'year') return monthTrendConfig(today);
    const days = period === 'month' ? 30 : 7;
    const current = Array.from({ length: days }, (_, index) => addDays(today, index - days + 1));
    const previous = Array.from({ length: days }, (_, index) => addDays(today, index - (days * 2) + 1));
    return { current, previous, labels: current.map(date => period === 'week' ? date.toLocaleDateString('en-US', { weekday: 'short' }) : `${date.getMonth() + 1}/${date.getDate()}`) };
}

function monthTrendConfig(today) {
    const current = [], previous = [], labels = [];
    for (let offset = 11; offset >= 0; offset--) {
        const date = new Date(today.getFullYear(), today.getMonth() - offset, 1);
        const prior = new Date(date.getFullYear() - 1, date.getMonth(), 1);
        current.push(date); previous.push(prior); labels.push(date.toLocaleDateString('en-US', { month: 'short' }));
    }
    return { current, previous, labels, monthly: true };
}

function aggregateTrend(rows, dates) {
    return dates.map(date => rows.reduce((sum, row) => {
        const value = parseDate(row.enrollment_date);
        const monthly = dates.length === 12;
        const matches = monthly
            ? value.getFullYear() === date.getFullYear() && value.getMonth() === date.getMonth()
            : dateKey(value) === dateKey(date);
        return matches ? sum + number(row.total_enrollments) : sum;
    }, 0));
}

function trendChart(labels, current, previous) {
    const width = 620, height = 190, left = 28, right = 12, top = 14, bottom = 25;
    const max = Math.max(1, ...current, ...previous);
    const x = index => left + (index * (width - left - right) / Math.max(labels.length - 1, 1));
    const y = value => top + ((max - value) * (height - top - bottom) / max);
    const points = values => values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
    const dots = (values, className) => values.map((value, index) => `<circle class="${className}" cx="${x(index)}" cy="${y(value)}" r="3"/>`).join('');
    const grid = [0, .33, .66, 1].map(rate => `<line class="auditor-chart-gridline" x1="${left}" y1="${y(max * rate)}" x2="${width - right}" y2="${y(max * rate)}"/>`).join('');
    return `<div class="auditor-chart-legend"><span><i class="auditor-legend-line" style="background:#ed7894"></i>This Period</span><span><i class="auditor-legend-line" style="background:#c8cdd4"></i>Previous Period</span></div>
        <svg class="auditor-trend-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${grid}
        <polyline class="auditor-chart-line-previous" points="${points(previous)}"/><polyline class="auditor-chart-line-current" points="${points(current)}"/>
        ${dots(previous, 'auditor-chart-dot-previous')}${dots(current, 'auditor-chart-dot-current')}
        ${labels.map((label, index) => `<text class="auditor-chart-axis" x="${x(index)}" y="${height - 6}" text-anchor="middle">${escapeHtml(label)}</text>`).join('')}</svg>`;
}

function renderPaymentOverview() {
    const period = document.getElementById('auditor-payment-period')?.value || 'month';
    const rows = filtered(state.paymentTrend).filter(row => inPeriod(row.payment_date, period));
    const programs = aggregatePrograms(rows, 'total_amount');
    const element = document.getElementById('auditor-payment-overview');
    if (!element) return;
    if (!programs.length) {
        element.innerHTML = '<div class="auditor-empty-row">No program payment data available for this period.</div>';
        return;
    }

    const colors = ['#ed7894', '#348bd4', '#63bf73', '#ffb22d'];
    const total = Math.max(programs.reduce((sum, program) => sum + program.value, 0), 1);
    let cursor = 0;
    const stops = programs.map((program, index) => {
        const start = cursor;
        const end = cursor += program.value / total * 100;
        return `${colors[index % colors.length]} ${start}% ${end}%`;
    }).join(',');

    element.innerHTML = `
        <div class="auditor-donut" style="background:conic-gradient(${stops})"></div>
        <div class="auditor-payment-legend">${programs.map((program, index) => paymentLegend(program.name, program.value, colors[index % colors.length], total)).join('')}</div>`;
}

function paymentLegend(label, value, color, total) {
    return `<div class="auditor-payment-row"><i class="auditor-payment-dot" style="background:${color}"></i><span>${escapeHtml(label)}</span><strong>${currency(value)} (${Math.round(value / total * 100)}%)</strong></div>`;
}

function aggregatePrograms(rows, valueField) {
    return Object.values(rows.reduce((programs, row) => {
        const name = row.program_name || 'Unassigned Program';
        programs[name] ||= { name, value: 0 };
        programs[name].value += number(row[valueField]);
        return programs;
    }, {})).sort((a, b) => b.value - a.value);
}

function renderRecentEnrollments() {
    const rows = filtered(state.recentEnrollments).slice(0, 5);
    document.getElementById('auditor-recent-enrollments').innerHTML = rows.length ? rows.map(row => `<tr>
        <td>#ENR-${escapeHtml(row.enrollment_details_id)}</td><td>${escapeHtml(row.student_name)}</td><td>${escapeHtml(row.program_name || 'N/A')}</td>
        <td>${escapeHtml(row.enrollment_date)}</td><td>${currency(row.amount)}</td><td><span class="auditor-status ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td></tr>`).join('') : emptyRow(6, 'No enrollment records available.');
}

function renderPendingPayments() {
    const rows = filtered(state.pendingPayments).slice(0, 4);
    document.getElementById('auditor-pending-payments').innerHTML = rows.length ? rows.map(row => `<div class="auditor-pending-item">
        <div class="auditor-pending-icon"><i class="bi bi-credit-card"></i></div><div><strong>${escapeHtml(row.student_name)}</strong>
        <small>${escapeHtml(row.program_name || 'Program')} - ${escapeHtml(row.billing_type || 'Payment')} - ${escapeHtml(row.payment_date || 'No date')}</small></div>
        <span class="auditor-pending-amount">${currency(row.amount)}</span></div>`).join('') : '<div class="auditor-empty-row">No pending payments to receive.</div>';
}

function renderProgramSummary() {
    const rows = filtered(state.programSummary);
    const grouped = Object.values(rows.reduce((map, row) => {
        const key = row.program_id; map[key] ||= { name: row.program_name, enrollments: 0, revenue: 0 };
        map[key].enrollments += number(row.total_enrollments); map[key].revenue += number(row.revenue); return map;
    }, {})).sort((a, b) => b.enrollments - a.enrollments).slice(0, 5);
    document.getElementById('auditor-program-summary').innerHTML = grouped.length ? grouped.map(row => `<tr><td>${escapeHtml(row.name)}</td><td>${formatNumber(row.enrollments)}</td><td>${currency(row.revenue)}</td></tr>`).join('') : emptyRow(3, 'No program records available.');
}

function setupDashboardModals() {
    const dashboard = document.querySelector('.auditor-dashboard');
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
    document.querySelectorAll('.auditor-dashboard [data-dashboard-modal]').forEach(trigger => {
        trigger.setAttribute('role', 'button');
        if (!trigger.hasAttribute('tabindex')) trigger.setAttribute('tabindex', '0');
    });
}

function openDashboardModal(key) {
    const modal = getDashboardModal();
    const content = getDashboardModalContent(key);
    modal.querySelector('.modal-title').innerHTML = content.title;
    modal.querySelector('.modal-body').innerHTML = content.body;

    const link = modal.querySelector('.auditor-modal-link');
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
    let modal = document.getElementById('auditorDashboardModal');
    if (modal) return modal;

    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="auditorDashboardModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Dashboard Details</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body"></div>
                    <div class="modal-footer">
                        <a class="btn btn-theme auditor-modal-link d-none" href="#">Open page</a>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        </div>
    `);
    return document.getElementById('auditorDashboardModal');
}

function getDashboardModalContent(key) {
    const modalMap = {
        'due-today': () => ({
            title: '<i class="bi bi-calendar-event-fill me-2"></i>Due Today',
            href: 'payment.html',
            linkText: 'View payments',
            body: table(['Student', 'Program', 'Branch', 'Billing', 'Due Date', 'Amount', 'Status'], filtered(state.dueToday), row => [row.student_name, row.program_name || 'N/A', branchName(row.branch_id), row.billing_type || 'Payment', row.due_date, currency(row.amount), statusPill(row.status)], 'No payments are due today.')
        }),
        'total-payments': () => ({
            title: '<i class="bi bi-credit-card me-2"></i>Total Payments',
            href: 'payment.html',
            linkText: 'View payments',
            body: table(['Branch', 'Status', 'Count', 'Amount'], filtered(state.paymentOverview), row => [branchName(row.branch_id), statusPill(row.payment_status), formatNumber(row.payment_count), currency(row.total_amount)], 'No payment records are available.')
        }),
        'pending-payments-count': () => ({
            title: '<i class="bi bi-flag-fill me-2"></i>Pending Payments',
            href: 'payment.html',
            linkText: 'View pending payments',
            body: table(['Student', 'Program', 'Billing', 'Date', 'Amount', 'Reference'], filtered(state.pendingPayments), row => [row.student_name, row.program_name, row.billing_type, row.payment_date, currency(row.amount), row.reference_no || 'None'], 'No pending payments are available.')
        }),
        'enrollment-trend': () => ({
            title: '<i class="bi bi-graph-up me-2"></i>Enrollment Trend',
            body: table(['Date', 'Branch', 'Enrollments'], filtered(state.enrollmentTrend), row => [row.enrollment_date, branchName(row.branch_id), formatNumber(row.total_enrollments)], 'No trend rows are available.')
        }),
        'payment-overview': () => ({
            title: '<i class="bi bi-pie-chart me-2"></i>Payment Overview',
            href: 'payment.html',
            linkText: 'View payments',
            body: table(['Date', 'Branch', 'Program', 'Received Payments'], filtered(state.paymentTrend).filter(row => inPeriod(row.payment_date, document.getElementById('auditor-payment-period')?.value || 'month')), row => [row.payment_date, branchName(row.branch_id), row.program_name, currency(row.total_amount)], 'No payment overview is available for this period.')
        }),
        'overdue-payments': () => ({
            title: '<i class="bi bi-exclamation-triangle-fill me-2"></i>Overdue Payments',
            href: 'payment.html',
            linkText: 'View payments',
            body: table(['Student', 'Program', 'Branch', 'Billing', 'Due Date', 'Days Overdue', 'Amount', 'Status'], filtered(state.overduePayments), row => [row.student_name, row.program_name || 'N/A', branchName(row.branch_id), row.billing_type || 'Payment', row.due_date, `${formatNumber(row.days_overdue)} day${number(row.days_overdue) === 1 ? '' : 's'}`, currency(row.amount), statusPill('Overdue')], 'No overdue payments are available.')
        }),
        'recent-enrollments': () => ({
            title: '<i class="bi bi-person-plus me-2"></i>Recent Enrollments',
            href: 'enrollement.html',
            linkText: 'View enrollments',
            body: table(['ID', 'Student', 'Program', 'Branch', 'Date', 'Amount', 'Status'], filtered(state.recentEnrollments), row => [`#ENR-${row.enrollment_details_id}`, row.student_name, row.program_name || 'N/A', branchName(row.branch_id), row.enrollment_date, currency(row.amount), statusPill(row.status)], 'No enrollment records are available.')
        }),
        'pending-payments': () => ({
            title: '<i class="bi bi-credit-card me-2"></i>Pending Payments',
            href: 'payment.html',
            linkText: 'View pending payments',
            body: table(['Student', 'Program', 'Billing', 'Date', 'Amount', 'Reference'], filtered(state.pendingPayments), row => [row.student_name, row.program_name, row.billing_type, row.payment_date, currency(row.amount), row.reference_no || 'None'], 'No pending payments are available.')
        }),
        'program-summary': () => ({
            title: '<i class="bi bi-journal-text me-2"></i>Program Summary',
            href: 'program.html',
            linkText: 'View programs',
            body: table(['Program', 'Enrollments', 'Revenue'], groupedPrograms(), row => [row.name, formatNumber(row.enrollments), currency(row.revenue)], 'No program records are available.')
        }),
        
    };
    return (modalMap[key] || modalMap['total-payments'])();
}

function groupedPrograms() {
    const rows = filtered(state.programSummary);
    return Object.values(rows.reduce((map, row) => {
        const key = row.program_id;
        map[key] ||= { name: row.program_name, enrollments: 0, revenue: 0 };
        map[key].enrollments += number(row.total_enrollments);
        map[key].revenue += number(row.revenue);
        return map;
    }, {})).sort((a, b) => b.enrollments - a.enrollments);
}

function table(headers, rows, mapRow, emptyText) {
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeRows.length) return `<div class="auditor-empty-row">${escapeHtml(emptyText)}</div>`;
    return `<div class="auditor-table-wrap"><table class="auditor-table"><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${safeRows.map(row => `<tr>${mapRow(row).map(cell => `<td>${modalCell(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function branchName(id) {
    if (branchId(id) === 'unassigned') return 'Unassigned Branch';
    return state.branches.find(branch => branchId(branch.branch_id) === branchId(id))?.branch_name || `Branch ${id}`;
}

function statusPill(value) {
    return `<span class="auditor-status ${statusClass(value)}">${escapeHtml(value || 'Pending')}</span>`;
}

function modalCell(value) {
    const text = String(value ?? '');
    if (text.startsWith('<span class="auditor-status')) return text;
    return escapeHtml(text);
}

function filtered(rows) { const selected = selectedBranch(); return selected === ALL_BRANCHES ? rows : rows.filter(row => branchId(row.branch_id) === selected); }
function selectedBranch() { return document.getElementById('auditor-branch-filter')?.value || ALL_BRANCHES; }
function branchId(value) { return value === null || value === undefined || value === '' ? 'unassigned' : String(value); }
function normalizeStatus(value) { return String(value || '').trim().toLowerCase(); }
function statusClass(value) { return normalizeStatus(value).replace(/[^a-z-]/g, ''); }
function sumPayments(rows, statuses) { return rows.filter(row => statuses.includes(normalizeStatus(row.payment_status))).reduce((sum, row) => sum + number(row.total_amount), 0); }
function number(value) { return Number.parseFloat(value || 0) || 0; }
function formatNumber(value) { return Math.round(number(value)).toLocaleString('en-US'); }
function currency(value) { return `PHP ${number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function setText(id, value) { const element = document.getElementById(id); if (element) element.textContent = value; }
function emptyRow(columns, text) { return `<tr><td colspan="${columns}" class="auditor-empty-row">${text}</td></tr>`; }
function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function addDays(date, amount) { const copy = new Date(date); copy.setDate(copy.getDate() + amount); return copy; }
function parseDate(value) { const [year, month, day] = String(value).split('-').map(Number); return new Date(year, month - 1, day); }
function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function inPeriod(value, period) { const date = parseDate(value); const today = startOfDay(new Date()); if (period === 'day') return dateKey(date) === dateKey(today); const days = period === 'month' ? 30 : 7; return date >= addDays(today, -days + 1); }
function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
