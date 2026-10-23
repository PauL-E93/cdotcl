export function getStudentProfileGuide() {
    return [
        { target: '.page-title', title: 'Your student profile', description: 'Review your personal information, guardian contacts, and account security here. Check that your details are current so the center can contact you.' },
        { target: '.profile-summary-row', title: 'Your profile summary', description: 'Review your picture, name, role, email, and contact number. Use Edit Profile when details need updating.' },
        ...[
            ['bi-person', 'Personal information', 'Check your name, student ID, LRN, username, age, and nickname.'],
            ['bi-people', 'Guardian details', 'Verify your guardian’s name, relationship, and contact number.'],
            ['bi-mortarboard', 'Student details', 'Review your birthday, gender, role, and displayed status.'],
            ['bi-telephone', 'Contact details', 'Check your email, contact number, and address.'],
            ['bi-shield-lock', 'Password security', 'Review the password change due date and days remaining. Use Password to change your password when needed.']
        ].map(([icon, title, description]) => ({ target: `.profile-card:has(.section-title .${icon})`, title, description })),
        { target: '#editProfileBtn', title: 'Update your information', description: 'After the tour, Edit Profile opens your editable personal and guardian details, picture, and health note. Review the form before Save Changes. Changing your email may require your current password.' },
        { target: '#passwordStudentProfileBtn', title: 'Change your password', description: 'Open Password to review the password form and its requirements. Submit only after checking your current password and the matching new password fields.' },
        { target: '.header-profile-button', title: 'Your profile menu', description: 'Open this menu from any page to return to Profile, replay that page’s Guide, or log out.' }
    ];
}

export function getEnrollmentRequestGuide() {
    return [
        { target: '.request-topbar, #studentEnrollmentRequestModal .modal-header', title: 'Your enrollment request', description: 'The request follows three stages: initial payment proof, learning preferences, and center review. This guide explains the stage currently visible without submitting or changing your request.' },
        { target: '.request-steps', title: 'Follow your request’s progress', description: 'The highlighted stage shows where you are. Recording payment proof and submitting your preferences are separate steps; the center confirms the teacher and final schedule.' },
        { target: '#requestProgram', title: 'Choose a tutorial program', description: 'Choose the program you want to request. Check its program fee and required downpayment before paying.' },
        { target: '#requestBranch', title: 'Choose your preferred center', description: 'Select the center that should review your enrollment request.' },
        { target: '.request-fee-grid', title: 'Review the required payment', description: 'Compare the program fee with Required now. Pay at least the displayed downpayment; you may pay a higher amount or the full fee.' },
        { target: '#requestGcashAccount', title: 'Check the payment destination', description: 'Verify the GCash account displayed here before transferring money. Use the provided account or QR tools when available.' },
        { target: '.request-upload', title: 'Attach your payment proof', description: 'Upload your GCash payment screenshot using the accepted image formats and size shown here. Make sure the amount and reference number are readable.' },
        { target: '#requestReadReceipt', title: 'Read the receipt', description: 'Use Read receipt to detect the amount and reference number from your screenshot. Check the detected values yourself before continuing.' },
        { target: '#requestPaymentAmount', title: 'Verify the amount paid', description: 'Enter the amount actually transferred. It must meet the required downpayment shown for your chosen program.' },
        { target: '#requestReference', title: 'Verify the reference number', description: 'Copy the GCash reference number exactly from your receipt and follow the length requirements shown by the form.' },
        { target: '#payAndContinue', title: 'Record proof and continue', description: 'Pay & Continue submits the payment information and proof. Review everything first. When the receipt is shown, continue to the learning preferences; the center still needs to review your request.' },
        { target: '.request-payment-complete', title: 'Payment proof recorded', description: 'This summary identifies the paid program. Continue with the preferences below to forward the request for center review.' },
        { target: '#detailsGrade', title: 'Your grade level', description: 'Select the student’s grade level so the center can review appropriate learning options.' },
        { target: '#detailsSubjects', title: 'Choose subjects', description: 'Select the subjects you want to study from the available program options.' },
        { target: '[data-request-step="2"] .request-panel:has(#detailsPreferredTeacher)', title: 'Teacher and learning preferences', description: 'Check your selected program and center, choose a preferred teacher when available, and describe your learning goal. A teacher preference is a request; the center makes the final assignment.' },
        { target: '#preferredSessionHours', title: 'Preferred meeting duration', description: 'Choose how long each meeting should last. Read the note below for how that duration uses the program’s total hours. The center confirms the final schedule.' },
        { target: '.request-availability-builder', title: 'Add weekly availability', description: 'Choose a weekday and a start and end time, then use Add. These are windows when you can attend, which the center uses when plotting actual sessions.' },
        { target: '#availabilityList', title: 'Review your available times', description: 'Check every availability entry and remove incorrect ones before submitting. These preferences do not reserve a confirmed class time.' },
        { target: '#existingStudentAgreements:not(:empty)', title: 'Review the agreements', description: 'Read the displayed enrollment agreements and complete the required acknowledgments before submitting.' },
        { target: '#submitForReview', title: 'Forward to the center', description: 'Submit for Center Review sends your learning preferences and availability for staff review. Check all required fields and agreements first. Use Finish later if you need to return to your enrollment list.' },
        { target: '.request-success', title: 'Await center review', description: 'Your request has been forwarded. Staff will review the payment and preferences, assign the actual teacher, and plot the schedule. Use View Enrollments to follow its status.' },
        { target: '.request-back-link', title: 'Return to your enrollments', description: 'Use Enrollment list to return to your records. Leaving the page does not submit an unfinished form.' }
    ];
}
