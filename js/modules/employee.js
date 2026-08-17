// js/modules/employee.js
import "../utilities/paging.js";
import { getResolvedRolePermissions, initRbacPermissions, normalizeRbacRoleKey } from "../utilities/rbac_navigation.js";
import { openEmployeeCredentialsModal, renderPasswordModal } from "./password.js";

let employeesData = [];
let employeePaginationManager = null;
let currentScheduleEmpId = null; 
const OTHER_OPTION_VALUE = '__others__';
const DEFAULT_EMPLOYEE_STATUS_FILTER = 'active';
const EMPLOYEE_PAGE_SIZE = 10;
let currentEmployeeRole = '';
let employeeModulePermissions = {
    view: true,
    create: true,
    edit: true,
    delete: true,
    approve: true,
    export: true,
    manage_rbac: true
};
const employeeFilters = {
    search: '',
    status: DEFAULT_EMPLOYEE_STATUS_FILTER,
    branch: '',
    role: '',
    program: ''
};

function getTodayDateString() {
    return new Date().toISOString().split('T')[0];
}

function getDateInputValue(value) {
    if (!value) return '';
    return String(value).split(/[ T]/)[0];
}

function formatDateForDisplay(value) {
    return getDateInputValue(value) || 'N/A';
}

function getEmployeeFullName(emp) {
    return `${emp.first_name || ''} ${emp.middle_name ? emp.middle_name + ' ' : ''}${emp.last_name || ''}`.trim();
}

function formatRoleName(roleName) {
    if (!roleName) return 'N/A';
    return roleName.charAt(0).toUpperCase() + roleName.slice(1);
}

function formatStatusLabel(status) {
    if (status === 'active') return 'Active';
    if (status === 'inactive') return 'Inactive';
    return 'Not Set';
}

function getStatusBadgeClass(status) {
    if (status === 'active') return 'bg-success';
    if (status === 'inactive') return 'bg-secondary';
    return 'bg-warning text-dark';
}

function setDetailText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value || 'N/A';
}

function showEmployeePermissionAlert(message) {
    Swal.fire('Access Restricted', message, 'warning');
}

function removeEmployeeStatusAlert() {
    document.getElementById('employee-access-alert')?.remove();
}

function loadCurrentEmployeePermissions() {
    const userData = localStorage.getItem('user');
    currentEmployeeRole = '';

    if (userData) {
        try {
            currentEmployeeRole = normalizeRbacRoleKey(JSON.parse(userData).role_name);
        } catch (error) {
            console.error('Error parsing current employee role:', error);
        }
    }

    const resolvedPermissions = getResolvedRolePermissions(currentEmployeeRole).employee;
    if (resolvedPermissions) {
        employeeModulePermissions = resolvedPermissions;
    }
}

function canUseEmployeePermission(permissionKey) {
    return Boolean(employeeModulePermissions?.[permissionKey]);
}

function renderEmployeeAccessDenied() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    const filterContainer = document.querySelector('.filter-container');

    filterContainer?.classList.add('d-none');
    document.querySelectorAll('.main-card').forEach(card => card.classList.add('d-none'));

    const existingAlert = document.getElementById('employee-access-alert');
    if (existingAlert) return;

    const alert = document.createElement('div');
    alert.id = 'employee-access-alert';
    alert.className = 'alert alert-warning shadow-sm';
    alert.setAttribute('role', 'alert');
    alert.textContent = 'You do not currently have permission to view the employee module.';
    mainContent.appendChild(alert);
}

function applyEmployeePagePermissions() {
    const addButton = document.querySelector('.top-bar .btn-add');
    const roleBaseLink = document.getElementById('employee-role-base-link');

    if (!canUseEmployeePermission('view')) {
        renderEmployeeAccessDenied();
        return { allowed: false, canView: false };
    }

    if (addButton && !canUseEmployeePermission('create')) {
        addButton.classList.add('d-none');
    }

    if (roleBaseLink && !canUseEmployeePermission('manage_rbac')) {
        roleBaseLink.classList.add('d-none');
    }

    removeEmployeeStatusAlert();

    return {
        allowed: true,
        canView: true
    };
}

