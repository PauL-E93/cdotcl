let globalLookups = {};
let preferredSchedules = [];
let selectedSubjectIds = [];
let selectedTuition = 0;
let teacherAvailableSlots = []; // Store selected teacher's available schedule slots
let teacherBookedSlots = []; // Store teacher's already-booked schedule slots
let teacherAvailableDates = []; // Store permitted schedule dates for selected teacher
let teacherAvailableSlotsPerDate = {}; // {date: [{start: '13:00', end: '17:00'}]}
let teacherFullShiftsPerDate = {}; // {date: {start: '13:00', end: '17:00'}}

// Downpayment tracking
let currentEnrollmentId = null;
let downpaymentCollectedDetails = null;
let pendingDownpaymentEnrollment = null;
let pendingEnrollmentDetails = null;
const STUDENT_PENDING_ENROLLMENT_COMPLETION_KEY = 'studentPendingEnrollmentCompletion';

// Get the Student ID from the hidden input
const LOGGED_IN_STUDENT_ID = document.getElementById('loggedInStudentId') ? document.getElementById('loggedInStudentId').value : null;

document.addEventListener("DOMContentLoaded", () => {
    // Preload billing.js
    if (!document.querySelector('script[src*=\"billing.js\"]')) {
        const billingScript = document.createElement('script');
        billingScript.src = '../../js/studentmodule/billing.js';
        document.head.appendChild(billingScript);
    }
    
    // 1. Target the Enrollment Details Modal
    const enrollmentModal = document.getElementById('enrollmentDetailsModal');
    
    if (enrollmentModal) {
        // 2. Add Event Listener: Run this code ONLY when modal opens
        enrollmentModal.addEventListener('show.bs.modal', () => {
            // Load lookups, THEN render the form
            loadLookups().then(() => {
                renderEnrollmentForm();
            });
        });
    }

    // 2. Target the Downpayment Modal
    const downpaymentModal = document.getElementById('downpaymentModal');
    if (downpaymentModal) {
        downpaymentModal.addEventListener('show.bs.modal', () => {
            pendingDownpaymentEnrollment = null;
            loadLookups().then(() => {
                renderDownpaymentStep();
            });
        });
    }

    // 3. Attach Finalize Button Listener (located in the modal footer)
    const submitBtn = document.getElementById('finalizeEnrollment');
    if(submitBtn) {
        submitBtn.addEventListener('click', submitEnrollment);
    }

    // 4. Attach Downpayment Button Listener
    const downpaymentBtn = document.getElementById('submitDownpayment');
    if(downpaymentBtn) {
        downpaymentBtn.addEventListener('click', handleSubmitDownpayment);
    }

    resumePendingEnrollmentCompletionRequest();
});

function loadLookups() {
    return axios.get("../../api/admin/enrollment.php?operation=getLookups")
        .then(res => { globalLookups = res.data; })
        .catch(err => console.error("Error loading lookups:", err));
}

function getStudentReceiptHandler() {
    return typeof window.showPaymentReceipt === 'function'
        ? (receipt) => window.showPaymentReceipt({
            ...receipt,
            copyLabels: ['CUSTOMER COPY']
        })
        : null;
}

