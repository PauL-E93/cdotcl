import { openPrePlayReportCard } from '../studentmodule/preplay_report_card.js?v=20260814-school-year-curriculum';
import { applyEnrollmentPagePermissions, canUseEnrollmentPermission, guardEnrollmentPermission, initEnrollmentPermissions, shouldApplyEnrollmentRbac } from './enrollment_rbac.js';
import { applyPaymentPagePermissions, canUsePaymentPermission, guardPaymentPermission, initPaymentPermissions, isPaymentModulePage, shouldApplyPaymentRbac } from './payment_rbac.js';
import { startAutoRefresh } from '../utilities/auto_refresh.js';

// js/modules/view_enrollment.js

let editSchedules = [];
let paginationManager;
let currentEnrollmentDetails = null;
let currentViewOnly = true;
let currentApplicationPlacement = null;
const PAYMENT_PAGE_REFRESH_MS = 15000;
const enrollmentFilters = {
    search: '',
    status: '',
    subject: '',
    teacher: '',
    branch: '',
    summary: 'total'
};

function formatStudentName(details = {}) {
    return [details.first_name, details.last_name, details.ext]
        .filter(part => part && part.toString().trim())
        .map(part => part.toString().trim())
        .join(' ');
}

function formatTime12Hour(value) {
    const time = value == null ? '' : String(value).trim();
    if (!time || /\b(?:AM|PM)\b/i.test(time)) return time;

    const match = time.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match) return time;

    const hour = Number(match[1]);
    if (hour < 0 || hour > 23) return time;

    const displayHour = hour % 12 || 12;
    return `${displayHour}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function formatSectionSchedule(schedule = {}) {
    const start = formatTime12Hour(schedule.start_time || schedule.start || schedule.time || '');
    const end = formatTime12Hour(schedule.end_time || schedule.end || '');
    return `${schedule.day || ''}${start ? ` ${start}` : ''}${end ? ` - ${end}` : ''}`.trim();
}

function preparePrePlayEnrollmentView() {
    const modal = document.getElementById('viewEnrollmentModal');
    if (!modal) return;

    modal.classList.add('preplay-enrollment-view');
    modal.querySelector('.modal-dialog')?.classList.add('preplay-view-dialog');

    const header = modal.querySelector('.modal-header');
    header?.classList.remove('bg-primary', 'text-white');

    const title = modal.querySelector('.modal-title');
    if (title && !title.querySelector('.preplay-modal-title-icon')) {
        title.textContent = 'Manage Enrollment';
        title.insertAdjacentHTML('afterbegin', '<span class="preplay-modal-title-icon" aria-hidden="true"><i class="bi bi-person"></i></span>');
    }

    const closeButton = modal.querySelector('.modal-header .btn-close');
    closeButton?.classList.remove('btn-close-white');
    closeButton?.setAttribute('aria-label', 'Close');

    const cards = modal.querySelectorAll('.modal-body > .alert.alert-light.border');
    cards.forEach((card, index) => {
        card.classList.add('preplay-view-card', index === 0 ? 'preplay-student-card' : 'preplay-class-card');

        const heading = card.querySelector(':scope > h6');
        if (heading && !heading.querySelector('.preplay-section-icon')) {
            const icon = index === 0 ? 'bi-person' : 'bi-mortarboard';
            heading.insertAdjacentHTML('afterbegin', `<span class="preplay-section-icon" aria-hidden="true"><i class="bi ${icon}"></i></span>`);
        }

        card.querySelectorAll(':scope > .row > [class*="col-"]').forEach(field => {
            field.classList.add('preplay-view-field');
        });
    });

    const studentRow = cards[0]?.querySelector(':scope > .row');
    const nameField = document.getElementById('view_student_name')?.closest('[class*="col-"]');
    if (studentRow && nameField && !document.getElementById('view_student_id')) {
        const idField = document.createElement('div');
        idField.className = 'col-md-4 preplay-view-field';
        idField.innerHTML = '<label class="small text-muted">Student ID</label><div class="fw-bold" id="view_student_id">...</div>';
        nameField.insertAdjacentElement('afterend', idField);
    }

    if (studentRow && !document.getElementById('view_branch')) {
        const branchField = document.createElement('div');
        branchField.className = 'col-md-4 preplay-view-field';
        branchField.innerHTML = '<label class="small text-muted">Branch</label><div class="fw-bold" id="view_branch">...</div>';
        const statusField = document.getElementById('view_status')?.closest('[class*="col-"]');
        studentRow.insertBefore(branchField, statusField || null);
    }

    const status = document.getElementById('view_status');
    status?.classList.add('preplay-status-pill');
    status?.closest('[class*="col-"]')?.classList.add('preplay-status-field');
}

function resolvePaymentProofUrl(proofPath) {
    if (!proofPath) return '';
    if (/^(?:https?:)?\/\//.test(proofPath)) {
        return proofPath;
    }

    const cleaned = String(proofPath).replace(/^\/+/, '');
    return `../../${cleaned}`;
}

function isStudentPrePlayPage() {
    return window.location.pathname.includes('/student/');
}

function getEnrollmentApiUrl(operation, params = '') {
    const baseUrl = isStudentPrePlayPage()
        ? '../../api/student/enrollment.php'
        : '../../api/admin/enrollment.php';

    return `${baseUrl}?operation=${operation}${params}`;
}

function getPrePlayListUrl(summaryFilter = 'total') {
    enrollmentFilters.summary = summaryFilter || 'total';
    const listUrl = isStudentPrePlayPage()
        ? getEnrollmentApiUrl('getPrePlayEnrollments')
        : getEnrollmentApiUrl('getEnrollments', '&type=preschool');
    const params = [];

    if (window.location.pathname.includes('/owner/enrollement_pre_play.html')) {
        params.push('include_applications=1');
    }

    if (enrollmentFilters.summary && enrollmentFilters.summary !== 'total') {
        params.push(`summary_filter=${encodeURIComponent(enrollmentFilters.summary)}`);
    }
    if (enrollmentFilters.search) {
        params.push(`search=${encodeURIComponent(enrollmentFilters.search)}`);
    }
    if (enrollmentFilters.status) {
        params.push(`status=${encodeURIComponent(enrollmentFilters.status)}`);
    }
    if (enrollmentFilters.subject) {
        params.push(`subject=${encodeURIComponent(enrollmentFilters.subject)}`);
    }
    if (enrollmentFilters.teacher) {
        params.push(`teacher=${encodeURIComponent(enrollmentFilters.teacher)}`);
    }
    if (enrollmentFilters.branch) {
        params.push(`branch_id=${encodeURIComponent(enrollmentFilters.branch)}`);
    }

    return `${listUrl}${params.length ? '&' + params.join('&') : ''}`;
}

function getPrePlayStatsUrl() {
    const includeApplications = window.location.pathname.includes('/owner/enrollement_pre_play.html')
        ? '&include_applications=1'
        : '';

    return isStudentPrePlayPage()
        ? getEnrollmentApiUrl('getPrePlayEnrollmentStats')
        : getEnrollmentApiUrl('getEnrollmentStats', `&type=preschool${includeApplications}`);
}

// Function to determine if program is preschool and open appropriate billing modal
window.openBillingModalByProgram = function(enrollmentId, programName) {
    // Check if program name contains preschool/playschool keywords
    const isPreschool = programName && (
        programName.toLowerCase().includes('preschool') ||
        programName.toLowerCase().includes('playschool') ||
        programName.toLowerCase().includes('pre-school') ||
        programName.toLowerCase().includes('play-school') ||
        programName.toLowerCase().includes('pre school') ||
        programName.toLowerCase().includes('play school')
    );

    // Call appropriate modal function
    if (isPreschool && typeof window.openBillingPlayPreModal === 'function') {
        window.openBillingPlayPreModal(enrollmentId);
    } else if (typeof window.openBillingModal === 'function') {
        window.openBillingModal(enrollmentId);
    } else {
        Swal.fire('Error', 'Billing function not available', 'error');
    }
};

document.addEventListener("DOMContentLoaded", async () => {
    if (window.location.pathname.includes('payment_pre_play.html') || window.location.pathname.includes('enrollement_pre_play.html')) {
        if (window.location.pathname.includes('payment_pre_play.html') && shouldApplyPaymentRbac()) {
            await initPaymentPermissions();
            const access = applyPaymentPagePermissions();
            if (!access.allowed) {
                return;
            }
        }

        if (window.location.pathname.includes('enrollement_pre_play.html') && shouldApplyEnrollmentRbac()) {
            await initEnrollmentPermissions();
            const access = applyEnrollmentPagePermissions();
            if (!access.allowed) {
                return;
            }
        }

        initializePagination();
        setupEnrollmentFilterPanelToggle();
        setupEnrollmentFilterControls();
        loadEnrollmentFilterLookups();
        setupEnrollmentSummaryFilters();
        setupEnrollmentTableExport();
        loadEnrollmentStats();
        setupPaymentPageAutoRefresh();
    }
});

function setupEnrollmentFilterPanelToggle() {
    if (!window.location.pathname.includes('/auditor/') && !window.location.pathname.includes('/branch_admin/') && !window.location.pathname.includes('/teacher/')) return;

    const toggle = document.querySelector('.filter-toggle-btn');
    const container = document.querySelector('.filter-container');
    if (!toggle || !container || toggle.dataset.filterToggleReady === 'true') return;

    toggle.dataset.filterToggleReady = 'true';
    toggle.addEventListener('click', () => container.classList.toggle('filter-open'));
}

function initializePagination() {
    const tableBody = document.getElementById('paymentTableBody');
    const paginationContainer = document.querySelector('.d-flex.justify-content-between.align-items-center.mt-4 nav');

    if (!tableBody || !paginationContainer) return;
    setupSingleActionDropdown(tableBody);

    paginationManager = new PaginationManager({
        container: paginationContainer,
        apiUrl: getPrePlayListUrl(),
        tableBody: tableBody,
        perPage: 10,
        onDataLoad: renderEnrollments
    });

    paginationManager.init();

    // Make loadEnrollments available globally
    window.loadEnrollments = () => paginationManager.loadPage(1);
}

function setupPaymentPageAutoRefresh() {
    if (!isPaymentModulePage()) return;

    startAutoRefresh({
        callback: async () => {
            paginationManager?.refresh();
            loadEnrollmentStats();
        },
        intervalMs: PAYMENT_PAGE_REFRESH_MS
    });
}

function setupSingleActionDropdown(tableBody) {
    if (tableBody.dataset.singleActionDropdown === 'true') return;

    tableBody.dataset.singleActionDropdown = 'true';
    tableBody.addEventListener('show.bs.dropdown', event => {
        const currentDropdown = event.target.closest('.dropdown');

        tableBody.querySelectorAll('.dropdown-menu.show').forEach(menu => {
            const dropdown = menu.closest('.dropdown');
            if (!dropdown || dropdown === currentDropdown) return;

            const toggle = dropdown.querySelector('[data-bs-toggle="dropdown"]');
            if (toggle && window.bootstrap?.Dropdown) {
                window.bootstrap.Dropdown.getOrCreateInstance(toggle).hide();
                return;
            }

            dropdown.classList.remove('show');
            menu.classList.remove('show');
            toggle?.setAttribute('aria-expanded', 'false');
        });
    });
}

function setupEnrollmentSummaryFilters() {
    const cards = document.querySelectorAll('.enrollment-summary-card[data-enrollment-filter]');

    cards.forEach(card => {
        const applyFilter = () => {
            if (!paginationManager) return;

            enrollmentFilters.summary = card.dataset.enrollmentFilter || 'total';
            cards.forEach(item => item.setAttribute('aria-pressed', String(item === card)));
            paginationManager.apiUrl = getPrePlayListUrl(enrollmentFilters.summary);
            paginationManager.loadPage(1);
        };

        card.addEventListener('click', applyFilter);
        card.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                applyFilter();
            }
        });
    });
}

function setupEnrollmentTableExport() {
    const exportButton = document.getElementById('export-enrollment-table');
    if (!exportButton || exportButton.dataset.exportReady === 'true') return;

    const canExport = isPaymentModulePage()
        ? canUsePaymentPermission('export')
        : canUseEnrollmentPermission('export');
    exportButton.classList.toggle('d-none', !canExport);
    if (!canExport) return;

    exportButton.dataset.exportReady = 'true';
    exportButton.addEventListener('click', () => {
        exportPrePlayTable().catch(error => {
            console.error('Pre and Play School export failed:', error);
            Swal.fire('Export failed', error.message || 'Please try again.', 'error');
        });
    });
}

function getPrePlayVisibleExportData() {
    const table = document.querySelector('#paymentTableBody')?.closest('table');
    if (!table) return null;

    const headerCells = Array.from(table.querySelectorAll('thead th'));
    const exportColumnIndexes = headerCells
        .map((cell, index) => ({ index, label: cell.textContent.trim() }))
        .filter(column => column.label && !/^actions?$/i.test(column.label));
    const headers = exportColumnIndexes.map(column => column.label);
    const rows = Array.from(table.querySelectorAll('tbody tr'))
        .map(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length !== headerCells.length) return null;
            return exportColumnIndexes.map(column => cells[column.index]?.innerText.replace(/\s+/g, ' ').trim() || '');
        })
        .filter(row => row && row.some(Boolean));

    return headers.length && rows.length ? { headers, rows } : null;
}

async function getAllPrePlayExportData() {
    const totalItems = Number(paginationManager?.totalItems || 0);
    if (totalItems < 1) return null;

    const response = await axios.get(`${getPrePlayListUrl(enrollmentFilters.summary)}&page=1&limit=${totalItems}`);
    if (response.data?.status !== 'success') {
        throw new Error(response.data?.message || 'Unable to load all Pre and Play School records.');
    }

    const paymentPage = isPaymentModulePage();
    const headers = ['Student ID', 'Student Name', 'Subject', 'Tutor', 'Enrollment Date', 'Status'];
    const rows = (response.data.data || []).map(item => [
        item.student_id_number || item.student_id || 'N/A',
        item.student_name || 'N/A',
        item.program_name || item.subject_name || 'N/A',
        item.teacher_name || 'Not assigned',
        item.enrollment_date || 'N/A',
        paymentPage
            ? (String(item.status || '').toLowerCase().trim() === 'incomplete' ? 'Incomplete' : (item.payment_status || 'Unpaid'))
            : (item.status || 'N/A').toUpperCase()
    ]);

    return rows.length ? { headers, rows } : null;
}

function downloadPrePlayExport(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function exportPrePlayTable() {
    const paymentPage = isPaymentModulePage();
    const canExport = paymentPage
        ? guardPaymentPermission('export', 'You do not have permission to export payment data.')
        : guardEnrollmentPermission('export', 'You do not have permission to export enrollment data.');
    if (!canExport) return;

    const recordType = paymentPage ? 'payment' : 'enrollment';
    const result = await Swal.fire({
        title: `Export ${recordType} table`,
        icon: 'question',
        html: `
            <div class="text-start">
                <label for="preplay-export-scope" class="form-label fw-semibold">Records to export</label>
                <select id="preplay-export-scope" class="form-select mb-3">
                    <option value="current">Current page (rows shown)</option>
                    <option value="all">Whole table (all filtered records)</option>
                </select>
                <label for="preplay-export-format" class="form-label fw-semibold">File format</label>
                <select id="preplay-export-format" class="form-select">
                    <option value="pdf">PDF</option>
                    <option value="csv">CSV</option>
                    <option value="xlsx">Excel (.xlsx)</option>
                </select>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Export',
        preConfirm: () => ({
            scope: document.getElementById('preplay-export-scope')?.value || 'current',
            format: document.getElementById('preplay-export-format')?.value || 'pdf'
        })
    });
    if (!result.isConfirmed) return;

    Swal.fire({
        title: 'Preparing export...',
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading()
    });

    const data = result.value.scope === 'all'
        ? await getAllPrePlayExportData()
        : getPrePlayVisibleExportData();
    if (!data) {
        Swal.fire('Nothing to export', 'There are no records to export.', 'info');
        return;
    }

    const date = new Date().toISOString().slice(0, 10);
    const filename = `pre-play-${paymentPage ? 'payments' : 'enrollments'}-${date}`;

    if (result.value.format === 'pdf') {
        if (!window.jspdf?.jsPDF) throw new Error('PDF export library is unavailable.');
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: data.headers.length > 5 ? 'landscape' : 'portrait' });
        pdf.setFontSize(16);
        pdf.text(`Pre and Play School ${paymentPage ? 'Payment' : 'Enrollment'} List`, 14, 16);
        pdf.setFontSize(10);
        pdf.text(`Exported: ${new Date().toLocaleDateString()}`, 14, 23);
        pdf.autoTable({
            head: [data.headers],
            body: data.rows,
            startY: 28,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [234, 154, 166], textColor: [33, 37, 41] }
        });
        pdf.save(`${filename}.pdf`);
    } else if (result.value.format === 'csv') {
        const csv = [data.headers, ...data.rows]
            .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
            .join('\r\n');
        downloadPrePlayExport(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' }), `${filename}.csv`);
    } else if (result.value.format === 'xlsx') {
        if (!window.XLSX) throw new Error('Excel export library is unavailable.');
        const worksheet = window.XLSX.utils.aoa_to_sheet([data.headers, ...data.rows]);
        const workbook = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(workbook, worksheet, paymentPage ? 'Payments' : 'Enrollments');
        window.XLSX.writeFile(workbook, `${filename}.xlsx`);
    }

    Swal.fire({
        icon: 'success',
        title: 'Export ready',
        text: 'Your download has started.',
        timer: 1800,
        showConfirmButton: false
    });
}

