import { startAutoRefresh } from '../utilities/auto_refresh.js';

const ENDPOINT = '../../api/owner/dashboard.php';
const ALL_CENTERS = 'all';
const DASHBOARD_REFRESH_MS = 15000;
const state = {
    branchPerformance: [], branches: [], enrollmentTrend: [], programEnrollments: [], paymentTrend: [],
    paymentOverview: [], pendingPayments: [], recentEmployees: [], recentEnrollments: [],
    summaryAll: {}
};

document.addEventListener('DOMContentLoaded', () => {
    if (!document.querySelector('.owner-dashboard')) return;
    document.getElementById('owner-branch-filter')?.addEventListener('change', renderAll);
    document.getElementById('owner-trend-period')?.addEventListener('change', renderTrend);
    document.getElementById('owner-program-period')?.addEventListener('change', renderProgramEnrollments);
    document.getElementById('owner-payment-period')?.addEventListener('change', renderPaymentOverview);
    document.getElementById('owner-center-period')?.addEventListener('change', renderBranchPerformance);
    setupDashboardModals();
    loadDashboard();
    startAutoRefresh({ callback: loadDashboard, intervalMs: DASHBOARD_REFRESH_MS });
});

async function loadDashboard() {
    try {
        const response = await fetch(ENDPOINT, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        const payload = await response.json();
        if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'Request failed');
        state.branchPerformance = payload.branch_performance || [];
        state.branches = payload.branches || [];
        state.enrollmentTrend = payload.enrollment_trend || [];
        state.programEnrollments = payload.program_enrollments || [];
        state.paymentTrend = payload.payment_trend || [];
        state.lowStockProducts = payload.low_stock_products || [];
        state.paymentOverview = payload.payment_overview || [];
        state.pendingPayments = payload.pending_payments || [];
        state.recentEmployees = payload.recent_employees || [];
        state.recentEnrollments = payload.recent_enrollments || [];
        state.summaryAll = payload.summary_all || {};
        populateBranchFilter();
        renderAll();
    } catch (error) {
        console.error('Error loading owner dashboard:', error);
        document.getElementById('owner-dashboard-error').textContent = 'Dashboard information could not be loaded. Please refresh the page.';
        renderAll();
    }
}

function populateBranchFilter() {
    const select = document.getElementById('owner-branch-filter');
    if (!select) return;
    const hasUnassigned = [state.paymentOverview, state.pendingPayments, state.recentEmployees, state.recentEnrollments, state.enrollmentTrend]
        .some(rows => rows.some(row => branchId(row.branch_id) === 'unassigned'));
    select.innerHTML = ['<option value="all">All Centers</option>',
        ...state.branches.map(branch => `<option value="${escapeHtml(branch.branch_id)}">${escapeHtml(String(branch.branch_name || '').trim())}</option>`),
        hasUnassigned ? '<option value="unassigned">Unassigned Center</option>' : ''
    ].join('');
}

function renderAll() {
    renderSummary();
    renderTrend();
    renderProgramEnrollments();
    renderPaymentOverview();
    renderBranchPerformance();
    renderRecentEnrollments();
    renderPendingPayments();
    configureDashboardTriggers();
}

function renderSummary() {
    const selected = selectedBranch();
    const summary = selected === ALL_CENTERS ? state.summaryAll : selectedBranchSummary(selected);
    setText('owner-total-enrollments', formatNumber(summary.total_enrollments));
    setText('owner-received-revenue', currency(summary.received_revenue));
}

function selectedBranchSummary(selected) {
    if (selected === 'unassigned') {
        return {
            total_enrollments: filterRows(state.recentEnrollments).length,
            received_revenue: sumPayments(filterRows(state.paymentOverview), ['received']),
            active_employees: filterRows(state.recentEmployees).filter(row => normalizeStatus(row.status) === 'active').length
        };
    }
    return state.branchPerformance.find(row => branchId(row.branch_id) === selected) || {};
}