function ensureStudentPaymentOcrHelpers() {
    if (typeof window.attachGcashOcrAutoFill === 'function') {
        return Promise.resolve();
    }

    if (window.__studentBillingScriptPromise) {
        return window.__studentBillingScriptPromise;
    }

    window.__studentBillingScriptPromise = new Promise((resolve, reject) => {
        const existingScript = document.querySelector('script[src*="studentmodule/billing.js"]');

        if (existingScript) {
            existingScript.addEventListener('load', () => {
                if (typeof window.attachGcashOcrAutoFill === 'function') {
                    resolve();
                    return;
                }

                reject(new Error('Billing OCR helpers are unavailable after script load.'));
            }, { once: true });
            existingScript.addEventListener('error', () => reject(new Error('Unable to load billing OCR helpers.')), { once: true });

            // In case the script already finished loading before listeners were attached.
            setTimeout(() => {
                if (typeof window.attachGcashOcrAutoFill === 'function') {
                    resolve();
                }
            }, 0);
            return;
        }

        const script = document.createElement('script');
        script.src = '../../js/studentmodule/billing.js';
        script.onload = () => {
            if (typeof window.attachGcashOcrAutoFill === 'function') {
                resolve();
                return;
            }

            reject(new Error('Billing OCR helpers are unavailable after script load.'));
        };
        script.onerror = () => reject(new Error('Unable to load billing OCR helpers.'));
        document.head.appendChild(script);
    });

    return window.__studentBillingScriptPromise;
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

function escapeHtml(value) {
    return (value || '').toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatMoney(amount) {
    return `PHP ${parseFloat(amount || 0).toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
}

function renderProgramProductsPreview(container, products, emptyMessage = 'No books or other fees assigned to this program.') {
    if (!container) return;

    const section = container.closest('[data-program-products-section]');

    if (!Array.isArray(products) || products.length === 0) {
        container.innerHTML = '';
        section?.classList.add('d-none');
        return;
    }

    section?.classList.remove('d-none');
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

    if (!programId) {
        renderProgramProductsPreview(container, [], 'Select a program to view books and other fees.');
        return;
    }

    container.dataset.programId = String(programId);
    renderProgramProductsPreview(container, []);
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

        let label = field.id ? container.querySelector(`label[for="${field.id}"]`) : null;
        if (!label) {
            const wrapper = field.closest('.mb-3, .col-md-1, .col-md-3, .col-md-4, .col-md-6, .col-md-12');
            label = wrapper?.querySelector('label.form-label') || null;
        }

        if (!label || label.querySelector('.required-field-indicator')) return;

        label.insertAdjacentHTML('beforeend', ' <span class="text-danger required-field-indicator" aria-hidden="true">*</span>');
    });
}

async function openPendingEnrollmentCompletion(enrollmentId, category = 'tutorial') {
    if (!enrollmentId) {
        Swal.fire('Error', 'Enrollment ID is missing.', 'error');
        return;
    }

    const enrollmentModal = document.getElementById('enrollmentDetailsModal');
    if (!enrollmentModal) {
        sessionStorage.setItem(STUDENT_PENDING_ENROLLMENT_COMPLETION_KEY, JSON.stringify({
            enrollmentId,
            category: category === 'preschool' ? 'preschool' : 'tutorial'
        }));
        window.location.href = './enrollement.html';
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

        pendingDownpaymentEnrollment = {
            enrollment_id: enrollmentId,
            program_id: details.program_id,
            program_name: details.program_name || 'Program'
        };
        pendingEnrollmentDetails = details;
        selectedSubjectIds = [];
        if (details.subject_ids) {
            const rawSubjects = Array.isArray(details.subject_ids) ? details.subject_ids : String(details.subject_ids).split(',');
            selectedSubjectIds = rawSubjects
                .map(id => parseInt(id, 10))
                .filter(id => id > 0)
                .map(String);
        }
        window.currentEnrollmentCategory = category === 'preschool' ? 'preschool' : 'tutorial';

        if (enrollmentModal) {
            const modal = bootstrap.Modal.getOrCreateInstance(enrollmentModal);
            modal.show();
        }
    } catch (err) {
        console.error('Error opening incomplete enrollment:', err);
        Swal.fire('Error', 'Network error occurred while loading the incomplete enrollment.', 'error');
    }
}

window.openPendingEnrollmentCompletion = openPendingEnrollmentCompletion;

function resumePendingEnrollmentCompletionRequest() {
    const rawRequest = sessionStorage.getItem(STUDENT_PENDING_ENROLLMENT_COMPLETION_KEY);
    if (!rawRequest) {
        return;
    }

    sessionStorage.removeItem(STUDENT_PENDING_ENROLLMENT_COMPLETION_KEY);

    try {
        const request = JSON.parse(rawRequest);
        if (request?.enrollmentId) {
            openPendingEnrollmentCompletion(request.enrollmentId, request.category || 'tutorial');
        }
    } catch (error) {
        console.error('Unable to resume pending enrollment completion request:', error);
    }
}

function renderEnrollmentForm() {
    preferredSchedules = [];
    if (!pendingEnrollmentDetails) {
        selectedSubjectIds = [];
    }
    
    // TARGET THE FORM INSIDE THE MODAL
    const container = document.getElementById("enrollmentForm"); 
    
    if (!container) return; 

    const today = new Date().toISOString().split('T')[0];
    
    // FILTER ONLY TUTORIALS (program_type 1 or 2)
    const tutorials = (globalLookups.programs || []).filter(p => p.program_type == 1 || p.program_type == 2);
    const gradeLevels = globalLookups.grade_levels || [];
    const subjects = globalLookups.subjects || [];
    const teachers = globalLookups.teachers || [];

    // Fetch branches and the student's last enrolled branch (if logged in)
    let branches = [];
    let studentBranchName = null;
    let studentProfile = null;
    const branchesPromise = axios.get("../../api/admin/branch.php?operation=getBranches").then(r => { branches = r.data || []; }).catch(() => { branches = []; });
    const studentBranchPromise = LOGGED_IN_STUDENT_ID
        ? axios.get(`../../api/admin/enrollment.php?operation=getStudentBranch&student_id=${LOGGED_IN_STUDENT_ID}`)
            .then(r => { if(r.data && r.data.status === 'success') studentBranchName = r.data.branch_name; })
            .catch(() => { studentBranchName = null; })
        : Promise.resolve();
    const studentProfilePromise = LOGGED_IN_STUDENT_ID
        ? axios.get(`../../api/admin/student.php?operation=getStudentProfile&student_id=${LOGGED_IN_STUDENT_ID}`)
            .then(r => { if (r.data && r.data.status === 'success') studentProfile = r.data.data || null; })
            .catch(() => { studentProfile = null; })
        : Promise.resolve();

    Promise.all([branchesPromise, studentBranchPromise, studentProfilePromise]).then(() => {
        const enrollmentHeaderHtml = pendingDownpaymentEnrollment
            ? '<div class="alert alert-info"><i class="bi bi-check-circle"></i> Downpayment already paid. Complete your enrollment details below.</div>'
            : '<div class="alert alert-success"><i class="bi bi-mortarboard"></i> <strong>Tutorial Enrollment</strong></div>';

        const selectedPendingProgram = pendingDownpaymentEnrollment && pendingDownpaymentEnrollment.program_id
            ? globalLookups.programs.find(p => p.program_id == pendingDownpaymentEnrollment.program_id)
            : null;
        const selectedPendingProgramType = selectedPendingProgram
            ? globalLookups.program_types?.find(pt => pt.program_type_id == selectedPendingProgram.program_type)
            : null;
        const selectedPendingProgramLabel = selectedPendingProgram
            ? `${selectedPendingProgram.name} (${selectedPendingProgramType ? selectedPendingProgramType.type : selectedPendingProgram.program_type})`
            : '';

        const programFieldHtml = pendingDownpaymentEnrollment && pendingDownpaymentEnrollment.program_id
            ? `
                <input type="hidden" id="programId" value="${pendingDownpaymentEnrollment.program_id}" />
                <div class="form-control bg-light text-muted" disabled>${selectedPendingProgramLabel}</div>
              `
            : `
                <select class="form-select" id="programId" required onchange="filterTeachers()">
                    <option value="">Select Tutorial</option>
                    ${generateOptionsWithType(tutorials, 'program_id', 'name', 'program_type')}
                </select>
              `;

        let html = `
        ${enrollmentHeaderHtml}
        <div class="row">
            <div class="col-md-6 mb-3">
                <label class="form-label">Tutorial Program</label>
                ${programFieldHtml}
            </div>
            <div class="col-md-6 mb-3">
                <label class="form-label">Grade Level</label>
                <select class="form-select" id="gradeLevelId" required>
                     <option value="">Select Grade</option>
                     ${generateOptions(gradeLevels, 'grade_level_id', 'grade_level')}
                </select>
            </div>
            <div class="col-md-6 mb-3">
                <label class="form-label">Subjects <span class="text-danger" aria-hidden="true">*</span></label>
                <div class="input-group">
                    <select class="form-select" id="subjectId">
                         <option value="">Select Subject</option>
                         ${generateOptions(subjects, 'subject_id', 'subject_name')}
                    </select>
                    <button type="button" class="btn btn-outline-primary" onclick="addSelectedSubject()">
                        <i class="bi bi-plus-lg"></i> Add
                    </button>
                </div>
                <div id="selectedSubjectsList" class="mt-2 d-flex flex-wrap gap-2">
                    <span class="text-muted small">No subjects added yet.</span>
                </div>
            </div>
            
            <div class="col-md-6 mb-3">
                <label class="form-label">Select your preferred branch</label>
                <select class="form-select" id="preferredBranch" required onchange="filterTeachers()">
                    <option value="">Select Branch</option>
                    ${generateBranchOptions(branches, studentBranchName)}
                </select>
            </div>

            <div class="col-md-6 mb-3">
                <label class="form-label">School Year</label>
                <input type="text" class="form-control" disabled value="${globalLookups.active_school_year ? globalLookups.active_school_year.school_year : 'No active school year'}">
            </div>

            <div class="col-md-6 mb-3">
                <label class="form-label">Teacher <small class="text-muted">(Filtered)</small></label>
                <select class="form-select" id="preferredTeacher" required onchange="onTeacherChange()" disabled>
                     <option value="">Select branch, program, and subject first</option>
                     ${generateOptions(teachers, 'employee_id', 'name')}
                </select>
            </div>
        </div>

        <div class="col-md-12 mb-3">
            <label class="form-label">Your Learning Goal</label>
            <textarea class="form-control" id="goal" rows="2" placeholder="Describe what you want to achieve..."></textarea>
        </div>

        <div class="col-md-12 mb-3" id="studentUnitPreview" style="display:none;">
            <div class="alert alert-info">
                <strong>Required Units:</strong> <span id="requiredUnits">-</span> | 
                <strong>Current Schedule Units:</strong> <span id="currentUnits">0</span> 
                <span id="unitStatus" class="badge bg-warning ms-2">Needs more</span>
            </div>
        </div>

        <hr>
        <h6 class="text-primary mb-3">Schedule Preferences</h6>
        <div class="card p-3 bg-light mb-3">
            <div class="row align-items-end">
                <div class="col-md-4 mb-2 position-relative">
                    <label class="form-label small fw-bold">Select Date</label>
                    <div class="input-group">
                        <input type="text" class="form-control" id="schedDateInput" placeholder="Click to pick date" readonly>
                        <input type="hidden" id="schedDate">
                        <button class="btn btn-outline-secondary" type="button" id="datePickerBtn" title="Open Calendar">
                            <i class="bi bi-calendar3"></i>
                        </button>
                    </div>
                    <div id="dateCalendarContainer" style="display:none; position:absolute; top:100%; left:0; width:100%; z-index:1050;"></div>
                </div>
                <div class="col-md-4 mb-2">
                    <label class="form-label small fw-bold">Start Time</label>
                    <input type="time" class="form-control" id="schedTime">
                </div>
                <div class="col-md-3 mb-2">
                    <label class="form-label small fw-bold">End Time</label>
                    <input type="time" class="form-control" id="schedEndTime">
                </div>
                <div class="col-md-1 mb-2">
                    <button type="button" class="btn btn-success w-100" onclick="addSchedule()">
                        <i class="bi bi-plus-lg"></i> Add
                    </button>
                </div>
            </div>
            
            <div class="mt-3">
                <table class="table table-sm table-bordered bg-white">
                    <thead class="table-light">
                        <tr>
                            <th>Date</th>
                            <th>Day</th>
                            <th>Start - End</th>
                            <th style="width: 50px;">Action</th>
                        </tr>
                    </thead>
                    <tbody id="scheduleListBody">
                        <tr><td colspan="4" class="text-center text-muted">No schedule preferences added yet.</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
        // APPEND THE HTML
        container.innerHTML = html;
        markRequiredFieldLabels(container);
        renderSelectedSubjects();

        if (pendingEnrollmentDetails) {
            const gradeSelect = document.getElementById('gradeLevelId');
            const branchSelect = document.getElementById('preferredBranch');
            const goalInput = document.getElementById('goal');
            if (gradeSelect && pendingEnrollmentDetails.grade_level_id) {
                gradeSelect.value = pendingEnrollmentDetails.grade_level_id;
            }
            if (branchSelect && pendingEnrollmentDetails.preferred_branch_id) {
                branchSelect.value = pendingEnrollmentDetails.preferred_branch_id;
            }
            if (goalInput && pendingEnrollmentDetails.goal) {
                goalInput.value = pendingEnrollmentDetails.goal;
            }
        }
    
    if (pendingDownpaymentEnrollment && pendingDownpaymentEnrollment.program_id) {
        const programSelect = document.getElementById('programId');
        if (programSelect) {
            programSelect.value = pendingDownpaymentEnrollment.program_id;
            const program = globalLookups.programs.find(p => p.program_id == pendingDownpaymentEnrollment.program_id);
            selectedTuition = program ? parseFloat(program.tuition) : 0;
            updateStudentUnitPreview();
        }
    }

    if (document.getElementById('programId')?.value && selectedSubjectIds.length > 0) {
        filterTeachers();
    }

    // Import and setup date picker
    import('./studentDatePicker.js').then(module => {
        module.initStudentDatePicker();
    }).catch(err => {
        console.error('Date picker module load error:', err);
    });

    // Auto-load teacher dates on teacher change
    window.addEventListener('teacherAvailabilityUpdated', () => {
        if (window.setupStudentDatePicker) window.setupStudentDatePicker();
    });

    // RE-ATTACH LISTENER: Tuition + Unit Preview
    const progSelect = document.getElementById('programId');
    if(progSelect){
        progSelect.addEventListener('change', function() {
            const programId = this.value;
            const program = globalLookups.programs.find(p => p.program_id == programId);
            selectedTuition = program ? parseFloat(program.tuition) : 0;
            updateStudentUnitPreview();
        });
    }
    });
}

