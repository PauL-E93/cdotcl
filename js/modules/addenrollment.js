import { renderPreschoolEnrollment } from './pre_play_enrollment.js';
import { showPaymentReceipt } from './receipt.js';
import { canUseEnrollmentPermission, guardEnrollmentPermission, initEnrollmentPermissions, shouldApplyEnrollmentRbac } from './enrollment_rbac.js';

let globalLookups = {};
let currentStudentId = null;
let enrollmentStudentName = null;
let enrollmentStudentId = null;
let preferredSchedules = [];
let selectedTuition = 0;
let downpaymentCollectedDetails = null; // New variable to store downpayment info
let pendingDownpaymentEnrollment = null;
let pendingEnrollmentDetails = null;
let currentStudentHealthNote = null; // Store health note for enrollment submission
let isNewStudentEnrollment = true;
let applicationDownpaymentContext = null;
let preschoolServiceSelection = {
    include: false,
    serviceId: null,
    serviceName: null,
    serviceAmount: 0,
    programId: null
};
let teacherAvailableSlots = []; // Store selected teacher's available schedule slots
let teacherBookedSlots = []; // Store teacher's already-booked schedule slots
let teacherAvailableDates = []; // Store permitted schedule dates for selected teacher
let teacherAvailableSlotsPerDate = {}; // {date: [{start: '13:00', end: '17:00'}]}
let teacherFullShiftsPerDate = {}; // {date: {start: '13:00', end: '17:00'}}
let selectedSubjectIds = [];
const PENDING_ENROLLMENT_COMPLETION_STORAGE_KEY = 'pendingEnrollmentCompletionRequest';

// Downpayment storage by enrollment ID
let downpaymentStorage = {}; // Format: { enrollmentId: { amount, method_id, reference_number, paid_date } }

// Function to store downpayment by enrollment ID
window.storeDownpaymentForEnrollment = function(enrollmentId, downpaymentDetails) {
    if (!enrollmentId || !downpaymentDetails) return;
    downpaymentStorage[enrollmentId] = {
        ...downpaymentDetails,
        paid_date: new Date().toISOString().split('T')[0]
    };
    console.log('Downpayment stored for enrollment:', enrollmentId, downpaymentStorage[enrollmentId]);
};

// Function to retrieve downpayment by enrollment ID
window.getStoredDownpayment = function(enrollmentId) {
    return downpaymentStorage[enrollmentId] || null;
};

// Function to clear downpayment after use
window.clearStoredDownpayment = function(enrollmentId) {
    if (downpaymentStorage[enrollmentId]) {
        delete downpaymentStorage[enrollmentId];
    }
};

function getBootstrapModal(element) {
    if (!element) return null;
    return bootstrap.Modal.getInstance(element) || new bootstrap.Modal(element);
}

function switchModal(fromElement, toElement) {
    const fromInstance = fromElement ? getBootstrapModal(fromElement) : null;
    const toInstance = toElement ? getBootstrapModal(toElement) : null;

    if (!toInstance) {
        if (fromInstance) {
            fromInstance.hide();
        }
        return;
    }

    if (fromElement && fromElement.classList.contains('show') && fromInstance) {
        const onHidden = () => {
            fromElement.removeEventListener('hidden.bs.modal', onHidden);
            toInstance.show();
        };
        fromElement.addEventListener('hidden.bs.modal', onHidden);
        fromInstance.hide();
        return;
    }

    toInstance.show();
}

function formatStudentName(details = {}) {
    return [details.first_name, details.last_name, details.ext]
        .filter(part => part && part.toString().trim())
        .map(part => part.toString().trim())
        .join(' ');
}

function getEnrollmentFinalizePermissionKey() {
    return pendingDownpaymentEnrollment?.enrollment_id ? 'approve' : 'create';
}

function ensureEnrollmentValidationSupport() {
    if (!document.getElementById('adminEnrollmentValidationStyles')) {
        const style = document.createElement('style');
        style.id = 'adminEnrollmentValidationStyles';
        style.textContent = `
            .modal .form-control.is-invalid,
            .modal .form-select.is-invalid {
                border-color: #dc3545 !important;
                background-color: #fff8f8 !important;
                box-shadow: 0 0 0 .18rem rgba(220, 53, 69, .12) !important;
            }
            .modal .enrollment-invalid-area {
                border: 1px solid #dc3545 !important;
                border-radius: 8px;
                background: #fff8f8;
                box-shadow: 0 0 0 .18rem rgba(220, 53, 69, .10);
            }
            .modal .tutorial-subject-control.enrollment-invalid-area,
            .modal .tutorial-schedule-table.enrollment-invalid-area {
                padding: 5px;
            }
            .modal .enrollment-field-has-error > .form-label,
            .modal .enrollment-field-has-error > label,
            .modal .enrollment-field-has-error .form-label:first-child {
                color: #b42318 !important;
                font-weight: 700 !important;
            }
            .modal .enrollment-inline-error {
                display: block;
                width: 100%;
                margin-top: 6px;
                color: #b42318;
                font-size: .78rem;
                font-weight: 600;
            }
        `;
        document.head.appendChild(style);
    }

    if (document.documentElement.dataset.enrollmentValidationBound === 'true') return;
    document.documentElement.dataset.enrollmentValidationBound = 'true';
    const clearChangedField = event => clearEnrollmentFieldError(event.target);
    document.addEventListener('input', clearChangedField);
    document.addEventListener('change', clearChangedField);
}

function getEnrollmentFieldContainer(element) {
    return element?.closest('.col-md-6, .col-md-4, .col-12, .tutorial-date-field, .downpayment-due-panel, #referenceField')
        || element?.parentElement;
}

function clearEnrollmentFieldError(element) {
    if (!(element instanceof Element)) return;

    const fieldId = element.id || '';
    element.classList.remove('is-invalid');
    element.removeAttribute('aria-invalid');
    element.removeAttribute('aria-describedby');

    document.querySelectorAll('[data-enrollment-error-for]').forEach(feedback => {
        if (feedback.dataset.enrollmentErrorFor === fieldId) feedback.remove();
    });
    document.querySelectorAll('[data-enrollment-error-highlight-for]').forEach(highlight => {
        if (highlight.dataset.enrollmentErrorHighlightFor === fieldId) {
            highlight.classList.remove('enrollment-invalid-area');
            delete highlight.dataset.enrollmentErrorHighlightFor;
        }
    });

    const container = getEnrollmentFieldContainer(element);
    if (container && !container.querySelector('.is-invalid, .enrollment-invalid-area')) {
        container.classList.remove('enrollment-field-has-error');
    }
}

function clearEnrollmentValidation(container = document) {
    container.querySelectorAll('.is-invalid').forEach(element => {
        element.classList.remove('is-invalid');
        element.removeAttribute('aria-invalid');
        element.removeAttribute('aria-describedby');
    });
    container.querySelectorAll('.enrollment-invalid-area').forEach(element => {
        element.classList.remove('enrollment-invalid-area');
        delete element.dataset.enrollmentErrorHighlightFor;
    });
    container.querySelectorAll('.enrollment-field-has-error').forEach(element => element.classList.remove('enrollment-field-has-error'));
    container.querySelectorAll('[data-enrollment-error-for]').forEach(element => element.remove());
}

function markEnrollmentFieldInvalid(element, message, highlightElement = null) {
    if (!element) return;
    ensureEnrollmentValidationSupport();
    clearEnrollmentFieldError(element);

    const fieldId = element.id || `enrollment-field-${Date.now()}`;
    if (!element.id) element.id = fieldId;
    const feedbackId = `${fieldId}-enrollment-error`;
    const highlight = highlightElement || element;
    const container = getEnrollmentFieldContainer(highlight) || getEnrollmentFieldContainer(element);

    element.classList.add('is-invalid');
    element.setAttribute('aria-invalid', 'true');
    element.setAttribute('aria-describedby', feedbackId);
    if (highlight !== element) {
        highlight.classList.add('enrollment-invalid-area');
        highlight.dataset.enrollmentErrorHighlightFor = fieldId;
    }
    container?.classList.add('enrollment-field-has-error');

    const feedback = document.createElement('div');
    feedback.id = feedbackId;
    feedback.className = 'enrollment-inline-error';
    feedback.dataset.enrollmentErrorFor = fieldId;
    feedback.textContent = message;
    (container || element.parentElement)?.appendChild(feedback);
}

function showEnrollmentValidationAlert(title, issues) {
    const validIssues = (issues || []).filter(issue => issue?.element);
    validIssues.forEach(issue => markEnrollmentFieldInvalid(issue.element, issue.message, issue.highlight || null));
    const messages = [...new Set(validIssues.map(issue => issue.message))];

    return Swal.fire({
        icon: 'warning',
        title,
        text: messages.length ? `Please correct: ${messages.join(' ')}` : 'Please complete the highlighted required fields.',
        confirmButtonText: 'Review highlighted fields'
    }).then(() => {
        const firstField = validIssues[0]?.element;
        if (!firstField) return;
        firstField.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (!firstField.disabled && typeof firstField.focus === 'function') {
            window.setTimeout(() => firstField.focus({ preventScroll: true }), 250);
        }
    });
}

function firstAvailableEnrollmentField(ids) {
    const elements = ids.map(id => document.getElementById(id)).filter(Boolean);
    return elements.find(element => element.offsetParent !== null) || elements[0] || null;
}

function showEnrollmentServerError(title, message, fallbackMessage = 'Please review the highlighted fields and try again.') {
    const text = String(message || fallbackMessage).trim();
    const normalized = text.toLowerCase();
    const mappings = [
        { patterns: ['email'], ids: ['email'], message: text },
        { patterns: ['contact number', 'mobile number', 'guardian contact'], ids: ['guardianContact'], message: text },
        { patterns: ['birthday', 'birthdate', 'invalid age', 'years old'], ids: ['birthday'], message: text },
        { patterns: ['first name'], ids: ['firstName'], message: text },
        { patterns: ['middle name'], ids: ['middleName'], message: text },
        { patterns: ['last name'], ids: ['lastName'], message: text },
        { patterns: ['guardian name'], ids: ['guardianName'], message: text },
        { patterns: ['relationship'], ids: ['guardianRelationship'], message: text },
        { patterns: ['province'], ids: ['adrProvince'], message: text },
        { patterns: ['city', 'municipality'], ids: ['adrCity'], message: text },
        { patterns: ['barangay'], ids: ['adrBarangay'], message: text },
        { patterns: ['street', 'house'], ids: ['adrStreet'], message: text },
        { patterns: ['grade level', 'grade'], ids: ['gradeLevelId'], message: text },
        { patterns: ['subject'], ids: ['subjectId'], highlight: '.tutorial-subject-control', message: text },
        { patterns: ['branch', 'center'], ids: ['preferredBranch'], message: text },
        { patterns: ['teacher'], ids: ['preferredTeacher'], message: text },
        { patterns: ['class'], ids: ['preschoolClass'], message: text },
        { patterns: ['section'], ids: ['preschoolSection'], message: text },
        { patterns: ['schedule', 'session', 'date', 'time'], ids: ['schedDateInput'], highlight: '.tutorial-schedule-table', message: text },
        { patterns: ['program'], ids: ['programId', 'preschoolProgram', 'downpaymentProgramInput'], message: text }
    ];
    const issues = [];
    const usedElements = new Set();

    mappings.forEach(mapping => {
        if (!mapping.patterns.some(pattern => normalized.includes(pattern))) return;
        const element = firstAvailableEnrollmentField(mapping.ids);
        if (!element || usedElements.has(element)) return;
        usedElements.add(element);
        issues.push({
            element,
            highlight: mapping.highlight ? document.querySelector(mapping.highlight) : null,
            message: mapping.message
        });
    });

    if (issues.length > 0) {
        return showEnrollmentValidationAlert(title, issues);
    }
    return Swal.fire(title, text || fallbackMessage, 'error');
}

export function openEnrollmentModal() {
    if (!guardEnrollmentPermission('create', 'You do not have permission to add enrollment records.')) {
        return;
    }

    ensureEnrollmentValidationSupport();
    const modalElement = document.getElementById('addEnrollmentModal');
    const modal = getBootstrapModal(modalElement);
    if (modal) {
        modal.show();
    }
}

export function resetEnrollmentState() {
    currentStudentId = null;
    enrollmentStudentName = null;
    enrollmentStudentId = null;
    downpaymentCollectedDetails = null; // Reset downpayment details
    pendingDownpaymentEnrollment = null;
    pendingEnrollmentDetails = null;
    sessionStorage.removeItem(PENDING_ENROLLMENT_COMPLETION_STORAGE_KEY);
    currentStudentHealthNote = null; // Reset health note
    selectedSubjectIds = [];
    isNewStudentEnrollment = true;
    preschoolServiceSelection = {
        include: false,
        serviceId: null,
        serviceName: null,
        serviceAmount: 0,
        programId: null
    };
}

function getEnrollmentPagePath(category = 'tutorial') {
    const targetFile = category === 'preschool' ? 'enrollement_pre_play.html' : 'enrollement.html';
    return window.location.pathname.replace(/[^/]+$/, targetFile);
}

function queuePendingEnrollmentCompletion(enrollmentId, category = 'tutorial') {
    if (!enrollmentId) return;

    sessionStorage.setItem(PENDING_ENROLLMENT_COMPLETION_STORAGE_KEY, JSON.stringify({
        enrollmentId: Number(enrollmentId),
        category: category === 'preschool' ? 'preschool' : 'tutorial'
    }));
}

function parsePendingCompletionRequest() {
    const raw = sessionStorage.getItem(PENDING_ENROLLMENT_COMPLETION_STORAGE_KEY);
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        const enrollmentId = Number(parsed?.enrollmentId);
        if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
            sessionStorage.removeItem(PENDING_ENROLLMENT_COMPLETION_STORAGE_KEY);
            return null;
        }

        return {
            enrollmentId,
            category: parsed?.category === 'preschool' ? 'preschool' : 'tutorial'
        };
    } catch (error) {
        console.error('Invalid pending enrollment completion payload:', error);
        sessionStorage.removeItem(PENDING_ENROLLMENT_COMPLETION_STORAGE_KEY);
        return null;
    }
}

function normalizeTimeValue(value) {
    if (!value) return '';
    return String(value).trim().slice(0, 5);
}

function normalizePendingScheduleRows(rows = []) {
    if (!Array.isArray(rows)) return [];

    return rows
        .map(row => ({
            date: row?.date || '',
            day: row?.day || '',
            time: normalizeTimeValue(row?.start_time || row?.time),
            endTime: normalizeTimeValue(row?.end_time || row?.endTime)
        }))
        .filter(row => row.day && row.time);
}

