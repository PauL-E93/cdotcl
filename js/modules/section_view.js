import { openAddSectionModal, openEditSectionModal } from './section.js';
import { openSectionReportCards, openStudentEccdChecklist } from './preschool_report_card.js?v=20260814-school-year-curriculum';
import { navigateToSectionAttendancePage } from './section_attendance.js';
import { canUseClassPermission, guardClassPermission } from './class_rbac.js';
import { getApiErrorMessage, normalizeApiResponse } from '../utilities/api_response.js?v=20260812-hosted-json5';

// js/modules/section_view.js

let classes = [];
let employees = [];
let selectedSchedules = [];
let currentSectionStudentCount = null;

function getOwnerSectionStudentCountText() {
    return currentSectionStudentCount !== null
        ? `${currentSectionStudentCount} ${currentSectionStudentCount === 1 ? 'student' : 'students'}`
        : 'Loading...';
}

function updateOwnerSectionStudentCountElements() {
    const headerCount = document.getElementById('section-student-count');
    if (headerCount) {
        headerCount.textContent = currentSectionStudentCount !== null
            ? `${currentSectionStudentCount} ${currentSectionStudentCount === 1 ? 'student' : 'students'} enrolled`
            : 'Loading students...';
    }
    const overviewCount = document.getElementById('overview-student-count');
    if (overviewCount) {
        overviewCount.textContent = getOwnerSectionStudentCountText();
    }
}

const classFilters = {
    search: '',
    status: '',
    program: '',
    date: ''
};
const isTeacherClassPage = window.location.pathname.includes('/teacher/class.html');
const isBranchAdminClassPage = window.location.pathname.includes('/branch_admin/class.html');
const isOwnerClassPage = window.location.pathname.includes('/owner/class.html');
const isClassDirectory = [
    '/owner/class.html',
    '/auditor/class.html',
    '/secretary/class.html',
    '/teacher/class.html',
    '/branch_admin/class.html'
].some(path => window.location.pathname.includes(path)) && !!document.getElementById('class-selector');
const apiFolder = isTeacherClassPage ? 'teacher' : 'admin';
const classApiUrl = `../../api/${apiFolder}/class.php`;
const sectionApiUrl = `../../api/${apiFolder}/section.php`;

export function initSectionView() {
    setupSingleActionDropdown();
    loadClassesForView();
}

export function refreshSectionsForClass(classId) {
    if (isClassDirectory) {
        const selectedClassId = document.getElementById('class-selector')?.value || '';
        if (String(selectedClassId) === String(classId)) {
            const selectedSectionId = document.getElementById('section-selector')?.value || '';
            loadOwnerSections(classId, selectedSectionId);
        }
        return;
    }
    loadSectionsForNestedTable(classId);
}

export function refreshClasses() {
    loadClassesForView();
}

function setupSingleActionDropdown() {
    const tableBody = document.getElementById('classTableBody');
    if (!tableBody || tableBody.dataset.singleActionDropdown === 'true') return;

    tableBody.dataset.singleActionDropdown = 'true';
    tableBody.addEventListener('show.bs.dropdown', event => {
        const currentDropdown = event.target.closest('.dropdown');

        tableBody.querySelectorAll('.dropdown-menu.show').forEach(menu => {
            const dropdown = menu.closest('.dropdown');
            if (!dropdown || dropdown === currentDropdown) return;

            const toggle = dropdown.querySelector('[data-bs-toggle="dropdown"]');
            if (toggle && window.bootstrap?.Dropdown) {
                window.bootstrap.Dropdown.getOrCreateInstance(toggle).hide();
                return;
            }

            dropdown.classList.remove('show');
            menu.classList.remove('show');
            toggle?.setAttribute('aria-expanded', 'false');
        });
    });
}

function loadClassesForView() {
    axios.get(`${classApiUrl}?operation=getAllClasses`)
        .then(res => {
            let data = res.data;
            if (typeof data === 'string' && data.startsWith('e')) {
                data = JSON.parse(data.substring(1));
            }
            if (!Array.isArray(data)) {
                throw new Error(data?.message || 'Unable to load classes');
            }

            // Sort classes by branch name
            data.sort((a, b) => String(a.branch_name || '').localeCompare(String(b.branch_name || '')));

            if (isClassDirectory) {
                classes = data;
                setupOwnerClassDirectory();
                return;
            }

            updateClassSummary(data);

            const tbody = document.getElementById('classTableBody');
            const thead = document.getElementById('tableHead');
            const classColumnCount = isTeacherClassPage ? 4 : 5;
            
            thead.innerHTML = `
                <tr>
                    <th style="width: 50px; background-color:#ea9aa6;"></th>
                    <th style="background-color:#ea9aa6;">Program</th>
                    <th style="background-color:#ea9aa6;">Branch</th>
                    <th style="background-color:#ea9aa6;">Status</th>
                    ${isTeacherClassPage ? '' : '<th style="background-color:#ea9aa6; width: 100px;" class="text-center">Action</th>'}
                </tr>
            `;

            if (!data || data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="${classColumnCount}" class="text-center text-muted">No assigned classes found</td></tr>`;
                return;
            }

            classes = data;
            bindClassFilterControls();
            renderClassTable(classes);
        })
        .catch(err => {
            console.error('Error loading classes:', err);
            if (isClassDirectory) {
                renderOwnerEmptyState('Unable to load classes', 'Please refresh the page and try again.');
                return;
            }
            const tbody = document.getElementById('classTableBody');
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="${isTeacherClassPage ? 4 : 5}" class="text-center text-danger">Error loading class data</td></tr>`;
            }
        });
}

function updateClassSummary(data) {
    if (!isTeacherClassPage && !isBranchAdminClassPage) return;

    const sectionCount = data.reduce((total, item) => total + Number(item.section_count || 0), 0);
    const studentCount = data.reduce((total, item) => total + Number(item.student_count || 0), 0);
    const branchCount = new Set(data.map(item => item.branch_id)).size;

    document.getElementById('total-classes-count').textContent = data.length;
    document.getElementById('total-sections-count').textContent = sectionCount;
    document.getElementById('total-centers-count').textContent = studentCount;
    document.getElementById('total-categories-count').textContent = branchCount;
}