function setSummaryMetric(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function normalizeFilterValue(value) {
    return (value || '').toString().trim().toLowerCase();
}

function normalizeEmployeeBranchValue(value) {
    const trimmed = (value ?? '').toString().trim();
    return trimmed === '' ? null : trimmed;
}

function validateEmailAddress(email) {
    const trimmed = (email ?? '').toString().trim();
    if (!trimmed) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(trimmed);
}

function setSelectOptions(select, items, placeholder, valueBuilder, labelBuilder) {
    if (!select) return;

    select.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = placeholder;
    select.appendChild(defaultOption);

    items.forEach(item => {
        const option = document.createElement('option');
        option.value = valueBuilder(item);
        option.textContent = labelBuilder(item);
        select.appendChild(option);
    });
}

function updateEmployeeSummary(filteredCount) {
    const summary = document.getElementById('employee-table-summary');
    if (!summary) return;

    const total = employeesData.length;
    summary.textContent = `Showing ${filteredCount} of ${total} entr${total === 1 ? 'y' : 'ies'}`;
}

function getFilteredEmployees() {
    return employeesData.filter(emp => {
        const fullName = normalizeFilterValue(getEmployeeFullName(emp));
        const status = normalizeFilterValue(emp.status);
        const branchId = String(emp.branch_id || '');
        const role = normalizeFilterValue(emp.role_name);
        const programs = (emp.programs || '')
            .split(',')
            .map(item => normalizeFilterValue(item))
            .filter(Boolean);

        if (employeeFilters.search && !fullName.includes(employeeFilters.search)) {
            return false;
        }
        if (employeeFilters.status && status !== employeeFilters.status) {
            return false;
        }
        if (employeeFilters.branch && branchId !== employeeFilters.branch) {
            return false;
        }
        if (employeeFilters.role && role !== employeeFilters.role) {
            return false;
        }
        if (employeeFilters.program && !programs.includes(employeeFilters.program)) {
            return false;
        }

        return true;
    });
}

function applyEmployeeFilters() {
    const filteredEmployees = getFilteredEmployees();

    if (employeePaginationManager) {
        employeePaginationManager.setLocalData(filteredEmployees);
        return;
    }

    renderEmployeeTable(filteredEmployees);
    updateEmployeeSummary(filteredEmployees.length);
}

function updateEmployeeOverviewSummary() {
    const totalEmployees = employeesData.length;
    const activeEmployees = employeesData.filter(emp => normalizeFilterValue(emp.status) === 'active').length;
    const branchCount = new Set(
        employeesData
            .map(emp => (emp.branch_name || emp.branch_id || '').toString().trim())
            .filter(Boolean)
    ).size;
    const roleCount = new Set(
        employeesData
            .map(emp => normalizeFilterValue(emp.role_name))
            .filter(Boolean)
    ).size;

    setSummaryMetric('employee-summary-total', totalEmployees);
    setSummaryMetric('employee-summary-active', activeEmployees);
    setSummaryMetric('employee-summary-branches', branchCount);
    setSummaryMetric('employee-summary-roles', roleCount);
}

function dispatchEmployeeDataUpdate() {
    document.dispatchEvent(new CustomEvent('employee-data-updated', {
        detail: {
            employees: employeesData.map(emp => ({ ...emp }))
        }
    }));
}

function setupEmployeeFilterControls() {
    const searchInput = document.getElementById('search-input');
    const statusSelect = document.getElementById('employee-status-filter');
    const branchSelect = document.getElementById('employee-branch-filter');
    const roleSelect = document.getElementById('employee-role-filter');
    const programSelect = document.getElementById('employee-program-filter');
    const applyButton = document.getElementById('employee-apply-filters');
    const resetButton = document.getElementById('employee-reset-filters');
    const filterToggle = document.querySelector('.filter-toggle-btn');
    const filterContainer = document.querySelector('.filter-container');

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            employeeFilters.search = normalizeFilterValue(searchInput.value);
            applyEmployeeFilters();
        });
    }

    const syncSelectFilters = () => {
        employeeFilters.status = normalizeFilterValue(statusSelect?.value);
        employeeFilters.branch = branchSelect?.value || '';
        employeeFilters.role = normalizeFilterValue(roleSelect?.value);
        employeeFilters.program = normalizeFilterValue(programSelect?.value);
    };

    if (applyButton) {
        applyButton.addEventListener('click', () => {
            syncSelectFilters();
            applyEmployeeFilters();
        });
    }

    [statusSelect, branchSelect, roleSelect, programSelect].forEach(select => {
        select?.addEventListener('change', () => {
            syncSelectFilters();
            applyEmployeeFilters();
        });
    });

    if (resetButton) {
        resetButton.addEventListener('click', () => {
            employeeFilters.search = '';
            employeeFilters.status = DEFAULT_EMPLOYEE_STATUS_FILTER;
            employeeFilters.branch = '';
            employeeFilters.role = '';
            employeeFilters.program = '';

            if (searchInput) searchInput.value = '';
            if (statusSelect) statusSelect.value = DEFAULT_EMPLOYEE_STATUS_FILTER;
            if (branchSelect) branchSelect.value = '';
            if (roleSelect) roleSelect.value = '';
            if (programSelect) programSelect.value = '';

            applyEmployeeFilters();
        });
    }

    if (filterToggle && filterContainer) {
        filterToggle.addEventListener('click', () => {
            filterContainer.classList.toggle('filter-open');
        });
    }

    if (statusSelect) {
        statusSelect.value = employeeFilters.status;
    }
}

function loadEmployeeFilterLookups() {
    const branchSelect = document.getElementById('employee-branch-filter');
    const roleSelect = document.getElementById('employee-role-filter');
    const programSelect = document.getElementById('employee-program-filter');

    axios.get("../../api/admin/employee.php?operation=getRoles")
        .then(res => {
            const roles = Array.isArray(res.data) ? res.data : [];
            setSelectOptions(
                roleSelect,
                roles,
                'All Roles',
                item => item.role_name || '',
                item => formatRoleName(item.role_name || '')
            );
        })
        .catch(err => console.error('Error loading employee roles for filters:', err));

    axios.get("../../api/admin/employee.php?operation=getBranches")
        .then(res => {
            const branches = Array.isArray(res.data) ? res.data : [];
            setSelectOptions(
                branchSelect,
                branches,
                'All Branches',
                item => item.branch_id,
                item => item.branch_name || 'N/A'
            );
        })
        .catch(err => console.error('Error loading employee branches for filters:', err));

    axios.get("../../api/admin/employee.php?operation=getPrograms")
        .then(res => {
            const programs = Array.isArray(res.data) ? res.data : [];
            setSelectOptions(
                programSelect,
                programs,
                'All Programs',
                item => item.name || '',
                item => item.name || 'N/A'
            );
        })
        .catch(err => console.error('Error loading employee programs for filters:', err));
}

function buildSubjectOptions(subjects) {
    let opts = '<option value="">Select Subject</option>';
    if (Array.isArray(subjects)) {
        subjects.forEach(s => {
            opts += `<option value="${s.subject_id}">${s.subject_name}</option>`;
        });
    }
    opts += `<option value="${OTHER_OPTION_VALUE}">OTHERS</option>`;
    return opts;
}

function buildProgramOptions(programs) {
    let opts = '<option value="">Select Program</option>';
    if (Array.isArray(programs)) {
        programs.forEach(p => {
            opts += `<option value="${p.program_id}">${p.name}</option>`;
        });
    }
    opts += `<option value="${OTHER_OPTION_VALUE}">OTHERS</option>`;
    return opts;
}

