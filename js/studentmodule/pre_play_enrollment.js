export function renderPreschoolEnrollment(studentName, globalLookups, saveHandler, selectedProgramId = null) {
    const form = document.getElementById("enrollmentForm");
    const title = document.getElementById("enrollmentDetailsModalLabel");

    if (!form || !title) {
        throw new Error('Pre-play enrollment UI is not available on this page.');
    }

    title.textContent = `Pre-school Enrollment: ${studentName}`;

    // Get all programs first - debug what we have
    const allPrograms = (globalLookups.programs || []);
    const programTypes = (globalLookups.program_types || []);
    
    // Debug logging
    console.log('GlobalLookups:', globalLookups);
    console.log('All Programs:', allPrograms);
    console.log('Program Types:', programTypes);
    console.log('ALL PROGRAM NAMES:', allPrograms.map(p => `"${p.name}"`).join(', '));
    
    // Prefer the database program type for pre-school / play-school, with name matching as fallback.
    let preschoolPrograms = allPrograms.filter(p => p.program_type == 3);

    if (preschoolPrograms.length === 0) {
        preschoolPrograms = allPrograms.filter(p =>
            p.name && (
            p.name.toLowerCase().includes('preschool') || 
            p.name.toLowerCase().includes('play') || 
            p.name.toLowerCase().includes('pre-school') ||
            p.name.toLowerCase().includes('playschool') ||
            p.name.toLowerCase().includes('pre school') ||
            p.name.toLowerCase().includes('play school')
            )
        );
    }
    
    console.log('Filtered Preschool Programs:', preschoolPrograms);
    console.log('Number of preschool programs found:', preschoolPrograms.length);
    
    // If no programs found, show all programs as fallback
    if (preschoolPrograms.length === 0) {
        console.warn('WARNING: No preschool programs found. Showing all programs instead.');
        preschoolPrograms = allPrograms;
    }

    let html = `
        <div class="alert alert-info">Academic Year Enrollment</div>
        <div class="row">
            <div class="col-md-6 mb-3">
                <label class="form-label">School Year</label>
                <input type="text" class="form-control" disabled value="${globalLookups.active_school_year ? globalLookups.active_school_year.school_year : 'No active school year'}">
            </div>
            <div class="col-md-6 mb-3">
                <label class="form-label">Program</label>
                <select class="form-control" id="preschoolProgram" required ${selectedProgramId ? 'disabled' : ''}>
                    <option value="">-- Select Program --</option>
                    ${preschoolPrograms.length > 0 ? preschoolPrograms.map(p => `<option value="${p.program_id}"${p.program_id == selectedProgramId ? ' selected' : ''}>${p.name}</option>`).join('') : '<option disabled>No programs available</option>'}
                </select>
                ${selectedProgramId ? '<small class="text-muted">Program locked from the saved downpayment.</small>' : ''}
            </div>
            <div class="col-md-6 mb-3">
                <label class="form-label">Branch</label>
                <select class="form-control" id="preschoolBranch" required disabled>
                    <option value="">-- Select Program First --</option>
                </select>
            </div>
            <div class="col-md-6 mb-3">
                <label class="form-label">Class</label>
                <select class="form-control" id="preschoolClass" required disabled>
                    <option value="">-- Select Branch First --</option>
                </select>
            </div>
        </div>
        <div class="row">
            <div class="col-md-6 mb-3" id="sectionContainer" style="display:none;">
                <label class="form-label">Section</label>
                <select class="form-control" id="preschoolSection" required disabled>
                    <option value="">-- Select Class First --</option>
                </select>
                <small id="sectionCount" class="text-muted"></small>
            </div>
        </div>
    `;
    form.innerHTML = html;
    markRequiredFieldLabels(form);

    // Get references to the select elements
    const programSelect = document.getElementById('preschoolProgram');
    const branchSelect = document.getElementById('preschoolBranch');
    const classSelect = document.getElementById('preschoolClass');
    const sectionSelect = document.getElementById('preschoolSection');
    const sectionContainer = document.getElementById('sectionContainer');

    // Ensure classes and sections arrays exist
    const allClasses = globalLookups.classes || [];
    const allSections = globalLookups.sections || [];
    const getOpenBranchesForProgram = (programId) => {
        const branchesById = new Map();
        allClasses
            .filter(c => c.program_id == programId && c.status && c.status.toLowerCase() === 'open')
            .forEach(c => {
                if (c.branch_id) {
                    branchesById.set(String(c.branch_id), c.branch_name || `Branch ${c.branch_id}`);
                }
            });

        return [...branchesById.entries()].map(([branch_id, branch_name]) => ({ branch_id, branch_name }));
    };

    console.log('All Classes:', allClasses);
    console.log('All Sections:', allSections);

    // Handle program selection
    programSelect.addEventListener('change', function() {
        const selectedProgramId = this.value;
        branchSelect.innerHTML = '<option value="">-- Select Branch --</option>';
        branchSelect.disabled = true;
        classSelect.innerHTML = '<option value="">-- Select Branch First --</option>';
        classSelect.disabled = true;
        sectionSelect.innerHTML = '<option value="">-- Select Class First --</option>';
        sectionSelect.disabled = true;
        sectionContainer.style.display = 'none';

        if (selectedProgramId) {
            const openBranches = getOpenBranchesForProgram(selectedProgramId);
            console.log('Filtered branches for program', selectedProgramId, ':', openBranches);

            if (openBranches.length > 0) {
                branchSelect.innerHTML = '<option value="">-- Select Branch --</option>' +
                    openBranches.map(b => `<option value="${b.branch_id}">${b.branch_name}</option>`).join('');
                branchSelect.disabled = false;
            } else {
                branchSelect.innerHTML = '<option value="">No open branches available</option>';
                classSelect.innerHTML = '<option value="">No open classes available</option>';
            }
        }
    });

    // Handle branch selection
    branchSelect.addEventListener('change', function() {
        const selectedProgramId = programSelect.value;
        const selectedBranchId = this.value;
        classSelect.innerHTML = '<option value="">-- Select Class --</option>';
        classSelect.disabled = true;
        sectionSelect.innerHTML = '<option value="">-- Select Class First --</option>';
        sectionSelect.disabled = true;
        sectionContainer.style.display = 'none';

        if (selectedProgramId && selectedBranchId) {
            const openClasses = allClasses.filter(c =>
                c.program_id == selectedProgramId &&
                String(c.branch_id) === String(selectedBranchId) &&
                c.status &&
                c.status.toLowerCase() === 'open'
            );

            console.log('Filtered classes for program and branch', selectedProgramId, selectedBranchId, ':', openClasses);

            if (openClasses.length > 0) {
                classSelect.innerHTML = '<option value="">-- Select Class --</option>' +
                    openClasses.map(c => `<option value="${c.class_id}">${c.program_name}</option>`).join('');
                classSelect.disabled = false;
            } else {
                classSelect.innerHTML = '<option value="">No open classes available</option>';
            }
        }
    });

    if (selectedProgramId) {
        programSelect.dispatchEvent(new Event('change'));
    }

    // Handle class selection
    classSelect.addEventListener('change', function() {
        const selectedClassId = this.value;
        sectionSelect.innerHTML = '<option value="">-- Select Section --</option>';
        sectionSelect.disabled = true;
        sectionContainer.style.display = 'none';

        if (selectedClassId) {
            // Filter sections for selected class and with status 'open'
            const openSections = allSections.filter(s =>
                s.class_id == selectedClassId && s.status && s.status.toLowerCase() === 'open'
            );

            console.log('Filtered sections for class', selectedClassId, ':', openSections);

            if (openSections.length > 0) {
                sectionSelect.innerHTML = '<option value="">-- Select Section --</option>' +
                    openSections.map(s => `<option value="${s.section_id}">${s.section_name}</option>`).join('');
                sectionSelect.disabled = false;
                sectionContainer.style.display = 'block';
            } else {
                sectionSelect.innerHTML = '<option value="">No open sections available</option>';
                sectionContainer.style.display = 'block';
            }
        }
    });

    // Handle section selection
    sectionSelect.addEventListener('change', function() {
        const selectedSectionId = this.value;
        const countEl = document.getElementById('sectionCount');
        if (selectedSectionId) {
            // Fetch enrollment count
            axios.get(`../../api/admin/enrollment.php?operation=getSectionEnrollmentCount&section_id=${selectedSectionId}`)
            .then(res => {
                const data = res.data;
                if (data.status === 'success') {
                    countEl.textContent = `Enrolled: ${data.count} / ${data.max}`;
                } else {
                    countEl.textContent = 'Error loading count';
                }
            })
            .catch(err => {
                console.error('Error fetching count:', err);
                countEl.textContent = 'Error loading count';
            });
        } else {
            countEl.textContent = '';
        }
    });

    // Attach save handler to finalize button
    const saveBtn = document.getElementById("finalizeEnrollment");
    if (saveBtn) {
        saveBtn.onclick = saveHandler;
    }
}