function bindClassFilterControls() {
    const searchInput = document.getElementById('search-input');
    const statusSelect = document.getElementById('class-status-filter');
    const programSelect = document.getElementById('class-program-filter');
    const dateInput = document.getElementById('class-date-filter');
    const filterToggle = document.querySelector('.filter-toggle-btn');
    const filterContainer = document.querySelector('.filter-container');

    if (statusSelect) {
        populateStatusFilter(statusSelect);
        statusSelect.addEventListener('change', () => {
            classFilters.status = statusSelect.value;
            renderClassTable(applyClassFilters(classes));
        });
    }

    if (programSelect) {
        populateProgramFilter(programSelect);
        programSelect.addEventListener('change', () => {
            classFilters.program = programSelect.value;
            renderClassTable(applyClassFilters(classes));
        });
    }

    if (dateInput) {
        dateInput.addEventListener('change', () => {
            classFilters.date = dateInput.value;
            renderClassTable(applyClassFilters(classes));
        });
    }

    if (searchInput) {
        let searchTimer = null;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                classFilters.search = searchInput.value.trim().toLowerCase();
                renderClassTable(applyClassFilters(classes));
            }, 200);
        });
    }

    filterToggle?.addEventListener('click', () => {
        filterContainer?.classList.toggle('filter-open');
    });
}