function setupEnrollmentFilterControls() {
    const searchInput = document.getElementById('search-input');
    const statusSelect = document.getElementById('enrollment-status-filter');
    const subjectSelect = document.getElementById('enrollment-subject-filter');
    const teacherSelect = document.getElementById('enrollment-teacher-filter');
    const branchSelect = document.getElementById('enrollment-branch-filter');
    const applyButton = document.getElementById('enrollment-apply-filters');

    if (!paginationManager) return;

    let searchTimer = null;
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                enrollmentFilters.search = searchInput.value.trim();
                paginationManager.apiUrl = getPrePlayListUrl(enrollmentFilters.summary);
                paginationManager.loadPage(1);
            }, 250);
        });

        searchInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                clearTimeout(searchTimer);
                enrollmentFilters.search = searchInput.value.trim();
                paginationManager.apiUrl = getPrePlayListUrl(enrollmentFilters.summary);
                paginationManager.loadPage(1);
            }
        });
    }

    if (statusSelect) {
        statusSelect.addEventListener('change', () => {
            enrollmentFilters.status = statusSelect.value;
            paginationManager.apiUrl = getPrePlayListUrl(enrollmentFilters.summary);
            paginationManager.loadPage(1);
        });
    }

    if (subjectSelect) {
        subjectSelect.addEventListener('change', () => {
            enrollmentFilters.subject = subjectSelect.value;
            paginationManager.apiUrl = getPrePlayListUrl(enrollmentFilters.summary);
            paginationManager.loadPage(1);
        });
    }

    if (teacherSelect) {
        teacherSelect.addEventListener('change', () => {
            enrollmentFilters.teacher = teacherSelect.value;
            paginationManager.apiUrl = getPrePlayListUrl(enrollmentFilters.summary);
            paginationManager.loadPage(1);
        });
    }

    if (branchSelect) {
        branchSelect.addEventListener('change', () => {
            enrollmentFilters.branch = branchSelect.value;
            paginationManager.apiUrl = getPrePlayListUrl(enrollmentFilters.summary);
            paginationManager.loadPage(1);
        });
    }

    if (applyButton) {
        applyButton.addEventListener('click', () => {
            enrollmentFilters.search = searchInput?.value.trim() || '';
            enrollmentFilters.status = statusSelect?.value || '';
            enrollmentFilters.subject = subjectSelect?.value || '';
            enrollmentFilters.teacher = teacherSelect?.value || '';
            enrollmentFilters.branch = branchSelect?.value || '';
            paginationManager.apiUrl = getPrePlayListUrl(enrollmentFilters.summary);
            paginationManager.loadPage(1);
        });
    }
}

