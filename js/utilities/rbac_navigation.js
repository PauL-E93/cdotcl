import { buildAppUrl } from './app_url.js';

export const RBAC_STORAGE_KEY = 'rbac_permissions';
export const RBAC_NAV_UPDATED_EVENT = 'rbac-navigation-updated';
export const RBAC_ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export'];
export const RBAC_MANAGER_ROLES = ['owner', 'secretary'];
export const ROLE_DISPLAY_ORDER = ['owner', 'secretary', 'auditor', 'branch admin', 'teacher'];
export const SHARED_MODULE_PAGE_MAP = {
    'employee.html': 'employee',
    'role_base.html': 'employee',
    'schedule.html': 'schedule'
};

const PROGRAM_FEATURE_PERMISSION_KEYS = [
    'view_programs',
    'view_types', 'create_types', 'edit_types',
    'view_subjects', 'create_subjects', 'edit_subjects',
    'view_services', 'create_services', 'edit_services',
    'view_checklists', 'edit_checklists',
    'view_discounts', 'create_discounts', 'edit_discounts',
    'view_registration', 'create_registration', 'edit_registration',
    'view_landing', 'edit_landing'
];

const LEGACY_PROGRAM_PERMISSION_MAP = {
    manage_types: ['view_types', 'create_types', 'edit_types'],
    manage_subjects: ['view_subjects', 'create_subjects', 'edit_subjects'],
    manage_services: ['view_services', 'create_services', 'edit_services'],
    manage_checklists: ['view_checklists', 'edit_checklists'],
    manage_discounts: ['view_discounts', 'create_discounts', 'edit_discounts'],
    manage_registration: ['view_registration', 'create_registration', 'edit_registration']
};

export const MODULE_PERMISSION_EXTRAS = {
    employee: ['manage_rbac'],
    program: [
        'manage_types', 'manage_subjects', 'manage_services', 'manage_checklists', 'manage_discounts', 'manage_registration',
        ...PROGRAM_FEATURE_PERMISSION_KEYS
    ],
    class: ['manage_sections', 'edit_sections', 'manage_attendance', 'manage_students', 'manage_report_cards']
};
let rbacInitPromise = null;

export const RBAC_MODULES = [
    { key: 'enrollment', label: 'Enrollment', icon: 'bi-journal-check' },
    { key: 'employee', label: 'Employee', icon: 'bi-people' },
    { key: 'schedule', label: 'Schedule', icon: 'bi-calendar3' },
    { key: 'program', label: 'Program', icon: 'bi-grid' },
    { key: 'school_calendar', label: 'School Calendar', icon: 'bi-calendar-range' },
    { key: 'payment', label: 'Payment', icon: 'bi-credit-card' },
    { key: 'class', label: 'Class', icon: 'bi-building' },
    { key: 'product', label: 'Product', icon: 'bi-box-seam' },
    { key: 'center', label: 'Center', icon: 'bi-shop' },
    { key: 'session', label: 'Session', icon: 'bi-clock' }
];

export const ROLE_META = {
    owner: {
        label: 'Owner',
        description: 'Full system visibility and control across all tutorial center modules.',
        icon: 'bi-stars',
        tone: 'rose'
    },
    secretary: {
        label: 'Secretary',
        description: 'Handles day-to-day operations, employee updates, enrollment, and branch support.',
        icon: 'bi-clipboard-check',
        tone: 'mint'
    },
    'branch admin': {
        label: 'Branch Admin',
        description: 'Manages branch-level schedules, classes, enrollment, and payment workflows.',
        icon: 'bi-diagram-3',
        tone: 'violet'
    },
    teacher: {
        label: 'Teacher',
        description: 'Focused access for teaching schedules, sessions, and class activity.',
        icon: 'bi-mortarboard',
        tone: 'sky'
    },
    auditor: {
        label: 'Auditor',
        description: 'Read-oriented access for monitoring financial, inventory, and operational records.',
        icon: 'bi-search',
        tone: 'amber'
    },
    student: {
        label: 'Student',
        description: 'Limited learner access for schedule, payment, and session tracking.',
        icon: 'bi-person',
        tone: 'slate'
    }
};

