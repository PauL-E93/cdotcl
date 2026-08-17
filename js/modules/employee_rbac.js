import {
    RBAC_MODULES,
    ROLE_DISPLAY_ORDER,
    ROLE_META,
    canManageRbac,
    clearRbacRolePermissions,
    getResolvedRolePermissions,
    initRbacPermissions,
    normalizeRbacRoleKey,
    setRbacModulePermissions
} from '../utilities/rbac_navigation.js';

const MODULE_DETAIL_MAP = {
    enrollment: [
        { label: 'Add Enrollment', hint: 'Create new tutorial enrollment records.', permissionKey: 'create' },
        { label: 'Update Enrollment', hint: 'Modify enrollment records and details.', permissionKey: 'edit' },
        { label: 'Approve Enrollment', hint: 'Handle approval-related enrollment steps.', permissionKey: 'approve' },
        { label: 'Export Enrollment', hint: 'Export enrollment data and summaries.', permissionKey: 'export' }
    ],
    employee: [
        { label: 'Add Employee', hint: 'Create new employee accounts.', permissionKey: 'create' },
        { label: 'Edit Employee', hint: 'Update employee records and account details.', permissionKey: 'edit' },
        { label: 'Employee Schedule', hint: 'Manage staff schedules and assignments.', permissionKey: 'approve' },
        { label: 'Export Employees', hint: 'Export employee directory data.', permissionKey: 'export' },
        { label: 'Role Base Access Control', hint: 'Open and manage the dedicated RBAC page under the employee module.', permissionKey: 'manage_rbac' }
    ],
    schedule: [
        { label: 'Add Schedule', hint: 'Show the add schedule action where that page supports it.', permissionKey: 'create' }
    ],
    program: [
        { label: 'Add Program', hint: 'Create new program entries.', permissionKey: 'create' },
        { label: 'Edit Program', hint: 'Update program details and settings.', permissionKey: 'edit' },
        { label: 'Program Types', hint: 'Manage the program type catalog.', permissionKey: 'manage_types' },
        { label: 'Subjects', hint: 'Manage subject records used by programs.', permissionKey: 'manage_subjects' },
        { label: 'Services', hint: 'Manage optional services linked to programs.', permissionKey: 'manage_services' },
        { label: 'ECCD Checklist', hint: 'Manage checklist templates and report card setup.', permissionKey: 'manage_checklists' },
        { label: 'Discounts', hint: 'Manage discount records for programs.', permissionKey: 'manage_discounts' },
        { label: 'Registration Amounts', hint: 'Manage registration amount records.', permissionKey: 'manage_registration' }
    ],
    school_calendar: [
        { label: 'Manage Events', hint: 'Create and adjust school calendar entries.', permissionKey: 'edit' }
    ],
    payment: [
        { label: 'Add Payment Record', hint: 'Create or log payment records.', permissionKey: 'create' },
        { label: 'Edit Payment', hint: 'Update payment details and statuses.', permissionKey: 'edit' },
        { label: 'To Receive Payment Card', hint: 'Show the To Receive Payment card and allow approve / decline actions for pending payments.', permissionKey: 'approve' },
        { label: 'Export Payment Data', hint: 'Export payment reports and records.', permissionKey: 'export' }
    ],
    class: [
        { label: 'Create Class', hint: 'Add new class records.', permissionKey: 'create' },
        { label: 'Edit Class', hint: 'Update class records and schedules.', permissionKey: 'edit' },
        { label: 'Archive Class', hint: 'Archive class records when they are no longer active.', permissionKey: 'delete' },
        { label: 'Add Section', hint: 'Add section assignments within a class.', permissionKey: 'manage_sections' },
        { label: 'Edit Section', hint: 'Update section details and assignments.', permissionKey: 'edit_sections' },
        { label: 'Attendance', hint: 'Open and manage section attendance pages.', permissionKey: 'manage_attendance' },
        { label: 'Check Students', hint: 'Review enrolled students inside each section.', permissionKey: 'manage_students' },
        { label: 'Report Cards', hint: 'Open section report card tools and records.', permissionKey: 'manage_report_cards' }
    ],
    product: [
        { label: 'Add Product', hint: 'Create new product records and categories.', permissionKey: 'create' },
        { label: 'Edit Product', hint: 'Update product details and manage release actions.', permissionKey: 'edit' },
        { label: 'Release History', hint: 'Open product release history and reporting views.', permissionKey: 'export' }
    ],
    center: [
        { label: 'Add Center', hint: 'Create new center or branch records.', permissionKey: 'create' },
        { label: 'Edit Center', hint: 'Update center and branch details.', permissionKey: 'edit' },
        { label: 'Delete Center', hint: 'Remove center records that should no longer remain in the list.', permissionKey: 'delete' }
    ],
    session: [
        { label: 'Create Session', hint: 'Reserve space for future session scheduling tools.', permissionKey: 'create' },
        { label: 'Edit Session', hint: 'Update session status and tutorial progress actions.', permissionKey: 'edit' }
    ]
};

