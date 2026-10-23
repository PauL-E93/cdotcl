import { PROGRAM_SECTIONS } from '../../utilities/program_sections.js';

const catalogs = {
    programs: ['program_table_body', 'btnAddProgram', 'create', 'edit', 'Program', 'Review programs offered by the center and their enrollment settings.', 'Review names, descriptions, tuition, duration, validity, type, registration fees, penalty rules, discounts, services, and status.'],
    types: ['program_type_table_body', 'btnAddProgramType', 'create_types', 'edit_types', 'Program Type', 'Manage the types used to classify programs.', 'Review the type names available for program setup.'],
    grades: ['grade_level_table_body', 'btnAddGradeLevel', 'create_grades', 'edit_grades', 'Grade Level', 'Manage the grade choices offered in new Tutorial enrollments.', 'Review grade names and statuses. Inactive grades are hidden from new enrollments while existing records are preserved.'],
    subjects: ['subject_table_body', 'btnAddSubject', 'create_subjects', 'edit_subjects', 'Subject', 'Manage the subject catalog used by programs and enrollments.', 'Review the subject names available in the catalog.'],
    services: ['services_table_body', 'btnAddService', 'create_services', 'edit_services', 'Service', 'Manage optional services and their availability.', 'Review service details, amounts, available branches, and statuses.'],
    discounts: ['discount_table_body', 'btnAddDiscount', 'create_discounts', 'edit_discounts', 'Discount', 'Manage the discounts used by programs.', 'Review discount names, descriptions, amounts, and statuses.'],
    registration: ['registration_table_body', 'btnAddRegistration', 'create_registration', 'edit_registration', 'Registration Amount', 'Manage registration fee amounts available for program setup.', 'Review registration fee names, amounts, and statuses.'],
    payment_methods: ['payment_method_table_body', 'btnAddPaymentMethod', 'create_payment_methods', 'edit_payment_methods', 'Payment Method', 'Manage payment channels, receiving accounts, and QR codes.', 'Review payment methods, account names and numbers, QR codes, and statuses.']
};

const replay = { target: '.header-profile-button', title: 'Guide for each Program section', description: 'Choose another available section under Program in the side navigation, then open your profile menu > Guide for that section\'s walkthrough.' };
const table = body => `table:has(#${body})`;

function faqSteps(can) {
    return [
        { target: '#btnAddFaq', available: () => can('edit_landing'), title: 'Add a FAQ', description: 'Use Add FAQ to enter a question and answer. Set its display order and status, then save it for the public landing page.' },
        { target: table('faq_table_body'), title: 'Review public FAQs', description: 'Review questions, answers, display order, and status. Active FAQs appear on the public landing page.' },
        { target: '#faq_table_body [data-faq-edit]', available: () => can('edit_landing'), title: 'Edit a FAQ', description: 'Use Edit to update a question, answer, order, or status. Review your changes before saving.' },
        { target: '#faq_table_body [data-faq-archive]', available: () => can('edit_landing'), title: 'Archive a FAQ', description: 'Use Archive to make an active FAQ inactive, so it is no longer shown to visitors. Review the confirmation before proceeding.' }
    ];
}