function renderEnrollments(enrollments) {
    const tableBody = document.getElementById('paymentTableBody');
    tableBody.innerHTML = '';

    if (enrollments.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" class="text-center">No enrollments found.</td></tr>';
        return;
    }

    enrollments.forEach(item => {
        const pagePath = window.location.pathname;
        const isPaymentPage = pagePath.includes('payment.html') || pagePath.includes('payment_pre_play.html');
        const isPreschoolPage = pagePath.includes('payment_pre_play.html') || pagePath.includes('enrollement_pre_play.html');
        const isStudentPaymentPage = isStudentPrePlayPage() && isPaymentPage;
        const enrollmentLifecycleStatus = String(item.status || '').toLowerCase().trim();
        const useOwnerPaymentStatus = isPaymentPage && !isStudentPrePlayPage();
        const paymentStatus = enrollmentLifecycleStatus === 'incomplete'
            ? 'Incomplete'
            : (item.payment_status || 'Unpaid');
        const applicationStatusLabels = {
            pending_review: 'PENDING',
            approved_for_payment: 'AWAITING CENTER PAYMENT',
            ready_for_scheduling: 'READY FOR CLASS & SECTION'
        };
        const applicationStatus = String(item.application_status || '').toLowerCase();
        const isPendingOnlineApplication = Boolean(item.application_id && applicationStatusLabels[applicationStatus]);
        const displayStatus = useOwnerPaymentStatus
            ? paymentStatus
            : (applicationStatusLabels[applicationStatus] || (item.status || '').toUpperCase());

        let statusBadge;
        if (useOwnerPaymentStatus) {
            const paymentStatusClasses = {
                'Fully Paid': 'success',
                'Partial': 'warning',
                'Pending': 'warning text-dark',
                'Unpaid': 'danger',
                'Incomplete': 'warning text-dark'
            };
            statusBadge = paymentStatusClasses[paymentStatus] || 'secondary';
        } else if (isPendingOnlineApplication) {
            statusBadge = applicationStatus === 'ready_for_scheduling' ? 'primary' : 'warning text-dark';
        } else {
            switch (enrollmentLifecycleStatus) {
                case 'active':
                case 'enrolled':
                    statusBadge = 'success';
                    break;
                case 'pending':
                case 'incomplete':
                    statusBadge = 'warning text-dark';
                    break;
                case 'cancelled':
                    statusBadge = 'danger';
                    break;
                case 'session done':
                    statusBadge = 'info';
                    break;
                default:
                    statusBadge = 'secondary';
            }
        }

        let actionButtons = '';
        const status = (item.status || '').toLowerCase();
        const canComplete = status === 'incomplete' && !isStudentPrePlayPage() && document.getElementById('enrollmentDetailsModal');
        const canViewModule = canUseEnrollmentPermission('view');
        const canApproveEnrollment = canUseEnrollmentPermission('approve');
        const canExportEnrollment = canUseEnrollmentPermission('export');
        const canCreatePayment = canUsePaymentPermission('create');
        const canApprovePayment = canUsePaymentPermission('approve');
        const canExportPayment = canUsePaymentPermission('export');

        if (isPaymentPage) {
            const payCall = isPreschoolPage ? `openBillingPlayPreModal(${item.enrollment_details_id})` : `openBillingModalByProgram(${item.enrollment_details_id}, '${item.program_name || ''}')`;
            const paymentActions = [
                `<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); ${payCall}"><i class="bi bi-credit-card me-2"></i>${canCreatePayment ? 'Pay' : 'View Billing'}</a></li>`,
                `<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); openPrePlayPaymentHistoryModal(${item.enrollment_details_id}, ${isStudentPrePlayPage() || !canApprovePayment})"><i class="bi bi-eye me-2"></i>View</a></li>`
            ];
            if (canExportPayment) {
                paymentActions.push(`<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); window.exportPrePlayBillingStatement(${item.enrollment_details_id})"><i class="bi bi-download me-2"></i>Export</a></li>`);
            }
            actionButtons = `
                <div class="dropdown" onclick="event.stopPropagation();">
                    <button class="btn btn-sm btn-outline-secondary border-0" type="button" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Payment actions">
                        <i class="bi bi-three-dots-vertical"></i>
                    </button>
                    <ul class="dropdown-menu dropdown-menu-end">${paymentActions.join('')}</ul>
                </div>
            `;
        }

        if (!window.location.pathname.includes('payment.html') && !window.location.pathname.includes('payment_pre_play.html')) {
            if (isPendingOnlineApplication) {
                actionButtons = `
                    <div class="dropdown" onclick="event.stopPropagation();">
                        <button class="btn btn-sm btn-outline-secondary border-0" type="button" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Application actions">
                            <i class="bi bi-three-dots-vertical"></i>
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end">
                            <li><a class="dropdown-item text-primary fw-semibold" href="#" onclick="event.preventDefault(); window.viewNewStudentApplication(${Number(item.application_id)})"><i class="bi bi-clipboard-check me-2"></i>Check Application</a></li>
                        </ul>
                    </div>
                `;
            } else if (status === 'pending' && !isStudentPrePlayPage()) {
                if (canApproveEnrollment) {
                    actionButtons += `
                        <div class="dropdown" onclick="event.stopPropagation();">
                            <button class="btn btn-sm btn-outline-secondary border-0" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                                <i class="bi bi-three-dots-vertical"></i>
                            </button>
                            <ul class="dropdown-menu dropdown-menu-end">
                                <li><a class="dropdown-item text-primary fw-semibold" href="#" onclick="event.preventDefault(); openPrePlayPaymentHistoryModal(${item.enrollment_details_id})">Review</a></li>
                            </ul>
                        </div>
                    `;
                }
            } else if (status === 'incomplete' && canComplete) {
                if (canApproveEnrollment) {
                    actionButtons += `
                        <div class="dropdown" onclick="event.stopPropagation();">
                            <button class="btn btn-sm btn-outline-secondary border-0" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                                <i class="bi bi-three-dots-vertical"></i>
                            </button>
                            <ul class="dropdown-menu dropdown-menu-end">
                                <li><a class="dropdown-item text-primary fw-semibold" href="#" onclick="event.preventDefault(); openPendingEnrollmentCompletion(${item.enrollment_details_id}, 'preschool')">Complete</a></li>
                            </ul>
                        </div>
                    `;
                }
            } else if (status !== 'incomplete') {
                const enrollmentActions = [];
                if (canViewModule) {
                    enrollmentActions.push(`<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); viewPrePlayDetails(${item.enrollment_details_id}, true)">View</a></li>`);
                    enrollmentActions.push(`<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); window.viewPrePlayReportCard(${item.enrollment_details_id})">View Report Card</a></li>`);
                }
                if (canApproveEnrollment && canComplete) {
                    enrollmentActions.push(`<li><a class="dropdown-item text-primary fw-semibold" href="#" onclick="event.preventDefault(); openPendingEnrollmentCompletion(${item.enrollment_details_id}, 'preschool')">Complete</a></li>`);
                }
                if (canExportEnrollment) {
                    enrollmentActions.push(`<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); printORF(${item.enrollment_details_id}, 'preplay')">Print ORF</a></li>`);
                }

                if (enrollmentActions.length > 0) {
                actionButtons += `
                    <div class="dropdown" onclick="event.stopPropagation();">
                        <button class="btn btn-sm btn-outline-secondary border-0" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                            <i class="bi bi-three-dots-vertical"></i>
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end">
                            ${enrollmentActions.join('')}
                        </ul>
                    </div>
                `;
                }
            }
        }

        const row = isStudentPaymentPage ? `
            <tr>
                <td>${item.enrollment_details_id || 'N/A'}</td>
                <td>${item.program_name || 'N/A'}</td>
                <td>${item.subject_name || 'N/A'}</td>
                <td>${item.teacher_name || 'Not assigned'}</td>
                <td>${item.enrollment_date}</td>
                <td><span class="badge bg-${statusBadge}">${displayStatus}</span></td>
                <td>
                    ${actionButtons}
                </td>
            </tr>
        ` : `
            <tr>
                <td>${item.student_id_number || item.student_id || 'N/A'}</td>
                <td>${item.student_name}</td>
                <td>${item.program_name || item.subject_name || 'N/A'}</td>
                <td>${item.teacher_name || 'Not assigned'}</td>
                <td>${item.enrollment_date}</td>
                <td><span class="badge bg-${statusBadge}">${displayStatus}</span></td>
                <td>
                    ${actionButtons}
                </td>
            </tr>
        `;
        tableBody.innerHTML += row;
    });
}

