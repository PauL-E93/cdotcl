import { getResolvedRolePermissions, initRbacPermissions, normalizeRbacRoleKey } from "../utilities/rbac_navigation.js";

const DEFAULT_CLASS_PERMISSIONS = {
    view: true,
    create: true,
    edit: true,
    delete: true,
    approve: true,
    export: true,
    manage_sections: true,
    edit_sections: true,
    manage_attendance: true,
    manage_students: true,
    manage_report_cards: true
};

let currentClassRole = '';
let classPermissions = { ...DEFAULT_CLASS_PERMISSIONS };

function getUserData() {
    const raw = localStorage.getItem('user');
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch (error) {
        console.error('Error parsing user data for class RBAC:', error);
        return null;
    }
}

export function isClassModulePage() {
    return window.location.pathname.includes('class.html');
}

export function isClassAttendancePage() {
    return window.location.pathname.includes('attendance.html');
}

export function isClassReportCardsPage() {
    return window.location.pathname.includes('section_report_cards.html');
}

export function shouldApplyClassRbac() {
    return !window.location.pathname.includes('/student/');
}

function removeClassStatusAlert() {
    document.getElementById('class-access-alert')?.remove();
}

function renderClassAccessDenied(message) {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    const existingAlert = document.getElementById('class-access-alert');
    if (existingAlert) {
        existingAlert.textContent = message;
        return;
    }

    const alert = document.createElement('div');
    alert.id = 'class-access-alert';
    alert.className = 'alert alert-warning shadow-sm mt-3';
    alert.setAttribute('role', 'alert');
    alert.textContent = message;
    mainContent.appendChild(alert);
}

function loadCurrentClassPermissions() {
    currentClassRole = '';
    classPermissions = { ...DEFAULT_CLASS_PERMISSIONS };

    if (!shouldApplyClassRbac()) {
        return classPermissions;
    }

    const user = getUserData();
    currentClassRole = normalizeRbacRoleKey(user?.role_name);

    const resolvedPermissions = getResolvedRolePermissions(currentClassRole).class;
    if (resolvedPermissions) {
        classPermissions = {
            ...DEFAULT_CLASS_PERMISSIONS,
            ...resolvedPermissions
        };
    }

    return classPermissions;
}

export async function initClassPermissions(force = false) {
    if (!shouldApplyClassRbac()) {
        classPermissions = { ...DEFAULT_CLASS_PERMISSIONS };
        return classPermissions;
    }

    await initRbacPermissions(force);
    return loadCurrentClassPermissions();
}

export function canUseClassPermission(permissionKey) {
    if (!shouldApplyClassRbac()) return true;
    return Boolean(classPermissions?.[permissionKey]);
}

export function guardClassPermission(permissionKey, message) {
    if (canUseClassPermission(permissionKey)) {
        return true;
    }

    Swal.fire('Access Restricted', message, 'warning');
    return false;
}

export function applyClassPagePermissions() {
    if (!shouldApplyClassRbac()) {
        return { allowed: true };
    }

    const path = window.location.pathname;
    const mainContent = document.querySelector('.main-content');
    const searchWrapper = document.querySelector('.top-bar .search-wrapper');
    const filterContainer = document.querySelector('.filter-container');
    const mainCard = document.querySelector('.main-card');
    const addButton = document.querySelector('.btn-add');
    const moreOptionWrapper = document.getElementById('more_option')?.closest('.position-relative');
    const directoryHeader = document.querySelector('.class-directory-header');
    const selectorRow = document.querySelector('.class-selector-row');
    const selectedSectionView = document.getElementById('selected-section-view');
    const permissionControls = document.querySelectorAll('[data-class-permission]');

    let requiredPermission = 'view';
    let deniedMessage = 'You do not currently have permission to view the class module.';

    if (path.includes('attendance.html')) {
        requiredPermission = 'manage_attendance';
        deniedMessage = 'You do not currently have permission to access class attendance.';
    } else if (path.includes('section_report_cards.html')) {
        requiredPermission = 'manage_report_cards';
        deniedMessage = 'You do not currently have permission to access class report cards.';
    }

    if (!canUseClassPermission('view') || !canUseClassPermission(requiredPermission)) {
        searchWrapper?.classList.add('d-none');
        filterContainer?.classList.add('d-none');
        mainCard?.classList.add('d-none');
        addButton?.classList.add('d-none');
        moreOptionWrapper?.classList.add('d-none');
        directoryHeader?.classList.add('d-none');
        selectorRow?.classList.add('d-none');
        selectedSectionView?.classList.add('d-none');
        mainContent?.classList.add('class-rbac-locked');
        renderClassAccessDenied(deniedMessage);
        return { allowed: false };
    }

    removeClassStatusAlert();
    mainContent?.classList.remove('class-rbac-locked');
    searchWrapper?.classList.remove('d-none');
    filterContainer?.classList.remove('d-none');
    mainCard?.classList.remove('d-none');
    directoryHeader?.classList.remove('d-none');
    selectorRow?.classList.remove('d-none');
    selectedSectionView?.classList.remove('d-none');

    if (isClassModulePage()) {
        addButton?.classList.toggle('d-none', !canUseClassPermission('create'));
        permissionControls.forEach(control => {
            const permissionKey = control.getAttribute('data-class-permission');
            control.classList.toggle('d-none', !canUseClassPermission(permissionKey));
        });
        const hasMenuOptions = canUseClassPermission('create') || canUseClassPermission('manage_sections');
        moreOptionWrapper?.classList.toggle('d-none', !hasMenuOptions);
    }

    return { allowed: true };
}