function setCreateGroupVisibility(context, type, visible) {
    const group = document.getElementById(`${context}_${type}_create_group`);
    if (group) group.classList.toggle('d-none', !visible);

    if (visible) {
        const input = document.getElementById(`${context}_new_${type}_name`);
        if (input) input.focus();
    }
}

function handleOtherSelection(context, type) {
    const select = document.getElementById(`${context}_${type}_select`);
    setCreateGroupVisibility(context, type, Boolean(select && select.value === OTHER_OPTION_VALUE));
}

function resetCreateGroup(context, type, selectValue = '') {
    const select = document.getElementById(`${context}_${type}_select`);
    if (select) select.value = selectValue;
    setCreateGroupVisibility(context, type, false);
}

function addOptionToSelect(selectId, value, text) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const existing = Array.from(select.options).find(opt => opt.value == value);
    if (existing) {
        existing.text = text;
        return;
    }

    const opt = document.createElement('option');
    opt.value = value;
    opt.text = text;
    const otherOption = Array.from(select.options).find(option => option.value === OTHER_OPTION_VALUE);
    select.insertBefore(opt, otherOption || null);
}

window.employeeHandleSubjectSelection = function(context) {
    handleOtherSelection(context, 'subject');
};

window.employeeHandleProgramSelection = function(context) {
    handleOtherSelection(context, 'program');
};

export async function initializeEmployeeModuleSupport() {
    try {
        await initRbacPermissions();
    } catch (error) {
        console.error('Error initializing employee RBAC permissions:', error);
    }

    loadCurrentEmployeePermissions();
    injectEmployeeModals();
    injectScheduleModal();
    renderPasswordModal();

    if (canUseEmployeePermission('create') || canUseEmployeePermission('edit') || canUseEmployeePermission('approve')) {
        loadRolesForModals();
    }
}

export function loadEmployeesData() {
    const tableBody = document.getElementById('employeeTableBody');
    if (tableBody) {
        tableBody.innerHTML = '<tr><td colspan="10" class="text-center">Loading...</td></tr>';
    }

    return axios.get("../../api/admin/employee.php?operation=getEmployees")
    .then(res => {
        if (res.data.status === 'success') {
            employeesData = res.data.data;
            updateEmployeeOverviewSummary();
            applyEmployeeFilters();
            dispatchEmployeeDataUpdate();
            return employeesData;
        } else {
            employeesData = [];
            if (tableBody) {
                tableBody.innerHTML = '<tr><td colspan="10" class="text-center text-danger">Error loading data</td></tr>';
            }
            updateEmployeeOverviewSummary();
            updateEmployeeSummary(0);
            dispatchEmployeeDataUpdate();
            return employeesData;
        }
    })
    .catch(err => {
        console.error(err);
        employeesData = [];
        if (tableBody) {
            tableBody.innerHTML = '<tr><td colspan="10" class="text-center text-danger">Error loading data</td></tr>';
        }
        updateEmployeeOverviewSummary();
        updateEmployeeSummary(0);
        dispatchEmployeeDataUpdate();
        return employeesData;
    });
}

function renderEmployeeTable(data) {
    const tableBody = document.getElementById('employeeTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (data.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="10" class="text-center">No employees found.</td></tr>';
        return;
    }

    data.forEach(emp => {
        const actionItems = [];

        if (canUseEmployeePermission('view')) {
            actionItems.push(`
                <li>
                    <button class="dropdown-item" type="button" onclick="openEmployeeDetailsModal(${emp.employee_id})">
                        <i class="bi bi-eye me-2"></i>View
                    </button>
                </li>
            `);
        }

        if (canUseEmployeePermission('edit')) {
            actionItems.push(`
                <li>
                    <button class="dropdown-item" type="button" onclick="openViewEmployeeModal(${emp.employee_id})">
                        <i class="bi bi-pencil me-2"></i>Edit
                    </button>
                </li>
            `);
            actionItems.push(`
                <li>
                    <button class="dropdown-item" type="button" onclick="openScheduleModal(${emp.employee_id})">
                        <i class="bi bi-calendar-week me-2"></i>Schedule
                    </button>
                </li>
            `);
        }

        if (currentEmployeeRole === 'owner') {
            actionItems.push(`
                <li>
                    <button class="dropdown-item" type="button" onclick="openEmployeeCredentialsModal(${emp.employee_id})">
                        <i class="bi bi-key me-2"></i>Change Credentials
                    </button>
                </li>
            `);
        }

        const actionCell = actionItems.length ? `
            <div class="dropdown">
                <button class="btn btn-sm btn-link text-secondary p-0" type="button" data-bs-toggle="dropdown" aria-expanded="false" title="Actions">
                    <i class="bi bi-three-dots-vertical fs-5"></i>
                </button>
                <ul class="dropdown-menu dropdown-menu-end">
                    ${actionItems.join('')}
                </ul>
            </div>
        ` : '<span class="text-muted">No actions</span>';

        const row = `
            <tr>
                <td data-label="Employee Name">${getEmployeeFullName(emp)}</td>
                <td data-label="Birthday">${formatDateForDisplay(emp.birthday)}</td>
                <td data-label="Username">${emp.username}</td>
                <td data-label="Role">${formatRoleName(emp.role_name)}</td>
                    <td data-label="Status"><span class="badge ${getStatusBadgeClass(emp.status)}">${formatStatusLabel(emp.status)}</span></td>
                    <td data-label="Branch">${emp.branch_name || 'N/A'}</td>
                    <td data-label="Subjects">${emp.subjects || 'N/A'}</td>
                    <td data-label="Program">${emp.programs || 'N/A'}</td>
                    <td data-label="Date Created">${emp.date_created}</td>
                <td class="text-center" data-label="Actions">${actionCell}</td>
            </tr>
        `;
        tableBody.innerHTML += row;
    });

}

