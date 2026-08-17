import { openPrePlayReportCard } from './preplay_report_card.js?v=20260814-school-year-curriculum';
import { downloadORF } from '../modules/orf.js';
import { showPaymentReceipt } from '../modules/receipt.js';

// js/modules/view_enrollment.js

let editSchedules = [];
let paginationManager;
const STUDENT_PREPLAY_PAYMENT_HISTORY_REFRESH_MS = 10000;
const enrollmentFilters = { search: '', status: '', subject: '', teacher: '' };

function getPrePlayEnrollmentUrl() {
    const params = new URLSearchParams({ operation: 'getPrePlayEnrollments' });
    Object.entries(enrollmentFilters).forEach(([key, value]) => {
        if (value) params.set(key, value);
    });
    return `../../api/student/enrollment.php?${params.toString()}`;
}

function resolvePaymentProofUrl(proofPath) {
    if (!proofPath) return '';
    if (/^(?:https?:)?\/\//.test(proofPath)) {
        return proofPath;
    }

    const cleaned = String(proofPath).replace(/^\/+/, '');
    return `../../${cleaned}`;
}

function getStudentReceiptKey(payment) {
    return String(payment.receipt_id || payment.payment_id || '');
}

function isStudentGcashPayment(payment) {
    const methodName = String(payment.payment_method || '').toLowerCase();
    return methodName.includes('gcash') || Boolean(payment.payment_screenshot_path);
}

function canStudentViewReceipt(payment) {
    return String(payment.payment_status || '').toLowerCase() === 'received';
}

function buildStudentReceiptData(enrollmentId, studentName, history, payment, billingData = {}) {
    const receiptKey = getStudentReceiptKey(payment);
    const receiptRows = history.filter(item => getStudentReceiptKey(item) === receiptKey);
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
        const billingType = item.billing_type || 'Payment';

        return [
            ...(base > 0 ? [{ label: billingType, amount: base }] : []),
            ...(penalty > 0 ? [{ label: `Penalty - ${billingType}`, amount: penalty }] : [])
        ];
    });
    const paymentFor = [...new Set(rows.map(item => item.billing_type).filter(Boolean))].join(', ') || 'Tuition Fee';

    return {
        enrollmentId,
        studentName,
        programName: billingData.program_name || 'N/A',
        programType: billingData.program_type || null,
        receiptNo: receiptKey,
        copyLabels: ['CUSTOMER COPY'],
        paymentKind: payment.payment_status || 'Payment',
        paymentType: payment.payment_status || 'Payment',
        paymentFor,
        paymentMethod: payment.payment_method || '',
        referenceNo: payment.reference_no || null,
        amountPaid,
        balance,
        totalAmount: amountPaid,
        lineItems,
        paymentDate: payment.payment_date || new Date()
    };
}

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

    cards.forEach(card => {
        card.querySelectorAll(':scope > .row > [class*="col-"]').forEach(field => {
            field.classList.add('preplay-view-field');
        });
    });

    const status = document.getElementById('view_status');
    status?.classList.add('preplay-status-pill');
    status?.closest('[class*="col-"]')?.classList.add('preplay-status-field');
}

function getStudentModuleImportUrl(relativePath) {
    return new URL(relativePath, window.location.href).href;
}

function redirectToStudentPrePlayEnrollment(enrollmentId) {
    sessionStorage.setItem('studentPendingPrePlayEnrollmentCompletion', JSON.stringify({ enrollmentId }));
    window.location.href = './enrollement_pre_play.html';
}

window.completeStudentPrePlayEnrollmentFromPayment = async function(enrollmentId) {
    if (!window.location.pathname.includes('/student/enrollement_pre_play.html')) {
        redirectToStudentPrePlayEnrollment(enrollmentId);
        return;
    }

    if (typeof window.openPendingPrePlayEnrollmentCompletion !== 'function') {
        await import(getStudentModuleImportUrl('../../js/studentmodule/pre_play_enrollment.js'));
    }

    if (typeof window.openPendingPrePlayEnrollmentCompletion === 'function') {
        return window.openPendingPrePlayEnrollmentCompletion(enrollmentId);
    }

    Swal.fire('Error', 'Enrollment completion is not available right now.', 'error');
};

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

