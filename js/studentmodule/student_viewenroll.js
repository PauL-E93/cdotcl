import { showPaymentReceipt } from '../modules/receipt.js';

document.addEventListener('DOMContentLoaded', function() {
    loadEnrollmentStats();

    const filters = { search: '', status: '', subject: '', teacher: '' };

    const paginationContainer = document.getElementById('paginationNav');
    const tableBody = document.querySelector('#enrollmentTableBody');

    if (!paginationContainer || !tableBody) {
        console.error('Required elements (paginationNav or #enrollmentTable tbody) not found.');
        return;
    }

    const paginationManager = new PaginationManager({
        container: paginationContainer,
        apiUrl: buildEnrollmentUrl(filters),
        tableBody: tableBody,
        onDataLoad: populateTable,
        perPage: 5 
    });

    paginationManager.init();

    const refreshEnrollments = () => {
        paginationManager.apiUrl = buildEnrollmentUrl(filters);
        paginationManager.loadPage(1);
    };

    const searchInput = document.getElementById('search-input');
    const statusSelect = document.getElementById('enrollment-status-filter');
    const subjectSelect = document.getElementById('enrollment-subject-filter');
    const teacherSelect = document.getElementById('enrollment-teacher-filter');
    const applyButton = document.getElementById('enrollment-apply-filters');
    let searchTimer;

    if (searchInput) {
        searchInput.addEventListener('input', function() {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                filters.search = this.value.trim();
                refreshEnrollments();
            }, 250);
        });
    }

    [
        [statusSelect, 'status'],
        [subjectSelect, 'subject'],
        [teacherSelect, 'teacher']
    ].forEach(([select, key]) => select?.addEventListener('change', () => {
        filters[key] = select.value;
        refreshEnrollments();
    }));

    applyButton?.addEventListener('click', () => {
        filters.search = searchInput?.value.trim() || '';
        filters.status = statusSelect?.value || '';
        filters.subject = subjectSelect?.value || '';
        filters.teacher = teacherSelect?.value || '';
        refreshEnrollments();
    });

    loadEnrollmentFilterLookups('tutorial');
});

function buildEnrollmentUrl(filters) {
    const params = new URLSearchParams({ operation: 'getEnrollments', type: 'tutorial' });
    Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
    });
    return `../../api/student/enrollment.php?${params.toString()}`;
}

function setFilterOptions(id, values, placeholder) {
    const select = document.getElementById(id);
    if (!select) return;
    select.replaceChildren(new Option(placeholder, ''));
    values.forEach(value => select.add(new Option(value, value)));
}

function loadEnrollmentFilterLookups(type) {
    axios.get(`../../api/student/enrollment.php?operation=getEnrollmentFilterLookups&type=${encodeURIComponent(type)}`)
        .then(response => {
            if (response.data.status !== 'success') return;
            const data = response.data.data || {};
            setFilterOptions('enrollment-status-filter', data.statuses || [], 'All Status');
            setFilterOptions('enrollment-subject-filter', data.subjects || [], 'All Subjects');
            setFilterOptions('enrollment-teacher-filter', data.teachers || [], 'All Teachers');
        })
        .catch(error => console.error('Error loading enrollment filters:', error));
}

function loadEnrollmentStats() {
    axios.get('../../api/student/enrollment.php?operation=getEnrollmentStats&type=tutorial')
        .then(response => {
            if (response.data.status === 'success') {
                const data = response.data.data;
                updateStats(data);
            }
        })
        .catch(error => console.error('Error loading stats:', error));
}

function updateStats(data) {
    document.getElementById('totalEnrollments').textContent = data.total || 0;
    document.getElementById('newEnrollments').textContent = data.new || 0;
    document.getElementById('pendingEnrollments').textContent = data.pending || 0;
    document.getElementById('cancelledEnrollments').textContent = data.cancelled || 0;
}


