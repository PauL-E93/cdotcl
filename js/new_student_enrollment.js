(() => {
    const API_URL = 'api/enrollment_application.php';
    const TRACKING_KEY = 'cdoTutorEnrollmentApplications';
    const PH_ADDRESS_API_BASE = 'https://psgc.cloud/api/v2';
    const NCR_ADDRESS_OPTION = { code: '1300000000', name: 'Metro Manila (NCR)' };
    const state = {
        step: 1,
        lookups: null,
        verificationId: null,
        verificationToken: null,
        availability: [],
        availableSteps: new Set([1]),
        currentApplication: null,
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
    const money = value => `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
        $('learningPreferenceHelp').classList.toggle('d-none', Boolean(program) && !tutorial);
        $('learningPreferenceHelp').textContent = !program
            ? 'Select a program first. Tutorial preferences will appear only when a Tutorial program is selected.'
            : tutorial
                ? 'Add the student’s tutorial preferences. The center will use these details when matching a teacher and plotting the schedule.'
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

    function saveTracking(application) {
        let items = [];
        try { items = JSON.parse(localStorage.getItem(TRACKING_KEY) || '[]'); } catch (_) { items = []; }
        items = items.filter(item => item.application_number !== application.application_number);
        items.unshift(application);
        localStorage.setItem(TRACKING_KEY, JSON.stringify(items.slice(0, 20)));
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
        const fullTuitionFee = Math.max(0, Number(
            financial.tuition_only_subtotal
            ?? financial.program?.tuition
            ?? financial.tuition_subtotal
            ?? 0
        ));
        const student = personalPayload();
        const trackedStudentName = [application?.first_name, application?.middle_name, application?.last_name, application?.ext].filter(Boolean).join(' ');
        const studentName = billing?.student_name || trackedStudentName || [student.first_name, student.middle_name, student.last_name, student.ext].filter(Boolean).join(' ') || 'New Student';
        const programName = financial.program?.name || selectedProgram()?.name || 'Selected program';
        const preschool = isPreschoolProgram(financial.program || programName);
        const billingSchedule = Array.isArray(billing?.schedule) ? billing.schedule : [];
        const findBill = label => billingSchedule.find(item => String(item.billing_type || '').trim().toLowerCase() === label.toLowerCase());
        const paymentRow = (label, due, amount) => {
            const bill = findBill(label);
            const paid = Number(bill?.paid_amount || 0);
            const balance = bill ? Number(bill.balance || 0) : amount;
            const status = String(bill?.status || (balance <= 0 ? 'paid' : 'unpaid')).toLowerCase();
            return `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(bill?.due_date || due)}</td><td>${money(amount)}</td><td>${money(paid)}</td><td>${money(balance)}</td><td><span class="billing-status billing-status--${escapeHtml(status)}">${escapeHtml(status)}</span></td></tr>`;
        };

        if (preschool) {
            const configuredMonthlyFee = Number(financial.program?.tuition || 0);
            const months = Math.max(1, Number(financial.program?.total_units || 1));
            const monthlyFee = configuredMonthlyFee || Math.max(0, Number(financial.tuition_subtotal || 0) / months);
            const centerPaymentTotal = registrationFee + downpayment;
            const rows = [
                ...(registrationFee > 0 ? [paymentRow('Registration Fee', 'After approval', registrationFee)] : []),
                ...(downpayment > 0 ? [paymentRow('Downpayment', 'After approval', downpayment)] : []),
                `<tr><td>Monthly Fee <small class="text-muted">(1-month estimate)</small></td><td>After enrollment</td><td>${money(monthlyFee)}</td><td>&mdash;</td><td>&mdash;</td><td><span class="billing-status text-muted">estimate</span></td></tr>`
            ];
            return `<section class="billing-statement">
                <header><div><small>BILLING STATEMENT</small><h3>${escapeHtml(studentName)}</h3></div><div class="billing-program"><small>Program</small><strong>${escapeHtml(programName)}</strong></div></header>
                <div class="table-responsive"><table class="table billing-table"><thead><tr><th>Payment</th><th>Due date</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
                <div class="billing-totals"><span>Center payment total <strong>${money(centerPaymentTotal)}</strong></span></div>
            </section><div class="billing-view-notice"><i class="bi bi-building" aria-hidden="true"></i><span>Pay the registration fee and downpayment at the selected center after the application is approved. The monthly fee shown is a one-month estimate and is not included in the center payment total.</span></div>`;
        }

        const centerPaymentTotal = registrationFee + downpayment;
        const rows = [
            ...(registrationFee > 0 ? [{ label: 'Registration Fee', due: 'After approval', amount: registrationFee }] : []),
            ...(downpayment > 0 ? [{ label: 'Downpayment', due: 'After approval', amount: downpayment }] : []),
            ...(fullTuitionFee > 0 ? [{ label: 'Remaining Program Balance', due: 'To be scheduled', amount: fullTuitionFee }] : [])
        ];
        return `<section class="billing-statement">
            <header><div><small>BILLING STATEMENT</small><h3>${escapeHtml(studentName)}</h3></div><div class="billing-program"><small>Program</small><strong>${escapeHtml(programName)}</strong></div></header>
            <div class="table-responsive"><table class="table billing-table"><thead><tr><th>Payment</th><th>Due date</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>
                ${rows.map(item => `<tr><td>${escapeHtml(item.label)}</td><td>${escapeHtml(item.due)}</td><td>${money(item.amount)}</td><td>${money(0)}</td><td>${money(item.amount)}</td><td><span class="billing-status billing-status--unpaid">unpaid</span></td></tr>`).join('')}
            </tbody></table></div>
            <div class="billing-totals"><span>Center payment total <strong>${money(centerPaymentTotal)}</strong></span></div>
        </section><div class="billing-view-notice"><i class="bi bi-building" aria-hidden="true"></i><span>Pay the registration fee and downpayment at the selected center after the application is approved. The remaining program balance shows the full tuition fee before any downpayment deduction and will be scheduled after enrollment.</span></div>`;
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
        const preschool = isPreschoolProgram(financial?.program || item?.program_name || '');
        $('applicationBillingPanel').innerHTML = preschool
            ? renderFinancialPreview(financial, item?.billing, item)
            : item?.billing?.schedule?.length
            ? `${renderBilling(item.billing)}<div class="billing-view-notice"><i class="bi bi-eye" aria-hidden="true"></i><span>This billing statement is view-only on the application tracker.</span></div>`
            : renderFinancialPreview(financial, null, item);
        configureBillingActions(trackedApplication);
    }

    async function reviewBilling() {
        if (!validatePersonalStep() || !validateLearningPreferences()) return;
        const button = $('reviewBillingButton');
        setBusy(button, true, 'Loading billing…');
        try {
            const result = await api('getFinancialPreview', { program_id: $('program').value });
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
        const confirmed = await Swal.fire({
            icon: 'question', title: 'Submit this application?',
            text: 'No payment or class schedule will be created yet. The center will review the application first.',
            showCancelButton: true, confirmButtonText: 'Submit Application'
        });
        if (!confirmed.isConfirmed) return;
        const button = $('submitApplicationButton');
        setBusy(button, true, 'Submitting…');
        try {
            const result = await api('submitApplication', applicationPayload());
            if (result.status !== 'success') throw new Error(result.message);
            const tracking = { application_number: result.application_number, tracking_token: result.tracking_token, student_name: `${personalPayload().first_name} ${personalPayload().last_name}` };
            saveTracking(tracking);
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
        if (status === 'ready_for_scheduling' && preschool) {
            return ['Ready for Class & Section', 'bi-diagram-3', 'Your payment was received and a receipt was issued.', 'The center will assign the student to an available class and section.'];
        }
        return ({
            pending_review: ['Pending', 'bi-hourglass-split', 'Complete your enrollment at your selected center.', 'Please visit the center so it can review the application and collect the required registration fee and downpayment.'],
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
        } catch (error) {
            Swal.fire('Application Not Found', error.response?.data?.message || error.message, 'error');
        }
    }

    async function openTracking() {
        let saved = [];
        try { saved = JSON.parse(localStorage.getItem(TRACKING_KEY) || '[]'); } catch (_) { saved = []; }
        const options = saved.reduce((map, item) => { map[item.application_number] = `${item.application_number}${item.student_name ? ` — ${item.student_name}` : ''}`; return map; }, {});
        const result = await Swal.fire({
            title: 'Track Application',
            html: `<p class="text-muted">Choose a saved application or enter its details manually.</p>${saved.length ? `<select id="savedApplication" class="swal2-select"><option value="">Enter manually</option>${Object.entries(options).map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('')}</select>` : ''}<input id="trackingNumber" class="swal2-input" placeholder="Application number"><input id="trackingToken" class="swal2-input" placeholder="Tracking token">`,
            showCancelButton: true,
            confirmButtonText: 'Track',
            didOpen: () => {
                const select = $('savedApplication');
                if (select) select.onchange = () => {
                    const item = saved.find(entry => entry.application_number === select.value);
                    if (item) { $('trackingNumber').value = item.application_number; $('trackingToken').value = item.tracking_token; }
                };
            },
            preConfirm: () => {
                const tracking = { application_number: $('trackingNumber').value.trim(), tracking_token: $('trackingToken').value.trim() };
                if (!tracking.application_number || !tracking.tracking_token) { Swal.showValidationMessage('Application number and tracking token are required.'); return false; }
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