document.addEventListener("DOMContentLoaded", () => {
    if (window.location.pathname.includes('/student/payment_pre_play.html')) {
        window.openPaymentHistoryModal = openStudentPrePlayPaymentHistoryModal;
        return;
    }

    if (window.location.pathname.includes('payment_pre_play.html') || window.location.pathname.includes('enrollement_pre_play.html')) {
        initializePagination();
        setupEnrollmentFilters();
        loadEnrollmentFilterLookups();
        loadEnrollmentStats();
    }
});

function initializePagination() {
    const tableBody = document.getElementById('paymentTableBody');
    const paginationContainer = document.querySelector('.d-flex.justify-content-between.align-items-center.mt-4 nav');

    if (!tableBody || !paginationContainer) return;

    paginationManager = new PaginationManager({
        container: paginationContainer,
        apiUrl: getPrePlayEnrollmentUrl(),
        tableBody: tableBody,
        perPage: 10,
        onDataLoad: renderEnrollments
    });

    paginationManager.init();

    // Make loadEnrollments available globally
    window.loadEnrollments = () => paginationManager.loadPage(1);
}

function setupEnrollmentFilters() {
    if (!paginationManager) return;

    const searchInput = document.getElementById('search-input');
    const statusSelect = document.getElementById('enrollment-status-filter');
    const subjectSelect = document.getElementById('enrollment-subject-filter');
    const teacherSelect = document.getElementById('enrollment-teacher-filter');
    const applyButton = document.getElementById('enrollment-apply-filters');
    const refresh = () => {
        paginationManager.apiUrl = getPrePlayEnrollmentUrl();
        paginationManager.loadPage(1);
    };
    let searchTimer;

    searchInput?.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            enrollmentFilters.search = searchInput.value.trim();
            refresh();
        }, 250);
    });

    [
        [statusSelect, 'status'],
        [subjectSelect, 'subject'],
        [teacherSelect, 'teacher']
    ].forEach(([select, key]) => select?.addEventListener('change', () => {
        enrollmentFilters[key] = select.value;
        refresh();
    }));

    applyButton?.addEventListener('click', () => {
        enrollmentFilters.search = searchInput?.value.trim() || '';
        enrollmentFilters.status = statusSelect?.value || '';
        enrollmentFilters.subject = subjectSelect?.value || '';
        enrollmentFilters.teacher = teacherSelect?.value || '';
        refresh();
    });
}

function setEnrollmentFilterOptions(id, values, placeholder) {
    const select = document.getElementById(id);
    if (!select) return;
    select.replaceChildren(new Option(placeholder, ''));
    values.forEach(value => select.add(new Option(value, value)));
}

function loadEnrollmentFilterLookups() {
    axios.get('../../api/student/enrollment.php?operation=getEnrollmentFilterLookups&type=preschool')
        .then(response => {
            if (response.data.status !== 'success') return;
            const data = response.data.data || {};
            setEnrollmentFilterOptions('enrollment-status-filter', data.statuses || [], 'All Status');
            setEnrollmentFilterOptions('enrollment-subject-filter', data.subjects || [], 'All Subjects');
            setEnrollmentFilterOptions('enrollment-teacher-filter', data.teachers || [], 'All Teachers');
        })
        .catch(error => console.error('Error loading enrollment filters:', error));
}