function updateStudentUnitPreview() {
    const programId = document.getElementById('programId')?.value;
    const program = globalLookups.programs?.find(p => p.program_id == programId);
    if (!program || !program.total_units || program.unit_type !== 'session') {
        hideStudentUnitPreview();
        return;
    }
    
    const previewDiv = document.getElementById('studentUnitPreview');
    if (!previewDiv) return;
    
    let currentUnits = 0;
    preferredSchedules.forEach(s => {
        if (s.endTime) {
            const startH = parseInt(s.time.split(':')[0]);
            const endH = parseInt(s.endTime.split(':')[0]);
            currentUnits += Math.max(0, endH - startH);
        }
    });
    
    const requiredEl = document.getElementById('requiredUnits');
    const currentEl = document.getElementById('currentUnits');
    const statusEl = document.getElementById('unitStatus');
    
    requiredEl.textContent = program.total_units;
    currentEl.textContent = currentUnits;
    
    previewDiv.style.display = 'block';
    
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

function hideStudentUnitPreview() {
    const previewDiv = document.getElementById('studentUnitPreview');
    if (previewDiv) previewDiv.style.display = 'none';
    const finalizeBtn = document.getElementById('finalizeEnrollment');
    if (finalizeBtn) finalizeBtn.disabled = false;
}

function getStudentProgramScheduleRequirement(schedules = preferredSchedules) {
    const programId = document.getElementById('programId')?.value;
    const program = globalLookups.programs?.find(p => p.program_id == programId);
    const unitType = (program?.unit_type || '').toString().trim().toLowerCase();
    const requiredUnits = parseFloat(program?.total_units || 0);
    const requiredMinutes = requiredUnits > 0 ? Math.round(requiredUnits * 60) : 0;
    const currentMinutes = calculateStudentScheduleMinutes(schedules);
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

function calculateStudentScheduleMinutes(schedules = preferredSchedules) {
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

function formatStudentScheduleUnits(minutes) {
    const units = Math.max(0, minutes) / 60;
    if (Number.isInteger(units)) {
        return String(units);
    }

    return units.toFixed(2).replace(/\.?0+$/, '');
}

function showStudentScheduleRequirementAlert(validation, title = 'Schedule Requirement') {
    if (!validation?.applicable) {
        return;
    }

    const requiredLabel = formatStudentScheduleUnits(validation.requiredMinutes);
    const currentLabel = formatStudentScheduleUnits(validation.currentMinutes);
    const differenceLabel = formatStudentScheduleUnits(Math.abs(validation.differenceMinutes));
    let text = `This tutorial requires exactly ${requiredLabel} session unit(s). Current total: ${currentLabel}.`;

    if (validation.differenceMinutes > 0) {
        text += ` Add ${differenceLabel} more session unit(s) to match the program.`;
    } else if (validation.differenceMinutes < 0) {
        text += ` Remove ${differenceLabel} session unit(s) to match the program.`;
    }

    Swal.fire(title, text, 'warning');
}

function updateStudentUnitPreview() {
    const validation = getStudentProgramScheduleRequirement();
    if (!validation.applicable) {
        hideStudentUnitPreview();
        return;
    }

    const previewDiv = document.getElementById('studentUnitPreview');
    if (!previewDiv) return;

    const requiredEl = document.getElementById('requiredUnits');
    const currentEl = document.getElementById('currentUnits');
    const statusEl = document.getElementById('unitStatus');

    requiredEl.textContent = formatStudentScheduleUnits(validation.requiredMinutes);
    currentEl.textContent = formatStudentScheduleUnits(validation.currentMinutes);
    previewDiv.style.display = 'block';

    if (validation.matches) {
        statusEl.textContent = 'Matched';
        statusEl.className = 'badge bg-success ms-2';
        document.getElementById('finalizeEnrollment').disabled = false;
    } else if (validation.differenceMinutes > 0) {
        statusEl.textContent = `Needs ${formatStudentScheduleUnits(validation.differenceMinutes)} more`;
        statusEl.className = 'badge bg-warning ms-2';
        document.getElementById('finalizeEnrollment').disabled = true;
    } else {
        statusEl.textContent = `Over by ${formatStudentScheduleUnits(Math.abs(validation.differenceMinutes))}`;
        statusEl.className = 'badge bg-danger ms-2';
        document.getElementById('finalizeEnrollment').disabled = true;
    }
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

    console.log('✅ Valid teacher date selected:', dateInput);
    return true;
};

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

window.parseTimeToMinutes = parseTimeToMinutes;
window.minutesToTime = minutesToTime;
window.subtractInterval = subtractInterval;

window.filterTeachers = function() {
    const programId = document.getElementById('programId').value;
    const selectedSubjectIds = getSelectedSubjectIds();
    const subjectId = document.getElementById('subjectId').value;
    const subjectIds = selectedSubjectIds.length > 0 ? selectedSubjectIds : (subjectId ? [subjectId] : []);
    const teacherSelect = document.getElementById('preferredTeacher');
    
    // Capture current teacher selection before changes
    const currentTeacherId = teacherSelect.value;
    
    if (!programId || subjectIds.length === 0) {
        teacherSelect.disabled = true;
        teacherSelect.innerHTML = '<option value="">Select program and subject first</option>';
        hideStudentUnitPreview();
        window.teacherAvailableSlots = [];
        window.teacherBookedSlots = [];
        window.teacherAvailableDates = [];
        return;
    }
    
    updateStudentUnitPreview();
    const branchId = document.getElementById('preferredBranch') ? document.getElementById('preferredBranch').value : '';
    if (!branchId) {
        teacherSelect.disabled = true;
        teacherSelect.innerHTML = '<option value="">Select branch first</option>';
        window.teacherAvailableSlots = [];
        window.teacherBookedSlots = [];
        window.teacherAvailableDates = [];
        return;
    }

    teacherSelect.disabled = false;
    teacherSelect.innerHTML = '<option>Loading matching teachers...</option>';

    const schedulesJson = JSON.stringify(preferredSchedules.map(s => ({
        date: s.date,
        day: s.day,
        time: s.time,
        endTime: s.endTime
    })));
    
    let url = `../../api/admin/enrollment.php?operation=getFilteredTeachers&program_id=${programId}&subject_ids=${encodeURIComponent(subjectIds.join(','))}`;
    if (branchId) url += `&branch_id=${branchId}`;
    if (schedulesJson) url += `&preferred_schedules=${encodeURIComponent(schedulesJson)}`;
    
    axios.get(url)

        .then(res => {
            if (res.data.status === 'success') {
                if (res.data.data.length > 0) {
                    const optionsHtml = res.data.data.map(t => `<option value="${t.employee_id}">${t.name}</option>`).join('');
                    teacherSelect.innerHTML = '<option value="">Select Teacher</option>' + optionsHtml;
                    const fallbackTeacherId = currentTeacherId || pendingEnrollmentDetails?.preferred_teacher || '';
                    
                    // Restore teacher selection if still available in filtered list
                    if (fallbackTeacherId && res.data.data.some(t => t.employee_id == fallbackTeacherId)) {
                        teacherSelect.value = fallbackTeacherId;
                        onTeacherChange();
                    }
                } else {
                    let msg = preferredSchedules.length > 0 ? 'No teachers available for your schedule' : 'No teachers for this program/subject/branch';
                    teacherSelect.innerHTML = `<option value="">${msg}</option>`;
                }
            } else {
                const errorMessage = res.data.message || 'Error loading teachers';
                console.error('Filter teachers API error:', errorMessage, res.data);
                teacherSelect.innerHTML = `<option value="">${escapeHtml(errorMessage)}</option>`;
            }
            if (teacherSelect.value) {
                onTeacherChange();
            } else {
                window.teacherAvailableSlots = [];
                window.teacherBookedSlots = [];
                window.teacherAvailableDates = [];
            }
        })
        .catch(err => {
            const errorMessage = err?.response?.data?.message || err?.message || 'Error loading teachers';
            console.error('Filter teachers error:', err?.response?.data || err);
            teacherSelect.innerHTML = `<option value="">${escapeHtml(errorMessage)}</option>`;
            if (currentTeacherId) {
                teacherSelect.value = currentTeacherId;
                onTeacherChange();
            } else {
                window.teacherAvailableSlots = [];
                window.teacherBookedSlots = [];
                window.teacherAvailableDates = [];
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
                
                getAvailableTeacherDates(window.teacherAvailableSlots, window.teacherBookedSlots, 180);
                
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
            const dateInput = document.getElementById('schedDateInput');
            if (dateInput) {
                dateInput.value = '';
                dateInput.placeholder = 'Unable to load dates';
            }
            console.error('Error fetching teacher slots:', err);
        });

};

function getAvailableTeacherDates(slots, bookings, daysAhead = 180) {
    if (!Array.isArray(slots) || slots.length === 0) return [];

    window.teacherAvailableSlotsPerDate = {};
    window.teacherFullShiftsPerDate = {};

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

        const shift = daySlots[0];
        window.teacherFullShiftsPerDate[formatted] = {start: shift.start_time, end: shift.end_time};

        const shiftStart = parseTimeToMinutes(shift.start_time);
        const shiftEnd = parseTimeToMinutes(shift.end_time);
        let remaining = [{start: shiftStart, end: shiftEnd}];

        const booked = bookingsByDate[formatted] || [];
        booked.forEach(b => {
            const bStart = parseTimeToMinutes(b.start);
            const bEnd = parseTimeToMinutes(b.end);
            remaining = subtractInterval(remaining, bStart, bEnd);
        });

        if (remaining.length > 0) {
            window.teacherAvailableSlotsPerDate[formatted] = remaining.map(r => ({
                start: minutesToTime(r.start),
                end: minutesToTime(r.end)
            }));
            dates.push(formatted);
        }
    }
    window.teacherAvailableDates = dates;
    return dates;

}

function generateBranchOptions(branches, selectedName) {
    if (!Array.isArray(branches)) return "";
    return branches.map(b => {
        const selected = selectedName && b.branch_name == selectedName ? 'selected' : '';
        return `<option value="${b.branch_id}" ${selected}>${b.branch_name}</option>`;
    }).join('');
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
        <span class="badge bg-primary-subtle text-primary border border-primary-subtle d-inline-flex align-items-center gap-1 px-2 py-2">
            ${getSubjectName(subjectId)}
            <button type="button" class="btn-close btn-close-sm ms-1" aria-label="Remove ${getSubjectName(subjectId)}" onclick="removeSelectedSubject('${subjectId}')"></button>
        </span>
    `).join('');
}

window.addSelectedSubject = function() {
    const subjectSelect = document.getElementById('subjectId');
    if (!subjectSelect || !subjectSelect.value) {
        Swal.fire('Select Subject', 'Please choose a subject to add.', 'warning');
        return;
    }
    if (selectedSubjectIds.includes(subjectSelect.value)) {
        Swal.fire('Duplicate Subject', 'This subject has already been added.', 'warning');
        return;
    }

    selectedSubjectIds.push(subjectSelect.value);
    subjectSelect.value = '';
    renderSelectedSubjects();
    filterTeachers();
};

window.removeSelectedSubject = function(subjectId) {
    selectedSubjectIds = selectedSubjectIds.filter(id => String(id) !== String(subjectId));
    renderSelectedSubjects();
    filterTeachers();
};

// --- SCHEDULE FUNCTIONS ---
window.addSchedule = function() {
    const dateInput = document.getElementById("schedDate").value;
    const timeInput = document.getElementById("schedTime").value;
    const endTimeInput = document.getElementById("schedEndTime").value;

    if (!dateInput || !timeInput || !endTimeInput) {
        Swal.fire("Missing Info", "Please select a date, start time, and end time.", "warning");
        return;
    }

    // Validate end time after start time
    if (endTimeInput <= timeInput) {
        Swal.fire("Invalid Time", "End time must be after start time.", "warning");
        return;
    }

    // Validate teacher availability
    const teacherId = document.getElementById("preferredTeacher").value;
    if (teacherId) {
        const available = window.teacherAvailableSlotsPerDate[dateInput];
        if (!available) {
            Swal.fire({
                icon: 'warning',
                title: 'Date Not Available',
                text: 'This date is not available for the selected teacher.',
                timer: 3000
            });
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
            Swal.fire({
                icon: 'warning',
                title: 'Time Not Available',
                text: 'The selected time is not within the available slots for this teacher on this date.',
                timer: 3000
            });
            return;
        }
    }

    // Check for duplicate schedule
    const isDuplicate = preferredSchedules.some(s => s.date === dateInput && s.time === timeInput && s.endTime === endTimeInput);
    if (isDuplicate) {
        Swal.fire("Duplicate Schedule", "This schedule has already been added.", "warning");
        return;
    }

    const dateObj = new Date(dateInput);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[dateObj.getDay()];

    const nextSchedule = { date: dateInput, day: dayName, time: timeInput, endTime: endTimeInput };
    const nextValidation = getStudentProgramScheduleRequirement([...preferredSchedules, nextSchedule]);
    if (nextValidation.applicable && nextValidation.differenceMinutes < 0) {
        showStudentScheduleRequirementAlert(nextValidation, "Too Many Session Units");
        return;
    }

    preferredSchedules.push(nextSchedule);
    preferredSchedules.sort((a, b) => new Date(a.date + ' ' + a.time) - new Date(b.date + ' ' + b.time));
    renderScheduleList();
    updateStudentUnitPreview();

    const selectedTeacherId = document.getElementById("preferredTeacher")?.value || '';
    if (selectedTeacherId) {
        onTeacherChange();
    } else {
        filterTeachers();
    }
    
    document.getElementById("schedDate").value = "";
    document.getElementById("schedDateInput").value = "";
};

window.removeSchedule = function(index) {
    preferredSchedules.splice(index, 1);
    renderScheduleList();
    updateStudentUnitPreview();

    const selectedTeacherId = document.getElementById("preferredTeacher")?.value || '';
    if (selectedTeacherId) {
        onTeacherChange();
    } else {
        filterTeachers();
    }
};

function renderScheduleList() {
    const tbody = document.getElementById("scheduleListBody");
    tbody.innerHTML = "";

    if (preferredSchedules.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No schedule preferences added yet.</td></tr>';
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

// --- TEACHER AVAILABILITY HANDLER ---


// --- SUBMIT FUNCTION ---
function submitEnrollment() {
    if(!LOGGED_IN_STUDENT_ID) {
        Swal.fire("Error", "User session invalid. Please refresh or login again.", "error");
        return;
    }

    // Basic Validation
    const program = document.getElementById("programId").value;
    const subjectIds = getSelectedSubjectIds();
    const grade = document.getElementById("gradeLevelId").value;
    const preferredBranchId = document.getElementById("preferredBranch")?.value || '';
    const preferredTeacher = document.getElementById("preferredTeacher")?.value || '';
    const scheduleValidation = getStudentProgramScheduleRequirement();
    
    if(!program || subjectIds.length === 0 || !grade) {
        Swal.fire("Required", "Please select a Program, Grade Level and at least one Subject.", "warning");
        return;
    }

    if (!preferredBranchId) {
        Swal.fire("Branch Required", "Please select your preferred branch.", "warning");
        return;
    }

    if (!preferredTeacher) {
        Swal.fire("Teacher Required", "Please select a teacher.", "warning");
        return;
    }

    if (scheduleValidation.applicable && !scheduleValidation.matches) {
        showStudentScheduleRequirementAlert(scheduleValidation, "Schedule Preference Mismatch");
        return;
    }

    let summaryTime = preferredSchedules.length > 0
        ? preferredSchedules.map(s => `${s.date} (${s.day.substring(0,3)}) ${formatTime(s.time)} - ${formatTime(s.endTime)}`).join(", ")
        : "No preference";

    const data = {
        student_id: LOGGED_IN_STUDENT_ID,
        program_id: program,
        grade_level_id: grade,
        subject_id: subjectIds[0],
        subject_ids: subjectIds,
        goal: document.getElementById("goal").value,
        preferred_teacher: preferredTeacher,
        preferred_branch_id: preferredBranchId,
        total_of_program: selectedTuition.toString(),
        preferred_time_day: summaryTime,
        preferences: preferredSchedules,
        enrollment_category: 'tutorial'
    };

    const operation = pendingDownpaymentEnrollment ? "completePendingEnrollment" : "addEnrollment";
    if (pendingDownpaymentEnrollment) {
        data.pending_enrollment_id = pendingDownpaymentEnrollment.enrollment_id;
    }

    axios.post("../../api/admin/enrollment.php", {
        operation,
        json: JSON.stringify(data)
    }).then(res => {
        if(res.data.status === "success") {
            if (pendingDownpaymentEnrollment) {
                pendingDownpaymentEnrollment = null;
            }

            const modalEl = document.getElementById('enrollmentDetailsModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) {
                modal.hide();
            }

            Swal.fire("Enrollment Submitted", res.data.message || "Your enrollment has been submitted.", "success").then(() => {
                location.reload();
            });
        } else {
            Swal.fire("Error", res.data.message, "error");
        }
    }).catch(err => {
        console.error(err);
        Swal.fire("Error", "An unexpected error occurred.", "error");
    });
}

// --- DOWNPAYMENT FLOW ---
function renderDownpaymentStep() {
    const form = document.getElementById("downpaymentForm");
    form.innerHTML = '<p class="text-center text-muted"><i class="bi bi-hourglass"></i> Loading payment methods...</p>';
    
    const title = document.getElementById("downpaymentModal").querySelector('.modal-title');
    if (title) title.textContent = "Step 1: Downpayment";
    
    const tutorialPrograms = (globalLookups.programs || []).filter(p => p.program_type == 1 || p.program_type == 2);

    axios.get("../../api/student/payment.php?operation=getPaymentMethods")
        .then(res => {
            if (res.data.status === 'success' && Array.isArray(res.data.data)) {
                const gcashMethod = res.data.data.find(pm => (pm.payment_method || '').toLowerCase().includes('gcash'));
                const gcashMethodId = gcashMethod ? gcashMethod.payment_method_id : null;
                const gcashLabel = gcashMethod ? gcashMethod.payment_method : 'GCash';

                const programOptions = tutorialPrograms.length > 0
                    ? tutorialPrograms.map(p => {
                        const typeObj = globalLookups.program_types?.find(pt => pt.program_type_id == p.program_type);
                        const typeLabel = typeObj ? typeObj.type : p.program_type;
                        return `<option value="${p.program_id}" data-tuition="${p.tuition || 0}" data-downpayment="${p.downpayment || 0}">${p.name} (${typeLabel})</option>`;
                    }).join('')
                    : '<option value="">No tutorial programs available</option>';

                let html = `
                    <div class="alert alert-info"><i class="bi bi-info-circle"></i> Step 1: Pay downpayment before completing enrollment details.</div>
                    <div class="row">
                        <div class="col-md-6 mb-3">
                            <label class="form-label">Select Tutorial Program</label>
                            <select class="form-select" id="downpaymentProgramInput" required>
                                <option value="">Select Program</option>
                                ${programOptions}
                            </select>
                        </div>
                        <div class="col-md-6 mb-3">
                            <label class="form-label">Tuition / Program Fee</label>
                            <input type="text" class="form-control" id="estimatedProgramFee" value="₱ 0.00" disabled>
                        </div>
                        <div class="col-md-6 mb-3">
                            <label class="form-label">Required Downpayment</label>
                            <div class="input-group">
                                <span class="input-group-text">&#8369;</span>
                                <input type="number" class="form-control" id="downpaymentAmountInput" value="0.00" step="0.01" min="0" required readonly>
                            </div>
                        </div>
                        <div class="col-md-12 mb-3 d-none" data-program-products-section>
                            <label class="form-label">Books / Other Fees</label>
                            <div class="border rounded p-3 bg-light" id="downpaymentProgramProductsPreview">
                            </div>
                        </div>
                        <div class="col-md-6 mb-3">
                            <label class="form-label">Payment Method</label>
                            <div class="form-control bg-light text-muted">${gcashLabel} (automatically selected)</div>
                            <input type="hidden" id="paymentMethodInput" value="${gcashMethodId || ''}">
                        </div>
                        <div class="col-md-12 mb-3" id="referenceField" style="display:${gcashMethodId ? 'block' : 'none'};">
                            <label class="form-label fw-bold">Reference/Transaction ID</label>
                            <input type="text" class="form-control border-primary" id="transactionReferenceInput" placeholder="Enter the transaction reference number">
                            <small class="text-muted">Required for GCash payments.</small>
                        </div>
                    </div>
                `;
                form.innerHTML = html;
                markRequiredFieldLabels(form);

                const programSelect = document.getElementById('downpaymentProgramInput');
                if (programSelect) {
                    programSelect.addEventListener('change', function() {
                        const selectedOption = this.options[this.selectedIndex];
                        const tuition = parseFloat(selectedOption?.dataset?.tuition || 0);
                        const downpayment = parseFloat(selectedOption?.dataset?.downpayment || 0);
                        const feeInput = document.getElementById('estimatedProgramFee');
                        const amountInput = document.getElementById('downpaymentAmountInput');
                        if (feeInput) {
                            feeInput.value = `₱ ${tuition.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                        }
                        if (amountInput) {
                            amountInput.value = downpayment.toFixed(2);
                        }
                        loadProgramProductsPreview(this.value, 'downpaymentProgramProductsPreview');
                    });
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
async function handleSubmitDownpayment() {
    const programId = document.getElementById('downpaymentProgramInput')?.value;
    const amount = parseFloat(document.getElementById('downpaymentAmountInput')?.value);
    const methodId = document.getElementById('paymentMethodInput')?.value || null;
    const ref = document.getElementById('transactionReferenceInput')?.value.trim();

    if (!programId) {
        Swal.fire("Program Required", "Please select a tutorial program first.", "warning");
        return;
    }
    if (!amount || amount <= 0) {
        Swal.fire("Invalid Amount", "Please enter a valid downpayment amount.", "warning");
        return;
    }
    if (!methodId) {
        Swal.fire("Invalid Payment", "GCash payment is not configured. Please contact administrator.", "warning");
        return;
    }
    if (!ref) {
        Swal.fire("Missing Reference", "Please enter your GCash transaction reference number.", "warning");
        return;
    }

    Swal.fire({
        title: 'Processing Downpayment...',
        didOpen: () => Swal.showLoading(),
        allowOutsideClick: false
    });

    const payload = {
        program_id: programId,
        amount: amount,
        method: methodId,
        ref: ref || null,
        school_year_id: globalLookups.active_school_year ? globalLookups.active_school_year.school_year_id : null
    };

    try {
        const res = await axios.post('../../api/admin/enrollment.php', {
            operation: 'createPendingDownpaymentEnrollment',
            json: JSON.stringify(payload)
        });

        Swal.close();

        if (res.data.status === 'success') {
            pendingDownpaymentEnrollment = {
                enrollment_id: res.data.enrollment_id,
                program_id: res.data.program_id,
                school_year_id: res.data.enrollment_header_id ? res.data.enrollment_header_id : null,
                program_name: res.data.program_display_name,
                program_type: res.data.program_type
            };

            const downpaymentModal = bootstrap.Modal.getInstance(document.getElementById('downpaymentModal'));
            if (downpaymentModal) {
                downpaymentModal.hide();
            }

            const receiptData = {
                enrollmentId: res.data.enrollment_id,
                studentName: res.data.student_name || 'Student',
                programName: res.data.program_display_name || '',
                programType: res.data.program_type || '',
                paymentFor: 'Enrollment Downpayment',
                paymentMethod: res.data.payment_method || 'GCash',
                referenceNo: res.data.reference_no || ref,
                receiptNo: res.data.receipt_id || null,
                amountPaid: amount,
                balance: parseFloat(res.data.balance || 0),
                totalAmount: amount,
                paymentDate: new Date()
            };

            const receiptHandler = getStudentReceiptHandler();
            if (typeof receiptHandler === 'function') {
                await receiptHandler(receiptData);
            }

            const enrollmentModal = new bootstrap.Modal(document.getElementById('enrollmentDetailsModal'));
            enrollmentModal.show();
        } else {
            Swal.fire("Error", res.data.message || "Failed to process downpayment.", "error");
        }
    } catch (err) {
        Swal.close();
        console.error(err);
        Swal.fire("Error", "Network error while processing downpayment.", "error");
    }
}

function resolveEnrollmentPaymentQrUrl(qrPath) {
    const value = String(qrPath || '').trim();
    if (!value) return '';
    if (/^(?:https?:|data:|blob:|\/)/i.test(value) || value.startsWith('../')) return value;
    return `../../${value.replace(/^\.\//, '')}`;
}

function buildEnrollmentPaymentMethodDetails(method) {
    if (!method) return '';
    const accountName = String(method.account_name || '').trim();
    const accountNumber = String(method.account_number || '').trim();
    const qrUrl = resolveEnrollmentPaymentQrUrl(method.qr_code);
    if (!accountName && !accountNumber && !qrUrl) return '';
    return `<section class="dp-card dp-payment-account${qrUrl ? ' has-qr' : ''}" aria-labelledby="downpaymentAccountTitle">
        <div class="dp-payment-account-copy">
            <span class="dp-payment-account-eyebrow"><i class="bi bi-shield-check" aria-hidden="true"></i> Send payment to</span>
            <h3 id="downpaymentAccountTitle">${escapeHtml(method.payment_method || 'Payment account')}</h3>
            <dl>
                ${accountName ? `<div><dt>Account name</dt><dd>${escapeHtml(accountName)}</dd></div>` : ''}
                ${accountNumber ? `<div><dt>Account number</dt><dd><span>${escapeHtml(accountNumber)}</span><button type="button" class="dp-copy-account" id="downpaymentCopyAccount"><i class="bi bi-copy" aria-hidden="true"></i><span>Copy</span></button></dd></div>` : ''}
            </dl>
            <p><i class="bi bi-info-circle" aria-hidden="true"></i> Verify these account details before sending your downpayment.</p>
        </div>
        ${qrUrl ? `<button type="button" class="dp-account-qr" id="downpaymentOpenQr" title="View larger QR code"><img src="${escapeHtml(qrUrl)}" alt="${escapeHtml(method.payment_method || 'Payment')} QR code"><span><i class="bi bi-arrows-fullscreen" aria-hidden="true"></i> View larger</span></button>` : ''}
    </section>`;
}

function openEnrollmentPaymentQrModal(method) {
    const qrUrl = resolveEnrollmentPaymentQrUrl(method?.qr_code);
    if (!qrUrl) return;
    document.querySelector('.downpayment-qr-modal')?.remove();
    const modal = document.createElement('div');
    modal.className = 'downpayment-qr-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'downpaymentQrModalTitle');
    modal.innerHTML = `<div class="downpayment-qr-dialog"><button type="button" class="downpayment-qr-close-icon" aria-label="Close QR code"><i class="bi bi-x-lg" aria-hidden="true"></i></button><h3 id="downpaymentQrModalTitle">${escapeHtml(method.payment_method || 'Payment')}</h3><img src="${escapeHtml(qrUrl)}" alt="${escapeHtml(method.payment_method || 'Payment')} QR code"><button type="button" class="downpayment-qr-close-button">Close</button></div>`;
    document.body.appendChild(modal);
    const closeModal = () => {
        document.removeEventListener('keydown', handleKeydown, true);
        modal.remove();
        document.getElementById('downpaymentOpenQr')?.focus();
    };
    const handleKeydown = event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            closeModal();
        }
    };
    modal.addEventListener('click', event => {
        if (event.target === modal || event.target.closest('.downpayment-qr-close-icon, .downpayment-qr-close-button')) closeModal();
    });
    document.addEventListener('keydown', handleKeydown, true);
    modal.querySelector('.downpayment-qr-close-icon')?.focus();
}

