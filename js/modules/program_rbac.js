import { getResolvedRolePermissions, initRbacPermissions, normalizeRbacRoleKey } from "../utilities/rbac_navigation.js";

const DEFAULT_PROGRAM_PERMISSIONS = {
    view: true,
    create: true,
    edit: true,
    delete: true,
    approve: true,
    export: true,
    manage_types: true,
    manage_grades: true,
    manage_subjects: true,
    manage_services: true,
    manage_checklists: true,
    manage_discounts: true,
    manage_registration: true,
    view_programs: true,
    view_types: true,
    create_types: true,
    edit_types: true,
    view_grades: true,
    create_grades: true,
    edit_grades: true,
    view_subjects: true,
    create_subjects: true,
    edit_subjects: true,
    view_services: true,
    create_services: true,
    edit_services: true,
    view_checklists: true,
    edit_checklists: true,
    view_discounts: true,
    create_discounts: true,
    edit_discounts: true,
    view_registration: true,
    create_registration: true,
    edit_registration: true,
    view_payment_methods: true,
    create_payment_methods: true,
    edit_payment_methods: true,
    delete_payment_methods: true,
    view_landing: true,
    edit_landing: true
};

const PROGRAM_SECTION_CONFIG = [
    { permissionKey: 'view_programs', featureKey: 'programs', anchorSelector: '#program_table_body' },
    { permissionKey: 'view_types', featureKey: 'types', anchorSelector: '#program_type_table_body' },
    { permissionKey: 'view_grades', featureKey: 'grades', anchorSelector: '#grade_level_table_body' },
    { permissionKey: 'view_subjects', featureKey: 'subjects', anchorSelector: '#subject_table_body' },
    { permissionKey: 'view_services', featureKey: 'services', anchorSelector: '#services_table_body' },
    { permissionKey: 'view_checklists', featureKey: 'checklists', anchorSelector: '#report_card_table_body' },
    { permissionKey: 'view_discounts', featureKey: 'discounts', anchorSelector: '#discount_table_body' },
    { permissionKey: 'view_registration', featureKey: 'registration', anchorSelector: '#registration_table_body' },
    { permissionKey: 'view_payment_methods', featureKey: 'payment_methods', anchorSelector: '#payment_method_table_body' },
    { permissionKey: 'view_landing', featureKey: 'landing', anchorSelector: '#landing-page-form' }
];

const PROGRAM_ACTION_CONFIG = [
    { permissionKey: 'create', selector: '#btnAddProgram' },
    { permissionKey: 'create_types', selector: '#btnAddProgramType' },
    { permissionKey: 'create_grades', selector: '#btnAddGradeLevel' },
    { permissionKey: 'create_subjects', selector: '#btnAddSubject' },
    { permissionKey: 'create_services', selector: '#btnAddService' },
    { permissionKey: 'edit_checklists', selector: '#btnAddReportCardType' },
    { permissionKey: 'create_discounts', selector: '#btnAddDiscount' },
    { permissionKey: 'create_registration', selector: '#btnAddRegistration' },
    { permissionKey: 'create_payment_methods', selector: '#btnAddPaymentMethod' },
    { permissionKey: 'edit_landing', selector: '#landing-page-save' }
];

let currentProgramRole = '';
let programModulePermissions = { ...DEFAULT_PROGRAM_PERMISSIONS };

function getUserData() {
    const raw = localStorage.getItem('user');
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch (error) {
        console.error('Error parsing user data for program RBAC:', error);
        return null;
    }
}

export function shouldApplyProgramRbac() {
    return !window.location.pathname.includes('/student/');
}

function removeProgramStatusAlert() {
    document.getElementById('program-access-alert')?.remove();
}

function renderProgramAccessDenied() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    const existingAlert = document.getElementById('program-access-alert');
    if (existingAlert) return;

    const alert = document.createElement('div');
    alert.id = 'program-access-alert';
    alert.className = 'alert alert-warning shadow-sm mt-3';
    alert.setAttribute('role', 'alert');
    alert.textContent = 'You do not currently have permission to view the program module.';
    mainContent.appendChild(alert);
}