export function getProgramGuide(can) {
    // Follow the section actually shown by the page, including permission fallback.
    const section = PROGRAM_SECTIONS.find(item => {
        const card = document.querySelector(`[data-program-feature="${item.key}"]`)
            || (item.key === 'session_automation' ? document.getElementById('session-automation-section') : null);
        return can(item.permission) && card && !card.hidden && !card.classList.contains('d-none');
    });
    if (!section) return [{ target: '.page-title, .main-content', title: 'Program access', description: 'There are no Program sections available to your account on this page. Ask the owner to grant the section permissions you need.' }, replay];

    const config = catalogs[section.key];
    const steps = [{ target: '.page-title', title: `${section.label} guide`, description: config?.[5] || {
        session_automation: 'Review automatic attendance timing for tutorial sessions. Sessions must still be started manually; the timing rules use Philippine time.',
        checklists: 'Review the shared ECCD checklist used for Pre-school and Play School.',
        landing: 'Review public landing-page content and frequently asked questions. Saved changes are displayed to visitors.'
    }[section.key] }];

    if (config) {
        const [body, add, create, edit, name, , list] = config;
        if (section.key === 'programs') steps.push(
            { target: '#search-input', title: 'Find a program', description: 'Search by program name, description, type, or status. Clear Search to see the program list again.' },
            { target: '#program-status-filter, #program-type-filter', title: 'Filter programs', description: 'Use the available status or type filters to narrow the program list.' },
            { target: '#more_option', title: 'Additional setup shortcuts', description: 'Open this menu after the tour to see the additional setup shortcuts available to your account. You can also choose available sections under Program in the side navigation.' }
        );
        steps.push(
            { target: `#${add}`, available: () => can(create), title: `Add ${name.toLowerCase()}`, description: `Use this button to open the ${name.toLowerCase()} form. Complete the required details and review them before saving.` },
            { target: table(body), title: `${name} list`, description: list },
            { target: `#${body} button[onclick*="edit"], #${body} [title^="Edit"], #${body} [data-payment-method-action="edit"]`, available: () => can(edit), title: `Edit ${name.toLowerCase()}`, description: 'After the tour, use Edit on a record to open its existing details. Make the permitted changes, then save or update the record.' }
        );
        if (section.key === 'payment_methods') steps.push(
            { target: '#payment_method_table_body [data-payment-method-action="view-qr"]', title: 'View a payment QR code', description: 'Use View QR to inspect the QR image attached to a payment method.' },
            { target: '#payment_method_table_body [data-payment-method-action="archive"]', available: () => can('delete_payment_methods'), title: 'Archive a payment method', description: 'Use Archive to set a payment method to inactive. Review the confirmation before proceeding.' }
        );
        steps.push({ target: `#${body} tr:has(button, a) td:last-child`, fallback: table(body), title: 'Record actions', description: 'This column contains the actions available for the record and your account. If no action is available, you can still review the record.', fallbackDescription: 'When records are available, their action column shows the tools permitted for your account. If the list is empty, add a record when your account permits it.' });
        if (section.key === 'grades') steps.push({ target: '#grade-level-pagination', title: 'Browse grade levels', description: 'Use the page controls below the list to review more grade levels when there are multiple pages.' });
    } else if (section.key === 'session_automation') {
        steps.push(
            { target: '#add-session-automation', available: () => can('create_session_automation'), title: 'Add an automation policy', description: 'Use Add Policy when no policy exists to configure automatic no-show and completion timing. Review the settings before saving.' },
            { target: table('session-automation-table'), title: 'Read the automation policy', description: 'Review the all-branches scope, automatic no-show and completion rules, effective date, and last update. Disabled indicates that automatic rule is off.' },
            { target: '[data-automation-action="edit"]', available: () => can('edit_session_automation'), title: 'Edit automation timing', description: 'Use Edit to adjust automatic no-show and completion settings. These rules affect session status updates across branches.' },
            { target: '#test-session-timing', title: 'Test the timing rules', description: 'Use Test Timing to preview the configured timing rules for a chosen date and time.' },
            { target: '#session-automation-worker', title: 'Check automation activity', description: 'Read the latest session-check status here. It reports recent checks and any issue requiring attention.' }
        );
    } else if (section.key === 'checklists') {
        steps.push(
            { target: '#btnAddReportCardType', available: () => can('edit_checklists'), title: 'Manage the ECCD checklist', description: 'Use Manage Checklist to open the editor for checklist domains and transmutation setup.' },
            { target: table('report_card_table_body'), title: 'Shared checklist cards', description: 'Review the available checklist cards and their statuses. Pre-school and Play School use the centralized ECCD checklist.' },
            { target: '#report_card_table_body [data-card-category]', available: () => can('edit_checklists'), title: 'Open a checklist editor', description: 'Use the card action to open its management editor. Open Guide on that page for an introduction to its controls.' }
        );
    } else if (section.key === 'landing') {
        steps.push(...faqSteps(can),
            { target: '[data-program-feature="landing"] a[href$="faq.html"]', title: 'Open the FAQ page', description: 'Use Open FAQ Page to manage frequently asked questions on their dedicated page.' },
            { target: '#landing-page-form', title: 'Public landing-page content', description: can('edit_landing') ? 'Review and edit public headings, contact details, highlights, announcements, images, and organization information in this form.' : 'Review the saved public landing-page content here. Editing controls are read-only for your account.' },
            { target: '#landing-page-form div:has(> #landing-hero_title)', title: 'Heading and introduction', description: 'This main heading introduces the center. The surrounding fields set the welcome label, tagline, and description.' },
            { target: '#landing-page-form div:has(> #landing-contact_number)', title: 'Public contact details', description: 'Review the email, phone number, and Facebook link used by visitors to contact the center.' },
            { target: '#landing-page-form div:has(> #landing-highlight_1_value)', title: 'Public highlights', description: 'Review the values and labels used for the followers, teachers, levels, and quality highlights.' },
            { target: '#landing-page-form div:has(> #landing-announcement_1)', title: 'Announcements and images', description: 'These fields control public announcements and image URLs. Review the content carefully before saving changes.' },
            { target: '#landing-page-form div:has(> #landing-mission)', title: 'Organization information', description: 'Review the mission, vision, and core values shown to visitors.' },
            { target: '#landing-page-save', available: () => can('edit_landing'), title: 'Save landing-page content', description: 'Use Save Landing Page Content to publish the form changes. FAQ entries are saved separately in their own form.' }
        );
    }
    return [...steps, replay];
}

