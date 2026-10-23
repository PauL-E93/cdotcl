export function getEmployeeGuide({ role, can }) {
    const actions = ['View opens the employee details.'];
    if (can('edit')) actions.push('Edit opens the employee information for updating.');
    if (can('approve')) actions.push('Schedule opens the employee scheduling tools.');
    if (role === 'owner') actions.push('Login Credentials opens the employee account credentials.');

    return [
        { target: '.page-title', title: 'Your employee directory', description: 'Find employee records, review their assignments, and open the employee tools available to your account.' },
        { target: '#search-input', title: 'Find an employee', description: 'Type an employee name to narrow the list as you type. Clear the search to show the records matching your current filters again.' },
        { target: '.top-bar .btn-add', available: () => can('create'), title: 'Add an employee', description: 'Use Add Employee to open the form for a new employee account. Complete the required information and review the assignments before saving.' },
        { target: '.filter-container', title: 'Narrow the employee list', description: 'Combine the status, branch, role, and program filters with your search. On a small screen, use Filter & Sort to show the filters. Choose the All options and clear Search to remove your filters.' },
        { target: '#employee-status-filter', title: 'Filter by account status', description: 'Choose Active or Inactive accounts, or All Status to see both. The page starts with active employees selected.' },
        { target: '#employee-branch-filter', title: 'Filter by branch', description: 'Choose a branch to find employees assigned to that location. Select All Branches to remove this filter.' },
        { target: '#employee-role-filter', title: 'Filter by role', description: 'Choose a role to narrow the list to employees with that role. Select All Roles to remove this filter.' },
        { target: '#employee-program-filter', title: 'Filter by program', description: 'Choose a program to find employees assigned to it. Select All Programs to remove this filter.' },
        { target: '.employee-summary-grid, .stats-grid', title: 'Employee summary', description: 'See the total employees, active employees, branch coverage, and roles in use. These cards summarize the loaded employee records before search and filters.' },
        { target: 'table:has(#employeeTableBody)', title: 'Read the employee list', description: 'Review each employee\'s name, birthday, username, role, status, branch, subject and program assignments, and account creation date.' },
        {
            target: '#employeeTableBody [data-bs-toggle="dropdown"]',
            fallback: 'table:has(#employeeTableBody)',
            title: 'Employee actions',
            description: `After the tour, open a row's three-dot menu. ${actions.join(' ')}`,
            fallbackDescription: 'When employee records appear, open a row\'s three-dot Actions menu to see the tools available to your account. Try changing your search or filters if the list is empty.'
        },
        { target: '.content-panel .d-flex.justify-content-between:has(#employee-table-summary)', title: 'Browse more employees', description: 'Use the page controls below the table to browse the matching records. Replay this tour anytime from your profile menu > Guide.' }
    ];
}