function renderTrend() {
    const rows = filterRows(state.programEnrollments);
    const days = document.getElementById('owner-trend-period')?.value === 'month' ? 30 : 7;
    const period = document.getElementById('owner-trend-period')?.value || 'week';
    const dates = period === 'year' ? yearMonths() : Array.from({ length: days }, (_, index) => addDays(new Date(), index - days + 1));
    const programs = [...new Set(rows.map(row => row.program_name || 'Unassigned Program'))];
    const series = programs.map(name => ({
        name,
        values: dates.map(date => rows.reduce((sum, row) => {
        const rowDate = parseDate(row.enrollment_date);
        const matches = period === 'year'
            ? rowDate.getFullYear() === date.getFullYear() && rowDate.getMonth() === date.getMonth()
            : dateKey(rowDate) === dateKey(date);
            return matches && (row.program_name || 'Unassigned Program') === name ? sum + number(row.total_enrollments) : sum;
        }, 0))
    }));
    const labels = dates.map(date => period === 'year' ? date.toLocaleDateString('en-US', { month: 'short' }) : `${date.getMonth() + 1}/${date.getDate()}`);
    document.getElementById('owner-enrollment-trend').innerHTML = multiLineChart(labels, series);
}

function multiLineChart(labels, series) {
    if (!series.length) return '<div class="owner-empty">No enrollment activity records available.</div>';
    const width = 620, height = 190, left = 38, right = 12, top = 14, bottom = 24;
    const colors = ['#ef6f91', '#348bd4', '#63bf73', '#ff812c'];
    const max = Math.max(1, ...series.flatMap(item => item.values));
    const x = index => left + index * (width - left - right) / Math.max(labels.length - 1, 1);
    const y = value => top + (max - value) * (height - top - bottom) / max;
    const rates = [0, .33, .66, 1];
    const grid = rates.map(rate => `<line class="owner-gridline" x1="${left}" y1="${y(max * rate)}" x2="${width - right}" y2="${y(max * rate)}"/><text class="owner-chart-axis" x="${left - 6}" y="${y(max * rate) + 3}" text-anchor="end">${Math.round(max * rate)}</text>`).join('');
    const lines = series.map((item, index) => `<polyline class="owner-chart-line" style="stroke:${colors[index % colors.length]}" points="${item.values.map((value, point) => `${x(point)},${y(value)}`).join(' ')}"/>${item.values.map((value, point) => `<circle class="owner-chart-dot" style="fill:${colors[index % colors.length]}" cx="${x(point)}" cy="${y(value)}" r="4" tabindex="0"><title>${escapeHtml(`${item.name} — ${labels[point]}: ${formatNumber(value)} enrollment${value === 1 ? '' : 's'}`)}</title></circle>`).join('')}`).join('');
    const legend = series.map((item, index) => `<span class="owner-trend-legend-item"><i style="background:${colors[index % colors.length]}"></i>${escapeHtml(item.name)}</span>`).join('');
    return `<svg class="owner-trend-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${grid}${lines}${labels.map((label, index) => `<text class="owner-chart-axis" x="${x(index)}" y="${height - 5}" text-anchor="middle">${escapeHtml(label)}</text>`).join('')}</svg><div class="owner-trend-legend">${legend}</div>`;
}

function renderPaymentOverview() {
    const period = document.getElementById('owner-payment-period')?.value || 'month';
    const rows = filterRows(state.paymentTrend).filter(row => inPeriod(row.payment_date, period));
    const programs = aggregatePrograms(rows, 'total_amount');
    renderProgramDonut('owner-payment-overview', programs, true);
}

function renderProgramEnrollments() {
    const period = document.getElementById('owner-program-period')?.value || 'month';
    const rows = filterRows(state.programEnrollments).filter(row => inPeriod(row.enrollment_date, period));
    renderProgramDonut('owner-program-enrollments', aggregatePrograms(rows, 'total_enrollments'), false);
}

function aggregatePrograms(rows, valueField) {
    return Object.values(rows.reduce((programs, row) => {
        const name = row.program_name || 'Unassigned Program';
        programs[name] ||= { name, value: 0 };
        programs[name].value += number(row[valueField]);
        return programs;
    }, {})).sort((a, b) => b.value - a.value);
}

function renderProgramDonut(id, programs, money) {
    const element = document.getElementById(id);
    if (!element) return;
    if (!programs.length) { element.innerHTML = '<div class="owner-empty">No program data available for this period.</div>'; return; }
    const colors = ['#ef6f91', '#348bd4', '#63bf73', '#ffb22d'];
    const total = Math.max(programs.reduce((sum, program) => sum + program.value, 0), 1);
    let cursor = 0;
    const stops = programs.map((program, index) => {
        const start = cursor, end = cursor += program.value / total * 100;
        return `${colors[index % colors.length]} ${start}% ${end}%`;
    }).join(',');
    element.innerHTML = `<div class="owner-donut" style="background:conic-gradient(${stops})"></div><div class="owner-payment-legend">${programs.map((program, index) => `<div class="owner-payment-row"><i class="owner-payment-dot" style="background:${colors[index % colors.length]}"></i><span>${escapeHtml(program.name)}</span><strong>${money ? currency(program.value) : formatNumber(program.value)} (${Math.round(program.value / total * 100)}%)</strong></div>`).join('')}</div>`;
}

