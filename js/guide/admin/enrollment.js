// Shared by staff roles; permissions and visible controls select the steps.
export function getEnrollmentGuide(can, isPreschool = false) {
    return [
        { target: '#search-input', title: 'Find an enrollment', description: 'Type in Search to narrow the enrollment and application list. Clear the search to see the list again.' },
        { target: '#btn-start-enrollment', available: () => can('create'), title: 'Start an enrollment', description: 'Use Enrollment to begin enrolling a student. The form walks you through the student details and the next enrollment steps.' },
        { target: '.filter-container', title: 'Narrow the list', description: 'Use the available filters to narrow the records shown. You can combine filters with your search.' },
        { target: '.stats-grid', title: 'Enrollment at a glance', description: 'See the enrollment totals and statuses here. Select a summary card to filter the list by that group.' },
        { target: '#export-enrollment-table', available: () => can('export'), title: 'Export the list', description: 'Use Export to download the enrollment list for reporting or keeping a copy.' },
        { target: '.enrollment-list-table, .main-content .table', title: 'Enrollments and applications', description: isPreschool ? 'Review the student, section, class, date, and current status for each record.' : 'Review each student\'s subject, tutor, date, and current status here. Search and filters help you find a particular record.' },
        {
            target: '#paymentTableBody [data-bs-toggle="dropdown"]',
            fallback: '.main-content .table th:last-child',
            title: 'Actions for each record',
            description: 'After the tour, open a row\'s three-dot menu. It shows the actions available to your account for that record and its current status.',
            fallbackDescription: 'When records appear, use the Actions column to open a record\'s menu. Only the actions available to your account for that record are shown.'
        },
        { target: '.content-panel .d-flex.justify-content-between', title: 'Browse more records', description: 'Use the page controls below the table to move through the list. Replay this tour anytime from your profile menu > Guide.' }
    ];
}
