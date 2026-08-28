(() => {
    const API_URL = 'api/enrollment_application.php';
    const PH_ADDRESS_API_BASE = 'https://psgc.cloud/api/v2';
    // Remove legacy browser-saved tracking tokens; tracking now uses student details.
    try { localStorage.removeItem('cdoTutorEnrollmentApplications'); } catch (_) {}
    const NCR_ADDRESS_OPTION = { code: '1300000000', name: 'Metro Manila (NCR)' };
    const state = {
        step: 1,
        lookups: null,
        verificationId: null,
        verificationToken: null,
        availability: [],
        availableSteps: new Set([1]),
        currentApplication: null,
        financialPreview: null,
        applicationSubmitted: false,
        addressCache: { provinces: null, cities: {}, barangays: {} }
    };

    const $ = id => document.getElementById(id);
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
            [['relationship'], 'guardianRelationship'],
            [['house/street', 'street'], 'street'],
            [['barangay'], 'barangay'],
            [['city/municipality', 'city'], 'city'],
            [['province'], 'province'],
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

    function showStep(step) {
        if (!state.availableSteps.has(step)) return;
        state.step = step;
        document.querySelectorAll('[data-form-step]').forEach(section => section.classList.toggle('active', Number(section.dataset.formStep) === step));
        document.querySelectorAll('[data-step-indicator]').forEach(indicator => {
            const number = Number(indicator.dataset.stepIndicator);
            indicator.classList.toggle('active', number === step);
            indicator.classList.toggle('complete', state.availableSteps.has(number) && number < step);
            indicator.classList.toggle('available', state.availableSteps.has(number));
            indicator.setAttribute('aria-disabled', String(!state.availableSteps.has(number)));
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function unlockAndShowStep(step) {
        state.availableSteps.add(step);
        showStep(step);
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
            guardian_relationship: $('guardianRelationship').value.trim(),
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
        const birthday = $('birthday').value ? new Date(`${$('birthday').value}T00:00:00`) : null;
        if (birthday && (Number.isNaN(birthday.getTime()) || birthday > new Date())) {
            addOnce($('birthday'), 'Birthdate must be a valid date and cannot be in the future.');
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
        const names = checked.map(input => input.closest('.subject-dropdown-option')?.querySelector('.subject-name')?.textContent.trim()).filter(Boolean);
        $('subjectSelectionText').textContent = names.length ? `${names.length} subject${names.length === 1 ? '' : 's'} selected` : 'Select one or more subjects';
        $('selectedSubjectsSummary').textContent = names.join(', ');
    }

    function clearTutorialPreferences() {
        $('gradeLevel').value = '';
        $('goal').value = '';
        document.querySelectorAll('#subjectPicker input:checked').forEach(input => { input.checked = false; });
        state.availability = [];
        updateSubjectSelection();
        renderAvailability();
        closeSubjectDropdown();
        clearFieldError($('availabilityList'));
    }

    function updateProgramPreferenceFields(program = selectedProgram()) {
        const tutorial = isTutorialProgram(program);
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
        $('gender').innerHTML = '<option value="">Select gender</option>' + result.data.genders.map(item => `<option value="${item.gender_id}">${escapeHtml(item.gender)}</option>`).join('');
        $('program').innerHTML = '<option value="">Select program</option>' + result.data.programs.map(item => `<option value="${item.program_id}">${escapeHtml(item.name)}${item.program_type ? ` (${escapeHtml(item.program_type)})` : ''}</option>`).join('');
        $('branch').innerHTML = '<option value="">Select branch</option>' + result.data.branches.map(item => `<option value="${item.branch_id}">${escapeHtml(item.branch_name)}</option>`).join('');
        const activeGrades = Array.isArray(result.data.grades) ? result.data.grades : [];
        $('gradeLevel').innerHTML = activeGrades.length
            ? '<option value="">Select grade level</option>' + activeGrades.map(item => `<option value="${item.grade_level_id}">${escapeHtml(item.grade_level)}</option>`).join('')
            : '<option value="">No active grade levels available</option>';
        $('gradeLevel').disabled = activeGrades.length === 0;
        $('subjectPicker').innerHTML = result.data.subjects.map(item => `<label class="subject-dropdown-option"><input type="checkbox" value="${item.subject_id}"><span class="subject-name">${escapeHtml(item.subject_name)}</span><i class="bi bi-check2"></i></label>`).join('') || '<span class="d-block p-2 text-muted">No subjects configured.</span>';
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

    async function sendOtp() {
        const button = $('sendOtpButton');
        setBusy(button, true, 'Sending code…');
        try {
            const result = await api('sendOtp', personalPayload());
            if (result.status !== 'success') throw new Error(result.message);
            state.verificationId = result.verification_id;
            $('otpEntry').classList.remove('d-none');
            $('otpCode').focus();
            Swal.fire('Code Sent', result.message, 'success');
        } catch (error) {
            const data = error.response?.data;
            Swal.fire(data?.existing_student ? 'Existing Student Found' : 'Email Not Sent', data?.message || error.message, data?.existing_student ? 'info' : 'error');
        } finally {
            setBusy(button, false);
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
        return [...document.querySelectorAll('#subjectPicker input:checked')].map(input => Number(input.value));
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
            goal: tutorial ? $('goal').value.trim() : '',
            availability: tutorial ? state.availability : []
        };
    }

    function validateLearningPreferences() {
        const errors = [];
        [$('program'), $('branch'), $('gradeLevel'), $('availabilityList')].forEach(clearFieldError);
        if (!$('program').value) errors.push({ element: $('program'), message: 'Program is required.' });
        if (!$('branch').value) errors.push({ element: $('branch'), message: 'Preferred center is required.' });
        if (isTutorialProgram() && !$('gradeLevel').value) errors.push({ element: $('gradeLevel'), message: 'Select an active grade level for the Tutorial program.' });
        if (isTutorialProgram() && !state.availability.length) errors.push({ element: $('availabilityList'), message: 'Add at least one preferred day and time for the Tutorial program.' });
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
            ? `<div class="billing-list-row billing-list-row--discount"><span><i class="bi bi-tags"></i>${escapeHtml(discountName || 'Program discount')}</span><strong>- ${money(discountAmount)}</strong></div>`
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
                ${preschool || otherFees.length || discountAmount > 0 ? `<section class="billing-admin-section">
                    <h3 class="billing-admin-section-title"><span><i class="bi bi-book-fill"></i></span>Books / Other Fees</h3>
                    <div class="billing-list">${otherFeesMarkup}${discountMarkup}</div>
                </section>` : ''}
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
        const methodId = document.querySelector('input[name="applicationPaymentMethod"]:checked')?.value || '';
        return state.lookups?.paymentMethods?.find(method => String(method.payment_method_id) === methodId) || null;
    }

    function paymentMethodIs(method, name) {
        return String(method?.payment_method || '').trim().toLowerCase() === name;
    }

    function resolvePublicAsset(path) {
        const value = String(path || '').trim();
        if (!value || /^(?:https?:|data:|blob:|\/)/i.test(value)) return value;
        return value.replace(/^\.\//, '');
    }

    async function copyGcashAccountNumber(accountNumber, button) {
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
            Swal.fire('Unable to Copy', 'Please select and copy the GCash account number manually.', 'info');
        }
    }

    function viewGcashQrCode(method, qrUrl) {
        if (!qrUrl) return;
        Swal.fire({
            title: `${method.payment_method || 'GCash'} QR Code`,
            imageUrl: qrUrl,
            imageAlt: `${method.payment_method || 'GCash'} QR code`,
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
            target.innerHTML = '<div class="alert alert-warning mb-0">Choose Cash or GCash to continue.</div>';
            return;
        }
        if (paymentMethodIs(method, 'cash')) {
            target.className = 'application-payment-detail application-payment-detail--cash';
            target.innerHTML = '<div class="d-flex gap-2"><i class="bi bi-building"></i><div><strong>Please visit the center to pay in cash.</strong><div class="small mt-1">You may continue and submit the application now. Payment will be collected at your selected center after approval.</div></div></div>';
            return;
        }

        const qrUrl = resolvePublicAsset(method.qr_code);
        const accountName = String(method.account_name || '').trim();
        const accountNumber = String(method.account_number || '').trim();
        target.className = 'application-payment-detail application-payment-detail--gcash';
        target.innerHTML = `
            <div class="application-gcash-title"><span><i class="bi bi-credit-card"></i></span><h3>Make Payment</h3></div>
            <div class="application-gcash-account">
                <div class="application-gcash-account-copy">
                    <span class="application-gcash-eyebrow"><i class="bi bi-shield-check"></i> Send payment to</span>
                    <h4>${escapeHtml(method.payment_method || 'GCash')}</h4>
                    <dl>
                        ${accountName ? `<div><dt>Account name</dt><dd>${escapeHtml(accountName)}</dd></div>` : ''}
                        ${accountNumber ? `<div><dt>Account number</dt><dd><strong>${escapeHtml(accountNumber)}</strong><button type="button" id="applicationCopyGcashAccount" class="application-gcash-copy"><i class="bi bi-copy"></i><span>Copy</span></button></dd></div>` : ''}
                    </dl>
                    <p><i class="bi bi-info-circle"></i> Verify the account details before sending your payment.</p>
                </div>
                ${qrUrl ? `<button type="button" id="applicationViewGcashQr" class="application-gcash-qr" title="View larger QR code"><img src="${escapeHtml(qrUrl)}" alt="${escapeHtml(method.payment_method || 'GCash')} QR code"><span><i class="bi bi-arrows-fullscreen"></i> View larger</span></button>` : '<div class="application-gcash-qr-empty"><i class="bi bi-qr-code"></i><span>QR code is not configured.</span></div>'}
            </div>
            <div class="alert alert-info"><strong>Amount due: ${money(expected)}</strong><br><small>Upload the receipt after sending this exact registration fee and downpayment total.</small></div>
            <label class="application-receipt-upload" for="applicationGcashScreenshot">
                <strong><i class="bi bi-cloud-arrow-up me-2"></i>Upload GCash receipt</strong>
                <input class="form-control mt-2" type="file" id="applicationGcashScreenshot" accept="image/jpeg,image/png,image/webp,image/bmp,.jpg,.jpeg,.png,.webp,.bmp">
            </label>
            <div class="d-flex justify-content-end mt-2"><button type="button" class="btn btn-outline-primary btn-sm" id="applicationRunOcr"><i class="bi bi-bounding-box me-1"></i>Read Receipt</button></div>
            <small id="applicationOcrStatus" class="small text-muted d-block mt-2">The receipt reader will fill in the amount and reference number. Please verify them before submitting.</small>
            <div id="applicationReceiptPreviewWrapper" class="application-receipt-preview d-none"><img id="applicationReceiptPreviewImage" class="img-fluid rounded" alt="GCash receipt preview"></div>
            <div class="application-gcash-fields mt-3">
                <div><label class="form-label" for="applicationPaymentAmount">Receipt amount *</label><input type="number" class="form-control" id="applicationPaymentAmount" step="0.01" min="0.01" placeholder="${expected.toFixed(2)}"></div>
                <div><label class="form-label" for="applicationPaymentReference">GCash reference number *</label><input class="form-control" id="applicationPaymentReference" inputmode="numeric" maxlength="13" pattern="\d{13}" placeholder="13-digit reference number"></div>
            </div>`;
        $('applicationCopyGcashAccount')?.addEventListener('click', event => copyGcashAccountNumber(accountNumber, event.currentTarget));
        $('applicationViewGcashQr')?.addEventListener('click', () => viewGcashQrCode(method, qrUrl));
        window.attachGcashOcrAutoFill?.({
            fileInputId: 'applicationGcashScreenshot',
            actionButtonId: 'applicationRunOcr',
            amountInputId: 'applicationPaymentAmount',
            refInputId: 'applicationPaymentReference',
            statusId: 'applicationOcrStatus',
            previewWrapperId: 'applicationReceiptPreviewWrapper',
            previewImageId: 'applicationReceiptPreviewImage'
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
        const methods = (state.lookups?.paymentMethods || []).filter(method => paymentMethodIs(method, 'cash') || paymentMethodIs(method, 'gcash'));
        $('applicationPaymentPanel').innerHTML = `<section class="application-payment-panel"><h3>Payment Method</h3><p class="text-muted mb-0">Choose how to handle the registration fee and downpayment.</p><div class="application-payment-methods">${methods.map((method, index) => `<label class="application-payment-choice"><input type="radio" name="applicationPaymentMethod" value="${escapeHtml(method.payment_method_id)}" ${index === 0 ? 'checked' : ''}><span><strong>${escapeHtml(method.payment_method)}</strong><small>${paymentMethodIs(method, 'cash') ? 'Pay at the selected center after approval' : 'Pay now and upload the GCash receipt'}</small></span></label>`).join('')}</div><div id="applicationPaymentDetail"></div></section>`;
        document.querySelectorAll('input[name="applicationPaymentMethod"]').forEach(input => input.addEventListener('change', () => renderPaymentMethodDetail(financial)));
        renderPaymentMethodDetail(financial);
    }

    function validateApplicationPayment(financial) {
        const method = selectedApplicationPaymentMethod();
        if (!method) {
            Swal.fire('Payment Method Required', 'Choose Cash or GCash before submitting.', 'warning');
            return null;
        }
        const payment = { payment_method_id: method.payment_method_id, payment_amount: Number(financial?.initial_payment || 0), payment_reference_no: '', file: null };
        if (paymentMethodIs(method, 'cash')) return payment;
        payment.file = $('applicationGcashScreenshot')?.files?.[0] || null;
        payment.payment_amount = Number($('applicationPaymentAmount')?.value || 0);
        payment.payment_reference_no = $('applicationPaymentReference')?.value.trim() || '';
        const expected = Number(financial?.initial_payment || 0);
        if (!payment.file) return void Swal.fire('GCash Receipt Required', 'Upload the GCash receipt screenshot.', 'warning');
        if (payment.file.size > 10 * 1024 * 1024) return void Swal.fire('Receipt Too Large', 'Choose an image no larger than 10MB.', 'warning');
        if ($('applicationOcrStatus')?.dataset.ocrBusy === 'true') return void Swal.fire('Receipt Is Still Being Read', 'Please wait for OCR to finish.', 'info');
        if (!payment.payment_amount || Math.abs(payment.payment_amount - expected) > 0.01) return void Swal.fire('Incorrect Receipt Amount', `The GCash receipt must show ${money(expected)}.`, 'warning');
        if (!/^\d{13}$/.test(payment.payment_reference_no)) return void Swal.fire('Invalid Reference Number', 'The GCash reference number must contain exactly 13 digits.', 'warning');
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
        const isGcash = paymentMethodIs(method, 'gcash');
        const confirmed = await Swal.fire({
            icon: 'question', title: 'Submit this application?',
            text: isGcash
                ? 'Your GCash receipt will be recorded with the application. After approval, the center can assign a teacher or class.'
                : 'Please visit the selected center after approval to pay the registration fee and downpayment in cash.',
            showCancelButton: true, confirmButtonText: 'Submit Application'
        });
        if (!confirmed.isConfirmed) return;
        const button = $('submitApplicationButton');
        setBusy(button, true, 'Submitting…');
        try {
            const result = await multipartApi('submitApplication', {
                ...applicationPayload(),
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
        const submittedGcash = String(item?.application_payment?.payment_method || '').toLowerCase() === 'gcash';
        if (status === 'pending_review' && submittedGcash) {
            return ['Pending Review', 'bi-hourglass-split', 'Your application and GCash receipt were submitted.', 'The center will review the application and payment proof. Once approved, teacher or class assignment can begin.'];
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
            state.availableSteps = preserveFormSteps ? new Set([1, 2, 3, 4, 5]) : new Set([4, 5]);
            renderApplicationBilling(item, true);
            const [label, icon, summary, next] = statusPresentation(item.status, item);
            $('applicationStatusPanel').innerHTML = `<div class="status-hero"><div class="status-icon"><i class="bi ${icon}"></i></div><span class="application-eyebrow">APPLICATION ${escapeHtml(item.application_number)}</span><h2>${escapeHtml(summary)}</h2><span class="status-badge ${item.status}"><i class="bi ${icon}"></i>${escapeHtml(label.toUpperCase())}</span><div class="status-details"><div class="status-detail"><small>Student</small><strong>${escapeHtml([item.first_name, item.middle_name, item.last_name, item.ext].filter(Boolean).join(' '))}</strong></div><div class="status-detail"><small>Student ID</small><strong>${escapeHtml(item.student_id_number)}</strong></div><div class="status-detail"><small>Program</small><strong>${escapeHtml(item.program_name)}</strong></div><div class="status-detail"><small>Center</small><strong>${escapeHtml(item.branch_name)}</strong></div></div><div class="next-step-card"><strong><i class="bi bi-arrow-right-circle me-2"></i>Next step</strong><p class="mb-0 mt-2">${escapeHtml(next)}</p>${item.review_notes ? `<p class="mb-0 mt-2"><strong>Center notes:</strong> ${escapeHtml(item.review_notes)}</p>` : ''}</div><div class="d-flex justify-content-center gap-2 mt-4"><button type="button" class="btn btn-outline-secondary" id="refreshApplicationStatus"><i class="bi bi-arrow-clockwise me-2"></i>Refresh Status</button>${item.status === 'enrolled' ? '<a class="btn btn-primary" href="login.html">Student Login</a>' : ''}<button type="button" class="btn btn-light" id="startAnotherApplication">Apply for Another Child</button></div></div>`;
            unlockAndShowStep(5);
            $('refreshApplicationStatus').onclick = () => showApplicationStatus(tracking, preserveFormSteps);
            $('startAnotherApplication').onclick = () => window.location.reload();
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
        });
        $('branch').addEventListener('change', event => {
            const item = state.lookups.branches.find(branch => String(branch.branch_id) === event.target.value);
            $('branchSummary').textContent = item ? [item.branch_location, item.operating_days].filter(Boolean).join(' • ') : '';
        });
        $('province').addEventListener('change', async event => {
            clearFieldError(event.target);
            try {
                await loadCities(selectedAddressCode(event.target));
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
        bindEvents();
        showStep(1);
        renderAvailability();
        const today = new Date();
        $('birthday').max = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        try {
            await Promise.all([loadLookups(), initPhilippineAddresses()]);
        } catch (error) {
            Swal.fire('Enrollment Unavailable', error.response?.data?.message || error.message, 'error');
        }
    });
})();