function loadEnrollmentStats() {
    axios.get(getPrePlayStatsUrl())
    .then(res => {
        if (res.data.status === 'success') {
            const stats = res.data.data;
            if (document.getElementById('total_enrollments')) {
                document.getElementById('total_enrollments').innerText = stats.total;
                document.getElementById('new_enrollments').innerText = stats.new;
                document.getElementById('pending_applications').innerText = stats.pending;
                const incompleteElement = document.getElementById('incomplete_enrollments');
                const cancellationsElement = document.getElementById('cancellations');

                if (incompleteElement) incompleteElement.innerText = stats.incomplete;
                if (cancellationsElement) cancellationsElement.innerText = stats.cancelled;
            }
        }
    })
    .catch(err => console.error("Error stats:", err));
}

function isPrePlayEnrollmentPage() {
    return window.location.pathname.includes('enrollement_pre_play.html');
}

window.editPrePlayEnrollment = function(id) {
    if (!guardEnrollmentPermission('edit', 'You do not have permission to update enrollment records.')) {
        return;
    }

    window.viewPrePlayDetails(id, false, null);
};

window.openPrePlayApplicationPlacement = function(applicationId, enrollmentDetailsId) {
    if (!applicationId || !enrollmentDetailsId) {
        Swal.fire('Placement Unavailable', 'This application does not have a valid enrollment record.', 'error');
        return;
    }

    Swal.close();
    window.viewPrePlayDetails(enrollmentDetailsId, false, {
        applicationId: Number(applicationId),
        enrollmentDetailsId: Number(enrollmentDetailsId)
    });
};

function canEditClassSection() {
    return !isStudentPrePlayPage() && isPrePlayEnrollmentPage();
}

function getCurrentClassId(details) {
    return details.class_id_from_section || details.class_id || '';
}

function formatClassLabel(item) {
    const branch = item.branch_name ? ` (${item.branch_name})` : '';
    return `${item.program_name || 'Class ' + item.class_id}${branch}`;
}

function loadEnrollmentFilterLookups() {
    const lookupUrl = isStudentPrePlayPage()
        ? getEnrollmentApiUrl('getEnrollmentFilterLookups', '&type=preschool')
        : getEnrollmentApiUrl('getLookups');

    axios.get(lookupUrl)
        .then(res => {
            const data = isStudentPrePlayPage() ? (res.data?.data || {}) : (res.data || {});
            const statusSelect = document.getElementById('enrollment-status-filter');
            const subjectSelect = document.getElementById('enrollment-subject-filter');
            const teacherSelect = document.getElementById('enrollment-teacher-filter');
            const branchSelect = document.getElementById('enrollment-branch-filter');

            if (Array.isArray(data.statuses)) {
                populateEnrollmentStatusOptions(statusSelect, data.statuses);
            }
            if (Array.isArray(data.subjects)) {
                if (isStudentPrePlayPage()) {
                    setSelectOptions(subjectSelect, data.subjects, 'All Subjects', null, item => item || '');
                } else {
                    populateEnrollmentSubjectOptions(subjectSelect, data.subjects);
                }
            }
            if (teacherSelect && Array.isArray(data.teachers)) {
                setSelectOptions(teacherSelect, data.teachers, 'All Teachers', null, item => item || '');
            }
            if (Array.isArray(data.branches)) {
                populateEnrollmentBranchOptions(branchSelect, data.branches);
            }
        })
        .catch(err => console.error('Error loading enrollment filter lookups:', err));
}

function populateEnrollmentStatusOptions(statusSelect, statuses = []) {
    if (!statusSelect) return;
    statusSelect.innerHTML = '';
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = 'All Status';
    statusSelect.appendChild(placeholderOption);

    statuses.forEach(status => {
        if (!status) return;
        const option = document.createElement('option');
        option.value = status;
        option.textContent = status;
        statusSelect.appendChild(option);
    });
}

function populateEnrollmentSubjectOptions(subjectSelect, subjects = []) {
    if (!subjectSelect) return;
    setSelectOptions(subjectSelect, subjects, 'All Subject', 'subject_name', item => item.subject_name || '');
}

function populateEnrollmentBranchOptions(branchSelect, branches = []) {
    if (!branchSelect) return;
    setSelectOptions(branchSelect, branches, 'All Branch', 'branch_id', item => item.branch_name || '');
}

function setSelectOptions(select, items, placeholder, valueKey, labelBuilder) {
    if (!select) return;
    select.innerHTML = '';
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = placeholder;
    select.appendChild(placeholderOption);

    items.forEach(item => {
        const option = document.createElement('option');
        option.value = valueKey ? item[valueKey] : item;
        option.textContent = labelBuilder(item);
        select.appendChild(option);
    });
}

function ensureClassSectionSelects() {
    const existingClassSelect = document.getElementById('update_class');
    const existingSectionSelect = document.getElementById('update_section');
    if (existingClassSelect && existingSectionSelect) {
        return { classSelect: existingClassSelect, sectionSelect: existingSectionSelect };
    }

    const classEl = document.getElementById('view_class');
    const sectionEl = document.getElementById('view_section');
    if (!classEl || !sectionEl) return null;

    let classSelect = document.getElementById('update_class');
    if (!classSelect) {
        classSelect = document.createElement('select');
        classSelect.id = 'update_class';
        classSelect.className = 'form-select form-select-sm fw-normal';
        classEl.replaceWith(classSelect);
    }

    let sectionSelect = document.getElementById('update_section');
    if (!sectionSelect) {
        sectionSelect = document.createElement('select');
        sectionSelect.id = 'update_section';
        sectionSelect.className = 'form-select form-select-sm fw-normal';
        sectionEl.replaceWith(sectionSelect);
    }

    return { classSelect, sectionSelect };
}