const rbacState = {
    employees: [],
    roles: [],
    roleSearch: '',
    selectedRole: '',
    permissionsByRole: {},
    expandedModules: {}
};

function isLegacyEmployeeRbacPage() {
    return !window.location.pathname.includes('role_base.html');
}

function normalizeRoleKey(value) {
    return normalizeRbacRoleKey(value);
}

function formatRoleLabel(value) {
    return String(value || '')
        .split(' ')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ') || 'Unknown Role';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDateValue(value) {
    if (!value) return 'N/A';
    return String(value).split(/[ T]/)[0];
}

function formatDateTimeValue(value) {
    return value ? String(value) : 'N/A';
}

function getEmployeeDisplayName(user) {
    return `${user.first_name || ''} ${user.middle_name ? `${user.middle_name} ` : ''}${user.last_name || ''}`.trim() || user.username || 'N/A';
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

function getCurrentViewerEmployeePermissions() {
    const raw = localStorage.getItem('user');
    if (!raw) {
        return {
            view: false,
            edit: false
        };
    }

    try {
        const user = JSON.parse(raw);
        const permissions = getResolvedRolePermissions(normalizeRoleKey(user?.role_name)).employee || {};
        return {
            view: Boolean(permissions.view),
            edit: Boolean(permissions.edit)
        };
    } catch (error) {
        console.error('Error reading current viewer employee permissions for RBAC list:', error);
        return {
            view: false,
            edit: false
        };
    }
}

function buildAssignedUserActionCell(user) {
    const permissions = getCurrentViewerEmployeePermissions();
    const actionItems = [];

    if (permissions.view && typeof window.openEmployeeDetailsModal === 'function') {
        actionItems.push(`
            <li>
                <button class="dropdown-item" type="button" onclick="openEmployeeDetailsModal(${Number(user.employee_id)})">
                    <i class="bi bi-eye me-2"></i>View
                </button>
            </li>
        `);
    }

    if (permissions.edit && typeof window.openViewEmployeeModal === 'function') {
        actionItems.push(`
            <li>
                <button class="dropdown-item" type="button" onclick="openViewEmployeeModal(${Number(user.employee_id)})">
                    <i class="bi bi-pencil me-2"></i>Edit
                </button>
            </li>
        `);
    }

    if (permissions.edit && typeof window.openScheduleModal === 'function') {
        actionItems.push(`
            <li>
                <button class="dropdown-item" type="button" onclick="openScheduleModal(${Number(user.employee_id)})">
                    <i class="bi bi-calendar-week me-2"></i>Schedule
                </button>
            </li>
        `);
    }

    if (!actionItems.length) {
        return '<span class="text-muted">No actions</span>';
    }

    return `
        <div class="dropdown">
            <button class="btn btn-sm btn-link text-secondary p-0" type="button" data-bs-toggle="dropdown" aria-expanded="false" title="Actions">
                <i class="bi bi-three-dots-vertical fs-5"></i>
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
                ${actionItems.join('')}
            </ul>
        </div>
    `;
}

function getRoleMeta(roleKey) {
    const normalized = normalizeRoleKey(roleKey);
    return ROLE_META[normalized] || {
        label: formatRoleLabel(normalized),
        description: `${formatRoleLabel(normalized)} access profile.`,
        icon: 'bi-person-badge',
        tone: 'slate'
    };
}

function ensurePermissionMatrix(roleKey) {
    const normalized = normalizeRoleKey(roleKey);
    if (!normalized) return getResolvedRolePermissions('');

    if (!rbacState.permissionsByRole[normalized]) {
        rbacState.permissionsByRole[normalized] = getResolvedRolePermissions(normalized);
    }

    return rbacState.permissionsByRole[normalized];
}

function getEmployeesByRole(roleKey) {
    const normalized = normalizeRoleKey(roleKey);
    return rbacState.employees.filter(employee => normalizeRoleKey(employee.role_name) === normalized);
}

function countRestrictedModules(roleKey) {
    const matrix = ensurePermissionMatrix(roleKey);
    return RBAC_MODULES.filter(module => !matrix[module.key]?.view).length;
}

function countVisibleModules(roleKey) {
    const matrix = ensurePermissionMatrix(roleKey);
    return RBAC_MODULES.filter(module => matrix[module.key]?.view).length;
}

function getRoleStatus(roleKey) {
    return countVisibleModules(roleKey) >= 5 ? 'Active' : 'Limited';
}

function getFilteredRoles() {
    const search = rbacState.roleSearch;
    return rbacState.roles.filter(roleKey => {
        const meta = getRoleMeta(roleKey);
        const haystack = `${roleKey} ${meta.label} ${meta.description}`.toLowerCase();
        return !search || haystack.includes(search);
    });
}

function setTopSummaryMetric(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
}

function updateSummaryCards() {
    const activeUsers = rbacState.employees.filter(employee => normalizeRoleKey(employee.status) === 'active').length;
    const inactiveUsers = rbacState.employees.filter(employee => normalizeRoleKey(employee.status) === 'inactive').length;
    const selectedRole = rbacState.selectedRole;

    setTopSummaryMetric('rbac-total-roles', rbacState.roles.length);
    setTopSummaryMetric('rbac-active-users', activeUsers);
    setTopSummaryMetric('rbac-restricted-modules', selectedRole ? countRestrictedModules(selectedRole) : 0);
    setTopSummaryMetric('rbac-inactive-users', inactiveUsers);
}

function renderRoleList() {
    const container = document.getElementById('rbac-role-list');
    const count = document.getElementById('rbac-role-count');
    if (!container) return;

    const roles = getFilteredRoles();
    if (count) {
        count.textContent = `${roles.length} of ${rbacState.roles.length} role${rbacState.roles.length === 1 ? '' : 's'}`;
    }

    if (!roles.length) {
        container.innerHTML = '<div class="employee-rbac-empty-state">No roles match your search.</div>';
        return;
    }

    container.innerHTML = roles.map(roleKey => {
        const meta = getRoleMeta(roleKey);
        const roleEmployees = getEmployeesByRole(roleKey);
        const isActive = roleKey === rbacState.selectedRole;
        return `
            <button
                type="button"
                class="employee-rbac-role-item ${isActive ? 'is-active' : ''}"
                data-role-key="${escapeHtml(roleKey)}"
                aria-pressed="${isActive ? 'true' : 'false'}"
            >
                <span class="employee-rbac-role-item-icon ${escapeHtml(meta.tone)}">
                    <i class="bi ${escapeHtml(meta.icon)}"></i>
                </span>
                <span class="employee-rbac-role-item-copy">
                    <strong>${escapeHtml(meta.label)}</strong>
                    <small>${escapeHtml(meta.description)}</small>
                    <span class="employee-rbac-role-item-meta">${roleEmployees.length} user${roleEmployees.length === 1 ? '' : 's'}</span>
                </span>
                <span class="employee-rbac-status-pill ${getRoleStatus(roleKey) === 'Active' ? 'active' : 'limited'}">${getRoleStatus(roleKey)}</span>
            </button>
        `;
    }).join('');
}

function renderSelectedRoleHeader() {
    const name = document.getElementById('rbac-selected-role-name');
    const description = document.getElementById('rbac-selected-role-description');
    const status = document.getElementById('rbac-selected-role-status');
    const summary = document.getElementById('rbac-permission-summary');
    const icon = document.querySelector('.employee-rbac-selected-icon i');

    if (!name || !description || !status || !summary) return;

    if (!rbacState.selectedRole) {
        name.textContent = 'Select a role';
        description.textContent = 'Choose a role to inspect its module permissions.';
        status.textContent = 'Inactive';
        status.className = 'employee-rbac-status-pill';
        summary.textContent = '0 modules enabled';
        if (icon) icon.className = 'bi bi-shield-check';
        return;
    }

    const meta = getRoleMeta(rbacState.selectedRole);
    const visibleModules = countVisibleModules(rbacState.selectedRole);
    const currentStatus = getRoleStatus(rbacState.selectedRole);

    name.textContent = meta.label;
    description.textContent = meta.description;
    status.textContent = currentStatus;
    status.className = `employee-rbac-status-pill ${currentStatus === 'Active' ? 'active' : 'limited'}`;
    summary.textContent = `${visibleModules} of ${RBAC_MODULES.length} modules enabled`;
    if (icon) icon.className = `bi ${meta.icon}`;
}

function renderPermissionTree() {
    const container = document.getElementById('rbac-permission-tree');
    if (!container) return;

    if (!rbacState.selectedRole) {
        container.innerHTML = '<div class="employee-rbac-empty-state">No role selected.</div>';
        return;
    }

    const matrix = ensurePermissionMatrix(rbacState.selectedRole);

    container.innerHTML = RBAC_MODULES.map(module => {
        const expanded = Boolean(rbacState.expandedModules[module.key]);
        const enabled = Boolean(matrix[module.key]?.view);
        const details = [
            {
                label: `View ${module.label}`,
                hint: 'Show this module in navigation and allow the selected role to open it.',
                permissionKey: 'view'
            },
            ...(MODULE_DETAIL_MAP[module.key] || [])
        ];

        return `
            <article class="employee-rbac-module-group ${expanded ? 'is-expanded' : ''}">
                <button
                    type="button"
                    class="employee-rbac-module-toggle"
                    data-module-toggle="${module.key}"
                    aria-expanded="${expanded ? 'true' : 'false'}"
                >
                    <span class="employee-rbac-module-toggle-main">
                        <span class="employee-rbac-module-icon"><i class="bi ${module.icon}"></i></span>
                        <span class="employee-rbac-module-toggle-copy">
                            <strong>${escapeHtml(module.label)}</strong>
                            <small>${details.length} related page${details.length === 1 ? '' : 's'}</small>
                        </span>
                    </span>
                    <span class="employee-rbac-module-toggle-side">
                        <span class="employee-rbac-status-pill ${enabled ? 'active' : 'limited'}">${enabled ? 'Enabled' : 'Hidden'}</span>
                        <i class="bi bi-chevron-down employee-rbac-module-chevron"></i>
                    </span>
                </button>
                <div class="employee-rbac-module-panel">
                    <div class="employee-rbac-submodule-list">
                        ${details.map(detail => `
                            <div class="employee-rbac-submodule-item">
                                <div class="employee-rbac-submodule-copy-wrap">
                                    <span class="employee-rbac-submodule-bullet"></span>
                                    <div class="employee-rbac-submodule-copy">
                                        <strong>${escapeHtml(detail.label)}</strong>
                                        <small>${escapeHtml(detail.hint)}</small>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    class="employee-rbac-cell ${matrix[module.key]?.[detail.permissionKey] ? 'is-allowed' : 'is-denied'}"
                                    data-module-key="${module.key}"
                                    data-action-key="${detail.permissionKey}"
                                    aria-pressed="${matrix[module.key]?.[detail.permissionKey] ? 'true' : 'false'}"
                                    title="${matrix[module.key]?.[detail.permissionKey] ? 'Enabled' : 'Disabled'}"
                                >
                                    <i class="bi ${matrix[module.key]?.[detail.permissionKey] ? 'bi-check-lg' : 'bi-dash-lg'}"></i>
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </article>
        `;
    }).join('');
}

function renderAssignedUsers() {
    const body = document.getElementById('rbac-assigned-users-body');
    const count = document.getElementById('rbac-assigned-users-count');
    if (!body) return;

    const users = rbacState.selectedRole ? getEmployeesByRole(rbacState.selectedRole) : [];
    if (count) {
        count.textContent = `${users.length} user${users.length === 1 ? '' : 's'}`;
    }

    if (!users.length) {
        body.innerHTML = '<tr><td colspan="10" class="text-center text-muted py-4">No employees are assigned to this role.</td></tr>';
        return;
    }

    body.innerHTML = users.map(user => `
        <tr>
            <td data-label="Employee Name">${escapeHtml(getEmployeeDisplayName(user))}</td>
            <td data-label="Birthday">${escapeHtml(formatDateValue(user.birthday))}</td>
            <td data-label="Username">${escapeHtml(user.username || 'N/A')}</td>
            <td data-label="Role">${escapeHtml(formatRoleLabel(user.role_name || ''))}</td>
            <td data-label="Status"><span class="badge ${getStatusBadgeClass(normalizeRoleKey(user.status))}">${escapeHtml(formatStatusLabel(normalizeRoleKey(user.status)))}</span></td>
            <td data-label="Branch">${escapeHtml(user.branch_name || 'N/A')}</td>
            <td data-label="Subjects">${escapeHtml(user.subjects || 'N/A')}</td>
            <td data-label="Program">${escapeHtml(user.programs || 'N/A')}</td>
            <td data-label="Date Created">${escapeHtml(formatDateTimeValue(user.date_created))}</td>
            <td class="text-center" data-label="Actions">${buildAssignedUserActionCell(user)}</td>
        </tr>
    `).join('');
}

function renderNavigationPreview() {
    const container = document.getElementById('rbac-navigation-preview');
    const count = document.getElementById('rbac-navigation-preview-count');
    if (!container) return;

    if (!rbacState.selectedRole) {
        if (count) count.textContent = '0 items';
        container.innerHTML = '<div class="employee-rbac-empty-state">Select a role to preview its navigation.</div>';
        return;
    }

    const matrix = ensurePermissionMatrix(rbacState.selectedRole);
    const visibleModules = RBAC_MODULES.filter(module => matrix[module.key]?.view);

    if (count) {
        count.textContent = `${visibleModules.length} item${visibleModules.length === 1 ? '' : 's'}`;
    }

    if (!visibleModules.length) {
        container.innerHTML = '<div class="employee-rbac-empty-state">No RBAC-controlled modules are currently visible for this role.</div>';
        return;
    }

    container.innerHTML = visibleModules.map(module => `
        <div class="employee-rbac-preview-item">
            <span class="employee-rbac-module-icon"><i class="bi ${module.icon}"></i></span>
            <div class="employee-rbac-preview-copy">
                <strong>${escapeHtml(module.label)}</strong>
                <small>Visible in sidebar</small>
            </div>
        </div>
    `).join('');
}

function renderRbac() {
    if (!isLegacyEmployeeRbacPage() || !document.getElementById('rbac-role-list')) return;
    updateSummaryCards();
    renderRoleList();
    renderSelectedRoleHeader();
    renderPermissionTree();
    renderAssignedUsers();
    renderNavigationPreview();
}

function syncRoleCatalog() {
    const knownRoles = new Set(rbacState.roles);
    rbacState.employees.forEach(employee => {
        const roleKey = normalizeRoleKey(employee.role_name);
        if (roleKey) knownRoles.add(roleKey);
    });

    const orderedRoles = [...knownRoles].sort((left, right) => {
        const leftPriority = ROLE_DISPLAY_ORDER.indexOf(left);
        const rightPriority = ROLE_DISPLAY_ORDER.indexOf(right);

        if (leftPriority !== -1 || rightPriority !== -1) {
            if (leftPriority === -1) return 1;
            if (rightPriority === -1) return -1;
            return leftPriority - rightPriority;
        }

        return left.localeCompare(right);
    });

    rbacState.roles = orderedRoles;

    if (!orderedRoles.includes(rbacState.selectedRole)) {
        rbacState.selectedRole = orderedRoles[0] || '';
    }

    orderedRoles.forEach(roleKey => ensurePermissionMatrix(roleKey));
}

function fetchRoles() {
    if (typeof axios === 'undefined') {
        syncRoleCatalog();
        renderRbac();
        return;
    }

    axios.get('../../api/admin/employee.php?operation=getRoles')
        .then(response => {
            const roles = Array.isArray(response.data) ? response.data : [];
            rbacState.roles = roles
                .map(role => normalizeRoleKey(role.role_name))
                .filter(Boolean);
            syncRoleCatalog();
            renderRbac();
        })
        .catch(error => {
            console.error('Error loading RBAC roles:', error);
            syncRoleCatalog();
            renderRbac();
        });
}

function handleRoleListClick(event) {
    const button = event.target.closest('[data-role-key]');
    if (!button) return;

    rbacState.selectedRole = normalizeRoleKey(button.getAttribute('data-role-key'));
    renderRbac();
}

async function handlePermissionToggle(event) {
    const button = event.target.closest('[data-module-key][data-action-key]');
    if (!button || !rbacState.selectedRole) return;

    const moduleKey = button.getAttribute('data-module-key');
    const actionKey = button.getAttribute('data-action-key');
    const matrix = ensurePermissionMatrix(rbacState.selectedRole);
    const nextValue = !matrix[moduleKey][actionKey];
    const previousValue = matrix[moduleKey][actionKey];
    const previousView = matrix[moduleKey].view;

    matrix[moduleKey][actionKey] = nextValue;

    try {
        if (actionKey === 'view') {
            await setRbacModulePermissions(rbacState.selectedRole, moduleKey, { view: nextValue });
        } else if (nextValue && !matrix[moduleKey].view) {
            matrix[moduleKey].view = true;
            await setRbacModulePermissions(rbacState.selectedRole, moduleKey, {
                view: true,
                [actionKey]: nextValue
            });
        } else {
            await setRbacModulePermissions(rbacState.selectedRole, moduleKey, { [actionKey]: nextValue });
        }
    } catch (error) {
        console.error('Error saving RBAC permission:', error);
        matrix[moduleKey][actionKey] = previousValue;
        matrix[moduleKey].view = previousView;
    }

    renderRbac();
}

function handleModuleToggle(event) {
    const button = event.target.closest('[data-module-toggle]');
    if (!button) return;

    const moduleKey = button.getAttribute('data-module-toggle');
    rbacState.expandedModules[moduleKey] = !rbacState.expandedModules[moduleKey];
    renderPermissionTree();
}

async function resetSelectedRolePreset() {
    if (!rbacState.selectedRole) return;
    try {
        await clearRbacRolePermissions(rbacState.selectedRole);
        rbacState.permissionsByRole[rbacState.selectedRole] = getResolvedRolePermissions(rbacState.selectedRole);
    } catch (error) {
        console.error('Error resetting RBAC role permissions:', error);
    }
    renderRbac();
}

function bindRbacEvents() {
    const roleSearch = document.getElementById('rbac-role-search');
    const roleList = document.getElementById('rbac-role-list');
    const permissionTree = document.getElementById('rbac-permission-tree');
    const resetButton = document.getElementById('rbac-reset-selected-role');
    const addUserButton = document.getElementById('rbac-add-user-shortcut');

    roleSearch?.addEventListener('input', event => {
        rbacState.roleSearch = String(event.target.value || '').trim().toLowerCase();
        renderRoleList();
    });

    roleList?.addEventListener('click', handleRoleListClick);
    permissionTree?.addEventListener('click', event => {
        if (event.target.closest('[data-module-key][data-action-key]')) {
            handlePermissionToggle(event);
            return;
        }

        handleModuleToggle(event);
    });
    resetButton?.addEventListener('click', resetSelectedRolePreset);
    addUserButton?.addEventListener('click', () => {
        if (typeof window.openAddEmployeeModal === 'function') {
            window.openAddEmployeeModal();
        }
    });
}

function initEmployeeRbac() {
    if (!isLegacyEmployeeRbacPage() || !document.getElementById('rbac-role-list')) return;
    const userData = localStorage.getItem('user');
    let currentUserRole = '';

    if (userData) {
        try {
            currentUserRole = normalizeRoleKey(JSON.parse(userData).role_name);
        } catch (error) {
            console.error('Error reading current user role for RBAC:', error);
        }
    }

    if (!canManageRbac(currentUserRole)) {
        const rbacSection = document.querySelector('.employee-rbac-card');
        if (rbacSection) rbacSection.classList.add('d-none');
        return;
    }

    bindRbacEvents();
    initRbacPermissions()
        .then(() => {
            syncRoleCatalog();
            renderRbac();
            fetchRoles();
        })
        .catch(error => {
            console.error('Error initializing RBAC page:', error);
            syncRoleCatalog();
            renderRbac();
            fetchRoles();
        });
}

document.addEventListener('employee-data-updated', event => {
    if (!isLegacyEmployeeRbacPage()) return;
    const employees = Array.isArray(event.detail?.employees) ? event.detail.employees : [];
    rbacState.employees = employees;
    syncRoleCatalog();
    renderRbac();
});

document.addEventListener('DOMContentLoaded', initEmployeeRbac);
