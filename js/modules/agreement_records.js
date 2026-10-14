import {loadAgreementRecords, agreementRecordsHtml, pendingAgreementsHtml, enrollmentAgreementPayload, submitEnrollmentAgreements} from './agreements.js?v=20261014-parent-acceptance';
import {downloadAgreementPdf} from './agreement_pdf.js?v=20261014-download';
const container = document.getElementById('agreementRecords');
const downloadButton = document.getElementById('downloadAgreements');
let pdfRecords = null;
downloadButton.addEventListener('click', () => {
    if (!pdfRecords) return;
    try {
        const reference = params.enrollment_details_id ? `Enrollment ${params.enrollment_details_id}` : params.application_id ? `Application ${params.application_id}` : '';
        downloadAgreementPdf(pdfRecords, reference);
    } catch (error) { window.alert(error.message); }
});
const query = new URLSearchParams(location.search);
const params = {};
for (const key of ['application_id','enrollment_details_id']) if (query.has(key)) params[key] = query.get(key);
async function renderEnrollment(setup = '', saved = false) {
    const request = {enrollment_details_id:params.enrollment_details_id};
    if (setup) request.tutorial_setup = setup;
    const state = await loadAgreementRecords(request, 'getEnrollmentAgreements');
    const {pending, accepted, can_accept, tutorial_setup} = state;
    pdfRecords = {pending, accepted};
    downloadButton.disabled = false;
    const needsSetup = can_accept && !tutorial_setup;
    container.innerHTML = (saved ? '<p class="alert alert-success" role="status">Your agreement acceptance has been saved.</p>' : '')
        + (needsSetup ? '<label class="form-label">Tutorial setup <select class="form-select" data-enrollment-setup><option value="">Choose setup</option><option value="center">Center-based</option><option value="home">Home-based</option><option value="online">Online</option></select></label>' : '')
        + `<h2 class="h4">${can_accept ? 'Needs your agreement' : 'Awaiting parent agreement'}</h2>`
        + (pending.length ? `<form data-enrollment-agreements>${pendingAgreementsHtml(pending, can_accept && !needsSetup)}${can_accept && !needsSetup
            ? '<label class="form-label">Accepting parent/guardian name <input class="form-control" maxlength="255" data-agreement-guardian></label><p>By checking the statements and selecting Accept agreements, I acknowledge these agreements as the parent/guardian. Statements marked * are required.</p><p class="text-danger" role="alert" data-acceptance-error></p><button class="btn btn-primary" type="submit">Accept agreements</button>'
            : '<p>The parent/guardian must review and accept these agreements through the student account.</p>'}</form>`
            : '<p>No agreements are awaiting acceptance.</p>')
        + '<h2 class="h4 mt-4">Accepted agreements</h2>'
        + (accepted.length ? agreementRecordsHtml(accepted) : '<p>No accepted agreement is recorded for this enrollment.</p>');
    container.querySelector('[data-enrollment-setup]')?.addEventListener('change', async event => {
        try { await renderEnrollment(event.target.value); }
        catch (error) { container.textContent = error.message; }
    });
    const form = container.querySelector('[data-enrollment-agreements]');
    if (can_accept && !needsSetup && form) form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const message = form.querySelector('[data-acceptance-error]');
        button.disabled = true;
        message.textContent = '';
        try {
            const payload = enrollmentAgreementPayload(form, pending, tutorial_setup);
            await submitEnrollmentAgreements(params.enrollment_details_id, payload);
        } catch (error) {
            message.textContent = error.message;
            button.disabled = false;
            return;
        }
        try { await renderEnrollment(tutorial_setup, true); }
        catch (error) { container.textContent = 'Your acceptance was saved. Refresh this page to view the saved agreements.'; }
    });
}
try {
    if (params.enrollment_details_id) {
        document.title = 'Enrollment Agreements | CDO Tutor';
        document.querySelector('.agreement-records-toolbar h1').textContent = 'Enrollment Agreements';
        document.querySelector('.agreement-records-toolbar p').textContent = 'Review and accept the agreements assigned to this enrollment.';
        await renderEnrollment();
    } else {
        const records = await loadAgreementRecords(params);
        pdfRecords = {accepted:records};
        downloadButton.disabled = false;
        container.innerHTML = records.length ? agreementRecordsHtml(records) : '<p>No accepted agreement is recorded. Older enrollments may predate agreement collection.</p>';
    }
} catch (error) { container.textContent = error.message; }