function formatStudentName(details = {}) {
    return [details.first_name, details.last_name, details.ext]
        .filter(part => part && part.toString().trim())
        .map(part => part.toString().trim())
        .join(' ');
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

function markRequiredFieldLabels(container) {
    if (!container) return;

    const requiredFields = container.querySelectorAll('input[required], select[required], textarea[required]');
    requiredFields.forEach(field => {
        if (field.type === 'hidden') return;

        let label = field.id ? container.querySelector(`label[for="${field.id}"]`) : null;
        if (!label) {
            const wrapper = field.closest('.mb-3, .col-md-6, .col-md-12');
            label = wrapper?.querySelector('label.form-label') || null;
        }

        if (!label || label.querySelector('.required-field-indicator')) return;

        label.insertAdjacentHTML('beforeend', ' <span class="text-danger required-field-indicator" aria-hidden="true">*</span>');
    });
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

let studentPrePlayLookups = {};
let currentPrePlayEnrollmentId = null;
let selectedPrePlayTuition = 0;
let pendingPrePlayEnrollment = null;
const STUDENT_PENDING_PREPLAY_COMPLETION_KEY = 'studentPendingPrePlayEnrollmentCompletion';

function hasPrePlayEnrollmentUi() {
    const path = window.location.pathname || '';
    return path.includes('/student/enrollement_pre_play.html')
        && Boolean(document.getElementById('enrollmentDetailsModal'))
        && Boolean(document.getElementById('enrollmentDetailsModalLabel'))
        && Boolean(document.getElementById('enrollmentForm'))
        && Boolean(document.getElementById('finalizeEnrollment'));
}

function getLoggedInStudent() {
    try {
        return JSON.parse(localStorage.getItem('user')) || null;
    } catch (error) {
        return null;
    }
}

function getBootstrapModal(element) {
    if (!element) return null;
    return bootstrap.Modal.getInstance(element) || new bootstrap.Modal(element);
}

function getStudentReceiptHandler() {
    return typeof window.showPaymentReceipt === 'function'
        ? (receipt) => window.showPaymentReceipt({
            ...receipt,
            copyLabels: ['CUSTOMER COPY']
        })
        : null;
}

function ensurePrePlayPaymentOcrHelpers() {
    if (typeof window.attachGcashOcrAutoFill === 'function') {
        return Promise.resolve();
    }
    return Promise.reject(new Error('The shared GCash OCR helper is unavailable.'));
}

function loadPrePlayLookups() {
    return axios.get('../../api/admin/enrollment.php?operation=getLookups')
        .then(res => {
            studentPrePlayLookups = res.data || {};
            return studentPrePlayLookups;
        });
}

export function openStudentPrePlayEnrollment() {
    const student = getLoggedInStudent();
    const downpaymentModalEl = document.getElementById('downpaymentModal');

    if (!student || !student.user_id) {
        Swal.fire('Session Error', 'Please login again before enrolling.', 'error');
        return;
    }

    if (!downpaymentModalEl) {
        Swal.fire('Error', 'Downpayment modal is missing on this page.', 'error');
        return;
    }

    window.studentPrePlayDirectEnrollmentActive = true;
    currentPrePlayEnrollmentId = null;
    pendingPrePlayEnrollment = null;
    selectedPrePlayTuition = 0;

    loadPrePlayLookups()
        .then(() => {
            renderStudentPrePlayDownpayment();
            getBootstrapModal(downpaymentModalEl)?.show();
        })
        .catch(err => {
            window.studentPrePlayDirectEnrollmentActive = false;
            console.error('Error loading pre/play downpayment form:', err);
            Swal.fire('Error', 'Unable to load downpayment form. Please try again.', 'error');
        });
}

function submitStudentPrePlayEnrollment() {
    const student = getLoggedInStudent();
    const programId = document.getElementById('preschoolProgram')?.value;
    const branchId = document.getElementById('preschoolBranch')?.value;
    const classId = document.getElementById('preschoolClass')?.value;
    const sectionId = document.getElementById('preschoolSection')?.value;
    const program = (studentPrePlayLookups.programs || []).find(p => p.program_id == programId);

    if (!student || !student.user_id) {
        Swal.fire('Session Error', 'Please login again before enrolling.', 'error');
        return;
    }

    if (!programId || !branchId || !classId || !sectionId) {
        Swal.fire('Required', 'Please select a program, branch, class, and section.', 'warning');
        return;
    }

    if (!pendingPrePlayEnrollment?.enrollment_id) {
        Swal.fire('Missing Downpayment', 'Please complete the downpayment before finalizing enrollment.', 'warning');
        return;
    }

    selectedPrePlayTuition = program ? parseFloat(program.tuition) || 0 : 0;

    const payload = {
        student_id: student.user_id,
        program_id: programId,
        preferred_branch_id: branchId,
        class_id: classId,
        section_id: sectionId,
        school_year_id: studentPrePlayLookups.active_school_year ? studentPrePlayLookups.active_school_year.school_year_id : null,
        total_of_program: selectedPrePlayTuition.toString(),
        enrollment_category: 'preschool',
        pending_enrollment_id: pendingPrePlayEnrollment.enrollment_id
    };

    Swal.fire({
        title: 'Completing Enrollment...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    axios.post('../../api/admin/enrollment.php', {
        operation: 'completePendingEnrollment',
        json: JSON.stringify(payload)
    }).then(res => {
        Swal.close();

        if (res.data.status !== 'success') {
            Swal.fire('Error', res.data.message || 'Unable to complete enrollment.', 'error');
            return;
        }

        currentPrePlayEnrollmentId = res.data.enrollment_id;
        pendingPrePlayEnrollment = null;

        const enrollmentModal = getBootstrapModal(document.getElementById('enrollmentDetailsModal'));
        if (enrollmentModal) {
            enrollmentModal.hide();
        }

        Swal.fire({
            title: 'Enrollment Submitted',
            text: res.data.message || 'Your enrollment has been submitted.',
            icon: 'success',
            confirmButtonColor: '#5a67d8'
        }).then(() => {
            window.studentPrePlayDirectEnrollmentActive = false;
            if (typeof window.openBillingPlayPreModal === 'function') {
                window.openBillingPlayPreModal(currentPrePlayEnrollmentId, false);
            } else {
                location.reload();
            }
        });
    }).catch(err => {
        Swal.close();
        console.error('Pre/play enrollment error:', err);
        Swal.fire('Error', 'Network error while completing enrollment.', 'error');
    });
}

function resolvePrePlayDownpaymentQrUrl(qrPath) {
    const value = String(qrPath || '').trim();
    if (!value) return '';
    if (/^(?:https?:|data:|blob:|\/)/i.test(value) || value.startsWith('../')) return value;
    return `../../${value.replace(/^\.\//, '')}`;
}

function buildPrePlayDownpaymentMethodDetails(method) {
    if (!method) return '';
    const accountName = String(method.account_name || '').trim();
    const accountNumber = String(method.account_number || '').trim();
    const qrUrl = resolvePrePlayDownpaymentQrUrl(method.qr_code);
    if (!accountName && !accountNumber && !qrUrl) return '';
    return `<section class="dp-card dp-payment-account${qrUrl ? ' has-qr' : ''}" aria-labelledby="preplayDownpaymentAccountTitle">
        <div class="dp-payment-account-copy"><span class="dp-payment-account-eyebrow"><i class="bi bi-shield-check" aria-hidden="true"></i> Send payment to</span><h3 id="preplayDownpaymentAccountTitle">${escapeHtml(method.payment_method || 'Payment account')}</h3><dl>
            ${accountName ? `<div><dt>Account name</dt><dd>${escapeHtml(accountName)}</dd></div>` : ''}
            ${accountNumber ? `<div><dt>Account number</dt><dd><span>${escapeHtml(accountNumber)}</span><button type="button" class="dp-copy-account" id="preplayDownpaymentCopyAccount"><i class="bi bi-copy" aria-hidden="true"></i><span>Copy</span></button></dd></div>` : ''}
        </dl><p><i class="bi bi-info-circle" aria-hidden="true"></i> Verify these account details before sending your downpayment.</p></div>
        ${qrUrl ? `<button type="button" class="dp-account-qr" id="preplayDownpaymentOpenQr" title="View larger QR code"><img src="${escapeHtml(qrUrl)}" alt="${escapeHtml(method.payment_method || 'Payment')} QR code"><span><i class="bi bi-arrows-fullscreen" aria-hidden="true"></i> View larger</span></button>` : ''}
    </section>`;
}

function openPrePlayDownpaymentQrModal(method) {
    const qrUrl = resolvePrePlayDownpaymentQrUrl(method?.qr_code);
    if (!qrUrl) return;
    document.querySelector('.preplay-downpayment-qr-modal')?.remove();
    const modal = document.createElement('div');
    modal.className = 'preplay-downpayment-qr-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'preplayDownpaymentQrModalTitle');
    modal.innerHTML = `<div class="preplay-downpayment-qr-dialog"><button type="button" class="preplay-downpayment-qr-close-icon" aria-label="Close QR code"><i class="bi bi-x-lg" aria-hidden="true"></i></button><h3 id="preplayDownpaymentQrModalTitle">${escapeHtml(method.payment_method || 'Payment')}</h3><img src="${escapeHtml(qrUrl)}" alt="${escapeHtml(method.payment_method || 'Payment')} QR code"><button type="button" class="preplay-downpayment-qr-close-button">Close</button></div>`;
    document.body.appendChild(modal);
    const closeModal = () => {
        document.removeEventListener('keydown', handleKeydown, true);
        modal.remove();
        document.getElementById('preplayDownpaymentOpenQr')?.focus();
    };
    const handleKeydown = event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            closeModal();
        }
    };
    modal.addEventListener('click', event => {
        if (event.target === modal || event.target.closest('.preplay-downpayment-qr-close-icon, .preplay-downpayment-qr-close-button')) closeModal();
    });
    document.addEventListener('keydown', handleKeydown, true);
    modal.querySelector('.preplay-downpayment-qr-close-icon')?.focus();
}