function parseSubjectIdsList(rawValue) {
    if (Array.isArray(rawValue)) {
        return rawValue.map(value => String(value).trim()).filter(Boolean);
    }

    return String(rawValue || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
}

async function resumeQueuedPendingEnrollmentCompletion() {
    const queuedRequest = parsePendingCompletionRequest();
    if (!queuedRequest) return;

    const expectedPath = getEnrollmentPagePath(queuedRequest.category);
    if (window.location.pathname !== expectedPath) {
        return;
    }

    const enrollmentDetailsModal = document.getElementById('enrollmentDetailsModal');
    const enrollmentForm = document.getElementById('enrollmentForm');
    if (!enrollmentDetailsModal || !enrollmentForm) {
        return;
    }

    sessionStorage.removeItem(PENDING_ENROLLMENT_COMPLETION_STORAGE_KEY);
    await openPendingEnrollmentCompletion(queuedRequest.enrollmentId, queuedRequest.category);
}

export async function openPendingEnrollmentCompletion(enrollmentId, category = 'tutorial') {
    if (!guardEnrollmentPermission('approve', 'You do not have permission to approve or complete enrollment records.')) {
        return;
    }

    if (!enrollmentId) {
        Swal.fire('Error', 'Enrollment ID is missing.', 'error');
        return;
    }

    const enrollmentDetailsModal = document.getElementById('enrollmentDetailsModal');
    const enrollmentForm = document.getElementById('enrollmentForm');
    if (!enrollmentDetailsModal || !enrollmentForm) {
        queuePendingEnrollmentCompletion(enrollmentId, category);

        const targetPath = getEnrollmentPagePath(category);
        if (window.location.pathname !== targetPath) {
            Swal.close();
            window.location.assign(targetPath);
            return;
        }

        sessionStorage.removeItem(PENDING_ENROLLMENT_COMPLETION_STORAGE_KEY);
        Swal.fire('Unavailable', 'The enrollment completion form is not available on this page.', 'warning');
        return;
    }

    try {
        Swal.fire({
            title: 'Loading enrollment...',
            didOpen: () => Swal.showLoading(),
            allowOutsideClick: false
        });

        await loadLookups();
        const res = await axios.get(`../../api/admin/enrollment.php?operation=getEnrollmentDetails&id=${enrollmentId}`);
        Swal.close();

        if (res.data.status !== 'success') {
            Swal.fire('Error', res.data.message || 'Unable to load enrollment details.', 'error');
            return;
        }

        const details = res.data.data.details || {};
        const status = (details.header_status || details.status || '').toLowerCase();
        if (status !== 'incomplete') {
            Swal.fire('Not Incomplete', 'Only incomplete enrollments can be completed from this action.', 'info');
            return;
        }

        const studentId = Number(details.student_id);
        if (!Number.isInteger(studentId) || studentId <= 0) {
            Swal.fire('Error', 'Student ID is missing from this enrollment.', 'error');
            return;
        }

        const studentName = formatStudentName(details) || details.student_name || 'Student';
        currentStudentId = studentId;
        enrollmentStudentId = studentId;
        enrollmentStudentName = studentName;
        currentStudentHealthNote = details.health_note || null;
        downpaymentCollectedDetails = null;
        pendingEnrollmentDetails = {
            ...details,
            schedule: normalizePendingScheduleRows(res.data.data.schedule || [])
        };
        pendingDownpaymentEnrollment = {
            enrollment_id: enrollmentId,
            program_id: details.program_id,
            program_name: details.program_name || 'Program'
        };
        if (category === 'preschool' && details.program_id) {
            const savedProgramService = getProgramServiceForSelection(details.program_id);
            const hasSavedService = Boolean((details.services || '').toString().trim());
            preschoolServiceSelection = {
                include: Boolean(savedProgramService && hasSavedService),
                serviceId: savedProgramService && hasSavedService ? String(savedProgramService.service_id) : null,
                serviceName: savedProgramService ? savedProgramService.service_name : null,
                serviceAmount: savedProgramService ? parseFloat(savedProgramService.amount || 0) : 0,
                programId: String(details.program_id)
            };
            pendingDownpaymentEnrollment.include_service = preschoolServiceSelection.include;
            pendingDownpaymentEnrollment.service_id = preschoolServiceSelection.serviceId;
            pendingDownpaymentEnrollment.service_name = preschoolServiceSelection.serviceName;
            pendingDownpaymentEnrollment.service_amount = preschoolServiceSelection.serviceAmount;
        } else {
            preschoolServiceSelection = {
                include: false,
                serviceId: null,
                serviceName: null,
                serviceAmount: 0,
                programId: details.program_id ? String(details.program_id) : null
            };
        }
        window.currentEnrollmentCategory = category === 'preschool' ? 'preschool' : 'tutorial';
        const openModal = document.querySelector('.modal.show');
        switchModal(openModal, enrollmentDetailsModal);
    } catch (err) {
        console.error('Error opening incomplete enrollment:', err);
        Swal.fire('Error', 'Network error occurred while loading the incomplete enrollment.', 'error');
    }
}

window.openPendingEnrollmentCompletion = openPendingEnrollmentCompletion;

document.addEventListener("DOMContentLoaded", async () => {
    if (shouldApplyEnrollmentRbac()) {
        await initEnrollmentPermissions();
    }

    loadLookups();

    const modalElement = document.getElementById('addEnrollmentModal');
    if (modalElement) {
        modalElement.addEventListener('show.bs.modal', () => {
            loadLookups().then(() => {
                renderStudentStep();
            });
            currentStudentId = null;
        });
    }

    const enrollmentModalElement = document.getElementById('enrollmentDetailsModal');
    if (enrollmentModalElement) {
        enrollmentModalElement.addEventListener('show.bs.modal', () => {
            if (enrollmentStudentId) {
                const sid = Number(enrollmentStudentId);
                if (Number.isInteger(sid) && sid > 0) {
                    currentStudentId = sid;
                }
            }

            if (enrollmentStudentName) {
                loadLookups().then(() => {
                    if (window.currentEnrollmentCategory === 'preschool') {
                        renderPreschoolEnrollment(enrollmentStudentName, globalLookups, handleSavePreschoolEnrollment, pendingDownpaymentEnrollment?.program_id || null);
                    } else {
                        renderEnrollmentStep(enrollmentStudentName);
                    }
                });
            }
        });
    }

    const downpaymentModalElement = document.getElementById('downpaymentModal');
    const isStudentEnrollmentPage = window.location.pathname.includes('/student/');
    if (downpaymentModalElement && !isStudentEnrollmentPage) {
        downpaymentModalElement.addEventListener('show.bs.modal', () => {
            if (window.studentPrePlayDirectEnrollmentActive) {
                return;
            }
            renderDownpaymentStep(applicationDownpaymentContext?.studentName || enrollmentStudentName);
        });
        downpaymentModalElement.addEventListener('hidden.bs.modal', () => {
            applicationDownpaymentContext = null;
        });
    }

    resumeQueuedPendingEnrollmentCompletion();
});

function loadLookups() {
    return axios.get("../../api/admin/enrollment.php?operation=getLookups")
        .then(res => {
            globalLookups = res.data;
        })
        .catch(err => {
            console.error("Error loading lookups:", err);
        });
}

const PH_ADDRESS_API_BASE = 'https://psgc.cloud/api/v2';
const NCR_ADDRESS_OPTION = { code: '1300000000', name: 'Metro Manila (NCR)', isRegion: true };
const phAddressCache = {
    provinces: null,
    citiesByProvince: {},
    barangaysByCity: {}
};

function normalizeAddressName(value) {
    return (value || '').toString().trim().replace(/\s+/g, ' ').toLowerCase();
}

function getAddressItems(response) {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.data)) return response.data;
    return [];
}

async function fetchAddressItems(url) {
    const response = await axios.get(url);
    return getAddressItems(response.data);
}

function setAddressSelectOptions(select, items, placeholder, selectedName = '') {
    if (!select) return;
    const normalizedSelected = normalizeAddressName(selectedName);
    select.innerHTML = `<option value="">${placeholder}</option>` + items.map(item => {
        const name = (item.name || '').trim();
        const selected = normalizedSelected && normalizeAddressName(name) === normalizedSelected ? ' selected' : '';
        return `<option value="${name}" data-code="${item.code || ''}"${selected}>${name}</option>`;
    }).join('');
    select.disabled = false;
}

function resetAddressSelect(select, placeholder) {
    if (!select) return;
    select.innerHTML = `<option value="">${placeholder}</option>`;
    select.disabled = true;
}

async function loadProvinceOptions(select, selectedName = '') {
    if (!phAddressCache.provinces) {
        const provinces = await fetchAddressItems(`${PH_ADDRESS_API_BASE}/provinces`);
        phAddressCache.provinces = [NCR_ADDRESS_OPTION, ...provinces].sort((a, b) => a.name.localeCompare(b.name));
    }
    setAddressSelectOptions(select, phAddressCache.provinces, 'Select Province', selectedName);
}

async function loadCityOptions(provinceCode, select, selectedName = '') {
    if (!provinceCode) {
        resetAddressSelect(select, 'Select City / Municipality');
        return;
    }
    if (!phAddressCache.citiesByProvince[provinceCode]) {
        const endpoint = provinceCode === NCR_ADDRESS_OPTION.code
            ? `${PH_ADDRESS_API_BASE}/regions/${provinceCode}/cities-municipalities`
            : `${PH_ADDRESS_API_BASE}/provinces/${provinceCode}/cities-municipalities`;
        const cities = await fetchAddressItems(endpoint);
        phAddressCache.citiesByProvince[provinceCode] = cities.sort((a, b) => a.name.localeCompare(b.name));
    }
    setAddressSelectOptions(select, phAddressCache.citiesByProvince[provinceCode], 'Select City / Municipality', selectedName);
}

async function loadBarangayOptions(cityCode, select, selectedName = '') {
    if (!cityCode) {
        resetAddressSelect(select, 'Select Barangay');
        return;
    }
    if (!phAddressCache.barangaysByCity[cityCode]) {
        const barangays = await fetchAddressItems(`${PH_ADDRESS_API_BASE}/cities-municipalities/${cityCode}/barangays`);
        phAddressCache.barangaysByCity[cityCode] = barangays.sort((a, b) => a.name.localeCompare(b.name));
    }
    setAddressSelectOptions(select, phAddressCache.barangaysByCity[cityCode], 'Select Barangay', selectedName);
}

function getSelectedAddressCode(select) {
    return select?.selectedOptions?.[0]?.dataset?.code || '';
}

async function initPhilippineAddressSelectors(defaults = {}) {
    const provinceSelect = document.getElementById('adrProvince');
    const citySelect = document.getElementById('adrCity');
    const barangaySelect = document.getElementById('adrBarangay');
    if (!provinceSelect || !citySelect || !barangaySelect) return;

    resetAddressSelect(citySelect, 'Select City / Municipality');
    resetAddressSelect(barangaySelect, 'Select Barangay');
    provinceSelect.innerHTML = '<option value="">Loading provinces...</option>';
    provinceSelect.disabled = true;

    try {
        await loadProvinceOptions(provinceSelect, defaults.province);

        provinceSelect.addEventListener('change', async () => {
            resetAddressSelect(citySelect, 'Loading cities...');
            resetAddressSelect(barangaySelect, 'Select Barangay');
            try {
                await loadCityOptions(getSelectedAddressCode(provinceSelect), citySelect);
            } catch (err) {
                console.error('Error loading Philippine cities/municipalities:', err);
                resetAddressSelect(citySelect, 'Unable to load cities');
            }
        });

        citySelect.addEventListener('change', async () => {
            resetAddressSelect(barangaySelect, 'Loading barangays...');
            try {
                await loadBarangayOptions(getSelectedAddressCode(citySelect), barangaySelect);
            } catch (err) {
                console.error('Error loading Philippine barangays:', err);
                resetAddressSelect(barangaySelect, 'Unable to load barangays');
            }
        });

        if (defaults.province) {
            await loadCityOptions(getSelectedAddressCode(provinceSelect), citySelect, defaults.city);
            if (defaults.city) {
                await loadBarangayOptions(getSelectedAddressCode(citySelect), barangaySelect, defaults.barangay);
            }
        }
    } catch (err) {
        console.error('Error loading Philippine provinces:', err);
        provinceSelect.innerHTML = '<option value="">Unable to load provinces</option>';
        provinceSelect.disabled = true;
    }
}

function markRequiredFieldLabels(container) {
    if (!container) return;

    const requiredFields = container.querySelectorAll('input[required], select[required], textarea[required]');
    requiredFields.forEach(field => {
        if (field.type === 'hidden') return;

        let label = null;

        if (field.id) {
            label = container.querySelector(`label[for="${field.id}"]`);
        }

        if (!label) {
            const wrapper = field.closest('.mb-3, .col-md-1, .col-md-3, .col-md-4, .col-md-6, .col-md-12');
            label = wrapper?.querySelector('label.form-label') || null;
        }

        if (!label || label.querySelector('.required-field-indicator')) return;

        label.insertAdjacentHTML(
            'beforeend',
            ' <span class="text-danger required-field-indicator" aria-hidden="true">*</span>'
        );
    });
}

function calculateAgeFromBirthday(birthday) {
    if (!birthday) return null;

    const birthDate = new Date(`${birthday}T00:00:00`);
    if (Number.isNaN(birthDate.getTime())) return null;

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDifference = today.getMonth() - birthDate.getMonth();

    if (
        monthDifference < 0 ||
        (monthDifference === 0 && today.getDate() < birthDate.getDate())
    ) {
        age -= 1;
    }

    return age;
}

function validateBirthdayForEnrollmentCategory(birthday, isPreschool) {
    const birthDate = new Date(`${birthday}T00:00:00`);
    if (Number.isNaN(birthDate.getTime())) {
        return {
            valid: false,
            title: 'Invalid Birthday',
            message: 'Please select a valid birthday.'
        };
    }

    const today = new Date();
    if (birthDate > today) {
        return {
            valid: false,
            title: 'Invalid Birthday',
            message: 'Birthday cannot be in the future.'
        };
    }

    const minimumAge = isPreschool ? 3 : 5;
    const categoryLabel = isPreschool ? 'Pre-school / Play-school' : 'Tutorial';
    const age = calculateAgeFromBirthday(birthday);

    if (age === null || age < minimumAge) {
        return {
            valid: false,
            title: 'Invalid Age',
            message: `${categoryLabel} enrollment is only for students ${minimumAge} years old and above.`
        };
    }

    return { valid: true };
}

function attachBirthdayValidation(input, isPreschool) {
    if (!input) return;

    input.addEventListener('change', () => {
        const birthday = input.value;
        if (!birthday) {
            input.setCustomValidity('');
            return;
        }

        const validation = validateBirthdayForEnrollmentCategory(birthday, isPreschool);
        if (!validation.valid) {
            input.setCustomValidity(validation.message);
            input.value = '';
            showEnrollmentValidationAlert(validation.title, [{ element: input, message: validation.message }]);
            return;
        }

        input.setCustomValidity('');
    });
}

// --- STEP 1: SHARED STUDENT FORM ---
function prepareStudentEnrollmentModal() {
    const modal = document.getElementById('addEnrollmentModal');
    if (!modal) return;

    modal.classList.add('enrollment-student-modal');
    modal.querySelector('.modal-dialog')?.classList.add('modal-xl', 'modal-dialog-scrollable');

    const header = modal.querySelector('.modal-header');
    if (header) {
        header.innerHTML = `
            <div class="student-modal-heading">
                <div class="student-modal-heading-icon"><i class="bi bi-people-fill"></i></div>
                <div>
                    <span class="student-step-badge">Step 1 of 3</span>
                    <h2 class="modal-title" id="addEnrollmentModalLabel">Student Information</h2>
                    <p>Capture the student's personal and contact details for enrollment.</p>
                </div>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        `;
    }

    const footer = modal.querySelector('.modal-footer');
    const cancelBtn = footer?.querySelector('[data-bs-dismiss="modal"]');
    const saveBtn = document.getElementById('saveEnrollment');
    if (cancelBtn) {
        cancelBtn.className = 'btn student-cancel-btn';
        cancelBtn.innerHTML = '<i class="bi bi-x-lg"></i><span>Cancel</span>';
    }
    if (saveBtn) {
        saveBtn.className = 'btn student-save-btn';
        saveBtn.innerHTML = '<span>Save Student &amp; Next</span><i class="bi bi-arrow-right"></i>';
    }

    if (document.getElementById('studentEnrollmentStepStyles')) return;

    const style = document.createElement('style');
    style.id = 'studentEnrollmentStepStyles';
    style.textContent = `
        #addEnrollmentModal.enrollment-student-modal {
            --enroll-red: #e85d88;
            --enroll-deep-red: #e85d88;
            --enroll-soft-red: #fff0f5;
            --enroll-accent-border: #f5bfd0;
            --enroll-border: #e5e7eb;
            --enroll-text: #172033;
            --enroll-muted: #697386;
        }
        #addEnrollmentModal.enrollment-student-modal .modal-dialog {
            max-width: min(1040px, calc(100vw - 32px));
        }
        #addEnrollmentModal.enrollment-student-modal .modal-content {
            border: 0;
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 0 22px 65px rgba(74, 20, 35, .18);
        }
        #addEnrollmentModal.enrollment-student-modal .modal-header {
            align-items: flex-start;
            border: 0;
            padding: 28px 28px 12px;
        }
        #addEnrollmentModal .student-modal-heading {
            display: flex;
            align-items: flex-start;
            gap: 14px;
        }
        #addEnrollmentModal .student-modal-heading-icon,
        #addEnrollmentModal .student-section-icon {
            display: inline-flex;
            flex: 0 0 auto;
            align-items: center;
            justify-content: center;
            color: var(--enroll-deep-red);
            background: var(--enroll-soft-red);
            border-radius: 50%;
        }
        #addEnrollmentModal .student-modal-heading-icon {
            width: 46px;
            height: 46px;
            margin-top: 2px;
            font-size: 20px;
        }
        #addEnrollmentModal .student-step-badge {
            display: inline-block;
            padding: 4px 10px;
            margin-bottom: 5px;
            color: var(--enroll-deep-red);
            background: var(--enroll-soft-red);
            border-radius: 6px;
            font-size: 12px;
            font-weight: 700;
        }
        #addEnrollmentModal .student-modal-heading h2 {
            margin: 0;
            color: var(--enroll-text);
            font-size: 25px;
            font-weight: 750;
            letter-spacing: -.02em;
        }
        #addEnrollmentModal .student-modal-heading p {
            margin: 8px 0 0;
            color: var(--enroll-muted);
            font-size: 14px;
        }
        #addEnrollmentModal.enrollment-student-modal .modal-body {
            padding: 12px 28px 24px;
            background: #fff;
        }
        #addEnrollmentModal .student-enrollment-type,
        #addEnrollmentModal .student-form-section {
            border: 1px solid var(--enroll-border);
            border-radius: 16px;
            background: #fff;
            padding: 18px;
            margin-bottom: 16px;
        }
        #addEnrollmentModal .student-enrollment-type {
            border-color: var(--enroll-accent-border);
            background: linear-gradient(100deg, #fff 0%, #fff8fb 100%);
        }
        #addEnrollmentModal .student-section-heading {
            display: flex;
            align-items: center;
            gap: 10px;
            padding-bottom: 11px;
            margin-bottom: 16px;
            color: var(--enroll-deep-red);
            border-bottom: 1px solid var(--enroll-accent-border);
            font-size: 16px;
            font-weight: 700;
        }
        #addEnrollmentModal .student-section-icon {
            width: 36px;
            height: 36px;
            font-size: 16px;
        }
        #addEnrollmentModal .student-type-options {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
            margin-left: 46px;
        }
        #addEnrollmentModal .student-type-option {
            display: flex;
            align-items: center;
            gap: 12px;
            min-height: 44px;
            padding: 10px 13px;
            border: 1px solid var(--enroll-border);
            border-radius: 8px;
            color: var(--enroll-text);
            cursor: pointer;
            transition: border-color .2s, background-color .2s, box-shadow .2s;
        }
        #addEnrollmentModal .student-type-option:has(input:checked) {
            color: var(--enroll-deep-red);
            border-color: var(--enroll-red);
            background: #fff8fb;
            box-shadow: 0 0 0 1px rgba(232, 93, 136, .05);
            font-weight: 600;
        }
        #addEnrollmentModal .student-type-option input {
            width: 19px;
            height: 19px;
            margin: 0;
            accent-color: var(--enroll-red);
        }
        #addEnrollmentModal .student-form-section .form-label {
            margin-bottom: 7px;
            color: var(--enroll-text);
            font-size: 13px;
            font-weight: 500;
        }
        #addEnrollmentModal .student-form-section .form-control,
        #addEnrollmentModal .student-form-section .form-select,
        #addEnrollmentModal .student-form-section .input-group-text {
            min-height: 47px;
            border-color: #dce1e9;
            color: var(--enroll-text);
            font-size: 14px;
        }
        #addEnrollmentModal .student-form-section .form-control,
        #addEnrollmentModal .student-form-section .form-select {
            border-radius: 8px;
        }
        #addEnrollmentModal .student-form-section .form-control::placeholder {
            color: #98a2b3;
        }
        #addEnrollmentModal .student-form-section .form-control:focus,
        #addEnrollmentModal .student-form-section .form-select:focus {
            border-color: var(--enroll-red);
            box-shadow: 0 0 0 .2rem rgba(232, 93, 136, .12);
        }
        #addEnrollmentModal .student-field-control {
            position: relative;
        }
        #addEnrollmentModal .student-field-control > i {
            position: absolute;
            z-index: 4;
            top: 50%;
            left: 14px;
            color: #667085;
            font-size: 16px;
            transform: translateY(-50%);
            pointer-events: none;
        }
        #addEnrollmentModal .student-field-control > .form-control {
            padding-left: 43px;
        }
        #addEnrollmentModal .student-contact-group .input-group-text {
            min-width: 66px;
            justify-content: center;
            background: #f8fafc;
            border-radius: 8px 0 0 8px;
        }
        #addEnrollmentModal .student-contact-group .form-control {
            border-radius: 0 8px 8px 0;
        }
        #addEnrollmentModal .student-help-text {
            display: block;
            margin-top: 5px;
            color: #8992a3;
            font-size: 11px;
        }
        #addEnrollmentModal .student-health-section {
            border-color: var(--enroll-accent-border);
            background: #fffafd;
        }
        #addEnrollmentModal .student-search-actions {
            display: flex;
            gap: 10px;
        }
        #addEnrollmentModal .student-search-actions .form-control {
            min-height: 47px;
        }
        #addEnrollmentModal.enrollment-student-modal .modal-footer {
            justify-content: space-between;
            padding: 14px 28px;
            border-top: 1px solid #edf0f4;
            background: #fff;
        }
        #addEnrollmentModal .student-cancel-btn,
        #addEnrollmentModal .student-save-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            min-height: 46px;
            border-radius: 8px;
            padding: 10px 22px;
            font-weight: 600;
        }
        #addEnrollmentModal .student-cancel-btn {
            color: var(--enroll-deep-red);
            border: 1px solid var(--enroll-accent-border);
            background: #fff;
        }
        #addEnrollmentModal .student-save-btn {
            min-width: 260px;
            color: #fff;
            border: 0;
            background: linear-gradient(100deg, #e85d88, #f07ba0);
            box-shadow: 0 9px 20px rgba(232, 93, 136, .22);
        }
        #addEnrollmentModal .student-save-btn:hover {
            color: #fff;
            filter: brightness(.96);
        }
        #addEnrollmentModal .student-select-btn {
            color: #fff;
            border-color: var(--enroll-red);
            background: var(--enroll-red);
            box-shadow: 0 4px 10px rgba(232, 93, 136, .18);
        }
        #addEnrollmentModal .student-select-btn:hover,
        #addEnrollmentModal .student-select-btn:focus {
            color: #fff;
            border-color: #d94f7a;
            background: #d94f7a;
        }
        @media (max-width: 767.98px) {
            #addEnrollmentModal.enrollment-student-modal .modal-dialog {
                max-width: calc(100vw - 16px);
                margin: 8px auto;
            }
            #addEnrollmentModal.enrollment-student-modal .modal-header {
                padding: 20px 18px 10px;
            }
            #addEnrollmentModal.enrollment-student-modal .modal-body {
                padding: 10px 18px 18px;
            }
            #addEnrollmentModal .student-modal-heading-icon {
                width: 40px;
                height: 40px;
            }
            #addEnrollmentModal .student-modal-heading h2 {
                font-size: 21px;
            }
            #addEnrollmentModal .student-type-options {
                grid-template-columns: 1fr;
                margin-left: 0;
            }
            #addEnrollmentModal.enrollment-student-modal .modal-footer {
                gap: 10px;
                padding: 13px 18px;
            }
            #addEnrollmentModal .student-cancel-btn,
            #addEnrollmentModal .student-save-btn {
                flex: 1 1 auto;
                min-width: 0;
                padding-inline: 14px;
            }
        }
    `;
    document.head.appendChild(style);
}

