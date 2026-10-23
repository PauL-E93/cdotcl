import { startTour } from './tour.js?v=20261023-session-guides';
import { getSessionGuide } from './session.js?v=20261023-student-portal-guides';
import { getEnrollmentGuide } from './admin/enrollment.js';
import { getDashboardGuide, dashboardTourOptions } from './admin/dashboard.js';
import { getStudentEnrollmentGuide } from './student/enrollment.js?v=20261023-student-portal-guides';
import { getStudentDashboardGuide } from './student/dashboard.js';
import { getStudentProfileGuide, getEnrollmentRequestGuide } from './student/pages.js';
import { getScheduleGuide } from './schedule.js?v=20261023-student-portal-guides';
import { getStudentManagementGuide } from './admin/student_management.js';
import { getEmployeeGuide } from './admin/employee.js';
import { getRoleBaseGuide, roleBaseTourOptions } from './admin/role_base.js';
import { getProgramGuide, getFaqGuide, getChecklistEditorGuide, getAgreementGuide } from './admin/program.js';
import { getSchoolCalendarGuide } from './admin/school_calendar.js';
import { getPaymentGuide } from './payment.js';
import { getClassGuide } from './admin/class.js';
import { getProductGuide } from './admin/product.js';
import { getCenterGuide } from './admin/center.js';
import { getRbacModulePermission, normalizeRbacRoleKey } from '../utilities/rbac_navigation.js';

const pageModules = {
    'enrollement.html': 'enrollment',
    'enrollement_pre_play.html': 'enrollment',
    'student_management.html': 'student_management',
    'employee.html': 'employee',
    'role_base.html': 'employee',
    'schedule.html': 'schedule',
    'payment.html': 'payment',
    'payment_pre_play.html': 'payment',
    'program.html': 'program',
    'faq.html': 'program',
    'card_management.html': 'program',
    'school_calendar.html': 'school_calendar',
    'class.html': 'class',
    'product.html': 'product',
    'center.html': 'center',
    'session.html': 'session',
    'tracking.html': 'session',
    'enrollment_request.html': 'enrollment',
    'attendance.html': 'class',
    'section_report_cards.html': 'class',
    'discount.html': 'program'
};

export function startPageGuide(returnFocus) {
    let user;
    try { user = JSON.parse(localStorage.getItem('user')); } catch { return; }
    const role = normalizeRbacRoleKey(user?.role_name);
    if (!role || role === 'guest') return;

    const page = window.location.pathname.split('/').pop();
    const module = pageModules[page];
    // Student pages use their own enrollment access rules, as in the page code.
    const student = role === 'student';
    const can = permission => !module || (student && module === 'enrollment') || getRbacModulePermission(role, module, permission);
    const profileStep = { target: '.header-profile-button', title: 'Your profile and guides', description: 'Open your profile menu to update your details, start the guide for your current page, or log out.' };

    if (!can('view') || (page === 'role_base.html' && !can('manage_rbac')) ||
        (page === 'faq.html' && !can('view_landing')) ||
        (page === 'card_management.html' && (!can('view_checklists') || !can('edit_checklists'))) ||
        (page === 'agreements.html' && role !== 'owner')) {
        startTour([
            { target: '.page-title, .main-content h1, .main-content h2, .main-content', title: 'Page access', description: 'Your account does not currently have permission to view this page. Ask the owner to grant access if you need it.' },
            profileStep
        ], returnFocus);
        return;
    }

    let steps;
    if (student && page === 'dashboard.html') {
        startTour(getStudentDashboardGuide(), returnFocus, dashboardTourOptions());
        return;
    } else if (student && page === 'profile.html') {
        steps = getStudentProfileGuide();
    } else if (student && page === 'enrollment_request.html') {
        steps = getEnrollmentRequestGuide();
    } else if (student && ['attendance.html', 'section_report_cards.html', 'discount.html'].includes(page)) {
        steps = [
            { target: '.page-title, .main-content', title: 'Student page availability', description: 'This workspace currently uses a staff page template and does not load a student workspace. Return to your enrollment, payment, or session records to review your student information.' },
            { target: '[data-guide-nav="enrollment"]', title: 'Review your enrollment instead', description: 'Open your enrollment list to review its status and available details. Contact the center for attendance, report card, or discount information that is not available in your portal.' },
            profileStep
        ];
    } else if (page === 'program.html') {
        steps = getProgramGuide(can);
    } else if (page === 'faq.html') {
        steps = getFaqGuide(can);
    } else if (page === 'card_management.html') {
        steps = getChecklistEditorGuide(can);
    } else if (page === 'agreements.html') {
        steps = getAgreementGuide();
    } else if (page === 'role_base.html') {
        startTour(getRoleBaseGuide(can), returnFocus, roleBaseTourOptions());
        return;
    } else if (page === 'dashboard.html' && !student) {
        startTour(getDashboardGuide(), returnFocus, dashboardTourOptions());
        return;
    } else if (module === 'enrollment') {
        steps = student ? getStudentEnrollmentGuide(page === 'enrollement_pre_play.html') : getEnrollmentGuide(can, page === 'enrollement_pre_play.html');
    } else if (module === 'schedule') {
        steps = getScheduleGuide({ role, can, canOpenSessions: () => getRbacModulePermission(role, 'session', 'view') });
    } else if (module === 'school_calendar') {
        steps = getSchoolCalendarGuide(can);
    } else if (module === 'payment') {
        steps = getPaymentGuide({ student, preschool: page === 'payment_pre_play.html', can });
    } else if (page === 'class.html') {
        steps = getClassGuide({ role, can });
    } else if (module === 'product') {
        steps = getProductGuide(can);
    } else if (module === 'session') {
        steps = getSessionGuide({ student, tracking: page === 'tracking.html' });
    } else if (module === 'center') {
        steps = getCenterGuide(can);
    } else if (module === 'student_management') {
        steps = getStudentManagementGuide(can);
    } else if (page === 'employee.html') {
        steps = getEmployeeGuide({ role, can });
    } else {
        steps = [
            { target: '.page-title, .main-content h1, .main-content h2', title: 'Your current page', description: 'This guide follows the page you are viewing and the controls available to your account. Detailed guides are being added page by page.' },
            { target: '.main-content .search-wrapper input, .main-content input[type="search"]', title: 'Search this page', description: 'Use Search to find a record in this page\'s list. Clear the search to see the list again.' },
            { target: '.main-content .filter-container', title: 'Filter the list', description: 'Use the available filters to narrow the records shown on this page.' },
            profileStep
        ];
    }
    startTour(steps, returnFocus);
}