window.openEmployeeCredentialsModal = function(employeeId) {
    axios.get(`../../api/admin/employee.php?operation=getEmployeeProfile&employee_id=${employeeId}`)
        .then(response => {
            const result = response.data;
            if (result.status !== 'success' || !result.data) {
                Swal.fire('Error', result.message || 'Unable to load employee credentials.', 'error');
                return;
            }

            openEmployeeCredentialsModal(result.data, () => loadEmployeesData());
        })
        .catch(error => {
            console.error('Employee credential load error:', error);
            Swal.fire('Error', 'Unable to load employee credentials.', 'error');
        });
};

function setupEmployeePagination() {
    if (employeePaginationManager || typeof window.PaginationManager !== 'function') {
        return;
    }

    const paginationNav = document.querySelector('.d-flex.justify-content-between.align-items-center.mt-4 nav');
    const tableBody = document.getElementById('employeeTableBody');
    const showingElement = document.getElementById('employee-table-summary');

    if (!paginationNav || !tableBody || !showingElement) {
        return;
    }

    employeePaginationManager = new window.PaginationManager({
        container: paginationNav,
        tableBody,
        onDataLoad: renderEmployeeTable,
        showingElement,
        localData: [],
        perPage: EMPLOYEE_PAGE_SIZE
    });

    employeePaginationManager.init();
}

document.addEventListener("DOMContentLoaded", async () => {
    if (!document.getElementById('employeeTableBody')) {
        return;
    }

    await initializeEmployeeModuleSupport();
    const permissionState = applyEmployeePagePermissions();
    if (!permissionState.allowed) {
        return;
    }

    if (permissionState.canView) {
        setupEmployeePagination();
        setupEmployeeFilterControls();
        loadEmployeeFilterLookups();
        loadEmployeesData();
    }
});

// --- 2. LOAD ROLES AND BRANCHES (For Select Dropdowns) ---
function loadRolesForModals() {
    axios.get("../../api/admin/employee.php?operation=getRoles")
    .then(res => {
        const roles = res.data;
        const addSelect = document.getElementById('add_role');
        const updateSelect = document.getElementById('update_role');

        let options = '<option value="">Select Role</option>';
        if (Array.isArray(roles)) {
            roles.forEach(r => {
                options += `<option value="${r.role_name}">${r.role_name.charAt(0).toUpperCase() + r.role_name.slice(1)}</option>`;
            });
        }

        if (addSelect) addSelect.innerHTML = options;
        if (updateSelect) updateSelect.innerHTML = options;
    })
    .catch(err => console.error(err));

    // Load branches
    axios.get("../../api/admin/employee.php?operation=getBranches")
    .then(res => {
        const branches = res.data;
        const addSelect = document.getElementById('add_branch');
        const updateSelect = document.getElementById('update_branch');

        let options = '<option value="">None</option>';
        if (Array.isArray(branches)) {
            branches.forEach(b => {
                options += `<option value="${b.branch_id}">${b.branch_name}</option>`;
            });
        }

        if (addSelect) addSelect.innerHTML = options;
        if (updateSelect) updateSelect.innerHTML = options;
    })
    .catch(err => console.error(err));

        // Load subjects for selection (multi-select)
        axios.get("../../api/admin/subject.php?operation=getSubjects")
        .then(res => {
            const subjects = res.data;
            const addSub = document.getElementById('add_subject_select');
            const updateSub = document.getElementById('update_subject_select');
            const opts = buildSubjectOptions(subjects);
            if (addSub) addSub.innerHTML = opts;
            if (updateSub) updateSub.innerHTML = opts;
            handleOtherSelection('add', 'subject');
            handleOtherSelection('update', 'subject');
        })
        .catch(err => console.error(err));

        // Load programs for selection (multi-select)
        axios.get("../../api/admin/employee.php?operation=getPrograms")
        .then(res => {
            const programs = res.data;
            const addProg = document.getElementById('add_program_select');
            const updateProg = document.getElementById('update_program_select');
            const opts = buildProgramOptions(programs);
            if (addProg) addProg.innerHTML = opts;
            if (updateProg) updateProg.innerHTML = opts;
            handleOtherSelection('add', 'program');
            handleOtherSelection('update', 'program');
        })
        .catch(err => console.error(err));
}

