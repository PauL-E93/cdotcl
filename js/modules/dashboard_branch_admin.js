const ENDPOINT = '../../api/branch_admin/dashboard.php';
const state = {
    activeEnrollments: [],
    billingQueue: [],
    branch: {},
    classOverview: [],
    enrollmentPipeline: [],
    paymentsToReceive: [],
    recentEnrollments: [],
    staffSummary: [],
    summary: {},
    todaySchedules: [],
    upcomingSchedules: []
};

document.addEventListener('DOMContentLoaded', () => {
    if (!document.querySelector('.branch-admin-dashboard')) return;
    setupDashboardModals();
    loadDashboard();
});

async function loadDashboard() {
    try {
        const response = await fetch(ENDPOINT, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        const payload = await response.json();
        if (!response.ok || payload.status !== 'success') throw new Error(payload.message || 'Request failed');

        state.billingQueue = payload.billing_queue || [];
        state.activeEnrollments = payload.active_enrollments_detail || [];
        state.branch = payload.branch || {};
        state.classOverview = payload.class_overview || [];
        state.enrollmentPipeline = payload.enrollment_pipeline || [];
        state.paymentsToReceive = payload.payments_to_receive || [];
        state.recentEnrollments = payload.recent_enrollments || [];
        state.staffSummary = payload.staff_summary || [];
        state.summary = payload.summary || {};
        state.todaySchedules = payload.today_schedules || [];
        state.upcomingSchedules = payload.upcoming_schedules || [];

        renderAll();
    } catch (error) {
        console.error('Error loading branch admin dashboard:', error);
        document.getElementById('branch-admin-dashboard-error').textContent = 'Dashboard information could not be loaded. Please refresh the page.';
        renderAll();
    }
}

function renderAll() {
    renderSummary();
    renderTodaySchedules();
    renderPipeline();
    renderClassOverview();
    renderRecentEnrollments();
    renderBillingQueue();
    renderStaffSummary();
    renderUpcomingSchedules();
    configureDashboardTriggers();
}

function renderSummary() {
    setText('branch-admin-branch-name', state.branch.branch_name || 'Assigned Branch');
    setText('branch-admin-pending-applications', `${formatNumber(state.summary.pending_applications)} pending`);

    const cards = [
        {
            key: 'today-schedules',
            className: 'branch-admin-stat-pink',
            icon: 'calendar-check',
            title: "Today's Sessions",
            value: state.summary.today_sessions,
            text: 'Sessions scheduled in your branch'
        },
        {
            key: 'active-enrollments',
            className: 'branch-admin-stat-blue',
            icon: 'people',
            title: 'Active Enrollments',
            value: state.summary.active_enrollments,
            text: 'Students currently being handled'
        },
        {
            key: 'payments-to-receive',
            className: 'branch-admin-stat-green',
            icon: 'wallet2',
            title: 'Payments to Receive',
            value: state.summary.payments_to_receive,
            text: 'Pending payment confirmations'
        },
        {
            key: 'open-classes',
            className: 'branch-admin-stat-orange',
            icon: 'easel',
            title: 'Open Classes',
            value: state.summary.open_classes,
            text: 'Open or full class records'
        }
    ];

    const grid = document.getElementById('branch-admin-stats-grid');
    if (!grid) return;

    grid.innerHTML = cards.map(card => `
        <article class="branch-admin-stat-card ${card.className}" data-dashboard-modal="${card.key}" tabindex="0" role="button" aria-label="Open ${escapeHtml(card.title)} details">
            <div class="branch-admin-stat-icon"><i class="bi bi-${card.icon}"></i></div>
            <div>
                <p>${escapeHtml(card.title)}</p>
                <strong>${formatNumber(card.value)}</strong>
                <span>${escapeHtml(card.text)}</span>
            </div>
        </article>
    `).join('');
}

function renderTodaySchedules() {
    const container = document.getElementById('branch-admin-today-schedule');
    container.innerHTML = state.todaySchedules.slice(0, 8).map(row => `
        <div class="branch-admin-list-item">
            <div class="branch-admin-list-icon"><i class="bi bi-clock"></i></div>
            <div>
                <strong>${escapeHtml(row.student_name)} - ${escapeHtml(row.program_name)}</strong>
                <small>${escapeHtml(row.subject_name)} | ${escapeHtml(row.teacher_name)}</small>
            </div>
            <div class="branch-admin-list-value">${time(row.start_time)}<small>${time(row.end_time)}</small></div>
        </div>
    `).join('') || '<div class="branch-admin-empty">No sessions are scheduled for today.</div>';
}

function renderPipeline() {
    const statuses = ['pending', 'approved', 'enrolled', 'incomplete', 'cancelled'];
    const colors = { pending:'#ef6f91', approved:'#348bd4', enrolled:'#4d9d5e', incomplete:'#ffb22d', cancelled:'#d2d7de' };
    const values = Object.fromEntries(statuses.map(status => [
        status,
        state.enrollmentPipeline
            .filter(row => normalize(row.status) === status)
            .reduce((sum, row) => sum + number(row.total), 0)
    ]));
    const max = Math.max(1, ...Object.values(values));
    document.getElementById('branch-admin-enrollment-pipeline').innerHTML = statuses.map(status => `
        <div class="branch-admin-pipeline-row">
            <span>${label(status)}</span>
            <div class="branch-admin-pipeline-bar"><i style="--bar-color:${colors[status]};width:${values[status] / max * 100}%"></i></div>
            <strong>${formatNumber(values[status])}</strong>
        </div>
    `).join('');
}

function renderClassOverview() {
    const rows = state.classOverview.slice(0, 8);
    document.getElementById('branch-admin-class-overview').innerHTML = rows.length ? rows.map(row => `
        <tr>
            <td>${escapeHtml(row.program_name)}</td>
            <td>${formatNumber(row.sections_count)}</td>
            <td>${formatNumber(row.enrolled_count)}</td>
            <td><span class="branch-admin-status ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
        </tr>
    `).join('') : emptyRow(4, 'No class records available for this branch.');
}

function renderRecentEnrollments() {
    const rows = state.recentEnrollments.slice(0, 6);
    document.getElementById('branch-admin-recent-enrollments').innerHTML = rows.length ? rows.map(row => `
        <tr>
            <td>${escapeHtml(row.student_name)}</td>
            <td>${escapeHtml(row.program_name)}</td>
            <td>${escapeHtml(row.date_created)}</td>
            <td><span class="branch-admin-status ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
        </tr>
    `).join('') : emptyRow(4, 'No recent enrollments available.');
}

function renderBillingQueue() {
    const today = toDateKey(new Date());
    const urgent = state.billingQueue.filter(row => !row.due_date || row.due_date <= today);
    const rows = urgent.length ? urgent : state.billingQueue;
    setText('branch-admin-billing-count', `${formatNumber(urgent.length)} due`);
    document.getElementById('branch-admin-billing-queue').innerHTML = rows.slice(0, 5).map(row => `
        <div class="branch-admin-list-item">
            <div class="branch-admin-list-icon"><i class="bi bi-receipt"></i></div>
            <div>
                <strong>${escapeHtml(row.student_name)}</strong>
                <small>${escapeHtml(row.billing_type || row.program_name)} | Due ${escapeHtml(row.due_date || 'TBD')}</small>
            </div>
            <span class="branch-admin-list-value">${currency(row.total_amount)}</span>
        </div>
    `).join('') || '<div class="branch-admin-empty">No billing items need attention.</div>';
}

function renderStaffSummary() {
    document.getElementById('branch-admin-staff-summary').innerHTML = state.staffSummary.map(row => `
        <div class="branch-admin-list-item">
            <div class="branch-admin-list-icon"><i class="bi bi-person-badge"></i></div>
            <div><strong>${escapeHtml(row.role_name)}</strong><small>Active branch employees</small></div>
            <span class="branch-admin-list-value">${formatNumber(row.total)}</span>
        </div>
    `).join('') || '<div class="branch-admin-empty">No active staff records are available.</div>';
}

function renderUpcomingSchedules() {
    document.getElementById('branch-admin-upcoming-schedule').innerHTML = state.upcomingSchedules.slice(0, 5).map(row => `
        <div class="branch-admin-list-item">
            <div class="branch-admin-list-icon"><i class="bi bi-calendar-event"></i></div>
            <div>
                <strong>${escapeHtml(row.student_name)} - ${escapeHtml(row.program_name)}</strong>
                <small>${escapeHtml(row.teacher_name)} | ${escapeHtml(row.date)}</small>
            </div>
            <span class="branch-admin-list-value">${time(row.start_time)}</span>
        </div>
    `).join('') || '<div class="branch-admin-empty">No upcoming sessions are scheduled yet.</div>';
}

function setupDashboardModals() {
    const dashboard = document.querySelector('.branch-admin-dashboard');
    if (!dashboard) return;

    dashboard.addEventListener('click', event => {
        if (event.target.closest('a')) return;
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
    document.querySelectorAll('.branch-admin-dashboard [data-dashboard-modal]').forEach(trigger => {
        trigger.setAttribute('role', 'button');
        if (!trigger.hasAttribute('tabindex')) trigger.setAttribute('tabindex', '0');
    });
}

function openDashboardModal(key) {
    const modal = getDashboardModal();
    const title = modal.querySelector('.modal-title');
    const body = modal.querySelector('.modal-body');
    const footerLink = modal.querySelector('.branch-admin-modal-link');
    const content = getDashboardModalContent(key);

    title.innerHTML = content.title;
    body.innerHTML = content.body;

    if (content.href) {
        footerLink.href = content.href;
        footerLink.textContent = content.linkText || 'Open page';
        footerLink.classList.remove('d-none');
    } else {
        footerLink.classList.add('d-none');
    }

    bootstrap.Modal.getOrCreateInstance(modal).show();
}

function getDashboardModal() {
    let modal = document.getElementById('branchAdminDashboardModal');
    if (modal) return modal;

    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="branchAdminDashboardModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Dashboard Details</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body"></div>
                    <div class="modal-footer">
                        <a class="btn btn-theme branch-admin-modal-link d-none" href="#">Open page</a>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        </div>
    `);

    return document.getElementById('branchAdminDashboardModal');
}

function getDashboardModalContent(key) {
    const modalMap = {
        'today-schedules': () => ({
            title: '<i class="bi bi-calendar-check me-2"></i>Today\'s Sessions',
            href: 'schedule.html',
            linkText: 'Open schedule',
            body: table(
                ['Student', 'Program', 'Subject', 'Teacher', 'Time', 'Status'],
                state.todaySchedules,
                row => [
                    row.student_name,
                    row.program_name,
                    row.subject_name,
                    row.teacher_name,
                    `${time(row.start_time)} - ${time(row.end_time)}`,
                    statusPill(row.status)
                ],
                'No sessions are scheduled for today.'
            )
        }),
        'active-enrollments': () => ({
            title: '<i class="bi bi-people me-2"></i>Active Enrollments',
            href: 'enrollement.html',
            linkText: 'Open enrollments',
            body: table(
                ['Student', 'Program', 'Subject', 'Teacher', 'Date', 'Status'],
                state.activeEnrollments,
                row => [
                    row.student_name,
                    row.program_name,
                    row.subject_name,
                    row.teacher_name,
                    row.date_created,
                    statusPill(row.status)
                ],
                'No active enrollments are available.'
            )
        }),
        'payments-to-receive': () => ({
            title: '<i class="bi bi-wallet2 me-2"></i>Payments to Receive',
            href: 'payment.html',
            linkText: 'Open payments',
            body: table(
                ['Student', 'Program', 'Amount', 'Type', 'Payment Date'],
                state.paymentsToReceive,
                row => [
                    row.student_name,
                    row.program_name,
                    currency(row.amount_paid),
                    row.payment_type,
                    row.payment_date
                ],
                'No pending payment confirmations are available.'
            )
        }),
        'open-classes': () => ({
            title: '<i class="bi bi-easel me-2"></i>Open Classes',
            href: 'class.html',
            linkText: 'Manage classes',
            body: table(
                ['Program', 'Sections', 'Enrolled', 'Status'],
                state.classOverview.filter(row => ['open', 'full'].includes(normalize(row.status))),
                row => [
                    row.program_name,
                    formatNumber(row.sections_count),
                    formatNumber(row.enrolled_count),
                    statusPill(row.status)
                ],
                'No open or full class records are available.'
            )
        }),
        'enrollment-pipeline': () => ({
            title: '<i class="bi bi-funnel me-2"></i>Enrollment Pipeline',
            href: 'enrollement.html',
            linkText: 'Open enrollments',
            body: table(
                ['Status', 'Total'],
                normalizedPipelineRows(),
                row => [statusPill(row.status), formatNumber(row.total)],
                'No enrollment pipeline data is available.'
            )
        }),
        'class-overview': () => ({
            title: '<i class="bi bi-easel2 me-2"></i>Class Load',
            href: 'class.html',
            linkText: 'Manage classes',
            body: table(
                ['Program', 'Sections', 'Enrolled', 'Status'],
                state.classOverview,
                row => [
                    row.program_name,
                    formatNumber(row.sections_count),
                    formatNumber(row.enrolled_count),
                    statusPill(row.status)
                ],
                'No class records are available for this branch.'
            )
        }),
        'recent-enrollments': () => ({
            title: '<i class="bi bi-person-plus me-2"></i>Recent Enrollments',
            href: 'enrollement.html',
            linkText: 'View all',
            body: table(
                ['Student', 'Program', 'Date', 'Status'],
                state.recentEnrollments,
                row => [
                    row.student_name,
                    row.program_name,
                    row.date_created,
                    statusPill(row.status)
                ],
                'No recent enrollments are available.'
            )
        }),
        'billing-queue': () => ({
            title: '<i class="bi bi-cash-stack me-2"></i>Collection Desk',
            href: 'payment.html',
            linkText: 'Open payments',
            body: table(
                ['Student', 'Billing', 'Program', 'Due Date', 'Amount', 'Status'],
                state.billingQueue,
                row => [
                    row.student_name,
                    row.billing_type || 'Billing',
                    row.program_name,
                    row.due_date || 'TBD',
                    currency(row.total_amount),
                    statusPill(row.status)
                ],
                'No billing items need attention.'
            )
        }),
        'staff-summary': () => ({
            title: '<i class="bi bi-person-badge me-2"></i>Branch Staff',
            body: table(
                ['Role', 'Active Employees'],
                state.staffSummary,
                row => [row.role_name, formatNumber(row.total)],
                'No active staff records are available.'
            )
        }),
        'upcoming-schedules': () => ({
            title: '<i class="bi bi-calendar-event me-2"></i>Upcoming Sessions',
            href: 'schedule.html',
            linkText: 'View calendar',
            body: table(
                ['Date', 'Student', 'Program', 'Teacher', 'Time', 'Status'],
                state.upcomingSchedules,
                row => [
                    row.date,
                    row.student_name,
                    row.program_name,
                    row.teacher_name,
                    `${time(row.start_time)} - ${time(row.end_time)}`,
                    statusPill(row.status)
                ],
                'No upcoming sessions are scheduled yet.'
            )
        })
    };

    return (modalMap[key] || modalMap['today-schedules'])();
}

function normalizedPipelineRows() {
    const statuses = ['pending', 'approved', 'enrolled', 'incomplete', 'cancelled'];
    return statuses.map(status => ({
        status,
        total: state.enrollmentPipeline
            .filter(row => normalize(row.status) === status)
            .reduce((sum, row) => sum + number(row.total), 0)
    }));
}

function table(headers, rows, mapRow, emptyText) {
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeRows.length) {
        return `<div class="branch-admin-empty">${escapeHtml(emptyText)}</div>`;
    }

    return `
        <div class="branch-admin-table-wrap">
            <table class="branch-admin-table branch-admin-modal-table">
                <thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
                <tbody>
                    ${safeRows.map(row => `
                        <tr>${mapRow(row).map(cell => `<td>${modalCell(cell)}</td>`).join('')}</tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function statusPill(value) {
    return `<span class="branch-admin-status ${statusClass(value)}">${escapeHtml(value || 'Pending')}</span>`;
}

function modalCell(value) {
    const text = String(value ?? '');
    if (text.startsWith('<span class="branch-admin-status')) return text;
    return escapeHtml(text);
}

function normalize(value) { return String(value || '').trim().toLowerCase(); }
function statusClass(value) { return normalize(value).replace(/[^a-z-]/g, ''); }
function label(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
function number(value) { return Number.parseFloat(value || 0) || 0; }
function formatNumber(value) { return Math.round(number(value)).toLocaleString('en-US'); }
function currency(value) { return `PHP ${number(value).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 })}`; }
function time(value) { if (!value) return 'TBD'; const [hour, minute] = value.split(':').map(Number); return new Date(2000, 0, 1, hour, minute).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' }); }
function toDateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function setText(id, value) { const element = document.getElementById(id); if (element) element.textContent = String(value); }
function emptyRow(columns, text) { return `<tr><td colspan="${columns}" class="branch-admin-empty">${escapeHtml(text)}</td></tr>`; }
function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
