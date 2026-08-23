const APPLICATION_API = '../../api/enrollment_application.php';
const applicationReadOnly = window.location.pathname.includes('/auditor/');

function ensureEnrollmentApplicationStyles() {
    if (document.getElementById('enrollmentApplicationStyles')) return;
    const style = document.createElement('style');
    style.id = 'enrollmentApplicationStyles';
    style.textContent = `
        .application-flow-popup {
            --application-pink: #ef4f83;
            --application-pink-dark: #d93d72;
            --application-pink-soft: #fff5f8;
            --application-pink-border: #f6bfd0;
            --application-ink: #111b33;
            --application-muted: #667085;
            border-radius: 22px !important;
            padding: 0 !important;
            overflow: hidden;
            box-shadow: 0 24px 70px rgba(17, 27, 51, .22) !important;
        }
        .application-flow-popup .swal2-title {
            color: var(--application-ink);
            font-size: clamp(1.45rem, 2.3vw, 2rem);
            line-height: 1.15;
            padding: 28px 78px 14px 30px;
            text-align: left;
        }
        .application-modal-title { display: flex; align-items: center; gap: 16px; }
        .application-modal-title-icon {
            width: 54px;
            height: 54px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 54px;
            border: 1px solid var(--application-pink-border);
            border-radius: 13px;
            color: var(--application-pink);
            background: linear-gradient(145deg, #fff, #fff0f5);
            font-size: 1.4rem;
        }
        .application-flow-popup .swal2-close {
            top: 20px;
            right: 22px;
            width: 46px;
            height: 46px;
            border: 1px solid #dce1e8;
            border-radius: 12px;
            color: #747b87;
            background: #fff;
            box-shadow: 0 4px 12px rgba(17, 27, 51, .07);
            font-size: 2rem;
        }
        .application-flow-popup .swal2-close:hover { color: var(--application-pink); background: var(--application-pink-soft); }
        .application-flow-popup .swal2-html-container {
            margin: 0 !important;
            padding: 12px 30px 22px !important;
            color: var(--application-ink);
            overflow-x: hidden;
        }
        .application-flow-popup .swal2-actions {
            width: 100%;
            justify-content: flex-end;
            gap: 12px;
            margin: 0 !important;
            padding: 18px 30px 26px;
            border-top: 1px solid #f0f1f4;
        }
        .application-flow-confirm,
        .application-flow-cancel,
        .application-flow-deny {
            min-height: 48px;
            margin: 0 !important;
            padding: 11px 22px;
            border-radius: 10px;
            font-weight: 700;
            transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
        }
        .application-flow-confirm {
            border: 1px solid var(--application-pink);
            color: #fff;
            background: linear-gradient(135deg, #f55b91, #e83e79);
            box-shadow: 0 8px 18px rgba(239, 79, 131, .23);
        }
        .application-flow-confirm:hover { transform: translateY(-1px); box-shadow: 0 10px 22px rgba(239, 79, 131, .3); }
        .application-flow-cancel {
            border: 1px solid #d7dce3;
            color: var(--application-ink);
            background: #fff;
        }
        .application-flow-deny { border: 1px solid #e45261; color: #c83242; background: #fff; }
        .application-summary-card,
        .application-section-card,
        .application-teacher-card,
        .application-session-table-shell {
            border: 1px solid var(--application-pink-border);
            border-radius: 12px;
            background: #fff;
        }
        .application-summary-card { padding: 22px 24px; background: linear-gradient(135deg, #fff, #fffafd); }
        .application-summary-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 20px; }
        .application-student-identity { display: flex; align-items: center; gap: 12px; }
        .application-avatar {
            width: 48px;
            height: 48px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 48px;
            border-radius: 50%;
            color: var(--application-pink);
            background: #ffe1eb;
            font-size: 1.25rem;
        }
        .application-eyebrow { color: var(--application-muted); font-size: .76rem; line-height: 1.2; text-transform: uppercase; letter-spacing: .035em; }
        .application-student-name { display: block; margin-top: 3px; color: var(--application-ink); font-size: 1.05rem; font-weight: 750; }
        .application-number-pill {
            display: inline-block;
            margin-top: 5px;
            padding: 7px 11px;
            border: 1px solid var(--application-pink-border);
            border-radius: 8px;
            color: var(--application-pink-dark);
            background: var(--application-pink-soft);
            font-weight: 750;
        }
        .application-meta-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px 28px; }
        .application-meta-item--wide { grid-column: 1 / -1; }
        .application-meta-label { display: block; margin-bottom: 4px; color: var(--application-muted); font-size: .83rem; }
        .application-meta-value { color: var(--application-ink); font-weight: 700; overflow-wrap: anywhere; }
        .application-chip-list { display: flex; flex-wrap: wrap; gap: 8px; }
        .application-chip {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 8px 11px;
            border: 1px solid var(--application-pink-border);
            border-radius: 8px;
            color: #bc3567;
            background: var(--application-pink-soft);
            font-size: .84rem;
            font-weight: 650;
        }
        .application-chip--neutral { color: var(--application-ink); background: #fff; border-color: #d9dee6; }
        .application-chip--success { color: #087452; background: #f2fcf8; border-color: #a9dfcc; }
        .application-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 16px; }
        .application-section-card { padding: 19px 20px; text-align: left; }
        .application-section-card--wide { grid-column: 1 / -1; }
        .application-section-title { display: flex; align-items: center; gap: 9px; margin: 0 0 14px; color: var(--application-ink); font-size: 1rem; font-weight: 750; }
        .application-section-title i { color: var(--application-pink); }
        .application-detail-line { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 10px; margin-top: 8px; font-size: .9rem; }
        .application-detail-line span:first-child { color: var(--application-muted); }
        .application-flow-callout {
            display: flex;
            align-items: flex-start;
            gap: 13px;
            padding: 16px 18px;
            border: 1px solid var(--application-pink-border);
            border-radius: 11px;
            color: var(--application-ink);
            background: #fff9fb;
            text-align: left;
        }
        .application-flow-callout > i { margin-top: 1px; color: var(--application-pink); font-size: 1.2rem; }
        .application-flow-callout--warning { border-color: #f3d59b; background: #fffaf1; }
        .application-flow-callout--warning > i { color: #e69b17; }
        .application-flow-callout--success { border-color: #a9dfcc; color: #086847; background: #f3fcf8; }
        .application-flow-callout--success > i { color: #16966b; }
        .application-form-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(260px, .9fr); gap: 22px; margin-top: 22px; }
        .application-form-grid--single { grid-template-columns: 1fr; }
        .application-flow-field label { display: block; margin-bottom: 8px; color: var(--application-ink); font-size: .9rem; font-weight: 750; }
        .application-flow-field .form-control,
        .application-flow-field .form-select {
            min-height: 50px;
            border-color: #d8dde5;
            border-radius: 9px;
            color: var(--application-ink);
        }
        .application-flow-field .form-control:focus,
        .application-flow-field .form-select:focus { border-color: var(--application-pink); box-shadow: 0 0 0 3px rgba(239, 79, 131, .12); }
        .application-flow-popup .swal2-input-label { justify-content: flex-start; margin: 8px 30px 0; color: var(--application-ink); font-size: .9rem; font-weight: 750; }
        .application-flow-popup .swal2-textarea {
            width: calc(100% - 60px);
            margin: 10px 30px 18px;
            border-color: #d8dde5;
            border-radius: 10px;
            color: var(--application-ink);
            box-shadow: none;
        }
        .application-flow-popup .swal2-textarea:focus { border-color: var(--application-pink); box-shadow: 0 0 0 3px rgba(239, 79, 131, .12); }
        .application-flow-help { margin-top: 7px; color: var(--application-muted); font-size: .8rem; line-height: 1.4; }
        .application-teacher-card { margin-top: 22px; padding: 20px; text-align: left; }
        .application-preview-label { display: block; margin-bottom: 10px; color: var(--application-muted); font-size: .86rem; }
        .application-session-table-shell { margin-top: 16px; padding: 4px 16px 12px; overflow: hidden; }
        .application-session-table { margin-bottom: 0; }
        .application-session-table thead th { padding: 13px 8px; border-bottom-color: var(--application-pink-border); color: var(--application-ink); background: var(--application-pink-soft); font-size: .78rem; text-transform: uppercase; letter-spacing: .025em; }
        .application-session-table tbody td { padding: 12px 8px; vertical-align: middle; }
        .application-session-table .form-control { border-radius: 8px; }
        .application-detail-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
        .application-inline-button { min-height: 44px; padding: 9px 17px; border-radius: 9px; font-weight: 700; }
        .application-inline-button--primary { border: 1px solid var(--application-pink); color: #fff; background: var(--application-pink); }
        .application-inline-button--outline { border: 1px solid var(--application-pink); color: var(--application-pink-dark); background: #fff; }
        .application-inline-button--danger { border: 1px solid #dc5362; color: #c73544; background: #fff; }
        .application-list-toolbar { display: grid; grid-template-columns: minmax(230px, 1.3fr) minmax(190px, 1fr) auto; gap: 14px; margin-bottom: 20px; }
        .application-list-table { border-collapse: separate; border-spacing: 0 10px; }
        .application-list-table thead th { padding: 14px 12px; border: 0; color: var(--application-ink); background: var(--application-pink-soft); }
        .application-list-table thead th:first-child { border: 1px solid var(--application-pink-border); border-right: 0; border-radius: 11px 0 0 11px; }
        .application-list-table thead th:not(:first-child):not(:last-child) { border-top: 1px solid var(--application-pink-border); border-bottom: 1px solid var(--application-pink-border); }
        .application-list-table thead th:last-child { border: 1px solid var(--application-pink-border); border-left: 0; border-radius: 0 11px 11px 0; }
        .application-list-table tbody td { padding: 14px 12px; border-top: 1px solid var(--application-pink-border); border-bottom: 1px solid var(--application-pink-border); background: #fff; }
        .application-list-table tbody td:first-child { border-left: 1px solid var(--application-pink-border); border-radius: 11px 0 0 11px; }
        .application-list-table tbody td:last-child { border-right: 1px solid var(--application-pink-border); border-radius: 0 11px 11px 0; }
        @media (max-width: 767px) {
            .application-flow-popup .swal2-title { padding: 20px 62px 10px 18px; font-size: 1.3rem; }
            .application-modal-title { gap: 10px; }
            .application-modal-title-icon { width: 44px; height: 44px; flex-basis: 44px; }
            .application-flow-popup .swal2-html-container { padding: 10px 18px 18px !important; }
            .application-flow-popup .swal2-actions { padding: 15px 18px 20px; }
            .application-summary-card { padding: 17px; }
            .application-summary-head { flex-direction: column; }
            .application-summary-head .text-end { text-align: left !important; }
            .application-meta-grid,
            .application-detail-grid,
            .application-form-grid,
            .application-list-toolbar { grid-template-columns: 1fr; }
            .application-detail-line { grid-template-columns: 1fr; gap: 1px; }
            .application-flow-confirm, .application-flow-cancel { width: 100%; }
        }
    `;
    document.head.appendChild(style);
}

