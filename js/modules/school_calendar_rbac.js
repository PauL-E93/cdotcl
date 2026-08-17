import { getResolvedRolePermissions, initRbacPermissions, normalizeRbacRoleKey } from "../utilities/rbac_navigation.js";

const DEFAULT_SCHOOL_CALENDAR_PERMISSIONS = {
    view: true,
    create: true,
    edit: true,
    delete: true,
    approve: true,
    export: true
};

let currentSchoolCalendarRole = '';
let schoolCalendarPermissions = { ...DEFAULT_SCHOOL_CALENDAR_PERMISSIONS };

function getUserData() {
    const raw = localStorage.getItem('user');
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch (error) {
        console.error('Error parsing user data for school calendar RBAC:', error);
        return null;
    }
}

export function shouldApplySchoolCalendarRbac() {
    return !window.location.pathname.includes('/student/');
}

function removeSchoolCalendarStatusAlert() {
    document.getElementById('school-calendar-access-alert')?.remove();
}

function renderSchoolCalendarAccessDenied() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    const existingAlert = document.getElementById('school-calendar-access-alert');
    if (existingAlert) return;

    const alert = document.createElement('div');
    alert.id = 'school-calendar-access-alert';
    alert.className = 'alert alert-warning shadow-sm mt-3';
    alert.setAttribute('role', 'alert');
    alert.textContent = 'You do not currently have permission to view the school calendar module.';
    mainContent.appendChild(alert);
}

function loadCurrentSchoolCalendarPermissions() {
    currentSchoolCalendarRole = '';
    schoolCalendarPermissions = { ...DEFAULT_SCHOOL_CALENDAR_PERMISSIONS };

    if (!shouldApplySchoolCalendarRbac()) {
        return schoolCalendarPermissions;
    }

    const user = getUserData();
    currentSchoolCalendarRole = normalizeRbacRoleKey(user?.role_name);

    const resolvedPermissions = getResolvedRolePermissions(currentSchoolCalendarRole).school_calendar;
    if (resolvedPermissions) {
        schoolCalendarPermissions = {
            ...DEFAULT_SCHOOL_CALENDAR_PERMISSIONS,
            ...resolvedPermissions
        };
    }

    return schoolCalendarPermissions;
}

export async function initSchoolCalendarPermissions(force = false) {
    if (!shouldApplySchoolCalendarRbac()) {
        schoolCalendarPermissions = { ...DEFAULT_SCHOOL_CALENDAR_PERMISSIONS };
        return schoolCalendarPermissions;
    }

    await initRbacPermissions(force);
    return loadCurrentSchoolCalendarPermissions();
}

export function canUseSchoolCalendarPermission(permissionKey) {
    if (!shouldApplySchoolCalendarRbac()) return true;
    return Boolean(schoolCalendarPermissions?.[permissionKey]);
}

export function guardSchoolCalendarPermission(permissionKey, message) {
    if (canUseSchoolCalendarPermission(permissionKey)) {
        return true;
    }

    Swal.fire('Access Restricted', message, 'warning');
    return false;
}

export function applySchoolCalendarPagePermissions() {
    if (!shouldApplySchoolCalendarRbac()) {
        return { allowed: true };
    }

    const addButton = document.getElementById('btnAddSchoolYearPage');
    const mainCard = document.querySelector('.main-card');
    const moreOptionButton = document.getElementById('more_option');
    const moreOptionWrapper = moreOptionButton?.closest('.position-relative');

    if (!canUseSchoolCalendarPermission('view')) {
        addButton?.classList.add('d-none');
        mainCard?.classList.add('d-none');
        if (moreOptionWrapper) {
            moreOptionWrapper.classList.add('d-none');
        } else {
            moreOptionButton?.classList.add('d-none');
        }
        renderSchoolCalendarAccessDenied();
        return { allowed: false };
    }

    removeSchoolCalendarStatusAlert();
    mainCard?.classList.remove('d-none');

    if (addButton) {
        addButton.classList.toggle('d-none', !canUseSchoolCalendarPermission('create'));
    }

    const hasMoreOptions = canUseSchoolCalendarPermission('create') || canUseSchoolCalendarPermission('edit');
    if (moreOptionWrapper) {
        moreOptionWrapper.classList.toggle('d-none', !hasMoreOptions);
    } else if (moreOptionButton) {
        moreOptionButton.classList.toggle('d-none', !hasMoreOptions);
    }

    return { allowed: true };
}
