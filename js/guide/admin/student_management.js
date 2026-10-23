export function getStudentManagementGuide(can) {
    // The server may make a record read-only even when the role permits editing.
    const canEdit = can('edit') && Array.from(document.querySelectorAll('[data-view-student]'))
        .some(button => button.textContent.includes('Edit'));

    return [
        { target: '.student-management-header h1', title: 'Student Management', description: 'Use this directory to find student records, review their current programs, and open their profiles. This tour follows the tools available to your account.' },
        { target: '.student-summary-grid', title: 'Your student summary', description: 'See totals for the student records available to you: total students, active accounts, currently enrolled students, and students without a program. These totals summarize the directory before search and filters.' },
        { target: '#student-search-input', title: 'Find a student', description: 'Search by name, student ID, email, guardian, or phone number. The list updates as you type. Clear the search to show records again.' },
        { target: '#student-program-filter', title: 'Filter by program', description: 'Choose a program to find students linked to that current program. Select All programs to remove this filter.' },
        { target: '#student-branch-filter', title: 'Filter by branch', description: 'Choose a branch to narrow the directory to students associated with that location. This filter appears when multiple branches are available.' },
        { target: '#student-school-year-filter', title: 'Filter by school year', description: 'Choose a school year to find students with an enrollment in that year. You can combine this with the other filters and your search.' },
        { target: '#student-status-filter', title: 'Filter by account status', description: 'Choose Active or Inactive to filter student accounts. Account status is separate from the enrollment status shown in the directory.' },
        { target: '#student-clear-filters', title: 'Reset your search and filters', description: 'Use Reset to clear your search and all filters, then show the full student list available to your account again.' },
        { target: '#student-export-button', available: () => can('export'), title: 'Export student records', description: 'Use Export to choose PDF, Excel, or CSV. The export includes all students matching your current search and filters, including results on other pages.' },
        { target: '.student-directory-table', title: 'Read the student directory', description: 'Review student IDs, contact details, current programs, branches, enrollment status, and account status. Each student shows their active or most recent program.' },
        {
            target: '[data-view-student]',
            fallback: '.student-table-heading',
            title: canEdit ? 'View or edit a student' : 'View a student profile',
            description: canEdit
                ? 'After the tour, select View / Edit to open a profile. Review personal, address, guardian, and health information, plus enrollment history. Make permitted updates and use Save changes when ready.'
                : 'After the tour, select View to open a student profile and review their details and enrollment history. Editing is available only when your account and the record allow it.',
            fallbackDescription: 'When student records appear, use the View or View / Edit button in a row to open its profile. Try changing your search or filters if the directory is empty.'
        },
        { target: '.student-table-footer', title: 'Browse more students', description: 'The summary shows which records you are viewing. Use the page buttons to browse more students matching your search and filters. Replay this tour anytime from your profile menu > Guide.' }
    ];
}