const DEFAULT_NAV_MODULES = {
    owner: RBAC_MODULES.map(module => module.key),
    secretary: ['enrollment', 'employee', 'schedule', 'program', 'school_calendar', 'payment', 'class', 'product', 'center', 'session'],
    auditor: ['enrollment', 'schedule', 'program', 'payment', 'class', 'product', 'center', 'session'],
    'branch admin': ['enrollment', 'schedule', 'payment', 'class', 'session'],
    teacher: ['schedule', 'class', 'session'],
    student: ['enrollment', 'schedule', 'payment', 'session']
};

export function normalizeRbacRoleKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

function getRbacApiUrl() {
    return buildAppUrl('api/admin/employee.php');
}

function normalizeStoredConfig(config) {
    if (!config || typeof config !== 'object') return {};

    const normalized = {};

    Object.entries(config).forEach(([roleKey, modules]) => {
        const normalizedRole = normalizeRbacRoleKey(roleKey);
        if (!normalizedRole || !modules || typeof modules !== 'object') return;

        normalized[normalizedRole] = {};
        Object.entries(modules).forEach(([moduleKey, permissions]) => {
            if (!moduleKey || !permissions || typeof permissions !== 'object') return;

            normalized[normalizedRole][moduleKey] = {};
            Object.entries(permissions).forEach(([permissionKey, value]) => {
                if (typeof value !== 'boolean') return;

                // `can` was the former name for module visibility.  Read old
                // saved settings as `view` so existing roles keep their access.
                if (permissionKey === 'can') {
                    if (!Object.prototype.hasOwnProperty.call(permissions, 'view')) {
                        normalized[normalizedRole][moduleKey].view = value;
                    }
                    return;
                }

                normalized[normalizedRole][moduleKey][permissionKey] = value;
            });
        });
    });

    return normalized;
}

function readStoredConfig() {
    try {
        const raw = localStorage.getItem(RBAC_STORAGE_KEY);
        if (!raw) return {};

        const parsed = JSON.parse(raw);
        return normalizeStoredConfig(parsed);
    } catch (error) {
        console.error('Error reading RBAC config:', error);
        return {};
    }
}

function writeStoredConfig(config) {
    try {
        localStorage.setItem(RBAC_STORAGE_KEY, JSON.stringify(normalizeStoredConfig(config)));
    } catch (error) {
        console.error('Error saving RBAC config:', error);
    }
}

async function fetchRbacPermissionsFromServer() {
    const response = await fetch(`${getRbacApiUrl()}?operation=getRbacPermissions&_=${Date.now()}`, {
        credentials: 'same-origin',
        cache: 'no-store'
    });
    const payload = await response.json();

    if (payload.status !== 'success') {
        throw new Error(payload.message || 'Failed to load RBAC permissions');
    }

    return normalizeStoredConfig(payload.data || {});
}

export async function initRbacPermissions(force = false) {
    if (!force && rbacInitPromise) {
        return rbacInitPromise;
    }

    rbacInitPromise = fetchRbacPermissionsFromServer()
        .then(config => {
            writeStoredConfig(config);
            return config;
        })
        .catch(error => {
            console.error('Error initializing RBAC permissions:', error);
            return readStoredConfig();
        });

    return rbacInitPromise;
}

function createEmptyPermissionMatrix() {
    return Object.fromEntries(
        RBAC_MODULES.map(module => [
            module.key,
            {
                ...Object.fromEntries(RBAC_ACTIONS.map(action => [action, false])),
                ...Object.fromEntries((MODULE_PERMISSION_EXTRAS[module.key] || []).map(action => [action, false]))
            }
        ])
    );
}

function setPermissions(matrix, moduleKeys, actions, value = true) {
    moduleKeys.forEach(moduleKey => {
        if (!matrix[moduleKey]) return;
        actions.forEach(action => {
            matrix[moduleKey][action] = value;
        });
    });
}

