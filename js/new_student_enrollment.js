import { AgreementForm } from './modules/agreements.js?v=20261014-select-all';
(() => {
    const agreementForm = new AgreementForm(document.getElementById('newStudentAgreements'));
    const API_URL = 'api/enrollment_application.php';
    const PH_ADDRESS_API_BASE = 'https://psgc.cloud/api/v2';
    const DRAFT_KEY = 'cdoTutorEnrollmentDraftV1';
    let draftReady = false;
    let otpCountdownInterval = null;
    let otpSending = false;
    // Remove legacy browser-saved tracking tokens; tracking now uses student details.
    try { localStorage.removeItem('cdoTutorEnrollmentApplications'); } catch (_) {}
    const NCR_ADDRESS_OPTION = { code: '1300000000', name: 'Metro Manila (NCR)' };
    const state = {
        step: 1,
        lookups: null,
        verificationId: null,
        verificationToken: null,
        verificationEmail: '',
        verificationExpiresAt: 0,
        otpResendAvailableAt: 0,
        tracking: null,
        availability: [],
        availableSteps: new Set([1]),
        currentApplication: null,
        financialPreview: null,
        applicationSubmitted: false,
        addressCache: { provinces: null, cities: {}, barangays: {} }
    };

    const $ = id => document.getElementById(id);
    const draftFields = ['firstName', 'middleName', 'lastName', 'extension', 'nickname', 'birthday',
        'gender', 'healthNote', 'guardianName', 'guardianContact', 'guardianRelationship',
        'otherGuardianRelationship', 'email', 'street', 'addressNote', 'program', 'branch',
        'gradeLevel', 'otherSubjectName', 'goal', 'preferredSessionHours', 'availabilityDay', 'availabilityStart', 'availabilityEnd'];

    function clearDraft() {
        try { sessionStorage.removeItem(DRAFT_KEY); } catch (_) {}
    }

    function saveDraft() {
        if (!draftReady) return;
        try {
            const fields = Object.fromEntries(draftFields.map(id => [id, $(id).value]));
            const address = Object.fromEntries(['province', 'city', 'barangay'].map(id =>
                [id, { value: $(id).value, code: selectedAddressCode($(id)) }]));
            sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
                version: 1, savedAt: Date.now(), fields, address,
                subjects: [...document.querySelectorAll('#subjectPicker input:checked')].map(input => input.value),
                availability: state.availability, step: state.step, availableSteps: [...state.availableSteps],
                verificationId: state.verificationId, verificationToken: state.verificationToken,
                verificationEmail: state.verificationEmail, verificationExpiresAt: state.verificationExpiresAt,
                otpResendAvailableAt: state.otpResendAvailableAt,
                tracking: state.tracking,
                includeService: Boolean(state.financialPreview?.service_id),
                serviceId: state.financialPreview?.service_id || null,
                payment: Object.fromEntries(['applicationPaymentMethod', 'applicationPaymentAmount', 'applicationPaymentReference']
                    .map(id => [id, $(id)?.value || '']))
            }));
            $('enrollmentDraftStatus').textContent = 'Progress saved in this tab. You can safely refresh. Payment screenshots must be selected again.';
        } catch (_) {
            $('enrollmentDraftStatus').textContent = 'Your browser cannot save progress. Keep this page open until you submit.';
        }
    }

    function readDraft() {
        try {
            const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY));
            if (!draft) return null;
            if (draft.version !== 1 || !draft.fields || !Number.isFinite(draft.savedAt)
                || Date.now() - draft.savedAt > 24 * 60 * 60 * 1000) {
                clearDraft();
                return null;
            }
            return draft;
        } catch (_) { clearDraft(); return null; }
    }

    async function restoreDraft(draft) {
        if (!draft) return;
        state.otpResendAvailableAt = Number(draft.otpResendAvailableAt) || 0;
        updateOtpResendButton();
        draftFields.forEach(id => {
            if (typeof draft.fields[id] === 'string') $(id).value = draft.fields[id];
        });
        // Address choices depend on the province/city, so rebuild them in order.
        const restoreAddressValue = id => {
            const saved = draft.address?.[id];
            if (!saved?.value) return;
            const select = $(id);
            if (![...select.options].some(option => option.value === saved.value)) {
                const option = new Option(saved.value, saved.value);
                option.dataset.code = saved.code || '';
                select.add(option);
            }
            select.value = saved.value;
            select.disabled = false;
        };
        restoreAddressValue('province');
        try { await loadCities(selectedAddressCode($('province'))); } catch (_) {}
        restoreAddressValue('city');
        try { await loadBarangays(selectedAddressCode($('city'))); } catch (_) {}
        restoreAddressValue('barangay');
        document.querySelectorAll('#subjectPicker input').forEach(input => {
            input.checked = Array.isArray(draft.subjects) && draft.subjects.includes(input.value);
        });
        state.availability = Array.isArray(draft.availability) ? draft.availability.filter(slot =>
            slot && typeof slot.day === 'string' && /^\d{2}:\d{2}$/.test(slot.start_time)
            && /^\d{2}:\d{2}$/.test(slot.end_time)) : [];
        updateGuardianRelationshipField();
        updateSubjectSelection();
        updateProgramPreferenceFields();
        agreementForm.setProgram($('program').value, $('guardianName').value, selectedProgram()?.program_type_name || selectedProgram()?.program_type || '');
        renderAvailability();
        const program = selectedProgram();
        $('programSummary').textContent = program ? `${program.total_units} ${program.unit_type}${Number(program.total_units) === 1 ? '' : 's'}` : '';
        const branch = state.lookups?.branches?.find(item => String(item.branch_id) === $('branch').value);
        $('branchSummary').textContent = branch ? [branch.branch_location, branch.operating_days].filter(Boolean).join(' • ') : '';
        state.availableSteps = new Set([1, ...(Array.isArray(draft.availableSteps) ? draft.availableSteps.filter(step => step === 2) : [])]);
        const verificationValid = draft.verificationEmail === personalPayload().email && draft.verificationExpiresAt > Date.now();
        if (verificationValid) {
            state.verificationId = draft.verificationId;
            state.verificationToken = draft.verificationToken;
            state.verificationEmail = draft.verificationEmail;
            state.verificationExpiresAt = draft.verificationExpiresAt;
        }
        $('verificationEmailLabel').textContent = personalPayload().email;
        $('verificationSuccess').classList.toggle('d-none', !state.verificationToken);
        $('continueToPreferences').disabled = !state.verificationToken;
        $('otpEntry').classList.toggle('d-none', !state.verificationId || Boolean(state.verificationToken));
        if (state.verificationToken && draft.availableSteps?.includes(3)) state.availableSteps.add(3);
        let step = Number(draft.step) || 1;
        if (step >= 3 && !state.verificationToken) step = state.availableSteps.has(2) ? 2 : 1;
        if (state.verificationToken && draft.availableSteps?.includes(4) && $('program').value && $('branch').value) {
            try {
                const result = await api('getFinancialPreview', {
                    program_id: $('program').value, branch_id: $('branch').value,
                    include_service: Boolean(draft.includeService), service_id: draft.serviceId
                });
                if (result.status !== 'success') throw new Error(result.message);
                renderApplicationBilling(result.data, false);
                if (draft.payment && $('applicationPaymentMethod')) {
                    $('applicationPaymentMethod').value = draft.payment.applicationPaymentMethod || '';
                    renderPaymentMethodDetail(result.data);
                    ['applicationPaymentAmount', 'applicationPaymentReference'].forEach(id => {
                        if ($(id) && typeof draft.payment[id] === 'string') $(id).value = draft.payment[id];
                    });
                }
                state.availableSteps.add(4);
            } catch (_) { step = 3; }
        }
        showStep(state.availableSteps.has(step) ? step : 1, false);
        if (draft.tracking) {
            state.tracking = draft.tracking;
            state.applicationSubmitted = true;
            await showApplicationStatus(draft.tracking);
        }
    }
    const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
    const Swal = window.Swal || (() => {
        const plainText = html => {
            const container = document.createElement('div');
            container.innerHTML = String(html || '');
            return container.textContent.trim();
        };
        return {
            async fire(...args) {
                const options = typeof args[0] === 'object' ? args[0] : { title: args[0], text: args[1], icon: args[2] };
                const message = [options.title, options.text || plainText(options.html)].filter(Boolean).join('\n\n');
                options.didOpen?.();
                const isConfirmed = options.showCancelButton ? window.confirm(message) : (window.alert(message), true);
                options.didClose?.();
                return { isConfirmed, isDismissed: !isConfirmed };
            },
            showLoading() {},
            close() {},
            showValidationMessage(message) { window.alert(message); }
        };
    })();
    const money = value => `₱ ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const formatTime = value => {
        if (!value) return '';
        const [hours, minutes] = String(value).split(':').map(Number);
        const date = new Date(2000, 0, 1, hours, minutes || 0);
        return date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
    };

    async function api(operation, data = {}) {
        const body = new URLSearchParams();
        body.set('operation', operation);
        body.set('json', JSON.stringify(data));
        const response = await axios.post(API_URL, body);
        return response.data;
    }

    async function multipartApi(operation, data, file = null) {
        const body = new FormData();
        body.set('operation', operation);
        body.set('json', JSON.stringify(data));
        if (file) body.set('payment_screenshot', file);
        const response = await axios.post(API_URL, body);
        return response.data;
    }

    function resetAddressSelect(select, placeholder) {
        select.replaceChildren(new Option(placeholder, ''));
        select.disabled = true;
    }

    function setAddressOptions(select, items, placeholder) {
        select.replaceChildren(new Option(placeholder, ''));
        items.forEach(item => {
            const option = new Option(String(item.name || '').trim(), String(item.name || '').trim());
            option.dataset.code = item.code || '';
            select.add(option);
        });
        select.disabled = false;
    }

    function addressItems(response) {
        if (Array.isArray(response)) return response;
        return Array.isArray(response?.data) ? response.data : [];
    }

    function selectedAddressCode(select) {
        return select.selectedOptions[0]?.dataset?.code || '';
    }

    async function loadProvinces() {
        if (!state.addressCache.provinces) {
            const response = await axios.get(`${PH_ADDRESS_API_BASE}/provinces`);
            const byCode = new Map([NCR_ADDRESS_OPTION, ...addressItems(response.data)].map(item => [item.code, item]));
            state.addressCache.provinces = [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name));
        }
        setAddressOptions($('province'), state.addressCache.provinces, 'Select province');
    }

    async function loadCities(provinceCode) {
        resetAddressSelect($('city'), provinceCode ? 'Loading cities...' : 'Select a province first');
        resetAddressSelect($('barangay'), 'Select a city/municipality first');
        if (!provinceCode) return;
        if (!state.addressCache.cities[provinceCode]) {
            const endpoint = provinceCode === NCR_ADDRESS_OPTION.code
                ? `${PH_ADDRESS_API_BASE}/regions/${provinceCode}/cities-municipalities`
                : `${PH_ADDRESS_API_BASE}/provinces/${provinceCode}/cities-municipalities`;
            const response = await axios.get(endpoint);
            state.addressCache.cities[provinceCode] = addressItems(response.data).sort((a, b) => a.name.localeCompare(b.name));
        }
        setAddressOptions($('city'), state.addressCache.cities[provinceCode], 'Select city / municipality');
    }

    async function loadBarangays(cityCode) {
        resetAddressSelect($('barangay'), cityCode ? 'Loading barangays...' : 'Select a city/municipality first');
        if (!cityCode) return;
        if (!state.addressCache.barangays[cityCode]) {
            const response = await axios.get(`${PH_ADDRESS_API_BASE}/cities-municipalities/${cityCode}/barangays`);
            state.addressCache.barangays[cityCode] = addressItems(response.data).sort((a, b) => a.name.localeCompare(b.name));
        }
        setAddressOptions($('barangay'), state.addressCache.barangays[cityCode], 'Select barangay');
    }

    async function initPhilippineAddresses() {
        resetAddressSelect($('city'), 'Select a province first');
        resetAddressSelect($('barangay'), 'Select a city/municipality first');
        $('province').replaceChildren(new Option('Loading provinces...', ''));
        $('province').disabled = true;
        try {
            await loadProvinces();
        } catch (error) {
            console.error('Unable to load Philippine provinces:', error);
            resetAddressSelect($('province'), 'Unable to load provinces');
            await Swal.fire('Address List Unavailable', 'The Philippine address list could not be loaded. Check your internet connection, then refresh this page.', 'error');
        }
    }

    function localMobileDigits(value) {
        let digits = String(value || '').replace(/\D/g, '');
        if (digits.startsWith('0063')) digits = digits.slice(4);
        else if (digits.startsWith('63')) digits = digits.slice(2);
        else if (digits.startsWith('0')) digits = digits.slice(1);
        return digits.slice(0, 10);
    }

    function formatPhilippineMobile(value) {
        const digits = localMobileDigits(value);
        return digits ? `+63${digits}` : '';
    }

    function clearFieldError(element) {
        if (!element) return;
        element.classList.remove('enrollment-field-error');
        element.removeAttribute('aria-invalid');
        element.closest('.contact-number-group')?.classList.remove('enrollment-field-error');
    }

    function addFieldError(element) {
        if (!element) return;
        element.classList.add('enrollment-field-error');
        element.setAttribute('aria-invalid', 'true');
        element.closest('.contact-number-group')?.classList.add('enrollment-field-error');
    }

    function showValidationErrors(errors, title = 'Please Check the Form') {
        errors.forEach(error => addFieldError(error.element));
        const first = errors[0]?.element;
        Swal.fire({
            icon: 'warning',
            title,
            html: `<p class="mb-2">Please correct the following:</p><ul class="validation-error-list">${errors.map(error => `<li>${escapeHtml(error.message)}</li>`).join('')}</ul>`,
            confirmButtonText: 'Review Fields',
            didClose: () => {
                first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                first?.focus({ preventScroll: true });
            }
        });
    }

    function showServerFieldError(title, message) {
        const normalized = String(message || '').toLowerCase();
        const fieldRules = [
            [['contact number', 'guardian contact'], 'guardianContact'],
            [['email'], 'email'],
            [['birthdate', 'birthday'], 'birthday'],
            [['gender'], 'gender'],
            [['first name'], 'firstName'],
            [['last name'], 'lastName'],
            [['guardian name'], 'guardianName'],
            [['relationship'], $('guardianRelationship').value === 'others' ? 'otherGuardianRelationship' : 'guardianRelationship'],
            [['house/street', 'street'], 'street'],
            [['barangay'], 'barangay'],
            [['city/municipality', 'city'], 'city'],
            [['province'], 'province'],
            [['requested subject'], 'otherSubjectName'],
            [['program'], 'program'],
            [['branch', 'center'], 'branch'],
            [['availability', 'preferred time'], 'availabilityList']
        ];
        const match = fieldRules.find(([terms]) => terms.some(term => normalized.includes(term)));
        if (!match) return false;
        const element = $(match[1]);
        const step = Number(element.closest('[data-form-step]')?.dataset.formStep || state.step);
        if (step !== state.step) showStep(step);
        showValidationErrors([{ element, message }], title);
        return true;
    }

    function setBusy(button, busy, text = 'Please wait…') {
        if (!button) return;
        if (busy) {
            button.dataset.originalText = button.innerHTML;
            button.disabled = true;
            button.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>${text}`;
        } else {
            button.disabled = false;
            button.innerHTML = button.dataset.originalText || button.innerHTML;
        }
    }

    function showStep(step, scrollToCard = true) {
        if (!state.availableSteps.has(step)) return;
        state.step = step;
        saveDraft();
        document.querySelectorAll('[data-form-step]').forEach(section => section.classList.toggle('active', Number(section.dataset.formStep) === step));
        document.querySelectorAll('[data-step-indicator]').forEach(indicator => {
            const number = Number(indicator.dataset.stepIndicator);
            indicator.classList.toggle('active', number === step);
            indicator.classList.toggle('complete', state.availableSteps.has(number) && number < step);
            indicator.classList.toggle('available', state.availableSteps.has(number));
            indicator.setAttribute('aria-disabled', String(!state.availableSteps.has(number)));
        });
        if (scrollToCard) {
            const card = document.querySelector('.application-card');
            const header = document.querySelector('.landing-header');
            if (card) {
                const headerHeight = header?.getBoundingClientRect().height || 0;
                const top = card.getBoundingClientRect().top + window.scrollY - headerHeight - 12;
                window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
            }
        }
    }

    function unlockAndShowStep(step) {
        state.availableSteps.add(step);
        showStep(step);
    }

    function updateGuardianRelationshipField() {
        const other = $('guardianRelationship').value === 'others';
        $('otherGuardianRelationshipField').classList.toggle('d-none', !other);
        $('otherGuardianRelationship').disabled = !other;
        $('otherGuardianRelationship').required = other;
        clearFieldError($('otherGuardianRelationship'));
        if (other) $('otherGuardianRelationship').focus();
    }

    function guardianRelationshipValue() {
        return ($('guardianRelationship').value === 'others'
            ? $('otherGuardianRelationship').value
            : $('guardianRelationship').value).trim().replace(/\s+/g, ' ');
    }

    function personalPayload() {
        return {
            first_name: $('firstName').value.trim(),
            middle_name: $('middleName').value.trim(),
            last_name: $('lastName').value.trim(),
            ext: $('extension').value.trim(),
            nickname: $('nickname').value.trim(),
            birthday: $('birthday').value,
            gender_id: $('gender').value || null,
            health_note: $('healthNote').value.trim(),
            guardian_name: $('guardianName').value.trim(),
            guardian_contact: formatPhilippineMobile($('guardianContact').value),
            guardian_relationship: guardianRelationshipValue(),
            email: $('email').value.trim().toLowerCase(),
            adr_street: $('street').value.trim(),
            adr_barangay: $('barangay').value.trim(),
            adr_city: $('city').value.trim(),
            adr_province: $('province').value.trim(),
            adr_note: $('addressNote').value.trim()
        };
    }

    function validatePersonalStep() {
        const errors = [];
        const required = {
            firstName: 'First name is required.',
            lastName: 'Last name is required.',
            birthday: 'Birthdate is required.',
            gender: 'Gender is required.',
            guardianName: 'Parent/guardian full name is required.',
            guardianContact: 'Contact number is required.',
            guardianRelationship: 'Guardian relationship is required.',
            email: 'Parent/guardian email is required.',
            province: 'Province is required.',
            city: 'City/municipality is required.',
            barangay: 'Barangay is required.',
            street: 'House/street is required.'
        };

        Object.entries(required).forEach(([id, message]) => {
            const element = $(id);
            clearFieldError(element);
            if (!String(element.value || '').trim()) errors.push({ element, message });
        });

        const addOnce = (element, message) => {
            if (!errors.some(error => error.element === element)) errors.push({ element, message });
        };
        clearFieldError($('otherGuardianRelationship'));
        if ($('guardianRelationship').value === 'others') {
            const relationship = guardianRelationshipValue();
            if (!relationship || [...relationship].length > 50 || /^(other|others)$/i.test(relationship) || /\p{C}/u.test(relationship)) {
                addOnce($('otherGuardianRelationship'), 'Specify the guardian relationship using 1 to 50 characters.');
            }
        }
        const birthday = $('birthday').value ? new Date(`${$('birthday').value}T00:00:00`) : null;
        const minimumBirthdate = new Date();
        minimumBirthdate.setHours(0, 0, 0, 0);
        minimumBirthdate.setFullYear(minimumBirthdate.getFullYear() - 2);
        if (birthday && (Number.isNaN(birthday.getTime()) || birthday > minimumBirthdate)) {
            addOnce($('birthday'), 'Student must be at least 2 years old.');
        }
        if ($('email').value && !$('email').checkValidity()) {
            addOnce($('email'), 'Enter a valid email address.');
        }
        if ($('guardianContact').value && !/^\+639\d{9}$/.test(formatPhilippineMobile($('guardianContact').value))) {
            addOnce($('guardianContact'), 'Contact number must contain 10 digits beginning with 9.');
        }
        if (errors.length) {
            if (state.step !== 1) showStep(1);
            showValidationErrors(errors, 'Student Information Needs Attention');
            return false;
        }
        return true;
    }

    function selectedProgram() {
        return state.lookups?.programs?.find(program => String(program.program_id) === $('program').value) || null;
    }

    function isTutorialProgram(program = selectedProgram()) {
        if (!program) return false;
        return `${program.name || ''} ${program.program_type || ''}`.toLowerCase().includes('tutorial');
    }

    function isPreschoolProgram(program) {
        const descriptor = typeof program === 'string'
            ? program
            : `${program?.name || ''} ${program?.program_type || ''}`;
        const normalized = descriptor.toLowerCase();
        return ['preschool', 'playschool', 'pre-school', 'play-school', 'pre school', 'play school']
            .some(keyword => normalized.includes(keyword));
    }

    function closeSubjectDropdown() {
        $('subjectPicker').classList.add('d-none');
        $('subjectDropdownToggle').classList.remove('open');
        $('subjectDropdownToggle').setAttribute('aria-expanded', 'false');
    }

    function updateSubjectSelection() {
        const checked = [...document.querySelectorAll('#subjectPicker input:checked')];
        const otherSelected = checked.some(input => input.value === 'others');
        $('otherSubjectField').classList.toggle('d-none', !otherSelected);
        $('otherSubjectName').disabled = !otherSelected;
        $('otherSubjectName').required = otherSelected;
        if (!otherSelected) clearFieldError($('otherSubjectName'));
        const names = checked.map(input => input.value === 'others'
            ? ($('otherSubjectName').value.trim() || 'Others')
            : input.closest('.subject-dropdown-option')?.querySelector('.subject-name')?.textContent.trim()).filter(Boolean);
        $('subjectSelectionText').textContent = names.length ? `${names.length} subject${names.length === 1 ? '' : 's'} selected` : 'Select one or more subjects';
        $('selectedSubjectsSummary').textContent = names.join(', ');
    }

    function clearTutorialPreferences() {
        $('preferredSessionHours').value = '1';
        $('gradeLevel').value = '';
        $('goal').value = '';
        document.querySelectorAll('#subjectPicker input:checked').forEach(input => { input.checked = false; });
        $('otherSubjectName').value = '';
        state.availability = [];
        updateSubjectSelection();
        renderAvailability();
        closeSubjectDropdown();
        clearFieldError($('availabilityList'));
    }

    function updateProgramPreferenceFields(program = selectedProgram()) {
        const tutorial = isTutorialProgram(program);
        const hours = Number(program?.total_units) || 12;
        $('sessionDurationNote').textContent = `The program includes ${hours} consumable hours in total. Each session uses the selected duration from that balance. For 12 hours: 12 one-hour sessions, 8 sessions of 1 hour and 30 minutes, or 6 two-hour sessions. The center will confirm your final schedule.`;
        $('tutorialPreferences').classList.toggle('d-none', !tutorial);
        $('learningPreferenceHelp').classList.toggle('d-none', Boolean(program));
        $('learningPreferenceHelp').textContent = !program
            ? 'Select a program first. Tutorial preferences will appear only when a Tutorial program is selected.'
            : '';
        if (program && !tutorial) clearTutorialPreferences();
    }

    async function loadLookups() {
        const result = await api('getLookups');
        if (result.status !== 'success') throw new Error(result.message || 'Unable to load enrollment choices.');
        state.lookups = result.data;
        $('guardianRelationship').replaceChildren(new Option('Select relationship', ''));
        result.data.relationships.forEach(item => $('guardianRelationship').add(new Option(item.relationship_name, item.relationship_name)));
        $('guardianRelationship').add(new Option('Others', 'others'));
        $('gender').innerHTML = '<option value="">Select gender</option>' + result.data.genders.map(item => `<option value="${item.gender_id}">${escapeHtml(item.gender)}</option>`).join('');
        $('program').innerHTML = '<option value="">Select program</option>' + result.data.programs.map(item => `<option value="${item.program_id}">${escapeHtml(item.name)}${item.program_type ? ` (${escapeHtml(item.program_type)})` : ''}</option>`).join('');
        $('branch').innerHTML = '<option value="">Select branch</option>' + result.data.branches.map(item => `<option value="${item.branch_id}">${escapeHtml(item.branch_name)}</option>`).join('');
        const activeGrades = Array.isArray(result.data.grades) ? result.data.grades : [];
        $('gradeLevel').innerHTML = activeGrades.length
            ? '<option value="">Select grade level</option>' + activeGrades.map(item => `<option value="${item.grade_level_id}">${escapeHtml(item.grade_level)}</option>`).join('')
            : '<option value="">No active grade levels available</option>';
        $('gradeLevel').disabled = activeGrades.length === 0;
        $('subjectPicker').innerHTML = result.data.subjects.map(item => `<label class="subject-dropdown-option"><input type="checkbox" value="${item.subject_id}"><span class="subject-name">${escapeHtml(item.subject_name)}</span><i class="bi bi-check2"></i></label>`).join('')
            + '<label class="subject-dropdown-option"><input type="checkbox" id="otherSubjectOption" value="others"><span class="subject-name">Others</span><i class="bi bi-check2"></i></label>';
        updateSubjectSelection();
        updateProgramPreferenceFields();
    }

    async function continueToVerification() {
        if (!validatePersonalStep()) return;
        const button = $('continueToVerification');
        setBusy(button, true, 'Checking student…');
        try {
            const result = await api('checkStudent', personalPayload());
            if (result.existing_student) {
                await Swal.fire({
                    icon: 'info',
                    title: 'Existing Student Found',
                    html: `This student already has a record or application${result.student_id_number ? ` (${escapeHtml(result.student_id_number)})` : ''}. Track the existing application, use Student Login if already enrolled, or contact the center.`,
                    confirmButtonText: 'Student Login',
                    showCancelButton: true
                }).then(answer => { if (answer.isConfirmed) window.location.href = 'login.html'; });
                return;
            }
            $('verificationEmailLabel').textContent = personalPayload().email;
            state.verificationId = null;
            state.verificationToken = null;
            state.verificationEmail = '';
            state.verificationExpiresAt = 0;
            state.availableSteps = new Set([1]);
            $('otpEntry').classList.add('d-none');
            $('verificationSuccess').classList.add('d-none');
            $('continueToPreferences').disabled = true;
            unlockAndShowStep(2);
        } catch (error) {
            Swal.fire('Unable to Check Student', error.response?.data?.message || error.message, 'error');
        } finally {
            setBusy(button, false);
        }
    }

    function updateOtpResendButton() {
        if (otpCountdownInterval !== null) {
            window.clearInterval(otpCountdownInterval);
            otpCountdownInterval = null;
        }
        const update = () => {
            const remaining = Math.max(0, Math.ceil((state.otpResendAvailableAt - Date.now()) / 1000));
            const button = $('sendOtpButton');
            if (!otpSending) {
                button.disabled = remaining > 0;
                button.textContent = remaining > 0
                    ? `Resend Code in ${remaining}s`
                    : (state.verificationId ? 'Resend Verification Code' : 'Send Verification Code');
            }
            if (!remaining && otpCountdownInterval !== null) {
                window.clearInterval(otpCountdownInterval);
                otpCountdownInterval = null;
            }
            return remaining;
        };
        if (update() > 0) otpCountdownInterval = window.setInterval(update, 1000);
    }

    async function sendOtp() {
        if (otpSending || state.otpResendAvailableAt > Date.now()) return;
        otpSending = true;
        const button = $('sendOtpButton');
        setBusy(button, true, 'Sending code…');
        try {
            const result = await api('sendOtp', personalPayload());
            if (result.status !== 'success') throw new Error(result.message);
            state.otpResendAvailableAt = Date.now() + 60 * 1000;
            state.verificationId = result.verification_id;
            state.verificationToken = null;
            state.verificationEmail = personalPayload().email;
            state.verificationExpiresAt = Date.now() + 10 * 60 * 1000;
            $('verificationSuccess').classList.add('d-none');
            $('continueToPreferences').disabled = true;
            saveDraft();
            $('otpEntry').classList.remove('d-none');
            $('otpCode').focus();
            Swal.fire('Code Sent', result.message, 'success');
        } catch (error) {
            const data = error.response?.data;
            if (String(data?.message || error.message).includes('wait one minute')) {
                state.otpResendAvailableAt = Date.now() + 60 * 1000;
                saveDraft();
            }
            Swal.fire(data?.existing_student ? 'Existing Student Found' : 'Email Not Sent', data?.message || error.message, data?.existing_student ? 'info' : 'error');
        } finally {
            setBusy(button, false);
            otpSending = false;
            updateOtpResendButton();
        }
    }

    async function verifyOtp() {
        const code = $('otpCode').value.trim();
        clearFieldError($('otpCode'));
        if (!/^\d{6}$/.test(code)) {
            showValidationErrors([{ element: $('otpCode'), message: 'Enter the six-digit code from your email.' }], 'Invalid Verification Code');
            return;
        }
        const button = $('verifyOtpButton');
        setBusy(button, true, 'Verifying…');
        try {
            const result = await api('verifyOtp', { verification_id: state.verificationId, email: personalPayload().email, otp: code });
            if (result.status !== 'success') throw new Error(result.message);
            state.verificationToken = result.verification_token;
            state.verificationEmail = personalPayload().email;
            state.verificationExpiresAt = Date.now() + 2 * 60 * 60 * 1000;
            saveDraft();
            $('verificationSuccess').classList.remove('d-none');
            $('continueToPreferences').disabled = false;
            $('otpEntry').classList.add('d-none');
        } catch (error) {
            Swal.fire('Verification Failed', error.response?.data?.message || error.message, 'error');
        } finally {
            setBusy(button, false);
        }
    }

    function renderAvailability() {
        saveDraft();
        if (!state.availability.length) {
            $('availabilityList').innerHTML = '<p class="empty-availability">No preferred times added yet.</p>';
            return;
        }
        $('availabilityList').innerHTML = state.availability.map((slot, index) => `<div class="availability-item"><span><strong>${escapeHtml(slot.day)}</strong>${formatTime(slot.start_time)} to ${formatTime(slot.end_time)}</span><button type="button" data-remove-availability="${index}" aria-label="Remove preferred time"><i class="bi bi-trash"></i></button></div>`).join('');
    }

    function addAvailability() {
        const slot = { day: $('availabilityDay').value, start_time: $('availabilityStart').value, end_time: $('availabilityEnd').value };
        if (!slot.start_time || !slot.end_time || slot.end_time <= slot.start_time) {
            const errors = [];
            clearFieldError($('availabilityStart'));
            clearFieldError($('availabilityEnd'));
            if (!slot.start_time) errors.push({ element: $('availabilityStart'), message: 'Preferred start time is required.' });
            if (!slot.end_time) errors.push({ element: $('availabilityEnd'), message: 'Preferred end time is required.' });
            if (slot.start_time && slot.end_time && slot.end_time <= slot.start_time) {
                errors.push({ element: $('availabilityEnd'), message: 'Preferred end time must be later than the start time.' });
            }
            showValidationErrors(errors, 'Invalid Preferred Time');
            return;
        }
        if (state.availability.some(item => item.day === slot.day && item.start_time === slot.start_time && item.end_time === slot.end_time)) return;
        state.availability.push(slot);
        clearFieldError($('availabilityList'));
        renderAvailability();
    }

    function selectedSubjects() {
        return [...document.querySelectorAll('#subjectPicker input:checked')]
            .filter(input => input.value !== 'others').map(input => Number(input.value));
    }

    function applicationPayload() {
        const tutorial = isTutorialProgram();
        return {
            ...personalPayload(),
            verification_id: state.verificationId,
            verification_token: state.verificationToken,
            program_id: $('program').value,
            branch_id: $('branch').value,
            grade_level_id: tutorial ? ($('gradeLevel').value || null) : null,
            subject_ids: tutorial ? selectedSubjects() : [],
            other_subject: tutorial && $('otherSubjectOption')?.checked ? $('otherSubjectName').value.trim() : null,
            goal: tutorial ? $('goal').value.trim() : '',
            availability: tutorial ? state.availability : [],
            preferred_session_hours: tutorial ? Number($('preferredSessionHours').value) : null
        };
    }

    function validateLearningPreferences() {
        const errors = [];
        [$('program'), $('branch'), $('gradeLevel'), $('availabilityList')].forEach(clearFieldError);
        if (!$('program').value) errors.push({ element: $('program'), message: 'Program is required.' });
        if (!$('branch').value) errors.push({ element: $('branch'), message: 'Preferred center is required.' });
        if (isTutorialProgram() && !$('gradeLevel').value) errors.push({ element: $('gradeLevel'), message: 'Select an active grade level for the Tutorial program.' });
        clearFieldError($('otherSubjectName'));
        if (isTutorialProgram() && $('otherSubjectOption')?.checked && !$('otherSubjectName').value.trim()) {
            errors.push({ element: $('otherSubjectName'), message: 'Enter the subject you would like to study.' });
        }
        if (isTutorialProgram() && !state.availability.length) errors.push({ element: $('availabilityList'), message: 'Add at least one preferred day and time for the Tutorial program.' });
        if (isTutorialProgram() && ![1, 1.5, 2].includes(Number($('preferredSessionHours').value))) errors.push({ element: $('preferredSessionHours'), message: 'Select a session duration.' });
        if (errors.length) {
            showStep(3);
            showValidationErrors(errors, 'Learning Preferences Need Attention');
            return false;
        }
        return true;
    }

    function renderFinancialPreview(financial, billing = null, application = null) {
        if (!financial) return '<div class="alert alert-info">Billing details are not available yet.</div>';
        const grandTotal = Number(financial.grand_total || 0);
        const initialPayment = Math.min(grandTotal, Number(financial.initial_payment || 0));
        const registrationFee = Math.min(grandTotal, Number(financial.registration_fee || 0));
        const downpayment = Math.max(0, initialPayment - registrationFee);
        const tuition = Math.max(0, Number(financial.tuition_amount || 0));
        const otherFees = Array.isArray(financial.other_fees) ? financial.other_fees : [];
        const availableService = financial.available_service || null;
        const discountAmount = Math.max(0, Number(financial.discount_amount || 0));
        const discountName = String(financial.discount_name || '').trim();
        const student = personalPayload();
        const trackedStudentName = [application?.first_name, application?.middle_name, application?.last_name, application?.ext].filter(Boolean).join(' ');
        const studentName = billing?.student_name || trackedStudentName || [student.first_name, student.middle_name, student.last_name, student.ext].filter(Boolean).join(' ') || 'New Student';
        const programName = financial.program?.name || selectedProgram()?.name || 'Selected program';
        const preschool = isPreschoolProgram(`${programName} ${financial.program?.program_type_name || ''}`);
        const serviceSelected = Boolean(financial.service_id);
        const allowServiceToggle = Boolean(availableService) && !application?.application_number && !state.applicationSubmitted;
        const billingSchedule = Array.isArray(billing?.schedule) ? billing.schedule : [];
        const findBill = label => billingSchedule.find(item => String(item.billing_type || '').trim().toLowerCase() === label.toLowerCase());
        const feeCard = (label, note, amount, scheduleLabel = '') => {
            const bill = scheduleLabel ? findBill(scheduleLabel) : null;
            const status = String(bill?.status || '').trim().toLowerCase();
            const statusText = status || (note === 'Required now' ? 'due now' : 'not due now');
            const statusClass = status || (note === 'Required now' ? 'unpaid' : 'upcoming');
            return `<article class="billing-fee-card">
                <div><span>${escapeHtml(label)}</span><small>${escapeHtml(note)}</small></div>
                <div class="billing-fee-value"><strong>${money(amount)}</strong><span class="billing-status billing-status--${escapeHtml(statusClass)}">${escapeHtml(statusText)}</span></div>
            </article>`;
        };
        const primaryFees = [
            ...(registrationFee > 0 ? [feeCard('Registration Fee', 'Required now', registrationFee, 'Registration Fee')] : []),
            ...(downpayment > 0 ? [feeCard('Program Downpayment', 'Required now', downpayment, 'Downpayment')] : []),
            ...(preschool && tuition > 0
                ? [feeCard('Month 1', 'After enrollment', tuition, 'Month 1')]
                : (!preschool && tuition > 0 ? [feeCard('Tuition Fee', 'Remaining program balance', tuition)] : []))
        ].join('');
        const otherFeesMarkup = otherFees.length
            ? otherFees.map(item => `<div class="billing-list-row"><span><i class="bi bi-journal-check"></i>${escapeHtml(item.product_name || 'Program item')}</span><strong>${money(item.price)}</strong></div>`).join('')
            : '<div class="billing-empty-row"><i class="bi bi-check2-circle"></i>No books or other fees for this program.</div>';
        const discountMarkup = discountAmount > 0
            ? `<section class="billing-admin-section billing-discount-section">
                <h3 class="billing-admin-section-title"><span><i class="bi bi-tags-fill"></i></span>Discount / Promo</h3>
                <div class="billing-list"><div class="billing-list-row billing-list-row--discount"><span><i class="bi bi-tag"></i>${escapeHtml(discountName || 'Program discount')}</span><strong>- ${money(discountAmount)}</strong></div></div>
            </section>`
            : '';
        const serviceMarkup = availableService ? `<section class="billing-admin-section">
            <h3 class="billing-admin-section-title"><span><i class="bi bi-bag-check-fill"></i></span>Services</h3>
            <div class="billing-service-card ${serviceSelected ? 'billing-service-card--selected' : ''}">
                <div class="billing-service-copy"><strong>${escapeHtml(availableService.service_name || 'Available service')}</strong><span>${money(availableService.amount)} monthly</span><small>${serviceSelected ? 'This service will be added to every monthly bill.' : 'Optional service. Turn it on if you want it added to every monthly bill.'}</small></div>
                <label class="billing-service-toggle" for="billingServiceToggle">
                    <input type="checkbox" id="billingServiceToggle" role="switch" ${serviceSelected ? 'checked' : ''} ${allowServiceToggle ? '' : 'disabled'}>
                    <span aria-hidden="true"></span><strong>${serviceSelected ? 'Applied' : 'Not applied'}</strong>
                </label>
            </div>
        </section>` : '';
        return `<section class="billing-statement billing-admin-theme">
            <header><div class="billing-heading"><span class="billing-heading-icon"><i class="bi bi-receipt-cutoff"></i></span><div><small>BILLING OVERVIEW</small><h3>${escapeHtml(studentName)}</h3></div></div><div class="billing-program"><small>Program</small><strong>${escapeHtml(programName)}</strong></div></header>
            <div class="billing-admin-body">
                <section class="billing-admin-section">
                    <h3 class="billing-admin-section-title"><span><i class="bi bi-calculator-fill"></i></span>Fee Overview</h3>
                    <div class="billing-fee-grid">${primaryFees}</div>
                </section>
                ${preschool || otherFees.length ? `<section class="billing-admin-section">
                    <h3 class="billing-admin-section-title"><span><i class="bi bi-book-fill"></i></span>Books / Other Fees</h3>
                    <div class="billing-list">${otherFeesMarkup}</div>
                </section>` : ''}
                ${discountMarkup}
                ${serviceMarkup}
            </div>
            <div class="billing-totals">
                <span>Program total <strong>${money(grandTotal)}</strong></span>
                <span class="billing-due-now">Amount due now <strong>${money(initialPayment)}</strong></span>
                <small>Only the registration fee and downpayment are required now.</small>
            </div>
        </section>`;
    }

    function bindBillingServiceToggle(trackedApplication = false, application = null) {
        const toggle = $('billingServiceToggle');
        if (!toggle || trackedApplication || application?.application_number) return;
        toggle.addEventListener('change', async () => {
            const includeService = toggle.checked;
            const serviceId = state.financialPreview?.available_service?.service_id;
            toggle.disabled = true;
            toggle.closest('.billing-service-card')?.classList.add('billing-service-card--loading');
            try {
                const result = await api('getFinancialPreview', {
                    program_id: $('program').value,
                    branch_id: $('branch').value,
                    include_service: includeService,
                    service_id: includeService ? serviceId : null
                });
                if (result.status !== 'success') throw new Error(result.message);
                state.financialPreview = result.data;
                saveDraft();
                $('applicationBillingPanel').innerHTML = renderFinancialPreview(result.data, null, null);
                bindBillingServiceToggle(false, null);
            } catch (error) {
                toggle.checked = !includeService;
                toggle.disabled = false;
                toggle.closest('.billing-service-card')?.classList.remove('billing-service-card--loading');
                Swal.fire('Service Not Updated', error.response?.data?.message || error.message, 'error');
            }
        });
    }

    function selectedApplicationPaymentMethod() {
        const methodId = $('applicationPaymentMethod')?.value || '';
        return state.lookups?.paymentMethods?.find(method => String(method.payment_method_id) === methodId) || null;
    }

    function paymentMethodIs(method, name) {
        return String(method?.payment_method || '').trim().toLowerCase() === name;
    }

    function resolvePublicAsset(path) {
    return window.resolveUploadUrl(path);
}

    async function copyPaymentAccountNumber(accountNumber, button) {
        if (!accountNumber || !button) return;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(accountNumber);
            } else {
                const temporary = document.createElement('textarea');
                temporary.value = accountNumber;
                temporary.style.position = 'fixed';
                temporary.style.opacity = '0';
                document.body.appendChild(temporary);
                temporary.select();
                document.execCommand('copy');
                temporary.remove();
            }
            const label = button.querySelector('span');
            if (label) label.textContent = 'Copied';
            button.classList.add('is-copied');
            setTimeout(() => {
                if (label) label.textContent = 'Copy';
                button.classList.remove('is-copied');
            }, 1800);
        } catch (error) {
            Swal.fire('Unable to Copy', 'Please select and copy the account number manually.', 'info');
        }
    }

    function viewPaymentQrCode(method, qrUrl) {
        if (!qrUrl) return;
        Swal.fire({
            titleText: `${method.payment_method || 'Payment'} QR Code`,
            imageUrl: qrUrl,
            imageAlt: `${method.payment_method || 'Payment'} QR code`,
            confirmButtonText: 'Close',
            buttonsStyling: false,
            customClass: {
                popup: 'application-qr-modal',
                title: 'application-qr-modal__title',
                image: 'application-qr-modal__image',
                confirmButton: 'application-qr-modal__close'
            }
        });
    }

    async function showPublicPaymentReceipt(application) {
        const receipt = application?.payment_receipt;
        if (!receipt) return;
        if (typeof window.showPaymentReceipt !== 'function') {
            await import(new URL('js/modules/receipt.js?v=20260825-public-application', window.location.href).href);
        }
        if (typeof window.showPaymentReceipt !== 'function') {
            throw new Error('The payment receipt viewer is unavailable.');
        }
        const studentName = [application.first_name, application.middle_name, application.last_name, application.ext].filter(Boolean).join(' ');
        await window.showPaymentReceipt({
            enrollmentId: application.enrollment_details_id,
            studentName,
            programName: application.program_name,
            receiptNo: receipt.receipt_id,
            orNo: receipt.or_no || '',
            paymentKind: 'Payment Received',
            paymentType: 'Payment Received',
            paymentFor: (receipt.line_items || []).map(item => item.label).join(', ') || 'Registration Fee and Downpayment',
            paymentMethod: receipt.payment_method,
            referenceNo: receipt.reference_no,
            amountPaid: Number(receipt.amount_paid || 0),
            totalAmount: Number(receipt.amount_paid || 0),
            balance: Number(receipt.balance || 0),
            lineItems: receipt.line_items || [],
            paymentDate: receipt.payment_date,
            copyLabels: ['CUSTOMER COPY']
        });
    }

    function maybeShowNewPublicReceipt(application) {
        const receiptId = application?.payment_receipt?.receipt_id;
        if (!receiptId) return;
        const key = `cdoTutorShownApplicationReceipt:${application.application_number}:${receiptId}`;
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, '1');
        Swal.fire({
            icon: 'success',
            title: 'Receipt Available',
            text: 'Your official receipt is now available for viewing and downloading. Use the “View Official Receipt” button in the Payment section when you are ready.',
            confirmButtonText: 'Got it',
            buttonsStyling: false,
            customClass: {
                popup: 'application-receipt-alert',
                confirmButton: 'application-receipt-alert__confirm'
            }
        });
    }

    function renderPaymentMethodDetail(financial) {
        const target = $('applicationPaymentDetail');
        if (!target) return;
        const method = selectedApplicationPaymentMethod();
        const expected = Number(financial?.initial_payment || 0);
        if (!method) {
            target.className = '';
            target.innerHTML = '';
            return;
        }
        if (paymentMethodIs(method, 'cash')) {
            target.className = 'application-payment-detail application-payment-detail--cash';
            target.innerHTML = '<div class="d-flex gap-2"><i class="bi bi-building"></i><div><strong>Please visit the center to pay in cash.</strong><div class="small mt-1">You may continue and submit the application now. Payment will be collected at your selected center after approval.</div></div></div>';
            return;
        }
        const isGcash = paymentMethodIs(method, 'gcash');
        const qrUrl = resolvePublicAsset(method.qr_code);
        const accountName = String(method.account_name || '').trim();
        const accountNumber = String(method.account_number || '').trim();
        target.className = 'application-payment-detail application-payment-detail--gcash';
        target.innerHTML = `
            <div class="application-gcash-account">
                <div class="application-gcash-account-copy">
                    <span class="application-gcash-eyebrow"><i class="bi bi-shield-check"></i> Send payment to</span>
                    <h4>${escapeHtml(method.payment_method || 'Payment')}</h4>
                    <dl>
                        ${accountName ? `<div><dt>Account name</dt><dd>${escapeHtml(accountName)}</dd></div>` : ''}
                        ${accountNumber ? `<div><dt>Account number</dt><dd><strong>${escapeHtml(accountNumber)}</strong><button type="button" id="applicationCopyGcashAccount" class="application-gcash-copy"><i class="bi bi-copy"></i><span>Copy</span></button></dd></div>` : ''}
                    </dl>
                    <p><i class="bi bi-info-circle"></i> Verify the account details before sending your payment.</p>
                </div>
                ${qrUrl ? `<button type="button" id="applicationViewGcashQr" class="application-gcash-qr" title="View larger QR code"><img src="${escapeHtml(qrUrl)}" alt="${escapeHtml(method.payment_method || 'Payment')} QR code"><span><i class="bi bi-arrows-fullscreen"></i> View larger</span></button>` : '<div class="application-gcash-qr-empty"><i class="bi bi-qr-code"></i><span>QR code is not configured.</span></div>'}
            </div>
            <div class="alert alert-info"><strong>Amount due: ${money(expected)}</strong><br><small>Upload the receipt after sending this exact registration fee and downpayment total.</small></div>
            <label class="application-receipt-upload" for="applicationGcashScreenshot">
                <strong><i class="bi bi-cloud-arrow-up me-2"></i>Upload ${escapeHtml(method.payment_method)} payment receipt</strong>
                <input class="form-control mt-2" type="file" id="applicationGcashScreenshot" accept="image/jpeg,image/png,image/webp,image/bmp,.jpg,.jpeg,.png,.webp,.bmp">
            </label>
            <div class="d-flex justify-content-end mt-2"><button type="button" class="btn btn-outline-primary btn-sm ${isGcash ? '' : 'd-none'}" id="applicationRunOcr"><i class="bi bi-bounding-box me-1"></i>Read Receipt</button></div>
            <small id="applicationOcrStatus" class="small text-muted d-block mt-2">${isGcash ? 'The GCash receipt reader can fill in the amount and reference number. Please verify them before submitting.' : 'Enter the amount and reference number shown on your receipt.'}</small>
            <div id="applicationReceiptPreviewWrapper" class="application-receipt-preview d-none"><img id="applicationReceiptPreviewImage" class="img-fluid rounded" alt="Payment receipt preview"></div>
            <div class="application-gcash-fields mt-3">
                <div><label class="form-label" for="applicationPaymentAmount">Receipt amount *</label><input type="number" class="form-control" id="applicationPaymentAmount" step="0.01" min="0.01" placeholder="${expected.toFixed(2)}"></div>
                <div><label class="form-label" for="applicationPaymentReference">${isGcash ? 'GCash reference number' : 'Reference number'} *</label><input class="form-control" id="applicationPaymentReference" ${isGcash ? 'inputmode="numeric" maxlength="13" pattern="(?:\\d{10}|\\d{12}|\\d{13})" placeholder="10-, 12-, or 13-digit reference number"' : 'placeholder="Enter the transaction reference number"'}></div>
            </div>`;
        $('applicationCopyGcashAccount')?.addEventListener('click', event => copyPaymentAccountNumber(accountNumber, event.currentTarget));
        $('applicationViewGcashQr')?.addEventListener('click', () => viewPaymentQrCode(method, qrUrl));
        window.attachGcashOcrAutoFill?.({
            fileInputId: 'applicationGcashScreenshot',
            actionButtonId: 'applicationRunOcr',
            amountInputId: 'applicationPaymentAmount',
            refInputId: 'applicationPaymentReference',
            statusId: 'applicationOcrStatus',
            previewWrapperId: 'applicationReceiptPreviewWrapper',
            previewImageId: 'applicationReceiptPreviewImage',
            isEnabled: () => isGcash
        });
    }

    function renderApplicationPaymentPanel(financial, application = null, trackedApplication = false) {
        const payment = application?.application_payment;
        if (trackedApplication) {
            if (!payment) {
                $('applicationPaymentPanel').innerHTML = '';
                return;
            }
            const receiptAvailable = Boolean(application?.payment_receipt);
            $('applicationPaymentPanel').innerHTML = `<section class="application-payment-panel"><h3>Payment</h3><div class="application-payment-detail mt-3"><strong>${escapeHtml(payment.payment_method)}</strong><div class="small mt-1">${money(payment.amount)} · ${escapeHtml(String(payment.payment_status || '').replaceAll('_', ' '))}</div>${payment.reference_no ? `<div class="small mt-1">Reference: ${escapeHtml(payment.reference_no)}</div>` : ''}${receiptAvailable ? '<button type="button" class="btn btn-primary btn-sm mt-3" id="viewPublicPaymentReceipt"><i class="bi bi-receipt me-1"></i>View Official Receipt</button>' : '<div class="small text-muted mt-2">The official receipt will be available here after the center approves the payment.</div>'}</div></section>`;
            $('viewPublicPaymentReceipt')?.addEventListener('click', () => showPublicPaymentReceipt(application).catch(error => Swal.fire('Receipt Unavailable', error.message, 'error')));
            return;
        }
        const methods = (state.lookups?.paymentMethods || []).filter(method => method.payment_method);
        $('applicationPaymentPanel').innerHTML = `<section class="application-payment-panel"><div class="application-payment-heading"><span class="application-payment-heading-icon"><i class="bi bi-credit-card"></i></span><h3>Make Payment</h3></div><label class="application-payment-select-label" for="applicationPaymentMethod">Payment Method</label><select class="form-select application-payment-select" id="applicationPaymentMethod"><option value="">Choose a payment method</option>${methods.map(method => `<option value="${escapeHtml(method.payment_method_id)}">${escapeHtml(method.payment_method)}</option>`).join('')}</select><div id="applicationPaymentDetail"></div></section>`;
        $('applicationPaymentMethod').addEventListener('change', () => renderPaymentMethodDetail(financial));
        renderPaymentMethodDetail(financial);
    }

    function validateApplicationPayment(financial) {
        const method = selectedApplicationPaymentMethod();
        if (!method) {
            Swal.fire('Payment Method Required', 'Choose a payment method before submitting.', 'warning');
            return null;
        }
        const payment = { payment_method_id: method.payment_method_id, payment_amount: Number(financial?.initial_payment || 0), payment_reference_no: '', file: null };
        if (paymentMethodIs(method, 'cash')) return payment;
        payment.file = $('applicationGcashScreenshot')?.files?.[0] || null;
        payment.payment_amount = Number($('applicationPaymentAmount')?.value || 0);
        payment.payment_reference_no = $('applicationPaymentReference')?.value.trim() || '';
        const expected = Number(financial?.initial_payment || 0);
        if (!payment.file) return void Swal.fire('Payment Receipt Required', 'Upload the payment receipt screenshot.', 'warning');
        if (payment.file.size > 10 * 1024 * 1024) return void Swal.fire('Receipt Too Large', 'Choose an image no larger than 10MB.', 'warning');
        if (paymentMethodIs(method, 'gcash') && $('applicationOcrStatus')?.dataset.ocrBusy === 'true') return void Swal.fire('Receipt Is Still Being Read', 'Please wait for OCR to finish.', 'info');
        if (!payment.payment_amount || Math.abs(payment.payment_amount - expected) > 0.01) return void Swal.fire('Incorrect Receipt Amount', `The receipt amount must be ${money(expected)}.`, 'warning');
        if (!payment.payment_reference_no) return void Swal.fire('Reference Number Required', 'Enter the transaction reference number.', 'warning');
        if (paymentMethodIs(method, 'gcash') && !/^(?:\d{10}|\d{12}|\d{13})$/.test(payment.payment_reference_no)) return void Swal.fire('Invalid Reference Number', 'The GCash reference number must contain 10, 12, or 13 digits.', 'warning');
        return payment;
    }

    function configureBillingActions(trackedApplication = false) {
        const locked = trackedApplication || state.applicationSubmitted;
        $('billingBackButton').classList.toggle('d-none', locked);
        $('submitApplicationButton').classList.toggle('d-none', locked);
        $('continueToApplicationStatus').classList.toggle('d-none', !locked);
    }

    function renderApplicationBilling(item, trackedApplication = false) {
        state.currentApplication = item || null;
        const financial = item?.financial || item;
        state.financialPreview = financial;
        $('applicationBillingPanel').innerHTML = renderFinancialPreview(financial, item?.billing || null, item);
        bindBillingServiceToggle(trackedApplication, item);
        renderApplicationPaymentPanel(financial, item, trackedApplication);
        configureBillingActions(trackedApplication);
    }

    async function reviewBilling() {
        if (!validatePersonalStep() || !validateLearningPreferences()) return;
        try { agreementForm.payload(); }
        catch (error) { return Swal.fire('Agreement Required', error.message, 'warning'); }
        const button = $('reviewBillingButton');
        setBusy(button, true, 'Loading billing…');
        try {
            const result = await api('getFinancialPreview', { program_id: $('program').value, branch_id: $('branch').value });
            if (result.status !== 'success') throw new Error(result.message);
            state.applicationSubmitted = false;
            renderApplicationBilling(result.data, false);
            unlockAndShowStep(4);
        } catch (error) {
            Swal.fire('Billing Unavailable', error.response?.data?.message || error.message, 'error');
        } finally {
            setBusy(button, false);
        }
    }

    async function submitApplication() {
        if (!validatePersonalStep() || !validateLearningPreferences()) return;
        const payment = validateApplicationPayment(state.financialPreview);
        if (!payment) return;
        const method = selectedApplicationPaymentMethod();
        const isCash = paymentMethodIs(method, 'cash');
        const confirmed = await Swal.fire({
            icon: 'question', title: 'Submit this application?',
            text: isCash
                ? 'Please visit the selected center after approval to pay the registration fee and downpayment in cash.'
                : `Your ${method.payment_method} receipt will be recorded with the application. After approval, the center can assign a teacher or class.`,
            showCancelButton: true, confirmButtonText: 'Submit Application'
        });
        if (!confirmed.isConfirmed) return;
        const button = $('submitApplicationButton');
        setBusy(button, true, 'Submitting…');
        try {
            const result = await multipartApi('submitApplication', {
                ...applicationPayload(),
                ...agreementForm.payload(),
                include_service: Boolean(state.financialPreview?.service_id),
                service_id: state.financialPreview?.service_id || null,
                payment_method_id: payment.payment_method_id,
                payment_amount: payment.payment_amount,
                payment_reference_no: payment.payment_reference_no
            }, payment.file);
            if (result.status !== 'success') throw new Error(result.message);
            const personal = personalPayload();
            const tracking = {
                application_number: result.application_number,
                first_name: personal.first_name,
                last_name: personal.last_name,
                birthday: personal.birthday
            };
            state.applicationSubmitted = true;
            state.tracking = tracking;
            saveDraft();
            await showApplicationStatus(tracking, true);
        } catch (error) {
            const data = error.response?.data;
            const message = data?.message || error.message;
            if (data?.existing_student) {
                Swal.fire('Existing Student Found', message, 'info');
            } else if (!showServerFieldError('Application Not Submitted', message)) {
                Swal.fire('Application Not Submitted', message, 'error');
            }
        } finally {
            setBusy(button, false);
        }
    }

    function statusPresentation(status, item = null) {
        const preschool = isPreschoolProgram(item?.program_name || '');
        const submittedOnlinePayment = item?.application_payment?.payment_status === 'pending_review';
        if (status === 'pending_review' && submittedOnlinePayment) {
            return ['Pending Review', 'bi-hourglass-split', 'Your application and payment receipt were submitted.', 'The center will review the application and payment proof. Once approved, teacher or class assignment can begin.'];
        }
        if (status === 'ready_for_scheduling' && preschool) {
            return ['Ready for Class & Section', 'bi-diagram-3', 'Your payment was received and a receipt was issued.', 'The center will assign the student to an available class and section.'];
        }
        return ({
            pending_review: ['Pending', 'bi-hourglass-split', 'Your application is waiting for center review.', 'After approval, please visit the selected center to pay the registration fee and downpayment in cash.'],
            approved_for_payment: ['Approved for Payment', 'bi-building-check', 'Your application is ready for center payment.', 'To complete enrollment, please pay the required registration fee and downpayment at the selected center.'],
            ready_for_scheduling: ['Ready for Scheduling', 'bi-calendar2-check', 'Your payment was received and a receipt was issued.', 'The center will match the preferred availability with a qualified teacher and plot the actual sessions.'],
            enrolled: ['Enrolled', 'bi-check2-circle', 'Enrollment is complete.', 'The system created the student portal account. Check the verified parent or guardian email for the username and temporary password, or contact the center if the message was not received.'],
            rejected: ['Application Not Approved', 'bi-x-circle', 'The center could not approve this application.', 'Review the administrator’s notes below or contact the selected center.'],
            cancelled: ['Cancelled', 'bi-slash-circle', 'This application was cancelled.', 'Contact the center if you would like to submit another application.']
        })[status] || ['Application Updated', 'bi-info-circle', 'Your application has been updated.', 'Contact the center if you need assistance.'];
    }

    function renderBilling(billing) {
        if (!billing?.schedule?.length) return '';
        const rows = billing.schedule.map(item => `<tr><td>${escapeHtml(item.billing_type)}</td><td>${escapeHtml(item.due_date || 'To be scheduled')}</td><td>${money(item.total_amount)}</td><td>${money(item.paid_amount)}</td><td>${money(item.balance)}</td><td><span class="billing-status billing-status--${escapeHtml(String(item.status || 'unpaid').toLowerCase())}">${escapeHtml(item.status)}</span></td></tr>`).join('');
        return `<section class="billing-statement"><header><div><small>BILLING STATEMENT</small><h3>${escapeHtml(billing.student_name)}</h3></div><div class="billing-program"><small>Program</small><strong>${escapeHtml(billing.program_name)}</strong></div></header><div class="table-responsive"><table class="table billing-table"><thead><tr><th>Payment</th><th>Due date</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div><div class="billing-totals"><span>Total paid <strong>${money(billing.total_paid)}</strong></span><span>Outstanding <strong>${money(billing.balance)}</strong></span></div></section>`;
    }

    async function showApplicationStatus(tracking, preserveFormSteps = false) {
        Swal.fire({ title: 'Loading application…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        try {
            const result = await api('getPublicStatus', tracking);
            if (result.status !== 'success') throw new Error(result.message);
            Swal.close();
            const item = result.data;
            state.applicationSubmitted = true;
            state.tracking = tracking;
            state.availableSteps = preserveFormSteps ? new Set([1, 2, 3, 4, 5]) : new Set([4, 5]);
            renderApplicationBilling(item, true);
            const [label, icon, summary, next] = statusPresentation(item.status, item);
            $('applicationStatusPanel').innerHTML = `<div class="status-hero"><div class="status-icon"><i class="bi ${icon}"></i></div><span class="application-eyebrow">APPLICATION ${escapeHtml(item.application_number)}</span><h2>${escapeHtml(summary)}</h2><span class="status-badge ${item.status}"><i class="bi ${icon}"></i>${escapeHtml(label.toUpperCase())}</span><div class="status-details"><div class="status-detail"><small>Student</small><strong>${escapeHtml([item.first_name, item.middle_name, item.last_name, item.ext].filter(Boolean).join(' '))}</strong></div><div class="status-detail"><small>Student ID</small><strong>${escapeHtml(item.student_id_number)}</strong></div><div class="status-detail"><small>Program</small><strong>${escapeHtml(item.program_name)}</strong></div><div class="status-detail"><small>Center</small><strong>${escapeHtml(item.branch_name)}</strong></div></div><div class="next-step-card"><strong><i class="bi bi-arrow-right-circle me-2"></i>Next step</strong><p class="mb-0 mt-2">${escapeHtml(next)}</p>${item.review_notes ? `<p class="mb-0 mt-2"><strong>Center notes:</strong> ${escapeHtml(item.review_notes)}</p>` : ''}</div><div class="d-flex justify-content-center gap-2 mt-4"><button type="button" class="btn btn-outline-secondary" id="refreshApplicationStatus"><i class="bi bi-arrow-clockwise me-2"></i>Refresh Status</button>${item.status === 'enrolled' ? '<a class="btn btn-primary" href="login.html">Student Login</a>' : ''}<button type="button" class="btn btn-light" id="startAnotherApplication">Apply for Another Child</button></div></div>`;
            unlockAndShowStep(5);
            $('refreshApplicationStatus').onclick = () => showApplicationStatus(tracking, preserveFormSteps);
            $('startAnotherApplication').onclick = () => { draftReady = false; clearDraft(); window.location.reload(); };
            maybeShowNewPublicReceipt(item);
        } catch (error) {
            Swal.fire('Application Not Found', error.response?.data?.message || error.message, 'error');
        }
    }

    async function openTracking() {
        const result = await Swal.fire({
            title: 'Track Application',
            html: `<div class="tracking-modal__intro"><span class="tracking-modal__icon"><i class="bi bi-search"></i></span><p>Enter the application number and student details exactly as submitted.</p></div><div class="tracking-modal__fields"><label class="tracking-modal__field" for="trackingNumber"><span>Application number</span><div><i class="bi bi-file-earmark-text"></i><input id="trackingNumber" type="text" autocomplete="off" placeholder="APP-XXXXXX-XXXX"></div></label><div class="tracking-modal__name-grid"><label class="tracking-modal__field" for="trackingFirstName"><span>Student first name</span><div><i class="bi bi-person"></i><input id="trackingFirstName" type="text" autocomplete="given-name" placeholder="First name"></div></label><label class="tracking-modal__field" for="trackingLastName"><span>Student last name</span><div><i class="bi bi-person"></i><input id="trackingLastName" type="text" autocomplete="family-name" placeholder="Last name"></div></label></div><label class="tracking-modal__field" for="trackingBirthday"><span>Student birthdate</span><div><i class="bi bi-calendar3"></i><input id="trackingBirthday" type="date" autocomplete="bday"></div></label></div>`,
            showCancelButton: true,
            confirmButtonText: '<i class="bi bi-search me-2"></i>Track Application',
            cancelButtonText: 'Cancel',
            buttonsStyling: false,
            customClass: {
                popup: 'tracking-modal',
                title: 'tracking-modal__title',
                htmlContainer: 'tracking-modal__body',
                actions: 'tracking-modal__actions',
                confirmButton: 'tracking-modal__confirm',
                cancelButton: 'tracking-modal__cancel',
                validationMessage: 'tracking-modal__validation'
            },
            preConfirm: () => {
                const tracking = {
                    application_number: $('trackingNumber').value.trim().toUpperCase(),
                    first_name: $('trackingFirstName').value.trim(),
                    last_name: $('trackingLastName').value.trim(),
                    birthday: $('trackingBirthday').value
                };
                if (!tracking.application_number || !tracking.first_name || !tracking.last_name || !tracking.birthday) {
                    Swal.showValidationMessage('Application number, first name, last name, and birthdate are required.');
                    return false;
                }
                return tracking;
            }
        });
        if (result.isConfirmed) showApplicationStatus(result.value);
    }

    function bindEvents() {
        $('newStudentApplicationForm').addEventListener('input', saveDraft);
        $('newStudentApplicationForm').addEventListener('change', saveDraft);
        $('email').addEventListener('input', () => {
            if (!state.verificationEmail || personalPayload().email === state.verificationEmail) return;
            state.verificationId = null;
            state.verificationToken = null;
            state.verificationEmail = '';
            state.verificationExpiresAt = 0;
            state.availableSteps = new Set([1]);
            $('verificationSuccess').classList.add('d-none');
            $('otpEntry').classList.add('d-none');
            $('continueToPreferences').disabled = true;
            showStep(1, false);
        });
        window.addEventListener('pagehide', saveDraft);
        $('guardianRelationship').addEventListener('change', updateGuardianRelationshipField);
        $('continueToVerification').addEventListener('click', continueToVerification);
        $('sendOtpButton').addEventListener('click', sendOtp);
        $('verifyOtpButton').addEventListener('click', verifyOtp);
        $('continueToPreferences').addEventListener('click', () => unlockAndShowStep(3));
        $('addAvailability').addEventListener('click', addAvailability);
        $('reviewBillingButton').addEventListener('click', reviewBilling);
        $('submitApplicationButton').addEventListener('click', submitApplication);
        $('continueToApplicationStatus').addEventListener('click', () => showStep(5));
        $('trackApplicationButton').addEventListener('click', openTracking);
        document.querySelectorAll('[data-go-step]').forEach(button => button.addEventListener('click', () => showStep(Number(button.dataset.goStep))));
        document.querySelectorAll('[data-step-indicator]').forEach(indicator => indicator.addEventListener('click', () => {
            const step = Number(indicator.dataset.stepIndicator);
            if (state.availableSteps.has(step)) showStep(step);
        }));
        $('availabilityList').addEventListener('click', event => {
            const button = event.target.closest('[data-remove-availability]');
            if (!button) return;
            state.availability.splice(Number(button.dataset.removeAvailability), 1);
            renderAvailability();
        });
        $('program').addEventListener('change', event => {
            const item = state.lookups.programs.find(program => String(program.program_id) === event.target.value);
            $('programSummary').textContent = item ? `${item.total_units} ${item.unit_type}${Number(item.total_units) === 1 ? '' : 's'}` : '';
            updateProgramPreferenceFields(item);
            agreementForm.setProgram(event.target.value, $('guardianName').value, item?.program_type_name || item?.program_type || '');
        });
        $('branch').addEventListener('change', event => {
            const item = state.lookups.branches.find(branch => String(branch.branch_id) === event.target.value);
            $('branchSummary').textContent = item ? [item.branch_location, item.operating_days].filter(Boolean).join(' • ') : '';
        });
        $('province').addEventListener('change', async event => {
            clearFieldError(event.target);
            try {
                await loadCities(selectedAddressCode(event.target));
                saveDraft();
            } catch (error) {
                console.error('Unable to load Philippine cities/municipalities:', error);
                resetAddressSelect($('city'), 'Unable to load cities');
                resetAddressSelect($('barangay'), 'Select a city/municipality first');
                Swal.fire('City List Unavailable', 'Cities and municipalities could not be loaded. Please select the province again or refresh the page.', 'error');
            }
        });
        $('city').addEventListener('change', async event => {
            clearFieldError(event.target);
            try {
                await loadBarangays(selectedAddressCode(event.target));
                saveDraft();
            } catch (error) {
                console.error('Unable to load Philippine barangays:', error);
                resetAddressSelect($('barangay'), 'Unable to load barangays');
                Swal.fire('Barangay List Unavailable', 'Barangays could not be loaded. Please select the city/municipality again or refresh the page.', 'error');
            }
        });
        $('guardianContact').addEventListener('input', event => {
            event.target.value = localMobileDigits(event.target.value);
            clearFieldError(event.target);
        });
        $('subjectDropdownToggle').addEventListener('click', () => {
            const opening = $('subjectPicker').classList.contains('d-none');
            $('subjectPicker').classList.toggle('d-none', !opening);
            $('subjectDropdownToggle').classList.toggle('open', opening);
            $('subjectDropdownToggle').setAttribute('aria-expanded', String(opening));
        });
        $('subjectPicker').addEventListener('change', event => {
            if (!event.target.matches('input[type="checkbox"]')) return;
            updateSubjectSelection();
        });
        $('otherSubjectName').addEventListener('input', updateSubjectSelection);
        document.addEventListener('click', event => {
            if (!$('subjectMultiSelect').contains(event.target)) closeSubjectDropdown();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeSubjectDropdown();
        });
        document.querySelectorAll('#newStudentApplicationForm input, #newStudentApplicationForm select, #newStudentApplicationForm textarea').forEach(element => {
            const eventName = element.type === 'checkbox' || element.tagName === 'SELECT' ? 'change' : 'input';
            element.addEventListener(eventName, () => clearFieldError(element));
        });
    }

    document.addEventListener('DOMContentLoaded', async () => {
        const draft = readDraft();
        bindEvents();
        showStep(1, false);
        renderAvailability();
        const today = new Date();
        const minimumBirthdate = new Date(today.getFullYear() - 2, today.getMonth(), today.getDate());
        $('birthday').max = `${minimumBirthdate.getFullYear()}-${String(minimumBirthdate.getMonth() + 1).padStart(2, '0')}-${String(minimumBirthdate.getDate()).padStart(2, '0')}`;
        try {
            await Promise.all([loadLookups(), initPhilippineAddresses()]);
            await restoreDraft(draft);
            draftReady = true;
        } catch (error) {
            Swal.fire('Enrollment Unavailable', error.response?.data?.message || error.message, 'error');
        }
    });
})();
