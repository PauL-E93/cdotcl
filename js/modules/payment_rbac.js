import { getResolvedRolePermissions, initRbacPermissions, normalizeRbacRoleKey } from "../utilities/rbac_navigation.js";

const DEFAULT_PAYMENT_PERMISSIONS = {
    view: true,
    create: true,
    edit: true,
    delete: true,
    approve: true,
    export: true,
    view_assessment: true,
    manage_assessment: true
};

let currentPaymentRole = '';
let paymentPermissions = { ...DEFAULT_PAYMENT_PERMISSIONS };

function getUserData() {
    const raw = localStorage.getItem('user');
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch (error) {
        console.error('Error parsing user data for payment RBAC:', error);
        return null;
    }
}

export function isPaymentModulePage() {
    const path = window.location.pathname;
    return path.includes('payment.html') || path.includes('payment_pre_play.html');
}

export function shouldApplyPaymentRbac() {
    return !window.location.pathname.includes('/student/');
}

function removePaymentStatusAlert() {
    document.getElementById('payment-access-alert')?.remove();
}

function renderPaymentAccessDenied() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    const existingAlert = document.getElementById('payment-access-alert');
    if (existingAlert) return;

    const alert = document.createElement('div');
    alert.id = 'payment-access-alert';
    alert.className = 'alert alert-warning shadow-sm mt-3';
    alert.setAttribute('role', 'alert');
    alert.textContent = 'You do not currently have permission to view the payment module.';
    mainContent.appendChild(alert);
}

function loadCurrentPaymentPermissions() {
    currentPaymentRole = '';
    paymentPermissions = { ...DEFAULT_PAYMENT_PERMISSIONS };

    if (!shouldApplyPaymentRbac()) {
        return paymentPermissions;
    }

    const user = getUserData();
    currentPaymentRole = normalizeRbacRoleKey(user?.role_name);

    const resolvedPermissions = getResolvedRolePermissions(currentPaymentRole).payment;
    if (resolvedPermissions) {
        paymentPermissions = {
            ...DEFAULT_PAYMENT_PERMISSIONS,
            ...resolvedPermissions
        };
    }

    return paymentPermissions;
}

export async function initPaymentPermissions(force = false) {
    if (!shouldApplyPaymentRbac()) {
        paymentPermissions = { ...DEFAULT_PAYMENT_PERMISSIONS };
        return paymentPermissions;
    }

    await initRbacPermissions(force);
    return loadCurrentPaymentPermissions();
}

export function canUsePaymentPermission(permissionKey) {
    if (!shouldApplyPaymentRbac()) return true;
    return Boolean(paymentPermissions?.[permissionKey]);
}

export function guardPaymentPermission(permissionKey, message) {
    if (canUsePaymentPermission(permissionKey)) {
        return true;
    }

    Swal.fire('Access Restricted', message, 'warning');
    return false;
}

export function applyPaymentPagePermissions() {
    if (!shouldApplyPaymentRbac()) {
        return { allowed: true };
    }

    const searchWrapper = document.querySelector('.top-bar .search-wrapper');
    const filterContainer = document.querySelector('.filter-container');
    const mainCard = document.querySelector('.main-card');

    if (!canUsePaymentPermission('view')) {
        searchWrapper?.classList.add('d-none');
        filterContainer?.classList.add('d-none');
        mainCard?.classList.add('d-none');
        renderPaymentAccessDenied();
        return { allowed: false };
    }

    removePaymentStatusAlert();
    searchWrapper?.classList.remove('d-none');
    filterContainer?.classList.remove('d-none');
    mainCard?.classList.remove('d-none');

    return { allowed: true };
}
