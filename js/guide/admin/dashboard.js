const navigation = [
    ['dashboard', 'Dashboard', 'Return here for an overview of your work and the latest dashboard summaries.'],
    ['schedule', 'Schedule', 'Open the schedule to review classes and appointments. Your available scheduling tools depend on your permissions.'],
    ['student_management', 'Students', 'Find student records and open the student details available to your account.'],
    ['enrollment', 'Enrollment', 'Expand Enrollment to choose Tutorial or Pre-school / Play-school, then review the enrollments and applications available to you. Each enrollment page has its own Guide.'],
    ['employee', 'Employee', 'Expand Employee to open the employee sections available to your account.'],
    ['program', 'Program', 'Expand Program to see the program settings and setup sections available to your account.'],
    ['school_calendar', 'School calendar', 'Review school dates and events in the school calendar.'],
    ['payment', 'Payment', 'Expand Payment to choose Tutorial or Pre-school / Play-school and open the payment records available to your account.'],
    ['class', 'Class', 'Open classes and sections to review the class details and management tools available to you.'],
    ['product', 'Product', 'Open the product list and the product tools available to your account.'],
    ['center', 'Center', 'Find tutorial centers and review the center details available to you.'],
    ['session', 'Session', 'Open the session records to review session details and the actions available to your account.']
];

export function getDashboardGuide() {
    return [
        { target: '.page-title', title: 'Welcome to your dashboard', description: 'Start here for a quick overview. This tour introduces the dashboard and shows where each available navigation item takes you.' },
        { target: '#owner-branch-filter, #auditor-branch-filter, #secretary-center-filter', title: 'Choose a center', description: 'Choose a center to focus the dashboard on that location, or select all centers for a wider overview.' },
        { target: '#branch-admin-branch-name', title: 'Your assigned branch', description: 'This shows the branch covered by your dashboard. The summaries below help you follow its daily operations.' },
        { target: '.owner-stats-grid, .branch-admin-stats-grid, .secretary-stats-grid, .auditor-stats-grid, .teacher-stats-grid', title: 'Your dashboard summary', description: 'These cards show the key totals for your dashboard. Read each label to see what the number represents.' },
        { target: '.owner-main-grid, .branch-admin-main-grid, .secretary-main-grid, .auditor-payment-card, .teacher-dashboard-main-grid', title: 'Dashboard details', description: 'The sections below the summary show more detail about your work. Where a period selector is provided, use it to change the time range for that section.' },
        { target: '.branch-admin-shortcuts', title: 'Quick shortcuts', description: 'These shortcuts take you directly to common branch tasks. The side navigation also provides access to your available pages.' },
        { target: '.sidebar-toggle', title: 'Open your navigation', description: 'Use this menu button to expand or collapse the side navigation. Next, we will highlight each section available to your account.' },
        ...navigation.map(([key, title, description]) => ({
            target: `[data-guide-nav="${key}"]`,
            title,
            description,
            navigation: true
        })),
        { target: '.notification-bell-button', title: 'Notifications', description: 'Open the bell to check your notifications and follow available updates.' },
        { target: '.header-profile-button', title: 'Your profile and Guide', description: 'Open this menu for your profile, Guide, or Log Out. Guide follows your current page, so you can replay this tour here or open a page to learn about its controls.' }
    ];
}

// Reveal navigation during its steps without changing saved sidebar preferences.
export function dashboardTourOptions() {
    const body = document.body;
    const wasOpen = body.classList.contains('sidebar-open');
    const wasCollapsed = body.classList.contains('sidebar-collapsed');
    const sidebar = document.getElementById('sidebar');
    const sidebarScroll = sidebar?.scrollTop || 0;
    const pageScroll = { left: window.scrollX, top: window.scrollY, behavior: 'instant' };
    const toggle = document.querySelector('.sidebar-toggle');
    const expanded = toggle?.getAttribute('aria-expanded');

    return {
        onStep(step) {
            const mobile = window.matchMedia('(max-width: 992px)').matches;
            body.classList.add('page-guide-dashboard');
            body.classList.toggle('sidebar-open', Boolean(step.navigation && mobile));
            body.classList.toggle('sidebar-collapsed', !step.navigation && wasCollapsed);
            toggle?.setAttribute('aria-expanded', String(mobile ? body.classList.contains('sidebar-open') : !body.classList.contains('sidebar-collapsed')));
        },
        onClose() {
            body.classList.toggle('sidebar-open', wasOpen);
            body.classList.toggle('sidebar-collapsed', wasCollapsed);
            body.classList.remove('page-guide-dashboard');
            if (sidebar?.isConnected) sidebar.scrollTop = sidebarScroll;
            if (expanded === null) toggle?.removeAttribute('aria-expanded');
            else if (expanded !== undefined) toggle?.setAttribute('aria-expanded', expanded);
            window.scrollTo(pageScroll);
        }
    };
}
