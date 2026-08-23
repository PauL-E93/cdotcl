import { applyEnrollmentPagePermissions, canUseEnrollmentPermission, guardEnrollmentPermission, initEnrollmentPermissions, shouldApplyEnrollmentRbac } from './enrollment_rbac.js';
import { applyPaymentPagePermissions, canUsePaymentPermission, guardPaymentPermission, initPaymentPermissions, isPaymentModulePage, shouldApplyPaymentRbac } from './payment_rbac.js';
import { startAutoRefresh } from '../utilities/auto_refresh.js';

// js/modules/view_enrollment.js

let editSchedules = [];
let schedulesModified = false;  // Track if schedules were modified
let paginationManager;
let currentEnrollmentDetails = null;
let currentViewOnly = true;
const PAYMENT_PAGE_REFRESH_MS = 15000;
const enrollmentFilters = {
    search: '',
    status: '',
    subject: '',
    branch: '',
    enrollment_date: '',
    summary: 'total'
};

function formatStudentName(details = {}) {
    return [details.first_name, details.last_name, details.ext]
        .filter(part => part && part.toString().trim())
        .map(part => part.toString().trim())
        .join(' ');
}

function formatScheduleDisplay(value) {
    if (!value) return 'None';

    const text = String(value).trim();
    if (!text || text.toLowerCase() === 'none') return 'None';

    const formatTimeValue = timeValue => {
        const raw = String(timeValue || '').trim();
        if (!raw) return '';

        const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
        if (!match) return raw;

        let hour = Number(match[1]);
        const minute = match[2] || '00';
        const periodInput = match[3]?.toUpperCase();

        let period = periodInput || (hour >= 12 ? 'PM' : 'AM');
        if (!periodInput && hour >= 12) {
            period = 'PM';
        }

        if (periodInput === 'AM' && hour === 12) {
            hour = 0;
        } else if (periodInput === 'PM' && hour < 12) {
            hour += 12;
        }

        const normalizedHour = hour % 12 || 12;
        const displayMinute = minute === '00' ? '' : `:${minute}`;
        return `${normalizedHour}${displayMinute}${period.toLowerCase()}`;
    };

    const entries = text
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean);

    const formattedEntries = entries.map(entry => {
        const dayMatch = entry.match(/^([A-Za-z]+)\s+(.+)$/);
        if (!dayMatch) return entry;

        const day = dayMatch[1].charAt(0).toUpperCase() + dayMatch[1].slice(1);
        const timePart = dayMatch[2].trim();
        const rangeParts = timePart.split(/\s*(?:-|to)\s*/i).map(part => part.trim()).filter(Boolean);

        if (rangeParts.length === 0) {
            return `${day}`;
        }

        const [startTime, endTime] = rangeParts;
        const formattedStart = formatTimeValue(startTime);
        const formattedEnd = endTime ? formatTimeValue(endTime) : '';

        return formattedEnd
            ? `${day} ${formattedStart} - ${formattedEnd}`
            : `${day} ${formattedStart}`;
    });

    return formattedEntries.join('<br>');
}

function prepareEnrollmentModalLayout() {
    const modal = document.getElementById('viewEnrollmentModal');
    if (!modal || modal.dataset.enrollmentLayoutPrepared === 'true') return;

    modal.classList.add('preplay-enrollment-view');
    modal.querySelector('.modal-dialog')?.classList.add('preplay-view-dialog');

    const header = modal.querySelector('.modal-header');
    header?.classList.remove('bg-primary', 'text-white');

    const title = modal.querySelector('.modal-title');
    if (title && !title.querySelector('.preplay-modal-title-icon')) {
        title.innerHTML = '<span class="preplay-modal-title-icon" aria-hidden="true"><i class="bi bi-person"></i></span>Manage Enrollment';
    }

    const closeButton = modal.querySelector('.modal-header .btn-close');
    closeButton?.classList.remove('btn-close-white');

    const studentCard = modal.querySelector('.modal-body > .alert.alert-light.border');
    if (studentCard) {
        studentCard.classList.add('preplay-view-card', 'preplay-student-card');

        const heading = studentCard.querySelector(':scope > h6, :scope > h5');
        if (heading && !heading.querySelector('.preplay-section-icon')) {
            heading.innerHTML = '<span class="preplay-section-icon" aria-hidden="true"><i class="bi bi-person"></i></span>' + (heading.textContent || 'Student Information').trim();
        }

        const row = studentCard.querySelector(':scope > .row');
        if (row) {
            row.innerHTML = `
                <div class="col-md-4 preplay-view-field">
                    <label class="small text-muted">Student Name</label>
                    <div class="fw-bold" id="view_student_name">...</div>
                </div>
                <div class="col-md-4 preplay-view-field">
                    <label class="small text-muted">Program</label>
                    <div class="fw-bold" id="view_program">...</div>
                </div>
                <div class="col-md-4 preplay-view-field">
                    <label class="small text-muted">Branch</label>
                    <div class="fw-bold" id="view_branch">...</div>
                </div>
                <div class="col-md-4 preplay-view-field">
                    <label class="small text-muted">Student ID</label>
                    <div class="fw-bold" id="view_student_id">...</div>
                </div>
                <div class="col-md-4 preplay-view-field preplay-status-field">
                    <label class="small text-muted">Status</label>
                    <div class="preplay-status-pill" id="view_status">...</div>
                </div>
                <div class="col-md-4 preplay-view-field">
                    <label class="small text-muted">Subject &amp; Grade</label>
                    <div class="fw-bold" id="view_subject_grade">...</div>
                </div>
                <div class="col-md-4 preplay-view-field">
                    <label class="small text-muted">Preferred Teacher</label>
                    <div class="fw-bold" id="view_teacher_ro">...</div>
                </div>
                <div class="col-md-4 preplay-view-field">
                    <label class="small text-muted">Schedule</label>
                    <div class="fw-bold" id="view_schedule_ro">...</div>
                </div>
                <div class="col-12 preplay-view-field">
                    <label class="small text-muted">Goal</label>
                    <div class="fst-italic" id="view_goal">...</div>
                </div>
            `;
        }
    }

    modal.dataset.enrollmentLayoutPrepared = 'true';
}