function renderBranchPerformance() {
    const selected = selectedBranch();
    const rows = selected === ALL_CENTERS ? state.branchPerformance : state.branchPerformance.filter(row => branchId(row.branch_id) === selected);
    const period = document.getElementById('owner-center-period')?.value || 'month';
    const enrollmentRows = filterRows(state.enrollmentTrend).filter(row => inPeriod(row.enrollment_date, period));
    const paymentRows = filterRows(state.paymentTrend).filter(row => inPeriod(row.payment_date, period));
    document.getElementById('owner-branch-performance').innerHTML = rows.length ? rows.map(row => {
        const branch = branchId(row.branch_id);
        const enrollments = enrollmentRows.filter(item => branchId(item.branch_id) === branch).reduce((sum, item) => sum + number(item.total_enrollments), 0);
        const revenue = paymentRows.filter(item => branchId(item.branch_id) === branch).reduce((sum, item) => sum + number(item.total_amount), 0);
        return `<tr><td>${escapeHtml(row.branch_name)}</td><td>${escapeHtml(row.branch_location || 'No location')}</td><td>${formatNumber(enrollments)}</td><td>${currency(revenue)}</td><td>${formatNumber(row.active_employees)}</td><td>${formatNumber(row.active_classes)}</td><td>${formatNumber(row.pending_payments)}</td></tr>`;
    }).join('') : emptyRow(7, 'No center performance records available.');
}

function renderRecentEnrollments() {
    const rows = filterRows(state.recentEnrollments).slice(0, 5);
    document.getElementById('owner-recent-enrollments').innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeHtml(row.student_name)}</td><td>${escapeHtml(row.program_name || 'N/A')}</td><td>${escapeHtml(row.branch_name)}</td><td><span class="owner-status ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td></tr>`).join('') : emptyRow(4, 'No enrollment records available.');
}

function renderPendingPayments() {
    const allRows = filterRows(state.pendingPayments);
    setText('owner-pending-count', formatNumber(allRows.length));
    document.getElementById('owner-pending-payments').innerHTML = allRows.slice(0, 4).map(row => `<div class="owner-pending-item"><div class="owner-list-icon"><i class="bi bi-credit-card"></i></div><div><strong>${escapeHtml(row.student_name)}</strong><small>${escapeHtml(row.branch_name)} - ${escapeHtml(row.billing_type || 'Payment')}</small></div><span class="owner-list-value">${currency(row.amount)}</span></div>`).join('') || '<div class="owner-empty">No pending payments.</div>';
}


function setupDashboardModals() {
    const dashboard = document.querySelector('.owner-dashboard');
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
    document.querySelectorAll('.owner-dashboard [data-dashboard-modal]').forEach(trigger => {
        trigger.setAttribute('role', 'button');
        if (!trigger.hasAttribute('tabindex')) trigger.setAttribute('tabindex', '0');
    });
}

