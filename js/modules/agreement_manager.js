import '../utilities/csrf.js';
import { initClauseSorting } from './clause_sorting.js?v=20261014-animated';
import {agreementEscape as esc} from './agreements.js';
const API = '../../api/agreements.php';
const form = document.getElementById('agreementEditor');
const list = document.getElementById('agreementList');
const clauseEditor = document.getElementById('clauseEditor');
const refreshClauseOrder = initClauseSorting(clauseEditor, document.getElementById('agreementOrderStatus'));
let templates = [];
let programs = [];
let currentId = 0;

async function request(operation, data) {
    const response = data ? await fetch(API, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({operation, data})}) : await fetch(`${API}?operation=${operation}`);
    const result = await response.json();
    if (!response.ok || result.status !== 'success') throw new Error(result.message || 'Unable to manage agreements.');
    return result.data;
}
function agreementProgramLabel(program) {
    return program ? (program.program_type ? `${program.name} (${program.program_type})` : program.name) : 'All programs';
}
function agreementProgramSelection(record) {
    if (record?.program_id) return String(record.program_id);
    if (!record || record.tutorial_setup === 'all') return 'all';
    const matches = programs.filter(program => program.tutorial_setup === record.tutorial_setup);
    return matches.length === 1 ? String(matches[0].program_id) : '';
}
function render(data) {
    templates = data.templates;
    programs = data.programs;
    form.elements.program_id.innerHTML = '<option value="" disabled>Select a program</option><option value="all">All programs</option>' + programs.map(p => `<option value="${Number(p.program_id)}">${esc(agreementProgramLabel(p))}</option>`).join('');
    list.innerHTML = templates.length ? `<div class="table-responsive"><table class="table table-custom table-hover align-middle"><thead><tr><th>Heading</th><th>Program</th><th>Status</th><th>Actions</th></tr></thead><tbody>${templates.map(t => `<tr><td>${esc(t.title)}</td><td>${esc(t.program_id ? agreementProgramLabel(programs.find(p => Number(p.program_id) === Number(t.program_id))) : ({home:'All programs (Home-based)', online:'All programs (Online)', center:'All programs (Center)'}[t.tutorial_setup] || 'All programs'))}</td><td>${esc(t.status)}</td><td><button class="btn btn-sm btn-outline-primary" type="button" data-edit-agreement="${Number(t.agreement_id)}">Edit</button></td></tr>`).join('')}</tbody></table></div>` : '<p>No agreements yet. Add a template to get started.</p>';
}
function addClause(clause = {}) {
    const row = document.createElement('div');
    row.className = 'border rounded p-3 mb-2';
    row.dataset.clauseRow = '';
    row.innerHTML = `<div class="d-flex gap-2 align-items-center mb-2"><button type="button" class="btn btn-sm clause-drag-handle" data-clause-drag-handle aria-label="Drag to reorder statement. Arrow keys also change position." title="Drag to reorder"><i class="bi bi-grip-vertical" aria-hidden="true"></i></button><strong class="small" data-clause-number></strong></div><label class="form-label w-100">Statement text <textarea class="form-control" rows="3" maxlength="10000" required>${esc(clause.clause_text || '')}</textarea></label><div class="d-flex gap-2 align-items-center flex-wrap"><label class="me-auto"><input type="checkbox" ${clause.is_required === undefined || Number(clause.is_required) ? 'checked' : ''}> Required acknowledgment</label><button type="button" class="btn btn-sm btn-outline-danger" data-remove-clause>Remove</button></div>`;
    clauseEditor.append(row);
    refreshClauseOrder();
}
function open(record) {
    currentId = Number(record?.agreement_id) || 0;
    form.reset();
    for (const name of ['title','status','display_order']) form.elements[name].value = record?.[name] ?? ({tutorial_setup:'all',status:'inactive',display_order:0}[name] ?? '');
    form.elements.program_id.value = agreementProgramSelection(record);
    clauseEditor.replaceChildren();
    (record?.clauses || [{}]).forEach(addClause);
    document.getElementById('editorHeading').textContent = currentId ? 'Edit agreement' : 'Add agreement';
    form.classList.remove('d-none');
    form.scrollIntoView({behavior:'smooth'});
}
function payload() {
    return {agreement_id:currentId, ...Object.fromEntries(new FormData(form)), clauses:[...clauseEditor.children].map(row => ({clause_text:row.querySelector('textarea').value.trim(), is_required:row.querySelector('input').checked}))};
}
document.getElementById('newAgreement').addEventListener('click', () => open());
document.getElementById('cancelAgreement').addEventListener('click', () => form.classList.add('d-none'));
document.getElementById('addClause').addEventListener('click', () => addClause());
list.addEventListener('click', event => {
    const button = event.target.closest('[data-edit-agreement]');
    if (button) open(templates.find(t => Number(t.agreement_id) === Number(button.dataset.editAgreement)));
});
clauseEditor.addEventListener('click', event => {
    const row = event.target.closest('[data-clause-row]');
    if (!row) return;
    if (event.target.closest('[data-remove-clause]')) { row.remove(); refreshClauseOrder(); }
});
document.getElementById('previewAgreement').addEventListener('click', () => {
    const record = payload();
    Swal.fire({titleText:record.title || 'Agreement preview', html:`<div class="text-start">${record.clauses.map(c => `<p style="white-space:pre-wrap">☐ ${esc(c.clause_text)}${c.is_required ? ' *' : ' (optional)'}</p>`).join('')}</div>`, width:760, customClass:{popup:'agreement-preview'}});
});
form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
        render(await request('save', payload()));
        form.classList.add('d-none');
        document.getElementById('agreementManagerMessage').textContent = 'Agreement saved. Existing acceptance records retain their original wording.';
    } catch (error) { Swal.fire('Unable to save', error.message, 'error'); }
    finally { button.disabled = false; }
});
try { render(await request('manage')); }
catch (error) { list.textContent = error.message; document.getElementById('newAgreement').disabled = true; }
