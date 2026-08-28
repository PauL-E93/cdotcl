import {
    RBAC_MODULES,
    ROLE_DISPLAY_ORDER,
    ROLE_META,
    getResolvedRolePermissions,
    normalizeRbacRoleKey,
    setRbacModulePermissions
} from '../utilities/rbac_navigation.js';
import { initializeEmployeeModuleSupport, loadEmployeesData } from './employee.js';

const MODULE_DETAIL_MAP = {
    enrollment: [
        { label: 'Add Enrollment', hint: 'Create new tutorial enrollment records.', permissionKey: 'create' },
        { label: 'Update Enrollment', hint: 'Modify enrollment records and details.', permissionKey: 'edit' },
        { label: 'Approve Enrollment', hint: 'Handle approval-related enrollment steps.', permissionKey: 'approve' },
        { label: 'Export Enrollment', hint: 'Export enrollment data and summaries.', permissionKey: 'export' }
    ],
    student_management: [
        { label: 'Edit Student Profiles', hint: 'Update student, guardian, address, and account information.', permissionKey: 'edit' },
        { label: 'Export Student Directory', hint: 'Export the filtered student directory to PDF, Excel, or CSV.', permissionKey: 'export' }
    ],
    employee: [
        { label: 'Add Employee', hint: 'Create new employee accounts.', permissionKey: 'create' },
        { label: 'Edit Employee', hint: 'Update employee records and account details.', permissionKey: 'edit' },
        { label: 'Employee Schedule', hint: 'Manage staff schedules and assignments.', permissionKey: 'approve' },
        { label: 'Export Employees', hint: 'Export employee directory data.', permissionKey: 'export' },
        { label: 'Modules', hint: 'Open and manage the dedicated Modules page under the employee module.', permissionKey: 'manage_rbac' }
    ],
    schedule: [
        { label: 'Add Schedule', hint: 'Show the add schedule action where that page supports it.', permissionKey: 'create' }
    ],
    program: [],
    school_calendar: [
        { label: 'Manage Events', hint: 'Create and adjust school calendar entries.', permissionKey: 'edit' }
    ],
    payment: [
        { label: 'Add Payment Record', hint: 'Create or log payment records.', permissionKey: 'create' },
        { label: 'Edit Payment', hint: 'Update payment details and statuses.', permissionKey: 'edit' },
        { label: 'To Receive Payment Card', hint: 'Show the To Receive Payment card and allow approve / decline actions for pending payments.', permissionKey: 'approve' },
        { label: 'View Assessment', hint: 'Open billing assessments from tutorial and pre-play payment records.', permissionKey: 'view_assessment' },
        { label: 'Manage Assessment', hint: 'Change discounts, optional services, and additional product charges in billing assessments.', permissionKey: 'manage_assessment' },
        { label: 'Export Payment Data', hint: 'Export payment reports and records.', permissionKey: 'export' }
    ],
    class: [
        { label: 'Add Class', hint: 'Show the Add Class action on the dedicated Class page.', permissionKey: 'create' },
        { label: 'Edit Class', hint: 'Update class records from the dedicated Class page.', permissionKey: 'edit' },
        { label: 'Archive Class', hint: 'Archive class records when they are no longer active.', permissionKey: 'delete' },
        { label: 'Add Section', hint: 'Add a section for the selected class.', permissionKey: 'manage_sections' },
        { label: 'Edit Section', hint: 'Show Edit Section in the selected section action menu.', permissionKey: 'edit_sections' },
        { label: 'Section Attendance', hint: 'Show and open the Attendance tab for a selected section.', permissionKey: 'manage_attendance' },
        { label: 'Section Students and Profiles', hint: 'Show enrolled students, student search, and profile details for a selected section.', permissionKey: 'manage_students' },
        { label: 'Section Grades and Report Cards', hint: 'Show grades and open section report-card records.', permissionKey: 'manage_report_cards' },
        { label: 'Export Section Data', hint: 'Export the currently displayed section table.', permissionKey: 'export' }
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

const MODULE_VIEW_DETAIL_MAP = {
    class: {
        label: 'Search Classes and Sections',
        hint: 'Show the Class module and allow use of the new class and section selectors.'
    }
};

const MODULE_PERMISSION_DEPENDENCIES = {
    payment: {
        manage_assessment: ['view_assessment']
    }
};

const PROGRAM_FEATURE_DETAIL_MAP = [
    {
        key: 'programs',
        label: 'Program List',
        hint: 'Program records, tuition, schedules, discounts, and services.',
        icon: 'bi-journal-text',
        actions: [
            { label: 'View', hint: 'Show the Program List card.', permissionKey: 'view_programs' },
            { label: 'Add', hint: 'Add new program records.', permissionKey: 'create' },
            { label: 'Edit', hint: 'Update program records.', permissionKey: 'edit' }
        ]
    },
    {
        key: 'types', label: 'Program Types', hint: 'Program type catalog.', icon: 'bi-tags',
        actions: [
            { label: 'View', hint: 'Show the Program Types card.', permissionKey: 'view_types' },
            { label: 'Add', hint: 'Add program types.', permissionKey: 'create_types' },
            { label: 'Edit', hint: 'Edit program types.', permissionKey: 'edit_types' }
        ]
    },
    {
        key: 'grades', label: 'Grade Levels', hint: 'Grade choices available during enrollment.', icon: 'bi-mortarboard',
        actions: [
            { label: 'View', hint: 'Show the Grade Levels card.', permissionKey: 'view_grades' },
            { label: 'Add', hint: 'Add grade levels.', permissionKey: 'create_grades' },
            { label: 'Edit', hint: 'Rename grades and control enrollment availability.', permissionKey: 'edit_grades' }
        ]
    },
    {
        key: 'subjects', label: 'Subjects', hint: 'Subjects used by programs.', icon: 'bi-book',
        actions: [
            { label: 'View', hint: 'Show the Subjects card.', permissionKey: 'view_subjects' },
            { label: 'Add', hint: 'Add subjects.', permissionKey: 'create_subjects' },
            { label: 'Edit', hint: 'Edit subjects.', permissionKey: 'edit_subjects' }
        ]
    },
    {
        key: 'services', label: 'Services', hint: 'Optional services linked to programs.', icon: 'bi-bag-check',
        actions: [
            { label: 'View', hint: 'Show the Services card.', permissionKey: 'view_services' },
            { label: 'Add', hint: 'Add services.', permissionKey: 'create_services' },
            { label: 'Edit', hint: 'Edit services.', permissionKey: 'edit_services' }
        ]
    },
    {
        key: 'checklists', label: 'ECCD Checklist', hint: 'Checklist cards, domains, and transmutation setup.', icon: 'bi-clipboard2-check',
        actions: [
            { label: 'View', hint: 'Show the ECCD Checklist card.', permissionKey: 'view_checklists' },
            { label: 'Edit', hint: 'Manage ECCD checklist configuration.', permissionKey: 'edit_checklists' }
        ]
    },
    {
        key: 'discounts', label: 'Discounts', hint: 'Program discount records.', icon: 'bi-percent',
        actions: [
            { label: 'View', hint: 'Show the Discounts card.', permissionKey: 'view_discounts' },
            { label: 'Add', hint: 'Add discounts.', permissionKey: 'create_discounts' },
            { label: 'Edit', hint: 'Edit discounts.', permissionKey: 'edit_discounts' }
        ]
    },
    {
        key: 'registration', label: 'Registration Amounts', hint: 'Registration fee records.', icon: 'bi-cash-stack',
        actions: [
            { label: 'View', hint: 'Show the Registration Amounts card.', permissionKey: 'view_registration' },
            { label: 'Add', hint: 'Add registration amounts.', permissionKey: 'create_registration' },
            { label: 'Edit', hint: 'Edit registration amounts.', permissionKey: 'edit_registration' }
        ]
    },
    {
        key: 'landing', label: 'Landing Page Content', hint: 'Public announcements and tutorial-center content.', icon: 'bi-window',
        actions: [
            { label: 'View', hint: 'Show the Landing Page Content card.', permissionKey: 'view_landing' },
            { label: 'Edit', hint: 'Update public landing-page content.', permissionKey: 'edit_landing' }
        ]
    }
];

const rbacState = {
    employees: [],
    roles: [],
    roleSearch: '',
    selectedRole: '',
    permissionsByRole: {},
    expandedModules: {},
    expandedProgramFeatures: {},
    isSavingBulkPermissions: false,
    bulkSavingModuleKey: ''
};

function isRoleBasePage() {
    return window.location.pathname.includes('role_base.html');
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

function renderPermissionRow(detail, matrix, fallbackModuleKey) {
    const moduleKey = detail.moduleKey || fallbackModuleKey;
    const allowed = Boolean(matrix[moduleKey]?.[detail.permissionKey]);

    return `
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
                class="employee-rbac-cell ${allowed ? 'is-allowed' : 'is-denied'}"
                data-module-key="${moduleKey}"
                data-action-key="${detail.permissionKey}"
                aria-pressed="${allowed ? 'true' : 'false'}"
                title="${allowed ? 'Enabled' : 'Disabled'}"
                ${rbacState.isSavingBulkPermissions ? 'disabled' : ''}
            >
                <i class="bi ${allowed ? 'bi-check-lg' : 'bi-dash-lg'}"></i>
            </button>
        </div>`;
}

function getDisplayedPermissionKeys(moduleKey) {
    const permissionKeys = ['view'];

    if (moduleKey === 'program') {
        PROGRAM_FEATURE_DETAIL_MAP.forEach(feature => {
            feature.actions.forEach(action => {
                if ((action.moduleKey || 'program') === moduleKey) {
                    permissionKeys.push(action.permissionKey);
                }
            });
        });
    } else {
        (MODULE_DETAIL_MAP[moduleKey] || []).forEach(detail => {
            if ((detail.moduleKey || moduleKey) === moduleKey) {
                permissionKeys.push(detail.permissionKey);
            }
        });
    }

    return [...new Set(permissionKeys)];
}

function hasAllDisplayedPermissions(matrix, moduleKey) {
    return getDisplayedPermissionKeys(moduleKey)
        .every(permissionKey => Boolean(matrix[moduleKey]?.[permissionKey]));
}

function renderProgramFeatureTree(matrix) {
    const moduleAccess = renderPermissionRow({
        label: 'Open Program Module',
        hint: 'Show Program in navigation and allow the selected role to open the page.',
        permissionKey: 'view'
    }, matrix, 'program');

    const featureCards = PROGRAM_FEATURE_DETAIL_MAP.map(feature => {
        const expanded = Boolean(rbacState.expandedProgramFeatures[feature.key]);
        const enabledActions = feature.actions.filter(action => {
            const moduleKey = action.moduleKey || 'program';
            return Boolean(matrix[moduleKey]?.[action.permissionKey]);
        }).length;

        return `
            <article class="employee-rbac-feature-group ${expanded ? 'is-expanded' : ''}">
                <button type="button" class="employee-rbac-feature-toggle" data-program-feature-toggle="${feature.key}" aria-expanded="${expanded ? 'true' : 'false'}">
                    <span class="employee-rbac-feature-main">
                        <span class="employee-rbac-feature-icon"><i class="bi ${feature.icon}"></i></span>
                        <span class="employee-rbac-feature-copy">
                            <strong>${escapeHtml(feature.label)}</strong>
                            <small>${escapeHtml(feature.hint)}</small>
                        </span>
                    </span>
                    <span class="employee-rbac-feature-side">
                        <small>${enabledActions}/${feature.actions.length} enabled for ${escapeHtml(formatRoleLabel(rbacState.selectedRole))}</small>
                        <i class="bi bi-chevron-down employee-rbac-feature-chevron"></i>
                    </span>
                </button>
                <div class="employee-rbac-feature-panel">
                    ${feature.actions.map(action => renderPermissionRow(action, matrix, 'program')).join('')}
                </div>
            </article>`;
    }).join('');

    return `<div class="employee-rbac-submodule-list">${moduleAccess}<div class="employee-rbac-feature-list">${featureCards}</div></div>`;
}

function renderPermissionTree() {
    const container = document.getElementById('rbac-permission-tree');
    if (!container) return;

    if (!rbacState.selectedRole) {
        container.innerHTML = '<div class="employee-rbac-empty-state">No role selected.</div>';
        return;
    }

    const matrix = ensurePermissionMatrix(rbacState.selectedRole);

    const moduleGroups = RBAC_MODULES.map(module => {
        const expanded = Boolean(rbacState.expandedModules[module.key]);
        const enabled = Boolean(matrix[module.key]?.view);
        const allModulePermissionsSelected = hasAllDisplayedPermissions(matrix, module.key);
        const isSavingThisModule = rbacState.bulkSavingModuleKey === module.key;
        const viewDetail = MODULE_VIEW_DETAIL_MAP[module.key] || {
            label: `View ${module.label}`,
            hint: 'Show this module in navigation and allow the selected role to open it.'
        };
        const details = [
            {
                ...viewDetail,
                permissionKey: 'view'
            },
            ...(MODULE_DETAIL_MAP[module.key] || [])
        ];
        const detailCount = module.key === 'program' ? PROGRAM_FEATURE_DETAIL_MAP.length : details.length;
        const panelContent = module.key === 'program'
            ? renderProgramFeatureTree(matrix)
            : `<div class="employee-rbac-submodule-list">${details.map(detail => renderPermissionRow(detail, matrix, module.key)).join('')}</div>`;

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
                            <small>${detailCount} related ${module.key === 'program' ? 'card' : 'page'}${detailCount === 1 ? '' : 's'}</small>
                        </span>
                    </span>
                    <span class="employee-rbac-module-toggle-side">
                        <span class="employee-rbac-status-pill ${enabled ? 'active' : 'limited'}">${enabled ? 'Enabled' : 'Hidden'}</span>
                        <i class="bi bi-chevron-down employee-rbac-module-chevron"></i>
                    </span>
                </button>
                <div class="employee-rbac-module-panel">
                    <div class="employee-rbac-module-bulk-actions">
                        <button
                            type="button"
                            class="employee-rbac-bulk-button"
                            data-select-all-module="${module.key}"
                            ${allModulePermissionsSelected || rbacState.isSavingBulkPermissions ? 'disabled' : ''}
                        >
                            ${isSavingThisModule
                                ? '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span><span>Saving...</span>'
                                : `<i class="bi ${allModulePermissionsSelected ? 'bi-check2' : 'bi-check2-all'}"></i><span>${allModulePermissionsSelected ? 'All selected' : 'Select all'}</span>`}
                        </button>
                    </div>
                    ${panelContent}
                </div>
            </article>
        `;
    }).join('');

    container.innerHTML = moduleGroups;
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
        container.innerHTML = '<div class="employee-rbac-empty-state">No configured modules are currently visible for this role.</div>';
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
    if (!document.getElementById('rbac-role-list')) return;
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
    if (!button || !rbacState.selectedRole || rbacState.isSavingBulkPermissions) return;

    const moduleKey = button.getAttribute('data-module-key');
    const actionKey = button.getAttribute('data-action-key');
    const matrix = ensurePermissionMatrix(rbacState.selectedRole);
    const nextValue = !matrix[moduleKey][actionKey];
    const previousModulePermissions = { ...matrix[moduleKey] };
    const updates = { [actionKey]: nextValue };

    matrix[moduleKey][actionKey] = nextValue;

    const programFeatureKey = button.closest('.employee-rbac-feature-group')
        ?.querySelector('[data-program-feature-toggle]')
        ?.getAttribute('data-program-feature-toggle');
    const selectedProgramFeature = PROGRAM_FEATURE_DETAIL_MAP.find(feature => feature.key === programFeatureKey);
    const featureViewAction = selectedProgramFeature?.actions.find(action =>
        (action.moduleKey || 'program') === moduleKey && (action.permissionKey === 'view' || action.permissionKey.startsWith('view_'))
    );
    if (nextValue && actionKey !== 'view' && !matrix[moduleKey].view) {
        matrix[moduleKey].view = true;
        updates.view = true;
    }

    if (nextValue) {
        (MODULE_PERMISSION_DEPENDENCIES[moduleKey]?.[actionKey] || []).forEach(requiredPermissionKey => {
            if (matrix[moduleKey][requiredPermissionKey]) return;
            matrix[moduleKey][requiredPermissionKey] = true;
            updates[requiredPermissionKey] = true;
        });
    } else {
        Object.entries(MODULE_PERMISSION_DEPENDENCIES[moduleKey] || {}).forEach(([dependentPermissionKey, requiredPermissionKeys]) => {
            if (!requiredPermissionKeys.includes(actionKey) || !matrix[moduleKey][dependentPermissionKey]) return;
            matrix[moduleKey][dependentPermissionKey] = false;
            updates[dependentPermissionKey] = false;
        });
    }

    if (nextValue && featureViewAction && actionKey !== featureViewAction.permissionKey && !matrix[moduleKey][featureViewAction.permissionKey]) {
        matrix[moduleKey][featureViewAction.permissionKey] = true;
        updates[featureViewAction.permissionKey] = true;
    }

    if (!nextValue && featureViewAction?.permissionKey === actionKey) {
        selectedProgramFeature.actions.forEach(action => {
            const actionModuleKey = action.moduleKey || 'program';
            if (actionModuleKey !== moduleKey || action.permissionKey === actionKey) return;
            matrix[moduleKey][action.permissionKey] = false;
            updates[action.permissionKey] = false;
        });
    }

    try {
        await setRbacModulePermissions(rbacState.selectedRole, moduleKey, updates);
    } catch (error) {
        console.error('Error saving RBAC permission:', error);
        matrix[moduleKey] = previousModulePermissions;
    }

    renderRbac();
}

async function selectAllModulePermissions(moduleKey) {
    if (!rbacState.selectedRole || rbacState.isSavingBulkPermissions) return;

    const roleKey = rbacState.selectedRole;
    const matrix = ensurePermissionMatrix(roleKey);
    rbacState.isSavingBulkPermissions = true;
    rbacState.bulkSavingModuleKey = moduleKey;
    renderPermissionTree();

    try {
        const updates = Object.fromEntries(
            getDisplayedPermissionKeys(moduleKey)
                .filter(permissionKey => !matrix[moduleKey]?.[permissionKey])
                .map(permissionKey => [permissionKey, true])
        );
        if (!Object.keys(updates).length) return;

        const previousModulePermissions = { ...matrix[moduleKey] };
        Object.assign(matrix[moduleKey], updates);

        try {
            await setRbacModulePermissions(roleKey, moduleKey, updates);
        } catch (error) {
            matrix[moduleKey] = previousModulePermissions;
            throw error;
        }
    } catch (error) {
        console.error('Error selecting module permissions:', error);
        Swal.fire(
            'Unable to select module permissions',
            error.message || 'The permission update failed.',
            'error'
        );
    } finally {
        rbacState.isSavingBulkPermissions = false;
        rbacState.bulkSavingModuleKey = '';
        renderRbac();
    }
}

function handleSelectAllPermissions(event) {
    const moduleButton = event.target.closest('[data-select-all-module]');
    if (!moduleButton) return false;

    selectAllModulePermissions(moduleButton.getAttribute('data-select-all-module'));
    return true;
}

function handleModuleToggle(event) {
    const button = event.target.closest('[data-module-toggle]');
    if (!button) return;

    const moduleKey = button.getAttribute('data-module-toggle');
    rbacState.expandedModules[moduleKey] = !rbacState.expandedModules[moduleKey];
    renderPermissionTree();
}

function handleProgramFeatureToggle(event) {
    const button = event.target.closest('[data-program-feature-toggle]');
    if (!button) return false;

    const featureKey = button.getAttribute('data-program-feature-toggle');
    rbacState.expandedProgramFeatures[featureKey] = !rbacState.expandedProgramFeatures[featureKey];
    renderPermissionTree();
    return true;
}

function bindRbacEvents() {
    const roleSearch = document.getElementById('rbac-role-search');
    const roleList = document.getElementById('rbac-role-list');
    const permissionTree = document.getElementById('rbac-permission-tree');
    const addUserButton = document.getElementById('rbac-add-user-shortcut');

    roleSearch?.addEventListener('input', event => {
        rbacState.roleSearch = String(event.target.value || '').trim().toLowerCase();
        renderRoleList();
    });

    roleList?.addEventListener('click', handleRoleListClick);
    permissionTree?.addEventListener('click', event => {
        if (handleSelectAllPermissions(event)) return;

        if (event.target.closest('[data-module-key][data-action-key]')) {
            handlePermissionToggle(event);
            return;
        }

        if (handleProgramFeatureToggle(event)) return;

        handleModuleToggle(event);
    });
    addUserButton?.addEventListener('click', () => {
        if (typeof window.openAddEmployeeModal === 'function') {
            window.openAddEmployeeModal();
        }
    });
}

function renderRoleBaseAccessDenied(message) {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    document.querySelectorAll('.main-card').forEach(card => card.classList.add('d-none'));

    const existingAlert = document.getElementById('role-base-access-alert');
    if (existingAlert) {
        existingAlert.textContent = message;
        return;
    }

    const alert = document.createElement('div');
    alert.id = 'role-base-access-alert';
    alert.className = 'alert alert-warning shadow-sm';
    alert.setAttribute('role', 'alert');
    alert.textContent = message;
    mainContent.appendChild(alert);
}

async function initRoleBasePage() {
    if (!isRoleBasePage() || !document.getElementById('rbac-role-list')) return;

    const userData = localStorage.getItem('user');
    let currentUserRole = '';

    if (userData) {
        try {
            currentUserRole = normalizeRoleKey(JSON.parse(userData).role_name);
        } catch (error) {
            console.error('Error reading current user role for role base:', error);
        }
    }

    const employeePermissions = getResolvedRolePermissions(currentUserRole).employee || {};
    if (!employeePermissions.view || !employeePermissions.manage_rbac) {
        renderRoleBaseAccessDenied('You do not currently have permission to open the Modules page.');
        return;
    }

    bindRbacEvents();

    try {
        await initializeEmployeeModuleSupport();
        await loadEmployeesData();
    } catch (error) {
        console.error('Error preparing role base page:', error);
    }

    syncRoleCatalog();
    renderRbac();
    fetchRoles();
}

document.addEventListener('employee-data-updated', event => {
    if (!isRoleBasePage()) return;
    const employees = Array.isArray(event.detail?.employees) ? event.detail.employees : [];
    rbacState.employees = employees;
    syncRoleCatalog();
    renderRbac();
});

document.addEventListener('DOMContentLoaded', initRoleBasePage);