function applicationModalTitle(icon, label) {
    return `<span class="application-modal-title"><span class="application-modal-title-icon"><i class="bi ${icon}"></i></span><span>${applicationEscape(label)}</span></span>`;
}

function applicationModalClasses() {
    return {
        popup: 'application-flow-popup',
        confirmButton: 'application-flow-confirm',
        cancelButton: 'application-flow-cancel',
        denyButton: 'application-flow-deny'
    };
}

const applicationEscape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[char]);
const applicationMoney = value => `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const applicationTime = value => {
    const [hours, minutes] = String(value || '00:00').split(':').map(Number);
    return new Date(2000, 0, 1, hours, minutes || 0).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
};

async function applicationApi(operation, data = {}) {
    const body = new URLSearchParams();
    body.set('operation', operation);
    body.set('json', JSON.stringify(data));
    const response = await axios.post(APPLICATION_API, body);
    return response.data;
}

const statusLabels = {
    pending_review: ['Pending', 'warning'],
    approved_for_payment: ['Awaiting Center Payment', 'info'],
    ready_for_scheduling: ['Ready for Scheduling', 'primary'],
    enrolled: ['Enrolled', 'success'],
    rejected: ['Rejected', 'danger'],
    cancelled: ['Cancelled', 'secondary']
};

function applicationStatusBadge(status) {
    const [label, tone] = statusLabels[status] || [status, 'secondary'];
    return `<span class="badge text-bg-${tone}">${applicationEscape(label)}</span>`;
}

function insertApplicationsButton() {
    document.getElementById('btn-new-student-applications')?.remove();
}

function applicationListRows(items) {
    if (!items.length) return '<tr><td colspan="7" class="text-center text-muted py-5">No online applications found.</td></tr>';
    return items.map(item => `<tr>
        <td><strong>${applicationEscape(item.application_number)}</strong><small class="d-block text-muted">${new Date(item.created_at).toLocaleDateString()}</small></td>
        <td>${applicationEscape([item.first_name, item.middle_name, item.last_name, item.ext].filter(Boolean).join(' '))}<small class="d-block text-muted">${applicationEscape(item.student_id_number)}</small></td>
        <td>${applicationEscape(item.program_name)}</td>
        <td>${applicationEscape(item.branch_name)}</td>
        <td>${applicationStatusBadge(item.status)}</td>
        <td>${applicationEscape(item.email)}</td>
        <td><button type="button" class="application-inline-button application-inline-button--outline" data-view-application="${item.application_id}">Open</button></td>
    </tr>`).join('');
}

export async function openNewStudentApplications(filters = {}) {
    ensureEnrollmentApplicationStyles();
    Swal.fire({ title: 'Loading applications…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const result = await applicationApi('listApplications', filters);
        if (result.status !== 'success') throw new Error(result.message);
        const pending = Number(result.counts?.pending_review || 0);
        const badge = document.getElementById('applicationPendingBadge');
        if (badge) { badge.textContent = pending; badge.classList.toggle('d-none', pending === 0); }

        await Swal.fire({
            title: applicationModalTitle('bi-file-earmark-text', 'New Student Applications'),
            width: 'min(1180px, 96vw)',
            showConfirmButton: false,
            showCloseButton: true,
            customClass: applicationModalClasses(),
            buttonsStyling: false,
            html: `<div class="application-list-toolbar text-start"><div class="application-flow-field"><label class="visually-hidden" for="applicationSearch">Search</label><input id="applicationSearch" class="form-control" placeholder="Search application or student"></div><div class="application-flow-field"><label class="visually-hidden" for="applicationStatusFilter">Status</label><select id="applicationStatusFilter" class="form-select"><option value="">All statuses</option>${Object.entries(statusLabels).map(([value, item]) => `<option value="${value}" ${filters.status === value ? 'selected' : ''}>${item[0]}</option>`).join('')}</select></div><button class="application-inline-button application-inline-button--outline" id="applicationApplyFilter"><i class="bi bi-funnel me-2"></i>Apply</button></div><div class="table-responsive"><table class="table align-middle text-start application-list-table"><thead><tr><th><i class="bi bi-file-earmark-text me-2 text-danger"></i>Application</th><th><i class="bi bi-person me-2 text-danger"></i>Student</th><th><i class="bi bi-mortarboard me-2 text-danger"></i>Program</th><th><i class="bi bi-geo-alt me-2 text-danger"></i>Center</th><th><i class="bi bi-patch-check me-2 text-danger"></i>Status</th><th><i class="bi bi-envelope me-2 text-danger"></i>Email</th><th>Action</th></tr></thead><tbody>${applicationListRows(result.data || [])}</tbody></table></div>`,
            didOpen: popup => {
                popup.querySelector('#applicationApplyFilter')?.addEventListener('click', () => openNewStudentApplications({ search: popup.querySelector('#applicationSearch').value.trim(), status: popup.querySelector('#applicationStatusFilter').value }));
                popup.querySelectorAll('[data-view-application]').forEach(button => button.addEventListener('click', () => viewNewStudentApplication(Number(button.dataset.viewApplication))));
            }
        });
    } catch (error) {
        Swal.fire('Applications Unavailable', error.response?.data?.message || error.message, 'error');
    }
}

function applicationDetailHtml(item) {
    const fullName = [item.first_name, item.middle_name, item.last_name, item.ext].filter(Boolean).join(' ');
    const availability = (item.availability || []).map(slot => `<span class="application-chip application-chip--neutral"><i class="bi bi-calendar3"></i>${applicationEscape(slot.day)} ${applicationTime(slot.start_time)}–${applicationTime(slot.end_time)}</span>`).join('');
    const subjects = (item.subjects || []).map(subject => `<span class="application-chip">${applicationEscape(subject.subject_name)}</span>`).join('') || '<span class="text-muted">To be confirmed during enrollment proper</span>';
    const actions = applicationReadOnly ? '' : item.status === 'pending_review'
        ? `<button class="application-inline-button application-inline-button--danger" id="rejectApplication"><i class="bi bi-x-circle me-2"></i>Reject</button><button class="application-inline-button application-inline-button--primary" id="approveApplication"><i class="bi bi-check-circle me-2"></i>Accept &amp; Continue to Payment</button>`
        : item.status === 'approved_for_payment'
            ? `<button class="application-inline-button application-inline-button--primary" id="receiveApplicationPayment"><i class="bi bi-cash-coin me-2"></i>Receive Downpayment</button>`
            : item.status === 'ready_for_scheduling'
                ? `<button class="application-inline-button application-inline-button--primary" id="scheduleApplication"><i class="bi bi-calendar2-check me-2"></i>Assign Teacher &amp; Plot Schedule</button>`
                : item.status === 'enrolled'
                    ? `<button class="application-inline-button application-inline-button--outline" id="showApplicationBilling"><i class="bi bi-receipt me-2"></i>Billing Statement</button>` : '';
    return `<div class="text-start">
        <div class="application-summary-card">
            <div class="application-summary-head"><div class="application-student-identity"><span class="application-avatar"><i class="bi bi-person-fill"></i></span><div><span class="application-eyebrow">Student</span><span class="application-student-name">${applicationEscape(fullName)}</span></div></div><div class="text-end"><span class="application-eyebrow">Application</span><span class="application-number-pill">${applicationEscape(item.application_number)}</span><div class="mt-2">${applicationStatusBadge(item.status)}</div></div></div>
            <div class="application-meta-grid"><div><span class="application-meta-label">Program</span><span class="application-meta-value">${applicationEscape(item.program_name)}</span></div><div><span class="application-meta-label">Center</span><span class="application-meta-value">${applicationEscape(item.branch_name)}</span></div><div><span class="application-meta-label">Submitted</span><span class="application-meta-value">${new Date(item.created_at).toLocaleString()}</span></div></div>
        </div>
        <div class="application-detail-grid">
            <section class="application-section-card"><h3 class="application-section-title"><i class="bi bi-person-vcard"></i>Student Information</h3><div class="application-detail-line"><span>Birthdate</span><strong>${applicationEscape(item.birthday)}</strong></div><div class="application-detail-line"><span>Email</span><strong>${applicationEscape(item.email)}</strong></div><div class="application-detail-line"><span>Student ID</span><strong>${applicationEscape(item.student_id_number)}</strong></div><div class="application-detail-line"><span>Username</span><strong>${applicationEscape(item.username)}</strong></div></section>
            <section class="application-section-card"><h3 class="application-section-title"><i class="bi bi-people"></i>Parent / Guardian</h3><div class="application-detail-line"><span>Name</span><strong>${applicationEscape(item.guardian_name)}</strong></div><div class="application-detail-line"><span>Relationship</span><strong>${applicationEscape(item.guardian_relationship)}</strong></div><div class="application-detail-line"><span>Contact</span><strong>${applicationEscape(item.guardian_contact)}</strong></div><div class="application-detail-line"><span>Address</span><strong>${applicationEscape([item.adr_street, item.adr_barangay, item.adr_city, item.adr_province].filter(Boolean).join(', ') || 'No address provided')}</strong></div></section>
            <section class="application-section-card application-section-card--wide"><h3 class="application-section-title"><i class="bi bi-mortarboard"></i>Learning Preferences</h3><div class="application-meta-grid"><div><span class="application-meta-label">Grade level</span><span class="application-meta-value">${applicationEscape(item.grade_level || 'Not selected')}</span></div><div class="application-meta-item--wide"><span class="application-meta-label">Selected subjects</span><div class="application-chip-list">${subjects}</div></div>${item.goal ? `<div class="application-meta-item--wide"><span class="application-meta-label">Learning goal</span><span>${applicationEscape(item.goal)}</span></div>` : ''}<div class="application-meta-item--wide"><span class="application-meta-label">Student's weekly availability</span><div class="application-chip-list">${availability || '<span class="text-muted">No availability recorded.</span>'}</div></div></div></section>
            <div class="application-section-card application-section-card--wide"><div class="application-flow-callout"><i class="bi bi-wallet2"></i><div><strong>Required center payment: ${applicationMoney(item.financial?.initial_payment)}</strong><div class="text-muted small mt-1">Registration ${applicationMoney(item.financial?.registration_fee)} + Downpayment ${applicationMoney(item.financial?.downpayment_amount)}</div>${item.review_notes ? `<div class="mt-2"><strong>Review notes:</strong> ${applicationEscape(item.review_notes)}</div>` : ''}</div></div></div>
        </div>
        <div class="application-detail-actions">${actions}</div>
    </div>`;
}

export async function viewNewStudentApplication(applicationId) {
    ensureEnrollmentApplicationStyles();
    Swal.fire({ title: 'Loading application…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const result = await applicationApi('getApplication', { application_id: applicationId });
        if (result.status !== 'success') throw new Error(result.message);
        const item = result.data;
        await Swal.fire({
            title: applicationModalTitle('bi-file-earmark-person', 'Application Details'), width: 'min(980px, 96vw)', showConfirmButton: false, showCloseButton: true,
            customClass: applicationModalClasses(), buttonsStyling: false,
            html: applicationDetailHtml(item),
            didOpen: popup => {
                popup.querySelector('#approveApplication')?.addEventListener('click', () => reviewNewStudentApplication(applicationId, 'approve'));
                popup.querySelector('#rejectApplication')?.addEventListener('click', () => reviewNewStudentApplication(applicationId, 'reject'));
                popup.querySelector('#receiveApplicationPayment')?.addEventListener('click', () => receiveApplicationDownpayment(item));
                popup.querySelector('#scheduleApplication')?.addEventListener('click', () => scheduleNewStudentApplication(item));
                popup.querySelector('#showApplicationBilling')?.addEventListener('click', () => openApplicationBilling(item));
            }
        });
    } catch (error) {
        Swal.fire('Unable to Open Application', error.response?.data?.message || error.message, 'error');
    }
}

async function reviewNewStudentApplication(applicationId, decision) {
    const answer = await Swal.fire({
        title: applicationModalTitle(decision === 'approve' ? 'bi-check2-circle' : 'bi-x-circle', decision === 'approve' ? 'Accept This Application?' : 'Reject This Application?'),
        input: 'textarea', inputLabel: 'Review notes', inputPlaceholder: decision === 'approve' ? 'Optional instructions for the family' : 'Explain why the application cannot proceed',
        inputValidator: value => decision === 'reject' && !value.trim() ? 'A reason is required when rejecting an application.' : undefined,
        showCancelButton: true, showCloseButton: true, reverseButtons: true,
        confirmButtonText: decision === 'approve' ? '<i class="bi bi-arrow-right-circle me-2"></i>Accept & Continue to Payment' : '<i class="bi bi-x-circle me-2"></i>Reject Application',
        customClass: applicationModalClasses(), buttonsStyling: false
    });
    if (!answer.isConfirmed) return;
    try {
        const result = await applicationApi('reviewApplication', { application_id: applicationId, decision, notes: answer.value });
        if (result.status !== 'success') throw new Error(result.message);
        window.loadEnrollments?.();
        if (decision === 'approve') {
            Swal.fire({ title: 'Opening center payment…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const application = await applicationApi('getApplication', { application_id: applicationId });
            if (application.status !== 'success') throw new Error(application.message);
            await receiveApplicationDownpayment(application.data);
            return;
        }
        await Swal.fire('Updated', result.message, 'success');
        viewNewStudentApplication(applicationId);
    } catch (error) {
        Swal.fire('Review Failed', error.response?.data?.message || error.message, 'error');
    }
}

async function receiveApplicationDownpayment(item) {
    ensureEnrollmentApplicationStyles();
    try {
        const methodsResult = await applicationApi('getPaymentMethods');
        if (methodsResult.status !== 'success') throw new Error(methodsResult.message);
        const methods = methodsResult.data || [];
        const answer = await Swal.fire({
            title: applicationModalTitle('bi-cash-coin', 'Receive Center Downpayment'),
            width: 'min(700px, 96vw)',
            html: `<div class="text-start"><div class="application-flow-callout mb-4"><i class="bi bi-wallet2"></i><div><span class="application-meta-label">Student</span><strong>${applicationEscape(item.first_name)} ${applicationEscape(item.last_name)}</strong><div class="mt-2">Required payment: <strong>${applicationMoney(item.financial.initial_payment)}</strong></div></div></div><div class="application-flow-field"><label for="applicationPaymentMethod">Payment method</label><select id="applicationPaymentMethod" class="form-select"><option value="">Select method</option>${methods.map(method => `<option value="${method.payment_method_id}" data-name="${applicationEscape(method.payment_method)}">${applicationEscape(method.payment_method)}</option>`).join('')}</select></div><div id="applicationReferenceWrap" class="application-flow-field mt-3 d-none"><label for="applicationPaymentReference">GCash reference number</label><input id="applicationPaymentReference" class="form-control" placeholder="Enter reference number"></div><div class="application-flow-field mt-3"><label for="applicationPaymentAmount">Amount received</label><input id="applicationPaymentAmount" class="form-control" type="number" step="0.01" value="${Number(item.financial.initial_payment).toFixed(2)}" readonly></div></div>`,
            showCancelButton: true, showCloseButton: true, reverseButtons: true,
            confirmButtonText: '<i class="bi bi-receipt me-2"></i>Record Payment & Issue Receipt',
            customClass: applicationModalClasses(), buttonsStyling: false,
            didOpen: popup => popup.querySelector('#applicationPaymentMethod').addEventListener('change', event => popup.querySelector('#applicationReferenceWrap').classList.toggle('d-none', !event.target.options[event.target.selectedIndex]?.dataset.name?.toLowerCase().includes('gcash'))),
            preConfirm: () => {
                const select = document.getElementById('applicationPaymentMethod');
                const methodId = select.value;
                const methodName = select.options[select.selectedIndex]?.dataset.name || '';
                const reference = document.getElementById('applicationPaymentReference').value.trim();
                if (!methodId) { Swal.showValidationMessage('Select a payment method.'); return false; }
                if (methodName.toLowerCase().includes('gcash') && !reference) { Swal.showValidationMessage('Enter the GCash reference number.'); return false; }
                return { payment_method_id: methodId, payment_method: methodName, reference_no: reference || null, amount: Number(item.financial.initial_payment) };
            }
        });
        if (!answer.isConfirmed) return;
        Swal.fire({ title: 'Recording payment…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        const result = await applicationApi('collectDownpayment', { application_id: item.application_id, ...answer.value });
        if (result.status !== 'success') throw new Error(result.message);
        await Swal.fire('Payment Recorded', result.message, 'success');
        if (typeof window.showPaymentReceipt === 'function' && result.receipt_id) {
            await window.showPaymentReceipt({
                enrollmentId: result.enrollment_details_id, studentName: result.student_name, programName: result.program_name,
                service: 'Initial Enrollment Payment', paymentType: 'Downpayment', paymentFor: 'Registration Fee and Downpayment',
                paymentMethod: result.payment_method, referenceNo: result.reference_no, receiptNo: result.receipt_id,
                amountPaid: result.amount_paid, balance: result.balance, totalAmount: result.amount_paid,
                lineItems: result.line_items || [], paymentDate: new Date()
            });
        }
        window.loadEnrollments?.();
        viewNewStudentApplication(item.application_id);
    } catch (error) {
        Swal.fire('Payment Failed', error.response?.data?.message || error.message, 'error');
    }
}

function mergeConsecutiveScheduleRows(rows, maximumGroupSize = 1) {
    const merged = [];
    rows.forEach((row, index) => {
        const previous = merged[merged.length - 1];
        const isConsecutive = previous
            && previous.date === row.date
            && previous.end_time === row.start_time
            && previous.session_count < maximumGroupSize;
        if (isConsecutive) {
            previous.end_time = row.end_time;
            previous.session_end = index + 1;
            previous.session_count += 1;
            return;
        }
        merged.push({ ...row, session_start: index + 1, session_end: index + 1, session_count: 1 });
    });
    return merged;
}

function scheduleRowsHtml(rows) {
    return rows.map(row => {
        const sessionLabel = row.session_start === row.session_end
            ? `Session ${row.session_start}`
            : `Sessions ${row.session_start}&ndash;${row.session_end}`;
        return `<tr data-schedule-row data-session-count="${row.session_count}"><td><strong>${sessionLabel}</strong><small class="d-block text-muted">${row.session_count} ${row.session_count === 1 ? 'hour' : 'hours'}</small></td><td><input type="date" class="form-control form-control-sm schedule-date" value="${applicationEscape(row.date)}"></td><td>${applicationEscape(row.day)}</td><td><input type="time" class="form-control form-control-sm schedule-start" value="${applicationEscape(row.start_time)}"></td><td><input type="time" class="form-control form-control-sm schedule-end" value="${applicationEscape(row.end_time)}"></td></tr>`;
    }).join('');
}

function expandMergedScheduleRows() {
    const schedule = [];
    const rows = [...document.querySelectorAll('#applicationScheduleRows [data-schedule-row]')];
    for (const row of rows) {
        const date = row.querySelector('.schedule-date').value;
        const startTime = row.querySelector('.schedule-start').value;
        const endTime = row.querySelector('.schedule-end').value;
        const sessionCount = Number(row.dataset.sessionCount || 1);
        const [startHour, startMinute] = startTime.split(':').map(Number);
        const [endHour, endMinute] = endTime.split(':').map(Number);
        const startMinutes = (startHour * 60) + startMinute;
        const endMinutes = (endHour * 60) + endMinute;
        if (!date || !startTime || !endTime || endMinutes - startMinutes !== sessionCount * 60) {
            Swal.showValidationMessage(`Each merged meeting must remain exactly ${sessionCount} ${sessionCount === 1 ? 'hour' : 'hours'}.`);
            return false;
        }
        for (let session = 0; session < sessionCount; session++) {
            const sessionStart = startMinutes + (session * 60);
            const sessionEnd = sessionStart + 60;
            const formatTime = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
            schedule.push({ date, start_time: formatTime(sessionStart), end_time: formatTime(sessionEnd) });
        }
    }
    return schedule;
}

function applicationSchedulingGuideHtml(item) {
    const subjects = (item.subjects || []).map(subject => `<span class="application-chip">${applicationEscape(subject.subject_name)}</span>`).join('') || '<span class="text-muted">No subjects selected</span>';
    const availability = (item.availability || []).map(slot => `<span class="application-chip application-chip--neutral"><i class="bi bi-calendar3"></i>${applicationEscape(slot.day)} ${applicationTime(slot.start_time)}–${applicationTime(slot.end_time)}</span>`).join('') || '<span class="text-danger">No student availability recorded.</span>';
    return `<div class="application-summary-card text-start mb-3">
        <div class="application-summary-head"><div class="application-student-identity"><span class="application-avatar"><i class="bi bi-person-fill"></i></span><div><span class="application-eyebrow">Student</span><span class="application-student-name">${applicationEscape([item.first_name, item.middle_name, item.last_name, item.ext].filter(Boolean).join(' '))}</span></div></div><div class="text-end"><span class="application-eyebrow">Application</span><span class="application-number-pill">${applicationEscape(item.application_number)}</span></div></div>
        <div class="application-meta-grid">
            <div><span class="application-meta-label">Program</span><span class="application-meta-value">${applicationEscape(item.program_name)}</span></div>
            <div><span class="application-meta-label">Center</span><span class="application-meta-value">${applicationEscape(item.branch_name)}</span></div>
            <div><span class="application-meta-label">Grade</span><span class="application-meta-value">${applicationEscape(item.grade_level || 'Not selected')}</span></div>
            <div class="application-meta-item--wide"><span class="application-meta-label">Selected subjects</span><div class="application-chip-list">${subjects}</div></div>
            ${item.goal ? `<div class="application-meta-item--wide"><span class="application-meta-label">Learning goal</span><span>${applicationEscape(item.goal)}</span></div>` : ''}
            <div class="application-meta-item--wide"><span class="application-meta-label">Student’s submitted availability</span><div class="application-chip-list">${availability}</div></div>
        </div>
    </div>`;
}

function teacherSchedulePreviewHtml(teacher, manualOverride) {
    if (!teacher) {
        return '<div class="text-muted text-center py-3"><i class="bi bi-calendar3 me-2"></i>Select a teacher to display their working schedule.</div>';
    }
    const workingSchedule = (teacher.working_schedule || []).map(slot => `<span class="application-chip application-chip--neutral"><i class="bi bi-calendar3"></i>${applicationEscape(slot.day_of_week)} ${applicationTime(slot.start_time)}–${applicationTime(slot.end_time)}</span>`).join('') || '<span class="text-danger">No working schedule configured.</span>';
    const matchingSlots = (teacher.matching_slots || []).map(slot => `<span class="application-chip application-chip--success"><i class="bi bi-calendar-check"></i>${applicationEscape(slot.day)} ${applicationTime(slot.start_time)}–${applicationTime(slot.end_time)}</span>`).join('') || '<span class="text-danger">No overlap with the student’s submitted availability.</span>';
    const qualification = manualOverride
        ? `<div class="application-flow-callout application-flow-callout--warning mt-3"><i class="bi bi-exclamation-triangle"></i><div><strong>Manual override:</strong> ${applicationEscape(teacher.qualification_note || 'Teacher does not satisfy every automatic filter.')}</div></div>`
        : '<div class="application-flow-callout application-flow-callout--success mt-3"><i class="bi bi-check-circle"></i><div>This teacher satisfies the automatic program, subject, branch, and availability filters.</div></div>';
    return `<div class="text-start">
        <div class="mb-3"><span class="application-preview-label">Teacher’s complete working schedule</span><div class="application-chip-list">${workingSchedule}</div></div>
        <div><span class="application-preview-label">Usable overlap with this student</span><div class="application-chip-list">${matchingSlots}</div></div>
        ${qualification}
    </div>`;
}

async function scheduleNewStudentApplication(item) {
    ensureEnrollmentApplicationStyles();
    try {
        Swal.fire({ title: 'Matching teachers…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        const [teacherResult, manualResult] = await Promise.all([
            applicationApi('getMatchingTeachers', { application_id: item.application_id }),
            applicationApi('getManualTeachers', { application_id: item.application_id })
        ]);
        if (teacherResult.status !== 'success') throw new Error(teacherResult.message);
        if (manualResult.status !== 'success') throw new Error(manualResult.message);
        const teachers = teacherResult.data || [];
        const manualTeachers = manualResult.data || [];
        const automaticIds = new Set(teachers.map(teacher => Number(teacher.employee_id)));
        const manualOnly = manualTeachers.filter(teacher => !automaticIds.has(Number(teacher.employee_id)));
        const teacherRecords = new Map(manualTeachers.map(teacher => [Number(teacher.employee_id), teacher]));
        teachers.forEach(teacher => teacherRecords.set(Number(teacher.employee_id), teacher));
        const automaticOptions = teachers.map(teacher => {
            const slots = teacher.matching_slots.map(slot => `${slot.day} ${applicationTime(slot.start_time)}–${applicationTime(slot.end_time)}`).join(', ');
            return `<option value="auto:${teacher.employee_id}">${applicationEscape(teacher.teacher_name)} — ${applicationEscape(slots)}</option>`;
        }).join('');
        const manualOptions = manualOnly.map(teacher => {
            const slots = (teacher.matching_slots || []).map(slot => `${slot.day} ${applicationTime(slot.start_time)}–${applicationTime(slot.end_time)}`).join(', ');
            const disabled = slots ? '' : ' disabled';
            const details = slots ? `${slots}; ${teacher.qualification_note}` : teacher.qualification_note;
            return `<option value="manual:${teacher.employee_id}"${disabled}>${applicationEscape(teacher.teacher_name)} — ${applicationEscape(details)}</option>`;
        }).join('');
        const hasSelectableTeacher = teachers.length || manualOnly.some(teacher => (teacher.matching_slots || []).length);
        if (!hasSelectableTeacher) {
            await Swal.fire({
                title: applicationModalTitle('bi-calendar-x', 'No Teacher With Overlapping Time'), width: 'min(900px, 96vw)',
                showCloseButton: true, customClass: applicationModalClasses(), buttonsStyling: false,
                html: `${applicationSchedulingGuideHtml(item)}<div class="application-flow-callout application-flow-callout--warning"><i class="bi bi-exclamation-triangle"></i><div>There are active teachers in this branch, but none has a working schedule overlapping the student’s submitted availability. Update a teacher’s working schedule or contact the family before continuing.</div></div>`
            });
            return;
        }
        const noAutomaticMatch = !teachers.length
            ? '<div class="application-flow-callout application-flow-callout--warning"><i class="bi bi-exclamation-triangle"></i><div><strong>No automatic match was found.</strong><br>You may use Manual Override below. Qualification differences are displayed beside each teacher, but schedule overlap and conflict rules will still be enforced.</div></div>'
            : '<div class="application-flow-callout"><i class="bi bi-info-circle"></i><div>Recommended matches satisfy the branch, program, subject, and availability filters.<br>Manual Override is available when an administrator needs to make the final assignment.</div></div>';
        const isSessionProgram = String(item.unit_type || '').toLowerCase() === 'session';
        const totalProgramSessions = Math.max(1, Number(item.total_units) || 1);
        const sessionsPerDayOptions = Array.from({ length: totalProgramSessions }, (_, index) => index + 1)
            .map(hours => `<option value="${hours}">${hours} ${hours === 1 ? 'hour' : 'hours'} — ${hours} ${hours === 1 ? 'session' : 'sessions'}</option>`).join('');
        const sessionsPerDayField = isSessionProgram
            ? `<div class="application-flow-field"><label for="applicationSessionsPerDay">Hours / sessions on the same day</label><select id="applicationSessionsPerDay" class="form-select">${sessionsPerDayOptions}</select><div class="application-flow-help">Each hour uses one consecutive session from the student’s ${totalProgramSessions}-session package.</div></div>`
            : '';
        const chooser = await Swal.fire({
            title: applicationModalTitle('bi-calendar2-week', 'Select Teacher & Plot Schedule'), width: 'min(1180px, 96vw)',
            html: `<div class="text-start">${applicationSchedulingGuideHtml(item)}${noAutomaticMatch}<div class="application-form-grid ${isSessionProgram ? '' : 'application-form-grid--single'}"><div class="application-flow-field"><label for="applicationTeacher">Teacher</label><select id="applicationTeacher" class="form-select"><option value="">Select teacher</option>${automaticOptions ? `<optgroup label="Recommended matches">${automaticOptions}</optgroup>` : ''}${manualOptions ? `<optgroup label="Manual override — active teachers in this branch">${manualOptions}</optgroup>` : ''}</select></div>${sessionsPerDayField}</div><div class="application-teacher-card" id="applicationTeacherSchedulePreview">${teacherSchedulePreviewHtml(null, false)}</div><div class="application-flow-callout mt-4"><i class="bi bi-lightbulb"></i><div>The system will generate conflict-free suggestions inside the student’s submitted availability and the selected teacher’s working schedule. You can adjust exact dates and times before finalizing.</div></div></div>`,
            showCancelButton: true,
            cancelButtonText: '<i class="bi bi-arrow-left me-2"></i>Back to Application Details',
            confirmButtonText: '<i class="bi bi-magic me-2"></i>Generate Session Suggestions',
            showCloseButton: true, reverseButtons: true,
            customClass: applicationModalClasses(), buttonsStyling: false,
            didOpen: popup => {
                const select = popup.querySelector('#applicationTeacher');
                const preview = popup.querySelector('#applicationTeacherSchedulePreview');
                select?.addEventListener('change', () => {
                    if (!select.value) {
                        preview.innerHTML = teacherSchedulePreviewHtml(null, false);
                        return;
                    }
                    const [mode, teacherId] = select.value.split(':');
                    preview.innerHTML = teacherSchedulePreviewHtml(teacherRecords.get(Number(teacherId)), mode === 'manual');
                });
            },
            preConfirm: () => {
                const value = document.getElementById('applicationTeacher').value;
                if (!value) { Swal.showValidationMessage('Select a teacher.'); return false; }
                const [mode, teacherId] = value.split(':');
                const sessionsPerDay = isSessionProgram ? Number(document.getElementById('applicationSessionsPerDay')?.value || 1) : 1;
                if (!Number.isInteger(sessionsPerDay) || sessionsPerDay < 1 || sessionsPerDay > totalProgramSessions) {
                    Swal.showValidationMessage(`Enter a whole number of hours from 1 to ${totalProgramSessions}.`);
                    return false;
                }
                return { teacherId: Number(teacherId), manualOverride: mode === 'manual', sessionsPerDay };
            }
        });
        if (!chooser.isConfirmed) {
            if (chooser.dismiss === Swal.DismissReason.cancel) {
                await viewNewStudentApplication(item.application_id);
            }
            return;
        }
        Swal.fire({ title: 'Generating sessions…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        const suggestionsResult = await applicationApi('getScheduleSuggestions', { application_id: item.application_id, teacher_id: chooser.value.teacherId, manual_override: chooser.value.manualOverride, sessions_per_day: chooser.value.sessionsPerDay });
        if (suggestionsResult.status !== 'success') throw new Error(suggestionsResult.message);
        const suggestions = suggestionsResult.data || [];
        const mergedSuggestions = mergeConsecutiveScheduleRows(suggestions, chooser.value.sessionsPerDay);
        const sessionPlan = isSessionProgram
            ? `<div class="application-flow-callout"><i class="bi bi-link-45deg"></i><div><strong>Selected meeting length:</strong> ${chooser.value.sessionsPerDay} ${chooser.value.sessionsPerDay === 1 ? 'hour' : 'hours'}. Consecutive package sessions on the same day are merged into one meeting row below.</div></div>`
            : '';
        const overrideWarning = chooser.value.manualOverride
            ? '<div class="application-flow-callout application-flow-callout--warning mb-3"><i class="bi bi-exclamation-triangle"></i><div><strong>Manual teacher override:</strong> Program or subject assignments may not fully match. Student availability, teacher working hours, and booking conflicts will still be validated.</div></div>'
            : '';
        const final = await Swal.fire({
            title: applicationModalTitle('bi-calendar2-check', 'Confirm Exact Sessions'), width: 'min(1100px, 96vw)',
            html: `<div class="text-start">${applicationSchedulingGuideHtml(item)}${overrideWarning}${sessionPlan}<div class="application-section-card mt-3"><span class="application-meta-label">Selected teacher</span><span class="application-meta-value"><i class="bi bi-person-check me-2" style="color:var(--application-pink)"></i>${applicationEscape(suggestionsResult.teacher.teacher_name)}</span></div><div class="application-session-table-shell table-responsive"><table class="table application-session-table align-middle"><thead><tr><th>Package Sessions</th><th>Date</th><th>Day</th><th>Start</th><th>End</th></tr></thead><tbody id="applicationScheduleRows">${scheduleRowsHtml(mergedSuggestions)}</tbody></table></div><div class="application-flow-callout application-flow-callout--warning mt-3"><i class="bi bi-exclamation-triangle"></i><div>Keep each merged meeting at its displayed duration. Final validation still checks every included hour against the student’s availability, the teacher’s working hours, and existing bookings.</div></div></div>`,
            showCancelButton: true,
            cancelButtonText: '<i class="bi bi-arrow-left me-2"></i>Back to Teacher & Schedule',
            confirmButtonText: '<i class="bi bi-check2-circle me-2"></i>Finalize Enrollment & Billing',
            showCloseButton: true, reverseButtons: true,
            customClass: applicationModalClasses(), buttonsStyling: false,
            preConfirm: () => expandMergedScheduleRows()
        });
        if (!final.isConfirmed) {
            if (final.dismiss === Swal.DismissReason.cancel) {
                await scheduleNewStudentApplication(item);
            }
            return;
        }
        Swal.fire({ title: 'Finalizing enrollment…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        const result = await applicationApi('finalizeEnrollment', { application_id: item.application_id, teacher_id: chooser.value.teacherId, manual_override: chooser.value.manualOverride, schedule: final.value });
        if (result.status !== 'success') throw new Error(result.message);
        await Swal.fire('Enrollment Completed', result.message, 'success');
        window.loadEnrollments?.();
        openApplicationBilling({
            enrollment_details_id: result.enrollment_details_id,
            billing: result.billing
        });
    } catch (error) {
        Swal.fire('Scheduling Failed', error.response?.data?.message || error.message, 'error');
    }
}

function openApplicationBilling(item) {
    const enrollmentId = Number(item?.enrollment_details_id || item?.billing?.enrollment_details_id || 0);
    if (!enrollmentId) {
        Swal.fire('Billing Unavailable', 'The billing statement has not been generated.', 'info');
        return;
    }
    if (typeof window.openBillingModal !== 'function') {
        Swal.fire('Billing Unavailable', 'The enrollment billing module could not be loaded.', 'error');
        return;
    }
    window.openBillingModal(enrollmentId, true);
}

export function initNewStudentApplications() {
    ensureEnrollmentApplicationStyles();
    insertApplicationsButton();
}

window.openNewStudentApplications = openNewStudentApplications;
window.viewNewStudentApplication = viewNewStudentApplication;