function renderStudentStep() {
    const form = document.getElementById("addEnrollmentForm");
    if (!form) return;
    form.innerHTML = "";
    prepareStudentEnrollmentModal();

    const saveBtn = document.getElementById("saveEnrollment");
    if (!saveBtn) return;

    saveBtn.innerHTML = '<span>Save Student &amp; Next</span><i class="bi bi-arrow-right"></i>';
    saveBtn.onclick = handleSaveStudent;
    saveBtn.style.display = canUseEnrollmentPermission('create') ? 'inline-flex' : 'none';
    const isPreschool = window.currentEnrollmentCategory === 'preschool';

    let html = `
        <section class="student-enrollment-type">
            <div class="student-section-heading">
                <span class="student-section-icon"><i class="bi bi-mortarboard-fill"></i></span>
                <span>Enrollment Type</span>
            </div>
            <div class="student-type-options">
                <label class="student-type-option" for="newStudent">
                    <input type="radio" id="newStudent" name="enrollmentType" value="new" checked>
                    <span>Create New Student</span>
                </label>
                <label class="student-type-option" for="existingStudent">
                    <input type="radio" id="existingStudent" name="enrollmentType" value="existing">
                    <span>Enroll Existing Student</span>
                </label>
            </div>
        </section>

        <div id="studentForm">
            <section class="student-form-section">
                <div class="student-section-heading">
                    <span class="student-section-icon"><i class="bi bi-person-fill"></i></span>
                    <span>Student Details</span>
                </div>
                <div class="row g-3">
                    <div class="col-md-6">
                        <label class="form-label" for="firstName">First Name</label>
                        <div class="student-field-control"><i class="bi bi-person"></i><input type="text" class="form-control" id="firstName" placeholder="Enter first name" required></div>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label" for="middleName">Middle Name</label>
                        <div class="student-field-control"><i class="bi bi-person"></i><input type="text" class="form-control" id="middleName" placeholder="Enter middle name" required></div>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label" for="lastName">Last Name</label>
                        <div class="student-field-control"><i class="bi bi-person"></i><input type="text" class="form-control" id="lastName" placeholder="Enter last name" required></div>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label" for="nameExt">Name Extension</label>
                        <select class="form-select" id="nameExt">
                            <option value="">None</option><option value="Jr.">Jr.</option><option value="Sr.">Sr.</option>
                            <option value="II">II</option><option value="III">III</option><option value="IV">IV</option><option value="V">V</option>
                        </select>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label" for="nickname">Nickname</label>
                        <div class="student-field-control"><i class="bi bi-person"></i><input type="text" class="form-control" id="nickname" placeholder="Enter nickname"></div>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label" for="birthday">Birthday</label>
                        <input type="date" class="form-control" id="birthday" required>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label" for="genderId">Gender</label>
                        <select class="form-select" id="genderId" required>
                            <option value="">Select Gender</option>
                            ${generateOptions(globalLookups.genders, 'gender_id', 'gender')}
                        </select>
                    </div>
                    <div class="col-12">
                        <label class="form-label" for="email">Email</label>
                        <div class="student-field-control"><i class="bi bi-envelope"></i><input type="email" class="form-control" id="email" placeholder="Enter email address" required></div>
                    </div>
                </div>
            </section>

            <section class="student-form-section">
                <div class="student-section-heading">
                    <span class="student-section-icon"><i class="bi bi-geo-alt-fill"></i></span>
                    <span>Address Details</span>
                </div>
                <div class="row g-3">
                    <div class="col-md-6"><label class="form-label" for="adrProvince">Province</label><select class="form-select" id="adrProvince" required><option value="">Loading provinces...</option></select></div>
                    <div class="col-md-6"><label class="form-label" for="adrCity">City / Municipality</label><select class="form-select" id="adrCity" required disabled><option value="">Select City / Municipality</option></select></div>
                    <div class="col-md-6"><label class="form-label" for="adrBarangay">Barangay</label><select class="form-select" id="adrBarangay" required disabled><option value="">Select Barangay</option></select></div>
                    <div class="col-md-6">
                        <label class="form-label" for="adrStreet">Street / House No.</label>
                        <div class="student-field-control"><i class="bi bi-house-door"></i><input type="text" class="form-control" id="adrStreet" placeholder="Enter street / house number" required></div>
                    </div>
                    <div class="col-12">
                        <label class="form-label" for="adrNote">Address Note</label>
                        <div class="student-field-control"><i class="bi bi-file-earmark-text"></i><input type="text" class="form-control" id="adrNote" placeholder="Optional additional address information (e.g., landmark)"></div>
                    </div>
                </div>
            </section>

            ${isPreschool ? `
                <section class="student-form-section student-health-section">
                    <div class="student-section-heading">
                        <span class="student-section-icon"><i class="bi bi-heart-pulse-fill"></i></span>
                        <span>Medical &amp; Safety Notes</span>
                    </div>
                    <label class="form-label" for="healthNotes">Health Condition &amp; Safety Risks</label>
                    <textarea class="form-control" id="healthNotes" rows="3" placeholder="Enter any allergies, medical conditions, or behavioral safety risks here..."></textarea>
                </section>
            ` : ''}

            <section class="student-form-section">
                <div class="student-section-heading">
                    <span class="student-section-icon"><i class="bi bi-people-fill"></i></span>
                    <span>Guardian Details</span>
                </div>
                <div class="row g-3">
                    <div class="col-md-6">
                        <label class="form-label" for="guardianName">Guardian Name</label>
                        <div class="student-field-control"><i class="bi bi-person"></i><input type="text" class="form-control" id="guardianName" placeholder="Enter guardian full name" required></div>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label" for="guardianContact">Contact Number</label>
                        <div class="input-group student-contact-group">
                        <span class="input-group-text">+63</span>
                        <input type="tel" class="form-control" id="guardianContact" inputmode="numeric" pattern="9[0-9]{9}" placeholder="9171234567" aria-label="Philippine mobile number" required>
                        </div>
                        <small class="student-help-text">Enter the 10-digit mobile number after +63.</small>
                    </div>
                    <div class="col-12">
                        <label class="form-label" for="guardianRelationship">Relationship</label>
                        <div class="student-field-control"><i class="bi bi-heart"></i><input type="text" class="form-control" id="guardianRelationship" placeholder="e.g., Mother, Father, Guardian, Aunt, etc." required></div>
                    </div>
                </div>
            </section>
        </div>

        <section id="searchSection" class="student-form-section" style="display:none;">
            <div class="student-section-heading">
                <span class="student-section-icon"><i class="bi bi-search"></i></span>
                <span>Search Existing Student</span>
            </div>
            <div class="student-search-actions">
                <input type="text" class="form-control" id="studentSearch" placeholder="Enter student name or school ID">
                <button type="button" class="btn student-save-btn" id="searchBtn"><i class="bi bi-search"></i><span>Search</span></button>
            </div>
            <div id="searchResults" class="mt-3"></div>
        </section>
    `;
    form.innerHTML = html;
    markRequiredFieldLabels(form);
    initPhilippineAddressSelectors();
    attachBirthdayValidation(document.getElementById('birthday'), isPreschool);
    attachPhilippineContactFormatting(document.getElementById('guardianContact'));

    document.getElementById('newStudent').addEventListener('change', () => {
        isNewStudentEnrollment = true;
        document.getElementById('studentForm').style.display = 'block';
        document.getElementById('searchSection').style.display = 'none';
        saveBtn.style.display = canUseEnrollmentPermission('create') ? 'inline-flex' : 'none';
    });

    document.getElementById('existingStudent').addEventListener('change', () => {
        isNewStudentEnrollment = false;
        document.getElementById('studentForm').style.display = 'none';
        document.getElementById('searchSection').style.display = 'block';
        saveBtn.style.display = 'none';
    });

    document.getElementById('searchBtn').addEventListener('click', handleSearch);
}

// --- STEP 2: TUTORIAL SPECIALIZED RENDER ---
function prepareTutorialEnrollmentModal() {
    const modal = document.getElementById('enrollmentDetailsModal');
    if (!modal) return;

    modal.classList.add('tutorial-enrollment-modal');
    modal.querySelector('.modal-dialog')?.classList.add('modal-xl', 'modal-dialog-scrollable');

    const header = modal.querySelector('.modal-header');
    if (header) {
        header.innerHTML = `
            <div class="tutorial-modal-heading">
                <span class="tutorial-modal-heading-icon"><i class="bi bi-file-earmark-text"></i></span>
                <h2 class="modal-title" id="enrollmentDetailsModalLabel">Enrollment Details</h2>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        `;
    }

    const footer = modal.querySelector('.modal-footer');
    const closeBtn = footer?.querySelector('[data-bs-dismiss="modal"]');
    const finalizeBtn = document.getElementById('finalizeEnrollment');
    if (closeBtn) {
        closeBtn.className = 'btn tutorial-close-btn';
        closeBtn.textContent = 'Close';
    }
    if (finalizeBtn) {
        finalizeBtn.className = 'btn tutorial-finalize-btn';
        finalizeBtn.innerHTML = '<i class="bi bi-lock"></i><span>Finalize Enrollment</span>';
    }

    if (document.getElementById('tutorialEnrollmentModalStyles')) return;

    const style = document.createElement('style');
    style.id = 'tutorialEnrollmentModalStyles';
    style.textContent = `
        #enrollmentDetailsModal.tutorial-enrollment-modal {
            --tutorial-accent: #e85d88;
            --tutorial-accent-dark: #d94f7a;
            --tutorial-soft: #fff0f5;
            --tutorial-border: #f5c6d5;
            --tutorial-neutral-border: #dfe3ea;
            --tutorial-text: #172033;
            --tutorial-muted: #697386;
        }
        #enrollmentDetailsModal.tutorial-enrollment-modal .modal-dialog {
            max-width: min(1180px, calc(100vw - 32px));
        }
        #enrollmentDetailsModal.tutorial-enrollment-modal .modal-content {
            border: 0;
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 0 22px 65px rgba(94, 29, 52, .18);
        }
        #enrollmentDetailsModal.tutorial-enrollment-modal .modal-header {
            align-items: center;
            padding: 18px 28px;
            border-bottom: 1px solid #edf0f4;
        }
        #enrollmentDetailsModal .tutorial-modal-heading {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        #enrollmentDetailsModal .tutorial-modal-heading-icon,
        #enrollmentDetailsModal .tutorial-section-icon {
            display: inline-flex;
            flex: 0 0 auto;
            align-items: center;
            justify-content: center;
            color: var(--tutorial-accent);
            background: var(--tutorial-soft);
            border: 1px solid var(--tutorial-border);
            border-radius: 10px;
        }
        #enrollmentDetailsModal .tutorial-modal-heading-icon {
            width: 44px;
            height: 44px;
            font-size: 21px;
        }
        #enrollmentDetailsModal .tutorial-modal-heading h2 {
            margin: 0;
            color: var(--tutorial-text);
            font-size: 25px;
            font-weight: 750;
        }
        #enrollmentDetailsModal.tutorial-enrollment-modal .modal-body {
            padding: 15px 28px 8px;
            background: #fff;
        }
        #enrollmentDetailsModal .tutorial-enrollment-alert {
            display: flex;
            align-items: center;
            gap: 14px;
            min-height: 52px;
            margin-bottom: 14px;
            padding: 13px 18px;
            color: var(--tutorial-text);
            border: 1px solid var(--tutorial-border);
            border-radius: 9px;
            background: #fff9fb;
        }
        #enrollmentDetailsModal .tutorial-enrollment-alert i,
        #enrollmentDetailsModal .tutorial-enrollment-alert strong {
            color: var(--tutorial-accent-dark);
        }
        #enrollmentDetailsModal .tutorial-enrollment-alert i {
            font-size: 20px;
        }
        #enrollmentDetailsModal .tutorial-section {
            margin-bottom: 14px;
            padding: 18px;
            border: 1px solid var(--tutorial-border);
            border-radius: 12px;
            background: #fff;
        }
        #enrollmentDetailsModal .tutorial-section-title {
            display: flex;
            align-items: center;
            gap: 12px;
            margin: 0 0 15px;
            color: var(--tutorial-text);
            font-size: 18px;
            font-weight: 700;
        }
        #enrollmentDetailsModal .tutorial-section-icon {
            width: 34px;
            height: 34px;
            font-size: 16px;
        }
        #enrollmentDetailsModal .form-label {
            margin-bottom: 7px;
            color: var(--tutorial-text);
            font-size: 13px;
            font-weight: 500;
        }
        #enrollmentDetailsModal .form-control,
        #enrollmentDetailsModal .form-select,
        #enrollmentDetailsModal .input-group-text {
            min-height: 44px;
            color: var(--tutorial-text);
            border-color: var(--tutorial-neutral-border);
            border-radius: 7px;
            font-size: 14px;
        }
        #enrollmentDetailsModal .form-control:focus,
        #enrollmentDetailsModal .form-select:focus {
            border-color: var(--tutorial-accent);
            box-shadow: 0 0 0 .2rem rgba(232, 93, 136, .12);
        }
        #enrollmentDetailsModal .form-control:disabled,
        #enrollmentDetailsModal .form-select:disabled {
            color: #5f6673;
            background: #f8f8f9;
            opacity: 1;
        }
        #enrollmentDetailsModal .tutorial-help-text {
            display: block;
            margin-top: 5px;
            color: var(--tutorial-muted);
            font-size: 11px;
        }
        #enrollmentDetailsModal .tutorial-subject-control {
            display: flex;
            gap: 10px;
        }
        #enrollmentDetailsModal .tutorial-subject-control .form-select {
            flex: 1 1 auto;
        }
        #enrollmentDetailsModal .tutorial-add-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 7px;
            min-width: 96px;
            color: var(--tutorial-accent-dark);
            border: 1px solid var(--tutorial-accent);
            background: #fff;
            border-radius: 7px;
            font-weight: 600;
        }
        #enrollmentDetailsModal .tutorial-add-btn:hover {
            color: #fff;
            background: var(--tutorial-accent);
        }
        #enrollmentDetailsModal .tutorial-subject-badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 7px 9px;
            color: var(--tutorial-accent-dark);
            border: 1px solid var(--tutorial-border);
            border-radius: 7px;
            background: var(--tutorial-soft);
        }
        #enrollmentDetailsModal .tutorial-branch {
            display: flex;
            align-items: center;
            min-height: 44px;
            padding-top: 24px;
            color: var(--tutorial-text);
            font-size: 14px;
        }
        #enrollmentDetailsModal .tutorial-learning-section textarea {
            min-height: 54px;
            resize: vertical;
        }
        #enrollmentDetailsModal #unitPreview {
            margin-bottom: 14px;
            padding: 10px 18px;
            border: 1px solid var(--tutorial-border);
            border-radius: 9px;
            background: #fff8fb;
        }
        #enrollmentDetailsModal #unitPreview .alert {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 10px;
            margin: 0;
            padding: 0;
            color: var(--tutorial-text);
            border: 0;
            background: transparent;
        }
        #enrollmentDetailsModal #unitPreview .alert::before {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 34px;
            height: 34px;
            color: var(--tutorial-accent);
            background: var(--tutorial-soft);
            border: 1px solid var(--tutorial-border);
            border-radius: 9px;
            font-family: bootstrap-icons;
            content: "\\f17e";
        }
        #enrollmentDetailsModal #unitPreview .unit-divider {
            width: 1px;
            height: 20px;
            margin: 0 5px;
            background: #d8dce3;
        }
        #enrollmentDetailsModal #unitStatus {
            padding: 7px 13px;
            border: 0;
            background: linear-gradient(100deg, #e85d88, #f07ba0) !important;
            font-weight: 600;
        }
        #enrollmentDetailsModal .tutorial-schedule-grid {
            display: grid;
            grid-template-columns: 1.15fr 1fr 1fr auto;
            gap: 14px;
            align-items: end;
        }
        #enrollmentDetailsModal .tutorial-date-field {
            position: relative;
        }
        #enrollmentDetailsModal #datePickerBtn {
            color: #667085;
            border-color: var(--tutorial-neutral-border);
            border-radius: 0 7px 7px 0;
        }
        #enrollmentDetailsModal .tutorial-schedule-table {
            margin-top: 13px;
            margin-bottom: 0;
            border-color: #e1e4e9;
            border-radius: 7px;
            overflow: hidden;
        }
        #enrollmentDetailsModal .tutorial-schedule-table thead th {
            padding: 10px;
            color: var(--tutorial-text);
            background: var(--tutorial-soft);
            border-color: #ead9df;
            font-size: 12px;
        }
        #enrollmentDetailsModal .tutorial-schedule-table tbody td {
            padding: 10px;
            vertical-align: middle;
            font-size: 13px;
        }
        #enrollmentDetailsModal .tutorial-schedule-table .badge {
            color: var(--tutorial-accent-dark) !important;
            background: var(--tutorial-soft) !important;
        }
        #enrollmentDetailsModal .tutorial-schedule-table .btn-outline-danger {
            color: var(--tutorial-accent-dark);
            border-color: var(--tutorial-border);
        }
        #enrollmentDetailsModal.tutorial-enrollment-modal .modal-footer {
            justify-content: flex-end;
            gap: 12px;
            padding: 14px 28px 18px;
            border-top: 1px solid #edf0f4;
            background: #fff;
        }
        #enrollmentDetailsModal .tutorial-close-btn,
        #enrollmentDetailsModal .tutorial-finalize-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 9px;
            min-height: 45px;
            padding: 10px 24px;
            border-radius: 8px;
            font-weight: 600;
        }
        #enrollmentDetailsModal .tutorial-close-btn {
            min-width: 105px;
            color: var(--tutorial-text);
            border: 1px solid var(--tutorial-neutral-border);
            background: #fff;
        }
        #enrollmentDetailsModal .tutorial-finalize-btn {
            min-width: 230px;
            color: #fff;
            border: 0;
            background: linear-gradient(100deg, #e85d88, #f07ba0);
            box-shadow: 0 9px 20px rgba(232, 93, 136, .22);
        }
        #enrollmentDetailsModal .tutorial-finalize-btn:hover {
            color: #fff;
            filter: brightness(.96);
        }
        @media (max-width: 767.98px) {
            #enrollmentDetailsModal.tutorial-enrollment-modal .modal-dialog {
                max-width: calc(100vw - 16px);
                margin: 8px auto;
            }
            #enrollmentDetailsModal.tutorial-enrollment-modal .modal-header,
            #enrollmentDetailsModal.tutorial-enrollment-modal .modal-body,
            #enrollmentDetailsModal.tutorial-enrollment-modal .modal-footer {
                padding-left: 18px;
                padding-right: 18px;
            }
            #enrollmentDetailsModal .tutorial-modal-heading h2 {
                font-size: 21px;
            }
            #enrollmentDetailsModal .tutorial-schedule-grid {
                grid-template-columns: 1fr;
            }
            #enrollmentDetailsModal .tutorial-add-btn {
                min-height: 44px;
            }
            #enrollmentDetailsModal .tutorial-branch {
                padding-top: 0;
            }
            #enrollmentDetailsModal .tutorial-close-btn,
            #enrollmentDetailsModal .tutorial-finalize-btn {
                flex: 1 1 auto;
                min-width: 0;
                padding-inline: 12px;
            }
        }
    `;
    document.head.appendChild(style);
}

