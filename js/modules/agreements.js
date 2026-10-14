const API = new URL('../../api/agreements.php', import.meta.url).href;
export const agreementEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const esc = agreementEscape;

export class AgreementForm {
    constructor(container) {
        this.container = container;
        this.templates = [];
        this.ready = false;
        this.programId = 0;
        this.request = 0;
        container.innerHTML = `<div class="agreement-form-panel border rounded p-3 my-3"><h3 class="h5">Tutorial setup & agreements</h3>
            <label class="form-label">Tutorial setup <select class="form-select" data-agreement-setup><option value="">Choose setup</option><option value="center">Center-based</option><option value="home">Home-based</option><option value="online">Online</option></select></label>
            <div data-agreement-clauses>Select a program and tutorial setup to load agreements.</div>
            <label class="form-label mt-3 d-none" data-guardian-label>Accepting parent/guardian name <input class="form-control" maxlength="255" data-agreement-guardian><small>By checking the statements and submitting, I acknowledge these agreements as the parent/guardian.</small></label></div>`;
        this.setup = container.querySelector('[data-agreement-setup]');
        this.setup.addEventListener('change', () => this.load());
        container.addEventListener('change', event => {
            if (event.target.matches('[data-agreement-select-all]')) this.selectAllStatements(event.target.checked);
            else if (event.target.matches('input[data-template]')) this.syncSelectAll();
        });
    }
    selectAllStatements(checked) {
        this.container.querySelectorAll('input[data-template]').forEach(input => { input.checked = checked; });
        this.syncSelectAll();
    }
    syncSelectAll() {
        const control = this.container.querySelector('[data-agreement-select-all]');
        if (!control) return;
        const statements = [...this.container.querySelectorAll('input[data-template]')];
        const count = statements.filter(input => input.checked).length;
        control.checked = statements.length > 0 && count === statements.length;
        control.indeterminate = count > 0 && count < statements.length;
    }
    setProgram(programId, guardianName = '', programType = '') {
        const id = Number(programId) || 0;
        const name = this.container.querySelector('[data-agreement-guardian]');
        if (!name.value) name.value = guardianName;
        const type = String(programType).toLowerCase();
        const expected = /home|house/.test(type) ? 'home' : /online/.test(type) ? 'online' : /center|centre|pre.?school|play.?school/.test(type) ? 'center' : '';
        this.setup.disabled = Boolean(expected);
        const changed = this.programId !== id || (expected && this.setup.value !== expected);
        if (expected) this.setup.value = expected;
        if (changed) { this.programId = id; this.load(); }
    }
    async load() {
        const generation = ++this.request;
        const body = this.container.querySelector('[data-agreement-clauses]');
        this.ready = false;
        this.templates = [];
        this.container.querySelector('[data-guardian-label]').classList.add('d-none');
        if (!this.programId || !this.setup.value) { body.textContent = 'Select a program and tutorial setup to load agreements.'; return; }
        body.textContent = 'Loading agreements…';
        try {
            const url = new URL(API);
            url.search = new URLSearchParams({operation:'applicable', program_id:this.programId, tutorial_setup:this.setup.value});
            const response = await fetch(url);
            const result = await response.json();
            if (generation !== this.request) return;
            if (!response.ok || result.status !== 'success') throw new Error(result.message || 'Unable to load agreements.');
            this.templates = result.data;
            this.ready = true;
            body.innerHTML = this.templates.length ? this.templates.map(template => `<section class="my-3"><h4 class="h5">${esc(template.title)}</h4>${template.clauses.map(clause => `<label class="d-flex gap-2 my-3"><input class="form-check-input flex-shrink-0" type="checkbox" data-template="${Number(template.agreement_id)}" value="${Number(clause.clause_id)}"><span style="white-space:pre-wrap">${esc(clause.clause_text)}${Number(clause.is_required) ? ' <span class="text-danger">*</span>' : ' <small>(optional)</small>'}</span></label>`).join('')}</section>`).join('') : '<p>No agreement is currently required for this program and setup.</p>';
            if (this.templates.some(template => template.clauses.length)) {
                body.insertAdjacentHTML('afterbegin', '<label class="d-flex align-items-center gap-2 border-bottom pb-3 mt-3 fw-semibold"><input type="checkbox" class="form-check-input" data-agreement-select-all><span>Select all statements</span></label>');
            }
            this.container.querySelector('[data-guardian-label]').classList.toggle('d-none', !this.templates.length);
        } catch (error) {
            if (generation !== this.request) return;
            body.innerHTML = `<p class="text-danger">${esc(error.message)}</p><button type="button" class="btn btn-outline-secondary btn-sm" data-agreement-retry>Retry</button>`;
            body.querySelector('button').addEventListener('click', () => this.load());
        }
    }
    payload() {
        if (!this.setup.value) throw new Error('Choose the tutorial setup.');
        if (!this.ready) throw new Error('Wait for agreements to load, or retry loading them.');
        const guardian = this.container.querySelector('[data-agreement-guardian]').value.trim();
        if (this.templates.length && !guardian) throw new Error('Enter the accepting parent/guardian name.');
        const agreements = this.templates.map(template => {
            const checked = [...this.container.querySelectorAll(`input[data-template="${Number(template.agreement_id)}"]:checked`)].map(input => Number(input.value));
            if (template.clauses.some(clause => Number(clause.is_required) && !checked.includes(Number(clause.clause_id)))) throw new Error('Acknowledge every required agreement statement.');
            return {agreement_id:template.agreement_id, content_hash:template.content_hash, checked_clause_ids:checked};
        });
        return {tutorial_setup:this.setup.value, agreement_guardian_name:guardian, agreements};
    }
}

