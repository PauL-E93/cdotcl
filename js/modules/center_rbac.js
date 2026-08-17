import { getResolvedRolePermissions, initRbacPermissions, normalizeRbacRoleKey } from "../utilities/rbac_navigation.js";

const DEFAULT_CENTER_PERMISSIONS = {
    view: true,
    create: true,
    edit: true,
    delete: true,
    approve: true,
    export: true
};

let currentCenterRole = '';
let centerPermissions = { ...DEFAULT_CENTER_PERMISSIONS };

function getUserData() {
    const raw = localStorage.getItem('user');
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch (error) {
        console.error('Error parsing user data for center RBAC:', error);
        return null;
    }
}

export function isCenterModulePage() {
    return window.location.pathname.includes('center.html');
}

export function shouldApplyCenterRbac() {
    return true;
}

function removeCenterStatusAlert() {
    document.getElementById('center-access-alert')?.remove();
}

function renderCenterAccessDenied() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    const existingAlert = document.getElementById('center-access-alert');
    if (existingAlert) return;

    const alert = document.createElement('div');
    alert.id = 'center-access-alert';
    alert.className = 'alert alert-warning shadow-sm mt-3';
    alert.setAttribute('role', 'alert');
    alert.textContent = 'You do not currently have permission to view the center module.';
    mainContent.appendChild(alert);
}

function loadCurrentCenterPermissions() {
    currentCenterRole = '';
    centerPermissions = { ...DEFAULT_CENTER_PERMISSIONS };

    if (!shouldApplyCenterRbac()) {
        return centerPermissions;
    }

    const user = getUserData();
    currentCenterRole = normalizeRbacRoleKey(user?.role_name);

    const resolvedPermissions = getResolvedRolePermissions(currentCenterRole).center;
    if (resolvedPermissions) {
        centerPermissions = {
            ...DEFAULT_CENTER_PERMISSIONS,
            ...resolvedPermissions
        };
    }

    return centerPermissions;
}

export async function initCenterPermissions(force = false) {
    if (!shouldApplyCenterRbac()) {
        centerPermissions = { ...DEFAULT_CENTER_PERMISSIONS };
        return centerPermissions;
    }

    await initRbacPermissions(force);
    return loadCurrentCenterPermissions();
}

export function canUseCenterPermission(permissionKey) {
    if (!shouldApplyCenterRbac()) return true;
    return Boolean(centerPermissions?.[permissionKey]);
}

export function guardCenterPermission(permissionKey, message) {
    if (canUseCenterPermission(permissionKey)) {
        return true;
    }

    Swal.fire('Access Restricted', message, 'warning');
    return false;
}

export function applyCenterPagePermissions() {
    if (!shouldApplyCenterRbac()) {
        return { allowed: true };
    }

    const searchWrapper = document.querySelector('.top-bar .search-wrapper');
    const filterContainer = document.querySelector('.filter-container');
    const mainCard = document.querySelector('.main-card');
    const addButton = document.getElementById('addCenterBtn');
    const moreOptionWrapper = document.getElementById('more_option')?.closest('.position-relative');

    if (!canUseCenterPermission('view')) {
        searchWrapper?.classList.add('d-none');
        filterContainer?.classList.add('d-none');
        mainCard?.classList.add('d-none');
        addButton?.classList.add('d-none');
        moreOptionWrapper?.classList.add('d-none');
        renderCenterAccessDenied();
        return { allowed: false };
    }

    removeCenterStatusAlert();
    searchWrapper?.classList.remove('d-none');
    filterContainer?.classList.remove('d-none');
    mainCard?.classList.remove('d-none');
    addButton?.classList.toggle('d-none', !canUseCenterPermission('create'));

    return { allowed: true };
}