function renderEnrollmentStep(studentName) {
    preferredSchedules = [];
    selectedSubjectIds = [];
    const form = document.getElementById("enrollmentForm");
    if (!form) return;
    prepareTutorialEnrollmentModal();
    const today = new Date().toISOString().split('T')[0];

    const tutorials = globalLookups.programs.filter(p => p.program_type == 1 || p.program_type == 2);
    const pendingProgramId = pendingDownpaymentEnrollment?.program_id || '';

    const branchOptions = generateOptions(globalLookups.branches || [], 'branch_id', 'branch_name', globalLookups.current_branch?.branch_id || '');

    let html = `
        <div class="tutorial-enrollment-alert">
            <i class="bi bi-info-circle"></i>
            <span><strong>Tutorial Enrollment</strong> for ${escapeHtml(studentName)}</span>
        </div>

        <section class="tutorial-section">
            <h3 class="tutorial-section-title">
                <span class="tutorial-section-icon"><i class="bi bi-mortarboard-fill"></i></span>
                <span>Program &amp; Assignment</span>
            </h3>
            <div class="row g-3">
                <div class="col-md-6">
                    <label class="form-label" for="programId">Program</label>
                    <select class="form-select" id="programId" required onchange="filterTeachers()" ${pendingProgramId ? 'disabled' : ''}>
                        <option value="">Select Tutorial</option>
                        ${generateOptionsWithType(tutorials, 'program_id', 'name', 'program_type', pendingProgramId)}
                    </select>
                    ${pendingProgramId ? '<small class="tutorial-help-text"><i class="bi bi-lock me-1"></i>Program locked from the saved downpayment.</small>' : ''}
                </div>
                <div class="col-md-6">
                    <label class="form-label" for="gradeLevelId">Grade Level</label>
                    <select class="form-select" id="gradeLevelId" required>
                        <option value="">Select Grade</option>
                        ${generateOptions(globalLookups.grade_levels, 'grade_level_id', 'grade_level')}
                    </select>
                </div>
                <div class="col-md-6">
                    <label class="form-label">Subjects <span class="text-danger" aria-hidden="true">*</span></label>
                    <div class="tutorial-subject-control">
                        <select class="form-select" id="subjectId">
                            <option value="">Select Subject</option>
                            ${generateOptions(globalLookups.subjects, 'subject_id', 'subject_name')}
                        </select>
                        <button type="button" class="btn tutorial-add-btn" onclick="addSelectedSubject()">
                            <i class="bi bi-plus-lg"></i><span>Add</span>
                        </button>
                    </div>
                    <div id="selectedSubjectsList" class="mt-2 d-flex flex-wrap gap-2">
                        <span class="text-muted small">No subjects added yet.</span>
                    </div>
                </div>
                <div class="col-md-6">
                    <label class="form-label" for="preferredBranch">Branch</label>
                    <select class="form-select" id="preferredBranch" required onchange="filterTeachers()">
                        <option value="">Select Branch</option>
                        ${branchOptions}
                    </select>
                </div>
                <div class="col-md-6">
                    <label class="form-label">School Year</label>
                    <input type="text" class="form-control" disabled value="${globalLookups.active_school_year ? globalLookups.active_school_year.school_year : 'No active school year'}">
                </div>
                <div class="col-md-6">
                    <label class="form-label" for="preferredTeacher">Teacher <small class="text-muted">(Filtered)</small></label>
                    <select class="form-select" id="preferredTeacher" required onchange="onTeacherChange()">
                        <option value="">Select Teacher</option>
                        ${generateOptions(getActiveTeachers(), 'employee_id', 'name')}
                    </select>
                </div>
            </div>
        </section>

        <section class="tutorial-section tutorial-learning-section">
            <h3 class="tutorial-section-title">
                <span class="tutorial-section-icon"><i class="bi bi-bullseye"></i></span>
                <span>Learning Goal</span>
            </h3>
            <textarea class="form-control" id="goal" rows="2" placeholder="Enter learning goal..."></textarea>
        </section>

        <div id="unitPreview" style="display:none;">
                <div class="alert alert-info">
                    <strong>Required Units:</strong> <span id="requiredUnits">-</span>
                    <span class="unit-divider" aria-hidden="true"></span>
                    <strong>Current Schedule Units:</strong> <span id="currentUnits">0</span>
                    <span id="unitStatus" class="badge bg-warning ms-2">Needs more</span>
                </div>
        </div>

        <section class="tutorial-section">
            <h3 class="tutorial-section-title">
                <span class="tutorial-section-icon"><i class="bi bi-calendar-week"></i></span>
                <span>Schedule Preferences</span>
            </h3>
            <div class="tutorial-schedule-grid">
                <div class="tutorial-date-field">
                    <label class="form-label" for="schedDateInput">Select Date</label>
                    <div class="input-group">
                        <input type="text" class="form-control" id="schedDateInput" placeholder="Click to pick date" readonly>
                        <input type="hidden" id="schedDate">
                        <button class="btn btn-outline-secondary" type="button" id="datePickerBtn" title="Open Calendar">
                            <i class="bi bi-calendar3"></i>
                        </button>
                    </div>
                    <div id="dateCalendarContainer" style="display:none; position:absolute; top:100%; left:0; width:100%; z-index:1050;"></div>
                </div>
                <div>
                    <label class="form-label" for="schedTime">Start Time</label>
                    <input type="time" class="form-control" id="schedTime">
                </div>
                <div>
                    <label class="form-label" for="schedEndTime">End Time</label>
                    <input type="time" class="form-control" id="schedEndTime">
                </div>
                <div>
                    <button type="button" class="btn tutorial-add-btn" onclick="addSchedule()">
                        <i class="bi bi-plus-lg"></i><span>Add</span>
                    </button>
                </div>
            </div>
            <div class="table-responsive">
                <table class="table table-sm table-bordered bg-white tutorial-schedule-table">
                    <thead class="table-light">
                        <tr>
                            <th>Date</th>
                            <th>Day</th>
                            <th>Start - End</th>
                            <th style="width: 50px;">Action</th>
                        </tr>
                    </thead>
                    <tbody id="scheduleListBody">
                        <tr><td colspan="4" class="text-center text-muted"><i class="bi bi-calendar3 me-2"></i>No schedule preferences added yet.</td></tr>
                    </tbody>
                </table>
            </div>
        </section>
    `;
    form.innerHTML = html;
    markRequiredFieldLabels(form);
    const finalizeButton = document.getElementById("finalizeEnrollment");
    if (finalizeButton) {
        finalizeButton.onclick = handleSaveEnrollmentDetails;
        finalizeButton.style.display = canUseEnrollmentPermission(getEnrollmentFinalizePermissionKey()) ? 'inline-flex' : 'none';
    }

    const programSelect = document.getElementById('programId');
    const gradeLevelSelect = document.getElementById('gradeLevelId');
    const branchSelect = document.getElementById('preferredBranch');
    const teacherSelect = document.getElementById('preferredTeacher');
    const goalInput = document.getElementById('goal');
    const seedDetails = pendingEnrollmentDetails;

    if (seedDetails) {
        if (!pendingProgramId && programSelect && seedDetails.program_id) {
            programSelect.value = String(seedDetails.program_id);
        }
        if (gradeLevelSelect && seedDetails.grade_level_id) {
            gradeLevelSelect.value = String(seedDetails.grade_level_id);
        }
        if (goalInput) {
            goalInput.value = seedDetails.goal || '';
        }
        if (branchSelect && seedDetails.branch_id) {
            branchSelect.value = String(seedDetails.branch_id);
        }

        selectedSubjectIds = parseSubjectIdsList(seedDetails.subject_ids || seedDetails.subject_id);
        preferredSchedules = normalizePendingScheduleRows(seedDetails.schedule || []);

        if (teacherSelect && seedDetails.preferred_teacher) {
            teacherSelect.value = String(seedDetails.preferred_teacher);
        }
    }

    renderSelectedSubjects();
    renderScheduleList();
    updateProgramSchedulePreview();
    filterTeachers();

    // Import and setup date picker - module not loaded, use dynamic import
    import('./enrollmentDatePicker.js?v=20260812-edit-teacher-schedule').then(module => {
        module.initEnrollmentDatePicker();
    }).catch(err => {
        console.error('Date picker module load error:', err);
        // Fallback: simple select with loading
        const dateSelect = document.getElementById('schedDate');
        dateSelect.innerHTML = '<option>Loading teacher dates...</option>';
    });
    
    // Auto-load teacher dates on teacher change
    if (teacherSelect) {
        teacherSelect.addEventListener('change', onTeacherChange);
    }
    
    // Listen for teacher availability updates to refresh calendar
    window.addEventListener('teacherAvailabilityUpdated', () => {
        if (window.setupDatePicker) window.setupDatePicker();
    });
}

window.validateTeacherDateSelection = function() {
    const teacherId = document.getElementById('preferredTeacher')?.value;
    const dateInput = document.getElementById('schedDate')?.value;
    if (!teacherId || !dateInput || !window.teacherAvailableDates?.length) return true;

    if (!window.teacherAvailableDates.includes(dateInput)) {
        Swal.fire({
            icon: 'warning',
            title: 'Date Not Available',
            text: 'Please select from the available dates shown for this teacher.',
            timer: 3000
        });
        document.getElementById('schedDate').value = '';
        document.getElementById('schedDateInput').value = '';
        return false;
    }

    // Success feedback
    console.log('✅ Valid teacher date selected:', dateInput);
    return true;
};

function formatTime(time24) {
    if (!time24) return '';
    const [hours, minutes] = time24.split(':');
    const hour12 = parseInt(hours) % 12 || 12;
    const ampm = parseInt(hours) >= 12 ? 'PM' : 'AM';
    return `${hour12}:${minutes} ${ampm}`;
}

function parseTimeToMinutes(timeString) {
    if (!timeString) return 0;
    const parts = timeString.split(':');
    const hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;
    return hours * 60 + minutes;
}

function minutesToTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`;
}

function subtractInterval(intervals, bStart, bEnd) {
    const result = [];
    intervals.forEach(int => {
        if (bEnd <= int.start || bStart >= int.end) {
            result.push(int);
        } else {
            if (bStart > int.start) {
                result.push({start: int.start, end: bStart});
            }
            if (bEnd < int.end) {
                result.push({start: bEnd, end: int.end});
            }
        }
    });
    return result;
}

function mergeTeacherScheduleIntervals(intervals) {
    return intervals
        .filter(interval => interval.end > interval.start)
        .sort((a, b) => a.start - b.start)
        .reduce((merged, interval) => {
            const previous = merged[merged.length - 1];
            if (!previous || interval.start > previous.end) {
                merged.push({ ...interval });
            } else {
                previous.end = Math.max(previous.end, interval.end);
            }
            return merged;
        }, []);
}

window.parseTimeToMinutes = parseTimeToMinutes;
window.minutesToTime = minutesToTime;
window.subtractInterval = subtractInterval;

window.filterTeachers = function() {
    const programId = document.getElementById('programId')?.value || '';
    const subjectIds = getSelectedSubjectIds();
    const teacherSelect = document.getElementById('preferredTeacher');
    const branchId = document.getElementById('preferredBranch')?.value || '';
    if (!teacherSelect) return;
    
    // Capture current teacher selection before changes
    const currentTeacherId = teacherSelect.value;

    const resetTeacherAvailability = () => {
        teacherAvailableSlots = [];
        teacherBookedSlots = [];
        teacherAvailableDates = [];
        window.teacherAvailableSlots = [];
        window.teacherBookedSlots = [];
        window.teacherAvailableDates = [];
        populateAvailableDateOptions();
    };
    
    if (!programId) {
        teacherSelect.disabled = true;
        teacherSelect.innerHTML = '<option value="">Select Program First</option>';
        hideUnitPreview();
        resetTeacherAvailability();
        return;
    }
    
    updateProgramSchedulePreview();

    if (subjectIds.length === 0) {
        teacherSelect.disabled = true;
        teacherSelect.innerHTML = '<option value="">Select Subject First</option>';
        resetTeacherAvailability();
        return;
    }

    if (!branchId) {
        teacherSelect.disabled = true;
        teacherSelect.innerHTML = '<option value="">Select Branch First</option>';
        resetTeacherAvailability();
        return;
    }
    
    // Show loading
    teacherSelect.disabled = true;
    teacherSelect.innerHTML = '<option>Loading matching teachers...</option>';
    
    const schedulesJson = JSON.stringify(preferredSchedules.map(s => ({
        date: s.date,
        day: s.day,
        time: s.time,
        endTime: s.endTime
    })));
    
    axios.get(`../../api/admin/enrollment.php?operation=getFilteredTeachers&program_id=${programId}&subject_ids=${encodeURIComponent(subjectIds.join(','))}&branch_id=${encodeURIComponent(branchId)}&preferred_schedules=${encodeURIComponent(schedulesJson)}`)
        .then(res => {
            teacherSelect.disabled = false;
            if (res.data.status === 'success') {
                if (res.data.data.length > 0) {
                    const optionsHtml = res.data.data.map(t => `<option value="${t.employee_id}">${t.name}</option>`).join('');
                    teacherSelect.innerHTML = '<option value="">Select Teacher</option>' + optionsHtml;
                    
                    // Restore teacher selection if still available in filtered list
                    if (currentTeacherId && res.data.data.some(t => t.employee_id == currentTeacherId)) {
                        teacherSelect.value = currentTeacherId;
                        onTeacherChange(); // Reload availability for preserved teacher
                    }
                } else {
                    let msg = preferredSchedules.length > 0 ? 'No teachers available for your schedule' : 'No teachers for this program/subject';
                    teacherSelect.innerHTML = `<option value="">${msg}</option>`;
                }
            } else {
                const errorMessage = res.data.message || 'Error loading teachers';
                console.error('Filter teachers API error:', errorMessage, res.data);
                teacherSelect.innerHTML = `<option value="">${escapeHtml(errorMessage)}</option>`;
            }
            // Ensure availability is loaded if teacher preserved
            if (teacherSelect.value) {
                onTeacherChange();
            } else {
                teacherAvailableSlots = [];
                teacherBookedSlots = [];
                teacherAvailableDates = [];
                populateAvailableDateOptions();
            }
        })
        .catch(err => {
            teacherSelect.disabled = false;
            const errorMessage = err?.response?.data?.message || err?.message || 'Error loading teachers';
            console.error('Filter teachers error:', err?.response?.data || err);
            teacherSelect.innerHTML = `<option value="">${escapeHtml(errorMessage)}</option>`;
            // Try to restore if possible, else reset
            if (currentTeacherId) {
                teacherSelect.value = currentTeacherId;
                onTeacherChange();
            } else {
                teacherAvailableSlots = [];
                teacherBookedSlots = [];
                teacherAvailableDates = [];
                populateAvailableDateOptions();
            }
        });
};

window.onTeacherChange = function() {
    window.teacherAvailableSlots = [];
    window.teacherBookedSlots = [];
    window.teacherAvailableDates = [];
    
    const teacherId = document.getElementById('preferredTeacher').value;
    const dateInput = document.getElementById('schedDateInput');
    const hiddenDate = document.getElementById('schedDate');
    const calendarContainer = document.getElementById('dateCalendarContainer');

    if (dateInput) {
        dateInput.value = teacherId ? 'Loading...' : '';
        dateInput.placeholder = teacherId ? 'Loading available dates...' : 'Click to pick date';
    }
    if (hiddenDate) {
        hiddenDate.value = '';
    }
    if (calendarContainer) {
        calendarContainer.style.display = 'none';
    }
    
    if (!teacherId) {
        return;
    }
    
    axios.get(`../../api/admin/enrollment.php?operation=getTeacherAvailableSlots&teacher_id=${teacherId}`)
        .then(res => {
            if (res.data.status === 'success') {
                window.teacherAvailableSlots = res.data.data.slots || [];
                window.teacherBookedSlots = res.data.data.bookings || [];
                console.log('Teacher available slots:', window.teacherAvailableSlots);
                console.log('Teacher booked slots:', window.teacherBookedSlots);
                
                window.teacherAvailableDates = getAvailableTeacherDates(window.teacherAvailableSlots, window.teacherBookedSlots, 180);
                
                window.teacherAvailableSlotsPerDate = teacherAvailableSlotsPerDate;
                window.teacherFullShiftsPerDate = teacherFullShiftsPerDate;
                
                if (dateInput) {
                    dateInput.value = '';
                    dateInput.placeholder = 'Click to pick date';
                }
                
                const event = new CustomEvent('teacherAvailabilityUpdated');
                window.dispatchEvent(event);
            } else {
                if (dateInput) {
                    dateInput.value = '';
                    dateInput.placeholder = 'No available dates';
                }
                console.error('Error fetching teacher slots:', res.data.message);
            }
        })
        .catch(err => {
            if (dateInput) {
                dateInput.value = '';
                dateInput.placeholder = 'Unable to load dates';
            }
            console.error('Error fetching teacher slots:', err);
        });
};

function getAvailableTeacherDates(slots, bookings, daysAhead = 180) {
    if (!Array.isArray(slots) || slots.length === 0) return [];

    teacherAvailableSlotsPerDate = {};
    teacherFullShiftsPerDate = {};

    const bookingsByDate = {};
    (bookings || []).forEach(b => {
        if (!bookingsByDate[b.date]) bookingsByDate[b.date] = [];
        bookingsByDate[b.date].push({start: b.start_time, end: b.end_time});
    });

    const dates = [];
    const today = new Date();
    for (let i = 0; i <= daysAhead; i++) {
        const current = new Date(today);
        current.setDate(today.getDate() + i);
        const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][current.getDay()];
        const formatted = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
        const daySlots = slots.filter(s => s.day_of_week === dayName);
        if (daySlots.length === 0) continue;

        const fullShifts = mergeTeacherScheduleIntervals(daySlots.map(shift => ({
            start: parseTimeToMinutes(shift.start_time),
            end: parseTimeToMinutes(shift.end_time)
        })));
        if (fullShifts.length === 0) continue;

        teacherFullShiftsPerDate[formatted] = {
            start: minutesToTime(fullShifts[0].start),
            end: minutesToTime(fullShifts[fullShifts.length - 1].end),
            totalMinutes: fullShifts.reduce((total, shift) => total + (shift.end - shift.start), 0)
        };
        let remaining = fullShifts.map(shift => ({ ...shift }));

        const booked = bookingsByDate[formatted] || [];
        booked.forEach(b => {
            const bStart = parseTimeToMinutes(b.start);
            const bEnd = parseTimeToMinutes(b.end);
            remaining = subtractInterval(remaining, bStart, bEnd);
        });

        if (remaining.length > 0) {
            teacherAvailableSlotsPerDate[formatted] = remaining.map(r => ({
                start: minutesToTime(r.start),
                end: minutesToTime(r.end)
            }));
            dates.push(formatted);
        }
    }
    return dates;
}

function populateAvailableDateOptions() {
    const dateInput = document.getElementById('schedDateInput');
    const hiddenDate = document.getElementById('schedDate');
    if (dateInput) {
        if (!window.teacherAvailableDates || window.teacherAvailableDates.length === 0) {
            dateInput.value = '';
            dateInput.placeholder = 'Click to pick date';
        } else {
            dateInput.value = '';
            dateInput.placeholder = 'Click to pick date';
        }
    }
    if (hiddenDate) {
        hiddenDate.value = '';
    }
}

function updateUnitPreview() {
    const programId = document.getElementById('programId').value;
    const program = globalLookups.programs.find(p => p.program_id == programId);
    if (!program || !program.total_units || !program.unit_type) {
        hideUnitPreview();
        return;
    }
    
    if (program.unit_type !== 'session') {
        hideUnitPreview();
        return;
    }
    
    const requiredEl = document.getElementById('requiredUnits');
    const currentEl = document.getElementById('currentUnits');
    const statusEl = document.getElementById('unitStatus');
    const previewEl = document.getElementById('unitPreview');
    
    requiredEl.textContent = program.total_units;
    
    // Calc current units: hours per slot
    let currentUnits = 0;
    preferredSchedules.forEach(s => {
        if (s.endTime) {
            const startH = parseInt(s.time.split(':')[0]);
            const endH = parseInt(s.endTime.split(':')[0]);
            currentUnits += Math.max(0, endH - startH);
        }
    });
    currentEl.textContent = currentUnits;
    
    previewEl.style.display = 'block';
    
    if (currentUnits >= program.total_units) {
        statusEl.textContent = 'Complete ✓';
        statusEl.className = 'badge bg-success ms-2';
        document.getElementById('finalizeEnrollment').disabled = false;
    } else {
        statusEl.textContent = 'Needs more';
        statusEl.className = 'badge bg-warning ms-2';
        document.getElementById('finalizeEnrollment').disabled = true;
    }
}

function hideUnitPreview() {
    const previewEl = document.getElementById('unitPreview');
    if (previewEl) previewEl.style.display = 'none';
    
    const finalizeBtn = document.getElementById('finalizeEnrollment');
    if (finalizeBtn) finalizeBtn.disabled = false;
}

function getSelectedProgramScheduleRequirement(schedules = preferredSchedules) {
    const programId = document.getElementById('programId')?.value;
    const program = globalLookups.programs?.find(p => p.program_id == programId);
    const unitType = (program?.unit_type || '').toString().trim().toLowerCase();
    const requiredUnits = parseFloat(program?.total_units || 0);
    const requiredMinutes = requiredUnits > 0 ? Math.round(requiredUnits * 60) : 0;
    const currentMinutes = calculateScheduleMinutes(schedules);
    const differenceMinutes = requiredMinutes - currentMinutes;
    const applicable = Boolean(program && unitType === 'session' && requiredMinutes > 0);

    return {
        applicable,
        program,
        unitType,
        requiredUnits,
        requiredMinutes,
        currentMinutes,
        differenceMinutes,
        matches: applicable ? differenceMinutes === 0 : true
    };
}

function calculateScheduleMinutes(schedules = preferredSchedules) {
    if (!Array.isArray(schedules)) return 0;

    return schedules.reduce((total, schedule) => {
        const startMinutes = parseTimeToMinutes(schedule?.time);
        const endMinutes = parseTimeToMinutes(schedule?.endTime);
        if (endMinutes <= startMinutes) {
            return total;
        }

        return total + (endMinutes - startMinutes);
    }, 0);
}

function formatScheduleUnits(minutes) {
    const units = Math.max(0, minutes) / 60;
    if (Number.isInteger(units)) {
        return String(units);
    }

    return units.toFixed(2).replace(/\.?0+$/, '');
}

function showScheduleRequirementAlert(validation, title = 'Schedule Requirement') {
    if (!validation?.applicable) {
        return;
    }

    const requiredLabel = formatScheduleUnits(validation.requiredMinutes);
    const currentLabel = formatScheduleUnits(validation.currentMinutes);
    const differenceLabel = formatScheduleUnits(Math.abs(validation.differenceMinutes));
    let text = `This tutorial requires exactly ${requiredLabel} session unit(s). Current total: ${currentLabel}.`;

    if (validation.differenceMinutes > 0) {
        text += ` Add ${differenceLabel} more session unit(s) to match the program.`;
    } else if (validation.differenceMinutes < 0) {
        text += ` Remove ${differenceLabel} session unit(s) to match the program.`;
    }

    showEnrollmentValidationAlert(title, [{
        element: document.getElementById('schedDateInput'),
        highlight: document.querySelector('.tutorial-schedule-table'),
        message: text
    }]);
}

function updateProgramSchedulePreview() {
    const validation = getSelectedProgramScheduleRequirement();
    if (!validation.applicable) {
        hideUnitPreview();
        return;
    }

    const requiredEl = document.getElementById('requiredUnits');
    const currentEl = document.getElementById('currentUnits');
    const statusEl = document.getElementById('unitStatus');
    const previewEl = document.getElementById('unitPreview');

    requiredEl.textContent = formatScheduleUnits(validation.requiredMinutes);
    currentEl.textContent = formatScheduleUnits(validation.currentMinutes);
    previewEl.style.display = 'block';

    if (validation.matches) {
        statusEl.textContent = 'Matched';
        statusEl.className = 'badge bg-success ms-2';
        document.getElementById('finalizeEnrollment').disabled = false;
    } else if (validation.differenceMinutes > 0) {
        statusEl.textContent = `Needs ${formatScheduleUnits(validation.differenceMinutes)} more`;
        statusEl.className = 'badge bg-warning ms-2';
        document.getElementById('finalizeEnrollment').disabled = true;
    } else {
        statusEl.textContent = `Over by ${formatScheduleUnits(Math.abs(validation.differenceMinutes))}`;
        statusEl.className = 'badge bg-danger ms-2';
        document.getElementById('finalizeEnrollment').disabled = true;
    }
}

// --- SUBMISSION LOGIC ---

function handleSaveStudent() {
    if (!guardEnrollmentPermission('create', 'You do not have permission to add enrollment records.')) {
        return;
    }

    const studentForm = document.getElementById('studentForm');
    clearEnrollmentValidation(studentForm || document);

    const isPreschool = window.currentEnrollmentCategory === 'preschool';
    const healthNotesInput = document.getElementById("healthNotes");
    const healthNoteValue = isPreschool && healthNotesInput && healthNotesInput.value.trim() !== ''
        ? healthNotesInput.value.trim()
        : null;
    
    // Store health note globally for enrollment submission
    currentStudentHealthNote = healthNoteValue;
    
    const data = {
        first_name: document.getElementById("firstName").value,
        middle_name: document.getElementById("middleName").value,
        last_name: document.getElementById("lastName").value,
        ext: document.getElementById("nameExt").value || '',
        nickname: document.getElementById("nickname").value,
        birthday: document.getElementById("birthday").value,
        gender_id: document.getElementById("genderId").value,
        email: document.getElementById("email").value,
        guardian_name: document.getElementById("guardianName").value,
        guardian_contact: formatPhilippineContactNumber(document.getElementById("guardianContact").value),
        guardian_relationship: document.getElementById("guardianRelationship").value,
        adr_street: document.getElementById("adrStreet").value,
        adr_barangay: document.getElementById("adrBarangay").value,
        adr_city: document.getElementById("adrCity").value,
        adr_province: document.getElementById("adrProvince").value,
        adr_note: document.getElementById("adrNote").value || null,
        health_note: healthNoteValue
    };

    const requiredFields = [
        {key: 'first_name', label: 'First Name', id: 'firstName'},
        {key: 'middle_name', label: 'Middle Name', id: 'middleName'},
        {key: 'last_name', label: 'Last Name', id: 'lastName'},
        {key: 'birthday', label: 'Birthday', id: 'birthday'},
        {key: 'gender_id', label: 'Gender', id: 'genderId'},
        {key: 'guardian_name', label: 'Guardian Name', id: 'guardianName'},
        {key: 'email', label: 'Email', id: 'email'},
        {key: 'guardian_contact', label: 'Guardian Contact', id: 'guardianContact'},
        {key: 'guardian_relationship', label: 'Guardian Relationship', id: 'guardianRelationship'},
        {key: 'adr_province', label: 'Province', id: 'adrProvince'},
        {key: 'adr_city', label: 'City / Municipality', id: 'adrCity'},
        {key: 'adr_barangay', label: 'Barangay', id: 'adrBarangay'},
        {key: 'adr_street', label: 'Street / House No.', id: 'adrStreet'}
    ];
    // Health Notes is optional for preschool, not included in required validation

    const missingFields = requiredFields.filter(field => String(data[field.key] ?? '').trim() === '');

    if (missingFields.length > 0) {
        showEnrollmentValidationAlert('Required Fields Missing', missingFields.map(field => ({
            element: document.getElementById(field.id),
            message: `${field.label} is required.`
        })));
        return;
    }

    if(!isValidEmail(data.email)) {
        showEnrollmentValidationAlert('Invalid Email', [{
            element: document.getElementById('email'),
            message: 'Enter a valid email address.'
        }]);
        return;
    }

    if(!isValidContactNumber(data.guardian_contact)) {
        showEnrollmentValidationAlert('Invalid Contact Number', [{
            element: document.getElementById('guardianContact'),
            message: 'Enter a valid Philippine mobile number after +63 (for example, 9171234567).'
        }]);
        return;
    }

    const birthdayValidation = validateBirthdayForEnrollmentCategory(data.birthday, isPreschool);
    if (!birthdayValidation.valid) {
        showEnrollmentValidationAlert(birthdayValidation.title, [{
            element: document.getElementById('birthday'),
            message: birthdayValidation.message
        }]);
        return;
    }

    data.enrollment_category = window.currentEnrollmentCategory || 'tutorial';

    axios.post("../../api/admin/student.php", {
        operation: "addStudent",
        json: JSON.stringify(data)
    }).then(res => {
        if(res.data.status === "success") {
            // If the API returned the current branch (employee's branch), merge into lookups
            if (res.data.current_branch) {
                globalLookups.current_branch = res.data.current_branch;
            }

            const sid = Number(res.data.student_id);
            if (!Number.isInteger(sid) || sid <= 0) {
                console.error('Invalid student_id returned:', res.data.student_id, res.data);
                Swal.fire('Error', 'Invalid student ID returned from server. Please try again or refresh the page.', 'error');
                return;
            }

            currentStudentId = sid;
            enrollmentStudentName = res.data.student_name;
            enrollmentStudentId = sid;
            isNewStudentEnrollment = true;

            const addEnrollmentModal = document.getElementById('addEnrollmentModal');
            const downpaymentModal = document.getElementById('downpaymentModal');
            switchModal(addEnrollmentModal, downpaymentModal);
        } else {
            showEnrollmentServerError('Student Details Need Attention', res.data.message);
        }
    }).catch(err => {
        console.error('Student save error:', err);
        showEnrollmentServerError(
            'Unable to Save Student',
            err.response?.data?.message || err.message,
            'Unable to save new student. Please review the highlighted fields and try again.'
        );
    });
}

function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidContactNumber(contact) {
    return typeof contact === 'string' && /^\+639[0-9]{9}$/.test(contact);
}

function getPhilippineContactLocalDigits(contact) {
    let digits = (contact || '').toString().replace(/\D/g, '');

    if (digits.startsWith('0063')) {
        digits = digits.slice(4);
    } else if (digits.startsWith('63')) {
        digits = digits.slice(2);
    } else if (digits.startsWith('0')) {
        digits = digits.slice(1);
    }

    return digits.slice(0, 10);
}

function formatPhilippineContactNumber(contact) {
    const localDigits = getPhilippineContactLocalDigits(contact);
    return localDigits ? `+63${localDigits}` : '';
}

function attachPhilippineContactFormatting(input) {
    if (!input) return;

    input.addEventListener('input', () => {
        input.value = getPhilippineContactLocalDigits(input.value);
        input.setCustomValidity('');
    });

    input.addEventListener('blur', () => {
        const formattedContact = formatPhilippineContactNumber(input.value);
        input.setCustomValidity(
            formattedContact && !isValidContactNumber(formattedContact)
                ? 'Enter a valid Philippine mobile number beginning with 9.'
                : ''
        );
    });
}

function handleSaveEnrollmentDetails() {
    const permissionKey = getEnrollmentFinalizePermissionKey();
    const message = permissionKey === 'approve'
        ? 'You do not have permission to approve or complete enrollment records.'
        : 'You do not have permission to finalize enrollment records.';

    if (!guardEnrollmentPermission(permissionKey, message)) {
        return;
    }

    const enrollmentForm = document.getElementById('enrollmentForm');
    clearEnrollmentValidation(enrollmentForm || document);

    const studentId = Number(currentStudentId);
    if (!Number.isInteger(studentId) || studentId <= 0) {
        Swal.fire("No student selected", "Please select or create a valid student before finalizing enrollment.", "warning");
        return;
    }

    const progId = document.getElementById("programId").value;
    const gradeLevelId = document.getElementById('gradeLevelId')?.value || '';
    const subjectIds = getSelectedSubjectIds();
    const program = globalLookups.programs.find(p => p.program_id == progId);
    const scheduleValidation = getSelectedProgramScheduleRequirement();
    const preferredTimeDay = preferredSchedules
        .map(s => `${s.day} ${s.time}${s.endTime ? ' - ' + s.endTime : ''}`)
        .join(', ');
    
    console.log('Submitting enrollment for student_id:', studentId);

    const preferredBranch = document.getElementById("preferredBranch")?.value || '';
    const preferredTeacher = document.getElementById("preferredTeacher").value;
    const validationIssues = [];
    if (!progId) {
        validationIssues.push({ element: document.getElementById('programId'), message: 'Program is required.' });
    }
    if (!gradeLevelId) {
        validationIssues.push({ element: document.getElementById('gradeLevelId'), message: 'Grade level is required.' });
    }
    if (subjectIds.length === 0) {
        validationIssues.push({
            element: document.getElementById('subjectId'),
            highlight: document.querySelector('.tutorial-subject-control'),
            message: 'Add at least one subject.'
        });
    }
    if (!preferredBranch) {
        validationIssues.push({ element: document.getElementById('preferredBranch'), message: 'Branch is required.' });
    }
    if (!preferredTeacher) {
        validationIssues.push({ element: document.getElementById('preferredTeacher'), message: 'Teacher is required.' });
    }
    if (scheduleValidation.applicable && !scheduleValidation.matches) {
        const difference = formatScheduleUnits(Math.abs(scheduleValidation.differenceMinutes));
        const scheduleMessage = scheduleValidation.currentMinutes === 0
            ? 'Add the required schedule preference.'
            : scheduleValidation.differenceMinutes > 0
                ? `Add ${difference} more session unit(s) to the schedule.`
                : `Remove ${difference} session unit(s) from the schedule.`;
        validationIssues.push({
            element: document.getElementById('schedDateInput'),
            highlight: document.querySelector('.tutorial-schedule-table'),
            message: scheduleMessage
        });
    }
    if (validationIssues.length > 0) {
        showEnrollmentValidationAlert('Enrollment Details Need Attention', validationIssues);
        return;
    }

    const data = {
        student_id: studentId,
        program_id: progId,
        grade_level_id: gradeLevelId,
        preferred_branch_id: preferredBranch,
        subject_id: subjectIds[0],
        subject_ids: subjectIds,
        preferred_teacher: preferredTeacher,
        goal: document.getElementById("goal").value,
        school_year_id: globalLookups.active_school_year ? globalLookups.active_school_year.school_year_id : null,
        total_of_program: program ? program.tuition : "0",
        preferred_time_day: preferredTimeDay || null,
        preferences: preferredSchedules.map(s => ({
            day: s.day,
            time: s.time,
            endTime: s.endTime,
            date: s.date
        })),
        enrollment_category: 'tutorial',
        is_new_student: isNewStudentEnrollment
    };
    submitEnrollment(data);
}

function handleSavePreschoolEnrollment() {
    const permissionKey = getEnrollmentFinalizePermissionKey();
    const message = permissionKey === 'approve'
        ? 'You do not have permission to approve or complete enrollment records.'
        : 'You do not have permission to finalize enrollment records.';

    if (!guardEnrollmentPermission(permissionKey, message)) {
        return;
    }

    const enrollmentForm = document.getElementById('enrollmentForm');
    clearEnrollmentValidation(enrollmentForm || document);

    const progId = document.getElementById("preschoolProgram").value;
    const classId = document.getElementById("preschoolClass").value;
    const sectionId = document.getElementById("preschoolSection").value;
    const validationIssues = [];
    if (!progId) {
        validationIssues.push({ element: document.getElementById('preschoolProgram'), message: 'Program is required.' });
    }
    if (!classId) {
        validationIssues.push({ element: document.getElementById('preschoolClass'), message: 'Class is required.' });
    }
    if (!sectionId) {
        validationIssues.push({ element: document.getElementById('preschoolSection'), message: 'Section is required.' });
    }
    if (validationIssues.length > 0) {
        showEnrollmentValidationAlert('Enrollment Details Need Attention', validationIssues);
        return;
    }
    const includeService = preschoolServiceSelection.programId === String(progId) && preschoolServiceSelection.include;
    const serviceId = includeService ? preschoolServiceSelection.serviceId : null;
    const program = globalLookups.programs.find(p => p.program_id == progId);
    const tuition = program ? parseFloat(program.tuition) : 0;

    const data = {
        student_id: currentStudentId,
        program_id: progId,
        class_id: classId,
        preferred_branch_id: document.getElementById("preferredBranch")?.value || null,
        section_id: sectionId,
        grade_level_id: document.getElementById("gradeLevelId")?.value,
        school_year_id: globalLookups.active_school_year ? globalLookups.active_school_year.school_year_id : null,
        total_of_program: tuition.toString(),
        enrollment_category: 'preschool',
        health_note: currentStudentHealthNote || null,
        include_service: includeService,
        service_id: includeService ? serviceId : null,
        is_new_student: isNewStudentEnrollment
    };
    submitEnrollment(data);
}

function sendStudentEnrollmentEmail(enrollmentId, studentId, isNewStudent) {
    return axios.post("../../api/enrolled_email.php", {
        enrollment_id: enrollmentId,
        student_id: studentId,
        is_new_student: Boolean(isNewStudent)
    }).then(res => {
        if (res.data.status !== 'success') {
            throw new Error(res.data.message || 'The enrollment email could not be sent.');
        }

        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: 'Enrollment email sent',
            text: isNewStudent
                ? 'The new student received their login credentials.'
                : 'The existing student received their enrollment confirmation.',
            showConfirmButton: false,
            timer: 3500,
            timerProgressBar: true
        });
    }).catch(err => {
        console.error('Enrollment email error:', err);
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'warning',
            title: 'Enrollment saved, but email failed',
            text: err.response?.data?.message || err.message || 'Please try sending the welcome email again.',
            showConfirmButton: false,
            timer: 5000,
            timerProgressBar: true
        });
    });
}

function submitEnrollment(payload) {
    const operation = pendingDownpaymentEnrollment?.enrollment_id
        ? "completePendingEnrollment"
        : "addEnrollment";

    const requestPayload = pendingDownpaymentEnrollment?.enrollment_id
        ? {
            ...payload,
            pending_enrollment_id: pendingDownpaymentEnrollment.enrollment_id,
            program_id: pendingDownpaymentEnrollment.program_id || payload.program_id,
            is_new_student: isNewStudentEnrollment
        }
        : payload;

    axios.post("../../api/admin/enrollment.php", {
        operation,
        json: JSON.stringify(requestPayload)
    }).then(res => {
        console.log("Enrollment API Response:", res.data);
        if(res.data.status === "success") {
            console.log("Entering success branch");
            console.log("Enrollment ID from API:", res.data.enrollment_id);
            // Validate that enrollment_id is present
            if (!res.data.enrollment_id) {
                console.error("No enrollment_id returned from API");
                Swal.fire("Error", "Enrollment created but billing details could not be loaded. Please refresh and try viewing billing manually.", "error");
                return;
            }

            sendStudentEnrollmentEmail(
                res.data.enrollment_id,
                requestPayload.student_id,
                requestPayload.is_new_student
            );

            downpaymentCollectedDetails = null;
            pendingDownpaymentEnrollment = null;
            pendingEnrollmentDetails = null;
            preschoolServiceSelection = {
                include: false,
                serviceId: null,
                serviceName: null,
                serviceAmount: 0,
                programId: null
            };
            
            const enrollmentDetailsModal = document.getElementById('enrollmentDetailsModal');
    const enrollmentDetailsInstance = getBootstrapModal(enrollmentDetailsModal);
    if (enrollmentDetailsInstance) enrollmentDetailsInstance.hide();
            
            if (requestPayload.enrollment_category === 'preschool') {
                window.openBillingPlayPreModal(res.data.enrollment_id, false);
            } else {
                window.openBillingModal(res.data.enrollment_id, true);
            }
        } else {
            console.log("Entering error branch");
            showEnrollmentServerError('Enrollment Details Need Attention', res.data.message);
        }
    }).catch(err => {
        console.error("Axios error:", err);
        showEnrollmentServerError(
            'Unable to Save Enrollment',
            err.response?.data?.message || err.message,
            'A network error occurred. Please review the highlighted fields and try again.'
        );
    });
}

// showBillingStatementAfterEnrollment removed - use billing.js openBillingModal(id, true) instead

// --- DOWNPAYMENT FLOW ---

function getProgramTypeName(program) {
    if (!program) return '';
    if (program.type_name) return program.type_name;
    const typeObj = (globalLookups.program_types || []).find(pt => pt.program_type_id == program.program_type);
    return typeObj ? typeObj.type : '';
}

function getProgramDisplayName(program) {
    if (!program) return 'Program';
    const typeName = getProgramTypeName(program);
    return typeName ? `${program.name} (${typeName})` : program.name;
}

function isPreschoolProgramName(name) {
    const normalized = String(name || '').toLowerCase();
    return ['preschool', 'playschool', 'pre-school', 'play-school', 'pre school', 'play school']
        .some(keyword => normalized.includes(keyword));
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[char]));
}

function formatMoney(amount) {
    return `PHP ${parseFloat(amount || 0).toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
}

