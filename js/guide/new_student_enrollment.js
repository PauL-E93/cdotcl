import { startTour } from './tour.js?v=20261023-session-guides';

// Read the visible form each time. A tour never advances or submits the application.
export function getNewStudentEnrollmentGuide() {
    const section = document.querySelector('.form-step.active[data-form-step]');
    if (!section) return [];
    const number = section.dataset.formStep;
    const scope = `.form-step.active[data-form-step="${number}"]`;
    const step = (target, title, description) => ({ target: `${scope} ${target}`, title, description });
    const intro = (title, description) => step('.form-section-heading, .verification-panel h2, .status-hero h2', title, description);
    const guides = {
        1: [
            intro('Student information', 'This guide explains the current page. Close it to fill in the form; your entries stay in place. Fields marked with an asterisk are required.'),
            step('.row:has(#firstName)', 'Student identity', 'Enter the student’s complete name as it should appear on the enrollment record. Check the birthdate carefully; students must be at least two years old. Choose gender and add health or learning considerations when relevant.'),
            step('.row:has(#guardianName)', 'Parent or guardian', 'Enter the responsible adult’s full name, relationship, contact number, and email. For a Philippine mobile number, enter the ten digits beginning with 9 after +63.'),
            step('#otherGuardianRelationshipField', 'Specify the relationship', 'When you choose Other, enter the actual relationship here, such as Aunt or Uncle.'),
            step('#email', 'An email you can access', 'Use an active parent or guardian email. The next page verifies it with a code. The same email may be used for multiple children; check each child’s own name and birthdate.'),
            step('.row:has(#province)', 'Home address', 'Choose Province first, then City/Municipality and Barangay as their choices load. Enter the house/street and add a landmark or address note if useful.'),
            step('.application-notice:has(.bi-shield-check)', 'Student portal access', 'The student account is created only after the application becomes fully enrolled. Login details are sent to the verified parent or guardian email.'),
            step('#continueToVerification', 'Check and continue', 'Use Check & Continue after completing this page. Review any highlighted validation messages. This checks your information before proceeding to email verification; it does not finalize enrollment.')
        ],
        2: [
            intro('Email verification', 'Verify the parent or guardian email before continuing. This guide explains the controls without sending a code or changing verification.'),
            step('#verificationEmailLabel', 'Check the destination email', 'Confirm the address shown here is yours and is spelled correctly. Use Back to correct the email on Student Information if necessary.'),
            step('#sendOtpButton', 'Send or resend a code', 'Select Send Verification Code, then check the email inbox and spam folder. Follow any resend countdown shown by the button. The six-digit code expires after ten minutes.'),
            step('#otpEntry', 'Enter and verify the code', 'Enter the latest six-digit code in Verification code, then select Verify Email. Wait for the result; do not enter your email password here.'),
            step('#verificationSuccess', 'Verification completed', 'This message confirms the email was verified. You can now continue to Learning Preferences.'),
            step('.form-actions', 'Continue when verified', 'Continue becomes available after successful verification. Back returns to Student Information. Opening this guide does not bypass email verification.')
        ],
        3: [
            intro('Learning preferences', 'Choose the program and preferred center here. Tutorial-specific fields appear when a Tutorial program is selected. Replay Guide after changing the program to see help for the fields now displayed.'),
            step('#program', 'Choose a program', 'Select the program you want to apply for. Read its summary for details. Different programs can show different preferences, agreements, and billing amounts.'),
            step('#branch', 'Choose your preferred center', 'Select the center where you want the student to enroll. Review the center information shown below the selection.'),
            step('#gradeLevel', 'Tutorial grade level', 'Choose the student’s grade level for the Tutorial program. If an expected option is missing, contact the center for help.'),
            step('#subjectMultiSelect', 'Select tutorial subjects', 'Open Subjects and choose one or more subjects you want help with. Read the selected-subject summary after closing the list. If you select Others, enter the requested subject in the extra field.'),
            step('#otherSubjectField', 'Request another subject', 'Type the subject you want to study. The center will review this request and check teacher availability; it is not an automatic confirmation.'),
            step('#goal', 'Describe the learning goal', 'Explain what you want the student to improve, such as reading comprehension or confidence with mathematics. This helps the center understand the request.'),
            step('#preferredSessionHours', 'Choose session duration', 'Choose the preferred length of each tutorial session. Read the duration note for the program’s consumable hours and examples. The center confirms the final schedule.'),
            step('.availability-builder', 'Add weekly availability', 'Choose a day and the student’s available start and end times, then select Add. Repeat for other available days. Typing times alone does not add them to the list.'),
            step('#availabilityList', 'Review the saved preference list', 'Check every listed day and time range. Remove incorrect entries and add the correct ones. Tutorial applications need at least one availability entry; these are preferences, not confirmed appointments.'),
            step('#newStudentAgreements [data-agreement-setup]', 'Choose the tutorial setup', 'Select Center-based, Home-based, or Online as offered. Read the agreements that load for the selected program and setup.'),
            step('#newStudentAgreements .agreement-form-panel', 'Read and accept the agreements', 'Review the statements, fill in the accepting parent or guardian name when requested, and check the required acknowledgments only after reading them. If agreements cannot load, use the offered Retry control.'),
            step('#reviewBillingButton', 'Review billing next', 'Select Review Billing after checking your preferences and required agreements. This loads the fee breakdown for review before you submit the application.')
        ],
        4: [
            intro('Billing overview', 'Review the selected program, fees, and payment instructions before submission. This guide does not make a payment or submit your application.'),
            step('#applicationBillingPanel .billing-statement header', 'Confirm the student and program', 'Check that the billing statement belongs to the correct student and selected program. Before submission, use Back if you need to correct learning preferences.'),
            step('#applicationBillingPanel .billing-fee-grid', 'Review the fee breakdown', 'Read the registration fee, program downpayment, and remaining tuition or monthly fees shown for this program. Required now and later charges are shown separately.'),
            step('#applicationBillingPanel .billing-discount-section', 'Applied discount or promo', 'Check the discount displayed in the statement. Use the shown amount in your review; do not assume another promotion applies automatically.'),
            step('#applicationBillingPanel .billing-service-card', 'Optional monthly service', 'Review the available service and monthly amount. Before submission, use the switch to include or remove it when offered, then check the recalculated statement. Applied services are added to monthly bills.'),
            step('#applicationBillingPanel .billing-totals', 'Amount due now', 'Compare Program total with Amount due now. The registration fee and downpayment are required now; review the remaining balance and later charges separately.'),
            step('#applicationPaymentMethod', 'Choose how to pay', 'Select an available payment method. Cash and online methods show different instructions. The guide only explains the method currently displayed; replay it after changing the selection for more specific help.'),
            step('#applicationPaymentDetail', 'Follow the payment instructions', 'For Cash, visit your selected center and follow its collection instructions. For online payment, verify the displayed account details and QR code before transferring, then provide the requested receipt information.'),
            step('#applicationGcashScreenshot', 'Attach payment proof', 'Choose a clear supported image of the completed payment receipt. Payment screenshots must be selected again after a refresh; they are not restored with the draft.'),
            step('#applicationRunOcr', 'Read the receipt', 'For GCash, Read Receipt can suggest the amount and reference number. Check the result against the original receipt and correct it before submission.'),
            step('.application-gcash-fields', 'Verify amount and reference', 'Enter the amount and transaction reference exactly as shown on the receipt. Check for typing errors and do not use another payment’s reference number.'),
            step('#submitApplicationButton', 'Submit the application', 'After reviewing the student, preferences, agreements, statement, and payment details, select Submit Application once and wait for the result. Submission still requires the center’s review; it does not immediately mean enrolled.'),
            step('#viewPublicPaymentReceipt', 'Official receipt', 'When the center has approved the payment and a receipt is available, use View Official Receipt to inspect it. A submitted screenshot is different from an approved official receipt.'),
            step('#continueToApplicationStatus', 'View the application status', 'Your application has been submitted or opened for tracking. Select Application Status to read its current result and next instructions.')
        ],
        5: [
            intro('Application status', 'Read the current status and follow the center’s next instructions. Keep the application number for future tracking.'),
            step('.status-hero .application-eyebrow', 'Application number', 'Save this application number. Track Application asks for it together with the student’s submitted name and birthdate.'),
            step('.status-details', 'Check the application details', 'Confirm the student, student ID when available, program, and center. Contact the center if a submitted detail needs correction.'),
            step('.next-step-card', 'Follow the next step', 'Read the action requested for this application and any center notes. Payment review, scheduling, and final enrollment can be separate stages.'),
            step('#refreshApplicationStatus', 'Refresh the result', 'Use Refresh Status to check for updates. The guide does not refresh or alter the application itself.'),
            step('.status-hero a[href="login.html"]', 'Student portal login', 'Student Login is offered once the application is enrolled. Use the credentials sent to the verified email and follow the login instructions.'),
            step('#startAnotherApplication', 'Apply for another child', 'Use this only when you are ready to start a separate child’s application. Keep the current application number before starting another.')
        ]
    };
    return [
        ...(guides[number] || []),
        { target: '#enrollmentGuideButton', title: 'Help for the page you are on', description: 'Finish or skip this tour to continue filling in the form. Click this Guide button whenever you need help on the current step. Back and Next in the tour only move between explanations; they do not change your application step.' }
    ];
}

document.getElementById('enrollmentGuideButton')?.addEventListener('click', event => {
    startTour(getNewStudentEnrollmentGuide(), event.currentTarget);
});
