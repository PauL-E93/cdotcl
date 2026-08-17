import { canUseEnrollmentPermission } from './enrollment_rbac.js';

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

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[char]));
}

function preparePreschoolEnrollmentModal(studentName) {
    const modal = document.getElementById('enrollmentDetailsModal');
    if (!modal) return;

    modal.classList.remove('tutorial-enrollment-modal');
    modal.classList.add('preschool-enrollment-modal');
    modal.querySelector('.modal-dialog')?.classList.add('modal-xl', 'modal-dialog-scrollable');

    const header = modal.querySelector('.modal-header');
    if (header) {
        header.innerHTML = `
            <div class="preschool-modal-heading">
                <span class="preschool-modal-heading-icon"><i class="bi bi-file-earmark-person"></i></span>
                <h2 class="modal-title" id="enrollmentDetailsModalLabel">Pre-school Enrollment: ${escapeHtml(studentName)}</h2>
            </div>
            <button type="button" class="btn preschool-header-close" data-bs-dismiss="modal" aria-label="Close">
                <i class="bi bi-x-lg"></i>
            </button>
        `;
    }

    const footer = modal.querySelector('.modal-footer');
    const closeBtn = footer?.querySelector('[data-bs-dismiss="modal"]');
    const finalizeBtn = document.getElementById('finalizeEnrollment');
    if (closeBtn) {
        closeBtn.className = 'btn preschool-close-btn';
        closeBtn.textContent = 'Close';
    }
    if (finalizeBtn) {
        finalizeBtn.className = 'btn preschool-finalize-btn';
        finalizeBtn.innerHTML = '<i class="bi bi-lock"></i><span>Finalize Enrollment</span>';
    }

    if (document.getElementById('preschoolEnrollmentModalStyles')) return;

    const style = document.createElement('style');
    style.id = 'preschoolEnrollmentModalStyles';
    style.textContent = `
        #enrollmentDetailsModal.preschool-enrollment-modal {
            --preschool-accent: #e85d88;
            --preschool-accent-dark: #cf3f70;
            --preschool-soft: #fff0f5;
            --preschool-border: #f5bfd0;
            --preschool-neutral-border: #dce1e9;
            --preschool-text: #171827;
            --preschool-muted: #747b8b;
        }
        #enrollmentDetailsModal.preschool-enrollment-modal .modal-dialog {
            max-width: min(1160px, calc(100vw - 32px));
        }
        #enrollmentDetailsModal.preschool-enrollment-modal .modal-content {
            border: 0;
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 0 22px 65px rgba(94, 29, 52, .18);
        }
        #enrollmentDetailsModal.preschool-enrollment-modal .modal-header {
            align-items: center;
            min-height: 84px;
            padding: 18px 32px;
            border-bottom: 1px solid #f2dce4;
            background: #fff;
        }
        #enrollmentDetailsModal .preschool-modal-heading {
            display: flex;
            align-items: center;
            gap: 22px;
            min-width: 0;
        }
        #enrollmentDetailsModal .preschool-modal-heading-icon,
        #enrollmentDetailsModal .preschool-section-icon {
            display: inline-flex;
            flex: 0 0 auto;
            align-items: center;
            justify-content: center;
            color: var(--preschool-accent);
            background: var(--preschool-soft);
            border: 1px solid var(--preschool-border);
        }
        #enrollmentDetailsModal .preschool-modal-heading-icon {
            width: 50px;
            height: 50px;
            border-radius: 10px;
            font-size: 24px;
        }
        #enrollmentDetailsModal .preschool-modal-heading h2 {
            overflow: hidden;
            margin: 0;
            color: var(--preschool-text);
            font-size: 27px;
            font-weight: 750;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        #enrollmentDetailsModal .preschool-header-close {
            padding: 8px;
            color: var(--preschool-accent);
            border: 0;
            background: transparent;
            font-size: 28px;
            line-height: 1;
        }
        #enrollmentDetailsModal.preschool-enrollment-modal .modal-body {
            padding: 20px 32px 18px;
            background: #fff;
        }
        #enrollmentDetailsModal .preschool-enrollment-alert {
            display: flex;
            align-items: center;
            gap: 18px;
            min-height: 62px;
            margin-bottom: 20px;
            padding: 15px 22px;
            color: var(--preschool-accent-dark);
            border: 1px solid var(--preschool-border);
            border-radius: 10px;
            background: #fff9fb;
            font-size: 18px;
            font-weight: 650;
        }
        #enrollmentDetailsModal .preschool-enrollment-alert i {
            font-size: 24px;
        }
        #enrollmentDetailsModal .preschool-program-card {
            padding: 22px;
            border: 1px solid var(--preschool-border);
            border-radius: 12px;
            background: #fff;
        }
        #enrollmentDetailsModal .preschool-section-title {
            display: flex;
            align-items: center;
            gap: 14px;
            padding-bottom: 13px;
            margin: 0 0 20px;
            color: var(--preschool-text);
            border-bottom: 1px solid #f3d8e2;
            font-size: 21px;
            font-weight: 700;
        }
        #enrollmentDetailsModal .preschool-section-icon {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            font-size: 19px;
        }
        #enrollmentDetailsModal.preschool-enrollment-modal .form-label {
            margin-bottom: 8px;
            color: var(--preschool-text);
            font-size: 15px;
            font-weight: 500;
        }
        #enrollmentDetailsModal.preschool-enrollment-modal .form-control,
        #enrollmentDetailsModal.preschool-enrollment-modal .form-select {
            min-height: 48px;
            color: var(--preschool-text);
            border-color: var(--preschool-neutral-border);
            border-radius: 8px;
            font-size: 15px;
        }
        #enrollmentDetailsModal.preschool-enrollment-modal .form-control:focus,
        #enrollmentDetailsModal.preschool-enrollment-modal .form-select:focus {
            border-color: var(--preschool-accent);
            box-shadow: 0 0 0 .2rem rgba(232, 93, 136, .12);
        }
        #enrollmentDetailsModal.preschool-enrollment-modal .form-control:disabled,
        #enrollmentDetailsModal.preschool-enrollment-modal .form-select:disabled {
            color: #555d6c;
            background: #f8f8f9;
            opacity: 1;
        }
        #enrollmentDetailsModal .preschool-help-text {
            display: block;
            margin-top: 7px;
            color: var(--preschool-muted);
            font-size: 12px;
        }
        #enrollmentDetailsModal .preschool-section-count {
            display: block;
            margin-top: 7px;
            color: var(--preschool-accent-dark);
            font-size: 12px;
            font-weight: 600;
        }
        #enrollmentDetailsModal.preschool-enrollment-modal .modal-footer {
            justify-content: flex-end;
            gap: 18px;
            padding: 18px 32px 22px;
            border-top: 1px solid #edf0f4;
            background: #fff;
        }
        #enrollmentDetailsModal .preschool-close-btn,
        #enrollmentDetailsModal .preschool-finalize-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            min-height: 48px;
            padding: 10px 28px;
            border-radius: 8px;
            font-size: 15px;
            font-weight: 600;
        }
        #enrollmentDetailsModal .preschool-close-btn {
            min-width: 130px;
            color: var(--preschool-text);
            border: 1px solid var(--preschool-border);
            background: #fff;
        }
        #enrollmentDetailsModal .preschool-finalize-btn {
            min-width: 270px;
            color: #fff;
            border: 0;
            background: linear-gradient(100deg, #e85d88, #f07ba0);
            box-shadow: 0 9px 20px rgba(232, 93, 136, .22);
        }
        #enrollmentDetailsModal .preschool-finalize-btn:hover {
            color: #fff;
            filter: brightness(.96);
        }
        @media (max-width: 767.98px) {
            #enrollmentDetailsModal.preschool-enrollment-modal .modal-dialog {
                max-width: calc(100vw - 16px);
                margin: 8px auto;
            }
            #enrollmentDetailsModal.preschool-enrollment-modal .modal-header,
            #enrollmentDetailsModal.preschool-enrollment-modal .modal-body,
            #enrollmentDetailsModal.preschool-enrollment-modal .modal-footer {
                padding-left: 18px;
                padding-right: 18px;
            }
            #enrollmentDetailsModal .preschool-modal-heading {
                gap: 12px;
            }
            #enrollmentDetailsModal .preschool-modal-heading-icon {
                width: 42px;
                height: 42px;
                font-size: 20px;
            }
            #enrollmentDetailsModal .preschool-modal-heading h2 {
                font-size: 19px;
            }
            #enrollmentDetailsModal .preschool-enrollment-alert {
                min-height: 54px;
                font-size: 16px;
            }
            #enrollmentDetailsModal .preschool-close-btn,
            #enrollmentDetailsModal .preschool-finalize-btn {
                flex: 1 1 auto;
                min-width: 0;
                padding-inline: 12px;
            }
        }
    `;
    document.head.appendChild(style);
}