function buildDefaultPermissionMatrix(roleKey) {
    const normalized = normalizeRbacRoleKey(roleKey);
    const matrix = createEmptyPermissionMatrix();
    const allModules = RBAC_MODULES.map(module => module.key);

    setPermissions(matrix, DEFAULT_NAV_MODULES[normalized] || [], ['view']);

    if (normalized === 'owner') {
        setPermissions(matrix, allModules, RBAC_ACTIONS, true);
        Object.entries(MODULE_PERMISSION_EXTRAS).forEach(([moduleKey, permissionKeys]) => {
            setPermissions(matrix, [moduleKey], permissionKeys, true);
        });
        return matrix;
    }

    if (normalized === 'secretary') {
        setPermissions(matrix, ['center'], ['view']);
        setPermissions(matrix, ['schedule'], ['view']);
        setPermissions(matrix, ['program', 'school_calendar', 'class', 'product', 'session'], ['view', 'create', 'edit']);
        setPermissions(matrix, ['enrollment', 'employee', 'payment'], ['view', 'create', 'edit', 'approve']);
        setPermissions(matrix, ['enrollment', 'payment'], ['export']);
        setPermissions(matrix, ['employee'], MODULE_PERMISSION_EXTRAS.employee, true);
        setPermissions(matrix, ['program'], MODULE_PERMISSION_EXTRAS.program, true);
        setPermissions(matrix, ['class'], MODULE_PERMISSION_EXTRAS.class, true);
        return matrix;
    }

    if (normalized === 'branch admin') {
        setPermissions(matrix, ['center'], ['view']);
        setPermissions(matrix, ['schedule'], ['view', 'create']);
        setPermissions(matrix, ['class', 'session'], ['view', 'create', 'edit']);
        setPermissions(matrix, ['enrollment', 'payment'], ['view', 'create', 'edit', 'approve']);
        setPermissions(matrix, ['enrollment', 'payment'], ['export']);
        setPermissions(matrix, ['class'], MODULE_PERMISSION_EXTRAS.class, true);
        return matrix;
    }

    if (normalized === 'teacher') {
        setPermissions(matrix, ['schedule'], ['view']);
        setPermissions(matrix, ['class', 'school_calendar', 'session'], ['view']);
        setPermissions(matrix, ['enrollment', 'payment'], ['view', 'export']);
        setPermissions(matrix, ['session'], ['create', 'edit']);
        setPermissions(matrix, ['class'], ['manage_attendance', 'manage_students', 'manage_report_cards']);
        return matrix;
    }

    if (normalized === 'auditor') {
        setPermissions(matrix, ['schedule'], ['view']);
        setPermissions(matrix, ['enrollment', 'payment', 'product', 'center'], ['view', 'export']);
        setPermissions(matrix, ['program'], ['view', 'view_programs']);
        setPermissions(matrix, ['payment'], ['approve']);
        setPermissions(matrix, ['class'], ['view']);
        setPermissions(matrix, ['session'], ['view']);
        return matrix;
    }

    if (normalized === 'student') {
        setPermissions(matrix, ['schedule'], ['view']);
        setPermissions(matrix, ['payment', 'session'], ['view']);
        return matrix;
    }

    setPermissions(matrix, ['enrollment'], ['view']);
    return matrix;
}

function applyStoredOverrides(matrix, storedRoleConfig) {
    if (!storedRoleConfig || typeof storedRoleConfig !== 'object') return;

    Object.entries(storedRoleConfig).forEach(([moduleKey, permissionConfig]) => {
        if (!matrix[moduleKey] || !permissionConfig || typeof permissionConfig !== 'object') return;

        if (moduleKey === 'program') {
            Object.entries(LEGACY_PROGRAM_PERMISSION_MAP).forEach(([legacyKey, replacementKeys]) => {
                if (!Object.prototype.hasOwnProperty.call(permissionConfig, legacyKey)) return;
                const legacyValue = permissionConfig[legacyKey];
                if (typeof legacyValue !== 'boolean') return;

                replacementKeys.forEach(permissionKey => {
                    if (!Object.prototype.hasOwnProperty.call(permissionConfig, permissionKey)) {
                        matrix.program[permissionKey] = legacyValue;
                    }
                });
            });
        }

        // Section creation and editing originally shared `manage_sections`.
        // Preserve existing role behavior until Edit Section is saved explicitly.
        if (moduleKey === 'class'
            && typeof permissionConfig.manage_sections === 'boolean'
            && !Object.prototype.hasOwnProperty.call(permissionConfig, 'edit_sections')) {
            matrix.class.edit_sections = permissionConfig.manage_sections;
        }

        Object.entries(permissionConfig).forEach(([permissionKey, value]) => {
            if (typeof value !== 'boolean') return;
            if (!Object.prototype.hasOwnProperty.call(matrix[moduleKey], permissionKey)) return;
            matrix[moduleKey][permissionKey] = value;
        });
    });
}