function restoreClassSectionReadOnlyFields() {
    const classSelect = document.getElementById('update_class');
    if (classSelect) {
        const classValue = document.createElement('div');
        classValue.id = 'view_class';
        classValue.className = 'fw-bold';
        classValue.textContent = '...';
        classSelect.replaceWith(classValue);
    }

    const sectionSelect = document.getElementById('update_section');
    if (sectionSelect) {
        const sectionValue = document.createElement('div');
        sectionValue.id = 'view_section';
        sectionValue.className = 'fw-bold';
        sectionValue.textContent = '...';
        sectionSelect.replaceWith(sectionValue);
    }
}

function setupClassSectionControls(lookups, details) {
    if (!canEditClassSection()) return;

    const controls = ensureClassSectionSelects();
    if (!controls) return;

    const classes = lookups.classes || [];
    const sections = lookups.sections || [];
    const { classSelect, sectionSelect } = controls;
    const programId = details.program_id ? String(details.program_id) : '';

    const availableClasses = classes.filter(item => {
        const status = (item.status || '').toLowerCase();
        const matchesProgram = !programId || String(item.program_id) === programId;
        const matchesBranch = !details.branch_id || String(item.branch_id) === String(details.branch_id);
        return matchesProgram && matchesBranch && (!status || status === 'open' || status === 'active');
    });

    const renderSections = selectedClassId => {
        const availableSections = sections.filter(item => {
            const status = (item.status || '').toLowerCase();
            return String(item.class_id) === String(selectedClassId) && (!status || status === 'open' || status === 'active');
        });

        setSelectOptions(sectionSelect, availableSections, selectedClassId ? 'Select Section' : 'Select Class First', 'section_id', item => item.section_name || `Section ${item.section_id}`);
    };

    setSelectOptions(classSelect, availableClasses, 'Select Class', 'class_id', formatClassLabel);

    const currentClassId = getCurrentClassId(details);
    if (currentClassId && !classSelect.querySelector(`option[value="${currentClassId}"]`)) {
        const option = document.createElement('option');
        option.value = currentClassId;
        option.textContent = `Class ${currentClassId}`;
        classSelect.appendChild(option);
    }

    classSelect.value = currentClassId || '';
    renderSections(classSelect.value);

    if (details.section_id && !sectionSelect.querySelector(`option[value="${details.section_id}"]`)) {
        const option = document.createElement('option');
        option.value = details.section_id;
        option.textContent = details.section_name || `Section ${details.section_id}`;
        sectionSelect.appendChild(option);
    }
    sectionSelect.value = details.section_id || '';

    classSelect.onchange = () => {
        renderSections(classSelect.value);
        sectionSelect.value = '';
        const teacherEl = document.getElementById('view_section_teacher');
        const scheduleEl = document.getElementById('view_section_schedule');
        if (teacherEl) teacherEl.innerText = 'Not assigned';
        if (scheduleEl) scheduleEl.innerText = 'Not set';
    };

    sectionSelect.onchange = () => {
        const selected = sections.find(item => String(item.section_id) === String(sectionSelect.value));
        const teacherEl = document.getElementById('view_section_teacher');
        if (teacherEl) teacherEl.innerText = selected?.teacher_name || 'Not assigned';
        updateSectionSchedulePreview(sectionSelect.value);
    };
}

function updateSectionSchedulePreview(sectionId) {
    const scheduleEl = document.getElementById('view_section_schedule');
    if (!scheduleEl) return;
    if (!sectionId) {
        scheduleEl.innerText = 'Not set';
        return;
    }

    axios.get(`../../api/admin/section.php?operation=getSectionSchedules&section_id=${sectionId}`)
        .then(res => {
            const schedules = Array.isArray(res.data) ? res.data : [];
            scheduleEl.innerText = schedules.length > 0
                ? schedules.map(formatSectionSchedule).join(', ')
                : 'Not set';
        })
        .catch(err => {
            console.error('Error loading section schedule:', err);
            scheduleEl.innerText = 'Not set';
        });
}



window.viewPrePlayDetails = function(id, viewOnly = true, applicationPlacement = null) {
    if (!guardEnrollmentPermission('view', 'You do not have permission to view the enrollment module.')) {
        return;
    }

    console.log('viewDetails called with id:', id);
    currentViewOnly = viewOnly !== false;
    currentApplicationPlacement = applicationPlacement;
    restoreClassSectionReadOnlyFields();

    const detailsRequest = axios.get(getEnrollmentApiUrl('getEnrollmentDetails', `&id=${id}`));
    const lookupRequest = isStudentPrePlayPage()
        ? Promise.resolve({ data: { teachers: [] } })
        : axios.get("../../api/admin/enrollment.php?operation=getLookups");

    Promise.all([lookupRequest, detailsRequest])
    .then(([resLookup, resDetails]) => {
        console.log('Data loaded:', resDetails.data);
        if (resDetails.data.status === 'success') {
            editSchedules = [];
            preparePrePlayEnrollmentView();

            const modalTitle = document.querySelector('#viewEnrollmentModal .modal-title');
            if (modalTitle) {
                modalTitle.innerHTML = currentApplicationPlacement
                    ? '<span class="preplay-modal-title-icon" aria-hidden="true"><i class="bi bi-diagram-3"></i></span>Assign Class &amp; Section'
                    : '<span class="preplay-modal-title-icon" aria-hidden="true"><i class="bi bi-person"></i></span>Manage Enrollment';
            }

            const teachers = resLookup.data.teachers || [];
            const d = resDetails.data.data.details;
            const scheds = resDetails.data.data.schedule;
            currentEnrollmentDetails = d;
            const sectionScheds = resDetails.data.data.section_schedule || scheds || [];

            // Setup safe setter to avoid missing fields
            const setText = (id, text) => {
                const el = document.getElementById(id);
                if (el) el.innerText = text;
            };

            // -- FILL READ-ONLY INFO --
            setText('view_student_name', formatStudentName(d));
            setText('view_student_id', d.student_id_number || d.student_id || 'N/A');
            setText('view_program', d.program_name || 'N/A');
            setText('view_branch', d.branch_name || 'N/A');
            setText('view_status', (d.status || 'N/A').toUpperCase());

            const classText = d.class_id_from_section || d.class_id;
            setText('view_class', classText ? ('Class ' + classText) : 'N/A');
            setText('view_section', d.section_name || 'N/A');

            setText('view_section_teacher', d.section_teacher_name || d.teacher_name || 'Not assigned');

            const sectionSched = (sectionScheds && sectionScheds.length > 0)
                ? sectionScheds.map(formatSectionSchedule).join(', ')
                : 'Not set';
            setText('view_section_schedule', sectionSched);

            setText('view_goal', d.goal || 'No goal set');
            renderHealthNote(d);

            const schoolYearLabel = d.school_year_label || 'N/A';
            const viewSchoolYearEl = document.getElementById('view_school_year');
            if (viewSchoolYearEl) {
                viewSchoolYearEl.innerText = schoolYearLabel;
            }

            // -- FILL EDITABLE FIELDS (optional, view-only fallback) --
            const updateIdEl = document.getElementById('update_enrollment_id');
            if (updateIdEl) {
                updateIdEl.value = d.enrollment_details_id;
            }

            const select = document.getElementById('update_teacher');
            if (select) {
                select.innerHTML = '<option value="">Select Teacher</option>';

                if (isStudentPrePlayPage() && d.preferred_teacher) {
                    const teacherOption = document.createElement('option');
                    teacherOption.value = d.preferred_teacher;
                    teacherOption.textContent = d.teacher_name || 'Assigned teacher';
                    teacherOption.selected = true;
                    select.appendChild(teacherOption);
                } else {
                    teachers.forEach(t => {
                        select.innerHTML += `<option value="${t.employee_id}">${t.name}</option>`;
                    });
                }

                if (d.preferred_teacher) {
                    select.value = d.preferred_teacher;
                } else {
                    select.value = '';
                }
            }

            const form = document.getElementById('updateEnrollmentForm');
            if (form) {
                // School year remains fixed to the stored active year and is not editable here.
            }

            const saveButton = document.querySelector('#viewEnrollmentModal .modal-footer .btn-primary');
            if (saveButton) {
                saveButton.onclick = window.savePrePlayEnrollmentUpdates;
            }
            if (saveButton && (currentViewOnly || isStudentPrePlayPage())) {
                saveButton.style.display = 'none';
            } else if (saveButton) {
                saveButton.style.display = '';
                saveButton.textContent = currentApplicationPlacement ? 'Complete Enrollment' : 'Save Changes';
            }

            if (!currentViewOnly) {
                setupClassSectionControls(resLookup.data || {}, d);
            }

            // -- FILL SCHEDULE TABLE --
            if(scheds && scheds.length > 0) {
                scheds.forEach(s => {
                    editSchedules.push({ day: s.day, time: s.start_time });
                });
            }
            renderEditScheduleTable();

            // Remove any existing modal backdrops
            const backdrops = document.querySelectorAll('.modal-backdrop');
            backdrops.forEach(backdrop => backdrop.remove());

            // Show Modal
            console.log('Showing modal');
            const modalElement = document.getElementById('viewEnrollmentModal');
            if (modalElement) {
                const modal = new bootstrap.Modal(modalElement);
                modal.show();
            } else {
                console.error('Modal element not found');
            }
        }
    })
    .catch(err => console.error("Error loading details:", err));
};