function bindPrePlayDownpaymentMethodDetails(method) {
    const copyButton = document.getElementById('preplayDownpaymentCopyAccount');
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
    document.getElementById('preplayDownpaymentOpenQr')?.addEventListener('click', () => openPrePlayDownpaymentQrModal(method));
}

function preparePrePlayDownpaymentModal() {
    const modal = document.getElementById('downpaymentModal');
    if (!modal) return;

    modal.classList.add('student-downpayment-modal');
    modal.querySelector('.modal-title')?.classList.add('visually-hidden');

    const closeButton = modal.querySelector('.modal-header .btn-close');
    if (closeButton) closeButton.setAttribute('aria-label', 'Close downpayment');

    const footerClose = modal.querySelector('.modal-footer [data-bs-dismiss="modal"]');
    if (footerClose) {
        footerClose.className = 'btn downpayment-close-btn';
        footerClose.textContent = 'Close';
    }

    const submitButton = document.getElementById('submitDownpayment');
    if (submitButton) {
        submitButton.className = 'btn downpayment-submit-btn';
        submitButton.innerHTML = '<i class="bi bi-lock" aria-hidden="true"></i><span>Pay Downpayment &amp; Continue</span>';
    }

    if (document.getElementById('studentPrePlayDownpaymentStyles')) return;

    const styles = document.createElement('style');
    styles.id = 'studentPrePlayDownpaymentStyles';
    styles.textContent = `
        .student-downpayment-modal{--dp-blue:#e85d88;--dp-blue-dark:#d94b78;--dp-ink:#172033;--dp-muted:#667085;--dp-border:#dfe5ec;--dp-soft-blue:#fff4f7}
        .student-downpayment-modal .modal-dialog{width:min(1040px,calc(100% - 28px));max-width:1040px;margin:20px auto}
        .student-downpayment-modal .modal-content{overflow:hidden;border:0;border-radius:24px;box-shadow:0 24px 70px rgba(15,23,42,.16)}
        .student-downpayment-modal .modal-header{position:absolute;z-index:5;top:19px;right:20px;padding:0;border:0}
        .student-downpayment-modal .modal-header .btn-close{width:1.1rem;height:1.1rem;padding:.55rem;margin:0;opacity:.6}
        .student-downpayment-modal .modal-body{padding:66px 32px 18px;background:#fff}
        .student-downpayment-modal .modal-footer{justify-content:space-between;gap:12px;padding:18px 32px 22px;border-top:1px solid #e8edf3;background:#fff}
        .student-downpayment-modal .downpayment-close-btn,.student-downpayment-modal .downpayment-submit-btn{min-height:54px;border-radius:10px;font-size:1rem;font-weight:600}
        .student-downpayment-modal .downpayment-close-btn{min-width:145px;margin-right:auto;border:1px solid #d7dde5;color:#202938;background:#fff}
        .student-downpayment-modal .downpayment-submit-btn{display:inline-flex;flex:1 1 440px;align-items:center;justify-content:center;gap:10px;max-width:480px;border:0;color:#fff;background:linear-gradient(135deg,var(--dp-blue),#df4e7c);box-shadow:0 8px 18px rgba(232,93,136,.22)}
        .student-downpayment-modal .downpayment-submit-btn:hover{color:#fff;background:linear-gradient(135deg,var(--dp-blue-dark),#c93f6b)}
        .student-downpayment-modal .dp-hero{display:flex;align-items:center;gap:24px;padding:30px 26px;margin-bottom:28px;border:1px solid #f4bfd0;border-radius:18px;background:linear-gradient(110deg,#fff4f7,#fffafb)}
        .student-downpayment-modal .dp-hero-icon{display:grid;flex:0 0 88px;width:88px;height:88px;place-items:center;border-radius:50%;color:var(--dp-blue);background:#fde7ee;font-size:2.15rem}
        .student-downpayment-modal .dp-hero h2{margin:0 0 8px;color:var(--dp-ink);font-size:clamp(1.45rem,3vw,1.9rem);font-weight:750}
        .student-downpayment-modal .dp-hero p{margin:0;color:var(--dp-muted);font-size:1rem;line-height:1.55}
        .student-downpayment-modal .dp-card{padding:24px 26px;margin-bottom:18px;border:1px solid var(--dp-border);border-radius:15px;background:#fff;box-shadow:0 2px 5px rgba(15,23,42,.06)}
        .student-downpayment-modal .dp-card:last-child{margin-bottom:0}
        .student-downpayment-modal .dp-card-heading,.student-downpayment-modal .dp-card-title-row{display:flex;align-items:center;gap:14px}
        .student-downpayment-modal .dp-card-title-row{justify-content:space-between;align-items:flex-start;margin-bottom:20px}
        .student-downpayment-modal .dp-card-heading{margin-bottom:24px}.student-downpayment-modal .dp-card-title-row .dp-card-heading{margin-bottom:0}
        .student-downpayment-modal .dp-section-icon{display:grid;flex:0 0 38px;width:38px;height:38px;place-items:center;border-radius:8px;color:var(--dp-blue);background:#fde7ee;font-size:1.15rem}
        .student-downpayment-modal .dp-section-icon.solid{color:#fff;background:var(--dp-blue)}
        .student-downpayment-modal .dp-card h3{margin:0;color:var(--dp-ink);font-size:1.2rem;font-weight:750}
        .student-downpayment-modal .dp-badge{display:inline-flex;align-items:center;padding:3px 10px;margin-left:8px;border:1px solid #f1b2c6;border-radius:999px;color:#c93f6b;background:#fff1f5;font-size:.78rem;font-weight:600;vertical-align:2px}
        .student-downpayment-modal .dp-badge.success{border-color:#b9e6ca;color:#16834b;background:#effbf4}
        .student-downpayment-modal .dp-card-description{margin:5px 0 0;color:var(--dp-muted);line-height:1.5}
        .student-downpayment-modal .dp-field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px 32px}
        .student-downpayment-modal .dp-program-select{grid-column:1/-1}
        .student-downpayment-modal .dp-field{min-width:0}.student-downpayment-modal .dp-field label{margin-bottom:9px;color:#202938;font-weight:600}
        .student-downpayment-modal .dp-field .form-control,.student-downpayment-modal .dp-field .form-select,.student-downpayment-modal .dp-field .input-group-text{min-height:58px;border-color:#d3dae4;font-size:1rem}
        .student-downpayment-modal .dp-field .form-control,.student-downpayment-modal .dp-field .form-select{border-radius:9px;color:#344054}
        .student-downpayment-modal .dp-field .form-control:focus,.student-downpayment-modal .dp-field .form-select:focus{border-color:#ef9bb5;box-shadow:0 0 0 .2rem rgba(232,93,136,.14)}
        .student-downpayment-modal .dp-field .form-control:disabled{color:#111827;-webkit-text-fill-color:#111827;background:#f4f6f8;font-size:1.25rem;font-weight:700;opacity:1}
        .student-downpayment-modal .dp-field .input-group .form-control{border-radius:0 9px 9px 0}.student-downpayment-modal .dp-field .input-group-text{min-width:58px;justify-content:center;border-radius:9px 0 0 9px;background:#f4f6f8;font-weight:700}
        .student-downpayment-modal .dp-help{display:block;margin-top:8px;color:#8490a3;font-size:.86rem}
        .student-downpayment-modal .dp-read-receipt{display:inline-flex;flex:0 0 auto;align-items:center;gap:9px;min-height:50px;padding:0 20px;border:1px solid var(--dp-blue);border-radius:9px;color:var(--dp-blue);background:#fff;font-weight:600}
        .student-downpayment-modal .dp-upload-zone{position:relative;display:flex;min-height:186px;align-items:center;justify-content:center;padding:24px;overflow:hidden;border:2px dashed var(--dp-blue);border-radius:12px;background:var(--dp-soft-blue);text-align:center;cursor:pointer}
        .student-downpayment-modal .dp-upload-zone:hover{border-color:var(--dp-blue-dark);background:#ffedf3}
        .student-downpayment-modal .dp-upload-zone input[type=file]{position:absolute;inset:0;width:100%;height:100%;cursor:pointer;opacity:0}
        .student-downpayment-modal .dp-upload-copy{pointer-events:none}.student-downpayment-modal .dp-upload-copy i{display:block;margin-bottom:8px;color:var(--dp-blue);font-size:2.6rem}
        .student-downpayment-modal .dp-upload-title{display:block;color:var(--dp-ink);font-size:1.12rem;font-weight:700}.student-downpayment-modal .dp-upload-subtitle{display:block;margin-top:7px;color:var(--dp-muted)}
        .student-downpayment-modal #downpaymentOcrStatus{margin-top:8px!important}.student-downpayment-modal .dp-preview{margin-top:14px;padding:12px;border:1px solid #dbe3ed;border-radius:12px;background:#f8fafc;text-align:center}
        .student-downpayment-modal .dp-preview img{max-height:340px;object-fit:contain}.student-downpayment-modal [data-program-products-section]{grid-column:1/-1}
        .student-downpayment-modal .dp-payment-account{display:grid;grid-template-columns:1fr;gap:22px;align-items:center;border-color:#f1c4d2;background:linear-gradient(135deg,#fff8fa,#fff)}
        .student-downpayment-modal .dp-payment-account.has-qr{grid-template-columns:minmax(0,1fr) minmax(170px,220px)}
        .student-downpayment-modal .dp-payment-account-eyebrow{display:inline-flex;align-items:center;gap:7px;margin-bottom:7px;color:var(--dp-blue);font-size:.78rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase}
        .student-downpayment-modal .dp-payment-account-copy h3{margin:0 0 14px}.student-downpayment-modal .dp-payment-account-copy dl{display:grid;gap:10px;margin:0}.student-downpayment-modal .dp-payment-account-copy dl div{display:grid;grid-template-columns:118px minmax(0,1fr);gap:12px;align-items:center}
        .student-downpayment-modal .dp-payment-account-copy dt{color:var(--dp-muted);font-size:.8rem;font-weight:650}.student-downpayment-modal .dp-payment-account-copy dd{display:flex;align-items:center;gap:9px;min-width:0;margin:0;color:var(--dp-ink);font-weight:750;overflow-wrap:anywhere}.student-downpayment-modal .dp-payment-account-copy p{display:flex;gap:7px;margin:14px 0 0;color:var(--dp-muted);font-size:.79rem}
        .student-downpayment-modal .dp-copy-account{display:inline-flex;flex:0 0 auto;align-items:center;gap:5px;padding:5px 9px;border:1px solid #edb5c6;border-radius:7px;color:var(--dp-blue-dark);background:#fff;font-size:.75rem;font-weight:750}.student-downpayment-modal .dp-copy-account:hover,.student-downpayment-modal .dp-copy-account.is-copied{background:#fdeaf0}
        .student-downpayment-modal .dp-account-qr{display:grid;justify-items:center;gap:8px;padding:10px;border:1px solid #efd3dc;border-radius:11px;color:var(--dp-blue-dark);background:#fff;font-size:.78rem;font-weight:750}.student-downpayment-modal .dp-account-qr img{width:100%;max-width:190px;max-height:190px;border-radius:7px;object-fit:contain}.student-downpayment-modal .dp-account-qr:hover{border-color:var(--dp-blue)}
        .preplay-downpayment-qr-modal{position:fixed;inset:0;z-index:20000;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.58);backdrop-filter:blur(2px)}.preplay-downpayment-qr-dialog{position:relative;display:grid;justify-items:center;width:min(640px,calc(100vw - 28px));max-height:calc(100vh - 28px);padding:30px 30px 26px;overflow:auto;border-radius:10px;background:#fff;box-shadow:0 24px 70px rgba(15,23,42,.3)}
        .preplay-downpayment-qr-dialog h3{margin:0 42px 22px;color:#4a4a4a;font-size:2rem;font-weight:750;text-align:center}.preplay-downpayment-qr-dialog img{display:block;max-width:100%;max-height:65vh;border-radius:10px;object-fit:contain}.preplay-downpayment-qr-close-icon{position:absolute;top:14px;right:14px;display:grid;width:36px;height:36px;place-items:center;border:0;border-radius:50%;color:#667085;background:transparent}.preplay-downpayment-qr-close-icon:hover{background:#f2f4f7}.preplay-downpayment-qr-close-button{min-width:92px;min-height:46px;margin-top:24px;padding:0 22px;border:0;border-radius:7px;color:#fff;background:var(--dp-blue);font-weight:750}.preplay-downpayment-qr-close-button:hover{background:var(--dp-blue-dark)}
        @media(max-width:767.98px){.student-downpayment-modal .modal-dialog{width:calc(100% - 16px);margin:8px auto}.student-downpayment-modal .modal-content{border-radius:18px}.student-downpayment-modal .modal-body{padding:56px 14px 14px}.student-downpayment-modal .modal-footer{padding:14px}.student-downpayment-modal .dp-hero{align-items:flex-start;gap:14px;padding:22px 18px;margin-bottom:16px}.student-downpayment-modal .dp-hero-icon{flex-basis:56px;width:56px;height:56px;font-size:1.55rem}.student-downpayment-modal .dp-card{padding:20px 16px}.student-downpayment-modal .dp-payment-account,.student-downpayment-modal .dp-payment-account.has-qr{grid-template-columns:1fr;gap:16px}.student-downpayment-modal .dp-payment-account-copy dl div{grid-template-columns:1fr;gap:3px}.student-downpayment-modal .dp-account-qr{width:min(220px,100%);justify-self:center}.preplay-downpayment-qr-modal{padding:10px}.preplay-downpayment-qr-dialog{width:calc(100vw - 20px);max-height:calc(100vh - 20px);padding:24px 16px 20px}.preplay-downpayment-qr-dialog h3{margin-bottom:18px;font-size:1.55rem}.preplay-downpayment-qr-dialog img{max-height:68vh}.student-downpayment-modal .dp-field-grid{grid-template-columns:1fr;gap:18px}.student-downpayment-modal .dp-program-select{grid-column:auto}.student-downpayment-modal [data-program-products-section]{grid-column:auto}.student-downpayment-modal .dp-card-title-row{display:block}.student-downpayment-modal .dp-read-receipt{width:100%;justify-content:center;margin-top:16px}.student-downpayment-modal .modal-footer>*{margin:0}.student-downpayment-modal .downpayment-close-btn{min-width:100px}}
        @media(max-width:480px){.student-downpayment-modal .modal-footer{flex-wrap:wrap}.student-downpayment-modal .downpayment-close-btn,.student-downpayment-modal .downpayment-submit-btn{width:100%;max-width:none}}
    `;
    document.head.appendChild(styles);
}

