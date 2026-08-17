import { getResolvedRolePermissions, initRbacPermissions, normalizeRbacRoleKey } from "../utilities/rbac_navigation.js";

const DEFAULT_SCHEDULE_PERMISSIONS = {
    view: true,
    create: true,
    edit: true,
    delete: true,
    approve: true,
    export: true
};

let currentScheduleRole = '';
let schedulePermissions = { ...DEFAULT_SCHEDULE_PERMISSIONS };

function getUserData() {
    const raw = localStorage.getItem('user');
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch (error) {
        console.error('Error parsing user data for schedule RBAC:', error);
        return null;
    }
}

export function isScheduleModulePage() {
    return window.location.pathname.includes('schedule.html');
}

export function shouldApplyScheduleRbac() {
    return true;
}

function removeScheduleStatusAlert() {
    document.getElementById('schedule-access-alert')?.remove();
}

function renderScheduleAccessDenied() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    const existingAlert = document.getElementById('schedule-access-alert');
    if (existingAlert) return;

    const alert = document.createElement('div');
    alert.id = 'schedule-access-alert';
    alert.className = 'alert alert-warning shadow-sm mt-3';
    alert.setAttribute('role', 'alert');
    alert.textContent = 'You do not currently have permission to view the schedule module.';
    mainContent.appendChild(alert);
}

function loadCurrentSchedulePermissions() {
    currentScheduleRole = '';
    schedulePermissions = { ...DEFAULT_SCHEDULE_PERMISSIONS };

    if (!shouldApplyScheduleRbac()) {
        return schedulePermissions;
    }

    const user = getUserData();
    currentScheduleRole = normalizeRbacRoleKey(user?.role_name);

    const resolvedPermissions = getResolvedRolePermissions(currentScheduleRole).schedule;
    if (resolvedPermissions) {
        schedulePermissions = {
            ...DEFAULT_SCHEDULE_PERMISSIONS,
            ...resolvedPermissions
        };
    }

    return schedulePermissions;
}

export async function initSchedulePermissions(force = false) {
    if (!shouldApplyScheduleRbac()) {
        schedulePermissions = { ...DEFAULT_SCHEDULE_PERMISSIONS };
        return schedulePermissions;
    }

    await initRbacPermissions(force);
    return loadCurrentSchedulePermissions();
}

export function canUseSchedulePermission(permissionKey) {
    if (!shouldApplyScheduleRbac()) return true;
    return Boolean(schedulePermissions?.[permissionKey]);
}

export function applySchedulePagePermissions() {
    if (!shouldApplyScheduleRbac()) {
        window.__scheduleRbacLocked = false;
        return { allowed: true };
    }

    const searchWrapper = document.querySelector('.top-bar .search-wrapper');
    const filterContainer = document.querySelector('.filter-container');
    const moduleContainer = document.getElementById('calendar-container') || document.getElementById('calendar-module-root');
    const addButton = document.querySelector('.top-bar .btn-add');

    const isAllowed = canUseSchedulePermission('view');
    window.__scheduleRbacLocked = !isAllowed;

    if (!isAllowed) {
        searchWrapper?.classList.add('d-none');
        filterContainer?.classList.add('d-none');
        moduleContainer?.classList.add('d-none');
        addButton?.classList.add('d-none');
        renderScheduleAccessDenied();
        return { allowed: false };
    }

    removeScheduleStatusAlert();
    searchWrapper?.classList.remove('d-none');
    filterContainer?.classList.remove('d-none');
    moduleContainer?.classList.remove('d-none');
    addButton?.classList.toggle('d-none', !canUseSchedulePermission('create'));
    return { allowed: true };
}