function renderProgramProductsPreview(container, products) {
    if (!container) return;

    if (!Array.isArray(products) || products.length === 0) {
        container.innerHTML = '';
        container.closest('[data-program-products-section]')?.classList.add('d-none');
        return;
    }

    container.closest('[data-program-products-section]')?.classList.remove('d-none');
    const total = products.reduce((sum, item) => sum + parseFloat(item.price || 0), 0);
    container.innerHTML = `
        <div class="table-responsive">
            <table class="table table-sm table-bordered align-middle mb-2 bg-white">
                <thead class="table-light">
                    <tr>
                        <th>Item</th>
                        <th class="text-end" style="width: 160px;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${products.map(item => `
                        <tr>
                            <td>${escapeHtml(item.product_name || item.name || 'Program Item')}</td>
                            <td class="text-end">${formatMoney(item.price)}</td>
                        </tr>
                    `).join('')}
                </tbody>
                <tfoot>
                    <tr>
                        <th>Total Books / Other Fees</th>
                        <th class="text-end">${formatMoney(total)}</th>
                    </tr>
                </tfoot>
            </table>
        </div>
        <small class="text-muted">These fees are shown for reference and will be included in the program billing.</small>
    `;
}

async function loadProgramProductsPreview(programId, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.dataset.programId = programId ? String(programId) : '';
    if (!programId) {
        renderProgramProductsPreview(container, []);
        return;
    }

    container.closest('[data-program-products-section]')?.classList.add('d-none');
    container.innerHTML = '<div class="text-muted small">Loading books and other fees...</div>';

    try {
        const res = await axios.get(`../../api/admin/program_products.php?operation=getProductsByProgram&program_id=${encodeURIComponent(programId)}`);
        if (container.dataset.programId !== String(programId)) return;

        if (res.data.status === 'success') {
            renderProgramProductsPreview(container, res.data.data || []);
            return;
        }

        renderProgramProductsPreview(container, []);
    } catch (err) {
        console.error('Error loading program products:', err);
        if (container.dataset.programId === String(programId)) {
            renderProgramProductsPreview(container, []);
        }
    }
}

function getSelectedSubjectIds() {
    return [...selectedSubjectIds];
}

function getSubjectName(subjectId) {
    const subject = (globalLookups.subjects || []).find(item => String(item.subject_id) === String(subjectId));
    return subject ? subject.subject_name : `Subject ${subjectId}`;
}

function renderSelectedSubjects() {
    const list = document.getElementById('selectedSubjectsList');
    if (!list) return;

    if (selectedSubjectIds.length === 0) {
        list.innerHTML = '<span class="text-muted small">No subjects added yet.</span>';
        return;
    }

    list.innerHTML = selectedSubjectIds.map(subjectId => `
        <span class="tutorial-subject-badge">
            ${getSubjectName(subjectId)}
            <button type="button" class="btn-close btn-close-sm ms-1" aria-label="Remove ${getSubjectName(subjectId)}" onclick="removeSelectedSubject('${subjectId}')"></button>
        </span>
    `).join('');
}

window.addSelectedSubject = function() {
    const subjectSelect = document.getElementById('subjectId');
    if (!subjectSelect || !subjectSelect.value) {
        Swal.fire("Subject Required", "Please choose a subject to add.", "warning");
        return;
    }

    if (selectedSubjectIds.includes(subjectSelect.value)) {
        Swal.fire("Already Added", "That subject is already in the list.", "info");
        return;
    }

    selectedSubjectIds.push(subjectSelect.value);
    subjectSelect.value = "";
    renderSelectedSubjects();
    filterTeachers();
};

window.removeSelectedSubject = function(subjectId) {
    selectedSubjectIds = selectedSubjectIds.filter(id => String(id) !== String(subjectId));
    renderSelectedSubjects();
    filterTeachers();
}

function getProgramServiceForSelection(programId) {
    if (!programId) return null;

    if (applicationDownpaymentContext && String(applicationDownpaymentContext.application?.program_id) === String(programId)) {
        const service = applicationDownpaymentContext.application?.financial?.available_service;
        return service ? {
            service_id: service.service_id,
            service_name: service.service_name || 'Service',
            amount: parseFloat(service.amount || 0)
        } : null;
    }

    const selectedProgram = (globalLookups.programs || []).find(p => String(p.program_id) === String(programId));
    if (!selectedProgram || !selectedProgram.service_id) return null;

    const availableService = (globalLookups.services || []).find(service =>
        String(service.service_id) === String(selectedProgram.service_id) &&
        (service.status || '').toLowerCase() === 'active'
    );

    if (availableService) {
        return {
            service_id: availableService.service_id,
            service_name: availableService.service_name || 'Service',
            amount: parseFloat(availableService.amount || 0)
        };
    }

    if ((selectedProgram.default_service_status || '').toLowerCase() === 'active' && selectedProgram.default_service_name) {
        return {
            service_id: selectedProgram.service_id,
            service_name: selectedProgram.default_service_name,
            amount: parseFloat(selectedProgram.default_service_amount || 0)
        };
    }

    return null;
}

function updatePreschoolServiceSelection(programId, includeService) {
    const service = getProgramServiceForSelection(programId);
    preschoolServiceSelection = {
        include: Boolean(service && includeService),
        serviceId: service && includeService ? String(service.service_id) : null,
        serviceName: service ? service.service_name : null,
        serviceAmount: service ? parseFloat(service.amount || 0) : 0,
        programId: programId ? String(programId) : null
    };

    if (pendingDownpaymentEnrollment) {
        pendingDownpaymentEnrollment.include_service = preschoolServiceSelection.include;
        pendingDownpaymentEnrollment.service_id = preschoolServiceSelection.serviceId;
        pendingDownpaymentEnrollment.service_name = preschoolServiceSelection.serviceName;
        pendingDownpaymentEnrollment.service_amount = preschoolServiceSelection.serviceAmount;
    }
}