function openDashboardModal(key) {
    const modal = getDashboardModal();
    const content = getDashboardModalContent(key);
    modal.querySelector('.modal-title').innerHTML = content.title;
    modal.querySelector('.modal-body').innerHTML = content.body;

    const link = modal.querySelector('.owner-modal-link');
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
    let modal = document.getElementById('ownerDashboardModal');
    if (modal) return modal;

    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="ownerDashboardModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Dashboard Details</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body"></div>
                    <div class="modal-footer">
                        <a class="btn btn-theme owner-modal-link d-none" href="#">Open page</a>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        </div>
    `);

    return document.getElementById('ownerDashboardModal');
}

function getDashboardModalContent(key) {
    const modalMap = {
        'total-enrollments': () => ({
            title: '<i class="bi bi-people-fill me-2"></i>Total Enrollments',
            href: 'enrollement.html',
            linkText: 'View enrollments',
            body: table(
                ['ID', 'Student', 'Program', 'Center', 'Date', 'Status'],
                filterRows(state.recentEnrollments),
                row => [`#ENR-${row.enrollment_details_id}`, row.student_name, row.program_name || 'N/A', row.branch_name, row.enrollment_date, statusPill(row.status)],
                'No enrollment records are available.'
            )
        }),
        'received-revenue': () => ({
            title: '<i class="bi bi-cash-stack me-2"></i>Received Revenue',
            href: 'payment.html',
            linkText: 'View payments',
            body: table(
                ['Center', 'Status', 'Payments', 'Amount'],
                filterRows(state.paymentOverview).filter(row => normalizeStatus(row.payment_status) === 'received'),
                row => [branchName(row.branch_id), statusPill(row.payment_status), formatNumber(row.payment_count), currency(row.total_amount)],
                'No received revenue records are available.'
            )
        }),
        'active-employees': () => ({
            title: '<i class="bi bi-person-badge me-2"></i>Active Employees',
            href: 'employee.html',
            linkText: 'Manage employees',
            body: table(
                ['Employee', 'Role', 'Center', 'Date Added', 'Status'],
                filterRows(state.recentEmployees).filter(row => normalizeStatus(row.status) === 'active'),
                row => [row.employee_name, row.role_name, row.branch_name, row.date_created, statusPill(row.status)],
                'No active employee records are available.'
            )
        }),
        'active-centers': () => ({
            title: '<i class="bi bi-shop me-2"></i>Active Centers',
            href: 'center.html',
            linkText: 'Manage centers',
            body: table(
                ['Center', 'Location', 'Enrollments', 'Revenue', 'Employees', 'Classes', 'Pending Payments'],
                selectedBranch() === ALL_CENTERS ? state.branchPerformance : state.branchPerformance.filter(row => branchId(row.branch_id) === selectedBranch()),
                row => [row.branch_name, row.branch_location || 'No location', formatNumber(row.total_enrollments), currency(row.received_revenue), formatNumber(row.active_employees), formatNumber(row.active_classes), formatNumber(row.pending_payments)],
                'No center performance records are available.'
            )
        }),
        'enrollment-activity': () => ({
            title: '<i class="bi bi-graph-up-arrow me-2"></i>Enrollment Activity',
            body: table(
                ['Date', 'Center', 'Enrollments'],
                filterRows(state.enrollmentTrend),
                row => [row.enrollment_date, branchName(row.branch_id), formatNumber(row.total_enrollments)],
                'No enrollment activity records are available.'
            )
        }),
        'program-enrollments': () => ({
            title: '<i class="bi bi-pie-chart me-2"></i>Enrollments by Program',
            href: 'enrollement.html', linkText: 'View enrollments',
            body: table(['Program', 'Enrollments'], aggregatePrograms(filterRows(state.programEnrollments).filter(row => inPeriod(row.enrollment_date, document.getElementById('owner-program-period')?.value || 'month')), 'total_enrollments'), row => [row.name, formatNumber(row.value)], 'No program enrollment records are available.')
        }),
        'payments': () => ({
            title: '<i class="bi bi-cash-stack me-2"></i>Payments by Program',
            href: 'payment.html', linkText: 'View payments',
            body: table(['Program', 'Received Payments'], aggregatePrograms(filterRows(state.paymentTrend).filter(row => inPeriod(row.payment_date, document.getElementById('owner-payment-period')?.value || 'month')), 'total_amount'), row => [row.name, currency(row.value)], 'No payment records are available for this period.')
        }),
        'payment-health': () => ({
            title: '<i class="bi bi-pie-chart me-2"></i>Payment Health',
            href: 'payment.html',
            linkText: 'View payments',
            body: table(
                ['Center', 'Status', 'Payments', 'Amount'],
                filterRows(state.paymentOverview),
                row => [branchName(row.branch_id), statusPill(row.payment_status), formatNumber(row.payment_count), currency(row.total_amount)],
                'No payment overview records are available.'
            )
        }),
        'center-performance': () => ({
            title: '<i class="bi bi-shop-window me-2"></i>Center Performance',
            href: 'center.html',
            linkText: 'Manage centers',
            body: table(
                ['Center', 'Location', 'Enrollments', 'Revenue', 'Employees', 'Classes', 'Pending Payments'],
                selectedBranch() === ALL_CENTERS ? state.branchPerformance : state.branchPerformance.filter(row => branchId(row.branch_id) === selectedBranch()),
                row => [row.branch_name, row.branch_location || 'No location', formatNumber(row.total_enrollments), currency(row.received_revenue), formatNumber(row.active_employees), formatNumber(row.active_classes), formatNumber(row.pending_payments)],
                'No center performance records are available.'
            )
        }),
        'recent-enrollments': () => ({
            title: '<i class="bi bi-journal-check me-2"></i>Recent Enrollments',
            href: 'enrollement.html',
            linkText: 'View enrollments',
            body: table(
                ['ID', 'Student', 'Program', 'Center', 'Date', 'Status'],
                filterRows(state.recentEnrollments),
                row => [`#ENR-${row.enrollment_details_id}`, row.student_name, row.program_name || 'N/A', row.branch_name, row.enrollment_date, statusPill(row.status)],
                'No enrollment records are available.'
            )
        }),
        'pending-payments': () => ({
            title: '<i class="bi bi-credit-card me-2"></i>Pending Payments',
            href: 'payment.html',
            linkText: 'Review payments',
            body: table(
                ['Student', 'Program', 'Center', 'Billing', 'Date', 'Amount'],
                filterRows(state.pendingPayments),
                row => [row.student_name, row.program_name || 'N/A', row.branch_name, row.billing_type || 'Payment', row.payment_date, currency(row.amount)],
                'No pending payments are available.'
            )
        }),
        'inventory-attention': () => ({
            title: '<i class="bi bi-box-seam me-2"></i>Inventory Attention',
            href: 'product.html',
            linkText: 'Manage products',
            body: table(
                ['Product', 'Quantity', 'Status'],
                state.lowStockProducts,
                row => [row.name, `${formatNumber(row.quantity)} left`, row.status || 'Inventory attention'],
                'Inventory levels look good.'
            )
        }),
        'recent-employees': () => ({
            title: '<i class="bi bi-person-lines-fill me-2"></i>Recently Added Employees',
            href: 'employee.html',
            linkText: 'Manage employees',
            body: table(
                ['Employee', 'Role', 'Center', 'Date Added', 'Status'],
                filterRows(state.recentEmployees),
                row => [row.employee_name, row.role_name, row.branch_name, row.date_created, statusPill(row.status)],
                'No employee records are available.'
            )
        })
    };

    return (modalMap[key] || modalMap['total-enrollments'])();
}

