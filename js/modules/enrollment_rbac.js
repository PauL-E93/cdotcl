import { getResolvedRolePermissions, initRbacPermissions, normalizeRbacRoleKey } from "../utilities/rbac_navigation.js";

const DEFAULT_ENROLLMENT_PERMISSIONS = {
    view: true,
    create: true,
    edit: true,
    delete: true,
    approve: true,
    export: true
};

let currentEnrollmentRole = '';
let enrollmentModulePermissions = { ...DEFAULT_ENROLLMENT_PERMISSIONS };

function getUserData() {
    const raw = localStorage.getItem('user');
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch (error) {
        console.error('Error parsing user data for enrollment RBAC:', error);
        return null;
    }
}

export function shouldApplyEnrollmentRbac() {
    return !window.location.pathname.includes('/student/');
}

function removeEnrollmentStatusAlert() {
    document.getElementById('enrollment-access-alert')?.remove();
}

function renderEnrollmentAccessDenied() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    const existingAlert = document.getElementById('enrollment-access-alert');
    if (existingAlert) return;

    const alert = document.createElement('div');
    alert.id = 'enrollment-access-alert';
    alert.className = 'alert alert-warning shadow-sm mt-3';
    alert.setAttribute('role', 'alert');
    alert.textContent = 'You do not currently have permission to view the enrollment module.';
    mainContent.appendChild(alert);
}

function loadCurrentEnrollmentPermissions() {
    currentEnrollmentRole = '';
    enrollmentModulePermissions = { ...DEFAULT_ENROLLMENT_PERMISSIONS };

    if (!shouldApplyEnrollmentRbac()) {
        return enrollmentModulePermissions;
    }

    const user = getUserData();
    currentEnrollmentRole = normalizeRbacRoleKey(user?.role_name);

    const resolvedPermissions = getResolvedRolePermissions(currentEnrollmentRole).enrollment;
    if (resolvedPermissions) {
        enrollmentModulePermissions = resolvedPermissions;
    }

    return enrollmentModulePermissions;
}

export async function initEnrollmentPermissions(force = false) {
    if (!shouldApplyEnrollmentRbac()) {
        enrollmentModulePermissions = { ...DEFAULT_ENROLLMENT_PERMISSIONS };
        return enrollmentModulePermissions;
    }

    await initRbacPermissions(force);
    return loadCurrentEnrollmentPermissions();
}

export function getEnrollmentModulePermissions() {
    return { ...enrollmentModulePermissions };
}

export function canUseEnrollmentPermission(permissionKey) {
    if (!shouldApplyEnrollmentRbac()) return true;
    return Boolean(enrollmentModulePermissions?.[permissionKey]);
}

export function guardEnrollmentPermission(permissionKey, message) {
    if (canUseEnrollmentPermission(permissionKey)) {
        return true;
    }

    Swal.fire('Access Restricted', message, 'warning');
    return false;
}

export function applyEnrollmentPagePermissions() {
    if (!shouldApplyEnrollmentRbac()) {
        return { allowed: true };
    }

    const addButton = document.getElementById('btn-start-enrollment');
    const searchWrapper = document.querySelector('.top-bar .search-wrapper');
    const filterContainer = document.querySelector('.filter-container');
    const mainCards = document.querySelectorAll('.main-card');

    if (!canUseEnrollmentPermission('view')) {
        addButton?.classList.add('d-none');
        searchWrapper?.classList.add('d-none');
        filterContainer?.classList.add('d-none');
        mainCards.forEach(card => card.classList.add('d-none'));
        renderEnrollmentAccessDenied();
        return { allowed: false };
    }

    removeEnrollmentStatusAlert();
    searchWrapper?.classList.remove('d-none');
    filterContainer?.classList.remove('d-none');
    mainCards.forEach(card => card.classList.remove('d-none'));

    if (addButton) {
        addButton.classList.toggle('d-none', !canUseEnrollmentPermission('create'));
    }

    return { allowed: true };
}