// --- 3. INJECT MODALS ---
function injectEmployeeModals() {
    if (document.getElementById('addEmployeeModal')) return;
    const modalHTML = `
    <div class="modal fade" id="addEmployeeModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Add Employee</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <form id="addEmployeeForm">
                        <div class="mb-3">
                            <label class="form-label">First Name <span class="text-danger" aria-hidden="true">*</span></label>
                            <input type="text" id="add_first_name" class="form-control" required>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Middle Name</label>
                            <input type="text" id="add_middle_name" class="form-control">
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Last Name <span class="text-danger" aria-hidden="true">*</span></label>
                            <input type="text" id="add_last_name" class="form-control" required>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Birthday <span class="text-danger" aria-hidden="true">*</span></label>
                            <input type="date" id="add_birthday" class="form-control" max="${getTodayDateString()}" required>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Role <span class="text-danger" aria-hidden="true">*</span></label>
                            <select id="add_role" class="form-control" required></select>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Username <span class="text-danger" aria-hidden="true">*</span></label>
                            <input type="text" id="add_username" class="form-control" required>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Email <span class="text-danger" aria-hidden="true">*</span></label>
                            <input type="email" id="add_email" class="form-control" required>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Password <span class="text-danger" aria-hidden="true">*</span></label>
                            <input type="password" id="add_password" class="form-control" required>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Branch</label>
                            <select id="add_branch" class="form-control"></select>
                        </div>
                            <div class="mb-3">
                                <label class="form-label">Subjects</label>
                                <div class="d-flex gap-2">
                                    <select id="add_subject_select" class="form-control" onchange="employeeHandleSubjectSelection('add')"></select>
                                    <button class="btn btn-outline-secondary" type="button" onclick="employeeAddSelectedSubject('add')">Add</button>
                                </div>
                                <div id="add_subject_list" class="mt-2"></div>
                                <div class="input-group mt-2 d-none" id="add_subject_create_group">
                                    <input type="text" id="add_new_subject_name" class="form-control" placeholder="New subject name">
                                    <button class="btn btn-outline-secondary" type="button" onclick="employeeCreateSubject('add')">Create</button>
                                </div>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Programs</label>
                                <div class="d-flex gap-2">
                                    <select id="add_program_select" class="form-control" onchange="employeeHandleProgramSelection('add')"></select>
                                    <button class="btn btn-outline-secondary" type="button" onclick="employeeAddSelectedProgram('add')">Add</button>
                                </div>
                                <div id="add_program_list" class="mt-2"></div>
                                <div class="input-group mt-2 d-none" id="add_program_create_group">
                                    <input type="text" id="add_new_program_name" class="form-control" placeholder="New program name">
                                    <button class="btn btn-outline-secondary" type="button" onclick="employeeCreateProgram('add')">Create</button>
                                </div>
                            </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    <button type="button" class="btn btn-primary" onclick="saveNewEmployee()">Save</button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="viewEmployeeModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Employee Details</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <form id="updateEmployeeForm">
                        <input type="hidden" id="update_employee_id">
                        <div class="mb-3">
                            <label class="form-label">First Name <span class="text-danger" aria-hidden="true">*</span></label>
                            <input type="text" id="update_first_name" class="form-control" required>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Middle Name</label>
                            <input type="text" id="update_middle_name" class="form-control">
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Last Name <span class="text-danger" aria-hidden="true">*</span></label>
                            <input type="text" id="update_last_name" class="form-control" required>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Birthday <span class="text-danger" aria-hidden="true">*</span></label>
                            <input type="date" id="update_birthday" class="form-control" max="${getTodayDateString()}" required>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Role <span class="text-danger" aria-hidden="true">*</span></label>
                            <select id="update_role" class="form-control" required></select>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Status <span class="text-danger" aria-hidden="true">*</span></label>
                            <select id="update_status" class="form-control" required>
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                            </select>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Username</label>
                            <input type="text" id="update_username" class="form-control" readonly disabled>
                            <small class="text-muted">Username cannot be changed</small>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Branch</label>
                            <select id="update_branch" class="form-control"></select>
                        </div>
                            <div class="mb-3">
                                <label class="form-label">Subjects</label>
                                <div class="d-flex gap-2">
                                    <select id="update_subject_select" class="form-control" onchange="employeeHandleSubjectSelection('update')"></select>
                                    <button class="btn btn-outline-secondary" type="button" onclick="employeeAddSelectedSubject('update')">Add</button>
                                </div>
                                <div id="update_subject_list" class="mt-2"></div>
                                <div class="input-group mt-2 d-none" id="update_subject_create_group">
                                    <input type="text" id="update_new_subject_name" class="form-control" placeholder="New subject name">
                                    <button class="btn btn-outline-secondary" type="button" onclick="employeeCreateSubject('update')">Create</button>
                                </div>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Programs</label>
                                <div class="d-flex gap-2">
                                    <select id="update_program_select" class="form-control" onchange="employeeHandleProgramSelection('update')"></select>
                                    <button class="btn btn-outline-secondary" type="button" onclick="employeeAddSelectedProgram('update')">Add</button>
                                </div>
                                <div id="update_program_list" class="mt-2"></div>
                                <div class="input-group mt-2 d-none" id="update_program_create_group">
                                    <input type="text" id="update_new_program_name" class="form-control" placeholder="New program name">
                                    <button class="btn btn-outline-secondary" type="button" onclick="employeeCreateProgram('update')">Create</button>
                                </div>
                            </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    <button type="button" class="btn btn-primary" onclick="saveUpdateEmployee()">Update</button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="employeeDetailsModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">View Employee</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <div class="row g-3">
                        <div class="col-md-6">
                            <small class="text-muted d-block">Full Name</small>
                            <div class="fw-semibold" id="detail_full_name">N/A</div>
                        </div>
                        <div class="col-md-6">
                            <small class="text-muted d-block">Username</small>
                            <div class="fw-semibold" id="detail_username">N/A</div>
                        </div>
                        <div class="col-md-6">
                            <small class="text-muted d-block">Birthday</small>
                            <div class="fw-semibold" id="detail_birthday">N/A</div>
                        </div>
                        <div class="col-md-6">
                            <small class="text-muted d-block">Role</small>
                            <div class="fw-semibold" id="detail_role">N/A</div>
                        </div>
                        <div class="col-md-6">
                            <small class="text-muted d-block">Status</small>
                            <div class="fw-semibold" id="detail_status">N/A</div>
                        </div>
                        <div class="col-md-6">
                            <small class="text-muted d-block">Branch</small>
                            <div class="fw-semibold" id="detail_branch">N/A</div>
                        </div>
                        <div class="col-12">
                            <small class="text-muted d-block">Subjects</small>
                            <div class="fw-semibold" id="detail_subjects">N/A</div>
                        </div>
                        <div class="col-12">
                            <small class="text-muted d-block">Programs</small>
                            <div class="fw-semibold" id="detail_programs">N/A</div>
                        </div>
                        <div class="col-md-6">
                            <small class="text-muted d-block">Date Created</small>
                            <div class="fw-semibold" id="detail_date_created">N/A</div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                </div>
            </div>
        </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

// --- 4. INJECT SCHEDULE MODAL ---
function injectScheduleModal() {
    if (document.getElementById('scheduleModal')) return;
    const html = `
    <div class="modal fade" id="scheduleModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header  text-dark" , style="background-color: #ea9aa6;">
                    <h5 class="modal-title"><i class="bi bi-clock"></i> Manage Weekly Schedule</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <div class="alert alert-info py-2"><small>Add multiple shifts per day if needed (e.g., Morning & Afternoon).</small></div>
                    <div class="table-responsive">
                        <table class="table table-bordered table-sm">
                            <thead class="table-light">
                                <tr>
                                    <th>Day</th>
                                    <th>Start Time</th>
                                    <th>End Time</th>
                                    <th style="width:50px;"></th>
                                </tr>
                            </thead>
                            <tbody id="scheduleRows"></tbody>
                        </table>
                    </div>
                    <button class="btn btn-sm btn-success" onclick="addScheduleRow()"><i class="bi bi-plus"></i> Add Shift</button>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    <button type="button" class="btn btn-primary" onclick="saveSchedule()">Save Schedule</button>
                </div>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
}