export function agreementRecordsHtml(records) {
    return records.map(record => `<article class="agreement-record border rounded p-3 mb-3"><h3 class="h5">${esc(record.snapshot.title)}</h3><p class="text-muted">${esc(record.application_number || '')} · ${esc(record.tutorial_setup)} · Accepted by ${esc(record.guardian_name)} on ${esc(record.accepted_at)} (Asia/Manila)</p>${record.snapshot.clauses.map(clause => `<p style="white-space:pre-wrap">${record.checked_clause_ids.map(Number).includes(Number(clause.clause_id)) ? '☑' : '☐'} ${esc(clause.clause_text)}</p>`).join('')}</article>`).join('');
}

export function appendAgreementLink(container, enrollmentId) {
    if (!container || !enrollmentId) return;
    container.querySelector('[data-saved-agreement-link]')?.remove();
    const link = document.createElement('a');
    const url = new URL('../../html/shared/agreements.html', import.meta.url);
    url.searchParams.set('enrollment_details_id', enrollmentId);
    link.href = url.href;
    link.className = 'btn agreement-view-link my-3';
    link.dataset.savedAgreementLink = '';
    link.textContent = 'View agreements';
    const icon = document.createElement('i');
    icon.className = 'bi bi-file-earmark-check';
    icon.setAttribute('aria-hidden', 'true');
    link.prepend(icon);
    container.append(link);
}

export async function loadAgreementRecords(params = {}, operation = 'records') {
    const url = new URL(API);
    url.search = new URLSearchParams({...params, operation});
    const response = await fetch(url);
    const result = await response.json();
    if (!response.ok || result.status !== 'success') throw new Error(result.message || 'Unable to load agreements.');
    return result.data;
}

export function currentAgreementsHtml(templates) {
    return templates.map(template => `<article class="agreement-record border rounded p-3 mb-3"><h3 class="h5">${esc(template.title)}</h3>${template.clauses.map(clause => `<p style="white-space:pre-wrap">${esc(clause.clause_text)}</p>`).join('')}</article>`).join('');
}

export function pendingAgreementsHtml(templates, canAccept) {
    return templates.map(template => `<article class="agreement-record border rounded p-3 mb-3"><h3 class="h5">${esc(template.title)}</h3>${template.clauses.map(clause => canAccept
        ? `<label class="d-flex gap-2 my-3"><input type="checkbox" class="form-check-input flex-shrink-0" data-template="${Number(template.agreement_id)}" value="${Number(clause.clause_id)}"><span style="white-space:pre-wrap">${esc(clause.clause_text)}${Number(clause.is_required) ? ' <span class="text-danger">*</span>' : ' <small>(optional)</small>'}</span></label>`
        : `<p style="white-space:pre-wrap">${esc(clause.clause_text)}</p>`).join('')}</article>`).join('');
}

export function enrollmentAgreementPayload(container, templates, setup) {
    const guardian = container.querySelector('[data-agreement-guardian]').value.trim();
    if (!guardian) throw new Error('Enter the accepting parent/guardian name.');
    if (!setup) throw new Error('Choose the tutorial setup.');
    const agreements = templates.map(template => {
        const checked = [...container.querySelectorAll(`input[data-template="${Number(template.agreement_id)}"]:checked`)].map(input => Number(input.value));
        if (template.clauses.some(clause => Number(clause.is_required) && !checked.includes(Number(clause.clause_id)))) throw new Error('Acknowledge every required agreement statement.');
        return {agreement_id:template.agreement_id, content_hash:template.content_hash, checked_clause_ids:checked};
    });
    return {tutorial_setup:setup, agreement_guardian_name:guardian, agreements};
}

export async function submitEnrollmentAgreements(enrollmentId, data) {
    const cookie = document.cookie.split('; ').find(part => part.startsWith('cdo_csrf='));
    const token = cookie ? decodeURIComponent(cookie.slice('cdo_csrf='.length)) : '';
    const response = await fetch(API, {method:'POST', headers:{'Content-Type':'application/json', 'X-CSRF-Token':token},
        body:JSON.stringify({operation:'acceptEnrollmentAgreements', enrollment_details_id:enrollmentId, data})});
    const result = await response.json();
    if (!response.ok || result.status !== 'success') throw new Error(result.message || 'Unable to save agreement acceptance.');
    return result.data;
}