export function getResolvedRolePermissions(roleKey) {
    const normalized = normalizeRbacRoleKey(roleKey);
    const matrix = buildDefaultPermissionMatrix(normalized);
    const storedConfig = readStoredConfig();

    applyStoredOverrides(matrix, storedConfig[normalized]);
    return matrix;
}

export function getRbacModulePermission(roleKey, moduleKey, permissionKey) {
    const matrix = getResolvedRolePermissions(roleKey);
    if (!matrix[moduleKey]) return false;
    return Boolean(matrix[moduleKey][permissionKey]);
}

export function setRbacModulePermission(roleKey, moduleKey, permissionKey, allowed) {
    return setRbacModulePermissions(roleKey, moduleKey, { [permissionKey]: Boolean(allowed) });
}

export async function setRbacModulePermissions(roleKey, moduleKey, updates) {
    const normalized = normalizeRbacRoleKey(roleKey);
    const config = readStoredConfig();
    const previousConfig = JSON.parse(JSON.stringify(config));
    const sanitizedUpdates = {};

    Object.entries(updates || {}).forEach(([permissionKey, value]) => {
        if (typeof value === 'boolean') {
            sanitizedUpdates[permissionKey] = value;
        }
    });

    if (!config[normalized] || typeof config[normalized] !== 'object') {
        config[normalized] = {};
    }

    if (!config[normalized][moduleKey] || typeof config[normalized][moduleKey] !== 'object') {
        config[normalized][moduleKey] = {};
    }

    Object.entries(sanitizedUpdates).forEach(([permissionKey, value]) => {
        config[normalized][moduleKey][permissionKey] = value;
    });

    writeStoredConfig(config);

    const response = await fetch(getRbacApiUrl(), {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            operation: 'saveRbacModulePermissions',
            json: JSON.stringify({
                role_name: normalized,
                module_key: moduleKey,
                updates: sanitizedUpdates
            })
        })
    });
    const payload = await response.json();

    if (payload.status !== 'success') {
        writeStoredConfig(previousConfig);
        throw new Error(payload.message || 'Failed to save RBAC module permissions');
    }

    document.dispatchEvent(new CustomEvent(RBAC_NAV_UPDATED_EVENT, {
        detail: {
            roleKey: normalized,
            moduleKey,
            updates: sanitizedUpdates
        }
    }));

    return payload.data || {};
}

export async function clearRbacRolePermissions(roleKey) {
    const normalized = normalizeRbacRoleKey(roleKey);
    const config = readStoredConfig();
    const previousConfig = JSON.parse(JSON.stringify(config));

    if (Object.prototype.hasOwnProperty.call(config, normalized)) {
        delete config[normalized];
        writeStoredConfig(config);
    }

    const response = await fetch(getRbacApiUrl(), {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            operation: 'clearRbacRolePermissions',
            json: JSON.stringify({
                role_name: normalized
            })
        })
    });
    const payload = await response.json();

    if (payload.status !== 'success') {
        writeStoredConfig(previousConfig);
        throw new Error(payload.message || 'Failed to reset RBAC role permissions');
    }

    document.dispatchEvent(new CustomEvent(RBAC_NAV_UPDATED_EVENT, {
        detail: {
            roleKey: normalized,
            reset: true
        }
    }));

    return payload;
}

export function canRoleAccessModule(roleKey, moduleKey) {
    return getRbacModulePermission(roleKey, moduleKey, 'view');
}

export function canRoleViewModule(roleKey, moduleKey) {
    return getRbacModulePermission(roleKey, moduleKey, 'view');
}

export function canManageRbac(roleKey) {
    return RBAC_MANAGER_ROLES.includes(normalizeRbacRoleKey(roleKey));
}