export function renderPreschoolEnrollment(studentName, globalLookups, saveHandler, selectedProgramId = null) {
    const form = document.getElementById("enrollmentForm");
    if (!form) return;
    preparePreschoolEnrollmentModal(studentName);

    const allPrograms = globalLookups.programs || [];

    let preschoolPrograms = allPrograms.filter(p =>
        p.program_type == 3 || (p.name && (
            p.name.toLowerCase().includes('preschool') ||
            p.name.toLowerCase().includes('play') ||
            p.name.toLowerCase().includes('pre-school') ||
            p.name.toLowerCase().includes('playschool') ||
            p.name.toLowerCase().includes('pre school') ||
            p.name.toLowerCase().includes('play school')
        ))
    );

    if (preschoolPrograms.length === 0) {
        console.warn('WARNING: No preschool programs found. Showing all programs instead.');
        preschoolPrograms = allPrograms;
    }

    const html = `
        <div class="preschool-enrollment-alert">
            <i class="bi bi-info-circle"></i>
            <span>Academic Year Enrollment</span>
        </div>

        <section class="preschool-program-card">
            <h3 class="preschool-section-title">
                <span class="preschool-section-icon"><i class="bi bi-mortarboard-fill"></i></span>
                <span>Program Details</span>
            </h3>
            <div class="row g-4">
            <div class="col-md-6">
                <label class="form-label">School Year <span class="text-danger" aria-hidden="true">*</span></label>
                <input type="text" class="form-control" disabled value="${globalLookups.active_school_year ? globalLookups.active_school_year.school_year : 'No active school year'}">
            </div>
            <div class="col-md-6">
                <label class="form-label" for="preschoolProgram">Program</label>
                <select class="form-select" id="preschoolProgram" required ${selectedProgramId ? 'disabled' : ''}>
                    <option value="">-- Select Program --</option>
                    ${preschoolPrograms.length > 0 ? preschoolPrograms.map(p => `<option value="${p.program_id}"${p.program_id == selectedProgramId ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('') : '<option disabled>No programs available</option>'}
                </select>
                ${selectedProgramId ? '<small class="preschool-help-text"><i class="bi bi-lock me-1"></i>Program locked from the saved downpayment.</small>' : ''}
            </div>
            <div class="col-md-6">
                <label class="form-label" for="preschoolClass">Class</label>
                <select class="form-select" id="preschoolClass" required disabled>
                    <option value="">-- Select Program First --</option>
                </select>
            </div>
            <div class="col-md-6" id="sectionContainer" style="display:none;">
                <label class="form-label" for="preschoolSection">Section</label>
                <select class="form-select" id="preschoolSection" required disabled>
                    <option value="">-- Select Class First --</option>
                </select>
                <small id="sectionCount" class="preschool-section-count"></small>
            </div>
            </div>
        </section>
    `;
    form.innerHTML = html;
    markRequiredFieldLabels(form);

    const programSelect = document.getElementById('preschoolProgram');
    const classSelect = document.getElementById('preschoolClass');
    const sectionSelect = document.getElementById('preschoolSection');
    const sectionContainer = document.getElementById('sectionContainer');

    const allClasses = globalLookups.classes || [];
    const allSections = globalLookups.sections || [];

    programSelect.addEventListener('change', function() {
        const currentProgramId = this.value;
        classSelect.innerHTML = '<option value="">-- Select Class --</option>';
        classSelect.disabled = true;
        sectionSelect.innerHTML = '<option value="">-- Select Class First --</option>';
        sectionSelect.disabled = true;
        sectionContainer.style.display = 'none';

        if (currentProgramId) {
            const openClasses = allClasses.filter(c =>
                c.program_id == currentProgramId && c.status && c.status.toLowerCase() === 'open'
            );

            if (openClasses.length > 0) {
                classSelect.innerHTML = '<option value="">-- Select Class --</option>' +
                    openClasses.map(c => `<option value="${c.class_id}">${escapeHtml(c.program_name)} (${escapeHtml(c.branch_name)})</option>`).join('');
                classSelect.disabled = false;
            } else {
                classSelect.innerHTML = '<option value="">No open classes available</option>';
            }
        }
    });

    if (selectedProgramId) {
        programSelect.dispatchEvent(new Event('change'));
    }

    classSelect.addEventListener('change', function() {
        const selectedClassId = this.value;
        sectionSelect.innerHTML = '<option value="">-- Select Section --</option>';
        sectionSelect.disabled = true;
        sectionContainer.style.display = 'none';

        if (selectedClassId) {
            const openSections = allSections.filter(s =>
                s.class_id == selectedClassId && s.status && s.status.toLowerCase() === 'open'
            );

            if (openSections.length > 0) {
                sectionSelect.innerHTML = '<option value="">-- Select Section --</option>' +
                    openSections.map(s => `<option value="${s.section_id}">${escapeHtml(s.section_name)}</option>`).join('');
                sectionSelect.disabled = false;
                sectionContainer.style.display = 'block';
            } else {
                sectionSelect.innerHTML = '<option value="">No open sections available</option>';
                sectionContainer.style.display = 'block';
            }
        }
    });

    sectionSelect.addEventListener('change', function() {
        const selectedSectionId = this.value;
        const countEl = document.getElementById('sectionCount');
        if (selectedSectionId) {
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

    const saveBtn = document.getElementById("finalizeEnrollment");
    if (saveBtn) {
        saveBtn.onclick = saveHandler;
        saveBtn.innerHTML = '<i class="bi bi-lock"></i><span>Finalize Enrollment</span>';
        saveBtn.style.display = canUseEnrollmentPermission(selectedProgramId ? 'approve' : 'create') ? 'inline-flex' : 'none';
    }
}
