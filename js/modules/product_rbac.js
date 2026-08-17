import { getResolvedRolePermissions, initRbacPermissions, normalizeRbacRoleKey } from "../utilities/rbac_navigation.js";

const DEFAULT_PRODUCT_PERMISSIONS = {
    view: true,
    create: true,
    edit: true,
    delete: true,
    approve: true,
    export: true
};

let currentProductRole = '';
let productPermissions = { ...DEFAULT_PRODUCT_PERMISSIONS };

function getUserData() {
    const raw = localStorage.getItem('user');
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch (error) {
        console.error('Error parsing user data for product RBAC:', error);
        return null;
    }
}

export function isProductModulePage() {
    return window.location.pathname.includes('product.html');
}

export function shouldApplyProductRbac() {
    return !window.location.pathname.includes('/student/');
}

function removeProductStatusAlert() {
    document.getElementById('product-access-alert')?.remove();
}

function renderProductAccessDenied() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    const existingAlert = document.getElementById('product-access-alert');
    if (existingAlert) return;

    const alert = document.createElement('div');
    alert.id = 'product-access-alert';
    alert.className = 'alert alert-warning shadow-sm mt-3';
    alert.setAttribute('role', 'alert');
    alert.textContent = 'You do not currently have permission to view the product module.';
    mainContent.appendChild(alert);
}

function loadCurrentProductPermissions() {
    currentProductRole = '';
    productPermissions = { ...DEFAULT_PRODUCT_PERMISSIONS };

    if (!shouldApplyProductRbac()) {
        return productPermissions;
    }

    const user = getUserData();
    currentProductRole = normalizeRbacRoleKey(user?.role_name);

    const resolvedPermissions = getResolvedRolePermissions(currentProductRole).product;
    if (resolvedPermissions) {
        productPermissions = {
            ...DEFAULT_PRODUCT_PERMISSIONS,
            ...resolvedPermissions
        };
    }

    return productPermissions;
}

export async function initProductPermissions(force = false) {
    if (!shouldApplyProductRbac()) {
        productPermissions = { ...DEFAULT_PRODUCT_PERMISSIONS };
        return productPermissions;
    }

    await initRbacPermissions(force);
    return loadCurrentProductPermissions();
}

export function canUseProductPermission(permissionKey) {
    if (!shouldApplyProductRbac()) return true;
    return Boolean(productPermissions?.[permissionKey]);
}

export function guardProductPermission(permissionKey, message) {
    if (canUseProductPermission(permissionKey)) {
        return true;
    }

    Swal.fire('Access Restricted', message, 'warning');
    return false;
}

export function applyProductPagePermissions() {
    if (!shouldApplyProductRbac()) {
        return { allowed: true };
    }

    const searchWrapper = document.querySelector('.top-bar .search-wrapper');
    const filterContainer = document.querySelector('.filter-container');
    const mainCard = document.querySelector('.main-card');
    const moreOptionWrapper = document.getElementById('more_option')?.closest('.position-relative');

    if (!canUseProductPermission('view')) {
        searchWrapper?.classList.add('d-none');
        filterContainer?.classList.add('d-none');
        mainCard?.classList.add('d-none');
        moreOptionWrapper?.classList.add('d-none');
        renderProductAccessDenied();
        return { allowed: false };
    }

    removeProductStatusAlert();
    searchWrapper?.classList.remove('d-none');
    filterContainer?.classList.remove('d-none');
    mainCard?.classList.remove('d-none');

    const hasMoreOptions = canUseProductPermission('create');
    moreOptionWrapper?.classList.toggle('d-none', !hasMoreOptions);

    return { allowed: true };
}
