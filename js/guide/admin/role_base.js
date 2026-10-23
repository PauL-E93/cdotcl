export function getRoleBaseGuide(can) {
    const enrollment = '[data-module-toggle="enrollment"]';
    const program = '[data-module-toggle="program"]';
    return [
        { target: '.page-title', title: 'Modules and role permissions', description: 'Choose which pages and actions each employee role can use. Permission changes save immediately and apply to that role, rather than just one employee.' },
        { target: '.top-bar a[href$="employee.html"]', title: 'Return to the employee list', description: 'Use Employee List to return to the employee directory. This workspace controls role permissions separately from employee records.' },
        { target: '#rbac-add-user-shortcut', available: () => can('create'), title: 'Add a user', description: 'Use Add User to open the employee account form. The role assigned to an employee determines which role permissions apply to their account.' },
        { target: '.employee-rbac-summary-grid', title: 'Access overview', description: 'Review the total roles, active users, inactive users, and restricted modules. Restricted Modules refers to the role currently selected.' },
        { target: '#rbac-role-search', title: 'Find a role', description: 'Type a role name to narrow the role list. Clear the search to see all roles again.' },
        { target: '#rbac-role-list', title: 'Select a role', description: 'After the tour, select a role card to review its access. Changes you make apply to employees assigned to that role.' },
        { target: '.employee-rbac-detail-header', title: 'Check the selected role', description: 'Confirm the role name here before changing permissions. The description and status summarize the selected access group.' },
        { target: '#rbac-permission-tree', title: 'Explore the modules', description: 'Each module groups its related permissions. Expand a module to inspect its controls. Enabled or Hidden indicates whether the role can open that module.' },
        { target: enrollment, title: 'Expand a module', description: 'Use the module heading to expand or collapse its permission list. We will use Enrollment as an example; expanding a section does not change access.', moduleKey: 'enrollment' },
        { target: '[data-module-key="enrollment"][data-action-key="view"]', fallback: enrollment, moduleKey: 'enrollment', title: 'Control page access', description: 'The View permission controls whether the selected role can open this module and see it in navigation. A check means enabled; a dash means disabled. Clicking a permission saves the change immediately.' },
        { target: '[data-module-key="enrollment"][data-action-key="create"]', fallback: enrollment, moduleKey: 'enrollment', title: 'Allow specific actions', description: 'Action permissions control what the role can do inside a page. For example, Add Enrollment permits creating enrollments. Editing, approving, exporting, and other features have their own controls. Enabling an action also enables module access when required.' },
        { target: '.employee-rbac-module-group:has([data-module-toggle="enrollment"]) .employee-rbac-module-bulk-actions', fallback: enrollment, moduleKey: 'enrollment', title: 'Select all module permissions', description: 'Select all enables the displayed permissions for this module and saves them together. If the button says All selected, those permissions are already enabled. Use individual permissions when the role needs only some actions.' },
        { target: '[data-program-feature-toggle="types"]', fallback: program, moduleKey: 'program', title: 'Program cards and features', description: 'Program contains a second level of feature cards, such as Program Type, Grade Levels, and Subjects. Expand a feature to review its own available actions.' },
        { target: '[data-module-key="program"][data-action-key="view_types"]', fallback: program, moduleKey: 'program', featureKey: 'types', title: 'Control feature visibility', description: 'A feature\'s View control determines whether its card is available. Its Add and Edit controls grant the corresponding actions. Disabling feature visibility also disables that feature\'s related actions.' },
        { target: '#rbac-navigation-preview', title: 'Preview the role navigation', description: 'This preview shows which configured modules the selected role can see in the sidebar. Review it after changing permissions to check the resulting navigation.' },
        { target: '.employee-rbac-users-wrap', title: 'Employees using this role', description: 'This list shows employees assigned to the selected role. Their available pages and tools follow that role\'s permissions.' },
        { target: '#rbac-assigned-users-body [data-bs-toggle="dropdown"]', fallback: '.employee-rbac-users-wrap', title: 'Manage a role member', description: 'After the tour, open a row\'s Actions menu to see the employee tools available to your account, such as View, Edit, or Schedule.', fallbackDescription: 'When employees are assigned to this role, their rows appear here. Any Actions menu shows only the employee tools available to your account.' },
        { target: '.header-profile-button', title: 'Review before changing access', description: 'After the tour, confirm the selected role, then change only the permissions it needs. Changes save immediately. Open your profile menu > Guide to replay this walkthrough.' }
    ];
}

export function roleBaseTourOptions() {
    const tree = document.getElementById('rbac-permission-tree');
    const snapshot = attribute => Array.from(tree?.querySelectorAll(`[${attribute}]`) || [])
        .map(button => [button.getAttribute(attribute), button.getAttribute('aria-expanded') === 'true']);
    const modules = snapshot('data-module-toggle');
    const features = snapshot('data-program-feature-toggle');

    function setExpanded(attribute, key, expanded) {
        const button = tree?.querySelector(`[${attribute}="${key}"]`);
        if (button && (button.getAttribute('aria-expanded') === 'true') !== expanded) button.click();
    }

    return {
        onStep(step) {
            // Only these disclosure buttons are clicked; permission buttons are untouched.
            if (step.moduleKey) setExpanded('data-module-toggle', step.moduleKey, true);
            if (step.featureKey) setExpanded('data-program-feature-toggle', step.featureKey, true);
        },
        onClose() {
            features.forEach(([key, expanded]) => setExpanded('data-program-feature-toggle', key, expanded));
            modules.forEach(([key, expanded]) => setExpanded('data-module-toggle', key, expanded));
        }
    };
}