function populateStatusFilter(statusSelect) {
    if (!statusSelect || !classes || classes.length === 0) return;

    const statuses = Array.from(new Set(classes.map(item => item.status).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const options = ['<option value="">All Status</option>', ...statuses.map(status => `
        <option value="${escapeHtml(status)}">${escapeHtml(status)}</option>
    `)];
    statusSelect.innerHTML = options.join('');
}

function populateProgramFilter(programSelect) {
    if (!programSelect || !classes || classes.length === 0) return;

    const programs = Array.from(new Set(classes.map(item => item.program_name).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const options = ['<option value="">All Subject</option>', ...programs.map(program => `
        <option value="${escapeHtml(program)}">${escapeHtml(program)}</option>
    `)];
    programSelect.innerHTML = options.join('');
}

function applyClassFilters(data) {
    const search = classFilters.search || '';
    const status = classFilters.status || '';
    const program = classFilters.program || '';
    const date = classFilters.date || '';

    return data.filter(item => {
        const matchesStatus = !status || item.status?.toLowerCase() === status.toLowerCase();
        const matchesProgram = !program || item.program_name?.toLowerCase() === program.toLowerCase();
        const searchableText = [item.program_name, item.branch_name, item.status].join(' ').toLowerCase();
        const matchesSearch = !search || searchableText.includes(search);
        const matchesDate = !date || (item.created_at ? item.created_at.startsWith(date) : true);

        return matchesStatus && matchesProgram && matchesSearch && matchesDate;
    });
}

function renderClassTable(data) {
    const tbody = document.getElementById('classTableBody');
    const classColumnCount = isTeacherClassPage ? 4 : 5;

    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${classColumnCount}" class="text-center text-muted">No assigned classes found</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(c => `
        ${(() => {
            const classActions = [];
            if (canUseClassPermission('manage_sections')) {
                classActions.push(`<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); window.addSection(${c.class_id})">Add Section</a></li>`);
            }
            if (canUseClassPermission('edit')) {
                classActions.push(`<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); window.editClass(${c.class_id})">Edit</a></li>`);
            }
            if (canUseClassPermission('delete')) {
                classActions.push(`<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); window.archiveClass(${c.class_id})">Archive</a></li>`);
            }
            const classActionCell = classActions.length > 0
                ? `<div class="dropdown" onclick="event.stopPropagation();">
                    <button class="btn btn-sm btn-outline-secondary border-0" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                        <i class="bi bi-three-dots-vertical"></i>
                    </button>
                    <ul class="dropdown-menu dropdown-menu-end">
                        ${classActions.join('')}
                    </ul>
                </div>`
                : '<span class="text-muted">-</span>';

            return `
        <tr class="clickable-row" data-class-id="${c.class_id}" style="cursor: pointer;">
            <td class="text-center">
                <i class="bi bi-plus-square toggle-icon-${c.class_id}"></i>
            </td>
            <td>${c.program_name}</td>
            <td>${c.branch_name}</td>
            <td><span class="badge bg-info">${c.status}</span></td>
            ${isTeacherClassPage ? '' : `<td class="text-center">${classActionCell}</td>`}
        </tr>
        <tr id="sections-container-${c.class_id}" class="d-none">
            <td colspan="${classColumnCount}" class="bg-light p-3">
                <div class="card card-body shadow-sm">
                    <h6 class="fw-bold">${isTeacherClassPage ? 'My Sections for this Class' : 'Sections for this Class'}</h6>
                    <table class="table table-sm table-bordered mb-0">
                        <thead class="table-secondary">
                            <tr>
                                <th style="background-color:#ea9aa6;">Section Name</th>
                                <th style="background-color:#ea9aa6;">Instructor</th>
                                <th style="background-color:#ea9aa6;">Max Capacity</th>
                                <th style="background-color:#ea9aa6;">Enrolled</th>
                                <th style="background-color:#ea9aa6;">Status</th>
                                <th style="background-color:#ea9aa6;">Schedule (Day/Time)</th>
                                <th style="background-color:#ea9aa6; width: 80px;" class="text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody id="section-list-${c.class_id}">
                            <tr><td colspan="7" class="text-center">Loading...</td></tr>
                        </tbody>
                    </table>
                </div>
            </td>
        </tr>
    `;
        })()}
    `).join('');

    document.querySelectorAll('.clickable-row').forEach(row => {
        row.addEventListener('click', function() {
            const classId = this.getAttribute('data-class-id');
            toggleSectionTable(classId);
        });
    });
}

function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/[&<>"]+/g, (match) => {
        switch (match) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            default: return match;
        }
    });
}

// Only display the issued student ID number. The internal database ID must not be shown as an ID number.
function getDisplayStudentId(student) {
    const studentIdNumber = String(student?.student_id_number || '').trim();
    return studentIdNumber || 'N/A';
}

function formatProfileBirthday(birthday) {
    const rawBirthday = String(birthday || '').trim();
    if (!rawBirthday) return 'N/A';

    const dateParts = rawBirthday.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dateParts) {
        return `${dateParts[2]}/${dateParts[3]}/${dateParts[1].slice(-2)}`;
    }

    const parsedBirthday = new Date(rawBirthday);
    if (Number.isNaN(parsedBirthday.getTime())) return 'N/A';

    const month = String(parsedBirthday.getMonth() + 1).padStart(2, '0');
    const day = String(parsedBirthday.getDate()).padStart(2, '0');
    const year = String(parsedBirthday.getFullYear()).slice(-2);
    return `${month}/${day}/${year}`;
}

function setupOwnerClassDirectory() {
    const classSelect = document.getElementById('class-selector');
    const sectionSelect = document.getElementById('section-selector');
    const addSectionButton = document.getElementById('btn-add-section');
    if (!classSelect || !sectionSelect) return;

    classSelect.innerHTML = [
        '<option value="">Select class...</option>',
        ...classes.map(item => `<option value="${item.class_id}">${escapeHtml(item.program_name || 'Unnamed class')}${item.branch_name ? ` — ${escapeHtml(item.branch_name)}` : ''}</option>`)
    ].join('');

    const pageParams = new URLSearchParams(window.location.search);
    const restoredClassId = pageParams.get('class_id') || '';
    const restoredSectionId = pageParams.get('section_id') || '';

    classSelect.addEventListener('change', () => {
        const classId = classSelect.value;
        if (addSectionButton) addSectionButton.disabled = !classId;
        updateOwnerClassDirectoryUrl(classId);
        sectionSelect.disabled = !classId;
        sectionSelect.innerHTML = classId
            ? '<option value="">Loading sections...</option>'
            : '<option value="">Select a class first...</option>';
        renderOwnerEmptyState(classId ? 'Select a section' : 'Select a class and section', classId ? 'Choose one of the available sections to view its students and details.' : 'Choose a class first, then select one of its sections to view its students and details.');
        if (classId) loadOwnerSections(classId);
    });

    sectionSelect.addEventListener('change', () => {
        const sectionId = sectionSelect.value;
        updateOwnerClassDirectoryUrl(classSelect.value, sectionId);
        const section = sectionSelect._sections?.find(item => String(item.section_id) === String(sectionId));
        if (section) renderOwnerSection(section);
        else renderOwnerEmptyState('Select a section', 'Choose one of the available sections to view its students and details.');
    });

    if (restoredClassId && classes.some(item => String(item.class_id) === String(restoredClassId))) {
        classSelect.value = restoredClassId;
        if (addSectionButton) addSectionButton.disabled = false;
        sectionSelect.disabled = false;
        sectionSelect.innerHTML = '<option value="">Loading sections...</option>';
        loadOwnerSections(restoredClassId, restoredSectionId);
    } else if (addSectionButton) {
        addSectionButton.disabled = true;
    }
}

function updateOwnerClassDirectoryUrl(classId, sectionId = '') {
    if (!isOwnerClassPage) return;

    const url = new URL(window.location.href);
    if (classId) url.searchParams.set('class_id', String(classId));
    else url.searchParams.delete('class_id');
    if (classId && sectionId) url.searchParams.set('section_id', String(sectionId));
    else url.searchParams.delete('section_id');
    window.history.replaceState(null, '', url);
}

function loadOwnerSections(classId, restoredSectionId = '') {
    const sectionSelect = document.getElementById('section-selector');
    axios.get(`${sectionApiUrl}?operation=getSectionsByClass&class_id=${classId}`)
        .then(res => {
            let sections = res.data;
            if (typeof sections === 'string' && sections.startsWith('e')) sections = JSON.parse(sections.substring(1));
            if (!Array.isArray(sections)) throw new Error('Unable to load sections');
            sectionSelect._sections = sections;
            sectionSelect.innerHTML = sections.length
                ? ['<option value="">Select section...</option>', ...sections.map(sec => `<option value="${sec.section_id}">${escapeHtml(sec.section_name || 'Unnamed section')}</option>`)].join('')
                : '<option value="">No sections available</option>';
            sectionSelect.disabled = !sections.length;
            const restoredSection = sections.find(section => String(section.section_id) === String(restoredSectionId));
            if (restoredSection) {
                sectionSelect.value = String(restoredSection.section_id);
                renderOwnerSection(restoredSection);
            }
            if (!sections.length) renderOwnerEmptyState('No sections found', 'This class does not have any sections yet.');
        })
        .catch(() => {
            sectionSelect.innerHTML = '<option value="">Unable to load sections</option>';
            sectionSelect.disabled = true;
            renderOwnerEmptyState('Unable to load sections', 'Please try selecting the class again.');
        });
}

function renderOwnerEmptyState(title, message) {
    const view = document.getElementById('selected-section-view');
    if (!view) return;
    view.innerHTML = `<div class="class-empty-state"><i class="bi bi-journal-bookmark"></i><h2>${title}</h2><p>${message}</p></div>`;
}

function renderOwnerSection(section) {
    const view = document.getElementById('selected-section-view');
    if (!view) return;
    currentSectionStudentCount = null;
    const selectedClassId = document.getElementById('class-selector')?.value || '';
    const className = classes.find(item => String(item.class_id) === String(selectedClassId))?.program_name || 'Class';
    const canEditSelectedClass = !isTeacherClassPage && Boolean(selectedClassId) && canUseClassPermission('edit');
    const canEditSelectedSection = !isTeacherClassPage && canUseClassPermission('edit_sections');
    const canViewStudents = canUseClassPermission('manage_students');
    const canViewAttendance = canUseClassPermission('manage_attendance');
    const canViewGrades = canUseClassPermission('manage_report_cards');
    const sectionActions = [];
    if (canEditSelectedClass) {
        sectionActions.push(`<li><button class="dropdown-item" type="button" id="edit-selected-class"><i class="bi bi-pencil-square me-2"></i>Edit Class</button></li>`);
    }
    if (canEditSelectedSection) {
        sectionActions.push(`<li><button class="dropdown-item" type="button" id="edit-selected-section"><i class="bi bi-pencil me-2"></i>Edit Section</button></li>`);
    }
    if (canUseClassPermission('export')) {
        sectionActions.push(`<li><button class="dropdown-item" type="button" id="export-selected-section"><i class="bi bi-download me-2"></i>Export</button></li>`);
    }
    const sectionActionMenu = sectionActions.length ? `
        <div class="dropdown section-actions-dropdown">
            <button class="btn section-actions-btn" type="button" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Section actions"><i class="bi bi-three-dots-vertical"></i></button>
            <ul class="dropdown-menu dropdown-menu-end">${sectionActions.join('')}</ul>
        </div>` : '';
    const sectionTabs = [
        '<button type="button" data-section-tab="overview" class="' + (canViewStudents ? '' : 'active') + '">Overview</button>',
        canViewStudents ? '<button type="button" data-section-tab="students" class="active">Students</button>' : '',
        canViewGrades ? '<button type="button" data-section-tab="grades">Grades</button>' : '',
        canViewStudents ? '<button type="button" data-section-tab="profile">Profile</button>' : '',
        canViewAttendance ? '<button type="button" data-section-tab="attendance">Attendance</button>' : ''
    ].filter(Boolean).join('');
    const initialSectionContent = canViewStudents
        ? `<div class="table-responsive${isOwnerClassPage ? '' : ' section-students-table-scroll'}"><table class="table class-students-table"><thead><tr><th>#</th><th>Student ID Number</th><th>Student Name</th><th>Status</th><th>Email</th></tr></thead><tbody id="owner-section-students"><tr><td colspan="5" class="text-center text-muted py-4">Loading students...</td></tr></tbody></table></div>`
        : `<div class="section-tab-panel"><h3>Section overview</h3><div class="section-info-grid"><div><span>Class</span><strong>${escapeHtml(className)}</strong></div><div><span>Section</span><strong>${escapeHtml(section.section_name || 'N/A')}</strong></div><div><span>Instructor</span><strong>${escapeHtml(getInstructorDisplayName(section))}</strong></div><div><span>Schedule</span><strong>${escapeHtml(section.schedule_info || 'No schedule set')}</strong></div></div></div>`;
    view.innerHTML = `
        <div class="section-overview">
            <div class="section-title-wrap">
                <span class="section-title-icon"><i class="bi bi-backpack"></i></span>
                <div>
                    <h2>${escapeHtml(section.section_name || 'Unnamed section')} <span class="section-status">${escapeHtml(section.status || 'Active')}</span></h2>
                    <div class="section-meta">
                        <span>${escapeHtml(className)}</span>
                        <span><i class="bi bi-person"></i> ${escapeHtml(getInstructorDisplayName(section))}</span>
                        <span><i class="bi bi-calendar3"></i> ${escapeHtml(section.schedule_info || 'No schedule set')}</span>
                    </div>
                    ${!isOwnerClassPage && canViewStudents ? '<div class="section-meta section-overview-count"><i class="bi bi-people"></i> <span id="section-student-count">Loading students...</span></div>' : ''}
                </div>
            </div>
            ${sectionActionMenu}
        </div>
        <nav class="section-tabs" aria-label="Section pages">
            <div class="section-tab-buttons">${sectionTabs}</div>
            ${canViewStudents ? `<div class="section-tab-search">
                <i class="bi bi-search"></i>
                <input id="section-student-search" type="search" placeholder="Search by name or student ID..." aria-label="Search students by name or student ID">
            </div>` : ''}
        </nav>
        <div id="section-tab-content">${initialSectionContent}</div>`;
    bindOwnerSectionTabs(section, className);
    document.getElementById('edit-selected-class')?.addEventListener('click', () => window.editClass?.(selectedClassId));
    document.getElementById('export-selected-section')?.addEventListener('click', () => {
        if (!guardClassPermission('export', 'You do not have permission to export section data.')) return;
        exportOwnerSectionTable(section, className).catch(error => {
            console.error('Section export failed:', error);
            Swal.fire('Export failed', error.message || 'Please try again.', 'error');
        });
    });
    document.getElementById('edit-selected-section')?.addEventListener('click', () => window.editSection?.(section.section_id));
    if (canViewStudents) loadOwnerStudents(section.section_id);
}

function getExportTableData() {
    const table = document.querySelector('#section-tab-content table.class-students-table');
    if (!table) return null;

    const headers = Array.from(table.querySelectorAll('thead th'))
        .map(cell => cell.textContent.trim())
        .filter(header => header && !/^action$/i.test(header));
    const rows = Array.from(table.querySelectorAll('tbody tr'))
        .map(row => Array.from(row.querySelectorAll('td'))
            .filter(cell => !cell.matches('.text-end') && !cell.querySelector('button'))
            .map(cell => cell.innerText.replace(/\s+/g, ' ').trim()))
        .filter(row => row.length === headers.length && row.some(Boolean));

    return headers.length && rows.length ? { headers, rows } : null;
}

function downloadExportFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function createExportFilename(section) {
    return `section-${String(section.section_name || section.section_id || 'students').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'students'}`;
}

async function exportOwnerSectionTable(section, className) {
    const data = getExportTableData();
    if (!data) {
        Swal.fire('Nothing to export', 'Select a tab with a populated table first.', 'info');
        return;
    }

    const result = await Swal.fire({
        title: 'Export table',
        text: 'Choose a file format for the displayed table.',
        icon: 'question',
        input: 'select',
        inputOptions: { pdf: 'PDF', csv: 'CSV', xlsx: 'Excel (.xlsx)' },
        inputValue: 'pdf',
        showCancelButton: true,
        confirmButtonText: 'Export'
    });
    if (!result.isConfirmed) return;
    const filename = createExportFilename(section);

    if (result.value === 'pdf') {
        if (!window.jspdf?.jsPDF) throw new Error('PDF export library is unavailable.');
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: data.headers.length > 5 ? 'landscape' : 'portrait' });
        pdf.setFontSize(16);
        pdf.text(`${className} - ${section.section_name || 'Section'}`, 14, 16);
        pdf.setFontSize(10);
        pdf.text(`Teacher: ${getInstructorDisplayName(section) || 'Not assigned'}`, 14, 23);
        pdf.text(`Schedule: ${section.schedule_info || 'No schedule set'}`, 14, 29);
        pdf.text('Exported student table', 14, 35);
        const statusColumn = data.headers.findIndex(header => /^status$/i.test(header));
        pdf.autoTable({
            head: [data.headers],
            body: data.rows,
            startY: 40,
            styles: { fontSize: 8 },
            didParseCell: (cellData) => {
                if (cellData.section !== 'body' || cellData.column.index !== statusColumn) return;
                const status = String(cellData.cell.raw || '').trim().toLowerCase();
                if (status === 'enrolled') {
                    cellData.cell.styles.fillColor = [217, 245, 228];
                    cellData.cell.styles.textColor = [19, 131, 75];
                } else if (status === 'pending') {
                    cellData.cell.styles.fillColor = [255, 243, 205];
                    cellData.cell.styles.textColor = [133, 100, 4];
                }
            }
        });
        pdf.save(`${filename}.pdf`);
    } else if (result.value === 'csv') {
        const csvValue = [data.headers, ...data.rows]
            .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
            .join('\r\n');
        downloadExportFile(new Blob([`\uFEFF${csvValue}`], { type: 'text/csv;charset=utf-8;' }), `${filename}.csv`);
    } else if (result.value === 'xlsx') {
        if (!window.XLSX) throw new Error('Excel export library is unavailable.');
        const worksheet = XLSX.utils.aoa_to_sheet([data.headers, ...data.rows]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Students');
        XLSX.writeFile(workbook, `${filename}.xlsx`);
    }

    Swal.fire({ icon: 'success', title: 'Export ready', text: 'Your download has started.', timer: 1800, showConfirmButton: false });
}

function setSectionStudentSearchVisibility(isVisible) {
    const search = document.querySelector('#selected-section-view .section-tab-search');
    if (!search) return;

    search.hidden = !isVisible;
    search.classList.toggle('d-none', !isVisible);
}

function matchesStudentIdSearch(studentId, query) {
    const normalizedId = String(studentId || '').trim().toLowerCase();
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) return true;

    const compactId = normalizedId.replace(/[^a-z0-9]/g, '');
    const compactQuery = normalizedQuery.replace(/[^a-z0-9]/g, '');
    if (compactQuery && compactId.includes(compactQuery)) return true;

    // Compare each typed number group independently so "2025-001" matches
    // an issued ID displayed as "2025 - 0001" despite separator/zero padding.
    const idNumberGroups = normalizedId.match(/\d+/g) || [];
    const queryNumberGroups = normalizedQuery.match(/\d+/g) || [];
    return queryNumberGroups.length > 1
        && queryNumberGroups.every((group, index) => idNumberGroups[index]?.includes(group));
}

function bindSectionStudentSearch(students, render) {
    const input = document.getElementById('section-student-search');
    if (!input) return;

    input.value = '';
    input.oninput = () => {
        const query = input.value.trim().toLowerCase();
        const filteredStudents = students.filter(student => {
            const studentIdNumber = getDisplayStudentId(student).toLowerCase();
            const searchableText = Object.values(student)
                .filter(value => value !== null && value !== undefined && typeof value !== 'object')
                .join(' ')
                .toLowerCase();

            return !query
                || searchableText.includes(query)
                || matchesStudentIdSearch(studentIdNumber, query);
        });
        render(filteredStudents);
    };
}

function bindOwnerSectionTabs(section, className) {
    document.querySelectorAll('[data-section-tab]').forEach(button => button.addEventListener('click', () => {
        const tab = button.dataset.sectionTab;
        if (tab === 'attendance') {
            setSectionStudentSearchVisibility(false);
            return window.openSectionAttendance?.(section.section_id);
        }
        if (tab === 'grades') {
            if (!guardClassPermission('manage_report_cards', 'You do not have permission to access section grades and report cards.')) return;
            document.querySelectorAll('[data-section-tab]').forEach(item => item.classList.toggle('active', item === button));
            setSectionStudentSearchVisibility(true);
            renderOwnerGrades(section.section_id);
            return;
        }

        if ((tab === 'students' || tab === 'profile') && !guardClassPermission('manage_students', 'You do not have permission to view section students.')) return;

        document.querySelectorAll('[data-section-tab]').forEach(item => item.classList.toggle('active', item === button));
        setSectionStudentSearchVisibility(tab === 'students' || tab === 'profile');
        const content = document.getElementById('section-tab-content');
        if (!content) return;
        if (tab === 'students') {
            renderOwnerSection(section);
            return;
        }
        if (tab === 'overview') {
            const studentCountText = currentSectionStudentCount !== null
                ? `${currentSectionStudentCount} ${currentSectionStudentCount === 1 ? 'student' : 'students'}`
                : 'Loading...';
            content.innerHTML = `<div class="section-tab-panel"><h3>Section overview</h3><div class="section-info-grid"><div><span>Class</span><strong>${escapeHtml(className)}</strong></div><div><span>Section</span><strong>${escapeHtml(section.section_name || '—')}</strong></div><div><span>Instructor</span><strong>${escapeHtml(getInstructorDisplayName(section))}</strong></div><div><span>Schedule</span><strong>${escapeHtml(section.schedule_info || 'No schedule set')}</strong></div><div><span>Total students</span><strong id="overview-student-count">${escapeHtml(studentCountText)}</strong></div></div></div>`;
        } else if (tab === 'profile') {
            renderOwnerStudentProfiles(section.section_id);
        }
    }));
}

function renderOwnerStudentProfiles(sectionId) {
    if (!canUseClassPermission('manage_students')) return;
    const content = document.getElementById('section-tab-content');
    if (!content) return;
    content.innerHTML = '<div class="section-tab-panel text-muted"><i class="bi bi-hourglass-split me-2"></i>Loading student profiles...</div>';
    axios.get(`${sectionApiUrl}?operation=getEnrolledStudents&section_id=${sectionId}`)
        .then(async response => {
            let enrolled = response.data;
            if (typeof enrolled === 'string' && enrolled.startsWith('e')) enrolled = JSON.parse(enrolled.substring(1));
            if (!Array.isArray(enrolled)) throw new Error('Unable to load students');
            const genderResponse = await axios.get('../../api/admin/student.php?operation=getGenders').catch(() => ({ data: [] }));
            const genderNames = new Map((Array.isArray(genderResponse.data) ? genderResponse.data : []).map(item => [String(item.gender_id), item.gender]));
            const profiles = await Promise.all(enrolled.map(async student => {
                if (!student.student_id) return { ...student };
                const profileResponse = await axios.get(`../../api/admin/student.php?operation=getStudentProfile&student_id=${student.student_id}`).catch(() => ({ data: {} }));
                return { ...student, ...(profileResponse.data?.status === 'success' ? profileResponse.data.data : {}) };
            }));
            content.innerHTML = `
                <div class="table-responsive"><table class="table class-students-table profile-students-table"><thead><tr><th>#</th><th>Student ID Number</th><th>Student Name</th><th>Nickname</th><th>Gender</th><th>Birthday</th><th>School Year</th><th>Email</th><th>Guardian Name</th><th>Relationship</th><th>Guardian Contact</th><th>Street</th><th>Barangay</th><th>City / Municipality</th><th>Province</th><th>Address Note</th><th>Health Notes</th></tr></thead><tbody id="owner-profile-students"></tbody></table></div>`;
            const value = (item) => escapeHtml(String(item || '—'));
            const render = (items) => {
                const tbody = document.getElementById('owner-profile-students');
                if (!tbody) return;
                tbody.innerHTML = items.length ? items.map((student, index) => {
                    const name = [student.first_name, student.middle_name, student.last_name, student.ext].filter(Boolean).join(' ');
                    return `<tr><td data-label="#">${index + 1}</td><td data-label="Student ID Number">${value(getDisplayStudentId(student))}</td><td data-label="Student Name"><strong>${value(name)}</strong></td><td data-label="Nickname">${value(student.nickname)}</td><td data-label="Gender">${value(genderNames.get(String(student.gender_id)) || 'N/A')}</td><td data-label="Birthday">${value(formatProfileBirthday(student.birthday))}</td><td data-label="School Year">${value(student.school_year)}</td><td data-label="Email">${value(student.email)}</td><td data-label="Guardian Name">${value(student.guardian_name)}</td><td data-label="Relationship">${value(student.guardian_relationship)}</td><td data-label="Guardian Contact">${value(student.guardian_contact)}</td><td data-label="Street">${value(student.adr_street)}</td><td data-label="Barangay">${value(student.adr_barangay)}</td><td data-label="City / Municipality">${value(student.adr_city)}</td><td data-label="Province">${value(student.adr_province)}</td><td data-label="Address Note">${value(student.adr_note)}</td><td data-label="Health Notes">${value(student.health_note)}</td></tr>`;
                }).join('') : '<tr><td colspan="17" class="text-center text-muted py-4">No students enrolled in this section.</td></tr>';
            };
            render(profiles);
            bindSectionStudentSearch(profiles, render);
        })
        .catch(error => {
            console.error('Error loading student profiles:', error);
            content.innerHTML = '<div class="section-tab-panel text-danger">Unable to load student profiles.</div>';
        });
}

function renderOwnerGrades(sectionId) {
    if (!canUseClassPermission('manage_report_cards')) return;
    const content = document.getElementById('section-tab-content');
    if (!content) return;
    content.innerHTML = '<div class="section-tab-panel text-muted"><i class="bi bi-hourglass-split me-2"></i>Loading ECCD checklist records...</div>';
    // The tab only needs the enrolled-student list. Avoid loading every saved
    // grade and every ECCD transmutation table until a specific student is
    // opened; that large request is unreliable on shared hosting.
    axios.get(`${sectionApiUrl}?operation=getEnrolledStudents&section_id=${sectionId}`, {
        params: { _request_time: Date.now() },
        headers: { Accept: 'application/json' },
        responseType: 'text'
    })
        .then(response => {
            const data = normalizeApiResponse(response.data);
            if (!Array.isArray(data)) throw new Error(data?.message || data?.error || 'Unable to load enrolled students');
            const students = data.map(student => ({
                ...student,
                student_name: [student.first_name, student.last_name, student.ext].filter(Boolean).join(' ')
            }));
            content.innerHTML = `
                <div class="table-responsive"><table class="table class-students-table"><thead><tr><th>#</th><th>Student ID Number</th><th>Student Name</th><th>Program</th><th>School Year</th><th class="text-end">Action</th></tr></thead><tbody id="owner-grade-students"></tbody></table></div>`;
            const render = (items) => {
                const tbody = document.getElementById('owner-grade-students');
                if (!tbody) return;
                tbody.innerHTML = items.length ? items.map((student, index) => `<tr><td data-label="#">${index + 1}</td><td data-label="Student ID Number">${escapeHtml(String(getDisplayStudentId(student)))}</td><td data-label="Student Name">${escapeHtml(student.student_name || 'Student')}</td><td data-label="Program">${escapeHtml(student.program_name || 'N/A')}</td><td data-label="School Year"><span class="d-block">${escapeHtml(student.school_year || 'N/A')}</span>${Number(student.quarter_count) > 0 ? `<small class="text-muted">${Number(student.quarter_count)} quarter${Number(student.quarter_count) === 1 ? '' : 's'}</small>` : ''}</td><td data-label="Action" class="text-end"><button class="btn btn-sm eccd-open-btn" type="button" data-enrollment-id="${escapeHtml(String(student.enrollment_details_id || ''))}"><i class="bi bi-clipboard2-check me-1"></i>Open</button></td></tr>`).join('') : '<tr><td colspan="6" class="text-center text-muted py-4">No enrolled students in this section.</td></tr>';
                tbody.querySelectorAll('.eccd-open-btn').forEach(button => button.addEventListener('click', () => openStudentEccdChecklist(sectionId, button.dataset.enrollmentId)));
                return;
                tbody.innerHTML = items.length ? items.map((student, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(student.student_name || 'Student')}</td><td>${escapeHtml(student.program_name || '—')}</td><td>${escapeHtml(student.school_year || '—')}</td><td class="text-end"><button class="btn btn-sm eccd-open-btn" type="button" data-enrollment-id="${escapeHtml(String(student.enrollment_details_id || ''))}"><i class="bi bi-clipboard2-check me-1"></i>Open ECCD Checklist</button></td></tr>`).join('') : '<tr><td colspan="5" class="text-center text-muted py-4">No enrolled students in this section.</td></tr>';
                tbody.querySelectorAll('.eccd-open-btn').forEach(button => button.addEventListener('click', () => openStudentEccdChecklist(sectionId, button.dataset.enrollmentId)));
            };
            render(students);
            bindSectionStudentSearch(students, render);
        })
        .catch(error => {
            console.error('Error loading grades:', error);
            const message = getApiErrorMessage(error, 'Unable to load ECCD checklist records.');
            content.innerHTML = `<div class="section-tab-panel text-danger">${escapeHtml(message)}</div>`;
        });
}

function loadOwnerStudents(sectionId) {
    if (!canUseClassPermission('manage_students')) return;
    axios.get(`${sectionApiUrl}?operation=getEnrolledStudents&section_id=${sectionId}`)
        .then(res => {
            let students = res.data;
            if (typeof students === 'string' && students.startsWith('e')) students = JSON.parse(students.substring(1));
            if (!Array.isArray(students)) throw new Error('Unable to load students');
            currentSectionStudentCount = students.length;
            updateOwnerSectionStudentCountElements();
            const render = (items) => {
                const tbody = document.getElementById('owner-section-students');
                if (!tbody) return;
                tbody.innerHTML = items.length ? items.map((student, index) => {
                    const name = [student.first_name, student.last_name, student.ext].filter(Boolean).join(' ');
                    const status = student.status || 'Enrolled';
                    const statusClass = String(status).trim().toLowerCase() === 'pending' ? 'student-status-pending' : 'student-status-enrolled';
                    return `<tr><td data-label="#">${index + 1}</td><td data-label="Student ID Number">${escapeHtml(String(getDisplayStudentId(student)))}</td><td data-label="Student Name">${escapeHtml(name || student.student_name || 'Unnamed student')}</td><td data-label="Status"><span class="student-status ${statusClass}">${escapeHtml(status)}</span></td><td data-label="Email">${escapeHtml(student.email || 'N/A')}</td></tr>`;
                }).join('') : '<tr><td colspan="5" class="text-center text-muted py-4">No students enrolled in this section.</td></tr>';
                return;
                tbody.innerHTML = items.length ? items.map((student, index) => {
                    const name = [student.last_name, student.first_name, student.ext].filter(Boolean).join(', ').replace(/, ([^,]+)(, .+)?$/, ', $1$2');
                    return `<tr><td>${index + 1}</td><td>${escapeHtml(name || student.student_name || 'Unnamed student')}</td><td>${escapeHtml(String(student.student_id || student.enrollment_id || '—'))}</td><td><span class="student-status">${escapeHtml(student.status || 'Enrolled')}</span></td><td>${escapeHtml(student.email || '—')}</td></tr>`;
                }).join('') : '<tr><td colspan="5" class="text-center text-muted py-4">No students enrolled in this section.</td></tr>';
            };

            render(students);
            bindSectionStudentSearch(students, render);
        })
        .catch(() => {
            const tbody = document.getElementById('owner-section-students');
            if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-4">Unable to load enrolled students.</td></tr>';
        });
}

function getInstructorDisplayName(section) {
    const instructorStatus = String(section?.instructor_status || '').trim().toLowerCase();
    const firstName = String(section?.first_name || '').trim();
    const lastName = String(section?.last_name || '').trim();
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

    if (instructorStatus && instructorStatus !== 'active') {
        return 'No instructor';
    }

    return fullName || 'No instructor';
}

function toggleSectionTable(classId) {
    const container = document.getElementById(`sections-container-${classId}`);
    const icon = document.querySelector(`.toggle-icon-${classId}`);

    if (container.classList.contains('d-none')) {
        container.classList.remove('d-none');
        if (icon) icon.classList.replace('bi-plus-square', 'bi-dash-square');
        loadSectionsForNestedTable(classId);
    } else {
        container.classList.add('d-none');
        if (icon) icon.classList.replace('bi-dash-square', 'bi-plus-square');
    }
}

function loadSectionsForNestedTable(classId) {
    const tbody = document.getElementById(`section-list-${classId}`);
    
    axios.get(`${sectionApiUrl}?operation=getSectionsByClass&class_id=${classId}`)
        .then(res => {
            let data = res.data;
            if (typeof data === 'string' && data.startsWith('e')) {
                data = JSON.parse(data.substring(1));
            }
            if (!Array.isArray(data)) {
                throw new Error(data?.message || 'Unable to load sections');
            }

            if (!Array.isArray(data) || data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No sections found</td></tr>';
                return;
            }

            const buildSectionActions = (sec) => {
                const actions = [];

                if (!isTeacherClassPage && canUseClassPermission('edit_sections')) {
                    actions.push(`<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); window.editSection(${sec.section_id})">Edit</a></li>`);
                }
                if (canUseClassPermission('manage_attendance')) {
                    actions.push(`<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); window.openSectionAttendance(${sec.section_id})">Attendance</a></li>`);
                }
                if (canUseClassPermission('manage_students')) {
                    actions.push(`<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); window.checkSectionStudents(${sec.section_id})">Check Students</a></li>`);
                }
                if (canUseClassPermission('manage_report_cards')) {
                    actions.push(`<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); window.openSectionReportCards(${sec.section_id})">Report Cards</a></li>`);
                }
                if (!isTeacherClassPage && canUseClassPermission('delete')) {
                    actions.push(`<li><a class="dropdown-item" href="#" onclick="event.preventDefault(); window.archiveSection(${sec.section_id})">Archive</a></li>`);
                }

                if (!actions.length) {
                    return '<span class="text-muted">-</span>';
                }

                return `
                    <div class="dropdown" onclick="event.stopPropagation();">
                        <button class="btn btn-sm btn-outline-secondary border-0" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                            <i class="bi bi-three-dots-vertical"></i>
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end">
                            ${actions.join('')}
                        </ul>
                    </div>
                `;
            };

            tbody.innerHTML = data.map(sec => `
                <tr>
                    <td>${sec.section_name}</td>
                    <td>${escapeHtml(getInstructorDisplayName(sec))}</td>
                    <td><strong>${sec.max || 'N/A'}</strong></td>
                    <td><strong data-section-id="${sec.section_id}" class="enrolled-count">Loading...</strong></td>
                    <td><span class="badge bg-info">${sec.status}</span></td>
                    <td>
                        <small>${sec.schedule_info || 'No schedule set'}</small>
                    </td>
                    <td class="text-center">
                        ${buildSectionActions(sec)}
                    </td>
                </tr>
            `).join('');

            // Load enrolled counts for each section
            data.forEach(sec => {
                loadSectionEnrolledCount(sec.section_id, sec.max);
            });
        })
        .catch(err => {
            console.error('Error loading sections:', err);
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Error loading data</td></tr>';
        });
}

// Action Functions bound to window for HTML onclick access
if (!isTeacherClassPage) {
    window.editClass = (id) => {
        if (!guardClassPermission('edit', 'You do not have permission to update class records.')) {
            return;
        }
        import('./class_add.js').then(module => {
            module.openEditClassModal(id);
        });
    };

    window.archiveClass = (id) => {
        console.log("Archiving Class ID:", id);
        // Logic to open Archive Class Modal or confirmation
    };

    window.editSection = (id) => {
        if (!guardClassPermission('edit_sections', 'You do not have permission to update class sections.')) {
            return;
        }
        openEditSectionModal(id);
    };

    window.addSection = (id) => {
        if (!guardClassPermission('manage_sections', 'You do not have permission to create class sections.')) {
            return;
        }
        openAddSectionModal(id);
    };

    window.archiveSection = (id) => {
        console.log("Archiving Section ID:", id);
        // Logic to open Archive Section Modal or confirmation
    };
}

function openSectionStudentsModal(sectionId) {
    // Create modal HTML
    const modalHTML = `
        <div class="modal fade" id="sectionStudentsModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Enrolled Students</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-info">
                            <strong id="enrolledCountHeader">Loading...</strong>
                        </div>
                        <div class="table-responsive">
                            <table class="table table-sm table-bordered">
                                <thead class="table-light">
                                    <tr>
                                        <th>Student Name</th>
                                        <th>Program</th>
                                        <th>Status</th>
                                        <th>Enrollment Date</th>
                                    </tr>
                                </thead>
                                <tbody id="sectionStudentsTableBody">
                                    <tr>
                                        <td colspan="4" class="text-center">
                                            <div class="spinner-border spinner-border-sm" role="status">
                                                <span class="visually-hidden">Loading...</span>
                                            </div>
                                            Loading students...
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Remove existing modal if present
    const existingModal = document.getElementById('sectionStudentsModal');
    if (existingModal) {
        existingModal.remove();
    }

    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('sectionStudentsModal'));
    modal.show();

    // Fetch enrolled students
    loadSectionStudents(sectionId);
    
    // Update header with count
    axios.get(`${sectionApiUrl}?operation=getEnrolledStudents&section_id=${sectionId}`)
        .then(res => {
            let data = res.data;
            if (typeof data === 'string' && data.startsWith('e')) {
                data = JSON.parse(data.substring(1));
            }
            const count = Array.isArray(data) ? data.length : 0;
            const headerEl = document.getElementById('enrolledCountHeader');
            if (headerEl) {
                headerEl.textContent = `Total Enrolled: ${count} ${count === 1 ? 'student' : 'students'}`;
            }
        })
        .catch(err => console.error('Error fetching count:', err));
}

function loadSectionEnrolledCount(sectionId, maxCapacity) {
    axios.get(`${sectionApiUrl}?operation=getEnrolledStudents&section_id=${sectionId}`)
        .then(res => {
            let data = res.data;
            if (typeof data === 'string' && data.startsWith('e')) {
                data = JSON.parse(data.substring(1));
            }

            const count = Array.isArray(data) ? data.length : 0;
            const countEl = document.querySelector(`.enrolled-count[data-section-id="${sectionId}"]`);
            if (countEl) {
                countEl.textContent = `${count}`;
            }
        })
        .catch(err => {
            console.error('Error loading enrolled count:', err);
            const countEl = document.querySelector(`.enrolled-count[data-section-id="${sectionId}"]`);
            if (countEl) {
                countEl.textContent = `?`;
            }
        });
}

function loadSectionStudents(sectionId) {
    axios.get(`${sectionApiUrl}?operation=getEnrolledStudents&section_id=${sectionId}`)
        .then(res => {
            let data = res.data;
            if (typeof data === 'string' && data.startsWith('e')) {
                data = JSON.parse(data.substring(1));
            }

            const tbody = document.getElementById('sectionStudentsTableBody');

            if (!Array.isArray(data) || data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No students enrolled in this section</td></tr>';
                return;
            }

            const formatStudentName = (student) => [student.first_name, student.last_name, student.ext]
                .filter(part => part && part.toString().trim())
                .map(part => part.toString().trim())
                .join(' ');

            tbody.innerHTML = data.map((student, index) => `
                <tr>
                    <td><strong>${index + 1}.</strong> ${formatStudentName(student)}</td>
                    <td>${student.program_name || 'N/A'}</td>
                    <td><span class="badge bg-${student.status === 'active' ? 'success' : student.status === 'pending' ? 'warning' : 'secondary'}">${student.status}</span></td>
                    <td>${student.enrollment_date ? new Date(student.enrollment_date).toLocaleDateString() : 'N/A'}</td>
                </tr>
            `).join('');
        })
        .catch(err => {
            console.error('Error loading section students:', err);
            const tbody = document.getElementById('sectionStudentsTableBody');
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-danger">Error loading student data</td></tr>';
        });
}

window.checkSectionStudents = (sectionId) => {
    if (!guardClassPermission('manage_students', 'You do not have permission to review section students.')) {
        return;
    }
    openSectionStudentsModal(sectionId);
};

window.openSectionReportCards = (sectionId) => {
    if (!guardClassPermission('manage_report_cards', 'You do not have permission to access section report cards.')) {
        return;
    }
    openSectionReportCards(sectionId);
};

window.openSectionAttendance = (sectionId) => {
    if (!guardClassPermission('manage_attendance', 'You do not have permission to access section attendance.')) {
        return;
    }
    const classId = document.getElementById('class-selector')?.value || '';
    updateOwnerClassDirectoryUrl(classId, sectionId);
    navigateToSectionAttendancePage(sectionId, classId);
};
