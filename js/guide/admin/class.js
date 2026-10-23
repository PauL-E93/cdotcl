export function getClassGuide({ role, can }) {
    const actions = [];
    if (role !== 'teacher' && can('edit')) actions.push('Edit Class updates the selected class.');
    if (role !== 'teacher' && can('edit_sections')) actions.push('Edit Section updates the selected section.');
    if (can('export')) actions.push('Export downloads the populated table on the current tab in PDF, CSV, or Excel format.');
    const activeTab = document.querySelector('[data-section-tab].active')?.dataset.sectionTab;
    const contentDescription = {
        overview: 'Review the selected class, section, instructor, schedule, and student count shown here.',
        students: 'Review enrolled students, their IDs, statuses, and email addresses. Scroll the student list when there are more records.',
        profile: 'Review student profile information, including IDs, contact details, guardians, and addresses. Scroll horizontally to see additional columns.',
        grades: 'Review the student list for grades and report cards. Use a student\'s Open action to access their ECCD checklist when available.'
    }[activeTab] || 'This area shows the content of your selected section tab. Choose a tab to review its details.';

    return [
        { target: '.class-directory-header .page-title, .page-title', title: 'Your classes and sections', description: 'Choose a class and section to review its details and the student tools available to your account. Guide follows your current selection and tab.' },
        { target: '#btn-add-class', available: () => role !== 'teacher' && can('create'), title: 'Add a class', description: 'Use Add Class to create a class. Complete the required details and review the program and branch assignment before saving.' },
        { target: '#class-selector', title: 'Choose a class', description: 'Select a class from this list. The available sections load for that class. If no classes are listed, there are no classes available to your account yet.' },
        { target: '.selector-field:has(#section-selector)', title: 'Choose a section', description: 'Choose a class first, then select one of its sections. The section details and student tools appear below. Open Guide again after selecting a section for the detailed walkthrough.' },
        { target: '#btn-add-section', fallback: '.class-directory-header-actions:has(#btn-add-section:not(.d-none))', available: () => role !== 'teacher' && can('manage_sections'), title: 'Add a section', description: 'Select a class to enable Add Section. Use it to create a section under the selected class, then review its instructor and schedule details before saving.' },
        { target: '#selected-section-view .class-empty-state', title: 'Your selection workspace', description: 'This message explains what to select next or why there are no sections to show. Choose a class and section to load the workspace, then replay Guide to learn its available tools.' },
        { target: '#selected-section-view .section-overview', title: 'Selected section details', description: 'Confirm the section name and status, class, instructor, and schedule here before working with its records.' },
        { target: '[data-section-tab="overview"]', title: 'Section overview', description: 'Open Overview to review the class, section, instructor, schedule, and student totals.' },
        { target: '[data-section-tab="students"]', available: () => can('manage_students'), title: 'Students in this section', description: 'Open Students to review the enrolled student list and enrollment statuses for this section.' },
        { target: '[data-section-tab="profile"]', available: () => can('manage_students'), title: 'Student profiles', description: 'Open Profile to review the section\'s student profile information, including guardian and contact details.' },
        { target: '[data-section-tab="grades"]', available: () => can('manage_report_cards'), title: 'Grades and ECCD checklists', description: 'Open Grades to find students and open their available ECCD checklists and report-card tools.' },
        { target: '[data-section-tab="attendance"]', available: () => can('manage_attendance'), title: 'Section attendance', description: 'Use Attendance to open the attendance page for this section.' },
        { target: '#section-student-search', title: 'Find a student in this section', description: 'Search by name or student ID to narrow the records on the current student tab. Clear the search to show the full list again.' },
        { target: '#section-tab-content', title: 'Your current section tab', description: contentDescription },
        { target: '#owner-grade-students .eccd-open-btn', available: () => can('manage_report_cards'), title: 'Open a student checklist', description: 'Use Open beside a student to access their ECCD checklist for this section and enrollment.' },
        { target: '.section-actions-btn', available: () => actions.length > 0, title: 'Section actions', description: `After the tour, open the three-dot menu for the tools available to your account. ${actions.join(' ')}` },
        { target: '.header-profile-button', title: 'Guide for your current selection', description: 'Replay Guide after choosing another class, section, or tab. The tour preserves your selection, search, and records.' }
    ];
}
