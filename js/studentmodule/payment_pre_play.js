let prePlayPayments = [];

function escapePrePlayPaymentText(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[character]));
}

function getPrePlayPaymentStatus(enrollment) {
    const applicationStatus = String(enrollment.application_status || '').toLowerCase();
    if (applicationStatus === 'ready_for_scheduling') return 'Ready for Scheduling';
    if (applicationStatus === 'pending_review') return 'Pending Application Review';
    if (applicationStatus === 'approved_for_payment') return 'Awaiting Center Payment';

    const enrollmentStatus = String(enrollment.enrollment_status || enrollment.status || '').toLowerCase();
    if (enrollmentStatus === 'incomplete') return 'Incomplete';
    if (enrollment.payment_status) return enrollment.payment_status;

    if (Number(enrollment.balance || 0) <= 0) return 'Fully Paid';
    if (Number(enrollment.total_paid || 0) > 0) return 'Partial';
    return 'Unpaid';
}

function prePlayPaymentBadge(status) {
    const classes = {
        'Fully Paid': 'bg-success',
        'Partial': 'bg-warning text-dark',
        'Pending': 'bg-warning text-dark',
        'Unpaid': 'bg-danger',
        'Incomplete': 'bg-warning text-dark',
        'Ready for Scheduling': 'bg-primary',
        'Pending Application Review': 'bg-warning text-dark',
        'Awaiting Center Payment': 'bg-info text-dark'
    };
    return `<span class="badge ${classes[status] || 'bg-secondary'}">${escapePrePlayPaymentText(status)}</span>`;
}

function formatPrePlayAmount(value) {
    return `PHP ${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
}

function setPrePlayPaymentFilterOptions(id, values, placeholder) {
    const select = document.getElementById(id);
    if (!select) return;
    const previousValue = select.value;
    select.replaceChildren(new Option(placeholder, ''));
    values.forEach(value => select.add(new Option(value, value)));
    if (values.includes(previousValue)) select.value = previousValue;
}

function populatePrePlayPaymentFilters() {
    const uniqueSorted = values => [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
    setPrePlayPaymentFilterOptions('enrollment-status-filter', uniqueSorted(prePlayPayments.map(getPrePlayPaymentStatus)), 'All Status');
    setPrePlayPaymentFilterOptions('enrollment-subject-filter', uniqueSorted(prePlayPayments.map(item => item.subject_name || item.program_name)), 'All Subjects');
    setPrePlayPaymentFilterOptions('enrollment-teacher-filter', uniqueSorted(prePlayPayments.map(item => item.teacher_name)), 'All Teachers');
}

function renderPrePlayPayments(enrollments) {
    const tableBody = document.getElementById('paymentTableBody');
    if (!enrollments.length) {
        tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No enrollments found</td></tr>';
        return;
    }

    tableBody.innerHTML = enrollments.map(enrollment => {
        const status = getPrePlayPaymentStatus(enrollment);
        const awaitingCenter = ['Ready for Scheduling', 'Pending Application Review', 'Awaiting Center Payment'].includes(status);
        const incomplete = status === 'Incomplete';
        const enrollmentId = Number(enrollment.enrollment_details_id);
        const primaryAction = incomplete ? 'complete' : 'billing';
        const primaryLabel = incomplete ? 'Complete Enrollment' : awaitingCenter ? 'View Billing' : 'Pay';
        const primaryIcon = incomplete ? 'bi-clipboard-check' : 'bi-credit-card';

        return `<tr>
            <td>${escapePrePlayPaymentText(enrollment.program_name || 'N/A')}</td>
            <td>${escapePrePlayPaymentText(enrollment.subject_name || 'N/A')}</td>
            <td>${formatPrePlayAmount(enrollment.total_amount)}</td>
            <td>${formatPrePlayAmount(enrollment.total_paid)}</td>
            <td>${formatPrePlayAmount(enrollment.balance)}</td>
            <td>${prePlayPaymentBadge(status)}</td>
            <td>
                <button type="button" class="btn btn-sm ${incomplete ? 'btn-primary' : 'btn-success'}" data-payment-action="${primaryAction}" data-enrollment-id="${enrollmentId}"><i class="bi ${primaryIcon}"></i> ${primaryLabel}</button>
                <button type="button" class="btn btn-sm btn-info" data-payment-action="history" data-enrollment-id="${enrollmentId}"><i class="bi bi-eye"></i> View</button>
            </td>
        </tr>`;
    }).join('');
}

function applyPrePlayPaymentFilters() {
    const search = document.getElementById('search-input')?.value.trim().toLowerCase() || '';
    const status = document.getElementById('enrollment-status-filter')?.value || '';
    const subject = document.getElementById('enrollment-subject-filter')?.value || '';
    const teacher = document.getElementById('enrollment-teacher-filter')?.value || '';

    renderPrePlayPayments(prePlayPayments.filter(enrollment => {
        const enrollmentSubject = String(enrollment.subject_name || enrollment.program_name || '').trim();
        const enrollmentTeacher = String(enrollment.teacher_name || '').trim();
        return (!search || `${enrollmentSubject} ${enrollmentTeacher}`.toLowerCase().includes(search))
            && (!status || getPrePlayPaymentStatus(enrollment) === status)
            && (!subject || enrollmentSubject === subject)
            && (!teacher || enrollmentTeacher === teacher);
    }));
}

async function loadPrePlayPayments() {
    const tableBody = document.getElementById('paymentTableBody');
    try {
        const response = await axios.get('../../api/student/payment.php?operation=getStudentEnrollments&type=preplay');
        if (response.data.status !== 'success') throw new Error(response.data.message || 'Failed to load enrollments');
        prePlayPayments = response.data.data || [];
        populatePrePlayPaymentFilters();
        applyPrePlayPaymentFilters();
    } catch (error) {
        console.error('Error loading pre-school and play-school payments:', error);
        tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Failed to load data</td></tr>';
    }
}

window.loadEnrollments = loadPrePlayPayments;
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const filterContainer = document.querySelector('.filter-container');
    const filterToggle = filterContainer?.querySelector('.filter-toggle-btn');
    filterToggle?.setAttribute('aria-expanded', 'false');
    filterToggle?.addEventListener('click', () => {
        const isOpen = filterContainer.classList.toggle('filter-open');
        filterToggle.setAttribute('aria-expanded', String(isOpen));
    });
    let searchTimer;
    searchInput?.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(applyPrePlayPaymentFilters, 250);
    });
    ['enrollment-status-filter', 'enrollment-subject-filter', 'enrollment-teacher-filter']
        .forEach(id => document.getElementById(id)?.addEventListener('change', applyPrePlayPaymentFilters));
    document.getElementById('enrollment-apply-filters')?.addEventListener('click', applyPrePlayPaymentFilters);
    document.getElementById('paymentTableBody')?.addEventListener('click', event => {
        const button = event.target.closest('[data-payment-action]');
        if (!button) return;
        const enrollmentId = Number(button.dataset.enrollmentId);
        if (!Number.isSafeInteger(enrollmentId) || enrollmentId <= 0) return;
        if (button.dataset.paymentAction === 'complete') window.completeStudentPrePlayEnrollmentFromPayment(enrollmentId);
        if (button.dataset.paymentAction === 'billing') window.openBillingPlayPreModal(enrollmentId);
        if (button.dataset.paymentAction === 'history') window.openStudentPrePlayPaymentHistoryModal(enrollmentId);
    });
    window.addEventListener('payment-status-updated', loadPrePlayPayments);
    loadPrePlayPayments();
});
