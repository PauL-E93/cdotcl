import { AgreementForm } from '../modules/agreements.js?v=20261014-select-all';
import { startTour } from '../guide/tour.js?v=20261023-session-guides';
import { getEnrollmentRequestGuide } from '../guide/student/pages.js';
const APPLICATION_API_URL = '../../api/enrollment_application.php';
let agreementForm;
const TEACHER_API_URL = '../../api/admin/enrollment.php';
const state = { lookups: null, paymentMethod: null, application: null, availability: [] };
let initializationPromise = null;

const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[character]);
const money = value => `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function api(operation, data = {}) {
    const body = new URLSearchParams();
    body.set('operation', operation);
    body.set('json', JSON.stringify(data));
    return axios.post(APPLICATION_API_URL, body).then(response => response.data);
}

function showStep(step) {
    document.querySelectorAll('[data-request-step]').forEach(panel => {
        panel.classList.toggle('d-none', Number(panel.dataset.requestStep) !== step);
    });
    document.querySelectorAll('[data-step-indicator]').forEach(indicator => {
        const indicatorStep = Number(indicator.dataset.stepIndicator);
        indicator.classList.toggle('active', indicatorStep === step);
        indicator.classList.toggle('complete', indicatorStep < step);
    });
    const modalBody = document.querySelector('#studentEnrollmentRequestModal .modal-body');
    if (modalBody) {
        modalBody.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function setBusy(button, busy, label) {
    if (!button) return;
    if (!button.dataset.defaultHtml) button.dataset.defaultHtml = button.innerHTML;
    button.disabled = busy;
    button.innerHTML = busy
        ? `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>${escapeHtml(label)}`
        : button.dataset.defaultHtml;
}

function selectedProgram() {
    const programId = state.application?.program_id || $('requestProgram')?.value;
    return (state.lookups?.programs || []).find(program => String(program.program_id) === String(programId));
}

function programDisplayName(program) {
    const name = program?.name || program?.program_name || 'Paid tutorial program';
    const type = String(program?.program_type || '').trim();
    return type ? `${name} (${type})` : name;
}

function selectedSubjectIds() {
    return [...document.querySelectorAll('#detailsSubjects input:checked')].map(input => Number(input.value));
}

function updateSubjectSummary() {
    const summary = $('detailsSubjectsSummary');
    if (!summary) return;
    const names = [...document.querySelectorAll('#detailsSubjects input:checked')]
        .map(input => input.closest('label')?.querySelector('span')?.textContent?.trim())
        .filter(Boolean);
    summary.textContent = names.length ? names.join(', ') : 'Select one or more subjects';
}

function setSubjectMenuOpen(open) {
    const toggle = $('detailsSubjectsToggle');
    const menu = $('detailsSubjectsMenu');
    if (!toggle || !menu) return;
    menu.classList.toggle('d-none', !open);
    toggle.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
}

function formatTime(value) {
    if (!value) return '';
    const [hours, minutes] = String(value).split(':').map(Number);
    return new Date(2000, 0, 1, hours, minutes || 0).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
}

function updateProgramPayment() {
    const program = selectedProgram();
    $('requestProgramFee').textContent = money(program?.tuition);
    $('requestDownpayment').textContent = money(program?.downpayment);
    $('requestPaymentAmount').value = program ? Number(program.downpayment || 0).toFixed(2) : '';
    $('requestPaymentAmount').min = Number(program?.downpayment || 0).toFixed(2);
}

function resolveQrUrl(path) {
    return window.resolveUploadUrl(path);
}

function renderPaymentAccount() {
    const method = state.paymentMethod;
    const container = $('requestGcashAccount');
    if (!method || !container) return;
    const qrUrl = resolveQrUrl(method.qr_code);
    container.innerHTML = `
        <div class="request-payment-recipient">
            <div class="request-payment-kicker"><i class="bi bi-shield-check"></i> Send payment to</div>
            <strong class="request-payment-method">${escapeHtml(method.payment_method || 'GCash')}</strong>
            <dl>
                <div><dt>Account name</dt><dd>${escapeHtml(method.account_name || 'Contact the center')}</dd></div>
                <div><dt>Account number</dt><dd>${escapeHtml(method.account_number || 'Not configured')}${method.account_number ? `<button type="button" class="request-copy-button" data-copy-gcash="${escapeHtml(method.account_number)}"><i class="bi bi-copy"></i> Copy</button>` : ''}</dd></div>
            </dl>
            <p class="request-payment-reminder"><i class="bi bi-info-circle"></i> Verify the account details before sending your payment.</p>
        </div>
        <div class="request-qr-card">
            ${qrUrl ? `<img src="${escapeHtml(qrUrl)}" alt="GCash QR code"><button type="button" class="request-view-qr" data-view-gcash-qr><i class="bi bi-arrows-fullscreen"></i> View larger</button>` : '<span class="text-muted">QR code unavailable</span>'}
        </div>`;

    container.querySelector('[data-copy-gcash]')?.addEventListener('click', async event => {
        const value = event.currentTarget.dataset.copyGcash || '';
        try {
            await navigator.clipboard.writeText(value);
            const original = event.currentTarget.innerHTML;
            event.currentTarget.innerHTML = '<i class="bi bi-check2"></i> Copied';
            setTimeout(() => { event.currentTarget.innerHTML = original; }, 1500);
        } catch (error) {
            Swal.fire('Copy Unavailable', `Copy this GCash number: ${value}`, 'info');
        }
    });
    container.querySelector('[data-view-gcash-qr]')?.addEventListener('click', () => {
        Swal.fire({
            title: 'GCash QR Code',
            html: `<div class="request-qr-modal"><img src="${escapeHtml(qrUrl)}" alt="Larger GCash QR code"><p>${escapeHtml(method.account_name || '')}<br><strong>${escapeHtml(method.account_number || '')}</strong></p></div>`,
            width: 'min(520px, 94vw)',
            showCloseButton: true,
            confirmButtonText: 'Close',
            customClass: { popup: 'request-qr-popup', confirmButton: 'request-qr-close' },
            buttonsStyling: false
        });
    });
}

function populateLookups() {
    const tutorials = (state.lookups?.programs || []).filter(program =>
        `${program.name || ''} ${program.program_type || ''}`.toLowerCase().includes('tutorial'));
    $('requestProgram').innerHTML = '<option value="">Select tutorial program</option>' + tutorials
        .map(program => `<option value="${Number(program.program_id)}">${escapeHtml(programDisplayName(program))}</option>`).join('');

    const branchOptions = '<option value="">Select center</option>' + (state.lookups?.branches || [])
        .map(branch => `<option value="${Number(branch.branch_id)}">${escapeHtml(branch.branch_name)}</option>`).join('');
    $('requestBranch').innerHTML = branchOptions;
    $('detailsBranch').innerHTML = branchOptions;
    $('detailsGrade').innerHTML = '<option value="">Select grade level</option>' + (state.lookups?.grades || [])
        .map(grade => `<option value="${Number(grade.grade_level_id)}">${escapeHtml(grade.grade_level)}</option>`).join('');
    $('detailsSubjects').innerHTML = (state.lookups?.subjects || []).map(subject => `
        <label class="request-subject-option">
            <input type="checkbox" value="${Number(subject.subject_id)}">
            <span>${escapeHtml(subject.subject_name)}</span>
        </label>`).join('') || '<span class="text-muted">No subjects are configured.</span>';
    updateSubjectSummary();
}

function renderAvailability() {
    const container = $('availabilityList');
    if (!state.availability.length) {
        container.innerHTML = '<p>No availability added yet.</p>';
        return;
    }
    container.innerHTML = state.availability.map((slot, index) => `
        <span class="request-availability-item">
            <i class="bi bi-calendar3"></i>
            <strong>${escapeHtml(slot.day)}</strong> ${escapeHtml(formatTime(slot.start_time))}–${escapeHtml(formatTime(slot.end_time))}
            <button type="button" data-remove-availability="${index}" aria-label="Remove availability"><i class="bi bi-x-lg"></i></button>
        </span>`).join('');
}

function addAvailability() {
    const slot = { day: $('availabilityDay').value, start_time: $('availabilityStart').value, end_time: $('availabilityEnd').value };
    if (!slot.start_time || !slot.end_time || slot.end_time <= slot.start_time) {
        Swal.fire('Invalid Availability', 'Select a start time and a later end time.', 'warning');
        return;
    }
    if (state.availability.some(item => item.day === slot.day && item.start_time === slot.start_time && item.end_time === slot.end_time)) {
        Swal.fire('Already Added', 'That availability window is already in the list.', 'info');
        return;
    }
    state.availability.push(slot);
    renderAvailability();
}

async function filterPreferredTeachers(preselectedId = '') {
    const teacherSelect = $('detailsPreferredTeacher');
    const programId = state.application?.program_id;
    const branchId = state.application?.branch_id;
    const subjectIds = selectedSubjectIds();
    teacherSelect.innerHTML = '<option value="">None — let the center choose</option>';
    teacherSelect.disabled = true;
    if (!programId || !branchId || !subjectIds.length) return;

    teacherSelect.innerHTML = '<option value="">Loading matching teachers...</option>';
    try {
        const params = new URLSearchParams({
            operation: 'getFilteredTeachers', program_id: programId, branch_id: branchId, subject_ids: subjectIds.join(',')
        });
        const response = await axios.get(`${TEACHER_API_URL}?${params.toString()}`);
        if (response.data.status !== 'success') throw new Error(response.data.message || 'Unable to load teachers.');
        teacherSelect.innerHTML = '<option value="">None — let the center choose</option>' + (response.data.data || [])
            .map(teacher => `<option value="${Number(teacher.employee_id)}">${escapeHtml(teacher.name)}</option>`).join('');
        teacherSelect.disabled = false;
        if (preselectedId && [...teacherSelect.options].some(option => option.value === String(preselectedId))) {
            teacherSelect.value = String(preselectedId);
        }
    } catch (error) {
        console.error('Preferred teacher lookup failed:', error);
        teacherSelect.innerHTML = '<option value="">None — let the center choose</option>';
        teacherSelect.disabled = false;
    }
}

function openEnrollmentDetails(application) {
    state.application = application;
    if (!agreementForm) agreementForm = new AgreementForm(document.getElementById('existingStudentAgreements'));
    const program = selectedProgram();
    agreementForm.setProgram(application.program_id, application.guardian_name || '', program?.program_type_name || program?.program_type || application.program_type || '');
    $('detailsProgram').value = programDisplayName(program || application);
    $('paidProgramSummary').textContent = `${programDisplayName(program || application)} payment proof recorded. Complete the preferences below.`;
    $('requestProgram').value = String(application.program_id || '');
    $('requestBranch').value = String(application.branch_id || '');
    $('detailsBranch').value = String(application.branch_id || '');
    if (application.grade_level_id) $('detailsGrade').value = String(application.grade_level_id);
    if (application.goal) $('detailsGoal').value = application.goal;
    $('preferredSessionHours').value = String(application.preferred_session_hours || 1);
    const hours = Number(program?.total_units || application.total_units) || 12;
    $('sessionDurationNote').textContent = `The program includes ${hours} consumable hours in total. Each session uses the selected duration from that balance. For 12 hours: 12 one-hour sessions, 8 sessions of 1 hour and 30 minutes, or 6 two-hour sessions. The center will confirm your final schedule.`;

    const selectedIds = (application.subjects || []).map(subject => String(subject.subject_id));
    document.querySelectorAll('#detailsSubjects input').forEach(input => { input.checked = selectedIds.includes(input.value); });
    updateSubjectSummary();
    state.availability = Array.isArray(application.availability) ? application.availability : [];
    renderAvailability();
    filterPreferredTeachers(application.preferred_teacher_id || '');
    showStep(2);
}

async function submitPayment() {
    const button = $('payAndContinue');
    const program = selectedProgram();
    const branchId = Number($('requestBranch').value || 0);
    const screenshot = $('requestPaymentScreenshot').files?.[0];
    const amount = Number($('requestPaymentAmount').value || 0);
    const expectedAmount = Number(program?.downpayment || 0);
    const reference = $('requestReference').value.trim();

    if (!program) return Swal.fire('Program Required', 'Select a tutorial program.', 'warning');
    if (!branchId) return Swal.fire('Center Required', 'Select your preferred center.', 'warning');
    if (!state.paymentMethod) return Swal.fire('GCash Unavailable', 'The center has not configured a GCash payment method.', 'error');
    if (!screenshot) return Swal.fire('Receipt Required', 'Upload your GCash payment screenshot.', 'warning');
    if (!['image/jpeg', 'image/png'].includes(screenshot.type) || screenshot.size > 10 * 1024 * 1024) {
        return Swal.fire('Invalid Screenshot', 'Use a JPG or PNG file no larger than 10MB.', 'warning');
    }
    if ($('requestOcrStatus').dataset.ocrBusy === 'true') return Swal.fire('Reading Receipt', 'Please wait for receipt reading to finish.', 'info');
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) return Swal.fire('Invalid Amount', 'Enter a valid payment amount with up to two decimal places.', 'warning');
    if (Math.round(amount * 100) < Math.round(expectedAmount * 100)) return Swal.fire('Insufficient Downpayment', `Payment must be at least ${money(expectedAmount)}. You may enter a higher amount or pay in full.`, 'warning');
    if (!/^(?:\d{10}|\d{12}|\d{13})$/.test(reference)) return Swal.fire('Reference Required', 'Enter a 10-, 12-, or 13-digit GCash reference number.', 'warning');

    const confirmation = await Swal.fire({
        icon: 'question', title: 'Submit this payment proof?',
        text: 'Your payment proof will be submitted for approval, then you will continue to enrollment preferences. Your receipt will be generated once the payment is approved.',
        showCancelButton: true, confirmButtonText: 'Pay & Continue'
    });
    if (!confirmation.isConfirmed) return;

    setBusy(button, true, 'Recording payment...');
    try {
        const body = new FormData();
        body.set('operation', 'startExistingStudentApplication');
        body.set('json', JSON.stringify({
            program_id: program.program_id, branch_id: branchId,
            payment_method_id: state.paymentMethod.payment_method_id,
            payment_reference_no: reference, payment_amount: amount
        }));
        body.set('payment_screenshot', screenshot);
        const response = await axios.post(APPLICATION_API_URL, body);
        if (response.data.status !== 'success') throw new Error(response.data.message || 'Unable to record payment.');

        state.application = response.data;
        await Swal.fire({
            title: 'Payment submitted for review',
            text: 'Your payment is awaiting approval. Your receipt will be generated after your payment is approved. Continue with your enrollment details for center review.',
            icon: 'info',
            confirmButtonText: 'Continue to Enrollment Details'
        });
        openEnrollmentDetails(state.application);
    } catch (error) {
        Swal.fire('Payment Not Recorded', error.response?.data?.message || error.message, 'error');
    } finally {
        setBusy(button, false);
    }
}

async function submitForReview() {
    let agreementData;
    try { agreementData = agreementForm.payload(); }
    catch (error) { return Swal.fire('Agreement Required', error.message, 'warning'); }
    const button = $('submitForReview');
    const gradeLevelId = $('detailsGrade').value;
    const subjectIds = selectedSubjectIds();
    const preferredSessionHours = Number($('preferredSessionHours').value);
    if (![1, 1.5, 2].includes(preferredSessionHours)) return Swal.fire('Session Duration Required', 'Select a session duration.', 'warning');
    if (!gradeLevelId) return Swal.fire('Grade Required', 'Select your grade level.', 'warning');
    if (!subjectIds.length) return Swal.fire('Subjects Required', 'Select at least one subject.', 'warning');
    if (!state.availability.length) return Swal.fire('Availability Required', 'Add at least one weekly availability window.', 'warning');

    const preferredTeacher = $('detailsPreferredTeacher');
    const preferredTeacherName = preferredTeacher.value ? preferredTeacher.options[preferredTeacher.selectedIndex]?.text : 'None';
    const confirmation = await Swal.fire({
        icon: 'question', title: 'Forward to the center?',
        html: `<div class="text-start"><p><strong>Preferred teacher:</strong> ${escapeHtml(preferredTeacherName)}</p><p class="mb-0">This will appear as an Online Application. The center will review the payment, assign the teacher, and plot the final schedule.</p></div>`,
        showCancelButton: true, confirmButtonText: 'Forward Application'
    });
    if (!confirmation.isConfirmed) return;

    setBusy(button, true, 'Forwarding application...');
    try {
        const result = await api('submitExistingStudentApplicationDetails', {
            ...agreementData,
            application_id: state.application.application_id,
            grade_level_id: gradeLevelId, subject_ids: subjectIds,
            goal: $('detailsGoal').value.trim(),
            preferred_teacher_id: preferredTeacher.value || null,
            availability: state.availability,
            preferred_session_hours: preferredSessionHours
        });
        if (result.status !== 'success') throw new Error(result.message || 'Unable to submit enrollment details.');
        state.application.submission_stage = 'submitted';
        state.application.application_number = result.application_number || state.application.application_number;
        showStep(3);
    } catch (error) {
        Swal.fire('Application Not Forwarded', error.response?.data?.message || error.message, 'error');
    } finally {
        setBusy(button, false);
    }
}

function bindReceiptReader() {
    const fileInput = $('requestPaymentScreenshot');
    const uploadArea = fileInput.closest('.request-upload');
    fileInput.addEventListener('change', () => {
        $('requestUploadName').textContent = fileInput.files?.[0]?.name || 'Supports JPG and PNG files up to 10MB.';
    });
    ['dragenter', 'dragover'].forEach(eventName => {
        uploadArea.addEventListener(eventName, event => {
            event.preventDefault();
            uploadArea.classList.add('dragover');
        });
    });
    ['dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, event => {
            event.preventDefault();
            uploadArea.classList.remove('dragover');
        });
    });
    uploadArea.addEventListener('drop', event => {
        const file = event.dataTransfer?.files?.[0];
        if (!file) return;
        if (!['image/jpeg', 'image/png'].includes(file.type)) {
            Swal.fire('Unsupported File', 'Please upload a JPG or PNG GCash screenshot.', 'warning');
            return;
        }
        const transfer = new DataTransfer();
        transfer.items.add(file);
        fileInput.files = transfer.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    if (typeof window.attachGcashOcrAutoFill === 'function') {
        window.attachGcashOcrAutoFill({
            fileInputId: 'requestPaymentScreenshot', actionButtonId: 'requestReadReceipt',
            amountInputId: 'requestPaymentAmount', refInputId: 'requestReference', statusId: 'requestOcrStatus',
            previewWrapperId: 'requestScreenshotPreviewWrapper', previewImageId: 'requestScreenshotPreviewImage'
        });
    } else {
        $('requestOcrStatus').textContent = 'Receipt reading is unavailable. Enter the amount and reference number manually.';
    }
}

async function initialize() {
    try {
        const [lookupsResponse, applicationResponse] = await Promise.all([
            axios.get(`${APPLICATION_API_URL}?operation=getLookups`), api('getExistingStudentApplicationState')
        ]);
        if (lookupsResponse.data?.status !== 'success') throw new Error(lookupsResponse.data?.message || 'Unable to load enrollment choices.');
        state.lookups = lookupsResponse.data.data || {};
        state.paymentMethod = (state.lookups.paymentMethods || [])
            .find(method => String(method.payment_method || '').toLowerCase() === 'gcash') || null;
        $('requestPaymentMethod').value = state.paymentMethod?.payment_method_id || '';
        populateLookups();
        renderPaymentAccount();
        updateProgramPayment();
        bindReceiptReader();

        if (applicationResponse.status !== 'success') throw new Error(applicationResponse.message || 'Unable to check your current application.');
        const application = applicationResponse.data;
        if (application?.submission_stage === 'submitted') {
            state.application = application;
            showStep(3);
        } else if (application?.submission_stage === 'payment') {
            openEnrollmentDetails(application);
        }
    } catch (error) {
        console.error('Enrollment application initialization failed:', error);
        Swal.fire('Enrollment Unavailable', error.response?.data?.message || error.message, 'error');
    }
}

window.openStudentEnrollmentRequestModal = async function openStudentEnrollmentRequestModal(enrollmentDetailsId) {
    try {
        if (initializationPromise) await initializationPromise;
        Swal.fire({ title: 'Opening enrollment details...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        const result = await api('linkIncompleteEnrollmentApplication', {
            enrollment_details_id: Number(enrollmentDetailsId)
        });
        if (result.status !== 'success' || !result.data) {
            throw new Error(result.message || 'Unable to open this incomplete enrollment.');
        }
        state.application = result.data;
        if (result.data.submission_stage === 'submitted') {
            showStep(3);
        } else {
            openEnrollmentDetails(result.data);
        }
        Swal.close();
        const modalElement = $('studentEnrollmentRequestModal');
        if (!modalElement) throw new Error('The new enrollment modal is unavailable.');
        bootstrap.Modal.getOrCreateInstance(modalElement).show();
    } catch (error) {
        Swal.fire('Enrollment Unavailable', error.response?.data?.message || error.message, 'error');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-enrollment-request-guide]').forEach(button => {
        button.addEventListener('click', () => startTour(getEnrollmentRequestGuide(), button));
    });
    $('requestProgram').addEventListener('change', updateProgramPayment);
    $('payAndContinue').addEventListener('click', submitPayment);
    $('detailsSubjects').addEventListener('change', () => {
        updateSubjectSummary();
        filterPreferredTeachers();
    });
    $('detailsSubjectsToggle')?.addEventListener('click', event => {
        event.stopPropagation();
        setSubjectMenuOpen($('detailsSubjectsMenu')?.classList.contains('d-none'));
    });
    $('detailsSubjectsMenu')?.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', () => setSubjectMenuOpen(false));
    $('addAvailability').addEventListener('click', addAvailability);
    $('availabilityList').addEventListener('click', event => {
        const button = event.target.closest('[data-remove-availability]');
        if (!button) return;
        state.availability.splice(Number(button.dataset.removeAvailability), 1);
        renderAvailability();
    });
    $('submitForReview').addEventListener('click', submitForReview);
    initializationPromise = initialize();

    const pageParams = new URLSearchParams(window.location.search);
    if (pageParams.get('reenroll') === '1') {
        initializationPromise.then(() => {
            const requestedProgramId = pageParams.get('program_id');
            if (!state.application && requestedProgramId) {
                const programSelect = $('requestProgram');
                const hasProgram = [...programSelect.options]
                    .some(option => option.value === requestedProgramId);
                if (hasProgram) {
                    programSelect.value = requestedProgramId;
                    updateProgramPayment();
                }
            }

            if (!state.application) showStep(1);
            const modalElement = $('studentEnrollmentRequestModal');
            if (modalElement) bootstrap.Modal.getOrCreateInstance(modalElement).show();
        });
    }
});