// --- 5. SCHEDULE LOGIC ---

window.openScheduleModal = function(id) {
    if (!canUseEmployeePermission('edit')) {
        showEmployeePermissionAlert('You do not have permission to manage employee schedules.');
        return;
    }

    currentScheduleEmpId = id;
    const rows = document.getElementById('scheduleRows');
    rows.innerHTML = '<tr><td colspan="4" class="text-center">Loading...</td></tr>';

    const modal = new bootstrap.Modal(document.getElementById('scheduleModal'));
    modal.show();

    // Fetch existing schedule
    axios.get(`../../api/admin/employee.php?operation=getSchedule&id=${id}`)
    .then(res => {
        rows.innerHTML = '';
        if (res.data.status === 'success' && res.data.data.length > 0) {
            res.data.data.forEach(s => addScheduleRow(s));
        } else {
            rows.innerHTML = '<tr><td colspan="4" class="text-center text-muted" id="noScheduleMsg">No schedule set. Click "Add Shift".</td></tr>';
        }
    })
    .catch(err => {
        console.error(err);
        rows.innerHTML = '<tr><td colspan="4" class="text-center text-danger">Error loading schedule</td></tr>';
    });
};

window.addScheduleRow = function(data = null) {
    const tbody = document.getElementById('scheduleRows');
    const msg = document.getElementById('noScheduleMsg');
    if (msg) msg.parentNode.remove(); // Remove "No schedule" message

    const day = data ? data.day_of_week : 'Monday';
    const start = data ? data.start_time : '';
    const end = data ? data.end_time : '';

    const row = document.createElement('tr');
    row.innerHTML = `
        <td>
            <select class="form-select form-select-sm sched-day">
                <option value="Monday" ${day === 'Monday' ? 'selected' : ''}>Monday</option>
                <option value="Tuesday" ${day === 'Tuesday' ? 'selected' : ''}>Tuesday</option>
                <option value="Wednesday" ${day === 'Wednesday' ? 'selected' : ''}>Wednesday</option>
                <option value="Thursday" ${day === 'Thursday' ? 'selected' : ''}>Thursday</option>
                <option value="Friday" ${day === 'Friday' ? 'selected' : ''}>Friday</option>
                <option value="Saturday" ${day === 'Saturday' ? 'selected' : ''}>Saturday</option>
                <option value="Sunday" ${day === 'Sunday' ? 'selected' : ''}>Sunday</option>
            </select>
        </td>
        <td><input type="time" class="form-control form-control-sm sched-start" value="${start}"></td>
        <td><input type="time" class="form-control form-control-sm sched-end" value="${end}"></td>
        <td class="text-center">
            <button class="btn btn-sm btn-outline-danger" onclick="this.closest('tr').remove()"><i class="bi bi-trash"></i></button>
        </td>
    `;
    tbody.appendChild(row);
};