function bindPrePlayDownpaymentUploadFilename() {
    const input = document.getElementById('downpaymentScreenshotInput');
    const filename = document.getElementById('downpaymentUploadFilename');
    if (!input || !filename) return;

    input.addEventListener('change', () => {
        filename.textContent = input.files?.[0]?.name || 'Drag and drop your file here, or click to browse';
    });
}

function renderStudentPrePlayDownpayment() {
    const form = document.getElementById('downpaymentForm');
    const title = document.getElementById('downpaymentModalLabel');
    const submitBtn = document.getElementById('submitDownpayment');

    if (!form) return;
    preparePrePlayDownpaymentModal();
    if (title) title.textContent = 'Step 1: Downpayment';
    if (submitBtn) {
        submitBtn.innerHTML = '<i class="bi bi-lock" aria-hidden="true"></i><span>Pay Downpayment &amp; Continue</span>';
        submitBtn.onclick = submitStudentPrePlayDownpayment;
    }

    form.innerHTML = '<p class="text-center text-muted"><i class="bi bi-hourglass"></i> Loading payment methods...</p>';

    axios.get('../../api/student/payment.php?operation=getPaymentMethods')
        .then(res => {
            if (res.data.status !== 'success' || !Array.isArray(res.data.data)) {
                form.innerHTML = '<div class="alert alert-warning">Could not load payment methods. Please try again.</div>';
                return;
            }

            const gcashMethod = res.data.data.find(m => (m.payment_method || '').toLowerCase().includes('gcash'));
            const gcashId = gcashMethod ? gcashMethod.payment_method_id : '';
            const preschoolPrograms = getPreschoolPrograms();
            const programOptions = preschoolPrograms.length > 0
                ? preschoolPrograms.map(p => {
                    const programType = getProgramTypeLabel(p);
                    const downpayment = parseFloat(p.downpayment || 0);
                    const tuition = parseFloat(p.tuition || 0);
                    return `<option value="${p.program_id}" data-tuition="${tuition}" data-downpayment="${downpayment}" data-program-type="${programType}">${p.name}${programType ? ` (${programType})` : ''}</option>`;
                }).join('')
                : '<option value="">No pre-school / play-school programs available</option>';

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
                            <label class="form-label" for="downpaymentProgramInput">Select Pre-school / Play-school Program</label>
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

                <input type="hidden" id="paymentMethodInput" value="${gcashId}" data-method-name="${gcashMethod ? gcashMethod.payment_method : 'GCash'}">
                ${buildPrePlayDownpaymentMethodDetails(gcashMethod)}
                <section class="dp-card" id="downpaymentScreenshotField" aria-labelledby="downpaymentReceiptTitle">
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
                        <div class="dp-field" id="referenceField">
                            <label class="form-label" for="transactionReferenceInput">GCash Reference Number</label>
                            <input type="text" class="form-control" id="transactionReferenceInput" placeholder="Enter transaction reference number" required>
                            <small class="dp-help">Auto-filled from your receipt.</small>
                        </div>
                    </div>
                </section>
            `;
            markRequiredFieldLabels(form);
            bindPrePlayDownpaymentUploadFilename();
            bindPrePlayDownpaymentMethodDetails(gcashMethod);

            const programSelect = document.getElementById('downpaymentProgramInput');
            if (programSelect) {
                programSelect.addEventListener('change', updatePrePlayDownpaymentPreview);
            }

            ensurePrePlayPaymentOcrHelpers()
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
                    console.error('Unable to load OCR helpers for pre-play downpayment:', error);
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

function submitStudentPrePlayDownpayment() {
    const student = getLoggedInStudent();
    const programId = document.getElementById('downpaymentProgramInput')?.value;
    const amount = parseFloat(document.getElementById('downpaymentAmountInput')?.value);
    const methodInput = document.getElementById('paymentMethodInput');
    const reference = document.getElementById('transactionReferenceInput')?.value.trim();
    const screenshotFile = document.getElementById('downpaymentScreenshotInput')?.files?.[0] || null;
    const ocrBusy = document.getElementById('downpaymentOcrStatus')?.dataset.ocrBusy === 'true';

    if (!student || !student.user_id) {
        Swal.fire('Session Error', 'Please login again before enrolling.', 'error');
        return;
    }

    if (!programId) {
        Swal.fire('Program Required', 'Please select a pre-school / play-school program first.', 'warning');
        return;
    }

    if (!amount || amount <= 0) {
        Swal.fire('Invalid Amount', 'Please enter a valid downpayment amount.', 'warning');
        return;
    }

    if (!methodInput?.value) {
        Swal.fire('Invalid Payment', 'A valid payment method is required.', 'warning');
        return;
    }

    if (!screenshotFile) {
        Swal.fire('Missing Screenshot', 'Please upload the GCash payment screenshot first.', 'warning');
        return;
    }
    if (screenshotFile.size > 10 * 1024 * 1024) {
        Swal.fire('File Too Large', 'Please upload a JPG or PNG receipt no larger than 10MB.', 'warning');
        return;
    }

    if (ocrBusy) {
        Swal.fire('Reading Screenshot', 'OCR is still reading the receipt. Please wait a moment.', 'info');
        return;
    }

    if (!reference) {
        Swal.fire('Missing Reference', 'Please enter your GCash transaction ID.', 'warning');
        return;
    }

    Swal.fire({
        title: 'Processing Payment...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    const payload = {
        student_id: student.user_id,
        program_id: programId,
        amount: amount,
        method: methodInput.value,
        ref: reference,
        school_year_id: studentPrePlayLookups.active_school_year ? studentPrePlayLookups.active_school_year.school_year_id : null
    };
    const formData = new FormData();
    formData.append('operation', 'createPendingDownpaymentEnrollment');
    formData.append('json', JSON.stringify(payload));
    formData.append('payment_screenshot', screenshotFile);

    axios.post('../../api/admin/enrollment.php', formData).then(res => {
        Swal.close();

        if (res.data.status !== 'success') {
            Swal.fire('Error', res.data.message || 'Failed to process downpayment.', 'error');
            return;
        }

        currentPrePlayEnrollmentId = res.data.enrollment_id;
        pendingPrePlayEnrollment = {
            enrollment_id: res.data.enrollment_id,
            program_id: res.data.program_id,
            program_name: res.data.program_display_name || res.data.program_name || '',
            program_type: res.data.program_type || ''
        };

        getBootstrapModal(document.getElementById('downpaymentModal'))?.hide();

        const receiptData = {
            enrollmentId: res.data.enrollment_id,
            studentName: res.data.student_name || 'Student',
            programName: res.data.program_display_name || res.data.program_name || '',
            programType: res.data.program_type || '',
            paymentFor: 'Enrollment Downpayment',
            paymentMethod: res.data.payment_method || methodInput.dataset.methodName || 'GCash',
            referenceNo: res.data.reference_no || reference,
            paymentScreenshotPath: res.data.payment_screenshot_path || null,
            receiptNo: res.data.receipt_id || null,
            amountPaid: amount,
            balance: parseFloat(res.data.balance || 0),
            totalAmount: amount,
            paymentDate: new Date(),
            lineItems: [
                ...(parseFloat(res.data.downpayment_amount || 0) > 0 ? [{ label: 'Downpayment', amount: parseFloat(res.data.downpayment_amount || 0) }] : [])
            ]
        };
        const receiptHandler = getStudentReceiptHandler();

        Promise.resolve(
            typeof receiptHandler === 'function'
                ? receiptHandler(receiptData)
                : Swal.fire('Downpayment Submitted', res.data.message || 'You may now continue enrollment details.', 'success')
        ).then(() => {
            const studentName = res.data.student_name || student.username || 'Student';
            renderPreschoolEnrollment(studentName, studentPrePlayLookups, submitStudentPrePlayEnrollment);

            const programSelect = document.getElementById('preschoolProgram');
            if (programSelect) {
                programSelect.value = String(pendingPrePlayEnrollment.program_id);
                programSelect.dispatchEvent(new Event('change'));
                programSelect.disabled = true;
            }

            const finalizeBtn = document.getElementById('finalizeEnrollment');
            if (finalizeBtn) {
                finalizeBtn.textContent = 'Submit Enrollment';
            }

            getBootstrapModal(document.getElementById('enrollmentDetailsModal'))?.show();
        });
    }).catch(err => {
        Swal.close();
        console.error('Downpayment error:', err);
        Swal.fire('Error', 'Network error while processing downpayment.', 'error');
    });
}

function getProgramTypeLabel(program) {
    const programType = (studentPrePlayLookups.program_types || []).find(pt => pt.program_type_id == program.program_type);
    return programType ? programType.type : (program.type_name || '');
}

function getPreschoolPrograms() {
    const allPrograms = studentPrePlayLookups.programs || [];
    let preschoolPrograms = allPrograms.filter(p => p.program_type == 3);

    if (preschoolPrograms.length === 0) {
        preschoolPrograms = allPrograms.filter(p => {
            const name = (p.name || '').toLowerCase();
            return name.includes('preschool') ||
                name.includes('playschool') ||
                name.includes('pre-school') ||
                name.includes('play-school') ||
                name.includes('pre school') ||
                name.includes('play school');
        });
    }

    return preschoolPrograms;
}

function updatePrePlayDownpaymentPreview() {
    const programId = this.value;
    const selectedOption = this.options[this.selectedIndex];
    const tuition = parseFloat(selectedOption?.dataset?.tuition || 0);
    const downpayment = parseFloat(selectedOption?.dataset?.downpayment || 0);

    selectedPrePlayTuition = tuition;

    const feeInput = document.getElementById('estimatedProgramFee');
    const downpaymentPreview = document.getElementById('programDownpaymentPreview');
    const amountInput = document.getElementById('downpaymentAmountInput');

    if (feeInput) feeInput.value = `PHP ${tuition.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (downpaymentPreview) downpaymentPreview.value = `PHP ${downpayment.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (amountInput) amountInput.value = downpayment.toFixed(2);
    loadProgramProductsPreview(programId, 'downpaymentProgramProductsPreview');
}

async function openPendingPrePlayEnrollmentCompletion(enrollmentId) {
    const student = getLoggedInStudent();

    if (!student || !student.user_id) {
        Swal.fire('Session Error', 'Please login again before completing enrollment.', 'error');
        return;
    }

    if (!enrollmentId) {
        Swal.fire('Error', 'Enrollment ID is missing.', 'error');
        return;
    }

    if (!hasPrePlayEnrollmentUi()) {
        sessionStorage.setItem(STUDENT_PENDING_PREPLAY_COMPLETION_KEY, JSON.stringify({ enrollmentId }));
        window.location.href = './enrollement_pre_play.html';
        return;
    }

    try {
        Swal.fire({
            title: 'Loading enrollment...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        await loadPrePlayLookups();
        const res = await axios.get(`../../api/student/enrollment.php?operation=getEnrollmentDetails&id=${enrollmentId}`);
        Swal.close();

        if (res.data.status !== 'success') {
            Swal.fire('Error', res.data.message || 'Unable to load enrollment details.', 'error');
            return;
        }

        const details = res.data.data.details || {};
        const status = (details.status || '').toLowerCase();
        if (status !== 'incomplete') {
            Swal.fire('Not Incomplete', 'Only incomplete enrollments can be completed from this action.', 'info');
            return;
        }

        currentPrePlayEnrollmentId = enrollmentId;
        pendingPrePlayEnrollment = {
            enrollment_id: enrollmentId,
            program_id: details.program_id,
            program_name: details.program_name || '',
            program_type: ''
        };

        const studentName = formatStudentName(details) || student.username || 'Student';
        renderPreschoolEnrollment(studentName, studentPrePlayLookups, submitStudentPrePlayEnrollment, details.program_id);

        const finalizeBtn = document.getElementById('finalizeEnrollment');
        if (finalizeBtn) {
            finalizeBtn.textContent = 'Submit Enrollment';
        }

        getBootstrapModal(document.getElementById('enrollmentDetailsModal'))?.show();
    } catch (err) {
        Swal.close();
        console.error('Error opening incomplete pre/play enrollment:', err);
        Swal.fire('Error', 'Network error occurred while loading the incomplete enrollment.', 'error');
    }
}

window.openStudentPrePlayEnrollment = openStudentPrePlayEnrollment;
window.openPendingPrePlayEnrollmentCompletion = openPendingPrePlayEnrollmentCompletion;

function resumePendingPrePlayEnrollmentCompletionRequest() {
    if (!hasPrePlayEnrollmentUi()) {
        return;
    }

    const rawRequest = sessionStorage.getItem(STUDENT_PENDING_PREPLAY_COMPLETION_KEY);
    if (!rawRequest) {
        return;
    }

    sessionStorage.removeItem(STUDENT_PENDING_PREPLAY_COMPLETION_KEY);

    try {
        const request = JSON.parse(rawRequest);
        if (request?.enrollmentId) {
            openPendingPrePlayEnrollmentCompletion(request.enrollmentId);
        }
    } catch (error) {
        console.error('Unable to resume pending pre-play enrollment completion request:', error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const startButton = document.getElementById('btn-start-enrollment');
    if (startButton) {
        startButton.addEventListener('click', openStudentPrePlayEnrollment);
    }

    resumePendingPrePlayEnrollmentCompletionRequest();
});