function prepareDownpaymentModal(studentName) {
    const modal = document.getElementById('downpaymentModal');
    if (!modal) return;

    modal.classList.add('enrollment-downpayment-modal');
    modal.querySelector('.modal-dialog')?.classList.add('modal-xl', 'modal-dialog-scrollable');

    const header = modal.querySelector('.modal-header');
    if (header) {
        header.innerHTML = `
            <div class="downpayment-heading">
                <span class="downpayment-heading-icon"><i class="bi bi-receipt-cutoff"></i></span>
                <div class="downpayment-heading-copy">
                    <h2 class="modal-title" id="downpaymentModalLabel">${applicationDownpaymentContext ? 'Receive Center Downpayment' : 'Step 2: Downpayment'}</h2>
                    <p>${applicationDownpaymentContext ? 'Review the application fees and record the required center payment.' : 'Review the selected program, fees, and payment method before continuing.'}</p>
                    <div class="downpayment-student-alert">
                        <i class="bi bi-info-circle"></i>
                        <span>Downpayment for <strong>${escapeHtml(studentName || 'Student')}</strong></span>
                    </div>
                </div>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        `;
    }

    const footer = modal.querySelector('.modal-footer');
    const closeBtn = footer?.querySelector('[data-bs-dismiss="modal"]');
    const submitBtn = document.getElementById('submitDownpayment');
    if (closeBtn) {
        closeBtn.className = 'btn downpayment-close-btn';
        closeBtn.textContent = 'Close';
    }
    if (submitBtn) {
        submitBtn.className = 'btn downpayment-submit-btn';
        submitBtn.innerHTML = '<i class="bi bi-lock"></i><span>Pay Downpayment &amp; Continue</span>';
    }

    if (document.getElementById('downpaymentModalStyles')) return;

    const style = document.createElement('style');
    style.id = 'downpaymentModalStyles';
    style.textContent = `
        #downpaymentModal.enrollment-downpayment-modal {
            --dp-accent: #e85d88;
            --dp-accent-dark: #d94f7a;
            --dp-soft: #fff0f5;
            --dp-border: #f5c6d5;
            --dp-neutral-border: #dfe3ea;
            --dp-text: #172033;
            --dp-muted: #697386;
        }
        #downpaymentModal.enrollment-downpayment-modal .modal-dialog {
            max-width: min(1060px, calc(100vw - 32px));
        }
        #downpaymentModal.enrollment-downpayment-modal .modal-content {
            border: 0;
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 0 22px 65px rgba(94, 29, 52, .18);
        }
        #downpaymentModal.enrollment-downpayment-modal .modal-header {
            position: relative;
            display: block;
            margin: 28px 28px 0;
            padding: 24px;
            border: 1px solid var(--dp-border);
            border-radius: 14px;
            background: linear-gradient(105deg, #fff 0%, #fff8fb 100%);
        }
        #downpaymentModal.enrollment-downpayment-modal .modal-header > .btn-close {
            position: absolute;
            top: -18px;
            right: -8px;
        }
        #downpaymentModal .downpayment-heading {
            display: flex;
            align-items: flex-start;
            gap: 24px;
        }
        #downpaymentModal .downpayment-heading-icon,
        #downpaymentModal .downpayment-section-icon {
            display: inline-flex;
            flex: 0 0 auto;
            align-items: center;
            justify-content: center;
            color: var(--dp-accent);
            background: var(--dp-soft);
            border-radius: 50%;
        }
        #downpaymentModal .downpayment-heading-icon {
            width: 72px;
            height: 72px;
            border: 1px solid var(--dp-border);
            font-size: 31px;
        }
        #downpaymentModal .downpayment-heading-copy {
            flex: 1 1 auto;
            min-width: 0;
        }
        #downpaymentModal .downpayment-heading h2 {
            margin: 0;
            color: var(--dp-text);
            font-size: 27px;
            font-weight: 750;
            letter-spacing: -.02em;
        }
        #downpaymentModal .downpayment-heading p {
            margin: 8px 0 17px;
            color: var(--dp-muted);
            font-size: 14px;
        }
        #downpaymentModal .downpayment-student-alert {
            display: flex;
            align-items: center;
            gap: 10px;
            min-height: 48px;
            padding: 12px 16px;
            color: var(--dp-accent-dark);
            border: 1px solid var(--dp-border);
            border-radius: 8px;
            background: #fff9fb;
        }
        #downpaymentModal.enrollment-downpayment-modal .modal-body {
            padding: 16px 28px 8px;
            background: #fff;
        }
        #downpaymentModal .downpayment-section {
            margin-bottom: 14px;
            padding: 18px;
            border: 1px solid var(--dp-border);
            border-radius: 14px;
            background: #fff;
        }
        #downpaymentModal .downpayment-section-title {
            display: flex;
            align-items: center;
            gap: 12px;
            margin: 0 0 16px;
            color: var(--dp-text);
            font-size: 18px;
            font-weight: 700;
        }
        #downpaymentModal .downpayment-section-icon {
            width: 38px;
            height: 38px;
            font-size: 17px;
        }
        #downpaymentModal .form-label {
            margin-bottom: 7px;
            color: var(--dp-text);
            font-size: 13px;
            font-weight: 500;
        }
        #downpaymentModal .form-control,
        #downpaymentModal .form-select,
        #downpaymentModal .input-group-text {
            min-height: 47px;
            border-color: var(--dp-neutral-border);
            border-radius: 8px;
            color: var(--dp-text);
            font-size: 14px;
        }
        #downpaymentModal .form-control:focus,
        #downpaymentModal .form-select:focus {
            border-color: var(--dp-accent);
            box-shadow: 0 0 0 .2rem rgba(232, 93, 136, .12);
        }
        #downpaymentModal .form-control:disabled {
            color: #4b5563;
            background: #fafafa;
            opacity: 1;
        }
        #downpaymentModal .downpayment-fee-box,
        #downpaymentModal #downpaymentProgramFee,
        #downpaymentModal #registrationFeePreview,
        #downpaymentModal #programDownpaymentPreview {
            width: 100%;
            min-height: 66px;
            padding: 10px 14px;
            color: var(--dp-accent-dark);
            border: 1px solid var(--dp-border);
            border-radius: 8px;
            background: #fff9fb;
            font-size: 27px;
            font-weight: 750;
        }
        #downpaymentModal .downpayment-due-panel {
            padding: 14px;
            border: 1px solid var(--dp-border);
            border-radius: 8px;
            background: #fff8fb;
        }
        #downpaymentModal .downpayment-due-panel .form-label {
            color: var(--dp-accent-dark);
            font-weight: 700;
        }
        #downpaymentModal .downpayment-due-panel .input-group {
            max-width: 330px;
        }
        #downpaymentModal .downpayment-due-panel .input-group-text {
            color: var(--dp-accent-dark);
            background: var(--dp-soft);
            border-color: var(--dp-border);
            border-radius: 8px 0 0 8px;
            font-size: 20px;
            font-weight: 700;
        }
        #downpaymentModal .downpayment-due-panel .form-control {
            min-height: 50px;
            color: var(--dp-accent-dark);
            background: #fff;
            border-color: var(--dp-border);
            border-radius: 0 8px 8px 0;
            font-size: 26px;
            font-weight: 750;
        }
        #downpaymentModal .downpayment-help {
            display: flex;
            align-items: flex-start;
            gap: 7px;
            margin-top: 8px;
            color: var(--dp-muted);
            font-size: 11px;
        }
        #downpaymentModal .downpayment-help i {
            color: var(--dp-accent);
        }
        #downpaymentModal .downpayment-products-wrap {
            margin-top: 14px;
        }
        #downpaymentModal .downpayment-service-card {
            padding: 14px;
            border: 1px solid var(--dp-border);
            border-radius: 8px;
            background: #fff9fb;
        }
        #downpaymentModal #downpaymentServiceContainer {
            order: 2;
        }
        #downpaymentModal .btn-check:checked + .btn {
            color: #fff;
            border-color: var(--dp-accent);
            background: var(--dp-accent);
        }
        #downpaymentModal.enrollment-downpayment-modal .modal-footer {
            justify-content: flex-end;
            gap: 12px;
            padding: 15px 28px 20px;
            border-top: 1px solid #edf0f4;
            background: #fff;
        }
        #downpaymentModal .downpayment-close-btn,
        #downpaymentModal .downpayment-submit-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 9px;
            min-height: 46px;
            padding: 10px 24px;
            border-radius: 8px;
            font-weight: 600;
        }
        #downpaymentModal .downpayment-close-btn {
            min-width: 120px;
            color: var(--dp-text);
            border: 1px solid var(--dp-neutral-border);
            background: #fff;
        }
        #downpaymentModal .downpayment-submit-btn {
            min-width: 285px;
            color: #fff;
            border: 0;
            background: linear-gradient(100deg, #e85d88, #f07ba0);
            box-shadow: 0 9px 20px rgba(232, 93, 136, .22);
        }
        #downpaymentModal .downpayment-submit-btn:hover {
            color: #fff;
            filter: brightness(.96);
        }
        @media (max-width: 767.98px) {
            #downpaymentModal.enrollment-downpayment-modal .modal-dialog {
                max-width: calc(100vw - 16px);
                margin: 8px auto;
            }
            #downpaymentModal.enrollment-downpayment-modal .modal-header {
                margin: 18px 18px 0;
                padding: 18px;
            }
            #downpaymentModal .downpayment-heading {
                gap: 13px;
            }
            #downpaymentModal .downpayment-heading-icon {
                width: 48px;
                height: 48px;
                font-size: 21px;
            }
            #downpaymentModal .downpayment-heading h2 {
                font-size: 21px;
            }
            #downpaymentModal .downpayment-heading p {
                margin-bottom: 12px;
            }
            #downpaymentModal.enrollment-downpayment-modal .modal-body {
                padding: 14px 18px 6px;
            }
            #downpaymentModal.enrollment-downpayment-modal .modal-footer {
                padding: 13px 18px 17px;
            }
            #downpaymentModal .downpayment-close-btn,
            #downpaymentModal .downpayment-submit-btn {
                flex: 1 1 auto;
                min-width: 0;
                padding-inline: 12px;
            }
        }
    `;
    document.head.appendChild(style);
}

