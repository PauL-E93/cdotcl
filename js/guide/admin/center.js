export function getCenterGuide(can) {
    return [
        { target: '.page-title', title: 'Your tutorial centers', description: 'Find centers and review their contact details, operating schedules, and assigned managers. This guide follows the tools available to your account.' },
        { target: '#search-input', title: 'Find a center', description: 'Search by center name, location, phone number, or operating days. The list updates as you type. Clear Search to show the center list again.' },
        { target: '#more_option', available: () => can('create'), title: 'Add a center from the menu', description: 'Open this menu after the tour and choose Add Center. Complete the center details, operating schedule, assigned manager, and status before saving.' },
        { target: '#addCenterBtn', available: () => can('create'), title: 'Add a center', description: 'Use Add Center to open the new center form. Review the required name, location, manager, and status before saving.' },
        { target: '.stat-card:has(#total-centers-count)', title: 'Total centers', description: 'This count summarizes the centers loaded in the directory before your search.' },
        { target: 'table:has(#branchTableBody)', title: 'Read the center list', description: 'Review each center\'s name, location, phone number, operating days and hours, and assigned employee or manager.' },
        { target: '#branchTableBody [data-bs-toggle="dropdown"]', fallback: 'table:has(#branchTableBody)', title: 'Center actions', description: can('edit') ? 'After the tour, open a row\'s three-dot menu. View opens the center details, and Edit opens the center information for updating.' : 'After the tour, open a row\'s three-dot menu and use View to review its center details.', fallbackDescription: 'When centers appear, their Actions menu shows the tools available to your account. Clear your search if you do not see any matching centers.' },
        { target: '#viewCenterModal.show', title: 'Center details', description: 'Review the center\'s contact details, operating schedule, assigned employee, and status. Close the details when you are finished.' },
        { target: '.header-profile-button', title: 'Replay the Center guide', description: 'Open your profile menu > Guide to review this walkthrough again. The tour does not update center records or change your search.' }
    ];
}