window.saveSchedule = function() {
    if (!canUseEmployeePermission('edit')) {
        showEmployeePermissionAlert('You do not have permission to manage employee schedules.');
        return;
    }

    if (!currentScheduleEmpId) return;

    const rows = document.querySelectorAll('#scheduleRows tr');
    const schedules = [];

    rows.forEach(row => {
        const day = row.querySelector('.sched-day').value;
        const start = row.querySelector('.sched-start').value;
        const end = row.querySelector('.sched-end').value;

        if (day && start && end) {
            schedules.push({ day, start, end });
        }
    });

    axios.post("../../api/admin/employee.php", {
        operation: "saveSchedule",
        json: JSON.stringify({
            employee_id: currentScheduleEmpId,
            schedules: schedules
        })
    }).then(res => {
        if (res.data.status === 'success') {
            Swal.fire('Saved', 'Schedule updated successfully', 'success');
            const modalEl = document.getElementById('scheduleModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            modal.hide();
        } else {
            Swal.fire('Error', res.data.message, 'error');
        }
    }).catch(err => {
        console.error(err);
        Swal.fire('Error', 'Failed to save schedule', 'error');
    });
};

// --- 6. MODAL ACTIONS (EMPLOYEE) ---

// Open Add Modal
window.openAddEmployeeModal = function() {
    if (!canUseEmployeePermission('create')) {
        showEmployeePermissionAlert('You do not have permission to add employees.');
        return;
    }

    // reset add form and subject list
    const form = document.getElementById('addEmployeeForm');
    if (form) form.reset();
    const addList = document.getElementById('add_subject_list');
    if (addList) addList.innerHTML = '';
    const addProgList = document.getElementById('add_program_list');
    if (addProgList) addProgList.innerHTML = '';
    resetCreateGroup('add', 'subject');
    resetCreateGroup('add', 'program');
    const modal = new bootstrap.Modal(document.getElementById('addEmployeeModal'));
    modal.show();
};

window.openEmployeeDetailsModal = function(id) {
    if (!canUseEmployeePermission('view')) {
        showEmployeePermissionAlert('You do not have permission to view employee details.');
        return;
    }

    const emp = employeesData.find(e => e.employee_id == id);
    if (!emp) return;

    setDetailText('detail_full_name', getEmployeeFullName(emp));
    setDetailText('detail_username', emp.username);
    setDetailText('detail_birthday', formatDateForDisplay(emp.birthday));
    setDetailText('detail_role', formatRoleName(emp.role_name));
    setDetailText('detail_status', formatStatusLabel(emp.status));
    setDetailText('detail_branch', emp.branch_name || 'None');
    setDetailText('detail_subjects', emp.subjects);
    setDetailText('detail_programs', emp.programs);
    setDetailText('detail_date_created', emp.date_created);

    const modal = new bootstrap.Modal(document.getElementById('employeeDetailsModal'));
    modal.show();
};

// Open View/Update Modal
window.openViewEmployeeModal = function(id) {
    if (!canUseEmployeePermission('edit')) {
        showEmployeePermissionAlert('You do not have permission to edit employees.');
        return;
    }

    const emp = employeesData.find(e => e.employee_id == id);
    if (!emp) return;

    document.getElementById('update_employee_id').value = emp.employee_id;
    document.getElementById('update_first_name').value = emp.first_name;
    document.getElementById('update_middle_name').value = emp.middle_name || '';
    document.getElementById('update_last_name').value = emp.last_name;
    document.getElementById('update_birthday').value = getDateInputValue(emp.birthday);
    document.getElementById('update_username').value = emp.username;
    
    const roleSelect = document.getElementById('update_role');
    roleSelect.value = emp.role_name;
    document.getElementById('update_status').value = emp.status || 'active';
    document.getElementById('update_branch').value = emp.branch_id || '';
    resetCreateGroup('update', 'subject');
    resetCreateGroup('update', 'program');

        // Load assigned subjects for this employee and populate list
        const updList = document.getElementById('update_subject_list');
        if (updList) updList.innerHTML = '';
        axios.get(`../../api/admin/employee.php?operation=getEmployeeSubjects&id=${id}`)
        .then(res => {
            const items = Array.isArray(res.data) ? res.data : [];
            items.forEach(s => addSubjectToList(String(s.subject_id), s.subject_name, 'update'));
        })
        .catch(err => console.error(err));

        // Load assigned programs for this employee and populate list
        const updProgList = document.getElementById('update_program_list');
        if (updProgList) updProgList.innerHTML = '';
        axios.get(`../../api/admin/employee.php?operation=getEmployeePrograms&id=${id}`)
        .then(res => {
            const items = Array.isArray(res.data) ? res.data : [];
            items.forEach(p => addProgramToList(String(p.program_id), p.name, 'update'));
        })
        .catch(err => console.error(err));
    const modal = new bootstrap.Modal(document.getElementById('viewEmployeeModal'));
    modal.show();
};

// Save New Employee
window.saveNewEmployee = function() {
    if (!canUseEmployeePermission('create')) {
        showEmployeePermissionAlert('You do not have permission to add employees.');
        return;
    }

    const data = {
        first_name: document.getElementById('add_first_name').value,
        middle_name: document.getElementById('add_middle_name').value,
        last_name: document.getElementById('add_last_name').value,
        birthday: document.getElementById('add_birthday').value,
        role: document.getElementById('add_role').value,
        username: document.getElementById('add_username').value,
        email: document.getElementById('add_email').value,
        password: document.getElementById('add_password').value,
        branch_id: normalizeEmployeeBranchValue(document.getElementById('add_branch').value)
    };

    // gather added subjects from list
    const addList = document.getElementById('add_subject_list');
    if (addList) {
        data.subjects = Array.from(addList.querySelectorAll('.subject-item')).map(el => el.dataset.id);
    }
    const addProgList = document.getElementById('add_program_list');
    if (addProgList) {
        data.programs = Array.from(addProgList.querySelectorAll('.program-item')).map(el => el.dataset.id);
    }
    if(!data.first_name || !data.last_name || !data.birthday || !data.role || !data.username || !data.email || !data.password) {
        Swal.fire('Error', 'Please fill in all required fields', 'error');
        return;
    }

    if (!validateEmailAddress(data.email)) {
        Swal.fire('Error', 'Please enter a valid email address', 'error');
        return;
    }

    axios.post("../../api/admin/employee.php", {
        operation: "signup",
        json: JSON.stringify(data)
    }).then(res => {
        if (res.data.status === 'success') {
            Swal.fire('Success', res.data.message, 'success');
            const modalEl = document.getElementById('addEmployeeModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            modal.hide();
            document.getElementById('addEmployeeForm').reset();
            loadEmployeesData();
        } else {
            Swal.fire('Error', res.data.message, 'error');
        }
    }).catch(err => {
        console.error(err);
        Swal.fire('Error', 'Something went wrong', 'error');
    });
};

// Update Existing Employee
window.saveUpdateEmployee = function() {
    if (!canUseEmployeePermission('edit')) {
        showEmployeePermissionAlert('You do not have permission to update employees.');
        return;
    }

    const data = {
        employee_id: document.getElementById('update_employee_id').value,
        first_name: document.getElementById('update_first_name').value,
        middle_name: document.getElementById('update_middle_name').value,
        last_name: document.getElementById('update_last_name').value,
        birthday: document.getElementById('update_birthday').value,
        role: document.getElementById('update_role').value,
        status: document.getElementById('update_status').value,
        branch_id: normalizeEmployeeBranchValue(document.getElementById('update_branch').value)
    };

    // gather added subjects from list
    const updList = document.getElementById('update_subject_list');
    if (updList) {
        data.subjects = Array.from(updList.querySelectorAll('.subject-item')).map(el => el.dataset.id);
    }
    const updProgList = document.getElementById('update_program_list');
    if (updProgList) {
        data.programs = Array.from(updProgList.querySelectorAll('.program-item')).map(el => el.dataset.id);
    }
    if(!data.first_name || !data.last_name || !data.birthday || !data.role || !data.status) {
        Swal.fire('Error', 'Please fill in all required fields', 'error');
        return;
    }

    axios.post("../../api/admin/employee.php", {
        operation: "updateEmployee",
        json: JSON.stringify(data)
    }).then(res => {
        if (res.data.status === 'success') {
            Swal.fire('Success', res.data.message, 'success');
            const modalEl = document.getElementById('viewEmployeeModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            modal.hide();
            loadEmployeesData();
        } else {
            Swal.fire('Error', res.data.message, 'error');
        }
    }).catch(err => {
        console.error(err);
        Swal.fire('Error', 'Something went wrong', 'error');
    });
};

// Create new subject and append to selects
window.employeeCreateSubject = function(context) {
    const inputId = context === 'update' ? 'update_new_subject_name' : 'add_new_subject_name';
    const input = document.getElementById(inputId);
    if (!input) return;
    const name = input.value.trim();
    if (!name) {
        alert('Please enter a subject name');
        return;
    }

    axios.post('../../api/admin/subject.php', {
        operation: 'addSubject',
        json: JSON.stringify({ subject_name: name })
    }).then(res => {
        const d = res.data;
        if (d.status === 'success') {
            const id = d.subject_id;
            const label = d.subject_name;
            addOptionToSelect('add_subject_select', id, label);
            addOptionToSelect('update_subject_select', id, label);

                // add to the visual list in the active context (avoid duplicate)
                const list = document.getElementById(context + '_subject_list');
                if (!list || !Array.from(list.querySelectorAll('.subject-item')).some(el => el.dataset.id == String(id))) {
                    addSubjectToList(String(id), label, context);
                }

            input.value = '';
            resetCreateGroup(context, 'subject', String(id));
        } else {
            alert(d.message || 'Failed to add subject');
        }
    }).catch(err => {
        console.error(err);
        alert('Error adding subject');
    });
};

// Add selected subject from select into the visual list
window.employeeAddSelectedSubject = function(context) {
    const selId = context === 'update' ? 'update_subject_select' : 'add_subject_select';
    const select = document.getElementById(selId);
    if (!select) return;
    const val = select.value;
    const txt = select.options[select.selectedIndex] ? select.options[select.selectedIndex].text : '';
    if (!val) { alert('Please select a subject'); return; }
    if (val === OTHER_OPTION_VALUE) {
        setCreateGroupVisibility(context, 'subject', true);
        return;
    }
    // avoid duplicates
    const list = document.getElementById(context + '_subject_list');
    if (list && Array.from(list.querySelectorAll('.subject-item')).some(el => el.dataset.id == val)) {
        return;
    }
    addSubjectToList(String(val), txt, context);
};

function addSubjectToList(id, name, context) {
    const list = document.getElementById(context + '_subject_list');
    if (!list) return;
    const item = document.createElement('span');
    item.className = 'badge bg-secondary me-1 subject-item';
    item.dataset.id = id;
    item.style.padding = '0.45rem 0.6rem';
    item.innerHTML = `${name} <button type="button" class="btn-close btn-close-white btn-sm ms-2" aria-label="Remove" style="vertical-align:middle;" onclick="employeeRemoveSubjectFromList(this)"></button>`;
    list.appendChild(item);
}

window.employeeRemoveSubjectFromList = function(btn) {
    const span = btn.closest('.subject-item');
    if (span) span.remove();
};

window.employeeAddSelectedProgram = function(context) {
    const selId = context === 'update' ? 'update_program_select' : 'add_program_select';
    const select = document.getElementById(selId);
    if (!select) return;
    const val = select.value;
    const txt = select.options[select.selectedIndex] ? select.options[select.selectedIndex].text : '';
    if (!val) { alert('Please select a program'); return; }
    if (val === OTHER_OPTION_VALUE) {
        setCreateGroupVisibility(context, 'program', true);
        return;
    }
    // avoid duplicates
    const list = document.getElementById(context + '_program_list');
    if (list && Array.from(list.querySelectorAll('.program-item')).some(el => el.dataset.id == val)) {
        return;
    }
    addProgramToList(String(val), txt, context);
};

window.employeeCreateProgram = function(context) {
    const inputId = context === 'update' ? 'update_new_program_name' : 'add_new_program_name';
    const input = document.getElementById(inputId);
    if (!input) return;
    const name = input.value.trim();
    if (!name) {
        alert('Please enter a program name');
        return;
    }

    axios.post('../../api/admin/employee.php', {
        operation: 'addProgram',
        json: JSON.stringify({ program_name: name })
    }).then(res => {
        const d = res.data;
        if (d.status === 'success') {
            const id = d.program_id;
            const label = d.name;
            addOptionToSelect('add_program_select', id, label);
            addOptionToSelect('update_program_select', id, label);

            // add to the visual list in the active context (avoid duplicate)
            const list = document.getElementById(context + '_program_list');
            if (!list || !Array.from(list.querySelectorAll('.program-item')).some(el => el.dataset.id == String(id))) {
                addProgramToList(String(id), label, context);
            }

            input.value = '';
            resetCreateGroup(context, 'program', String(id));
        } else {
            alert(d.message || 'Failed to add program');
        }
    }).catch(err => {
        console.error(err);
        alert('Error adding program');
    });
};

function addProgramToList(id, name, context) {
    const list = document.getElementById(context + '_program_list');
    if (!list) return;
    const item = document.createElement('span');
    item.className = 'badge bg-primary me-1 program-item';
    item.dataset.id = id;
    item.style.padding = '0.45rem 0.6rem';
    item.innerHTML = `${name} <button type="button" class="btn-close btn-close-white btn-sm ms-2" aria-label="Remove" style="vertical-align:middle;" onclick="employeeRemoveProgramFromList(this)"></button>`;
    list.appendChild(item);
}

window.employeeRemoveProgramFromList = function(btn) {
    const span = btn.closest('.program-item');
    if (span) span.remove();
};