function resolvePaymentProofUrl(proofPath) {
    if (!proofPath) return '';
    if (/^(?:https?:)?\/\//.test(proofPath)) {
        return proofPath;
    }

    const cleaned = String(proofPath).replace(/^\/+/, '');
    return `../../${cleaned}`;
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
    if (window.location.pathname.includes('/student/')) return;

    if (window.location.pathname.includes('payment.html') || window.location.pathname.includes('enrollement.html')) {
        if (window.location.pathname.includes('payment.html') && shouldApplyPaymentRbac()) {
            await initPaymentPermissions();
            const access = applyPaymentPagePermissions();
            if (!access.allowed) {
                return;
            }
        }

        if (window.location.pathname.includes('enrollement.html') && shouldApplyEnrollmentRbac()) {
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

function getTutorialListUrl(summaryFilter = 'total') {
    enrollmentFilters.summary = summaryFilter || 'total';
    const params = new URLSearchParams();
    params.append('type', 'tutorial');
    if (window.location.pathname.includes('/owner/enrollement.html')) {
        params.append('include_applications', '1');
    }

    if (enrollmentFilters.summary && enrollmentFilters.summary !== 'total') {
        params.append('summary_filter', enrollmentFilters.summary);
    }
    if (enrollmentFilters.search) {
        params.append('search', enrollmentFilters.search);
    }
    if (enrollmentFilters.status) {
        params.append('status', enrollmentFilters.status);
    }
    if (enrollmentFilters.subject) {
        params.append('subject', enrollmentFilters.subject);
    }
    if (enrollmentFilters.branch) {
        params.append('branch_id', enrollmentFilters.branch);
    }
    if (enrollmentFilters.enrollment_date) {
        params.append('enrollment_date', enrollmentFilters.enrollment_date);
    }

    return `../../api/admin/enrollment.php?operation=getEnrollments&${params.toString()}`;
}

function initializePagination() {
    const tableBody = document.getElementById('paymentTableBody');
    const paginationContainer = document.querySelector('.d-flex.justify-content-between.align-items-center.mt-4 nav');

    if (!tableBody || !paginationContainer) return;
    setupSingleActionDropdown(tableBody);

    paginationManager = new PaginationManager({
        container: paginationContainer,
        apiUrl: getTutorialListUrl(),
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

function setupEnrollmentFilterControls() {
    const searchInput = document.getElementById('search-input');
    const statusSelect = document.getElementById('enrollment-status-filter');
    const subjectSelect = document.getElementById('enrollment-subject-filter');
    const branchSelect = document.getElementById('enrollment-branch-filter');
    const dateInput = document.getElementById('enrollment-date-filter');
    const applyButton = document.getElementById('enrollment-apply-filters');

    if (!paginationManager) return;

    let searchTimer = null;
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                enrollmentFilters.search = searchInput.value.trim();
                paginationManager.apiUrl = getTutorialListUrl(enrollmentFilters.summary);
                paginationManager.loadPage(1);
            }, 250);
        });

        searchInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                clearTimeout(searchTimer);
                enrollmentFilters.search = searchInput.value.trim();
                paginationManager.apiUrl = getTutorialListUrl(enrollmentFilters.summary);
                paginationManager.loadPage(1);
            }
        });
    }

    if (statusSelect) {
        statusSelect.addEventListener('change', () => {
            enrollmentFilters.status = statusSelect.value;
            paginationManager.apiUrl = getTutorialListUrl(enrollmentFilters.summary);
            paginationManager.loadPage(1);
        });
    }

    if (subjectSelect) {
        subjectSelect.addEventListener('change', () => {
            enrollmentFilters.subject = subjectSelect.value;
            paginationManager.apiUrl = getTutorialListUrl(enrollmentFilters.summary);
            paginationManager.loadPage(1);
        });
    }

    if (branchSelect) {
        branchSelect.addEventListener('change', () => {
            enrollmentFilters.branch = branchSelect.value;
            paginationManager.apiUrl = getTutorialListUrl(enrollmentFilters.summary);
            paginationManager.loadPage(1);
        });
    }

    if (dateInput) {
        dateInput.addEventListener('change', () => {
            enrollmentFilters.enrollment_date = dateInput.value;
            paginationManager.apiUrl = getTutorialListUrl(enrollmentFilters.summary);
            paginationManager.loadPage(1);
        });
    }

    if (applyButton) {
        applyButton.addEventListener('click', () => {
            enrollmentFilters.search = searchInput?.value.trim() || '';
            enrollmentFilters.status = statusSelect?.value || '';
            enrollmentFilters.subject = subjectSelect?.value || '';
            enrollmentFilters.branch = branchSelect?.value || '';
            enrollmentFilters.enrollment_date = dateInput?.value || '';
            paginationManager.apiUrl = getTutorialListUrl(enrollmentFilters.summary);
            paginationManager.loadPage(1);
        });
    }
}