function renderDownpaymentStep(studentName) {
    const form = document.getElementById("downpaymentForm");
    if (!form) return;
    prepareDownpaymentModal(studentName);
    form.innerHTML = '<p class="text-center text-muted"><i class="bi bi-hourglass"></i> Loading payment methods...</p>';

    const submitBtn = document.getElementById("submitDownpayment");
    if (!submitBtn) return;
    submitBtn.innerHTML = applicationDownpaymentContext
        ? '<i class="bi bi-receipt"></i><span>Record Payment &amp; Issue Receipt</span>'
        : '<i class="bi bi-lock"></i><span>Pay Downpayment &amp; Continue</span>';
    submitBtn.onclick = applicationDownpaymentContext ? handleApplicationDownpayment : handleSubmitDownpayment;
    
    const categoryName = window.currentEnrollmentCategory === 'preschool' ? 'Pre-school / Play-school' : 'Tutorial';
    const includeRegistrationFee = applicationDownpaymentContext ? true : isNewStudentEnrollment;
    const categoryPrograms = (globalLookups.programs || []).filter(p => {
        if (applicationDownpaymentContext) {
            return String(p.program_id) === String(applicationDownpaymentContext.application.program_id);
        }
        if (window.currentEnrollmentCategory === 'preschool') {
            const name = (p.name || '').toLowerCase();
            return p.program_type == 3 ||
                name.includes('preschool') ||
                name.includes('playschool') ||
                name.includes('pre-school') ||
                name.includes('play-school') ||
                name.includes('pre school') ||
                name.includes('play school');
        }

        return p.program_type == 1 || p.program_type == 2;
    });
    
    // Fetch payment methods from database
    axios.get("../../api/admin/billing.php?operation=getPaymentMethods")
        .then(res => {
            if (res.data.status === 'success' && Array.isArray(res.data.data)) {
                const paymentOptions = res.data.data.map(pm => 
                    `<option value="${pm.payment_method_id}">${pm.payment_method}</option>`
                ).join('');
                const feeColumnClass = includeRegistrationFee ? 'col-md-4' : 'col-md-6';
                
                let html = `
                    <section class="downpayment-section">
                        <h3 class="downpayment-section-title">
                            <span class="downpayment-section-icon"><i class="bi bi-mortarboard-fill"></i></span>
                            <span>Student &amp; Program</span>
                        </h3>
                        <div class="row g-3">
                        <div class="col-md-6">
                            <label class="form-label">Program Category</label>
                            <input type="text" class="form-control" value="${categoryName}" disabled>
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="downpaymentProgramInput">Program</label>
                            <select class="form-select" id="downpaymentProgramInput" required ${applicationDownpaymentContext ? 'disabled' : ''}>
                                <option value="">Select Program</option>
                                ${categoryPrograms.map(p => `<option value="${p.program_id}" data-tuition="${p.tuition || 0}" data-registration-fee="${p.registration_fee || 0}" data-downpayment="${p.downpayment || 0}" data-program-type="${getProgramTypeName(p)}">${getProgramDisplayName(p)}</option>`).join('')}
                            </select>
                        </div>
                        </div>
                    </section>

                    <section class="downpayment-section">
                        <h3 class="downpayment-section-title">
                            <span class="downpayment-section-icon"><i class="bi bi-calculator-fill"></i></span>
                            <span>Fee Overview</span>
                        </h3>
                        <div class="row g-3">
                        <div class="${feeColumnClass}">
                            <label class="form-label" for="downpaymentProgramFee">Tuition Fee</label>
                            <input type="text" class="form-control" id="downpaymentProgramFee" value="&#8369; 0.00" disabled>
                        </div>
                        ${window.currentEnrollmentCategory === 'preschool' ? `
                        <div class="col-12" id="downpaymentServiceContainer" style="display:none;">
                            <label class="form-label">Monthly Service</label>
                            <div class="downpayment-service-card">
                                <div class="d-flex justify-content-between align-items-start gap-3 mb-2">
                                    <div>
                                        <div class="fw-semibold" id="downpaymentServiceName">Service</div>
                                        <small class="text-muted" id="downpaymentServiceAmount">PHP 0.00 monthly</small>
                                    </div>
                                    <div class="btn-group btn-group-sm" role="group" aria-label="Include service">
                                        <input type="radio" class="btn-check" name="downpaymentIncludeService" id="downpaymentIncludeServiceYes" value="yes">
                                        <label class="btn btn-outline-secondary" for="downpaymentIncludeServiceYes">Yes</label>
                                        <input type="radio" class="btn-check" name="downpaymentIncludeService" id="downpaymentIncludeServiceNo" value="no" checked>
                                        <label class="btn btn-outline-secondary" for="downpaymentIncludeServiceNo">No</label>
                                    </div>
                                </div>
                                <small class="text-muted">Add this service fee to every monthly bill.</small>
                                <input type="hidden" id="downpaymentSelectedServiceId" value="">
                            </div>
                        </div>
                        ` : ''}
                        ${includeRegistrationFee ? `
                        <div class="${feeColumnClass}">
                            <label class="form-label" for="registrationFeePreview">Registration Fee</label>
                            <input type="text" class="form-control" id="registrationFeePreview" value="&#8369; 0.00" disabled>
                        </div>
                        ` : ''}
                        <div class="${feeColumnClass}">
                            <label class="form-label" for="programDownpaymentPreview">Program Downpayment</label>
                            <input type="text" class="form-control" id="programDownpaymentPreview" value="&#8369; 0.00" disabled>
                        </div>
                        </div>
                        <div class="downpayment-products-wrap d-none" data-program-products-section>
                            <label class="form-label">Books / Other Fees</label>
                            <div class="border rounded p-3 bg-light" id="downpaymentProgramProductsPreview">
                            </div>
                        </div>
                        <div class="downpayment-due-panel mt-3">
                            <label class="form-label" for="downpaymentAmountInput">Amount Due Now</label>
                            <div class="input-group">
                                <span class="input-group-text">&#8369;</span>
                                <input type="number" class="form-control" id="downpaymentAmountInput" value="0.00" step="0.01" min="0" required readonly>
                            </div>
                            <small class="downpayment-help">
                                <i class="bi bi-info-circle"></i>
                                <span>${includeRegistrationFee ? "This uses the selected program's registration fee plus downpayment." : "Existing students pay the selected program's downpayment only."}</span>
                            </small>
                        </div>
                    </section>

                    <section class="downpayment-section">
                        <h3 class="downpayment-section-title">
                            <span class="downpayment-section-icon"><i class="bi bi-credit-card-fill"></i></span>
                            <span>Payment Method</span>
                        </h3>
                        <div>
                            <label class="form-label" for="paymentMethodInput">Payment Method</label>
                            <select class="form-select" id="paymentMethodInput" required>
                                <option value="">Select Payment Method</option>
                                ${paymentOptions}
                            </select>
                            <small class="downpayment-help">Choose how the payment will be processed.</small>
                        </div>
                        <div class="mt-3" id="referenceField" style="display: none;">
                            <label class="form-label" for="transactionReferenceInput">Reference/Transaction ID <small class="text-muted">(GCash Ref #)</small></label>
                            <input type="text" class="form-control" id="transactionReferenceInput" placeholder="Enter GCash transaction ID">
                        </div>
                    </section>
                `;
                form.innerHTML = html;
                markRequiredFieldLabels(form);
                
                // Add event listener for conditional reference field
                const paymentMethodSelect = document.getElementById('paymentMethodInput');
                if (paymentMethodSelect) {
                    paymentMethodSelect.addEventListener('change', function() {
                        const refField = document.getElementById('referenceField');
                        const selectedOption = this.options[this.selectedIndex];
                        const methodName = selectedOption ? selectedOption.text.toLowerCase() : '';
                        if (refField) {
                            refField.style.display = methodName.includes('gcash') ? 'block' : 'none';
                        }
                    });
                }

                const programSelect = document.getElementById('downpaymentProgramInput');
                const serviceContainer = document.getElementById('downpaymentServiceContainer');
                const serviceName = document.getElementById('downpaymentServiceName');
                const serviceAmount = document.getElementById('downpaymentServiceAmount');
                const selectedServiceIdInput = document.getElementById('downpaymentSelectedServiceId');
                const includeServiceYes = document.getElementById('downpaymentIncludeServiceYes');
                const includeServiceNo = document.getElementById('downpaymentIncludeServiceNo');

                const syncServiceStateFromChoice = () => {
                    const currentProgramId = programSelect?.value || null;
                    updatePreschoolServiceSelection(currentProgramId, Boolean(includeServiceYes?.checked));
                };

                includeServiceYes?.addEventListener('change', syncServiceStateFromChoice);
                includeServiceNo?.addEventListener('change', syncServiceStateFromChoice);
                if (programSelect) {
                    programSelect.addEventListener('change', function() {
                        const selectedOption = this.options[this.selectedIndex];
                        const selectedProgramId = this.value;
                        const tuition = parseFloat(selectedOption?.dataset?.tuition || 0);
                        const registrationFee = includeRegistrationFee ? parseFloat(selectedOption?.dataset?.registrationFee || 0) : 0;
                        const downpayment = parseFloat(selectedOption?.dataset?.downpayment || 0);
                        const dueNow = registrationFee + downpayment;
                        const feeInput = document.getElementById('downpaymentProgramFee');
                        const registrationPreview = document.getElementById('registrationFeePreview');
                        const downpaymentPreview = document.getElementById('programDownpaymentPreview');
                        const amountInput = document.getElementById('downpaymentAmountInput');
                        if (feeInput) {
                            feeInput.value = `\u20B1 ${tuition.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                        }
                        if (registrationPreview) {
                            registrationPreview.value = `\u20B1 ${registrationFee.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                        }
                        if (downpaymentPreview) {
                            downpaymentPreview.value = `\u20B1 ${downpayment.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                        }
                        if (amountInput) {
                            amountInput.value = dueNow.toFixed(2);
                        }

                        if (window.currentEnrollmentCategory === 'preschool' && serviceContainer) {
                            const programService = getProgramServiceForSelection(selectedProgramId);
                            if (programService) {
                                const amount = parseFloat(programService.amount || 0);
                                const keepIncluded = preschoolServiceSelection.programId === String(selectedProgramId) && preschoolServiceSelection.include;

                                if (serviceName) {
                                    serviceName.textContent = programService.service_name || 'Service';
                                }
                                if (serviceAmount) {
                                    serviceAmount.textContent = `PHP ${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} monthly`;
                                }
                                if (selectedServiceIdInput) {
                                    selectedServiceIdInput.value = programService.service_id;
                                }
                                if (includeServiceYes) includeServiceYes.checked = keepIncluded;
                                if (includeServiceNo) includeServiceNo.checked = !keepIncluded;
                                serviceContainer.style.display = 'block';
                                updatePreschoolServiceSelection(selectedProgramId, keepIncluded);
                            } else {
                                serviceContainer.style.display = 'none';
                                if (selectedServiceIdInput) selectedServiceIdInput.value = '';
                                if (includeServiceYes) includeServiceYes.checked = false;
                                if (includeServiceNo) includeServiceNo.checked = true;
                                updatePreschoolServiceSelection(selectedProgramId, false);
                            }
                        }
                        loadProgramProductsPreview(this.value, 'downpaymentProgramProductsPreview');
                    });
                    if (applicationDownpaymentContext?.application?.program_id) {
                        programSelect.value = applicationDownpaymentContext.application.program_id;
                    } else if (pendingDownpaymentEnrollment?.program_id) {
                        programSelect.value = pendingDownpaymentEnrollment.program_id;
                    }

                    // Trigger change event if a program option exists to initialize fee
                    if (programSelect.options.length > 1) {
                        programSelect.dispatchEvent(new Event('change'));
                    }
                }
            } else {
                form.innerHTML = '<div class="alert alert-warning">Could not load payment methods. Please try again.</div>';
            }
        })
        .catch(err => {
            console.error('Error loading payment methods:', err);
            form.innerHTML = '<div class="alert alert-danger">Error loading payment methods. Please refresh and try again.</div>';
        });
}

export async function openApplicationDownpaymentModal(application, options = {}) {
    const modalElement = document.getElementById('downpaymentModal');
    if (!modalElement) {
        throw new Error('The shared downpayment modal is not available on this page.');
    }
    if (!application?.application_id || !application?.program_id) {
        throw new Error('The application payment details are incomplete.');
    }

    const studentName = [application.first_name, application.middle_name, application.last_name, application.ext]
        .filter(Boolean).join(' ');
    applicationDownpaymentContext = {
        application,
        studentName: studentName || 'Student',
        onSuccess: typeof options.onSuccess === 'function' ? options.onSuccess : null
    };
    window.currentEnrollmentCategory = isPreschoolProgramName(application.program_name) ? 'preschool' : 'tutorial';
    preschoolServiceSelection = {
        include: Boolean(application.financial?.service_id),
        serviceId: application.financial?.service_id ? String(application.financial.service_id) : null,
        serviceName: application.financial?.service_name || null,
        serviceAmount: parseFloat(application.financial?.service_amount || 0),
        programId: String(application.program_id)
    };

    await loadLookups();
    if (!(globalLookups.programs || []).some(program => String(program.program_id) === String(application.program_id))) {
        applicationDownpaymentContext = null;
        throw new Error('The application program is no longer available in the enrollment lookup.');
    }
    Swal.close();
    getBootstrapModal(modalElement)?.show();
}

async function handleApplicationDownpayment() {
    const context = applicationDownpaymentContext;
    if (!context) return;

    const amountInput = document.getElementById('downpaymentAmountInput');
    const methodInput = document.getElementById('paymentMethodInput');
    const referenceInput = document.getElementById('transactionReferenceInput');
    const programInput = document.getElementById('downpaymentProgramInput');
    const amount = parseFloat(amountInput?.value || 0);
    const methodId = methodInput?.value || '';
    const methodName = methodInput?.options[methodInput.selectedIndex]?.text || 'Payment';
    const referenceNo = referenceInput?.value?.trim() || null;
    const includeService = window.currentEnrollmentCategory === 'preschool'
        && preschoolServiceSelection.programId === String(context.application.program_id)
        && preschoolServiceSelection.include;
    const serviceId = includeService ? preschoolServiceSelection.serviceId : null;
    const form = document.getElementById('downpaymentForm');
    clearEnrollmentValidation(form || document);

    const issues = [];
    if (!programInput?.value) issues.push({ element: programInput, message: 'Program is required.' });
    if (!amount || amount <= 0) issues.push({ element: amountInput, message: 'Enter a valid downpayment amount.' });
    if (!methodId) issues.push({ element: methodInput, message: 'Payment method is required.' });
    if (methodName.toLowerCase().includes('gcash') && !referenceNo) {
        issues.push({ element: referenceInput, message: 'GCash reference number is required.' });
    }
    if (issues.length) {
        showEnrollmentValidationAlert('Payment Details Need Attention', issues);
        return;
    }

    const submitButton = document.getElementById('submitDownpayment');
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Recording Payment...';
    }

    try {
        const body = new URLSearchParams();
        body.set('operation', 'collectDownpayment');
        body.set('json', JSON.stringify({
            application_id: context.application.application_id,
            payment_method_id: methodId,
            reference_no: referenceNo,
            amount,
            include_service: includeService,
            service_id: serviceId
        }));
        const response = await axios.post('../../api/enrollment_application.php', body);
        if (response.data.status !== 'success') {
            throw new Error(response.data.message || 'Unable to record the application downpayment.');
        }

        const result = response.data;
        getBootstrapModal(document.getElementById('downpaymentModal'))?.hide();
        await showPaymentReceipt({
            enrollmentId: result.enrollment_details_id,
            studentName: result.student_name || context.studentName,
            programName: result.program_name || context.application.program_name,
            service: 'Initial Enrollment Payment',
            paymentType: 'Downpayment',
            paymentFor: 'Registration Fee and Downpayment',
            paymentMethod: result.payment_method || methodName,
            referenceNo: result.reference_no,
            receiptNo: result.receipt_id,
            amountPaid: result.amount_paid,
            balance: result.balance,
            totalAmount: result.amount_paid,
            lineItems: result.line_items || [],
            paymentDate: new Date()
        });
        await context.onSuccess?.(result);
    } catch (error) {
        Swal.fire('Payment Failed', error.response?.data?.message || error.message, 'error');
    } finally {
        if (submitButton?.isConnected) {
            submitButton.disabled = false;
            submitButton.innerHTML = '<i class="bi bi-receipt"></i><span>Record Payment &amp; Issue Receipt</span>';
        }
    }
}

async function handleSubmitDownpayment() {
    const amountInput = document.getElementById("downpaymentAmountInput");
    const methodInput = document.getElementById("paymentMethodInput");
    const programInput = document.getElementById("downpaymentProgramInput");
    const referenceInput = document.getElementById("transactionReferenceInput");
    
    const amount = parseFloat(amountInput.value);
    const method = methodInput.value;
    const programId = programInput?.value;
    const methodName = methodInput.options[methodInput.selectedIndex]?.text || 'Payment';
    const referenceNo = referenceInput?.value?.trim() || null;
    const selectedProgram = (globalLookups.programs || []).find(p => p.program_id == programId);
    const includeService = window.currentEnrollmentCategory === 'preschool' &&
        preschoolServiceSelection.programId === String(programId) &&
        preschoolServiceSelection.include;
    const serviceId = includeService ? preschoolServiceSelection.serviceId : null;
    const downpaymentForm = document.getElementById('downpaymentForm');
    clearEnrollmentValidation(downpaymentForm || document);
    const validationIssues = [];
    if (!programId) {
        validationIssues.push({ element: programInput, message: 'Program is required.' });
    }
    if (!amount || amount <= 0) {
        validationIssues.push({ element: amountInput, message: 'Enter a valid downpayment amount.' });
    }
    if (!method) {
        validationIssues.push({ element: methodInput, message: 'Payment method is required.' });
    }
    if (methodName.toLowerCase().includes('gcash') && !referenceNo) {
        validationIssues.push({ element: referenceInput, message: 'GCash reference number is required.' });
    }
    if (validationIssues.length > 0) {
        showEnrollmentValidationAlert('Payment Details Need Attention', validationIssues);
        return;
    }
    
    const submitBtn = document.getElementById("submitDownpayment");
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Saving Payment...';
    }

    try {
        const res = await axios.post("../../api/admin/enrollment.php", {
            operation: "createPendingDownpaymentEnrollment",
            json: JSON.stringify({
                student_id: currentStudentId,
                program_id: programId,
                enrollment_category: window.currentEnrollmentCategory || 'tutorial',
                school_year_id: globalLookups.active_school_year ? globalLookups.active_school_year.school_year_id : null,
                is_new_student: isNewStudentEnrollment,
                include_service: includeService,
                service_id: serviceId,
                amount,
                method,
                ref: referenceNo
            })
        });

        if (res.data.status !== "success") {
            Swal.fire("Error", res.data.message || "Unable to save downpayment.", "error");
            return;
        }

        pendingDownpaymentEnrollment = {
            enrollment_id: res.data.enrollment_id,
            program_id: res.data.program_id || programId,
            program_name: res.data.program_display_name || getProgramDisplayName(selectedProgram),
            program_type: res.data.program_type || getProgramTypeName(selectedProgram),
            include_service: includeService,
            service_id: serviceId,
            service_name: preschoolServiceSelection.serviceName,
            service_amount: preschoolServiceSelection.serviceAmount
        };
        downpaymentCollectedDetails = null;

        const downpaymentModal = document.getElementById('downpaymentModal');
        const downpaymentInstance = getBootstrapModal(downpaymentModal);
        if (downpaymentInstance) downpaymentInstance.hide();

        await showPaymentReceipt({
            enrollmentId: res.data.enrollment_id,
            studentName: res.data.student_name || enrollmentStudentName,
            programName: res.data.program_display_name || getProgramDisplayName(selectedProgram),
            programType: res.data.program_type || getProgramTypeName(selectedProgram),
            service: 'Downpayment',
            paymentType: 'Downpayment',
            paymentKind: 'Downpayment',
            paymentFor: 'Enrollment downpayment',
            paymentMethod: res.data.payment_method || methodName,
            referenceNo: res.data.reference_no || referenceNo,
            receiptNo: res.data.receipt_id || null,
            amountPaid: amount,
            balance: parseFloat(res.data.balance || 0),
            totalAmount: amount,
            lineItems: [
                ...(parseFloat(res.data.registration_fee || 0) > 0 ? [{ label: 'Registration Fee', amount: parseFloat(res.data.registration_fee || 0) }] : []),
                ...(parseFloat(res.data.downpayment_amount || 0) > 0 ? [{ label: 'Downpayment', amount: parseFloat(res.data.downpayment_amount || 0) }] : [])
            ],
            paymentDate: new Date()
        });

        const enrollmentDetailsModal = document.getElementById('enrollmentDetailsModal');
        switchModal(null, enrollmentDetailsModal);
    } catch (err) {
        console.error("Downpayment save error:", err);
        Swal.fire("Error", "Network error occurred while saving downpayment.", "error");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="bi bi-lock"></i><span>Pay Downpayment &amp; Continue</span>';
        }
    }
}

// --- UTILITIES ---

function generateOptions(dataArray, valueKey, textKey, selectedValue = '') {
    if (!Array.isArray(dataArray)) return "";
    return dataArray.map(item => {
        const selected = item[valueKey] == selectedValue ? ' selected' : '';
        return `<option value="${item[valueKey]}"${selected}>${item[textKey]}</option>`;
    }).join('');
}

function getActiveTeachers() {
    if (!Array.isArray(globalLookups.teachers)) return [];
    return globalLookups.teachers.filter(teacher => {
        const status = (teacher.status || 'active').toString().toLowerCase();
        return status === 'active';
    });
}

function generateOptionsWithType(dataArray, valueKey, textKey, typeKey, selectedValue = '') {
    if (!Array.isArray(dataArray)) return "";
    return dataArray.map(item => {
        const typeObj = globalLookups.program_types.find(pt => pt.program_type_id == item[typeKey]);
        const typeName = typeObj ? typeObj.type : item[typeKey];
        const selected = item[valueKey] == selectedValue ? ' selected' : '';
        return `<option value="${item[valueKey]}"${selected}>${item[textKey]} (${typeName})</option>`;
    }).join('');
}



window.addSchedule = function() {
    const dateInput = document.getElementById("schedDate").value;
    const timeInput = document.getElementById("schedTime").value;
    const endTimeInput = document.getElementById("schedEndTime").value;

    if (!dateInput || !timeInput || !endTimeInput) {
        const issues = [];
        if (!dateInput) {
            issues.push({ element: document.getElementById('schedDateInput'), message: 'Schedule date is required.' });
        }
        if (!timeInput) {
            issues.push({ element: document.getElementById('schedTime'), message: 'Start time is required.' });
        }
        if (!endTimeInput) {
            issues.push({ element: document.getElementById('schedEndTime'), message: 'End time is required.' });
        }
        showEnrollmentValidationAlert('Schedule Details Need Attention', issues);
        return;
    }

    // Validate end time after start time
    if (endTimeInput <= timeInput) {
        showEnrollmentValidationAlert('Invalid Time', [{
            element: document.getElementById('schedEndTime'),
            message: 'End time must be after start time.'
        }]);
        return;
    }

    // Validate teacher availability
    const teacherId = document.getElementById("preferredTeacher").value;
    if (teacherId) {
        const available = window.teacherAvailableSlotsPerDate[dateInput];
        if (!available) {
            showEnrollmentValidationAlert('Date Not Available', [{
                element: document.getElementById('schedDateInput'),
                message: 'This date is not available for the selected teacher.'
            }]);
            return;
        }
        const start = parseTimeToMinutes(timeInput);
        const end = parseTimeToMinutes(endTimeInput);
        const overlaps = available.some(a => {
            const aStart = parseTimeToMinutes(a.start);
            const aEnd = parseTimeToMinutes(a.end);
            return start < aEnd && end > aStart;
        });
        if (!overlaps) {
            const message = 'The selected time is not within the available slots for this teacher on this date.';
            showEnrollmentValidationAlert('Time Not Available', [
                { element: document.getElementById('schedTime'), message },
                { element: document.getElementById('schedEndTime'), message }
            ]);
            return;
        }
    }

    // Check for duplicate schedule
    const isDuplicate = preferredSchedules.some(s => s.date === dateInput && s.time === timeInput && s.endTime === endTimeInput);
    if (isDuplicate) {
        const message = 'This schedule has already been added. Please choose a different date or time.';
        showEnrollmentValidationAlert('Duplicate Schedule', [
            { element: document.getElementById('schedDateInput'), message },
            { element: document.getElementById('schedTime'), message },
            { element: document.getElementById('schedEndTime'), message }
        ]);
        return;
    }

    const dateObj = new Date(dateInput);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[dateObj.getDay()];

    const nextSchedule = { date: dateInput, day: dayName, time: timeInput, endTime: endTimeInput };
    const nextValidation = getSelectedProgramScheduleRequirement([...preferredSchedules, nextSchedule]);
    if (nextValidation.applicable && nextValidation.differenceMinutes < 0) {
        showScheduleRequirementAlert(nextValidation, "Too Many Session Units");
        return;
    }

    preferredSchedules.push(nextSchedule);
    preferredSchedules.sort((a, b) => new Date(a.date + ' ' + a.time) - new Date(b.date + ' ' + b.time));
    renderScheduleList();
    updateProgramSchedulePreview();

    const selectedTeacherId = document.getElementById("preferredTeacher")?.value || '';
    if (selectedTeacherId) {
        onTeacherChange();
    } else {
        filterTeachers();
    }
    
    // Only clear the selected date; keep the previous time values
    document.getElementById("schedDate").value = "";
    document.getElementById("schedDateInput").value = "";
};

function renderScheduleList() {
    const tbody = document.getElementById("scheduleListBody");
    tbody.innerHTML = "";

    if (preferredSchedules.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted"><i class="bi bi-calendar3 me-2"></i>No schedule preferences added yet.</td></tr>';
        return;
    }

    preferredSchedules.forEach((item, index) => {
        tbody.innerHTML += `
            <tr>
                <td>${item.date}</td>
                <td><span class="badge bg-secondary">${item.day}</span></td>
                <td>${formatTime(item.time)} - ${formatTime(item.endTime)}</td>
                <td class="text-center">
                    <button type="button" class="btn btn-sm btn-outline-danger" onclick="removeSchedule(${index})">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });
}

window.removeSchedule = function(index) {
    preferredSchedules.splice(index, 1);
    renderScheduleList();
    updateProgramSchedulePreview();

    const selectedTeacherId = document.getElementById("preferredTeacher")?.value || '';
    if (selectedTeacherId) {
        onTeacherChange();
    } else {
        filterTeachers();
    }
};

function handleSearch() {
    const query = document.getElementById('studentSearch').value;
    axios.get(`../../api/admin/enrollment.php?operation=searchStudents&query=${encodeURIComponent(query)}`)
        .then(res => {
            let html = '<ul class="list-group shadow-sm">';
            if (Array.isArray(res.data)) {
                res.data.forEach(s => {
                    const fullName = formatStudentName(s);
                    const safeName = fullName.replace(/'/g, "\\'");
                    html += `<li class="list-group-item d-flex justify-content-between align-items-center">
                        <div>
                            <div class="fw-semibold">${fullName}</div>
                            <small class="text-muted">School ID: ${s.student_id_number || 'Not assigned'}</small>
                        </div>
                        <button class="btn btn-sm student-select-btn" onclick="selectStudent(${s.student_id}, '${safeName}')">Select</button>
                    </li>`;
                });
            }

            if (html === '<ul class="list-group shadow-sm">') {
                html += '<li class="list-group-item text-muted">No students found.</li>';
            }

            document.getElementById('searchResults').innerHTML = html + '</ul>';
        });
}

function selectStudent(id, name) {
    const sid = Number(id);
    if (!Number.isInteger(sid) || sid <= 0) {
        Swal.fire('Error', 'Invalid student selected. Please choose another student.', 'error');
        return;
    }
    currentStudentId = sid;
    enrollmentStudentId = sid;
    enrollmentStudentName = name;
    currentStudentHealthNote = null; // Clear any previously entered health note
    isNewStudentEnrollment = false;
    const addEnrollmentModal = document.getElementById('addEnrollmentModal');
    const downpaymentModal = document.getElementById('downpaymentModal');
    switchModal(addEnrollmentModal, downpaymentModal);
}

window.selectStudent = selectStudent;
