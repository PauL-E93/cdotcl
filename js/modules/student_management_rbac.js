import { getResolvedRolePermissions, initRbacPermissions, normalizeRbacRoleKey } from '../utilities/rbac_navigation.js';

const DEFAULT_STUDENT_MANAGEMENT_PERMISSIONS = {
    view: false,
    edit: false,
    export: false
};

let studentManagementPermissions = { ...DEFAULT_STUDENT_MANAGEMENT_PERMISSIONS };

function getUserData() {
    const raw = localStorage.getItem('user');
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch (error) {
        console.error('Error parsing user data for student management RBAC:', error);
        return null;
    }
}

export async function initStudentManagementPermissions(force = false) {
    await initRbacPermissions(force);

    const role = normalizeRbacRoleKey(getUserData()?.role_name);
    const resolvedPermissions = getResolvedRolePermissions(role).student_management;
    studentManagementPermissions = {
        ...DEFAULT_STUDENT_MANAGEMENT_PERMISSIONS,
        ...(resolvedPermissions || {})
    };

    return { ...studentManagementPermissions };
}

export function canUseStudentManagementPermission(permissionKey) {
    return Boolean(studentManagementPermissions[permissionKey]);
}