function table(headers, rows, mapRow, emptyText) {
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeRows.length) return `<div class="owner-empty">${escapeHtml(emptyText)}</div>`;

    return `
        <div class="owner-table-wrap">
            <table class="owner-table">
                <thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
                <tbody>
                    ${safeRows.map(row => `<tr>${mapRow(row).map(cell => `<td>${modalCell(cell)}</td>`).join('')}</tr>`).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function branchName(id) {
    if (branchId(id) === 'unassigned') return 'Unassigned Center';
    return state.branches.find(branch => branchId(branch.branch_id) === branchId(id))?.branch_name || `Center ${id}`;
}

function statusPill(value) {
    return `<span class="owner-status ${statusClass(value)}">${escapeHtml(value || 'Pending')}</span>`;
}

function modalCell(value) {
    const text = String(value ?? '');
    if (text.startsWith('<span class="owner-status')) return text;
    return escapeHtml(text);
}

function filterRows(rows) { const selected = selectedBranch(); return selected === ALL_CENTERS ? rows : rows.filter(row => branchId(row.branch_id) === selected); }
function selectedBranch() { return document.getElementById('owner-branch-filter')?.value || ALL_CENTERS; }
function sumPayments(rows, statuses) { return rows.filter(row => statuses.includes(normalizeStatus(row.payment_status))).reduce((sum, row) => sum + number(row.total_amount), 0); }
function yearMonths() { const now = new Date(); return Array.from({ length: 12 }, (_, index) => new Date(now.getFullYear(), now.getMonth() - 11 + index, 1)); }
function branchId(value) { return value === null || value === undefined || value === '' ? 'unassigned' : String(value); }
function normalizeStatus(value) { return String(value || '').trim().toLowerCase(); }
function statusClass(value) { return normalizeStatus(value).replace(/[^a-z-]/g, ''); }
function number(value) { return Number.parseFloat(value || 0) || 0; }
function formatNumber(value) { return Math.round(number(value)).toLocaleString('en-US'); }
function currency(value) { return `PHP ${number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function setText(id, value) { const element = document.getElementById(id); if (element) element.textContent = String(value); }
function emptyRow(columns, text) { return `<tr><td colspan="${columns}" class="owner-empty">${text}</td></tr>`; }
function addDays(date, amount) { const copy = new Date(date); copy.setDate(copy.getDate() + amount); return copy; }
function parseDate(value) { const [year, month, day] = String(value).split('-').map(Number); return new Date(year, month - 1, day); }
function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function inPeriod(value, period) { const date = parseDate(value); const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); if (period === 'day') return dateKey(date) === dateKey(today); const days = period === 'month' ? 30 : 7; return date >= addDays(today, -days + 1); }
function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
