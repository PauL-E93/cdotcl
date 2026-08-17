import { getResolvedRolePermissions, initRbacPermissions, normalizeRbacRoleKey } from "../utilities/rbac_navigation.js";

const DEFAULT_SESSION_PERMISSIONS = {
    view: true,
    create: true,
    edit: true,
    delete: true,
    approve: true,
    export: true
};

let currentSessionRole = '';
let sessionPermissions = { ...DEFAULT_SESSION_PERMISSIONS };

function getUserData() {
    const raw = localStorage.getItem('user');
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch (error) {
        console.error('Error parsing user data for session RBAC:', error);
        return null;
    }
}

export function isSessionModulePage() {
    const path = window.location.pathname;
    return path.includes('session.html') || path.includes('tracking.html');
}

export function shouldApplySessionRbac() {
    return !window.location.pathname.includes('/student/');
}

function removeSessionStatusAlert() {
    document.getElementById('session-access-alert')?.remove();
}

function renderSessionAccessDenied() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    mainContent.innerHTML = '';

    const alert = document.createElement('div');
    alert.id = 'session-access-alert';
    alert.className = 'alert alert-warning shadow-sm mt-3';
    alert.setAttribute('role', 'alert');
    alert.textContent = 'You do not currently have permission to view the session module.';
    mainContent.appendChild(alert);
}

function loadCurrentSessionPermissions() {
    currentSessionRole = '';
    sessionPermissions = { ...DEFAULT_SESSION_PERMISSIONS };

    if (!shouldApplySessionRbac()) {
        return sessionPermissions;
    }

    const user = getUserData();
    currentSessionRole = normalizeRbacRoleKey(user?.role_name);

    const resolvedPermissions = getResolvedRolePermissions(currentSessionRole).session;
    if (resolvedPermissions) {
        sessionPermissions = {
            ...DEFAULT_SESSION_PERMISSIONS,
            ...resolvedPermissions
        };
    }

    return sessionPermissions;
}

export async function initSessionPermissions(force = false) {
    if (!shouldApplySessionRbac()) {
        sessionPermissions = { ...DEFAULT_SESSION_PERMISSIONS };
        return sessionPermissions;
    }

    await initRbacPermissions(force);
    return loadCurrentSessionPermissions();
}

export function canUseSessionPermission(permissionKey) {
    if (!shouldApplySessionRbac()) return true;
    return Boolean(sessionPermissions?.[permissionKey]);
}

export function guardSessionPermission(permissionKey, message) {
    if (canUseSessionPermission(permissionKey)) {
        return true;
    }

    Swal.fire('Access Restricted', message, 'warning');
    return false;
}

export function applySessionPagePermissions() {
    if (!shouldApplySessionRbac()) {
        return { allowed: true };
    }

    const mainContent = document.querySelector('.main-content');

    if (!canUseSessionPermission('view')) {
        renderSessionAccessDenied();
        return { allowed: false };
    }

    removeSessionStatusAlert();
    return { allowed: true };
}