function renderEnrollments(enrollments) {
    const tableBody = document.getElementById('paymentTableBody');
    tableBody.innerHTML = '';

    if (enrollments.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center">No enrollments found.</td></tr>';
        return;
    }

    enrollments.forEach(item => {
        const pagePath = window.location.pathname;
        const isPreschoolPage = pagePath.includes('payment_pre_play.html') || pagePath.includes('enrollement_pre_play.html');
        const status = (item.status || '').toLowerCase().trim();
        let statusBadge;
        switch (status) {
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

        let menuItems = '';
        if (pagePath.includes('payment.html') || pagePath.includes('payment_pre_play.html')) {
            const payCall = isPreschoolPage ? `openBillingPlayPreModal(${item.enrollment_details_id})` : `openBillingModalByProgram(${item.enrollment_details_id}, '${item.program_name || ''}')`;
            menuItems += `
                <li><a class="dropdown-item" href="#" onclick="event.preventDefault(); ${payCall}">
                    <i class="bi bi-credit-card me-2"></i>Pay
                </a></li>
                <li><a class="dropdown-item" href="#" onclick="event.preventDefault(); openPaymentHistoryModal(${item.enrollment_details_id})">
                    <i class="bi bi-receipt me-2"></i>Payment History
                </a></li>
            `;
        } else if (status === 'incomplete') {
            menuItems = `
                <li><a class="dropdown-item text-primary fw-semibold" href="#" onclick="event.preventDefault(); window.completeStudentPrePlayEnrollmentFromPayment(${item.enrollment_details_id})">
                    <i class="bi bi-check2-circle me-2"></i>pls complete the enrollment
                </a></li>
            `;
        }

        if (status !== 'incomplete' && !window.location.pathname.includes('payment.html') && !window.location.pathname.includes('payment_pre_play.html')) {
            menuItems += `
                <li><a class="dropdown-item" href="#" onclick="event.preventDefault(); viewDetails(${item.enrollment_details_id})">
                    <i class="bi bi-eye me-2"></i>View Details
                </a></li>
                <li><a class="dropdown-item" href="#" onclick="event.preventDefault(); window.viewStudentAttendance(${item.enrollment_details_id})">
                    <i class="bi bi-calendar-check me-2"></i>Attendance
                </a></li>
                <li><a class="dropdown-item" href="#" onclick="event.preventDefault(); window.viewPrePlayReportCard(${item.enrollment_details_id})">
                    <i class="bi bi-clipboard-check me-2"></i>View Report Card
                </a></li>
                <li><a class="dropdown-item" href="#" onclick="event.preventDefault(); window.downloadPrePlayORF(${item.enrollment_details_id})">
                    <i class="bi bi-download me-2"></i>Download ORF
                </a></li>
            `;
        }

        const actionMenu = `
            <div class="dropdown">
                <button class="btn btn-sm btn-outline-secondary border-0" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                    <i class="bi bi-three-dots-vertical"></i>
                </button>
                <ul class="dropdown-menu dropdown-menu-end">
                    ${menuItems}
                </ul>
            </div>
        `;

        const row = `
            <tr>
                <td>${item.student_name}</td>
                <td>${item.program_name || item.subject_name || 'N/A'}</td>
                <td>${item.teacher_name || 'Not assigned'}</td>
                <td>${item.enrollment_date}</td>
                <td><span class="badge bg-${statusBadge}">${item.status.toUpperCase()}</span></td>
                <td>
                    ${actionMenu}
                </td>
            </tr>
        `;
        tableBody.innerHTML += row;
    });
}

window.viewStudentAttendance = function(enrollmentDetailsId) {
    const enrollmentId = Number(enrollmentDetailsId || 0);
    if (!enrollmentId) {
        Swal.fire('Attendance', 'Unable to identify the selected enrollment.', 'warning');
        return;
    }

    const targetUrl = new URL('./attendance.html', window.location.href);
    targetUrl.searchParams.set('enrollment_details_id', String(enrollmentId));
    window.location.href = targetUrl.toString();
};

function loadEnrollmentStats() {
    axios.get("../../api/student/enrollment.php?operation=getPrePlayEnrollmentStats")
    .then(res => {
        if (res.data.status === 'success') {
            const stats = res.data.data;
            if (document.getElementById('total_enrollments')) {
                document.getElementById('total_enrollments').innerText = stats.total;
                document.getElementById('new_enrollments').innerText = stats.new;
                document.getElementById('pending_applications').innerText = stats.pending;
                document.getElementById('cancellations').innerText = stats.cancelled;
            }
        }
    })
    .catch(err => console.error("Error stats:", err));
}



window.viewDetails = function(id) {
    console.log('viewDetails called with id:', id);
    axios.get(`../../api/student/enrollment.php?operation=getEnrollmentDetails&id=${id}`)
    .then(resDetails => {
        console.log('Data loaded:', resDetails.data);
        if (resDetails.data.status === 'success') {
            editSchedules = [];
            preparePrePlayEnrollmentView();

            const d = resDetails.data.data.details;
            const scheds = resDetails.data.data.schedule;
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

                if (d.preferred_teacher) {
                    const teacherOption = document.createElement('option');
                    teacherOption.value = d.preferred_teacher;
                    teacherOption.textContent = d.teacher_name || 'Assigned teacher';
                    teacherOption.selected = true;
                    select.appendChild(teacherOption);
                } else {
                    select.value = '';
                }
            }

            const form = document.getElementById('updateEnrollmentForm');
            if (form) {
                // School year remains fixed to the stored active year and is not editable here.
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

window.viewPrePlayReportCard = function(enrollmentDetailsId) {
    if (!enrollmentDetailsId) {
        Swal.fire('Report Card', 'Enrollment details are missing.', 'warning');
        return;
    }

    openPrePlayReportCard(enrollmentDetailsId);
};

window.downloadPrePlayORF = function(enrollmentDetailsId) {
    downloadORF(enrollmentDetailsId, 'preplay');
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

function renderEnrollmentBranch(details) {
    const branchName = details.branch_name || 'N/A';
    const classSectionCards = document.querySelectorAll('#viewEnrollmentModal .modal-body .alert.alert-light.border');
    const classSectionCard = classSectionCards[1];
    if (!classSectionCard) return;

    let branchCol = document.getElementById('view_branch_col');
    if (!branchCol) {
        branchCol = document.createElement('div');
        branchCol.className = 'col-md-3';
        branchCol.id = 'view_branch_col';
        branchCol.innerHTML = `
            <label class="small text-muted">Branch</label>
            <div class="fw-bold" id="view_branch">...</div>
        `;

        const rowGroup = classSectionCard.querySelector('.row.g-3');
        if (rowGroup) {
            rowGroup.appendChild(branchCol);
        } else {
            classSectionCard.appendChild(branchCol);
        }
    }

    const branchValue = document.getElementById('view_branch');
    if (branchValue) {
        branchValue.innerText = branchName;
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
                    <button type="button" class="btn btn-sm btn-outline-danger py-0" onclick="window.removeEditScheduleRow(${index})">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });
}

window.deleteEnrollment = function(id) {
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

async function fetchStudentPrePlayPaymentHistoryModalData(enrollmentDetailsId) {
    const [historyRes, billingRes, enrollmentRes] = await Promise.all([
        axios.get(`../../api/student/payment.php?operation=getPaymentHistory&enrollment_details_id=${enrollmentDetailsId}`),
        axios.get(`../../api/student/payment.php?operation=getBillingDetails&enrollment_id=${enrollmentDetailsId}`),
        axios.get(`../../api/student/enrollment.php?operation=getEnrollmentDetails&id=${enrollmentDetailsId}`)
    ]);

    if (historyRes.data.status !== 'success') {
        throw new Error(historyRes.data.message || 'Failed to load payment history.');
    }

    if (billingRes.data.status !== 'success') {
        throw new Error(billingRes.data.message || 'Failed to load billing details.');
    }

    return {
        studentName: historyRes.data.student_name || 'Unknown Student',
        history: historyRes.data.history || [],
        billingData: billingRes.data.data || {},
        enrollmentStatus: enrollmentRes.data?.status === 'success'
            ? enrollmentRes.data.data?.details?.status || ''
            : ''
    };
}

function openStudentPrePlayPaymentHistoryModal(enrollment_details_id) {
    const getPaymentStatusPresentation = status => {
        const normalized = String(status || '').toLowerCase();
        if (['received', 'enrolled', 'complete', 'completed', 'active'].includes(normalized)) {
            return { tone: 'success', icon: 'bi-check-circle-fill', label: String(status).toUpperCase() };
        }
        if (['pending', 'incomplete'].includes(normalized)) {
            return { tone: 'pending', icon: 'bi-clock-fill', label: String(status).toUpperCase() };
        }
        if (['declined', 'cancelled', 'canceled'].includes(normalized)) {
            return { tone: 'danger', icon: 'bi-x-circle-fill', label: String(status).toUpperCase() };
        }
        return { tone: 'neutral', icon: 'bi-info-circle', label: status ? String(status).toUpperCase() : 'UNKNOWN' };
    };

    fetchStudentPrePlayPaymentHistoryModalData(enrollment_details_id)
        .then(({ studentName, history, billingData, enrollmentStatus }) => {
            let currentStudentName = studentName;
            let currentHistory = Array.isArray(history) ? history : [];
            let currentBillingData = billingData || {};
            let currentEnrollmentStatus = enrollmentStatus;
            let refreshTimer = null;
            let isRefreshing = false;

            const showStudentPaymentProofModal = payment => {
                const receiptKey = getStudentReceiptKey(payment);
                const receiptRows = currentHistory.filter(item => getStudentReceiptKey(item) === receiptKey);
                const detailRows = receiptRows.length > 0 ? receiptRows : [payment];
                const screenshotHtml = payment.payment_screenshot_path
                    ? `<img src="${resolvePaymentProofUrl(payment.payment_screenshot_path)}" alt="GCash payment screenshot" class="img-fluid rounded-3" style="max-height: 420px; object-fit: contain;">`
                    : '<div class="text-muted py-5">No payment screenshot was uploaded for this record.</div>';
                const totalAmountPaid = detailRows.reduce((sum, item) => sum + parseFloat(item.amount_paid || 0), 0);
                const amountValue = totalAmountPaid.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                Swal.fire({
                    title: 'Payment Proof',
                    width: '720px',
                    showCancelButton: true,
                    cancelButtonText: 'Close',
                    showConfirmButton: canStudentViewReceipt(payment),
                    confirmButtonText: 'View Receipt',
                    confirmButtonColor: '#5a67d8',
                    cancelButtonColor: '#6c757d',
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
                    if (!result.isConfirmed || !canStudentViewReceipt(payment)) {
                        return;
                    }

                    showPaymentReceipt(buildStudentReceiptData(
                        enrollment_details_id,
                        currentStudentName,
                        currentHistory,
                        payment,
                        currentBillingData
                    ));
                });
            };

            const renderHistoryContent = () => {
                const statusElement = document.getElementById('studentPrePlayPaymentHistoryStatus');
                const tableBody = document.getElementById('studentPrePlayPaymentHistoryTableBody');

                const enrollmentStatus = currentEnrollmentStatus || (currentHistory.some(payment => String(payment.payment_status).toLowerCase() === 'pending')
                    ? 'pending'
                    : currentHistory.length ? 'received' : 'unknown');
                const enrollmentPresentation = getPaymentStatusPresentation(enrollmentStatus);
                if (statusElement) {
                    statusElement.className = `payment-enrollment-status payment-enrollment-status--${enrollmentPresentation.tone}`;
                    statusElement.innerHTML = `<i class="bi ${enrollmentPresentation.icon}"></i><span>Status: ${enrollmentPresentation.label}</span>`;
                }

                if (!tableBody) {
                    return;
                }

                let tableRows = '';

                if (currentHistory.length > 0) {
                currentHistory.forEach(payment => {
                    const amountPaid = parseFloat(payment.amount_paid || 0);
                    const penaltyPaid = parseFloat(payment.penalty_paid || 0);
                    const baseAmountPaid = parseFloat(payment.base_amount_paid ?? Math.max(amountPaid - penaltyPaid, 0));
                    const amountBreakdown = amountPaid
                        ? `PHP ${amountPaid.toLocaleString()}${penaltyPaid > 0
                            ? `<div class="small text-muted">Base: PHP ${baseAmountPaid.toLocaleString()} + <span class="text-danger">Penalty: PHP ${penaltyPaid.toLocaleString()}</span></div>`
                            : ''}`
                        : 'N/A';
                    const paymentPresentation = getPaymentStatusPresentation(payment.payment_status);
                    let actionButton = '<span class="text-muted">-</span>';
                    if (isStudentGcashPayment(payment)) {
                        actionButton = `<button type="button" class="payment-history-action view-student-payment-proof" data-receipt-key="${getStudentReceiptKey(payment)}"><i class="bi bi-image"></i>View Proof</button>`;
                    } else if (canStudentViewReceipt(payment)) {
                        actionButton = `<button type="button" class="payment-history-action view-student-payment-receipt" data-receipt-key="${getStudentReceiptKey(payment)}"><i class="bi bi-receipt"></i>View Receipt</button>`;
                    }

                    tableRows += `
                        <tr>
                            <td data-label="Date">${payment.payment_date || 'N/A'}</td>
                            <td data-label="Paid For">${payment.billing_type || payment.payment_type || 'N/A'}</td>
                            <td data-label="Amount">${amountBreakdown}</td>
                            <td data-label="Payment Method">${payment.payment_method || 'N/A'}</td>
                            <td data-label="Reference No.">${payment.reference_no || 'N/A'}</td>
                            <td data-label="Status"><span class="payment-row-status payment-row-status--${paymentPresentation.tone}"><i class="bi ${paymentPresentation.icon}"></i>${payment.payment_status || 'N/A'}</span></td>
                            <td data-label="Actions"><div class="payment-history-actions">${actionButton}</div></td>
                        </tr>
                    `;
                });
                } else {
                    tableRows = '<tr><td colspan="7" class="payment-history-empty">No payment history found.</td></tr>';
                }

                tableBody.innerHTML = tableRows;

                document.querySelectorAll('.view-student-payment-proof').forEach(button => {
                    button.addEventListener('click', () => {
                        const receiptKey = button.getAttribute('data-receipt-key');
                        const payment = currentHistory.find(item => getStudentReceiptKey(item) === receiptKey);
                        if (!payment) {
                            Swal.fire('Error', 'Payment proof is not available.', 'error');
                            return;
                        }

                        showStudentPaymentProofModal(payment);
                    });
                });

                document.querySelectorAll('.view-student-payment-receipt').forEach(button => {
                    button.addEventListener('click', () => {
                        const receiptKey = button.getAttribute('data-receipt-key');
                        const payment = currentHistory.find(item => getStudentReceiptKey(item) === receiptKey);
                        if (!payment) {
                            Swal.fire('Error', 'Receipt is not available.', 'error');
                            return;
                        }

                        showPaymentReceipt(buildStudentReceiptData(
                            enrollment_details_id,
                            currentStudentName,
                            currentHistory,
                            payment,
                            currentBillingData
                        ));
                    });
                });
            };

            const refreshHistory = async () => {
                if (isRefreshing || !Swal.isVisible()) return;

                const popup = Swal.getPopup();
                if (!popup || !popup.querySelector('#studentPrePlayPaymentHistoryTableBody')) return;

                isRefreshing = true;
                try {
                    const refreshed = await fetchStudentPrePlayPaymentHistoryModalData(enrollment_details_id);
                    currentStudentName = refreshed.studentName;
                    currentHistory = refreshed.history;
                    currentBillingData = refreshed.billingData;
                    currentEnrollmentStatus = refreshed.enrollmentStatus;
                    renderHistoryContent();
                    if (typeof window.loadEnrollments === 'function') {
                        window.loadEnrollments();
                    }
                } catch (error) {
                    console.error('Unable to refresh student pre-play payment history:', error);
                } finally {
                    isRefreshing = false;
                }
            };

            Swal.fire({
                title: `Payment History - ${currentStudentName}`,
                html: `
                    <div class="payment-history-status-row">
                        <span class="payment-enrollment-status payment-enrollment-status--neutral" id="studentPrePlayPaymentHistoryStatus"></span>
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
                                <tbody id="studentPrePlayPaymentHistoryTableBody"></tbody>
                            </table>
                    </div>
                `,
                width: 'min(92vw, 1050px)',
                showCloseButton: true,
                confirmButtonText: 'Close',
                buttonsStyling: false,
                customClass: {
                    popup: 'payment-history-popup',
                    title: 'payment-history-title',
                    htmlContainer: 'payment-history-content',
                    closeButton: 'payment-history-x',
                    confirmButton: 'payment-history-close'
                },
                didOpen: () => {
                    renderHistoryContent();
                    refreshTimer = window.setInterval(refreshHistory, STUDENT_PREPLAY_PAYMENT_HISTORY_REFRESH_MS);
                },
                willClose: () => {
                    if (refreshTimer) {
                        window.clearInterval(refreshTimer);
                        refreshTimer = null;
                    }
                }
            });
        })
        .catch(err => {
            console.error(err);
            Swal.fire("Error", err.message || "An error occurred while fetching payment history.", "error");
        });
}

window.openPaymentHistoryModal = openStudentPrePlayPaymentHistoryModal;
window.openPrePlayPaymentHistoryModal = openStudentPrePlayPaymentHistoryModal;
window.openStudentPrePlayPaymentHistoryModal = openStudentPrePlayPaymentHistoryModal;

document.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname.includes('/student/payment_pre_play.html')) {
        window.openPaymentHistoryModal = openStudentPrePlayPaymentHistoryModal;
        window.openPrePlayPaymentHistoryModal = openStudentPrePlayPaymentHistoryModal;
    }
});