function bindEnrollmentPaymentMethodDetails(method) {
    const copyButton = document.getElementById('downpaymentCopyAccount');
    const accountNumber = String(method?.account_number || '').trim();
    copyButton?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(accountNumber);
            const label = copyButton.querySelector('span');
            if (label) label.textContent = 'Copied';
            copyButton.classList.add('is-copied');
            setTimeout(() => {
                if (label) label.textContent = 'Copy';
                copyButton.classList.remove('is-copied');
            }, 1800);
        } catch (error) {
            console.warn('Unable to copy downpayment account number:', error);
        }
    });
    document.getElementById('downpaymentOpenQr')?.addEventListener('click', () => openEnrollmentPaymentQrModal(method));
}

function prepareStudentDownpaymentModal() {
    const modal = document.getElementById('downpaymentModal');
    if (!modal) return;

    modal.classList.add('student-downpayment-modal');

    const title = modal.querySelector('.modal-title');
    if (title) title.classList.add('visually-hidden');

    const closeButton = modal.querySelector('.modal-header .btn-close');
    if (closeButton) closeButton.setAttribute('aria-label', 'Close downpayment');

    const closeFooterButton = modal.querySelector('.modal-footer [data-bs-dismiss="modal"]');
    if (closeFooterButton) {
        closeFooterButton.className = 'btn downpayment-close-btn';
        closeFooterButton.textContent = 'Close';
    }

    const submitButton = document.getElementById('submitDownpayment');
    if (submitButton) {
        submitButton.className = 'btn downpayment-submit-btn';
        submitButton.innerHTML = '<i class="bi bi-lock" aria-hidden="true"></i><span>Pay Downpayment &amp; Continue</span>';
    }

    if (document.getElementById('studentDownpaymentModalStyles')) return;

    const styles = document.createElement('style');
    styles.id = 'studentDownpaymentModalStyles';
    styles.textContent = `
        .student-downpayment-modal {
            --dp-blue: #e85d88;
            --dp-blue-dark: #d94b78;
            --dp-ink: #172033;
            --dp-muted: #667085;
            --dp-border: #dfe5ec;
            --dp-soft-blue: #fff4f7;
        }
        .student-downpayment-modal .modal-dialog {
            width: min(1040px, calc(100% - 28px));
            max-width: 1040px;
            margin: 20px auto;
        }
        .student-downpayment-modal .modal-content {
            border: 0;
            border-radius: 24px;
            box-shadow: 0 24px 70px rgba(15, 23, 42, .16);
            overflow: hidden;
        }
        .student-downpayment-modal .modal-header {
            position: absolute;
            z-index: 5;
            top: 19px;
            right: 20px;
            border: 0;
            padding: 0;
        }
        .student-downpayment-modal .modal-header .btn-close {
            width: 1.1rem;
            height: 1.1rem;
            padding: .55rem;
            margin: 0;
            opacity: .6;
        }
        .student-downpayment-modal .modal-body {
            padding: 66px 32px 18px;
            background: #fff;
        }
        .student-downpayment-modal .modal-footer {
            justify-content: space-between;
            gap: 12px;
            padding: 18px 32px 22px;
            border-top: 1px solid #e8edf3;
            background: #fff;
        }
        .student-downpayment-modal .downpayment-close-btn,
        .student-downpayment-modal .downpayment-submit-btn {
            min-height: 54px;
            border-radius: 10px;
            font-size: 1rem;
            font-weight: 600;
        }
        .student-downpayment-modal .downpayment-close-btn {
            min-width: 145px;
            margin-right: auto;
            border: 1px solid #d7dde5;
            color: #202938;
            background: #fff;
        }
        .student-downpayment-modal .downpayment-submit-btn {
            display: inline-flex;
            flex: 1 1 440px;
            align-items: center;
            justify-content: center;
            gap: 10px;
            max-width: 480px;
            color: #fff;
            border: 0;
            background: linear-gradient(135deg, var(--dp-blue), #df4e7c);
            box-shadow: 0 8px 18px rgba(232, 93, 136, .22);
        }
        .student-downpayment-modal .downpayment-submit-btn:hover {
            color: #fff;
            background: linear-gradient(135deg, var(--dp-blue-dark), #c93f6b);
        }
        .student-downpayment-modal .dp-hero {
            display: flex;
            align-items: center;
            gap: 24px;
            padding: 30px 26px;
            margin-bottom: 28px;
            border: 1px solid #f4bfd0;
            border-radius: 18px;
            background: linear-gradient(110deg, #fff4f7, #fffafb);
        }
        .student-downpayment-modal .dp-hero-icon {
            display: grid;
            flex: 0 0 88px;
            width: 88px;
            height: 88px;
            place-items: center;
            border-radius: 50%;
            color: var(--dp-blue);
            background: #fde7ee;
            font-size: 2.15rem;
        }
        .student-downpayment-modal .dp-hero h2 {
            margin: 0 0 8px;
            color: var(--dp-ink);
            font-size: clamp(1.45rem, 3vw, 1.9rem);
            font-weight: 750;
        }
        .student-downpayment-modal .dp-hero p {
            margin: 0;
            color: var(--dp-muted);
            font-size: 1rem;
            line-height: 1.55;
        }
        .student-downpayment-modal .dp-card {
            padding: 24px 26px;
            margin-bottom: 18px;
            border: 1px solid var(--dp-border);
            border-radius: 15px;
            background: #fff;
            box-shadow: 0 2px 5px rgba(15, 23, 42, .06);
        }
        .student-downpayment-modal .dp-card:last-child { margin-bottom: 0; }
        .student-downpayment-modal .dp-card-heading,
        .student-downpayment-modal .dp-card-title-row {
            display: flex;
            align-items: center;
            gap: 14px;
        }
        .student-downpayment-modal .dp-card-title-row {
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 20px;
        }
        .student-downpayment-modal .dp-card-heading { margin-bottom: 24px; }
        .student-downpayment-modal .dp-card-title-row .dp-card-heading { margin-bottom: 0; }
        .student-downpayment-modal .dp-section-icon {
            display: grid;
            flex: 0 0 38px;
            width: 38px;
            height: 38px;
            place-items: center;
            border-radius: 8px;
            color: var(--dp-blue);
            background: #fde7ee;
            font-size: 1.15rem;
        }
        .student-downpayment-modal .dp-section-icon.solid {
            color: #fff;
            background: var(--dp-blue);
        }
        .student-downpayment-modal .dp-card h3 {
            margin: 0;
            color: var(--dp-ink);
            font-size: 1.2rem;
            font-weight: 750;
        }
        .student-downpayment-modal .dp-badge {
            display: inline-flex;
            align-items: center;
            padding: 3px 10px;
            margin-left: 8px;
            border: 1px solid #f1b2c6;
            border-radius: 999px;
            color: #c93f6b;
            background: #fff1f5;
            font-size: .78rem;
            font-weight: 600;
            vertical-align: 2px;
        }
        .student-downpayment-modal .dp-badge.success {
            border-color: #b9e6ca;
            color: #16834b;
            background: #effbf4;
        }
        .student-downpayment-modal .dp-card-description {
            margin: 5px 0 0;
            color: var(--dp-muted);
            line-height: 1.5;
        }
        .student-downpayment-modal .dp-field-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 22px 32px;
        }
        .student-downpayment-modal .dp-program-select {
            grid-column: 1 / -1;
        }
        .student-downpayment-modal .dp-field { min-width: 0; }
        .student-downpayment-modal .dp-field label {
            margin-bottom: 9px;
            color: #202938;
            font-weight: 600;
        }
        .student-downpayment-modal .dp-field .form-control,
        .student-downpayment-modal .dp-field .form-select,
        .student-downpayment-modal .dp-field .input-group-text {
            min-height: 58px;
            border-color: #d3dae4;
            font-size: 1rem;
        }
        .student-downpayment-modal .dp-field .form-control,
        .student-downpayment-modal .dp-field .form-select {
            border-radius: 9px;
            color: #344054;
        }
        .student-downpayment-modal .dp-field .form-control:focus,
        .student-downpayment-modal .dp-field .form-select:focus {
            border-color: #ef9bb5;
            box-shadow: 0 0 0 .2rem rgba(232, 93, 136, .14);
        }
        .student-downpayment-modal .dp-field .form-control:disabled {
            color: #111827;
            -webkit-text-fill-color: #111827;
            background: #f4f6f8;
            font-size: 1.25rem;
            font-weight: 700;
            opacity: 1;
        }
        .student-downpayment-modal .dp-field .input-group .form-control {
            border-radius: 0 9px 9px 0;
        }
        .student-downpayment-modal .dp-field .input-group-text {
            min-width: 58px;
            justify-content: center;
            border-radius: 9px 0 0 9px;
            background: #f4f6f8;
            font-weight: 700;
        }
        .student-downpayment-modal .dp-help {
            display: block;
            margin-top: 8px;
            color: #8490a3;
            font-size: .86rem;
        }
        .student-downpayment-modal .dp-read-receipt {
            display: inline-flex;
            flex: 0 0 auto;
            align-items: center;
            gap: 9px;
            min-height: 50px;
            padding: 0 20px;
            border: 1px solid var(--dp-blue);
            border-radius: 9px;
            color: var(--dp-blue);
            background: #fff;
            font-weight: 600;
        }
        .student-downpayment-modal .dp-upload-zone {
            position: relative;
            display: flex;
            min-height: 186px;
            align-items: center;
            justify-content: center;
            padding: 24px;
            overflow: hidden;
            border: 2px dashed var(--dp-blue);
            border-radius: 12px;
            background: var(--dp-soft-blue);
            text-align: center;
            cursor: pointer;
        }
        .student-downpayment-modal .dp-upload-zone:hover {
            border-color: var(--dp-blue-dark);
            background: #ffedf3;
        }
        .student-downpayment-modal .dp-upload-zone input[type="file"] {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            cursor: pointer;
            opacity: 0;
        }
        .student-downpayment-modal .dp-upload-copy { pointer-events: none; }
        .student-downpayment-modal .dp-upload-copy i {
            display: block;
            margin-bottom: 8px;
            color: var(--dp-blue);
            font-size: 2.6rem;
        }
        .student-downpayment-modal .dp-upload-title {
            display: block;
            color: var(--dp-ink);
            font-size: 1.12rem;
            font-weight: 700;
        }
        .student-downpayment-modal .dp-upload-subtitle {
            display: block;
            margin-top: 7px;
            color: var(--dp-muted);
        }
        .student-downpayment-modal #downpaymentOcrStatus { margin-top: 8px !important; }
        .student-downpayment-modal .dp-preview {
            margin-top: 14px;
            padding: 12px;
            border: 1px solid #dbe3ed;
            border-radius: 12px;
            background: #f8fafc;
            text-align: center;
        }
        .student-downpayment-modal .dp-preview img {
            max-height: 340px;
            object-fit: contain;
        }
        .student-downpayment-modal .dp-payment-account{display:grid;grid-template-columns:1fr;gap:22px;align-items:center;border-color:#f1c4d2;background:linear-gradient(135deg,#fff8fa,#fff)}
        .student-downpayment-modal .dp-payment-account.has-qr{grid-template-columns:minmax(0,1fr) minmax(170px,220px)}
        .student-downpayment-modal .dp-payment-account-eyebrow{display:inline-flex;align-items:center;gap:7px;margin-bottom:7px;color:var(--dp-blue);font-size:.78rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase}
        .student-downpayment-modal .dp-payment-account-copy h3{margin:0 0 14px}
        .student-downpayment-modal .dp-payment-account-copy dl{display:grid;gap:10px;margin:0}
        .student-downpayment-modal .dp-payment-account-copy dl div{display:grid;grid-template-columns:118px minmax(0,1fr);gap:12px;align-items:center}
        .student-downpayment-modal .dp-payment-account-copy dt{color:var(--dp-muted);font-size:.8rem;font-weight:650}
        .student-downpayment-modal .dp-payment-account-copy dd{display:flex;align-items:center;gap:9px;min-width:0;margin:0;color:var(--dp-ink);font-weight:750;overflow-wrap:anywhere}
        .student-downpayment-modal .dp-payment-account-copy p{display:flex;gap:7px;margin:14px 0 0;color:var(--dp-muted);font-size:.79rem}
        .student-downpayment-modal .dp-copy-account{display:inline-flex;flex:0 0 auto;align-items:center;gap:5px;padding:5px 9px;border:1px solid #edb5c6;border-radius:7px;color:var(--dp-blue-dark);background:#fff;font-size:.75rem;font-weight:750}
        .student-downpayment-modal .dp-copy-account:hover,.student-downpayment-modal .dp-copy-account.is-copied{background:#fdeaf0}
        .student-downpayment-modal .dp-account-qr{display:grid;justify-items:center;gap:8px;padding:10px;border:1px solid #efd3dc;border-radius:11px;color:var(--dp-blue-dark);background:#fff;font-size:.78rem;font-weight:750}
        .student-downpayment-modal .dp-account-qr img{width:100%;max-width:190px;max-height:190px;border-radius:7px;object-fit:contain}
        .student-downpayment-modal .dp-account-qr:hover{border-color:var(--dp-blue)}
        .downpayment-qr-modal{position:fixed;inset:0;z-index:20000;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.58);backdrop-filter:blur(2px)}
        .downpayment-qr-dialog{position:relative;display:grid;justify-items:center;width:min(640px,calc(100vw - 28px));max-height:calc(100vh - 28px);padding:30px 30px 26px;overflow:auto;border-radius:10px;background:#fff;box-shadow:0 24px 70px rgba(15,23,42,.3)}
        .downpayment-qr-dialog h3{margin:0 42px 22px;color:#4a4a4a;font-size:2rem;font-weight:750;text-align:center}.downpayment-qr-dialog img{display:block;max-width:100%;max-height:65vh;border-radius:10px;object-fit:contain}
        .downpayment-qr-close-icon{position:absolute;top:14px;right:14px;display:grid;width:36px;height:36px;place-items:center;border:0;border-radius:50%;color:#667085;background:transparent}.downpayment-qr-close-icon:hover{background:#f2f4f7}
        .downpayment-qr-close-button{min-width:92px;min-height:46px;margin-top:24px;padding:0 22px;border:0;border-radius:7px;color:#fff;background:var(--dp-blue);font-weight:750}.downpayment-qr-close-button:hover{background:var(--dp-blue-dark)}
        .student-downpayment-modal [data-program-products-section] {
            grid-column: 1 / -1;
        }
        @media (max-width: 767.98px) {
            .student-downpayment-modal .modal-dialog {
                width: calc(100% - 16px);
                margin: 8px auto;
            }
            .student-downpayment-modal .modal-content { border-radius: 18px; }
            .student-downpayment-modal .modal-body { padding: 56px 14px 14px; }
            .student-downpayment-modal .modal-footer { padding: 14px; }
            .student-downpayment-modal .dp-hero {
                align-items: flex-start;
                gap: 14px;
                padding: 22px 18px;
                margin-bottom: 16px;
            }
            .student-downpayment-modal .dp-hero-icon {
                flex-basis: 56px;
                width: 56px;
                height: 56px;
                font-size: 1.55rem;
            }
            .student-downpayment-modal .dp-card { padding: 20px 16px; }
            .student-downpayment-modal .dp-payment-account,.student-downpayment-modal .dp-payment-account.has-qr{grid-template-columns:1fr;gap:16px}
            .student-downpayment-modal .dp-payment-account-copy dl div{grid-template-columns:1fr;gap:3px}
            .student-downpayment-modal .dp-account-qr{width:min(220px,100%);justify-self:center}
            .downpayment-qr-modal{padding:10px}.downpayment-qr-dialog{width:calc(100vw - 20px);max-height:calc(100vh - 20px);padding:24px 16px 20px}.downpayment-qr-dialog h3{margin-bottom:18px;font-size:1.55rem}.downpayment-qr-dialog img{max-height:68vh}
            .student-downpayment-modal .dp-field-grid { grid-template-columns: 1fr; gap: 18px; }
            .student-downpayment-modal .dp-program-select { grid-column: auto; }
            .student-downpayment-modal [data-program-products-section] { grid-column: auto; }
            .student-downpayment-modal .dp-card-title-row { display: block; }
            .student-downpayment-modal .dp-read-receipt {
                width: 100%;
                justify-content: center;
                margin-top: 16px;
            }
            .student-downpayment-modal .modal-footer > * { margin: 0; }
            .student-downpayment-modal .downpayment-close-btn { min-width: 100px; }
        }
        @media (max-width: 480px) {
            .student-downpayment-modal .modal-footer { flex-wrap: wrap; }
            .student-downpayment-modal .downpayment-close-btn,
            .student-downpayment-modal .downpayment-submit-btn {
                width: 100%;
                max-width: none;
            }
        }
    `;
    document.head.appendChild(styles);
}