window.viewDetails = window.viewPrePlayDetails;

window.viewPrePlayReportCard = function(enrollmentDetailsId) {
    openPrePlayReportCard(enrollmentDetailsId);
};

function renderStudentAddress(details) {
    const addressParts = [details.adr_street, details.adr_barangay, details.adr_city, details.adr_province]
        .filter(part => part && part.toString().trim().length > 0)
        .map(part => part.toString().trim());
    const note = details.adr_note ? details.adr_note.toString().trim() : '';
    if (addressParts.length === 0 && !note) return;

    const card = document.querySelector('#viewEnrollmentModal .modal-body .alert.alert-light.border');
    if (!card) return;

    let addressRow = document.getElementById('view_student_address_row');
    if (!addressRow) {
        addressRow = document.createElement('div');
        addressRow.className = 'row g-3';
        addressRow.id = 'view_student_address_row';

        const col = document.createElement('div');
        col.className = 'col-12';

        const label = document.createElement('label');
        label.className = 'small text-muted';
        label.textContent = 'Address';

        const value = document.createElement('div');
        value.className = 'fw-bold';
        value.textContent = addressParts.join(', ') || 'N/A';

        col.appendChild(label);
        col.appendChild(value);

        if (note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'text-muted small mt-1';
            noteEl.textContent = note;
            col.appendChild(noteEl);
        }

        addressRow.appendChild(col);
        const rowGroup = card.querySelector('.row.g-3');
        if (rowGroup) {
            rowGroup.appendChild(addressRow);
        } else {
            card.appendChild(addressRow);
        }
    } else {
        const value = addressRow.querySelector('.fw-bold');
        if (value) value.textContent = addressParts.join(', ') || 'N/A';

        const existingNote = addressRow.querySelector('.text-muted.small');
        if (note) {
            if (existingNote) {
                existingNote.textContent = note;
            } else {
                const noteEl = document.createElement('div');
                noteEl.className = 'text-muted small mt-1';
                noteEl.textContent = note;
                addressRow.querySelector('.col-12')?.appendChild(noteEl);
            }
        } else if (existingNote) {
            existingNote.remove();
        }
    }
}

function renderHealthNote(details) {
    const healthNote = details.health_note ? details.health_note.toString().trim() : '';
    const existingHealthNoteRow = document.getElementById('view_health_note_row');
    if (!healthNote) {
        existingHealthNoteRow?.remove();
        return;
    }

    const card = document.querySelector('#viewEnrollmentModal .modal-body .alert.alert-light.border');
    if (!card) return;

    let healthNoteRow = existingHealthNoteRow;
    if (!healthNoteRow) {
        healthNoteRow = document.createElement('div');
        healthNoteRow.className = 'col-12 preplay-view-field preplay-health-field';
        healthNoteRow.id = 'view_health_note_row';

        const label = document.createElement('label');
        label.className = 'small text-muted';
        label.textContent = 'Health Note';

        const value = document.createElement('div');
        value.className = 'fw-bold';
        value.textContent = healthNote;

        healthNoteRow.appendChild(label);
        healthNoteRow.appendChild(value);

        const rowGroup = card.querySelector('.row.g-3');
        if (rowGroup) {
            rowGroup.appendChild(healthNoteRow);
        } else {
            card.appendChild(healthNoteRow);
        }
    } else {
        const value = healthNoteRow.querySelector('.fw-bold');
        if (value) value.textContent = healthNote;
    }
}

// --- 5. SCHEDULE LOGIC ---
window.addEditScheduleRow = function() {
    const day = document.getElementById('edit_sched_day').value;
    const time = document.getElementById('edit_sched_time').value;
    
    if(!day || !time) return Swal.fire('Error', 'Please select day and time', 'warning');
    
    editSchedules.push({ day, time });
    renderEditScheduleTable();
    document.getElementById('edit_sched_time').value = ''; 
};

window.removeEditScheduleRow = function(index) {
    editSchedules.splice(index, 1);
    renderEditScheduleTable();
};

function renderEditScheduleTable() {
    const tbody = document.getElementById('editScheduleTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if(editSchedules.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted small">No schedule assigned</td></tr>';
        return;
    }

    editSchedules.forEach((item, index) => {
        tbody.innerHTML += `
            <tr>
                <td>${item.day}</td>
                <td>${item.time}</td>
                <td class="text-center">
                    ${currentViewOnly ? '<span class="text-muted">-</span>' : `
                        <button type="button" class="btn btn-sm btn-outline-danger py-0" onclick="window.removeEditScheduleRow(${index})">
                            <i class="bi bi-trash"></i>
                        </button>
                    `}
                </td>
            </tr>
        `;
    });
}

// --- 6. SAVE CHANGES ---
window.savePrePlayEnrollmentUpdates = function() {
    if (!guardEnrollmentPermission('edit', 'You do not have permission to update enrollment records.')) {
        return;
    }

    const id = document.getElementById('update_enrollment_id')?.value || currentEnrollmentDetails?.enrollment_details_id;
    const teacherSelect = document.getElementById('update_teacher');
    const classSelect = document.getElementById('update_class');
    const sectionSelect = document.getElementById('update_section');
    const saveButton = document.querySelector('#viewEnrollmentModal .modal-footer .btn-primary');

    if (saveButton?.dataset.submitting === 'true') {
        return;
    }

    const teacher = teacherSelect
        ? (teacherSelect.value || currentEnrollmentDetails?.preferred_teacher || null)
        : (currentEnrollmentDetails?.preferred_teacher || null);
    const classId = classSelect
        ? (classSelect.value || getCurrentClassId(currentEnrollmentDetails || {}))
        : getCurrentClassId(currentEnrollmentDetails || {});
    const sectionId = sectionSelect
        ? (sectionSelect.value || currentEnrollmentDetails?.section_id || null)
        : (currentEnrollmentDetails?.section_id || null);

    if (!id) {
        return Swal.fire("Error", "Enrollment ID is missing.", "error");
    }

    if (currentApplicationPlacement && (!classId || !sectionId)) {
        return Swal.fire('Class and Section Required', 'Select both a class and a section to complete this preschool enrollment.', 'warning');
    }
    
    let summaryTime = editSchedules.length > 0 
        ? editSchedules.map(s => `${s.day} ${s.time}`).join(", ") 
        : "";

    const data = {
        enrollment_details_id: id,
        preferred_teacher: teacher,
        preferred_time_day: summaryTime,
        class_id: classId,
        section_id: sectionId,
        preferences: editSchedules
    };

    const completingApplication = Boolean(currentApplicationPlacement);
    const originalButtonHtml = saveButton?.innerHTML || (completingApplication ? 'Complete Enrollment' : 'Save Changes');
    if (saveButton) {
        saveButton.dataset.submitting = 'true';
        saveButton.disabled = true;
        saveButton.setAttribute('aria-busy', 'true');
        saveButton.innerHTML = `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>${completingApplication ? 'Completing Enrollment...' : 'Saving Changes...'}`;
    }

    const request = currentApplicationPlacement
        ? (() => {
            const body = new URLSearchParams();
            body.set('operation', 'finalizePreschoolEnrollment');
            body.set('json', JSON.stringify({
                application_id: currentApplicationPlacement.applicationId,
                enrollment_details_id: id,
                class_id: classId,
                section_id: sectionId
            }));
            return axios.post('../../api/enrollment_application.php', body);
        })()
        : axios.post("../../api/admin/enrollment.php", {
            operation: "updateEnrollment",
            json: JSON.stringify(data)
        });

    request.then(res => {
        if (res.data.status === 'success') {
            const completedPlacement = completingApplication;
            currentApplicationPlacement = null;
            Swal.fire(completedPlacement ? 'Enrollment Completed' : 'Updated', res.data.message || (completedPlacement ? 'Class and section assigned.' : 'Enrollment details updated.'), 'success');
            
            const modalEl = document.getElementById('viewEnrollmentModal');
            const modalInstance = bootstrap.Modal.getInstance(modalEl);
            modalInstance.hide();

            loadEnrollments();
            loadEnrollmentStats();
        } else {
            Swal.fire("Error", res.data.message, "error");
        }
    }).catch(error => Swal.fire('Error', error.response?.data?.message || error.message, 'error'))
    .finally(() => {
        if (!saveButton) return;
        delete saveButton.dataset.submitting;
        saveButton.disabled = false;
        saveButton.removeAttribute('aria-busy');
        saveButton.innerHTML = originalButtonHtml;
    });
};