export function getFaqGuide(can) {
    return [{ target: '.page-title', title: 'Frequently Asked Questions guide', description: 'Manage the questions and answers displayed on the public landing page.' }, ...faqSteps(can), replay];
}

export function getChecklistEditorGuide(can) {
    return [
        { target: '.page-title', title: 'ECCD checklist editor', description: 'Review the shared checklist structure and its transmutation setup. This guide follows the controls on your currently open tab.' },
        { target: '.top-bar a[href*="program.html"]', title: 'Return to Program', description: 'Use Back to Programs to return to program setup.' },
        { target: '#cardManagementPageRoot [role="tablist"]', title: 'Choose an editor tab', description: 'Use the tabs to switch between checklist fields and transmutation settings. Replay Guide after switching tabs to learn about that tab.' },
        { target: '#learningAreaEditor', title: 'Checklist domains', description: 'Review the development domains and checklist entries here. Use the tools available to your account to update the structure.' },
        { target: '#btnAddLearningArea', available: () => can('edit_checklists'), title: 'Add a domain', description: 'Use Add Domain to include another domain, then review its details before saving the report card.' },
        { target: '#transmutationEditor', title: 'Transmutation settings', description: 'Review the score conversion settings on this tab. Confirm any changes before saving the report card.' },
        { target: '.report-card-preview', title: 'Preview the checklist', description: 'Review the checklist preview while checking the configured domains and entries.' },
        { target: '.btn-download-card-preview', title: 'Download the checklist preview', description: 'Use Download to export the checklist preview when you need a copy.' },
        { target: '#btnSaveCardManagement', available: () => can('edit_checklists'), title: 'Save the checklist', description: 'Use Save Report Card to save checklist and transmutation changes after reviewing them.' }, replay
    ];
}

export function getAgreementGuide() {
    return [
        { target: '.page-title', title: 'Contracts and agreements', description: 'Manage agreements shown during enrollment. Previously accepted copies retain their original wording.' },
        { target: '#newAgreement', title: 'Add an agreement', description: 'Use Add Agreement to open a template editor. Set its heading, program, status, display order, and acknowledgment statements.' },
        { target: '#agreementList', title: 'Agreement templates', description: 'Review each agreement\'s heading, assigned program, and status. Inactive agreements are hidden during enrollment.' },
        { target: '[data-edit-agreement]', title: 'Edit an agreement', description: 'Use Edit to update a template. Review the statements and program assignment before saving.' },
        { target: '#agreementEditor [name="title"]', title: 'Agreement heading', description: 'Enter the heading that identifies this agreement.' },
        { target: '#agreementEditor [name="program_id"]', title: 'Assign a program', description: 'Choose the program that uses this agreement, then review its status and display order.' },
        { target: '#clauseEditor', title: 'Acknowledgment statements', description: 'Review statements and required acknowledgments. Drag a statement\'s grip to change its order.' },
        { target: '#addClause', title: 'Add a statement', description: 'Use Add statement to include another acknowledgment in the agreement.' },
        { target: '#previewAgreement', title: 'Preview the agreement', description: 'Use Preview to check the agreement wording before saving.' },
        { target: '#agreementEditor button[type="submit"]', title: 'Save the agreement', description: 'Save the template after reviewing its wording, program, status, and statement order.' },
        { target: '.header-profile-button', title: 'Replay the guide', description: 'Open your profile menu > Guide to review these controls again, including the editor controls when the editor is open.' }
    ];
}
