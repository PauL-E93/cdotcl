import { buildAppUrl } from '../utilities/app_url.js';
import {
    canUseStudentManagementPermission,
    initStudentManagementPermissions
} from './student_management_rbac.js';

const PAGE_SIZE = 10;

const state = {
    students: [],
    filteredStudents: [],
    lookups: { programs: [], branches: [], genders: [] },
    meta: { can_edit: false, can_export: false },
    page: 1,
    modal: null,
    activeStudentId: null,
    searchTimer: null
};

function apiUrl(operation, params = {}) {
    const url = new URL(buildAppUrl('api/admin/student_management.php'), window.location.origin);
    url.searchParams.set('operation', operation);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== '') {
            url.searchParams.set(key, value);
        }
    });
    return url.toString();
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, {
        credentials: 'same-origin',
        cache: 'no-store',
        ...options
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.status !== 'success') {
        throw new Error(payload?.message || 'Unable to load student information.');
    }
    return payload;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function cleanText(value, fallback = '—') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function fullName(student) {
    return [student.first_name, student.middle_name, student.last_name, student.ext]
        .map(value => String(value ?? '').trim())
        .filter(Boolean)
        .join(' ');
}

function initials(student) {
    const first = String(student.first_name ?? '').trim().charAt(0);
    const last = String(student.last_name ?? '').trim().charAt(0);
    return `${first}${last}`.toUpperCase() || 'ST';
}

function safeProfilePicture(path) {
    const normalized = String(path ?? '').trim().replaceAll('\\', '/');
    if (!normalized.startsWith('uploads/student_profiles/')) return '';
    return buildAppUrl(normalized);
}

function avatarHtml(student, className = '') {
    const picture = safeProfilePicture(student.profile_picture);
    const content = picture
        ? `<img src="${escapeHtml(picture)}" alt="">`
        : escapeHtml(initials(student));
    return `<span class="student-avatar ${className}" aria-hidden="true">${content}</span>`;
}

function normalizeStatus(value) {
    return String(value || 'none').trim().toLowerCase().replaceAll(' ', '-');
}

function statusBadge(value) {
    const normalized = normalizeStatus(value);
    const label = normalized === 'none' ? 'No enrollment' : normalized.replaceAll('-', ' ');
    return `<span class="student-status-badge student-status-${escapeHtml(normalized)}">${escapeHtml(label)}</span>`;
}