window.deleteEnrollment = function(id) {
    if (!guardEnrollmentPermission('delete', 'You do not have permission to delete enrollment records.')) {
        return;
    }

    Swal.fire({
        title: 'Delete this enrollment?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Yes, delete it!'
    }).then((result) => {
        if (result.isConfirmed) {
            axios.post("../../api/admin/enrollment.php", {
                operation: "deleteEnrollment",
                json: JSON.stringify({ id: id })
            }).then(res => {
                if (res.data.status === 'success') {
                    Swal.fire("Deleted", "Enrollment deleted.", "success");
                    loadEnrollments();
                    loadEnrollmentStats();
                } else {
                    Swal.fire("Error", res.data.message, "error");
                }
            });
        }
    });
};

function openPrePlayPaymentHistoryModal(enrollment_details_id, viewOnly = false) {
    Promise.all([
        axios.get(`../../api/admin/payment.php?operation=getPaymentHistory&enrollment_details_id=${enrollment_details_id}`),
        axios.get(`../../api/admin/enrollment.php?operation=getEnrollmentDetails&id=${enrollment_details_id}`)
    ])
    .then(([paymentRes, enrollmentRes]) => {
        if (paymentRes.data.status !== 'success') {
            return Swal.fire('Error', paymentRes.data.message || 'Failed to load payment history.', 'error');
        }
        if (enrollmentRes.data.status !== 'success') {
            return Swal.fire('Error', enrollmentRes.data.message || 'Failed to load enrollment details.', 'error');
        }

        const studentName = paymentRes.data.student_name || 'Unknown Student';
        const history = paymentRes.data.history || [];
        let enrollmentStatus = enrollmentRes.data.data?.details?.status || enrollmentRes.data.data?.status || '';

        if (!enrollmentStatus) {
            const hasPendingPayment = history.some(p => (p.payment_status || '').toLowerCase() === 'pending');
            enrollmentStatus = hasPendingPayment ? 'pending' : (history.length > 0 ? 'received' : 'unknown');
        }

        const statusLabel = enrollmentStatus ? enrollmentStatus.toUpperCase() : 'UNKNOWN';
        const normalizedEnrollmentStatus = enrollmentStatus.toLowerCase();
        const enrollmentStatusTone = ['enrolled', 'received', 'complete', 'completed', 'active'].includes(normalizedEnrollmentStatus)
            ? 'success'
            : ['pending', 'incomplete'].includes(normalizedEnrollmentStatus)
                ? 'pending'
                : ['declined', 'cancelled', 'canceled'].includes(normalizedEnrollmentStatus)
                    ? 'danger'
                    : 'neutral';
        const enrollmentStatusIcon = enrollmentStatusTone === 'success'
            ? 'bi-check-circle'
            : enrollmentStatusTone === 'pending'
                ? 'bi-clock'
                : enrollmentStatusTone === 'danger'
                    ? 'bi-x-circle'
                    : 'bi-info-circle';
        const paymentPageContext = isPaymentModulePage();
        const effectiveViewOnly = viewOnly || (paymentPageContext && !canUsePaymentPermission('approve'));
        const showActions = !effectiveViewOnly;
        const details = enrollmentRes.data.data?.details || {};
        const getReceiptKey = payment => String(payment.receipt_id || payment.payment_id || '');
        const isGcashPayment = payment => {
            const methodName = String(payment.payment_method || '').toLowerCase();
            return methodName.includes('gcash') || Boolean(payment.payment_screenshot_path);
        };
        const canViewReceipt = payment => (payment.payment_status || '') === 'Received';
        const buildReceiptData = payment => {
            const receiptKey = getReceiptKey(payment);
            const receiptRows = history.filter(item => getReceiptKey(item) === receiptKey);
            const rows = receiptRows.length > 0 ? receiptRows : [payment];
            const amountPaid = rows.reduce((sum, item) => sum + parseFloat(item.amount_paid || 0), 0);
            const balanceValues = rows
                .map(item => parseFloat(item.balance))
                .filter(value => !Number.isNaN(value));
            const balance = balanceValues.length > 0 ? Math.min(...balanceValues) : parseFloat(payment.balance || 0);
            const lineItems = rows.flatMap(item => {
                const paid = parseFloat(item.amount_paid || 0);
                const penalty = parseFloat(item.penalty_paid || 0);
                const base = parseFloat(item.base_amount_paid ?? Math.max(paid - penalty, 0));
                const billingType = item.billing_type || item.payment_type || 'Payment';
                return [
                    ...(base > 0 ? [{ label: billingType, amount: base }] : []),
                    ...(penalty > 0 ? [{ label: `Penalty - ${billingType}`, amount: penalty }] : [])
                ];
            });
            const paidFor = [...new Set(rows.map(item => item.billing_type || item.payment_type).filter(Boolean))].join(', ') || 'Tuition Fee';

            return {
                enrollmentId: enrollment_details_id,
                studentName,
                programName: details.program_name || 'N/A',
                programType: details.program_type || null,
                receiptNo: receiptKey,
                paymentKind: payment.payment_type || payment.payment_status || 'Payment',
                paymentType: payment.payment_type || 'Payment',
                paymentFor: paidFor,
                paymentMethod: payment.payment_method || '',
                referenceNo: payment.reference_no || null,
                amountPaid,
                balance,
                totalAmount: amountPaid,
                lineItems,
                paymentDate: payment.payment_date || new Date()
            };
        };
        const showPaymentReceiptModal = payment => {
            if (typeof window.showPaymentReceipt !== 'function') {
                Swal.fire('Error', 'Receipt generator is not available.', 'error');
                return;
            }

            window.showPaymentReceipt(buildReceiptData(payment));
        };
        const showPaymentProofModal = payment => {
            const receiptKey = getReceiptKey(payment);
            const receiptRows = history.filter(item => getReceiptKey(item) === receiptKey);
            const detailRows = receiptRows.length > 0 ? receiptRows : [payment];
            const totalAmountPaid = detailRows.reduce((sum, item) => sum + parseFloat(item.amount_paid || 0), 0);
            const amountValue = totalAmountPaid.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const canReviewPendingPayment = showActions && payment.payment_status === 'Pending';
            const screenshotHtml = payment.payment_screenshot_path
                ? `<img src="${resolvePaymentProofUrl(payment.payment_screenshot_path)}" alt="GCash payment screenshot" class="img-fluid rounded-3" style="max-height: 420px; object-fit: contain;">`
                : '<div class="text-muted py-5">No payment screenshot was uploaded for this record.</div>';

            Swal.fire({
                title: 'Payment Proof',
                width: '720px',
                showCloseButton: true,
                showCancelButton: true,
                cancelButtonText: 'Close',
                showConfirmButton: canReviewPendingPayment || canViewReceipt(payment),
                confirmButtonText: canReviewPendingPayment ? 'Receive' : 'View Receipt',
                confirmButtonColor: canReviewPendingPayment ? '#198754' : '#5a67d8',
                showDenyButton: canReviewPendingPayment,
                denyButtonText: 'Decline',
                denyButtonColor: '#dc3545',
                reverseButtons: true,
                html: `
                    <div class="text-start">
                        <label class="form-label fw-bold text-secondary small mb-1">GCash Payment Screenshot</label>
                        <div class="border rounded-3 p-2 bg-light text-center mb-3">
                            ${screenshotHtml}
                        </div>
                        <div class="mb-3">
                            <label class="form-label fw-bold text-secondary small mb-1">Payment Amount</label>
                            <div class="input-group">
                                <span class="input-group-text bg-white text-muted">₱</span>
                                <input type="text" class="form-control" value="${amountValue}" readonly>
                            </div>
                        </div>
                        <div>
                            <label class="form-label fw-bold text-secondary small mb-1">GCash Reference Number</label>
                            <input type="text" class="form-control" value="${payment.reference_no || ''}" readonly>
                        </div>
                    </div>
                `
            }).then(result => {
                if (result.isDenied && canReviewPendingPayment) {
                    performPaymentStatusUpdate(payment.payment_id, 'Declined');
                    return;
                }

                if (!result.isConfirmed) {
                    return;
                }

                if (canReviewPendingPayment) {
                    performPaymentStatusUpdate(payment.payment_id, 'Received');
                    return;
                }

                if (!canViewReceipt(payment)) {
                    return;
                }

                showPaymentReceiptModal(payment);
            });
        };

        let tableHtml = `
            <div class="payment-history-status-row">
                <span class="payment-enrollment-status payment-enrollment-status--${enrollmentStatusTone}">
                    <i class="bi ${enrollmentStatusIcon}" aria-hidden="true"></i>
                    <span>Status: ${statusLabel}</span>
                </span>
            </div>
            <div class="payment-history-table-wrap">
                <table class="payment-history-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Paid For</th>
                            <th>Amount</th>
                            <th>Payment Method</th>
                            <th>Reference No.</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (history.length > 0) {
            history.forEach(payment => {
                const amountPaid = parseFloat(payment.amount_paid || 0);
                const penaltyPaid = parseFloat(payment.penalty_paid || 0);
                const baseAmountPaid = parseFloat(payment.base_amount_paid ?? Math.max(amountPaid - penaltyPaid, 0));
                const amountBreakdown = amountPaid
                    ? `PHP ${amountPaid.toLocaleString()}${penaltyPaid > 0
                        ? `<div class="small text-muted">Base: PHP ${baseAmountPaid.toLocaleString()} + <span class="text-danger">Penalty: PHP ${penaltyPaid.toLocaleString()}</span></div>`
                        : ''}`
                    : 'N/A';
                const normalizedPaymentStatus = String(payment.payment_status || '').toLowerCase();
                const paymentStatusTone = normalizedPaymentStatus === 'received'
                    ? 'success'
                    : normalizedPaymentStatus === 'pending'
                        ? 'pending'
                        : 'danger';
                const paymentStatusIcon = paymentStatusTone === 'success'
                    ? 'bi-check-circle-fill'
                    : paymentStatusTone === 'pending'
                        ? 'bi-clock-fill'
                        : 'bi-x-circle-fill';
                let actionButtons = '<span class="text-muted">-</span>';
                if (showActions && payment.payment_status === 'Pending') {
                    const pendingButtons = [];
                    if (isGcashPayment(payment)) {
                        pendingButtons.push(`<button type="button" class="payment-history-action view-payment-proof" data-receipt-key="${getReceiptKey(payment)}"><i class="bi bi-image"></i>View Proof</button>`);
                        actionButtons = pendingButtons.join(' ');
                    } else {
                        pendingButtons.push(`<button type="button" class="payment-history-action payment-history-action--receive admin-payment-action" data-payment-id="${payment.payment_id}" data-status="Received"><i class="bi bi-check-lg"></i>Receive</button>`);
                        pendingButtons.push(`<button type="button" class="payment-history-action payment-history-action--decline admin-payment-action" data-payment-id="${payment.payment_id}" data-status="Declined"><i class="bi bi-x-lg"></i>Decline</button>`);
                        actionButtons = pendingButtons.join(' ');
                    }
                } else if (canViewReceipt(payment)) {
                    actionButtons = isGcashPayment(payment)
                        ? `<button type="button" class="payment-history-action view-payment-proof" data-receipt-key="${getReceiptKey(payment)}"><i class="bi bi-image"></i>View Proof</button>`
                        : `<button type="button" class="payment-history-action view-payment-receipt" data-receipt-key="${getReceiptKey(payment)}"><i class="bi bi-receipt"></i>View Receipt</button>`;
                } else if (isGcashPayment(payment)) {
                    actionButtons = `<button type="button" class="payment-history-action view-payment-proof" data-receipt-key="${getReceiptKey(payment)}"><i class="bi bi-image"></i>View Proof</button>`;
                }

                tableHtml += `
                    <tr>
                        <td data-label="Date">${payment.payment_date || 'N/A'}</td>
                        <td data-label="Paid For">${payment.payment_type || payment.billing_type || 'N/A'}</td>
                        <td data-label="Amount">${amountBreakdown}</td>
                        <td data-label="Payment Method">${payment.payment_method || 'N/A'}</td>
                        <td data-label="Reference No.">${payment.reference_no || 'N/A'}</td>
                        <td data-label="Status"><span class="payment-row-status payment-row-status--${paymentStatusTone}"><i class="bi ${paymentStatusIcon}"></i>${payment.payment_status || 'N/A'}</span></td>
                        <td data-label="Actions"><div class="payment-history-actions">${actionButtons}</div></td>
                    </tr>
                `;
            });
        } else {
            tableHtml += '<tr><td colspan="7" class="payment-history-empty">No payment history found.</td></tr>';
        }

        tableHtml += `
                    </tbody>
                </table>
            </div>
        `;

        const performPaymentStatusUpdate = (paymentId, status) => {
            axios.post('../../api/admin/payment.php', {
                operation: 'updatePaymentStatus',
                json: JSON.stringify({ payment_id: paymentId, payment_status: status })
            }).then(res => {
                if (res.data.status === 'success') {
                    window.dispatchEvent(new CustomEvent('payment-status-updated', {
                        detail: { paymentId, status, enrollmentDetailsId: enrollment_details_id }
                    }));
                    Swal.fire('Success', `Payment has been marked as ${status}.`, 'success')
                        .then(() => {
                            paginationManager?.refresh();
                            loadEnrollmentStats();
                            openPrePlayPaymentHistoryModal(enrollment_details_id, effectiveViewOnly);
                        });
                } else {
                    Swal.fire('Error', res.data.message || 'Failed to update payment status.', 'error');
                }
            }).catch(err => {
                console.error(err);
                Swal.fire('Error', 'Network error while updating payment status.', 'error');
            });
        };

        Swal.fire({
            title: `Payment History - ${studentName}`,
            html: tableHtml,
            width: 'min(92vw, 1050px)',
            showCloseButton: true,
            showCancelButton: false,
            confirmButtonText: 'Close',
            reverseButtons: true,
            buttonsStyling: false,
            customClass: {
                popup: 'payment-history-popup',
                title: 'payment-history-title',
                htmlContainer: 'payment-history-content',
                closeButton: 'payment-history-x',
                confirmButton: 'payment-history-close'
            },
            didOpen: () => {
                document.querySelectorAll('.view-payment-proof').forEach(button => {
                    button.addEventListener('click', () => {
                        const receiptKey = button.getAttribute('data-receipt-key');
                        const payment = history.find(item => getReceiptKey(item) === receiptKey);
                        if (!payment) {
                            Swal.fire('Error', 'Payment proof is not available.', 'error');
                            return;
                        }

                        showPaymentProofModal(payment);
                    });
                });
                document.querySelectorAll('.view-payment-receipt').forEach(button => {
                    button.addEventListener('click', () => {
                        const receiptKey = button.getAttribute('data-receipt-key');
                        const payment = history.find(item => getReceiptKey(item) === receiptKey);
                        if (!payment) {
                            Swal.fire('Error', 'Receipt is not available.', 'error');
                            return;
                        }

                        showPaymentReceiptModal(payment);
                    });
                });
                if (showActions) {
                    document.querySelectorAll('.admin-payment-action').forEach(button => {
                        button.addEventListener('click', () => {
                            const paymentId = button.getAttribute('data-payment-id');
                            const status = button.getAttribute('data-status');
                            if (paymentId && status) {
                                performPaymentStatusUpdate(paymentId, status);
                            }
                        });
                    });
                }
            }
        });
    })
    .catch(err => {
        console.error(err);
        Swal.fire('Error', 'An error occurred while fetching payment history.', 'error');
    });
}

window.openPaymentHistoryModal = openPrePlayPaymentHistoryModal;
window.openPrePlayPaymentHistoryModal = openPrePlayPaymentHistoryModal;

document.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname.includes('payment_pre_play.html') || window.location.pathname.includes('enrollement_pre_play.html')) {
        window.openPaymentHistoryModal = openPrePlayPaymentHistoryModal;
    }
});