function bindDownpaymentUploadFilename() {
    const fileInput = document.getElementById('downpaymentScreenshotInput');
    const filename = document.getElementById('downpaymentUploadFilename');
    if (!fileInput || !filename) return;

    fileInput.addEventListener('change', () => {
        filename.textContent = fileInput.files?.[0]?.name || 'Drag and drop your file here, or click to browse';
    });
}

function renderDownpaymentStep() {
    const form = document.getElementById("downpaymentForm");
    prepareStudentDownpaymentModal();
    form.innerHTML = '<p class="text-center text-muted"><i class="bi bi-hourglass"></i> Loading payment methods...</p>';

    const title = document.getElementById("downpaymentModal").querySelector('.modal-title');
    if (title) title.textContent = "Step 1: Downpayment";

    const tutorialPrograms = (globalLookups.programs || []).filter(p => p.program_type == 1 || p.program_type == 2);

    axios.get("../../api/student/payment.php?operation=getPaymentMethods")
        .then(res => {
            if (res.data.status !== 'success' || !Array.isArray(res.data.data)) {
                form.innerHTML = '<div class="alert alert-warning">Could not load payment methods. Please try again.</div>';
                return;
            }

            const gcashMethod = res.data.data.find(pm => (pm.payment_method || '').toLowerCase().includes('gcash'));
            const gcashMethodId = gcashMethod ? gcashMethod.payment_method_id : null;
            const gcashLabel = gcashMethod ? gcashMethod.payment_method : 'GCash';

            const programOptions = tutorialPrograms.length > 0
                ? tutorialPrograms.map(p => {
                    const typeObj = globalLookups.program_types?.find(pt => pt.program_type_id == p.program_type);
                    const typeLabel = typeObj ? typeObj.type : p.program_type;
                    return `<option value="${p.program_id}" data-tuition="${p.tuition || 0}" data-downpayment="${p.downpayment || 0}">${p.name} (${typeLabel})</option>`;
                }).join('')
                : '<option value="">No tutorial programs available</option>';

            form.innerHTML = `
                <section class="dp-hero" aria-labelledby="downpaymentStepTitle">
                    <div class="dp-hero-icon"><i class="bi bi-wallet2" aria-hidden="true"></i></div>
                    <div>
                        <h2 id="downpaymentStepTitle">Step 1: Downpayment</h2>
                        <p>Pay the required downpayment to secure your slot.<br>Upload your GCash payment receipt to automatically capture the details.</p>
                    </div>
                </section>

                <section class="dp-card" aria-labelledby="downpaymentProgramTitle">
                    <div class="dp-card-heading">
                        <span class="dp-section-icon"><i class="bi bi-journal-bookmark" aria-hidden="true"></i></span>
                        <h3 id="downpaymentProgramTitle">Program Details</h3>
                    </div>
                    <div class="dp-field-grid">
                        <div class="dp-field dp-program-select">
                            <label class="form-label" for="downpaymentProgramInput">Select Tutorial Program</label>
                        <select class="form-select" id="downpaymentProgramInput" required>
                            <option value="">Select Program</option>
                            ${programOptions}
                        </select>
                    </div>
                        <div class="dp-field">
                            <label class="form-label" for="estimatedProgramFee">Tuition / Program Fee</label>
                        <input type="text" class="form-control" id="estimatedProgramFee" value="PHP 0.00" disabled>
                    </div>
                        <div class="dp-field">
                            <label class="form-label" for="programDownpaymentPreview">Required Downpayment</label>
                            <input type="text" class="form-control" id="programDownpaymentPreview" value="PHP 0.00" disabled>
                        </div>
                        <div class="dp-field d-none" data-program-products-section>
                        <label class="form-label">Books / Other Fees</label>
                            <div class="border rounded p-3 bg-light" id="downpaymentProgramProductsPreview"></div>
                    </div>
                    </div>
                </section>

                <input type="hidden" id="paymentMethodInput" value="${gcashMethodId || ''}" data-method-name="${gcashLabel}">
                ${buildEnrollmentPaymentMethodDetails(gcashMethod)}
                <section class="dp-card" id="downpaymentScreenshotField" style="display:${gcashMethodId ? 'block' : 'none'};" aria-labelledby="downpaymentReceiptTitle">
                    <div class="dp-card-title-row">
                        <div>
                            <div class="dp-card-heading">
                                <span class="dp-section-icon solid"><i class="bi bi-cloud-arrow-up" aria-hidden="true"></i></span>
                                <h3 id="downpaymentReceiptTitle">Payment Receipt <span class="dp-badge">GCash</span></h3>
                            </div>
                            <p class="dp-card-description">Upload your GCash payment screenshot so we can read the amount<br class="d-none d-md-block"> and reference number automatically.</p>
                        </div>
                        <button type="button" class="dp-read-receipt" id="downpaymentRunOcr"><i class="bi bi-bounding-box" aria-hidden="true"></i> Read Receipt</button>
                    </div>
                    <label class="dp-upload-zone" for="downpaymentScreenshotInput">
                        <input type="file" id="downpaymentScreenshotInput" accept="image/jpeg,image/png,.jpg,.jpeg,.png" required>
                        <span class="dp-upload-copy">
                            <i class="bi bi-cloud-arrow-up" aria-hidden="true"></i>
                            <span class="dp-upload-title">Upload GCash screenshot</span>
                            <span class="dp-upload-subtitle" id="downpaymentUploadFilename">Drag and drop your file here, or click to browse</span>
                        </span>
                    </label>
                    <small class="dp-help">Supports JPG, PNG files up to 10MB.</small>
                    <div class="small d-block mt-1 text-muted" id="downpaymentOcrStatus" data-ocr-busy="false">
                        Upload the screenshot first to auto-fill the amount and reference number.
                    </div>
                    <div class="dp-preview d-none" id="downpaymentScreenshotPreviewWrapper">
                        <img id="downpaymentScreenshotPreviewImage" alt="GCash payment screenshot preview" class="img-fluid rounded-3">
                    </div>
                </section>

                <section class="dp-card" aria-labelledby="detectedPaymentTitle">
                    <div class="dp-card-heading">
                        <span class="dp-section-icon solid"><i class="bi bi-receipt" aria-hidden="true"></i></span>
                        <h3 id="detectedPaymentTitle">Detected Payment Details <span class="dp-badge success">Auto-filled</span></h3>
                    </div>
                    <p class="dp-card-description mb-3">We've read the information from your receipt. You can still edit if needed.</p>
                    <div class="dp-field-grid">
                        <div class="dp-field">
                            <label class="form-label" for="downpaymentAmountInput">Amount</label>
                            <div class="input-group">
                                <span class="input-group-text">&#8369;</span>
                                <input type="number" class="form-control" id="downpaymentAmountInput" value="0.00" step="0.01" min="0" required>
                            </div>
                            <small class="dp-help">Auto-filled from your receipt.</small>
                        </div>
                        <div class="dp-field" id="referenceField" style="display:${gcashMethodId ? 'block' : 'none'};">
                            <label class="form-label" for="transactionReferenceInput">GCash Reference Number</label>
                            <input type="text" class="form-control" id="transactionReferenceInput" placeholder="Enter transaction reference number" required>
                            <small class="dp-help">Auto-filled from your receipt.</small>
                        </div>
                    </div>
                </section>
            `;

            markRequiredFieldLabels(form);
            bindDownpaymentUploadFilename();
            bindEnrollmentPaymentMethodDetails(gcashMethod);

            const programSelect = document.getElementById('downpaymentProgramInput');
            if (programSelect) {
                programSelect.addEventListener('change', function() {
                    const selectedOption = this.options[this.selectedIndex];
                    const tuition = parseFloat(selectedOption?.dataset?.tuition || 0);
                    const downpayment = parseFloat(selectedOption?.dataset?.downpayment || 0);
                    const feeInput = document.getElementById('estimatedProgramFee');
                    const downpaymentPreview = document.getElementById('programDownpaymentPreview');
                    const amountInput = document.getElementById('downpaymentAmountInput');

                    if (feeInput) {
                        feeInput.value = `PHP ${tuition.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                    }
                    if (downpaymentPreview) {
                        downpaymentPreview.value = `PHP ${downpayment.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                    }
                    if (amountInput) {
                        amountInput.value = downpayment.toFixed(2);
                    }

                    loadProgramProductsPreview(this.value, 'downpaymentProgramProductsPreview');
                });
            }

            ensureStudentPaymentOcrHelpers()
                .then(() => {
                    if (typeof window.attachGcashOcrAutoFill === 'function') {
                        window.attachGcashOcrAutoFill({
                            fileInputId: 'downpaymentScreenshotInput',
                            actionButtonId: 'downpaymentRunOcr',
                            amountInputId: 'downpaymentAmountInput',
                            refInputId: 'transactionReferenceInput',
                            statusId: 'downpaymentOcrStatus',
                            previewWrapperId: 'downpaymentScreenshotPreviewWrapper',
                            previewImageId: 'downpaymentScreenshotPreviewImage'
                        });
                    }
                })
                .catch(error => {
                    console.error('Unable to load OCR helpers for downpayment:', error);
                    const statusElement = document.getElementById('downpaymentOcrStatus');
                    if (statusElement) {
                        statusElement.className = 'alert alert-warning mt-2 mb-0';
                        statusElement.textContent = 'Receipt OCR is unavailable right now. Please fill in the amount and reference number manually.';
                    }
                });
        })
        .catch(err => {
            console.error('Error loading payment methods:', err);
            form.innerHTML = '<div class="alert alert-danger">Error loading payment methods. Please refresh and try again.</div>';
        });
}

async function handleSubmitDownpayment() {
    const programId = document.getElementById('downpaymentProgramInput')?.value;
    const amount = parseFloat(document.getElementById('downpaymentAmountInput')?.value);
    const methodId = document.getElementById('paymentMethodInput')?.value || null;
    const ref = document.getElementById('transactionReferenceInput')?.value.trim();
    const screenshotFile = document.getElementById('downpaymentScreenshotInput')?.files?.[0] || null;
    const ocrBusy = document.getElementById('downpaymentOcrStatus')?.dataset.ocrBusy === 'true';

    if (!programId) {
        Swal.fire("Program Required", "Please select a tutorial program first.", "warning");
        return;
    }
    if (!amount || amount <= 0 || Number.isNaN(amount)) {
        Swal.fire("Invalid Amount", "Please enter a valid downpayment amount.", "warning");
        return;
    }
    if (!methodId) {
        Swal.fire("Invalid Payment", "GCash payment is not configured. Please contact administrator.", "warning");
        return;
    }
    if (!screenshotFile) {
        Swal.fire("Missing Screenshot", "Please upload the GCash payment screenshot first.", "warning");
        return;
    }
    if (screenshotFile.size > 10 * 1024 * 1024) {
        Swal.fire("File Too Large", "Please upload a JPG or PNG receipt no larger than 10MB.", "warning");
        return;
    }
    if (ocrBusy) {
        Swal.fire("Reading Screenshot", "OCR is still reading the receipt. Please wait a moment.", "info");
        return;
    }
    if (!ref) {
        Swal.fire("Missing Reference", "Please enter your GCash transaction reference number.", "warning");
        return;
    }

    Swal.fire({
        title: 'Processing Downpayment...',
        didOpen: () => Swal.showLoading(),
        allowOutsideClick: false
    });

    const payload = {
        program_id: programId,
        amount,
        method: methodId,
        ref: ref || null,
        school_year_id: globalLookups.active_school_year ? globalLookups.active_school_year.school_year_id : null
    };

    try {
        const formData = new FormData();
        formData.append('operation', 'createPendingDownpaymentEnrollment');
        formData.append('json', JSON.stringify(payload));
        formData.append('payment_screenshot', screenshotFile);

        const res = await axios.post('../../api/admin/enrollment.php', formData);

        Swal.close();

        if (res.data.status === 'success') {
            pendingDownpaymentEnrollment = {
                enrollment_id: res.data.enrollment_id,
                program_id: res.data.program_id,
                school_year_id: res.data.enrollment_header_id ? res.data.enrollment_header_id : null,
                program_name: res.data.program_display_name,
                program_type: res.data.program_type
            };

            const downpaymentModal = bootstrap.Modal.getInstance(document.getElementById('downpaymentModal'));
            if (downpaymentModal) {
                downpaymentModal.hide();
            }

            const receiptData = {
                enrollmentId: res.data.enrollment_id,
                studentName: res.data.student_name || 'Student',
                programName: res.data.program_display_name || '',
                programType: res.data.program_type || '',
                paymentFor: 'Enrollment Downpayment',
                paymentMethod: res.data.payment_method || 'GCash',
                referenceNo: res.data.reference_no || ref,
                paymentScreenshotPath: res.data.payment_screenshot_path || null,
                receiptNo: res.data.receipt_id || null,
                amountPaid: amount,
                balance: parseFloat(res.data.balance || 0),
                totalAmount: amount,
                paymentDate: new Date()
            };

            const receiptHandler = getStudentReceiptHandler();
            if (typeof receiptHandler === 'function') {
                await receiptHandler(receiptData);
            }

            const enrollmentModal = new bootstrap.Modal(document.getElementById('enrollmentDetailsModal'));
            enrollmentModal.show();
        } else {
            Swal.fire("Error", res.data.message || "Failed to process downpayment.", "error");
        }
    } catch (err) {
        Swal.close();
        console.error(err);
        Swal.fire("Error", "Network error while processing downpayment.", "error");
    }
}

function generateOptions(dataArray, valueKey, textKey) {
    if (!Array.isArray(dataArray)) return "";
    return dataArray.map(item => `<option value="${item[valueKey]}">${item[textKey]}</option>`).join('');
}

function generateOptionsWithType(dataArray, valueKey, textKey, typeKey) {
    if (!Array.isArray(dataArray)) return "";
    return dataArray.map(item => {
        const typeObj = globalLookups.program_types?.find(pt => pt.program_type_id == item[typeKey]);
        const typeName = typeObj ? typeObj.type : item[typeKey];
        return `<option value="${item[valueKey]}">${item[textKey]} (${typeName})</option>`;
    }).join('');
}

function formatTime(time24) {
    if (!time24) return '';
    const [hours, minutes] = time24.split(':');
    const hour12 = parseInt(hours) % 12 || 12;
    const ampm = parseInt(hours) >= 12 ? 'PM' : 'AM';
    return `${hour12}:${minutes} ${ampm}`;
}