// --- POPULATE TABLE ---
function populateTable(data) {
    const tbody = document.querySelector('#enrollmentTableBody');
    if (!tbody) return; // Safety check
    tbody.innerHTML = ''; // Clear existing rows

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No enrollments found.</td></tr>';
        return;
    }

    data.forEach(row => {
        const tr = document.createElement('tr');
        
        // Subject Name
        const tdSubject = document.createElement('td');
        tdSubject.textContent = row.subject_name || 'N/A';
        tr.appendChild(tdSubject);

        // Teacher Name
        const tdTeacher = document.createElement('td');
        tdTeacher.textContent = row.teacher_name || 'TBA';
        tr.appendChild(tdTeacher);

        // Date
        const tdDate = document.createElement('td');
        tdDate.textContent = row.enrollment_date;
        tr.appendChild(tdDate);

        // Status
        const tdStatus = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = `badge ${getStatusClass(row.status)}`;
        badge.textContent = row.status.charAt(0).toUpperCase() + row.status.slice(1);
        tdStatus.appendChild(badge);
        tr.appendChild(tdStatus);

        // --- ACTION DROPDOWN ---
        const tdAction = document.createElement('td');
        const status = (row.status || '').toLowerCase();
        const canComplete = status === 'incomplete';
        const actionItems = canComplete
            ? `<li><a class="dropdown-item text-primary fw-semibold" href="#" onclick="event.preventDefault(); openPendingEnrollmentCompletion(${row.enrollment_details_id}, 'tutorial')">Complete</a></li>`
            : `
                    <li><a class="dropdown-item" href="#" onclick="event.preventDefault(); viewEnrollment(${row.enrollment_details_id})">View</a></li>
                    <li><a class="dropdown-item" href="#" onclick="event.preventDefault(); downloadStudentORF(${row.enrollment_details_id})">Download ORF</a></li>
                `;

        tdAction.innerHTML = `
            <div class="dropdown">
                <button class="btn btn-sm btn-outline-secondary border-0" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                    <i class="bi bi-three-dots-vertical"></i>
                </button>
                <ul class="dropdown-menu dropdown-menu-end">
                    ${actionItems}
                </ul>
            </div>
        `;
        tr.appendChild(tdAction);

        tbody.appendChild(tr);
    });
}

function getStatusClass(status) {
    switch (status.toLowerCase()) {
        case 'active': case 'enrolled': return 'bg-success';
        case 'pending': case 'incomplete': return 'bg-warning text-dark';
        case 'cancelled': return 'bg-danger';
        case 'session done': return 'bg-info';
        default: return 'bg-secondary';
    }
}



// --- UPDATED VIEW FUNCTION ---
function viewEnrollment(id) {
    // 1. DYNAMICALLY FIND OR CREATE THE MODAL AND ITS BODY
    let modalElement = document.getElementById('viewEnrollmentModal');
    let modalBody = document.getElementById('viewEnrollmentBody');

    // If modal or its body doesn't exist, (re)create it.
    if (!modalElement || !modalBody) {
        // If a partial/broken modal exists, remove it before creating a new one.
        if (modalElement) {
            modalElement.remove();
        }

        const modalHTML = `
            <div class="modal fade preplay-enrollment-view" id="viewEnrollmentModal" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-lg preplay-view-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title"><span class="preplay-modal-title-icon" aria-hidden="true"><i class="bi bi-person"></i></span>Manage Enrollment</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body" id="viewEnrollmentBody">
                            <!-- Content will be loaded here -->
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        </div>
                    </div>
                </div>
            </div>`;
        // Append the fresh modal HTML to the end of the body
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Re-select the newly created elements
        modalElement = document.getElementById('viewEnrollmentModal');
        modalBody = document.getElementById('viewEnrollmentBody');
    }
    
    // 2. SHOW LOADING STATE
    // At this point, modalBody is guaranteed to exist.
    modalBody.innerHTML = `
        <div class="text-center py-5">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <p class="mt-2 text-muted">Fetching details...</p>
        </div>
    `;

    // 3. OPEN MODAL
    const modal = new bootstrap.Modal(modalElement);
    modal.show();

    // 4. FETCH DATA
    axios.get(`../../api/student/enrollment.php?operation=getEnrollmentDetails&id=${id}`)
        .then(response => {
            if (response.data.status === 'success') {
                populateModal(response.data.data.details, response.data.data.schedule, modalBody);
            } else {
                modalBody.innerHTML = `<div class="alert alert-danger m-3">Error: ${response.data.message}</div>`;
            }
        })
        .catch(error => {
            console.error('API Error:', error);
            modalBody.innerHTML = `<div class="alert alert-danger m-3">Failed to load details. Please try again later.</div>`;
        });
}

