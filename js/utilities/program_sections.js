export const PROGRAM_SECTIONS = [
    { key: 'programs', label: 'Program', permission: 'view_programs' },
    { key: 'session_automation', label: 'Session Automation', permission: 'view_session_automation' },
    { key: 'types', label: 'Program Type', permission: 'view_types' },
    { key: 'grades', label: 'Grade Levels', permission: 'view_grades' },
    { key: 'subjects', label: 'Subjects', permission: 'view_subjects' },
    { key: 'services', label: 'Services', permission: 'view_services' },
    { key: 'checklists', label: 'ECCD Checklists', permission: 'view_checklists' },
    { key: 'discounts', label: 'Discounts', permission: 'view_discounts' },
    { key: 'registration', label: 'Registration Amount', permission: 'view_registration' },
    { key: 'payment_methods', label: 'Payment Methods', permission: 'view_payment_methods' },
    { key: 'landing', label: 'Landing Page & FAQs', permission: 'view_landing' }
];

export function resolveProgramSection(hash, availableSections) {
    const key = String(hash || '').replace(/^#/, '');
    return availableSections.find(section => section.key === key) || availableSections[0] || null;
}