function loadCurrentProgramPermissions() {
    currentProgramRole = '';
    programModulePermissions = { ...DEFAULT_PROGRAM_PERMISSIONS };

    if (!shouldApplyProgramRbac()) {
        return programModulePermissions;
    }

    const user = getUserData();
    currentProgramRole = normalizeRbacRoleKey(user?.role_name);

    const resolvedPermissions = getResolvedRolePermissions(currentProgramRole).program;
    if (resolvedPermissions) {
        programModulePermissions = {
            ...DEFAULT_PROGRAM_PERMISSIONS,
            ...resolvedPermissions
        };
    }

    return programModulePermissions;
}

export async function initProgramPermissions(force = false) {
    if (!shouldApplyProgramRbac()) {
        programModulePermissions = { ...DEFAULT_PROGRAM_PERMISSIONS };
        return programModulePermissions;
    }

    await initRbacPermissions(force);
    return loadCurrentProgramPermissions();
}

export function canUseProgramPermission(permissionKey) {
    if (!shouldApplyProgramRbac()) return true;
    return Boolean(programModulePermissions?.[permissionKey]);
}

export function guardProgramPermission(permissionKey, message) {
    if (canUseProgramPermission(permissionKey)) {
        return true;
    }

    Swal.fire('Access Restricted', message, 'warning');
    return false;
}

function toggleProgramSection(featureKey, isVisible, anchorSelector) {
    const anchor = anchorSelector ? document.querySelector(anchorSelector) : null;
    const card = document.querySelector(`[data-program-feature="${featureKey}"]`)
        || (featureKey === 'programs' ? anchor?.closest('.main-card') : anchor?.closest('.content-panel'));
    if (!card) return;
    card.classList.toggle('d-none', !isVisible);

    const heading = card.previousElementSibling;
    if (heading?.matches('h5, h6')) heading.classList.toggle('d-none', !isVisible);
}

export function applyProgramPagePermissions() {
    if (!shouldApplyProgramRbac()) {
        return { allowed: true };
    }

    const searchWrapper = document.querySelector('.top-bar .search-wrapper');
    const filterContainer = document.querySelector('.filter-container');
    const mainCard = document.querySelector('.main-card');
    const featureCards = document.querySelectorAll('.main-card, .program-secondary-card, [data-program-feature]');
    const moreOptionButton = document.getElementById('more_option');
    const moreOptionWrapper = moreOptionButton?.closest('.position-relative');

    if (!canUseProgramPermission('view')) {
        searchWrapper?.classList.add('d-none');
        filterContainer?.classList.add('d-none');
        mainCard?.classList.add('d-none');
        featureCards.forEach(card => card.classList.add('d-none'));
        renderProgramAccessDenied();
        return { allowed: false };
    }

    removeProgramStatusAlert();
    searchWrapper?.classList.toggle('d-none', !canUseProgramPermission('view_programs'));
    filterContainer?.classList.toggle('d-none', !canUseProgramPermission('view_programs'));

    PROGRAM_SECTION_CONFIG.forEach(section => {
        toggleProgramSection(section.featureKey, canUseProgramPermission(section.permissionKey), section.anchorSelector);
    });

    document.querySelectorAll('[data-program-permission]').forEach(control => {
        const permissionKey = control.getAttribute('data-program-permission');
        control.classList.toggle('d-none', !canUseProgramPermission(permissionKey));
    });
    PROGRAM_ACTION_CONFIG.forEach(action => {
        document.querySelector(action.selector)?.classList.toggle('d-none', !canUseProgramPermission(action.permissionKey));
    });

    const hasProgramOptions = [
        canUseProgramPermission('create'),
        canUseProgramPermission('create_types'),
        canUseProgramPermission('create_grades'),
        canUseProgramPermission('create_subjects'),
        canUseProgramPermission('edit_checklists'),
        canUseProgramPermission('create_discounts'),
        canUseProgramPermission('create_registration'),
        canUseProgramPermission('create_services'),
        canUseProgramPermission('create_payment_methods')
    ].some(Boolean);

    if (moreOptionWrapper) {
        moreOptionWrapper.classList.toggle('d-none', !hasProgramOptions);
    } else if (moreOptionButton) {
        moreOptionButton.classList.toggle('d-none', !hasProgramOptions);
    }

    return { allowed: true };
}