// This script is loaded as an ES module, so its functions are not automatically
// available to inline onclick handlers generated for the enrollment table.
window.viewEnrollment = viewEnrollment;

// Fallback edit action for student-side enrollment rows
window.editEnrollment = function(id) {
    viewEnrollment(id);
};

window.downloadStudentORF = function(enrollmentDetailsId) {
    import('../../js/modules/orf.js')
        .then(module => module.downloadORF(enrollmentDetailsId))
        .catch(err => {
            console.error('Error loading ORF downloader:', err);
            Swal.fire('Error', 'Unable to load ORF downloader.', 'error');
        });
};

// --- UPDATED POPULATE MODAL FUNCTION ---
function populateModal(details, schedule, container) {
    const safeText = (value) => value == null || value === '' ? 'N/A' : String(value);
    const escapeHtml = (value) => safeText(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[character]));
    const formatTime = (value) => {
        const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
        if (!match) return safeText(value);

        const hour = Number(match[1]);
        const minutes = match[2];
        const period = hour >= 12 ? 'pm' : 'am';
        const displayHour = hour % 12 || 12;

        return `${displayHour}${minutes === '00' ? '' : `:${minutes}`}${period}`;
    };
    const fullName = [details.first_name, details.last_name, details.ext]
        .filter(part => part && String(part).trim())
        .map(part => String(part).trim())
        .join(' ') || 'N/A';
    const scheduleItems = Array.isArray(schedule) && schedule.length
        ? schedule.map(item => `${escapeHtml(item.day)}${item.start_time ? ` · ${escapeHtml(formatTime(item.start_time))}${item.end_time ? ` - ${escapeHtml(formatTime(item.end_time))}` : ''}` : ''}`).join('<br>')
        : 'No specific schedule assigned yet.';

    container.innerHTML = `
        <section class="alert alert-light border preplay-view-card preplay-student-card">
            <h6><span class="preplay-section-icon" aria-hidden="true"><i class="bi bi-person"></i></span>Student Information</h6>
            <div class="row">
                <div class="col-md-4 preplay-view-field"><label>Student Name</label><div class="fw-bold">${escapeHtml(fullName)}</div></div>
                <div class="col-md-4 preplay-view-field"><label>Program</label><div class="fw-bold">${escapeHtml(details.program_name)}</div></div>
                <div class="col-md-4 preplay-view-field"><label>Enrollment Date</label><div class="fw-bold">${escapeHtml(details.enrollment_date)}</div></div>
                <div class="col-md-4 preplay-view-field"><label>Branch</label><div class="fw-bold">${escapeHtml(details.branch_name)}</div></div>
                <div class="col-md-4 preplay-view-field preplay-status-field"><label>Status</label><span class="preplay-status-pill">${escapeHtml(safeText(details.status).toUpperCase())}</span></div>
                <div class="col-md-4 preplay-view-field"><label>Total Fee</label><div class="fw-bold">₱${escapeHtml(details.total_fee)}</div></div>
                <div class="col-12 preplay-view-field preplay-health-field"><label>Learning Goal</label><div class="fw-bold">${escapeHtml(details.goal)}</div></div>
            </div>
        </section>
        <section class="alert alert-light border preplay-view-card preplay-class-card">
            <h6><span class="preplay-section-icon" aria-hidden="true"><i class="bi bi-mortarboard"></i></span>Class &amp; Schedule Details</h6>
            <div class="row">
                <div class="col-md-3 preplay-view-field"><label>Subject</label><div class="fw-bold">${escapeHtml(details.subject_name)}</div></div>
                <div class="col-md-3 preplay-view-field"><label>Grade Level</label><div class="fw-bold">${escapeHtml(details.grade_level)}</div></div>
                <div class="col-md-3 preplay-view-field"><label>Tutor</label><div class="fw-bold">${escapeHtml(details.teacher_name)}</div></div>
                <div class="col-md-3 preplay-view-field"><label>Preferred Schedule</label><div class="fw-bold">${scheduleItems}</div></div>
            </div>
        </section>`;
    return;

    // Safety check for null values
    const safe = (val) => val ? val : 'N/A';
    const legacyFullName = [details.first_name, details.last_name, details.ext]
        .filter(part => part && part.toString().trim())
        .map(part => part.toString().trim())
        .join(' ') || 'N/A';
    const addressParts = [details.adr_street, details.adr_barangay, details.adr_city, details.adr_province]
        .filter(part => part && part.toString().trim().length > 0)
        .map(part => part.toString().trim());
    const formattedAddress = addressParts.length > 0 ? addressParts.join(', ') : 'N/A';
    const addressNote = details.adr_note ? details.adr_note.toString().trim() : '';

    // Inject HTML into the container (modalBody) passed as argument
    container.innerHTML = `
        <div class="row">
            <div class="col-md-12 alert alert-light border">
                <h5><i class="fas fa-user-circle"></i> Student Information</h5>
                <hr>
                <div class="row">
                    <div class="col-md-6">
                        <p><strong>Name:</strong> <br>${legacyFullName}</p>
                        <p><strong>Status:</strong> <br><span class="badge ${getStatusClass(details.status)}">${details.status.toUpperCase()}</span></p>
                        <p><strong>Address:</strong> <br>${formattedAddress}${addressNote ? `<br><small class="text-muted">${addressNote}</small>` : ''}</p>
                    </div>
                    <div class="col-md-6">
                         <p><strong>Date Enrolled:</strong> <br>${safe(details.enrollment_date)}</p>
                         <p><strong>Total Fee:</strong> <br>₱${safe(details.total_fee)}</p>
                    </div>
                </div>
            </div>
        </div>

        <div class="row mt-2">
            <div class="col-12">
                 <button id="revealMoreBtn" class="btn btn-outline-primary w-100">Show Full Details <i class="fas fa-chevron-down"></i></button>
            </div>
        </div>

        <div id="moreDetails" style="display: none;" class="mt-3">
            <div class="card card-body bg-light">
                <div class="row">
                    <div class="col-md-6">
                        <h6 class="text-primary">Academic Details</h6>
                        <p class="mb-1"><strong>Program:</strong> ${safe(details.program_name)}</p>
                        <p class="mb-1"><strong>Subject:</strong> ${safe(details.subject_name)}</p>
                        <p class="mb-1"><strong>Grade Level:</strong> ${safe(details.grade_level)}</p>
                        <p class="mb-1"><strong>Branch:</strong> ${safe(details.branch_name)}</p>
                    </div>
                    <div class="col-md-6">
                        <h6 class="text-primary">Preferences</h6>
                        <p class="mb-1"><strong>Teacher:</strong> ${safe(details.teacher_name)}</p>
                        <p class="mb-1"><strong>Goal:</strong> ${safe(details.goal)}</p>
                    </div>
                </div>

                <div class="row mt-3">
                    <div class="col-12">
                        <h6 class="text-primary">Scheduled Sessions</h6>
                        ${schedule.length > 0 
                            ? `<ul class="list-group list-group-flush">
                                ${schedule.map(s => `<li class="list-group-item bg-transparent"><i class="far fa-calendar-alt"></i> <strong>${s.day}</strong> at ${s.start_time}</li>`).join('')}
                               </ul>`
                            : '<p class="text-muted small">No specific schedule assigned yet.</p>'
                        }
                    </div>

                    <div class="col-12 mt-3">
                        <button class="btn btn-outline-primary w-100" onclick="openStudentPaymentHistoryModal(${details.enrollment_details_id})">
                            <i class="bi bi-clock-history"></i> View Payment History
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Add event listener to the reveal button inside the new modal
    // We search within 'container' to be safe, or just use document.getElementById
    // providing the IDs are unique (which they should be now)
    const revealBtn = document.getElementById('revealMoreBtn');
    if(revealBtn) {
        revealBtn.addEventListener('click', function() {
            const moreDetails = document.getElementById('moreDetails');
            if (moreDetails.style.display === 'none') {
                moreDetails.style.display = 'block';
                this.innerHTML = 'Hide Details <i class="fas fa-chevron-up"></i>';
            } else {
                moreDetails.style.display = 'none';
                this.innerHTML = 'Show Full Details <i class="fas fa-chevron-down"></i>';
            }
        });
    }
}

function getStudentPaymentHistoryStatus(status) {
    const normalizedStatus = String(status || '').toLowerCase();

    if (['received', 'enrolled', 'complete', 'completed', 'active'].includes(normalizedStatus)) {
        return { tone: 'success', icon: 'bi-check-circle-fill', label: String(status).toUpperCase() };
    }
    if (['pending', 'incomplete'].includes(normalizedStatus)) {
        return { tone: 'pending', icon: 'bi-clock-fill', label: String(status).toUpperCase() };
    }
    if (['declined', 'cancelled', 'canceled'].includes(normalizedStatus)) {
        return { tone: 'danger', icon: 'bi-x-circle-fill', label: String(status).toUpperCase() };
    }

    return { tone: 'neutral', icon: 'bi-info-circle', label: status ? String(status).toUpperCase() : 'UNKNOWN' };
}

function getStudentPaymentReceiptKey(payment) {
    return String(payment.receipt_id || payment.payment_id || '');
}

function resolveStudentPaymentProofUrl(proofPath) {
    if (!proofPath) return '';
    if (/^(?:https?:)?\/\//.test(proofPath)) return proofPath;
    return `../../${String(proofPath).replace(/^\/+/, '')}`;
}

function buildStudentPaymentHistoryReceiptData(enrollmentId, studentName, history, payment) {
    const receiptKey = getStudentPaymentReceiptKey(payment);
    const receiptRows = history.filter(item => getStudentPaymentReceiptKey(item) === receiptKey);
    const rows = receiptRows.length ? receiptRows : [payment];
    const amountPaid = rows.reduce((sum, item) => sum + Number(item.amount_paid || 0), 0);
    const balanceValues = rows
        .map(item => Number(item.balance))
        .filter(value => !Number.isNaN(value));
    const lineItems = rows.flatMap(item => {
        const paid = Number(item.amount_paid || 0);
        const penalty = Number(item.penalty_paid || 0);
        const base = Number(item.base_amount_paid ?? Math.max(paid - penalty, 0));
        const paidFor = item.billing_type || item.payment_type || 'Payment';

        return [
            ...(base > 0 ? [{ label: paidFor, amount: base }] : []),
            ...(penalty > 0 ? [{ label: `Penalty - ${paidFor}`, amount: penalty }] : [])
        ];
    });

    return {
        enrollmentId,
        studentName,
        receiptNo: receiptKey,
        copyLabels: ['CUSTOMER COPY'],
        paymentKind: payment.payment_status || 'Payment',
        paymentType: payment.payment_status || 'Payment',
        paymentFor: [...new Set(rows.map(item => item.billing_type || item.payment_type).filter(Boolean))].join(', ') || 'Tuition Fee',
        paymentMethod: payment.payment_method || '',
        referenceNo: payment.reference_no || null,
        amountPaid,
        balance: balanceValues.length ? Math.min(...balanceValues) : Number(payment.balance || 0),
        totalAmount: amountPaid,
        lineItems,
        paymentDate: payment.payment_date || new Date()
    };
}

function isStudentGcashPayment(payment) {
    const methodName = String(payment.payment_method || '').toLowerCase();
    return methodName.includes('gcash') || Boolean(payment.payment_screenshot_path);
}

function canStudentViewReceipt(payment) {
    return String(payment.payment_status || '').toLowerCase() === 'received';
}

function showStudentPaymentProof(payment, history, onViewReceipt) {
    const receiptKey = getStudentPaymentReceiptKey(payment);
    const receiptRows = history.filter(item => getStudentPaymentReceiptKey(item) === receiptKey);
    const detailRows = receiptRows.length ? receiptRows : [payment];
    const totalPaid = detailRows.reduce((sum, item) => sum + Number(item.amount_paid || 0), 0);
    const proof = payment.payment_screenshot_path
        ? `<img src="${resolveStudentPaymentProofUrl(payment.payment_screenshot_path)}" alt="Payment proof" class="img-fluid rounded-3" style="max-height: 420px; object-fit: contain;">`
        : '<p class="text-muted mb-0">No payment proof was uploaded for this record.</p>';

    Swal.fire({
        title: 'Payment Proof',
        width: '720px',
        showCloseButton: true,
        showCancelButton: true,
        cancelButtonText: 'Close',
        showConfirmButton: canStudentViewReceipt(payment),
        confirmButtonText: 'View Receipt',
        confirmButtonColor: '#5a67d8',
        reverseButtons: true,
        html: `
            <div class="text-start">
                <label class="form-label fw-bold text-secondary small mb-1">Payment Screenshot</label>
                <div class="border rounded-3 p-2 bg-light text-center mb-3">
                    ${proof}
                </div>
                <div class="mb-3">
                    <label class="form-label fw-bold text-secondary small mb-1">Payment Amount</label>
                    <div class="input-group">
                        <span class="input-group-text bg-white text-muted">PHP</span>
                        <input type="text" class="form-control" value="${totalPaid.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}" readonly>
                    </div>
                </div>
                <div class="mb-3">
                    <label class="form-label fw-bold text-secondary small mb-1">Payment Method</label>
                    <input type="text" class="form-control" value="${payment.payment_method || 'N/A'}" readonly>
                </div>
                <div>
                    <label class="form-label fw-bold text-secondary small mb-1">Reference Number</label>
                    <input type="text" class="form-control" value="${payment.reference_no || 'N/A'}" readonly>
                </div>
            </div>
        `
    }).then(result => {
        if (result.isConfirmed && canStudentViewReceipt(payment)) {
            onViewReceipt();
        }
    });
}

window.openStudentPaymentHistoryModal = function(enrollmentDetailsId) {
    Promise.all([
        axios.get(`../../api/student/payment.php?operation=getPaymentHistory&enrollment_details_id=${enrollmentDetailsId}`),
        axios.get(`../../api/student/enrollment.php?operation=getEnrollmentDetails&id=${enrollmentDetailsId}`)
    ]).then(([historyRes, enrollmentRes]) => {
        if (historyRes.data.status !== 'success') {
            throw new Error(historyRes.data.message || 'Failed to load payment history.');
        }

        const history = historyRes.data.history || [];
        const enrollmentStatus = enrollmentRes.data?.status === 'success'
            ? enrollmentRes.data.data?.details?.status
            : '';
        const resolvedStatus = enrollmentStatus || (history.some(payment => String(payment.payment_status).toLowerCase() === 'pending')
            ? 'pending'
            : history.length ? 'received' : 'unknown');
        const enrollmentBadge = getStudentPaymentHistoryStatus(resolvedStatus);

        const rows = history.length ? history.map(payment => {
            const amountPaid = Number(payment.amount_paid || 0);
            const penaltyPaid = Number(payment.penalty_paid || 0);
            const baseAmountPaid = Number(payment.base_amount_paid ?? Math.max(amountPaid - penaltyPaid, 0));
            const paymentBadge = getStudentPaymentHistoryStatus(payment.payment_status);
            const amount = amountPaid
                ? `PHP ${amountPaid.toLocaleString()}${penaltyPaid > 0 ? `<div class="small text-muted">Base: PHP ${baseAmountPaid.toLocaleString()} + <span class="text-danger">Penalty: PHP ${penaltyPaid.toLocaleString()}</span></div>` : ''}`
                : 'N/A';

            let actionButton = '<span class="text-muted">-</span>';
            if (isStudentGcashPayment(payment)) {
                actionButton = `<button type="button" class="payment-history-action view-student-payment-proof" data-receipt-key="${getStudentPaymentReceiptKey(payment)}"><i class="bi bi-image"></i>View Proof</button>`;
            } else if (canStudentViewReceipt(payment)) {
                actionButton = `<button type="button" class="payment-history-action view-student-payment-receipt" data-receipt-key="${getStudentPaymentReceiptKey(payment)}"><i class="bi bi-receipt"></i>View Receipt</button>`;
            }

            return `
                <tr>
                    <td data-label="Date">${payment.payment_date || 'N/A'}</td>
                    <td data-label="Paid For">${payment.payment_type || payment.billing_type || 'N/A'}</td>
                    <td data-label="Amount">${amount}</td>
                    <td data-label="Payment Method">${payment.payment_method || 'N/A'}</td>
                    <td data-label="Reference No.">${payment.reference_no || 'N/A'}</td>
                    <td data-label="Status"><span class="payment-row-status payment-row-status--${paymentBadge.tone}"><i class="bi ${paymentBadge.icon}"></i>${payment.payment_status || 'N/A'}</span></td>
                    <td data-label="Actions"><div class="payment-history-actions">${actionButton}</div></td>
                </tr>`;
        }).join('') : '<tr><td colspan="7" class="payment-history-empty">No payment history found.</td></tr>';

        Swal.fire({
            title: `Payment History - ${historyRes.data.student_name || 'Student'}`,
            html: `
                <div class="payment-history-status-row">
                    <span class="payment-enrollment-status payment-enrollment-status--${enrollmentBadge.tone}"><i class="bi ${enrollmentBadge.icon}"></i><span>Status: ${enrollmentBadge.label}</span></span>
                </div>
                <div class="payment-history-table-wrap"><table class="payment-history-table"><thead><tr><th>Date</th><th>Paid For</th><th>Amount</th><th>Payment Method</th><th>Reference No.</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`,
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
                const showReceipt = payment => {
                    showPaymentReceipt(buildStudentPaymentHistoryReceiptData(
                        enrollmentDetailsId,
                        historyRes.data.student_name || 'Student',
                        history,
                        payment
                    ));
                };

                Swal.getPopup()?.querySelectorAll('.view-student-payment-proof').forEach(button => {
                    button.addEventListener('click', () => {
                        const payment = history.find(item => getStudentPaymentReceiptKey(item) === button.dataset.receiptKey);
                        if (!payment) {
                            Swal.fire('Error', 'Payment proof is not available.', 'error');
                            return;
                        }

                        showStudentPaymentProof(payment, history, () => showReceipt(payment));
                    });
                });

                Swal.getPopup()?.querySelectorAll('.view-student-payment-receipt').forEach(button => {
                    button.addEventListener('click', () => {
                        const payment = history.find(item => getStudentPaymentReceiptKey(item) === button.dataset.receiptKey);
                        if (!payment) {
                            Swal.fire('Error', 'Receipt is not available.', 'error');
                            return;
                        }

                        showReceipt(payment);
                    });
                });
            }
        });
    }).catch(error => {
        console.error('Error loading payment history:', error);
        Swal.fire('Error', error.message || 'Failed to load payment history.', 'error');
    });
};