function populateEnrollmentStatusOptions(statusSelect, statuses = []) {
    if (!statusSelect) return;
    statusSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'All Status';
    statusSelect.appendChild(placeholder);

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

function loadEnrollmentFilterLookups() {
    axios.get("../../api/admin/enrollment.php?operation=getLookups")
        .then(res => {
            const data = res.data || {};
            const statusSelect = document.getElementById('enrollment-status-filter');
            const subjectSelect = document.getElementById('enrollment-subject-filter');
            const branchSelect = document.getElementById('enrollment-branch-filter');

            if (Array.isArray(data.statuses)) {
                populateEnrollmentStatusOptions(statusSelect, [...new Set(data.statuses)]);
            }
            if (Array.isArray(data.subjects)) {
                populateEnrollmentSubjectOptions(subjectSelect, data.subjects);
            }
            if (Array.isArray(data.branches)) {
                populateEnrollmentBranchOptions(branchSelect, data.branches);
            }
        })
        .catch(err => console.error('Error loading enrollment filter lookups:', err));
}

function setupEnrollmentSummaryFilters() {
    const cards = document.querySelectorAll('.enrollment-summary-card[data-enrollment-filter]');

    cards.forEach(card => {
        const applyFilter = () => {
            if (!paginationManager) return;

            enrollmentFilters.summary = card.dataset.enrollmentFilter || 'total';
            cards.forEach(item => item.setAttribute('aria-pressed', String(item === card)));
            paginationManager.apiUrl = getTutorialListUrl(enrollmentFilters.summary);
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
        exportEnrollmentTable().catch(error => {
            console.error('Enrollment export failed:', error);
            Swal.fire('Export failed', error.message || 'Please try again.', 'error');
        });
    });
}

function getEnrollmentExportData() {
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

async function getAllEnrollmentExportData() {
    const totalItems = Number(paginationManager?.totalItems || 0);
    if (totalItems < 1) return null;

    const response = await axios.get(`${getTutorialListUrl(enrollmentFilters.summary)}&page=1&limit=${totalItems}`);
    if (response.data?.status !== 'success') {
        throw new Error(response.data?.message || 'Unable to load all enrollment records.');
    }

    const paymentPage = isPaymentModulePage();
    const headers = ['School ID', 'Student Name', 'Subject', 'Tutor', 'Enrollment Date', 'Status'];
    const rows = (response.data.data || []).map(item => [
        item.student_id_number || item.student_id || 'N/A',
        item.student_name || 'N/A',
        item.subject_name || 'N/A',
        item.teacher_name || 'Not assigned',
        item.enrollment_date || 'N/A',
        paymentPage
            ? (String(item.status || '').toLowerCase() === 'incomplete' ? 'Incomplete' : (item.payment_status || 'Unpaid'))
            : (item.status || 'N/A').toUpperCase()
    ]);

    return rows.length ? { headers, rows } : null;
}

function downloadEnrollmentExport(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function exportEnrollmentTable() {
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
                <label for="enrollment-export-scope" class="form-label fw-semibold">Records to export</label>
                <select id="enrollment-export-scope" class="form-select mb-3">
                    <option value="current">Current page (rows shown)</option>
                    <option value="all">Whole table (all filtered records)</option>
                </select>
                <label for="enrollment-export-format" class="form-label fw-semibold">File format</label>
                <select id="enrollment-export-format" class="form-select">
                    <option value="pdf">PDF</option>
                    <option value="csv">CSV</option>
                    <option value="xlsx">Excel (.xlsx)</option>
                </select>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Export',
        preConfirm: () => ({
            scope: document.getElementById('enrollment-export-scope')?.value || 'current',
            format: document.getElementById('enrollment-export-format')?.value || 'pdf'
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
        ? await getAllEnrollmentExportData()
        : getEnrollmentExportData();
    if (!data) {
        Swal.fire('Nothing to export', 'There are no enrollment records to export.', 'info');
        return;
    }

    const date = new Date().toISOString().slice(0, 10);
    const filename = `tutorial-${paymentPage ? 'payments' : 'enrollments'}-${date}`;

    if (result.value.format === 'pdf') {
        if (!window.jspdf?.jsPDF) throw new Error('PDF export library is unavailable.');
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: data.headers.length > 5 ? 'landscape' : 'portrait' });
        pdf.setFontSize(16);
        pdf.text(`Tutorial ${paymentPage ? 'Payment' : 'Enrollment'} List`, 14, 16);
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
        downloadEnrollmentExport(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' }), `${filename}.csv`);
    } else if (result.value.format === 'xlsx') {
        if (!window.XLSX) throw new Error('Excel export library is unavailable.');
        const worksheet = window.XLSX.utils.aoa_to_sheet([data.headers, ...data.rows]);
        const workbook = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Enrollments');
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
        const programName = (item.program_name || '').toLowerCase();
        const enrollmentLifecycleStatus = String(item.status || '').toLowerCase();
        const paymentStatus = enrollmentLifecycleStatus === 'incomplete'
            ? 'Incomplete'
            : (item.payment_status || 'Unpaid');
        const applicationStatusLabels = {
            pending_review: 'PENDING',
            approved_for_payment: 'AWAITING CENTER PAYMENT',
            ready_for_scheduling: 'READY FOR SCHEDULING'
        };
        const applicationStatus = String(item.application_status || '').toLowerCase();
        const isPendingOnlineApplication = Boolean(item.application_id && applicationStatusLabels[applicationStatus]);
        const displayStatus = isPaymentPage
            ? paymentStatus
            : (applicationStatusLabels[applicationStatus] || (item.status || '').toUpperCase());

        let statusBadge;
        if (isPaymentPage) {
            const paymentStatusClasses = {
                'Fully Paid': 'success',
                'Partial': 'warning',
                'Pending': 'warning text-dark',
                'Unpaid': 'danger',
                'Incomplete': 'warning text-dark'
            };
            statusBadge = paymentStatusClasses[paymentStatus] || 'secondary';
        } else {
            if (isPendingOnlineApplication) {
                statusBadge = applicationStatus === 'ready_for_scheduling' ? 'primary' : 'warning text-dark';
            } else switch (enrollmentLifecycleStatus) {
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
        const status = (item.status || '').toLowerCase().trim();
        const tutorialEnrollmentSessionRoles = ['owner', 'teacher', 'branch_admin', 'auditor', 'secretary'];
        const isSupportedTutorialEnrollmentPage = tutorialEnrollmentSessionRoles.some(role =>
            window.location.pathname.endsWith(`/${role}/enrollement.html`)
        );
        const canOpenEnrollmentSession = isSupportedTutorialEnrollmentPage
            && ['pending', 'active', 'enrolled', 'completed', 'session done'].includes(status);
        const openSessionAction = canOpenEnrollmentSession
            ? `<li><a class="dropdown-item" href="./session.html?enrollment_details_id=${item.enrollment_details_id}">Session</a></li>`
            : '';
        const canComplete = status === 'incomplete' && !isStudentPage() && document.getElementById('enrollmentDetailsModal');
        const canViewModule = canUseEnrollmentPermission('view');
        const canCreateEnrollment = canUseEnrollmentPermission('create');
        const canEditEnrollment = canUseEnrollmentPermission('edit');
        const canApproveEnrollment = canUseEnrollmentPermission('approve');
        const canExportEnrollment = canUseEnrollmentPermission('export');
        const canCreatePayment = canUsePaymentPermission('create');
        const canApprovePayment = canUsePaymentPermission('approve');
        const canExportPayment = canUsePaymentPermission('export');

        if (isPaymentPage) {
            const safeProgramName = (item.program_name || '').replace(/'/g, "\\'");
            const payCall = isPreschoolPage
                ? `openBillingPlayPreModal(${item.enrollment_details_id})`
                : `openBillingModalByProgram(${item.enrollment_details_id}, '${safeProgramName}')`;
            const paymentActions = [
                `<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); ${payCall}"><i class="bi bi-credit-card me-2"></i>${canCreatePayment ? 'Pay' : 'View Billing'}</a></li>`,
                `<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); openPaymentHistoryModal(${item.enrollment_details_id}, ${!canApprovePayment})"><i class="bi bi-eye me-2"></i>View</a></li>`
            ];
            if (canExportPayment) {
                paymentActions.push(`<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); window.exportTutorialBillingStatement(${item.enrollment_details_id})"><i class="bi bi-download me-2"></i>Export</a></li>`);
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

        if (!window.location.pathname.includes('payment.html') && isPendingOnlineApplication) {
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
        } else if (!window.location.pathname.includes('payment.html')) {
            if (status === 'pending' && !isStudentPage()) {
                const pendingActions = [];
                if (canApproveEnrollment) {
                    pendingActions.push(`<li><a class="dropdown-item text-primary fw-semibold" href="#" onclick="event.preventDefault(); openPaymentHistoryModal(${item.enrollment_details_id})">Review</a></li>`);
                }
                if (openSessionAction) {
                    pendingActions.push(openSessionAction);
                }

                if (pendingActions.length > 0) {
                    actionButtons += `
                        <div class="dropdown" onclick="event.stopPropagation();">
                            <button class="btn btn-sm btn-outline-secondary border-0" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                                <i class="bi bi-three-dots-vertical"></i>
                            </button>
                            <ul class="dropdown-menu dropdown-menu-end">
                                ${pendingActions.join('')}
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
                                <li><a class="dropdown-item text-primary fw-semibold" href="#" onclick="event.preventDefault(); openPendingEnrollmentCompletion(${item.enrollment_details_id}, 'tutorial')">Complete</a></li>
                            </ul>
                        </div>
                    `;
                }
            } else if (status !== 'incomplete') {
                const enrollmentActions = [];
                if (canViewModule) {
                    enrollmentActions.push(`<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); viewDetails(${item.enrollment_details_id}, true)">View</a></li>`);
                }
                if (openSessionAction) {
                    enrollmentActions.push(openSessionAction);
                }
                if (canApproveEnrollment && canComplete) {
                    enrollmentActions.push(`<li><a class="dropdown-item text-primary fw-semibold" href="#" onclick="event.preventDefault(); openPendingEnrollmentCompletion(${item.enrollment_details_id}, 'tutorial')">Complete</a></li>`);
                }
                if (canEditEnrollment) {
                    enrollmentActions.push(`<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); editEnrollment(${item.enrollment_details_id})">Edit</a></li>`);
                }
                if (canExportEnrollment) {
                    enrollmentActions.push(`<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); printORF(${item.enrollment_details_id})">Print ORF</a></li>`);
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

        const row = `
            <tr>
                <td>${item.student_id_number || item.student_id || 'N/A'}</td>
                <td>${item.student_name}</td>
                <td>${item.subject_name || 'N/A'}</td>
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
    const includeApplications = window.location.pathname.includes('/owner/enrollement.html') ? '&include_applications=1' : '';
    axios.get(`../../api/admin/enrollment.php?operation=getEnrollmentStats&type=tutorial${includeApplications}`)
    .then(res => {
        if (res.data.status === 'success') {
            const stats = res.data.data;
            if(document.getElementById('total_enrollments')) {
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

window.editEnrollment = function(id) {
    if (!guardEnrollmentPermission('edit', 'You do not have permission to update enrollment records.')) {
        return;
    }

    if (typeof window.openFullEnrollmentEditor === 'function') {
        window.openFullEnrollmentEditor(id);
        return;
    }

    Swal.fire('Editor Not Loaded', 'The full enrollment editor is not available on this page.', 'error');
};

function isStudentPage() {
    return window.location.pathname.includes('/student/');
}

function isPrePlayEnrollmentPage() {
    return window.location.pathname.includes('enrollement_pre_play.html');
}

function canEditClassSection() {
    return !isStudentPage() && isPrePlayEnrollmentPage();
}

function getCurrentClassId(details) {
    return details.class_id_from_section || details.class_id || '';
}

function formatClassLabel(item) {
    const branch = item.branch_name ? ` (${item.branch_name})` : '';
    return `${item.program_name || 'Class ' + item.class_id}${branch}`;
}

function setSelectOptions(select, items, placeholder, valueKey, labelBuilder) {
    select.innerHTML = '';
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = placeholder;
    select.appendChild(placeholderOption);

    items.forEach(item => {
        const option = document.createElement('option');
        option.value = item[valueKey];
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

function setEnrollmentModalMode(viewOnly) {
    const form = document.getElementById('updateEnrollmentForm');
    const saveButton = document.querySelector('#viewEnrollmentModal .modal-footer .btn-primary');
    const updateHeading = form?.previousElementSibling;

    if (form) {
        form.style.display = viewOnly ? 'none' : '';
    }

    if (updateHeading && updateHeading.tagName === 'H6') {
        updateHeading.style.display = viewOnly ? 'none' : '';
    }

    if (saveButton) {
        saveButton.style.display = viewOnly || isStudentPage() ? 'none' : '';
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
        return matchesProgram && (!status || status === 'open' || status === 'active');
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
                ? schedules.map(s => `${s.day} ${s.start || ''}${s.end ? ' - ' + s.end : ''}`.trim()).join(', ')
                : 'Not set';
        })
        .catch(err => {
            console.error('Error loading section schedule:', err);
            scheduleEl.innerText = 'Not set';
        });
}



window.viewDetails = function(id, viewOnly = true) {
    if (!guardEnrollmentPermission('view', 'You do not have permission to view the enrollment module.')) {
        return;
    }

    console.log('viewDetails called with id:', id);
    prepareEnrollmentModalLayout();
    currentViewOnly = viewOnly !== false;
    restoreClassSectionReadOnlyFields();

    // Load Teachers and Details in parallel
    Promise.all([
        axios.get("../../api/admin/enrollment.php?operation=getLookups"),
        axios.get(`../../api/admin/enrollment.php?operation=getEnrollmentDetails&id=${id}`)
    ])
    .then(([resLookup, resDetails]) => {
        console.log('Data loaded:', resDetails.data);
        if (resDetails.data.status === 'success') {
            editSchedules = [];
            schedulesModified = false;  // Reset modification flag when loading details

            const teachers = resLookup.data.teachers;
            const d = resDetails.data.data.details;
            const scheds = resDetails.data.data.schedule;
            currentEnrollmentDetails = d;

            // Setup safe setter to avoid missing fields
            const setText = (id, text) => {
                const el = document.getElementById(id);
                if (el) el.innerText = text;
            };

            // -- FILL READ-ONLY INFO --
            setText('view_student_name', formatStudentName(d));
            setText('view_student_id', d.student_id_number || d.student_id || 'N/A');
            setText('view_program', d.program_name || 'N/A');
            setText('view_subject_grade', (d.subject_name || 'N/A') + ' (' + (d.grade_level || '?') + ')');
            setText('view_teacher_ro', d.teacher_name || 'Not assigned');
            setText('view_branch', d.branch_name || 'N/A');
            const classText = d.class_id_from_section || d.class_id;
            setText('view_class', classText ? ('Class ' + classText) : 'N/A');
            setText('view_section', d.section_name || 'N/A');

            const sectionTeacher = d.section_teacher_name || d.teacher_name || 'Not assigned';
            setText('view_section_teacher', sectionTeacher);

            const sectionScheds = resDetails.data.data.section_schedule || [];
            const sectionSchedText = sectionScheds.length > 0 
                ? sectionScheds.map(s => `${s.day} ${s.start_time || ''}${s.end_time ? ' - ' + s.end_time : ''}`.trim()).join(', ') 
                : 'Not set';
            setText('view_section_schedule', sectionSchedText);

            const scheduleField = document.getElementById('view_schedule_ro');
            if (scheduleField) {
                scheduleField.innerHTML = formatScheduleDisplay(d.preferred_time_day || 'None');
            }
            setText('view_status', (d.status || 'N/A').toUpperCase());
            setText('view_goal', d.goal || 'No goal set');
            renderStudentAddress(d);

            const schoolYearLabel = d.school_year_label || 'N/A';
            const viewSchoolYearEl = document.getElementById('view_school_year');
            if (viewSchoolYearEl) {
                viewSchoolYearEl.innerText = schoolYearLabel;
            } else {
                const branchWrapper = document.getElementById('view_branch')?.parentElement;
                if (branchWrapper) {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'col-md-6';
                    wrapper.innerHTML = `<label class="small text-muted">School Year</label><div class="fw-bold" id="view_school_year">${schoolYearLabel}</div>`;
                    branchWrapper.insertAdjacentElement('afterend', wrapper);
                }
            }

            // -- FILL EDITABLE FIELDS --
            const updateIdEl = document.getElementById('update_enrollment_id');
            if (updateIdEl) {
                updateIdEl.value = d.enrollment_details_id;
            }

            setEnrollmentModalMode(currentViewOnly);

            // Set teachers (if exists)
            const select = document.getElementById('update_teacher');
            if (select) {
                select.innerHTML = '<option value="">Select Teacher</option>';
                teachers.forEach(t => {
                    select.innerHTML += `<option value="${t.employee_id}">${t.name}</option>`;
                });

                if (d.preferred_teacher) {
                    select.value = d.preferred_teacher;
                } else {
                    select.value = '';
                }
            }

            // School year is determined automatically by the active school year at creation
            // and should not be edited manually in the update modal.
            if (!currentViewOnly) {
                setupClassSectionControls(resLookup.data || {}, d);
            }

            // -- FILL SCHEDULE TABLE --
            if(scheds && scheds.length > 0) {
                scheds.forEach(s => {
                    editSchedules.push({ 
                        day: s.day, 
                        time: s.start_time,
                        endTime: s.end_time || null,
                        date: s.date
                    });
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
                
                // Apply system theme: replace blue bg-primary with pink #ea9aa6
                const modalHeader = modalElement.querySelector('.modal-header');
                if (modalHeader) {
                    modalHeader.style.backgroundColor = '#ea9aa6';
                    modalHeader.classList.remove('bg-primary', 'text-white');
                    modalHeader.classList.add('text-dark');
                }
                
                // Theme primary buttons to match system pink
                const primaryBtns = modalElement.querySelectorAll('.btn-primary');
                primaryBtns.forEach(btn => {
                    btn.style.backgroundColor = '#ea9aa6';
                    btn.style.borderColor = '#ea9aa6';
                    btn.classList.add('btn-theme');
                });
            } else {
                console.error('Modal element not found');
            }
        }
    })
    .catch(err => console.error("Error loading details:", err));
};

// Helper function to get next or same date for a given day
function getNextOrSameDateForDay(dayName) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = new Date();
    const todayDay = today.getDay();
    const targetDay = days.indexOf(dayName);
    
    if (targetDay === -1) return today.toISOString().split('T')[0];
    
    let delta = targetDay - todayDay;
    if (delta <= 0) {
        delta += 7;
    }
    
    const nextDate = new Date(today);
    nextDate.setDate(nextDate.getDate() + delta);
    
    return nextDate.toISOString().split('T')[0];
}

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

// --- 5. SCHEDULE LOGIC ---
window.addEditScheduleRow = function() {
    if (currentViewOnly) return;

    const day = document.getElementById('edit_sched_day').value;
    const time = document.getElementById('edit_sched_time').value;
    
    if(!day || !time) return Swal.fire('Error', 'Please select day and time', 'warning');
    
    const date = getNextOrSameDateForDay(day);
    editSchedules.push({ day, time, date });
    schedulesModified = true;  // Mark as modified
    renderEditScheduleTable();
    document.getElementById('edit_sched_time').value = '';
    
    // Update teacher dropdown based on new schedule
    updateTeachersBySchedule();
};

window.removeEditScheduleRow = function(index) {
    if (currentViewOnly) return;

    editSchedules.splice(index, 1);
    schedulesModified = true;  // Mark as modified
    renderEditScheduleTable();
    
    // Update teacher dropdown based on updated schedule
    updateTeachersBySchedule();
};

function renderEditScheduleTable() {
    const tbody = document.getElementById('editScheduleTableBody');
    if (!tbody) {
        // View-only layout may not include schedule-edit section
        return;
    }

    tbody.innerHTML = '';
    
    if(editSchedules.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted small">No schedule assigned</td></tr>';
        return;
    }

    editSchedules.forEach((item, index) => {
        const dateDisplay = item.date ? new Date(item.date).toLocaleDateString('en-US', {year: 'numeric', month: 'short', day: 'numeric'}) : 'N/A';
        const timeDisplay = item.endTime ? `${item.time} - ${item.endTime}` : item.time;
        
        tbody.innerHTML += `
            <tr>
                <td>${dateDisplay}</td>
                <td>${item.day}</td>
                <td>${timeDisplay}</td>
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

function buildEditPreferredTimeDay() {
    return editSchedules
        .map(s => `${s.day} ${s.time}${s.endTime ? ' - ' + s.endTime : ''}`)
        .join(', ');
}

// --- 5.5 UPDATE TEACHERS BY SCHEDULE ---
async function updateTeachersBySchedule() {
    const id = document.getElementById('update_enrollment_id').value;
    const select = document.getElementById('update_teacher');
    
    if (!id || !select || editSchedules.length === 0) {
        // If no schedules, show all teachers
        axios.get("../../api/admin/enrollment.php?operation=getLookups")
            .then(res => {
                const teachers = res.data.teachers || [];
                select.innerHTML = '<option value="">Select Teacher</option>';
                teachers.forEach(t => {
                    select.innerHTML += `<option value="${t.employee_id}">${t.name}</option>`;
                });
            })
            .catch(err => console.error('Error loading teachers:', err));
        return;
    }
    
    const programId = currentEnrollmentDetails?.program_id;
    const subjectIds = currentEnrollmentDetails?.subject_ids
        ? String(currentEnrollmentDetails.subject_ids).split(',').filter(Boolean)
        : currentEnrollmentDetails?.subject_id
            ? [String(currentEnrollmentDetails.subject_id)]
            : [];

    if (!programId || subjectIds.length === 0) {
        return;
    }

    try {
        const schedulesJson = JSON.stringify(editSchedules);
        const filterResponse = await axios.get(
            `../../api/admin/enrollment.php?operation=getFilteredTeachers&program_id=${encodeURIComponent(programId)}&subject_ids=${encodeURIComponent(subjectIds.join(','))}&preferred_schedules=${encodeURIComponent(schedulesJson)}&exclude_enrollment_id=${encodeURIComponent(id)}`
        );
        
        const teachers = filterResponse.data.data || [];
        const currentTeacherId = select.value;
        
        select.innerHTML = '<option value="">Select Teacher</option>';
        
        if (teachers.length === 0) {
            select.innerHTML += '<option disabled>No teachers available for this schedule</option>';
        } else {
            teachers.forEach(t => {
                select.innerHTML += `<option value="${t.employee_id}">${t.name}</option>`;
            });
        }
        
        // Restore previous selection if it's still available
        if (currentTeacherId && select.querySelector(`option[value="${currentTeacherId}"]`)) {
            select.value = currentTeacherId;
        }
    } catch (err) {
        console.error('Error filtering teachers:', err);
    }
}

// --- 7. SAVE CHANGES ---
window.saveEnrollmentUpdates = function() {
    if (!guardEnrollmentPermission('edit', 'You do not have permission to update enrollment records.')) {
        return;
    }

    if (currentViewOnly) return;

    const id = document.getElementById('update_enrollment_id')?.value || currentEnrollmentDetails?.enrollment_details_id;
    const teacherSelect = document.getElementById('update_teacher');
    const classSelect = document.getElementById('update_class');
    const sectionSelect = document.getElementById('update_section');

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
    
    let summaryTime = editSchedules.length > 0 
        ? editSchedules.map(s => `${s.day} ${s.time}${s.endTime ? ' - ' + s.endTime : ''}`).join(", ") 
        : "";

    const data = {
        enrollment_details_id: id,
        program_id: currentEnrollmentDetails?.program_id || null,
        grade_level_id: currentEnrollmentDetails?.grade_level_id || null,
        subject_id: currentEnrollmentDetails?.subject_id || null,
        subject_ids: currentEnrollmentDetails?.subject_ids || null,
        goal: currentEnrollmentDetails?.goal || null,
        preferred_teacher: teacher,
        preferred_time_day: summaryTime || currentEnrollmentDetails?.preferred_time_day || null,
        class_id: classId,
        section_id: sectionId
    };

    if (schedulesModified || editSchedules.length > 0) {
        data.preferences = editSchedules.map(s => ({
            day: s.day,
            time: s.time,
            endTime: s.endTime || null,
            date: s.date || null
        }));
    }

    axios.post("../../api/admin/enrollment.php", {
        operation: "updateEnrollment",
        json: JSON.stringify(data)
    }).then(res => {
        if (res.data.status === 'success') {
            Swal.fire("Updated", "Enrollment details updated.", "success");
            
            const modalEl = document.getElementById('viewEnrollmentModal');
            const modalInstance = bootstrap.Modal.getInstance(modalEl);
            modalInstance.hide();

            loadEnrollments(); 
        } else {
            Swal.fire("Error", res.data.message, "error");
        }
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

window.openPaymentHistoryModal = function(enrollment_details_id, viewOnly = false) {
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
                paymentId: payment.payment_id || null,
                orNo: payment.or_no || null,
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
            const canReviewPendingPayment = !effectiveViewOnly && payment.payment_status === 'Pending';
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
                if (!effectiveViewOnly && payment.payment_status === 'Pending') {
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
                            window.openPaymentHistoryModal(enrollment_details_id, effectiveViewOnly);
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
                if (!effectiveViewOnly) {
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
};