function formatDate(value, includeTime = false) {
    if (!value) return '—';
    const normalized = String(value).includes('T') ? String(value) : String(value).replace(' ', 'T');
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return cleanText(value);
    return new Intl.DateTimeFormat('en-PH', includeTime
        ? { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
        : { year: 'numeric', month: 'short', day: 'numeric' }
    ).format(date);
}

async function hydrateSharedTemplate() {
    const templateSource = document.getElementById('student-management-template-source');
    if (!templateSource) return;

    const source = templateSource.dataset.templateSource;
    const response = await fetch(source, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) {
        throw new Error('Unable to load the student management page layout.');
    }

    const sourceHtml = await response.text();
    const sourceDocument = new DOMParser().parseFromString(sourceHtml, 'text/html');
    const sourceMain = sourceDocument.querySelector('[data-student-management-page]');
    const sourceModal = sourceDocument.getElementById('studentProfileModal');
    const targetMain = document.querySelector('[data-student-management-page]');

    if (!sourceMain || !sourceModal || !targetMain) {
        throw new Error('The student management page layout is incomplete.');
    }

    targetMain.innerHTML = sourceMain.innerHTML;
    document.body.appendChild(document.importNode(sourceModal, true));
    templateSource.remove();
}

function renderAccessDenied(message) {
    const main = document.querySelector('[data-student-management-page]');
    if (!main) return;
    main.innerHTML = `
        <div class="alert alert-warning shadow-sm" role="alert">
            <i class="bi bi-shield-lock me-2"></i>${escapeHtml(message)}
        </div>`;
}

function populateLookups() {
    const programSelect = document.getElementById('student-program-filter');
    const branchSelect = document.getElementById('student-branch-filter');
    const genderSelect = document.getElementById('student-edit-gender');

    (state.lookups.programs || []).forEach(program => {
        const option = document.createElement('option');
        option.value = program.program_id;
        option.textContent = program.program_type
            ? `${program.name} — ${program.program_type}`
            : program.name;
        programSelect?.appendChild(option);
    });

    (state.lookups.branches || []).forEach(branch => {
        const option = document.createElement('option');
        option.value = branch.branch_id;
        option.textContent = branch.branch_name;
        branchSelect?.appendChild(option);
    });

    if ((state.lookups.branches || []).length <= 1) {
        branchSelect?.closest('.student-filter-field')?.classList.add('d-none');
    }

    (state.lookups.genders || []).forEach(gender => {
        const option = document.createElement('option');
        option.value = gender.gender_id;
        option.textContent = gender.gender;
        genderSelect?.appendChild(option);
    });
}

function renderSummary() {
    const total = state.students.length;
    const active = state.students.filter(student => normalizeStatus(student.student_status) === 'active').length;
    const enrolled = state.students.filter(student => normalizeStatus(student.enrollment_status) === 'enrolled').length;
    const unassigned = state.students.filter(student => !(student.program_ids || []).length).length;

    document.getElementById('student-total-count').textContent = total;
    document.getElementById('student-active-count').textContent = active;
    document.getElementById('student-enrolled-count').textContent = enrolled;
    document.getElementById('student-unassigned-count').textContent = unassigned;
}

function studentSearchText(student) {
    return [
        student.student_id_number,
        student.lrn,
        student.first_name,
        student.middle_name,
        student.last_name,
        student.ext,
        student.nickname,
        student.email,
        student.guardian_name,
        student.guardian_contact,
        student.current_program,
        student.current_branch
    ].join(' ').toLowerCase();
}

function applyFilters(resetPage = true) {
    const search = document.getElementById('student-search-input')?.value.trim().toLowerCase() || '';
    const programId = document.getElementById('student-program-filter')?.value || '';
    const branchId = document.getElementById('student-branch-filter')?.value || '';
    const accountStatus = document.getElementById('student-status-filter')?.value || '';

    state.filteredStudents = state.students.filter(student => {
        const matchesSearch = !search || studentSearchText(student).includes(search);
        const matchesProgram = !programId || (student.current_program_ids || student.program_ids || [])
            .map(String)
            .includes(String(programId));
        const matchesBranch = !branchId || (student.branch_ids || []).map(String).includes(String(branchId));
        const matchesStatus = !accountStatus || normalizeStatus(student.student_status) === accountStatus;
        return matchesSearch && matchesProgram && matchesBranch && matchesStatus;
    });

    if (resetPage) state.page = 1;
    const pageCount = Math.max(1, Math.ceil(state.filteredStudents.length / PAGE_SIZE));
    state.page = Math.min(state.page, pageCount);
    renderTable();
    renderPagination();
}

function renderTable() {
    const tbody = document.getElementById('student-directory-body');
    const resultCount = document.getElementById('student-result-count');
    if (!tbody || !resultCount) return;

    const total = state.filteredStudents.length;
    resultCount.textContent = `${total.toLocaleString()} ${total === 1 ? 'student' : 'students'}`;

    if (!total) {
        tbody.innerHTML = '<tr><td colspan="8" class="student-empty-state"><i class="bi bi-search"></i>No students match the selected filters.</td></tr>';
        document.getElementById('student-page-summary').textContent = 'Showing 0 students';
        return;
    }

    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows = state.filteredStudents.slice(start, start + PAGE_SIZE);
    tbody.innerHTML = pageRows.map(student => {
        const name = fullName(student);
        const studentNumber = cleanText(student.student_id_number, `Record #${student.student_id}`);
        const program = cleanText(student.current_program, 'No program assigned');
        const branch = cleanText(student.current_branch, 'Not assigned');
        return `
            <tr>
                <td><div class="student-id-cell"><strong>${escapeHtml(studentNumber)}</strong>${student.lrn ? `<small class="d-block text-muted mt-1">LRN: ${escapeHtml(student.lrn)}</small>` : ''}</div></td>
                <td><div class="student-identity">${avatarHtml(student)}<div><strong>${escapeHtml(name)}</strong><small>${student.nickname ? `“${escapeHtml(student.nickname)}”` : `Record #${escapeHtml(student.student_id)}`}</small></div></div></td>
                <td><div class="student-contact"><strong>${escapeHtml(cleanText(student.email))}</strong><small>${escapeHtml(cleanText(student.guardian_contact, 'No guardian phone'))}</small></div></td>
                <td><div class="student-program-cell"><strong>${escapeHtml(program)}</strong><small>${escapeHtml(cleanText(student.school_year, 'No school year'))}</small></div></td>
                <td>${escapeHtml(branch)}</td>
                <td>${statusBadge(student.enrollment_status)}</td>
                <td>${statusBadge(student.student_status)}</td>
                <td><button type="button" class="student-view-button" data-view-student="${escapeHtml(student.student_id)}"><i class="bi ${state.meta.can_edit ? 'bi-pencil-square' : 'bi-eye'}"></i>${state.meta.can_edit ? 'View / Edit' : 'View'}</button></td>
            </tr>`;
    }).join('');

    const columnLabels = ['Student ID', 'Student', 'Contact', 'Current program', 'Branch', 'Enrollment', 'Account', 'Action'];
    tbody.querySelectorAll('tr').forEach(row => {
        row.querySelectorAll('td').forEach((cell, index) => {
            cell.dataset.label = columnLabels[index] || '';
        });
    });

    const end = Math.min(start + PAGE_SIZE, total);
    document.getElementById('student-page-summary').textContent = `Showing ${start + 1}–${end} of ${total} students`;
}

function pageButton(label, page, options = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `student-page-button${options.active ? ' active' : ''}`;
    button.innerHTML = label;
    button.disabled = Boolean(options.disabled);
    button.setAttribute('aria-label', options.ariaLabel || `Page ${page}`);
    if (options.active) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => {
        state.page = page;
        renderTable();
        renderPagination();
        document.querySelector('.student-table-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return button;
}

function renderPagination() {
    const pagination = document.getElementById('student-pagination');
    if (!pagination) return;
    pagination.innerHTML = '';

    const pageCount = Math.max(1, Math.ceil(state.filteredStudents.length / PAGE_SIZE));
    pagination.appendChild(pageButton('<i class="bi bi-chevron-left"></i>', Math.max(1, state.page - 1), {
        disabled: state.page === 1,
        ariaLabel: 'Previous page'
    }));

    const pages = new Set([1, pageCount, state.page - 1, state.page, state.page + 1]);
    [...pages]
        .filter(page => page >= 1 && page <= pageCount)
        .sort((a, b) => a - b)
        .forEach((page, index, array) => {
            if (index > 0 && page - array[index - 1] > 1) {
                const separator = document.createElement('span');
                separator.textContent = '…';
                separator.className = 'px-1 text-muted';
                pagination.appendChild(separator);
            }
            pagination.appendChild(pageButton(String(page), page, { active: page === state.page }));
        });

    pagination.appendChild(pageButton('<i class="bi bi-chevron-right"></i>', Math.min(pageCount, state.page + 1), {
        disabled: state.page === pageCount,
        ariaLabel: 'Next page'
    }));
}

function setFormValue(name, value) {
    const field = document.querySelector(`#student-editor-form [name="${name}"]`);
    if (field) field.value = value ?? '';
}

function renderEditorSummary(student) {
    const container = document.getElementById('student-editor-summary');
    if (!container) return;
    container.innerHTML = `
        ${avatarHtml(student)}
        <div>
            <h3>${escapeHtml(fullName(student))}</h3>
            <p>${escapeHtml(cleanText(student.student_id_number, `Record #${student.student_id}`))}</p>
        </div>`;
}

function isPrePlayEnrollment(enrollment) {
    const value = `${enrollment.program_name || ''} ${enrollment.program_type_name || ''}`.toLowerCase();
    return value.includes('pre school')
        || value.includes('preschool')
        || value.includes('pre-school')
        || value.includes('play school')
        || value.includes('playschool')
        || value.includes('play-school');
}

function renderEnrollmentHistory(enrollments) {
    const container = document.getElementById('student-enrollment-history');
    if (!container) return;
    container.classList.remove('is-scrollable');
    container.style.removeProperty('--student-enrollment-history-height');
    if (!enrollments.length) {
        container.innerHTML = '<p class="text-muted small mb-0">No enrollment records found.</p>';
        return;
    }

    container.innerHTML = enrollments.map(enrollment => {
        const page = isPrePlayEnrollment(enrollment) ? 'enrollement_pre_play.html' : 'enrollement.html';
        const meta = [
            ['bi-shop', cleanText(enrollment.branch_name, 'No branch')],
            ['bi-calendar3', cleanText(enrollment.school_year, formatDate(enrollment.enrollment_date))],
            ['bi-book', cleanText(enrollment.subject_names, 'No subjects listed')],
            ['bi-person-badge', cleanText(enrollment.teacher_name, 'No teacher assigned')]
        ];
        return `
            <article class="student-enrollment-item">
                <header><strong>${escapeHtml(cleanText(enrollment.program_name, 'Unnamed program'))}</strong>${statusBadge(enrollment.enrollment_status)}</header>
                <div class="student-enrollment-meta">${meta.map(([icon, text]) => `<span><i class="bi ${icon}"></i>${escapeHtml(text)}</span>`).join('')}</div>
                <a class="student-enrollment-link" href="${page}"><i class="bi bi-box-arrow-up-right"></i>Open enrollment page</a>
            </article>`;
    }).join('');

    if (enrollments.length > 5) {
        const applyFiveCardScrollLimit = () => {
            const firstFiveCards = [...container.querySelectorAll('.student-enrollment-item')].slice(0, 5);
            if (firstFiveCards.length < 5 || firstFiveCards.some(card => card.offsetHeight === 0)) {
                return false;
            }
            const cardsHeight = firstFiveCards.reduce((total, card) => total + card.offsetHeight, 0);
            const gap = Number.parseFloat(window.getComputedStyle(container).rowGap) || 10;
            container.style.setProperty('--student-enrollment-history-height', `${cardsHeight + (gap * 4)}px`);
            container.classList.add('is-scrollable');
            return true;
        };

        window.requestAnimationFrame(() => {
            if (!applyFiveCardScrollLimit()) {
                window.setTimeout(applyFiveCardScrollLimit, 350);
            }
        });
    }
}

const FIELD_LABELS = {
    student_id_number: 'student ID',
    lrn: 'LRN',
    first_name: 'first name',
    middle_name: 'middle name',
    last_name: 'last name',
    ext: 'suffix',
    nickname: 'nickname',
    email: 'email',
    birthday: 'birthday',
    gender_id: 'gender',
    adr_street: 'street',
    adr_barangay: 'barangay',
    adr_city: 'city',
    adr_province: 'province',
    adr_note: 'address notes',
    health_note: 'health notes',
    status: 'account status',
    guardian_name: 'guardian name',
    guardian_contact: 'guardian contact',
    guardian_relationship: 'guardian relationship'
};

function renderAuditHistory(auditRows) {
    const section = document.getElementById('student-audit-section');
    const container = document.getElementById('student-audit-history');
    if (!section || !container) return;

    if (!auditRows.length) {
        section.classList.add('d-none');
        container.innerHTML = '';
        return;
    }

    section.classList.remove('d-none');
    container.innerHTML = auditRows.map(row => {
        let fields = [];
        try {
            fields = Object.keys(JSON.parse(row.changed_fields_json || '{}'));
        } catch (error) {}
        const labels = fields.map(field => FIELD_LABELS[field] || field.replaceAll('_', ' '));
        return `
            <article class="student-audit-item">
                <strong>Updated ${escapeHtml(labels.join(', ') || 'student information')}</strong>
                <span>${escapeHtml(cleanText(row.changed_by, 'System user'))} · ${escapeHtml(formatDate(row.created_at, true))}</span>
            </article>`;
    }).join('');
}

function setEditorReadOnly(readOnly) {
    document.querySelectorAll('#student-editor-form input, #student-editor-form select, #student-editor-form textarea')
        .forEach(field => {
            if (field.type !== 'hidden') field.disabled = readOnly;
        });
    document.getElementById('student-save-button')?.classList.toggle('d-none', readOnly);
}

function populateStudentEditor(details) {
    const student = details.student;
    const fields = [
        'student_id', 'student_id_number', 'lrn', 'first_name', 'middle_name',
        'last_name', 'ext', 'nickname', 'birthday', 'gender_id', 'email',
        'student_status', 'adr_street', 'adr_barangay', 'adr_city',
        'adr_province', 'adr_note', 'guardian_name', 'guardian_contact',
        'guardian_relationship', 'health_note'
    ];
    fields.forEach(field => setFormValue(field, student[field]));
    renderEditorSummary(student);
    renderEnrollmentHistory(details.enrollments || []);
    renderAuditHistory(details.audit || []);
    setEditorReadOnly(!state.meta.can_edit);
}

async function openStudent(studentId) {
    state.activeStudentId = Number(studentId);
    Swal.fire({
        title: 'Loading student profile...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const payload = await requestJson(apiUrl('details', { student_id: studentId }));
        Swal.close();
        populateStudentEditor(payload.data);
        state.modal.show();
    } catch (error) {
        Swal.fire('Unable to open student', error.message, 'error');
    }
}

async function saveStudent(event) {
    event.preventDefault();
    if (!state.meta.can_edit) return;

    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const data = Object.fromEntries(new FormData(form).entries());
    const button = document.getElementById('student-save-button');
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving...';

    try {
        const payload = await requestJson(apiUrl('update'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operation: 'update', json: data })
        });
        state.modal.hide();
        await loadStudents();
        Swal.fire('Student updated', payload.message, 'success');
    } catch (error) {
        Swal.fire('Unable to save changes', error.message, 'error');
    } finally {
        button.disabled = false;
        button.innerHTML = '<i class="bi bi-check2 me-1"></i>Save changes';
    }
}

function csvCell(value) {
    let text = String(value ?? '').replaceAll('\r', ' ').replaceAll('\n', ' ').trim();
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
}

const STUDENT_EXPORT_COLUMNS = [
    ['Student ID', row => row.student_id_number],
    ['LRN', row => row.lrn],
    ['First Name', row => row.first_name],
    ['Middle Name', row => row.middle_name],
    ['Last Name', row => row.last_name],
    ['Suffix', row => row.ext],
    ['Nickname', row => row.nickname],
    ['Birthday', row => row.birthday],
    ['Gender', row => row.gender],
    ['Email', row => row.email],
    ['Account Status', row => row.student_status],
    ['Guardian', row => row.guardian_name],
    ['Guardian Contact', row => row.guardian_contact],
    ['Guardian Relationship', row => row.guardian_relationship],
    ['Street', row => row.adr_street],
    ['Barangay', row => row.adr_barangay],
    ['City / Municipality', row => row.adr_city],
    ['Province', row => row.adr_province],
    ['Address Notes', row => row.adr_note],
    ['Health Notes', row => row.health_note],
    ['Current Program(s)', row => row.current_program],
    ['Current Branch(es)', row => row.current_branch],
    ['Enrollment Status', row => row.enrollment_status],
    ['School Year', row => row.school_year],
    ['Enrollment Records', row => row.enrollment_count],
    ['Student Created', row => row.date_created]
];

function exportFileName(extension) {
    const date = new Date().toISOString().slice(0, 10);
    return `student-directory-${date}.${extension}`;
}

function exportStudentsToCsv() {
    const rows = [
        STUDENT_EXPORT_COLUMNS.map(([label]) => csvCell(label)).join(','),
        ...state.filteredStudents.map(student => STUDENT_EXPORT_COLUMNS.map(([, getter]) => csvCell(getter(student))).join(','))
    ];
    const blob = new Blob([`\uFEFF${rows.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = exportFileName('csv');
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
}

function exportStudentsToExcel() {
    if (!window.XLSX) {
        throw new Error('The Excel export library is unavailable. Please refresh the page and try again.');
    }

    const rows = [
        STUDENT_EXPORT_COLUMNS.map(([label]) => label),
        ...state.filteredStudents.map(student => STUDENT_EXPORT_COLUMNS.map(([, getter]) => getter(student) ?? ''))
    ];
    const worksheet = window.XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = STUDENT_EXPORT_COLUMNS.map(([label]) => ({
        wch: Math.min(34, Math.max(12, label.length + 2))
    }));
    worksheet['!autofilter'] = { ref: worksheet['!ref'] };

    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Students');
    window.XLSX.writeFile(workbook, exportFileName('xlsx'));
}

function exportStudentsToPdf() {
    const JsPdf = window.jspdf?.jsPDF;
    if (!JsPdf) {
        throw new Error('The PDF export library is unavailable. Please refresh the page and try again.');
    }

    const documentPdf = new JsPdf({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    if (typeof documentPdf.autoTable !== 'function') {
        throw new Error('The PDF table library is unavailable. Please refresh the page and try again.');
    }

    const generatedAt = new Intl.DateTimeFormat('en-PH', {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    }).format(new Date());
    documentPdf.setFontSize(16);
    documentPdf.setTextColor(31, 41, 55);
    documentPdf.text('Student Directory', 14, 15);
    documentPdf.setFontSize(8);
    documentPdf.setTextColor(100, 116, 139);
    documentPdf.text(`${state.filteredStudents.length} student record(s) - Exported ${generatedAt}`, 14, 21);

    const pdfColumns = [
        ['Student ID', row => row.student_id_number || `#${row.student_id}`],
        ['LRN', row => row.lrn],
        ['Student', row => fullName(row)],
        ['Email', row => row.email],
        ['Guardian / Contact', row => [row.guardian_name, row.guardian_contact].filter(Boolean).join(' / ')],
        ['Program', row => row.current_program],
        ['Branch', row => row.current_branch],
        ['Enrollment', row => row.enrollment_status],
        ['Account', row => row.student_status]
    ];

    documentPdf.autoTable({
        startY: 26,
        head: [pdfColumns.map(([label]) => label)],
        body: state.filteredStudents.map(student => pdfColumns.map(([, getter]) => cleanText(getter(student), ''))),
        theme: 'grid',
        styles: {
            fontSize: 6.5,
            cellPadding: 1.7,
            lineColor: [226, 232, 240],
            lineWidth: .15,
            overflow: 'linebreak',
            valign: 'middle'
        },
        headStyles: {
            fillColor: [233, 90, 120],
            textColor: [255, 255, 255],
            fontStyle: 'bold'
        },
        alternateRowStyles: { fillColor: [255, 249, 251] },
        margin: { top: 26, right: 10, bottom: 12, left: 10 },
        didDrawPage: data => {
            const pageNumber = documentPdf.internal.getNumberOfPages();
            documentPdf.setFontSize(7);
            documentPdf.setTextColor(100, 116, 139);
            documentPdf.text(`Page ${pageNumber}`, data.settings.margin.left, documentPdf.internal.pageSize.height - 6);
        }
    });

    documentPdf.save(exportFileName('pdf'));
}

async function openStudentExportPicker() {
    if (!state.meta.can_export) {
        Swal.fire('Access restricted', 'You do not have permission to export student records.', 'warning');
        return;
    }
    if (!state.filteredStudents.length) {
        Swal.fire('Nothing to export', 'No students match the selected filters.', 'info');
        return;
    }

    const result = await Swal.fire({
        title: 'Export student data',
        html: `
            <p class="student-export-description">Choose a format for the ${state.filteredStudents.length} student record(s) currently shown by your filters.</p>
            <div class="student-export-options" role="radiogroup" aria-label="Export format">
                <label class="student-export-option">
                    <input type="radio" name="student-export-format" value="pdf" checked>
                    <span class="student-export-option-content"><i class="bi bi-file-earmark-pdf"></i><strong>PDF</strong><small>Printable directory summary</small></span>
                </label>
                <label class="student-export-option">
                    <input type="radio" name="student-export-format" value="excel">
                    <span class="student-export-option-content"><i class="bi bi-file-earmark-spreadsheet"></i><strong>Excel / Sheets</strong><small>.xlsx with all student fields</small></span>
                </label>
                <label class="student-export-option">
                    <input type="radio" name="student-export-format" value="csv">
                    <span class="student-export-option-content"><i class="bi bi-filetype-csv"></i><strong>CSV</strong><small>Universal spreadsheet format</small></span>
                </label>
            </div>`,
        showCancelButton: true,
        confirmButtonText: '<i class="bi bi-download me-1"></i> Export',
        cancelButtonText: 'Cancel',
        focusConfirm: false,
        customClass: {
            popup: 'student-export-popup',
            confirmButton: 'student-export-confirm',
            cancelButton: 'student-export-cancel'
        },
        buttonsStyling: false,
        preConfirm: () => document.querySelector('input[name="student-export-format"]:checked')?.value || 'pdf'
    });

    if (!result.isConfirmed) return;

    try {
        if (result.value === 'pdf') exportStudentsToPdf();
        else if (result.value === 'excel') exportStudentsToExcel();
        else exportStudentsToCsv();
    } catch (error) {
        Swal.fire('Export failed', error.message, 'error');
    }
}

function bindEvents() {
    document.getElementById('student-search-input')?.addEventListener('input', () => {
        window.clearTimeout(state.searchTimer);
        state.searchTimer = window.setTimeout(() => applyFilters(), 180);
    });
    ['student-program-filter', 'student-branch-filter', 'student-status-filter'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => applyFilters());
    });
    document.getElementById('student-clear-filters')?.addEventListener('click', () => {
        document.getElementById('student-search-input').value = '';
        document.getElementById('student-program-filter').value = '';
        document.getElementById('student-branch-filter').value = '';
        document.getElementById('student-status-filter').value = '';
        applyFilters();
    });
    document.getElementById('student-directory-body')?.addEventListener('click', event => {
        const button = event.target.closest('[data-view-student]');
        if (button) openStudent(button.dataset.viewStudent);
    });
    document.getElementById('student-export-button')?.addEventListener('click', openStudentExportPicker);
    document.getElementById('student-editor-form')?.addEventListener('submit', saveStudent);
}

async function loadStudents() {
    const payload = await requestJson(apiUrl('list'));
    state.students = Array.isArray(payload.data) ? payload.data : [];
    state.meta = { ...state.meta, ...(payload.meta || {}) };
    state.meta.can_edit = Boolean(state.meta.can_edit && canUseStudentManagementPermission('edit'));
    state.meta.can_export = Boolean(state.meta.can_export && canUseStudentManagementPermission('export'));
    document.getElementById('student-export-button')?.classList.toggle('d-none', !state.meta.can_export);
    renderSummary();
    applyFilters(false);
}

export async function initStudentManagementPage() {
    if (!document.querySelector('[data-student-management-page]')) return;

    try {
        await hydrateSharedTemplate();
        await initStudentManagementPermissions();
        if (!canUseStudentManagementPermission('view')) {
            renderAccessDenied('You do not currently have permission to view student records.');
            return;
        }

        const modalElement = document.getElementById('studentProfileModal');
        state.modal = bootstrap.Modal.getOrCreateInstance(modalElement);
        bindEvents();

        const [listPayload, lookupPayload] = await Promise.all([
            requestJson(apiUrl('list')),
            requestJson(apiUrl('lookups'))
        ]);
        state.students = Array.isArray(listPayload.data) ? listPayload.data : [];
        state.lookups = lookupPayload.data || state.lookups;
        state.meta = { ...state.meta, ...(listPayload.meta || {}) };
        state.meta.can_edit = Boolean(state.meta.can_edit && canUseStudentManagementPermission('edit'));
        state.meta.can_export = Boolean(state.meta.can_export && canUseStudentManagementPermission('export'));

        populateLookups();
        renderSummary();
        applyFilters();
        document.getElementById('student-export-button')?.classList.toggle('d-none', !state.meta.can_export);
    } catch (error) {
        renderAccessDenied(error.message);
    }
}
