import { getResolvedRolePermissions, normalizeRbacRoleKey } from '../utilities/rbac_navigation.js';

const APPLICATION_API = '../../api/enrollment_application.php';

function getCurrentOnlineApplicationPermissions() {
    if (window.location.pathname.includes('/student/')) return {};

    try {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        const role = normalizeRbacRoleKey(user?.role_name);
        return getResolvedRolePermissions(role).enrollment || {};
    } catch (error) {
        console.error('Error reading online application permissions:', error);
        return {};
    }
}

export function canUseOnlineApplicationPermission(permissionKey) {
    return Boolean(getCurrentOnlineApplicationPermissions()?.[permissionKey]);
}

function guardOnlineApplicationPermission(permissionKey, message) {
    if (canUseOnlineApplicationPermission(permissionKey)) return true;
    Swal.fire('Access Restricted', message, 'warning');
    return false;
}

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
        .application-session-date { position: relative; min-width: 190px; }
        .application-session-date .schedule-date { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
        .application-session-date:focus-within { outline: 2px solid var(--application-pink); outline-offset: 2px; border-radius: 8px; }
        .application-session-date .schedule-date-display { display: block; border: 1px solid var(--application-pink-border); border-radius: 8px; padding: 8px 10px; font-size: 13px; background: #fff; }
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
        .application-edit-form .application-form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 0; gap: 20px; }
        .application-edit-form .application-flow-field { min-width: 0; }
        .application-edit-subjects { width: 100%; }
        .application-edit-subjects summary {
            display: flex; align-items: center; justify-content: space-between; gap: 12px;
            min-height: 50px; padding: 12px 14px; border: 1px solid #d8dde5; border-radius: 9px;
            background: #fff; color: var(--application-ink); cursor: pointer; list-style: none;
        }
        .application-edit-subjects summary::-webkit-details-marker { display: none; }
        .application-edit-subjects summary > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .application-edit-subjects summary > i { flex-shrink: 0; color: var(--application-muted); transition: transform .15s ease; }
        .application-edit-subjects[open] summary { border-color: var(--application-pink); box-shadow: 0 0 0 3px rgba(239, 79, 131, .12); }
        .application-edit-subjects[open] summary > i { transform: rotate(180deg); }
        .application-edit-subject-options { max-height: 230px; overflow-y: auto; margin-top: 8px; padding: 6px; border: 1px solid #d8dde5; border-radius: 9px; background: #fff; }
        .application-edit-form .application-edit-subject-option { display: flex; align-items: center; gap: 11px; margin: 0; padding: 11px 12px; border-radius: 7px; font-weight: 500; cursor: pointer; }
        .application-edit-subject-option:hover, .application-edit-subject-option:has(input:checked) { background: var(--application-pink-soft); }
        .application-edit-subject-option:has(input:checked) { color: var(--application-pink-dark); }
        .application-edit-subject-option input { appearance: none; width: 18px; height: 18px; flex: 0 0 18px; margin: 0; border: 1.5px solid #aeb5c0; border-radius: 50%; background: #fff; cursor: pointer; }
        .application-edit-subject-option input:checked { border-color: var(--application-pink); background: radial-gradient(circle, #fff 0 3px, var(--application-pink) 4px); }
        .application-edit-subject-option input:focus-visible, .application-edit-subjects summary:focus-visible { outline: 2px solid var(--application-pink); outline-offset: 3px; }
        .application-edit-availability-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
        .application-edit-availability-heading > span { color: var(--application-ink); font-size: .9rem; font-weight: 750; }
        .application-edit-availability-heading .application-inline-button { min-height: 38px; padding: 7px 12px; font-size: .82rem; }
        .application-edit-availability-shell { border: 1px solid #d8dde5; border-radius: 10px; overflow-x: auto; }
        .application-edit-availability-table { width: 100%; min-width: 510px; margin: 0; border-collapse: collapse; }
        .application-edit-availability-table th { padding: 12px 14px; color: var(--application-ink); background: var(--application-pink-soft); font-size: .82rem; font-weight: 700; }
        .application-edit-availability-table td { padding: 12px 14px; border-top: 1px solid #edf0f4; vertical-align: middle; }
        .application-edit-availability-table th:last-child, .application-edit-availability-table td:last-child { width: 70px; text-align: center; }
        .application-edit-availability-table .form-select, .application-edit-availability-table .form-control { width: 100%; min-height: 44px; }
        .application-edit-availability-table .edit-remove-slot { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; min-height: 38px; padding: 0; border-radius: 8px; }
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
            .application-edit-form .application-form-grid { grid-template-columns: 1fr; gap: 16px; }
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

const isPreschoolApplication = item => {
    const programName = `${item?.program_name || ''} ${item?.program_type || ''}`.toLowerCase();
    return ['preschool', 'playschool', 'pre-school', 'play-school', 'pre school', 'play school']
        .some(keyword => programName.includes(keyword));
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

function applicationStatusBadge(status, item = null) {
    const [defaultLabel, tone] = statusLabels[status] || [status, 'secondary'];
    const label = status === 'ready_for_scheduling' && isPreschoolApplication(item)
        ? 'Ready for Class & Section'
        : defaultLabel;
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
        <td>${applicationStatusBadge(item.status, item)}</td>
        <td>${applicationEscape(item.email)}</td>
        <td><button type="button" class="application-inline-button application-inline-button--outline" data-view-application="${item.application_id}">Open</button></td>
    </tr>`).join('');
}

export async function openNewStudentApplications(filters = {}) {
    if (!guardOnlineApplicationPermission('view_online_applications', 'You do not have permission to view online enrollment applications.')) return;
    ensureEnrollmentApplicationStyles();
    Swal.fire({ title: 'Loading applications…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const result = await applicationApi('listApplications', filters);
        if (result.status !== 'success') throw new Error(result.message);
        const pending = Number(result.counts?.pending_review || 0);
        const badge = document.getElementById('applicationPendingBadge');
        if (badge) { badge.textContent = pending; badge.classList.toggle('d-none', pending === 0); }

        await Swal.fire({
            title: applicationModalTitle('bi-file-earmark-text', 'Online Enrollment Applications'),
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
    const submittedOnlinePayment = item.application_payment?.payment_status === 'pending_review';
    const paymentProofUrl = item.application_payment?.proof_pic
        ? window.resolveUploadUrl(item.application_payment.proof_pic)
        : '';
    const availability = (item.availability || []).map(slot => `<span class="application-chip application-chip--neutral"><i class="bi bi-calendar3"></i>${applicationEscape(slot.day)} ${applicationTime(slot.start_time)}–${applicationTime(slot.end_time)}</span>`).join('');
    const subjects = (item.subjects || []).map(subject => `<span class="application-chip">${applicationEscape(subject.subject_name)}</span>`).join('') || '<span class="text-muted">To be confirmed during enrollment proper</span>';
    const preschoolApplication = isPreschoolApplication(item);
    const selectedService = item.financial?.service_id && item.financial?.service_name
        ? `${applicationEscape(item.financial.service_name)} (${applicationMoney(item.financial.service_amount)} monthly)`
        : 'Not included';
    const canApprove = canUseOnlineApplicationPermission('approve_online_applications');
    const canReject = canUseOnlineApplicationPermission('reject_online_applications');
    const canReceivePayment = canUseOnlineApplicationPermission('receive_online_application_payment');
    const canFinalize = canUseOnlineApplicationPermission('finalize_online_applications');
    let actions = '';

    if (item.status === 'pending_review') {
        const pendingActions = [];
        if (canReject) {
            pendingActions.push('<button class="application-inline-button application-inline-button--danger" id="rejectApplication"><i class="bi bi-x-circle me-2"></i>Reject</button>');
        }
        if (canApprove && (!submittedOnlinePayment || canReceivePayment)) {
            const approveLabel = submittedOnlinePayment
                ? (canFinalize ? (preschoolApplication ? 'Approve Payment &amp; Assign Class' : 'Approve Payment &amp; Assign Teacher') : 'Approve Online Payment')
                : 'Accept &amp; Continue to Payment';
            pendingActions.push(`<button class="application-inline-button application-inline-button--primary" id="approveApplication"><i class="bi bi-check-circle me-2"></i>${approveLabel}</button>`);
        }
        actions = pendingActions.join('');
    } else if (item.status === 'approved_for_payment' && canReceivePayment) {
        actions = '<button class="application-inline-button application-inline-button--primary" id="receiveApplicationPayment"><i class="bi bi-cash-coin me-2"></i>Receive Downpayment</button>';
    } else if (item.status === 'ready_for_scheduling' && canFinalize) {
        actions = preschoolApplication
            ? '<button class="application-inline-button application-inline-button--primary" id="placePrePlayApplication"><i class="bi bi-diagram-3 me-2"></i>Assign Class &amp; Section</button>'
            : '<button class="application-inline-button application-inline-button--primary" id="scheduleApplication"><i class="bi bi-calendar2-check me-2"></i>Assign Teacher &amp; Plot Schedule</button>';
    } else if (item.status === 'enrolled') {
        actions = '<button class="application-inline-button application-inline-button--outline" id="showApplicationBilling"><i class="bi bi-receipt me-2"></i>Billing Statement</button>';
    }
    if (canUseOnlineApplicationPermission('edit_online_applications')
        && ['pending_review', 'approved_for_payment', 'ready_for_scheduling'].includes(item.status)
        && (item.submission_stage || 'submitted') === 'submitted') {
        actions = '<button class="application-inline-button application-inline-button--outline" id="editApplication"><i class="bi bi-pencil-square me-2"></i>Edit Application</button>' + actions;
    }
    return `<div class="text-start">
        <a class="btn agreement-view-link mb-3" href="../shared/agreements.html?application_id=${Number(item.application_id)}">View accepted agreements</a>
        <div class="application-summary-card">
            <div class="application-summary-head"><div class="application-student-identity"><span class="application-avatar"><i class="bi bi-person-fill"></i></span><div><span class="application-eyebrow">Student</span><span class="application-student-name">${applicationEscape(fullName)}</span></div></div><div class="text-end"><span class="application-eyebrow">Application</span><span class="application-number-pill">${applicationEscape(item.application_number)}</span><div class="mt-2">${applicationStatusBadge(item.status, item)}</div></div></div>
            <div class="application-meta-grid"><div><span class="application-meta-label">Program</span><span class="application-meta-value">${applicationEscape(item.program_name)}</span></div><div><span class="application-meta-label">Center</span><span class="application-meta-value">${applicationEscape(item.branch_name)}</span></div><div><span class="application-meta-label">Submitted</span><span class="application-meta-value">${new Date(item.created_at).toLocaleString()}</span></div></div>
        </div>
        <div class="application-detail-grid">
            <section class="application-section-card"><h3 class="application-section-title"><i class="bi bi-person-vcard"></i>Student Information</h3><div class="application-detail-line"><span>Birthdate</span><strong>${applicationEscape(item.birthday)}</strong></div><div class="application-detail-line"><span>Email</span><strong>${applicationEscape(item.email)}</strong></div><div class="application-detail-line"><span>Student ID</span><strong>${applicationEscape(item.student_id_number)}</strong></div><div class="application-detail-line"><span>Portal account</span><strong>${applicationEscape(item.username || 'Created after enrollment')}</strong></div></section>
            <section class="application-section-card"><h3 class="application-section-title"><i class="bi bi-people"></i>Parent / Guardian</h3><div class="application-detail-line"><span>Name</span><strong>${applicationEscape(item.guardian_name)}</strong></div><div class="application-detail-line"><span>Relationship</span><strong>${applicationEscape(item.guardian_relationship)}</strong></div><div class="application-detail-line"><span>Contact</span><strong>${applicationEscape(item.guardian_contact)}</strong></div><div class="application-detail-line"><span>Address</span><strong>${applicationEscape([item.adr_street, item.adr_barangay, item.adr_city, item.adr_province].filter(Boolean).join(', ') || 'No address provided')}</strong></div></section>
            ${preschoolApplication ? '' : `<section class="application-section-card application-section-card--wide"><h3 class="application-section-title"><i class="bi bi-mortarboard"></i>Learning Preferences</h3><div class="application-meta-grid"><div><span class="application-meta-label">Grade level</span><span class="application-meta-value">${applicationEscape(item.grade_level || 'Not selected')}</span></div><div><span class="application-meta-label">Preferred teacher</span><span class="application-meta-value">${applicationEscape(item.preferred_teacher_name || 'None')}</span></div><div class="application-meta-item--wide"><span class="application-meta-label">Selected subjects</span><div class="application-chip-list">${subjects}</div></div>${item.goal ? `<div class="application-meta-item--wide"><span class="application-meta-label">Learning goal</span><span>${applicationEscape(item.goal)}</span></div>` : ''}<div class="application-meta-item--wide"><span class="application-meta-label">Student's weekly availability</span><div class="application-chip-list">${availability || '<span class="text-muted">No availability recorded.</span>'}</div></div>${item.applicant_type === 'existing_student' ? `<div class="application-meta-item--wide"><div class="application-flow-callout"><i class="bi bi-info-circle"></i><div>${item.preferred_teacher_name ? `The student prefers <strong>${applicationEscape(item.preferred_teacher_name)}</strong>. This is a preference only; the center still makes the final teacher assignment.` : 'The student selected no preferred teacher. The center may choose the best available match.'}</div></div></div>` : ''}</div></section>`}
            <div class="application-section-card application-section-card--wide"><div class="application-flow-callout ${submittedOnlinePayment ? 'application-flow-callout--success' : ''}"><i class="bi bi-wallet2"></i><div><strong>Required payment: ${applicationMoney(item.financial?.initial_payment)}</strong><div class="text-muted small mt-1">Registration ${applicationMoney(item.financial?.registration_fee)} + Downpayment ${applicationMoney(item.financial?.downpayment_amount)}</div><div class="mt-2"><strong>Selected method:</strong> ${applicationEscape(item.application_payment?.payment_method || 'Not recorded')} · ${applicationEscape(String(item.application_payment?.payment_status || '').replaceAll('_', ' '))}</div>${item.application_payment?.reference_no ? `<div class="small mt-1"><strong>Reference:</strong> ${applicationEscape(item.application_payment.reference_no)}</div>` : ''}${paymentProofUrl ? '<button type="button" class="application-inline-button application-inline-button--outline d-inline-block mt-3" id="viewApplicationGcashProof"><i class="bi bi-image me-2"></i>View Payment Proof</button>' : ''}${item.review_notes ? `<div class="mt-2"><strong>Review notes:</strong><div class="mt-1" style="white-space: pre-wrap; overflow-wrap: anywhere;">${applicationEscape(item.review_notes)}</div></div>` : ''}</div></div></div>
            ${item.financial?.available_service ? `<section class="application-section-card application-section-card--wide"><h3 class="application-section-title"><i class="bi bi-bag-check"></i>Monthly Service</h3><div class="application-detail-line"><span>Applicant selection</span><strong>${selectedService}</strong></div></section>` : ''}
        </div>
        <div class="application-detail-actions">${actions}</div>
    </div>`;
}

async function showApplicationGcashProof(item) {
    const proofPath = String(item.application_payment?.proof_pic || '').replace(/^\/+/, '');
    if (!proofPath) {
        await Swal.fire('Payment Proof Unavailable', 'No payment screenshot was uploaded for this application.', 'info');
        return;
    }
    await Swal.fire({
        title: applicationModalTitle('bi-image', 'Payment Proof'),
        width: 'min(760px, 96vw)',
        html: `<div class="text-start"><div class="application-flow-callout mb-3"><i class="bi bi-receipt"></i><div><strong>${applicationMoney(item.application_payment?.amount)}</strong><div class="small text-muted mt-1">Reference: ${applicationEscape(item.application_payment?.reference_no || 'Not provided')}</div></div></div><div class="text-center"><img src="${applicationEscape(window.resolveUploadUrl(proofPath))}" alt="Uploaded payment proof" class="img-fluid rounded-3" style="max-height:70vh;object-fit:contain"></div></div>`,
        showCloseButton: true,
        confirmButtonText: 'Close',
        customClass: applicationModalClasses(),
        buttonsStyling: false
    });
}

export async function viewNewStudentApplication(applicationId) {
    if (!guardOnlineApplicationPermission('view_online_applications', 'You do not have permission to view online enrollment applications.')) return;
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
                popup.querySelector('#editApplication')?.addEventListener('click', () => editOnlineApplication(item));
                popup.querySelector('#approveApplication')?.addEventListener('click', () => reviewNewStudentApplication(item, 'approve'));
                popup.querySelector('#rejectApplication')?.addEventListener('click', () => reviewNewStudentApplication(item, 'reject'));
                popup.querySelector('#receiveApplicationPayment')?.addEventListener('click', () => receiveApplicationDownpayment(item));
                popup.querySelector('#viewApplicationGcashProof')?.addEventListener('click', async () => {
                    await showApplicationGcashProof(item);
                    await viewNewStudentApplication(item.application_id);
                });
                popup.querySelector('#scheduleApplication')?.addEventListener('click', () => scheduleNewStudentApplication(item));
                popup.querySelector('#placePrePlayApplication')?.addEventListener('click', () => {
                    if (typeof window.openPrePlayApplicationPlacement !== 'function') {
                        Swal.fire('Placement Unavailable', 'The Pre and Play School class placement form is not available on this page.', 'error');
                        return;
                    }
                    window.openPrePlayApplicationPlacement(item.application_id, item.enrollment_details_id);
                });
                popup.querySelector('#showApplicationBilling')?.addEventListener('click', () => openApplicationBilling(item));
            }
        });
    } catch (error) {
        Swal.fire('Unable to Open Application', error.response?.data?.message || error.message, 'error');
    }
}

export async function openApplicationScheduling(applicationId) {
    if (!guardOnlineApplicationPermission('finalize_online_applications', 'You do not have permission to schedule online applications.')) return;
    try {
        const result = await applicationApi('getApplication', { application_id: applicationId });
        if (result.status !== 'success') throw new Error(result.message || 'Unable to load the application.');
        if (result.data?.status !== 'ready_for_scheduling') {
            await viewNewStudentApplication(applicationId);
            return;
        }
        await scheduleNewStudentApplication(result.data);
    } catch (error) {
        Swal.fire('Scheduling Unavailable', error.response?.data?.message || error.message, 'error');
    }
}

window.openApplicationScheduling = openApplicationScheduling;

function applicationEditAvailabilityRow(slot = {}) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    return `<tr class="application-edit-slot">
        <td><select class="form-select edit-availability-day" aria-label="Available day">${days.map(day => `<option${day === slot.day ? ' selected' : ''}>${day}</option>`).join('')}</select></td>
        <td><input type="time" class="form-control edit-availability-start" aria-label="Availability start time" value="${applicationEscape(slot.start_time || '13:00')}"></td>
        <td><input type="time" class="form-control edit-availability-end" aria-label="Availability end time" value="${applicationEscape(slot.end_time || '17:00')}"></td>
        <td><button type="button" class="application-inline-button application-inline-button--danger edit-remove-slot" aria-label="Remove availability" title="Remove availability"><i class="bi bi-trash3" aria-hidden="true"></i></button></td>
    </tr>`;
}

async function editOnlineApplication(item) {
    if (!guardOnlineApplicationPermission('edit_online_applications', 'You do not have permission to edit online applications.')) return;
    try {
        Swal.fire({ title: 'Loading edit form…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        const result = await applicationApi('getLookups');
        if (result.status !== 'success') throw new Error(result.message);
        const lookups = result.data;
        const preschool = isPreschoolApplication(item);
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        const branchRestricted = normalizeRbacRoleKey(user.role_name) === 'branch admin';
        const branches = branchRestricted ? lookups.branches.filter(branch => Number(branch.branch_id) === Number(item.branch_id)) : [...lookups.branches];
        if (!branches.some(branch => Number(branch.branch_id) === Number(item.branch_id))) {
            branches.push({ branch_id: item.branch_id, branch_name: `${item.branch_name || 'Previous branch'} (inactive — choose an active branch)` });
        }
        const options = (rows, key, label, selected) => rows.map(row => `<option value="${row[key]}"${Number(row[key]) === Number(selected) ? ' selected' : ''}>${applicationEscape(row[label])}</option>`).join('');
        const selectedSubjects = new Set((item.subjects || []).map(subject => Number(subject.subject_id)));
        const grades = [...lookups.grades];
        if (item.grade_level_id && !grades.some(grade => Number(grade.grade_level_id) === Number(item.grade_level_id))) {
            grades.push({ grade_level_id: item.grade_level_id, grade_level: `${item.grade_level || 'Previous grade'} (inactive — choose an active grade)` });
        }
        const choice = await Swal.fire({
            title: applicationModalTitle('bi-pencil-square', 'Edit Application'), width: 'min(980px, 96vw)',
            showCancelButton: true, showCloseButton: true, reverseButtons: true,
            confirmButtonText: 'Save Corrections', cancelButtonText: 'Back to Application Details',
            customClass: applicationModalClasses(), buttonsStyling: false,
            html: `<div class="text-start application-edit-form">
                <div class="application-flow-callout mb-3"><i class="bi bi-info-circle"></i><div>Correct the preferences requested by the parent or guardian. Payment approval and receipts will be preserved. Branch changes that affect fees require auditor/owner billing review before they can be saved.</div></div>
                <div class="application-form-grid">
                    <div class="application-flow-field"><label for="editApplicationBranch">Branch</label><select id="editApplicationBranch" class="form-select">${options(branches, 'branch_id', 'branch_name', item.branch_id)}</select></div>
                    ${!preschool ? `<div class="application-flow-field"><label for="editApplicationGrade">Grade level</label><select id="editApplicationGrade" class="form-select"><option value="">Select grade</option>${options(grades, 'grade_level_id', 'grade_level', item.grade_level_id)}</select></div>` : ''}
                </div>
                ${!preschool ? `<div class="application-flow-field mt-3"><label id="editApplicationSubjectsLabel">Subjects</label><details class="application-edit-subjects" id="editApplicationSubjects"><summary aria-labelledby="editApplicationSubjectsLabel editApplicationSubjectSummary"><span id="editApplicationSubjectSummary">${applicationEscape((item.subjects || []).map(subject => subject.subject_name).join(', ') || 'Select one or more subjects')}</span><i class="bi bi-chevron-down" aria-hidden="true"></i></summary><div class="application-edit-subject-options" role="group" aria-labelledby="editApplicationSubjectsLabel">${lookups.subjects.map(subject => `<label class="application-edit-subject-option"><input type="checkbox" class="edit-application-subject" value="${subject.subject_id}"${selectedSubjects.has(Number(subject.subject_id)) ? ' checked' : ''}><span class="edit-subject-name">${applicationEscape(subject.subject_name)}</span></label>`).join('')}</div></details></div>
                <div class="application-flow-field mt-3"><label for="editApplicationGoal">Learning goal</label><textarea id="editApplicationGoal" class="form-control" rows="2">${applicationEscape(item.goal || '')}</textarea></div>
                <div class="application-flow-field mt-3"><label for="editApplicationDuration">How long should each session last?</label><select id="editApplicationDuration" class="form-select">${[[1, '1 hour'], [1.5, '1 hour and 30 minutes'], [2, '2 hours']].map(([hours, label]) => `<option value="${hours}"${hours === (Number(item.preferred_session_hours) || 1) ? ' selected' : ''}>${label}</option>`).join('')}</select><div class="application-flow-help">The program includes ${Number(item.total_units) || 12} consumable hours in total. Each session uses its duration from that balance.</div></div>
                <div class="application-flow-field mt-3"><div class="application-edit-availability-heading"><span id="editApplicationAvailabilityLabel">Weekly availability</span><button type="button" class="application-inline-button application-inline-button--outline" id="editAddAvailability"><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>Add Availability</button></div><div class="application-edit-availability-shell"><table class="application-edit-availability-table" aria-labelledby="editApplicationAvailabilityLabel"><thead><tr><th scope="col">Day</th><th scope="col">Start time</th><th scope="col">End time</th><th scope="col">Action</th></tr></thead><tbody id="editApplicationAvailability">${(item.availability?.length ? item.availability : [{}]).map(applicationEditAvailabilityRow).join('')}</tbody></table></div></div>` : ''}
                <div class="application-flow-help mt-3">Changing the branch or subjects clears the previous preferred teacher. Teacher matching and schedule validation will use the corrected details.</div>
                <div class="application-flow-field mt-3"><label for="editApplicationReason">Reason for correction *</label><textarea id="editApplicationReason" class="form-control" rows="2" maxlength="1000" placeholder="Example: Parent called to correct the grade level."></textarea></div>
            </div>`,
            didOpen: popup => {
                const subjectField = popup.querySelector('#editApplicationSubjects');
                subjectField?.addEventListener('change', () => {
                    const names = [...subjectField.querySelectorAll('.edit-application-subject:checked')].map(input => input.closest('label').querySelector('.edit-subject-name').textContent);
                    popup.querySelector('#editApplicationSubjectSummary').textContent = names.join(', ') || 'Select one or more subjects';
                });
                popup.addEventListener('click', event => {
                    if (subjectField && !subjectField.contains(event.target)) subjectField.open = false;
                });
                subjectField?.addEventListener('keydown', event => {
                    if (event.key === 'Escape' && subjectField.open) {
                        event.preventDefault(); event.stopPropagation(); subjectField.open = false;
                        subjectField.querySelector('summary').focus();
                    }
                });
                popup.querySelector('#editAddAvailability')?.addEventListener('click', () => popup.querySelector('#editApplicationAvailability').insertAdjacentHTML('beforeend', applicationEditAvailabilityRow()));
                popup.querySelector('#editApplicationAvailability')?.addEventListener('click', event => {
                    if (event.target.closest('.edit-remove-slot')) event.target.closest('.application-edit-slot').remove();
                });
            },
            preConfirm: async () => {
                const popup = Swal.getPopup();
                const reason = popup.querySelector('#editApplicationReason').value.trim();
                const data = { application_id: item.application_id, edit_version: item.edit_version,
                    branch_id: Number(popup.querySelector('#editApplicationBranch').value), reason };
                if (!reason) { Swal.showValidationMessage('Enter the reason for this correction.'); return false; }
                if (!preschool) {
                    data.grade_level_id = Number(popup.querySelector('#editApplicationGrade').value);
                    data.subject_ids = [...popup.querySelectorAll('.edit-application-subject:checked')].map(input => Number(input.value));
                    data.goal = popup.querySelector('#editApplicationGoal').value.trim();
                    data.preferred_session_hours = Number(popup.querySelector('#editApplicationDuration').value);
                    data.availability = [...popup.querySelectorAll('.application-edit-slot')].map(row => ({
                        day: row.querySelector('.edit-availability-day').value,
                        start_time: row.querySelector('.edit-availability-start').value,
                        end_time: row.querySelector('.edit-availability-end').value
                    }));
                    if (!data.grade_level_id || !data.subject_ids.length || !data.availability.length) {
                        Swal.showValidationMessage('Select a grade, at least one subject, and at least one availability window.'); return false;
                    }
                    if (data.availability.some(slot => !slot.start_time || !slot.end_time || slot.end_time <= slot.start_time)) {
                        Swal.showValidationMessage('Every availability window must have an end time later than its start time.'); return false;
                    }
                    for (let index = 0; index < data.availability.length; index++) {
                        const slot = data.availability[index];
                        for (let earlier = 0; earlier < index; earlier++) {
                            const other = data.availability[earlier];
                            if (slot.day !== other.day) continue;
                            const duplicate = slot.start_time === other.start_time && slot.end_time === other.end_time;
                            const overlaps = slot.start_time < other.end_time && slot.end_time > other.start_time;
                            if (duplicate || overlaps) {
                                Swal.showValidationMessage(`Warning: availability rows ${earlier + 1} and ${index + 1} ${duplicate ? 'have the same schedule' : 'overlap'} on ${slot.day}. ${duplicate ? 'Remove the duplicate row' : 'Adjust the times'} before saving corrections.`);
                                return false;
                            }
                        }
                    }
                }
                try {
                    const saved = await applicationApi('updateApplication', data);
                    if (saved.status !== 'success') throw new Error(saved.message);
                    return saved;
                } catch (error) {
                    Swal.showValidationMessage(error.response?.data?.message || error.message); return false;
                }
            },
            showLoaderOnConfirm: true, allowOutsideClick: () => !Swal.isLoading()
        });
        if (choice.isConfirmed) {
            await Swal.fire('Application Updated', choice.value.message, 'success');
            window.loadEnrollments?.();
        }
        await viewNewStudentApplication(item.application_id);
    } catch (error) {
        Swal.fire('Unable to Edit Application', error.response?.data?.message || error.message, 'error');
    }
}

async function reviewNewStudentApplication(item, decision) {
    const permissionKey = decision === 'approve' ? 'approve_online_applications' : 'reject_online_applications';
    const permissionMessage = decision === 'approve'
        ? 'You do not have permission to approve online enrollment applications.'
        : 'You do not have permission to reject online enrollment applications.';
    if (!guardOnlineApplicationPermission(permissionKey, permissionMessage)) return;

    const applicationId = Number(item.application_id);
    const submittedOnlinePayment = item.application_payment?.payment_status === 'pending_review';
    const canReceivePayment = canUseOnlineApplicationPermission('receive_online_application_payment');
    const canFinalize = canUseOnlineApplicationPermission('finalize_online_applications');
    if (decision === 'approve' && submittedOnlinePayment
        && !guardOnlineApplicationPermission('receive_online_application_payment', 'You need payment-receiving permission to approve a submitted online payment.')) return;
    const preschoolApplication = isPreschoolApplication(item);
    const answer = await Swal.fire({
        title: applicationModalTitle(decision === 'approve' ? 'bi-check2-circle' : 'bi-x-circle', decision === 'approve' ? 'Accept This Application?' : 'Reject This Application?'),
        input: 'textarea', inputLabel: 'Review notes', inputPlaceholder: decision === 'approve' ? 'Optional instructions for the family' : 'Explain why the application cannot proceed',
        inputValidator: value => decision === 'reject' && !value.trim() ? 'A reason is required when rejecting an application.' : undefined,
        showCancelButton: true, showCloseButton: true, reverseButtons: true,
        confirmButtonText: decision === 'approve'
            ? (submittedOnlinePayment
                ? `<i class="bi bi-check2-circle me-2"></i>${canFinalize ? `Approve Payment & ${preschoolApplication ? 'Assign Class' : 'Continue'}` : 'Approve Online Payment'}`
                : '<i class="bi bi-arrow-right-circle me-2"></i>Accept & Continue to Payment')
            : '<i class="bi bi-x-circle me-2"></i>Reject Application',
        customClass: applicationModalClasses(), buttonsStyling: false
    });
    if (!answer.isConfirmed) return;
    try {
        const result = await applicationApi('reviewApplication', { application_id: applicationId, decision, notes: answer.value });
        if (result.status !== 'success') throw new Error(result.message);
        window.loadEnrollments?.();
        if (decision === 'approve') {
            const application = await applicationApi('getApplication', { application_id: applicationId });
            if (application.status !== 'success') throw new Error(application.message);
            if (result.payment_confirmed) {
                await Swal.fire('Approved', result.message, 'success');
                if (!canFinalize) {
                    await viewNewStudentApplication(applicationId);
                    return;
                }
                if (isPreschoolApplication(application.data)) {
                    if (typeof window.openPrePlayApplicationPlacement !== 'function') {
                        await viewNewStudentApplication(applicationId);
                        return;
                    }
                    window.openPrePlayApplicationPlacement(application.data.application_id, application.data.enrollment_details_id);
                } else {
                    await scheduleNewStudentApplication(application.data);
                }
                return;
            }
            if (!canReceivePayment) {
                await Swal.fire('Application Approved', 'The application is ready for payment. A staff member with payment-receiving permission can continue.', 'success');
                await viewNewStudentApplication(applicationId);
                return;
            }
            Swal.fire({ title: 'Opening center payment…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
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
    if (!guardOnlineApplicationPermission('receive_online_application_payment', 'You do not have permission to receive online application payments.')) return;
    try {
        if (typeof window.openApplicationDownpaymentModal !== 'function') {
            throw new Error('The shared downpayment modal is not available on this page.');
        }
        await window.openApplicationDownpaymentModal(item, {
            onSuccess: async () => {
                window.loadEnrollments?.();
                await viewNewStudentApplication(item.application_id);
            }
        });
    } catch (error) {
        Swal.fire('Payment Failed', error.response?.data?.message || error.message, 'error');
    }
}

function formatScheduleHours(hours) {
    const value = Number(hours);
    return `${Number.isInteger(value) ? value : value.toFixed(1)} ${value === 1 ? 'hour' : 'hours'}`;
}

function scheduleDurationHours(startTime, endTime) {
    const [startHour, startMinute] = String(startTime).split(':').map(Number);
    const [endHour, endMinute] = String(endTime).split(':').map(Number);
    return (((endHour * 60) + endMinute) - ((startHour * 60) + startMinute)) / 60;
}

function applicationLongDate(value) {
    const date = new Date(value + 'T00:00:00Z');
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function scheduleRowsHtml(rows) {
    return rows.map((row, index) => {
        const durationHours = Number(row.duration_hours) || scheduleDurationHours(row.start_time, row.end_time);
        return `<tr data-schedule-row><td><strong>Session ${index + 1}</strong><small class="d-block text-muted">${formatScheduleHours(durationHours)}</small></td><td><div class="application-session-date"><span class="schedule-date-display" aria-hidden="true">${applicationLongDate(row.date)}</span><input type="date" class="form-control form-control-sm schedule-date" aria-label="Session ${index + 1} date" value="${applicationEscape(row.date)}"></div></td><td>${applicationEscape(row.day)}</td><td><input type="time" step="1800" class="form-control form-control-sm schedule-start" value="${applicationEscape(row.start_time)}"></td><td><input type="time" step="1800" class="form-control form-control-sm schedule-end" value="${applicationEscape(row.end_time)}"></td></tr>`;
    }).join('');
}

function collectScheduleRows(requiredHours) {
    const schedule = [];
    const rows = [...document.querySelectorAll('#applicationScheduleRows [data-schedule-row]')];
    let totalMinutes = 0;
    for (const row of rows) {
        const date = row.querySelector('.schedule-date').value;
        const startTime = row.querySelector('.schedule-start').value;
        const endTime = row.querySelector('.schedule-end').value;
        const [startHour, startMinute] = startTime.split(':').map(Number);
        const [endHour, endMinute] = endTime.split(':').map(Number);
        const startMinutes = (startHour * 60) + startMinute;
        const endMinutes = (endHour * 60) + endMinute;
        const durationMinutes = endMinutes - startMinutes;
        if (!date || !startTime || !endTime || durationMinutes < 30 || durationMinutes % 30 !== 0) {
            Swal.showValidationMessage('Each session must be at least 30 minutes and use 30-minute increments.');
            return false;
        }
        totalMinutes += durationMinutes;
        schedule.push({ date, start_time: startTime, end_time: endTime });
    }
    const requiredMinutes = Math.round(Number(requiredHours) * 60);
    if (totalMinutes !== requiredMinutes) {
        Swal.showValidationMessage(`The plotted sessions must total exactly ${formatScheduleHours(requiredHours)}. Current total: ${formatScheduleHours(totalMinutes / 60)}.`);
        return false;
    }
    return schedule;
}

function applicationSchedulingGuideHtml(item) {
    const programLabel = item.program_name + (item.program_type ? ` (${item.program_type})` : '');
    const subjects = (item.subjects || []).map(subject => `<span class="application-chip">${applicationEscape(subject.subject_name)}</span>`).join('') || '<span class="text-muted">No subjects selected</span>';
    const availability = (item.availability || []).map(slot => `<span class="application-chip application-chip--neutral"><i class="bi bi-calendar3"></i>${applicationEscape(slot.day)} ${applicationTime(slot.start_time)}–${applicationTime(slot.end_time)}</span>`).join('') || '<span class="text-danger">No student availability recorded.</span>';
    return `<div class="application-summary-card text-start mb-3">
        <div class="application-summary-head"><div class="application-student-identity"><span class="application-avatar"><i class="bi bi-person-fill"></i></span><div><span class="application-eyebrow">Student</span><span class="application-student-name">${applicationEscape([item.first_name, item.middle_name, item.last_name, item.ext].filter(Boolean).join(' '))}</span></div></div><div class="text-end"><span class="application-eyebrow">Application</span><span class="application-number-pill">${applicationEscape(item.application_number)}</span></div></div>
        <div class="application-meta-grid">
            <div><span class="application-meta-label">Program</span><span class="application-meta-value">${applicationEscape(programLabel)}</span></div>
            <div><span class="application-meta-label">Center</span><span class="application-meta-value">${applicationEscape(item.branch_name)}</span></div>
            <div><span class="application-meta-label">Grade</span><span class="application-meta-value">${applicationEscape(item.grade_level || 'Not selected')}</span></div>
            <div><span class="application-meta-label">Preferred teacher</span><span class="application-meta-value">${applicationEscape(item.preferred_teacher_name || 'None')}</span></div>
            ${String(item.unit_type || '').toLowerCase() === 'session' ? `<div><span class="application-meta-label">Preferred session duration</span><span class="application-meta-value">${item.preferred_session_hours ? formatScheduleHours(Number(item.preferred_session_hours)) : 'Not recorded — confirm with student or guardian'}</span></div>` : ''}
            <div class="application-meta-item--wide"><span class="application-meta-label">Selected subjects</span><div class="application-chip-list">${subjects}</div></div>
            ${item.goal ? `<div class="application-meta-item--wide"><span class="application-meta-label">Learning goal</span><span>${applicationEscape(item.goal)}</span></div>` : ''}
            ${item.applicant_type === 'existing_student' ? `<div class="application-meta-item--wide"><div class="application-flow-callout"><i class="bi bi-person-heart"></i><div>${item.preferred_teacher_name ? `Student preference: <strong>${applicationEscape(item.preferred_teacher_name)}</strong>. You may still assign another qualified teacher.` : 'No preferred teacher was selected.'}</div></div></div>` : ''}
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
    if (!guardOnlineApplicationPermission('finalize_online_applications', 'You do not have permission to assign teachers or finalize online applications.')) return;
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
            const hasAssignedTeacher = manualTeachers.length > 0;
            const programLabel = item.program_name + (item.program_type ? ` (${item.program_type})` : '');
            const unavailableReason = hasAssignedTeacher
                ? 'Active teachers assigned to this program in this branch have no saved working hours overlapping the student’s submitted availability. Check their weekly working schedules before continuing.'
                : `No active teacher in ${applicationEscape(item.branch_name)} is assigned to ${applicationEscape(programLabel)}. A teacher may have matching subjects and free hours but still be excluded because they are assigned to a different program. Check the teacher’s program assignments and the student’s enrolled program.`;
            await Swal.fire({
                title: applicationModalTitle('bi-calendar-x', hasAssignedTeacher ? 'No Teacher With Overlapping Time' : 'No Teacher Assigned to This Program'), width: 'min(900px, 96vw)',
                showCloseButton: true, customClass: applicationModalClasses(), buttonsStyling: false,
                html: `${applicationSchedulingGuideHtml(item)}<div class="application-flow-callout application-flow-callout--warning"><i class="bi bi-exclamation-triangle"></i><div>${unavailableReason}</div></div>`
            });
            return;
        }
        const noAutomaticMatch = !teachers.length
            ? '<div class="application-flow-callout application-flow-callout--warning"><i class="bi bi-exclamation-triangle"></i><div><strong>No automatic match was found.</strong><br>You may use Manual Override below for a teacher assigned to this program. Subject differences are displayed beside each teacher, while schedule overlap and conflict rules remain enforced.</div></div>'
            : '<div class="application-flow-callout"><i class="bi bi-info-circle"></i><div>Recommended matches satisfy the branch, program, subject, and availability filters.<br>Manual Override includes only teachers assigned to this program and may be used for subject qualification differences.</div></div>';
        const isSessionProgram = String(item.unit_type || '').toLowerCase() === 'session';
        const totalProgramSessions = Math.max(1, Number(item.total_units) || 1);
        const preferredSessionHours = Number(item.preferred_session_hours) || 1;
        const sessionDurationOptions = [[1, '1 hour'], [1.5, '1 hour and 30 minutes'], [2, '2 hours']]
            .filter(([hours]) => hours <= totalProgramSessions)
            .map(([hours, label]) => `<option value="${hours}"${hours === preferredSessionHours ? ' selected' : ''}>${label}</option>`).join('');
        const sessionsPerDayField = isSessionProgram
            ? `<div class="application-flow-field"><label for="applicationSessionsPerDay">Session duration</label><select id="applicationSessionsPerDay" class="form-select">${sessionDurationOptions}</select><div class="application-flow-help">The program includes ${totalProgramSessions} consumable hours in total. Each session uses its duration from that balance. For 12 hours: 12 one-hour sessions, 8 sessions of 1 hour and 30 minutes, or 6 two-hour sessions. Confirm any change to the student's preference with the student or guardian.</div></div>`
            : '';
        const chooser = await Swal.fire({
            title: applicationModalTitle('bi-calendar2-week', 'Select Teacher & Plot Schedule'), width: 'min(1180px, 96vw)',
            html: `<div class="text-start">${applicationSchedulingGuideHtml(item)}${noAutomaticMatch}<div class="application-form-grid ${isSessionProgram ? '' : 'application-form-grid--single'}"><div class="application-flow-field"><label for="applicationTeacher">Teacher</label><select id="applicationTeacher" class="form-select"><option value="">Select teacher</option>${automaticOptions ? `<optgroup label="Recommended matches">${automaticOptions}</optgroup>` : ''}${manualOptions ? `<optgroup label="Manual override — teachers assigned to this program">${manualOptions}</optgroup>` : ''}</select></div>${sessionsPerDayField}</div><div class="application-teacher-card" id="applicationTeacherSchedulePreview">${teacherSchedulePreviewHtml(null, false)}</div><div class="application-flow-callout mt-4"><i class="bi bi-lightbulb"></i><div>The system will generate conflict-free suggestions inside the student’s submitted availability and the selected teacher’s working schedule. You can adjust exact dates and times before finalizing.</div></div></div>`,
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
                if (![1, 1.5, 2].includes(sessionsPerDay) || sessionsPerDay > totalProgramSessions) {
                    Swal.showValidationMessage('Select a session duration of 1 hour, 1 hour and 30 minutes, or 2 hours within the program total.');
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
        const sessionPlan = isSessionProgram
            ? `<div class="application-flow-callout"><i class="bi bi-link-45deg"></i><div><strong>Selected session length:</strong> ${formatScheduleHours(chooser.value.sessionsPerDay)}. The final session may be shorter so the schedule totals exactly ${formatScheduleHours(totalProgramSessions)}.</div></div>`
            : '';
        const overrideWarning = chooser.value.manualOverride
            ? '<div class="application-flow-callout application-flow-callout--warning mb-3"><i class="bi bi-exclamation-triangle"></i><div><strong>Manual teacher override:</strong> The teacher is assigned to this program, but subject assignments may not fully match. Student availability, teacher working hours, and booking conflicts will still be validated.</div></div>'
            : '';
        const validityDays = Number(suggestionsResult.validity_days) || 0;
        const validityMessage = rows => {
            if (!validityDays || !rows.length) return '';
            const dates = rows.map(row => row.date).sort();
            const end = new Date(dates[0] + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + validityDays - 1);
            return 'Valid for ' + validityDays + ' days: ' + applicationLongDate(dates[0]) + ' through ' + applicationLongDate(end.toISOString().slice(0, 10)) + ', inclusive.';
        };
        const final = await Swal.fire({
            title: applicationModalTitle('bi-calendar2-check', 'Confirm Exact Sessions'), width: 'min(1100px, 96vw)',
            html: `<div class="text-start">${applicationSchedulingGuideHtml(item)}${overrideWarning}${sessionPlan}<p class="small" id="applicationValidityPreview">${applicationEscape(validityMessage(suggestions))}</p><div class="application-section-card mt-3"><span class="application-meta-label">Selected teacher</span><span class="application-meta-value"><i class="bi bi-person-check me-2" style="color:var(--application-pink)"></i>${applicationEscape(suggestionsResult.teacher.teacher_name)}</span></div><div class="application-session-table-shell table-responsive"><table class="table application-session-table align-middle"><thead><tr><th>Session</th><th>Date</th><th>Day</th><th>Start</th><th>End</th></tr></thead><tbody id="applicationScheduleRows">${scheduleRowsHtml(suggestions)}</tbody></table></div><div class="application-flow-callout application-flow-callout--warning mt-3"><i class="bi bi-exclamation-triangle"></i><div>You may adjust dates and times in 30-minute increments, but all sessions combined must retain the program’s total hours. Final validation checks student availability, teacher working hours, and existing bookings.</div></div></div>`,
            showCancelButton: true,
            cancelButtonText: '<i class="bi bi-arrow-left me-2"></i>Back to Teacher & Schedule',
            confirmButtonText: '<i class="bi bi-check2-circle me-2"></i>Finalize Enrollment & Billing',
            showCloseButton: true, reverseButtons: true,
            customClass: applicationModalClasses(), buttonsStyling: false,
            didOpen: () => {
                document.getElementById('applicationScheduleRows')?.addEventListener('change', event => {
                    if (event.target.matches('.schedule-date')) event.target.closest('.application-session-date').querySelector('.schedule-date-display').textContent = applicationLongDate(event.target.value);
                    const dates = [...document.querySelectorAll('#applicationScheduleRows input[type="date"]')].map(input => ({ date: input.value })).filter(row => row.date);
                    document.getElementById('applicationValidityPreview').textContent = validityMessage(dates);
                });
            },
            preConfirm: () => {
                const rows = collectScheduleRows(totalProgramSessions);
                if (!rows) return false;
                if (validityDays && rows.length) {
                    const dates = rows.map(row => row.date).sort();
                    const end = new Date(dates[0] + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + validityDays - 1);
                    if (dates[dates.length - 1] > end.toISOString().slice(0, 10)) { Swal.showValidationMessage('All sessions must fit within ' + validityDays + ' days from the first session.'); return false; }
                }
                return rows;
            }
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
        Swal.fire({
            title: 'Scheduling Failed', icon: 'error', width: 'min(850px, 96vw)',
            html: `<div class="text-start" style="white-space:pre-wrap">${applicationEscape(error.response?.data?.message || error.message)}</div>`
        });
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
window.canUseOnlineApplicationPermission = canUseOnlineApplicationPermission;
