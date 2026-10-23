export function getPaymentGuide({ student, preschool, can }) {
    const program = preschool ? 'Pre-school / Play-school' : 'Tutorial';
    const actions = ['View opens the payment history.'];
    actions.push(can('create') ? 'Pay opens billing and payment options when the record is ready for payment.' : 'View Billing opens the billing statement.');
    if (can('view_assessment')) actions.push('Assessment opens the payment assessment.');
    if (can('export')) actions.push('Export downloads the record\'s billing statement.');

    return [
        { target: '.page-title', title: `${program} payment guide`, description: student ? `Review your ${program} billing, balances, and payment status. This tour introduces the tools available on this page.` : `Review ${program} payment schedules, billing records, and submitted payments. This tour follows the tools available to your account.` },
        { target: '#search-input', title: 'Find a payment record', description: student ? 'Search by subject or teacher to narrow your enrollment payment list. Clear Search to show the records matching your current filters again.' : 'Use Search to narrow the enrollment and payment list. Clear the search to show the records matching your filters again.' },
        { target: '.filter-container', title: 'Filter the list', description: student ? 'Combine the available status, subject, and teacher filters with your search. On a small screen, use Filter & Sort to show the filters.' : 'Use the available status, subject, and branch filters to narrow the list. On a small screen, use Filter & Sort to show the filters.' },
        { target: '#enrollment-apply-filters', title: 'Apply your filters', description: 'Use Apply Filters to refresh the list with your current search and filter selections.' },
        { target: '.payment-summary-grid', title: 'Payment summary', description: 'These cards group payments by their due date or review status. After the tour, select a card to open its matching payment list; this is separate from the enrollment table below.' },
        { target: '.payment-summary-card[data-category="pending"]', title: 'Pending payments', description: 'Open Pending to review payments scheduled for a future date.' },
        { target: '.payment-summary-card[data-category="due_today"]', title: 'Payments due today', description: 'Open Due today to review payments due today.' },
        { target: '.payment-summary-card[data-category="due_tomorrow"]', title: 'Payments due tomorrow', description: 'Open Due tomorrow to review upcoming payments due tomorrow.' },
        { target: '.payment-summary-card[data-category="overdue"]', title: 'Overdue payments', description: 'Open Over due to review payments past their due date. Open a record\'s billing details to review the amounts shown.' },
        { target: '.payment-summary-card[data-category="to_receive"]', available: () => !student && can('approve'), title: 'Payments awaiting confirmation', description: 'Open To Receive Payment to review submitted payments awaiting confirmation. Open a record to inspect its payment details and the approval actions available to you.' },
        { target: '.payment-summary-card[data-category="pending_review"]', available: () => student, title: 'Payments pending review', description: 'Open Pending Review to check GCash payments waiting for the center\'s review. A submitted payment is not yet a confirmed payment.' },
        { target: '#export-enrollment-table', available: () => !student && can('export'), title: 'Export the payment list', description: 'Use Export to download the list. Review the available scope and format options before exporting.' },
        { target: 'table:has(#paymentTableBody)', title: student ? 'Your enrollment balances' : 'Enrollment and payment records', description: student ? 'Review each program and subject, total amount, paid amount, balance, and current status.' : (preschool ? 'Review each student\'s section, class, enrollment date, and status. Use a row\'s actions to open its billing and payment information.' : 'Review each student\'s subject, tutor, enrollment date, and status. Use a row\'s actions to open its billing and payment information.') },
        {
            target: '#paymentTableBody [data-bs-toggle="dropdown"], #paymentTableBody [data-payment-action]',
            fallback: 'table:has(#paymentTableBody)',
            title: 'Payment record actions',
            description: student ? 'After the tour, use a row\'s buttons or three-dot menu. Depending on its status, you can open billing, pay, review payment history, or complete an unfinished enrollment. Review the available options before continuing.' : `After the tour, open a row's three-dot menu. Available actions depend on the record and your account. ${actions.join(' ')}`,
            fallbackDescription: 'When records appear, their Actions column shows the options available for that record and your account. Try adjusting your search or filters if the list is empty.'
        },
        { target: '#paymentTableBody [data-payment-action="billing"]', available: () => student, title: 'Open your billing statement', description: 'Use Pay or View Billing to review the billing statement and available payment options. Review the amounts and details before submitting a payment.' },
        { target: '#paymentTableBody [data-payment-action="history"]', available: () => student, title: 'Review your payment history', description: 'Use View to review your payment history and statuses. Proofs and receipts are available when the record supports them.' },
        { target: '.content-panel .d-flex.justify-content-between:has(nav)', title: 'Browse more records', description: 'Use the page controls below the table to browse more records matching your current search and filters.' },
        { target: '.header-profile-button', title: 'Guide for both payment pages', description: 'Open your profile menu > Guide on either payment page to replay its walkthrough. The tour does not submit payments, approve records, or change your filters.' }
    ];
}
