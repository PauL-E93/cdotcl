import { buildAppUrl } from '../utilities/app_url.js';
import { canUseProgramPermission, guardProgramPermission } from './program_rbac.js?v=20261001-payment-view-only';

const ADMIN_API_URL = '../../api/admin/faq.php';
let faqRecords = [];

function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function renderPublicFaqs(faqs) {
    const container = document.querySelector('[data-faq-list]');
    if (!container) return;
    if (!Array.isArray(faqs) || faqs.length === 0) {
        container.innerHTML = '<p class="faq-empty">No frequently asked questions are available yet.</p>';
        return;
    }
    container.innerHTML = faqs.map((faq, index) => `
        <details class="faq-item" ${index === 0 ? 'open' : ''}>
            <summary><span>${escapeHtml(faq.question)}</span><span class="faq-item__icon" aria-hidden="true">+</span></summary>
            <div class="faq-item__answer"><p>${escapeHtml(faq.answer).replace(/\r?\n/g, '<br>')}</p></div>
        </details>
    `).join('');
}

export async function initFaqLanding() {
    if (!document.querySelector('[data-faq-list]')) return;
    try {
        const response = await fetch(buildAppUrl('api/admin/faq.php?operation=getPublicFaqs'), { headers: { Accept: 'application/json' } });
        const result = await response.json();
        if (!response.ok || result.status !== 'success') throw new Error(result.message || 'Unable to load FAQs.');
        renderPublicFaqs(result.data || []);
    } catch (error) {
        console.error('Unable to load FAQs:', error);
        renderPublicFaqs([]);
    }
}

function renderManagerTable() {
    const body = document.getElementById('faq_table_body');
    if (!body) return;
    if (faqRecords.length === 0) {
        body.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">No FAQs found. Add the first question to display it on the landing page.</td></tr>';
        return;
    }
    body.innerHTML = faqRecords.map(faq => {
        const active = faq.status === 'active';
        return `<tr>
            <td class="fw-semibold">${escapeHtml(faq.question)}</td>
            <td class="text-wrap" style="min-width:260px">${escapeHtml(faq.answer)}</td>
            <td>${Number(faq.display_order) || 0}</td>
            <td><span class="badge ${active ? 'bg-success' : 'bg-secondary'}">${active ? 'Active' : 'Inactive'}</span></td>
            <td class="text-center text-nowrap">
                <button type="button" class="btn btn-sm btn-outline-primary me-1" data-faq-edit="${faq.faq_id}" aria-label="Edit FAQ"><i class="bi bi-pencil-square"></i></button>
                ${active ? `<button type="button" class="btn btn-sm btn-outline-warning" data-faq-archive="${faq.faq_id}" aria-label="Archive FAQ"><i class="bi bi-archive me-1"></i>Archive</button>` : ''}
            </td>
        </tr>`;
    }).join('');
}

async function loadManagerFaqs() {
    const body = document.getElementById('faq_table_body');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="5" class="text-center py-4">Loading FAQs...</td></tr>';
    try {
        const response = await axios.get(ADMIN_API_URL, { params: { operation: 'getFaqs' } });
        if (response.data?.status !== 'success') throw new Error(response.data?.message || 'Unable to load FAQs.');
        faqRecords = response.data.data || [];
        renderManagerTable();
    } catch (error) {
        console.error('Unable to load FAQ manager:', error);
        body.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">${escapeHtml(error.response?.data?.message || error.message || 'Unable to load FAQs.')}</td></tr>`;
    }
}

function openFaqModal(record = null) {
    if (!guardProgramPermission('edit_landing', 'You do not have permission to manage landing-page FAQs.')) return;
    const element = document.getElementById('faqModal');
    if (!element) return;
    const form = document.getElementById('faqForm');
    form.reset();
    form.dataset.faqId = record?.faq_id || '';
    document.getElementById('faqModalLabel').textContent = record ? 'Edit FAQ' : 'Add FAQ';
    document.getElementById('faqQuestion').value = record?.question || '';
    document.getElementById('faqAnswer').value = record?.answer || '';
    document.getElementById('faqDisplayOrder').value = record?.display_order ?? faqRecords.length + 1;
    document.getElementById('faqStatus').value = record?.status || 'active';
    bootstrap.Modal.getOrCreateInstance(element).show();
}

async function saveFaq(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const id = Number(form.dataset.faqId || 0);
    const payload = {
        question: document.getElementById('faqQuestion').value.trim(),
        answer: document.getElementById('faqAnswer').value.trim(),
        display_order: Number(document.getElementById('faqDisplayOrder').value || 0),
        status: document.getElementById('faqStatus').value
    };
    if (id) payload.faq_id = id;
    try {
        const response = await axios.post(ADMIN_API_URL, { operation: id ? 'updateFaq' : 'insertFaq', json: JSON.stringify(payload) });
        if (response.data?.status !== 'success') throw new Error(response.data?.message || 'Unable to save FAQ.');
        bootstrap.Modal.getInstance(document.getElementById('faqModal'))?.hide();
        await loadManagerFaqs();
        Swal.fire('Saved', response.data.message, 'success');
    } catch (error) {
        Swal.fire('Unable to save', error.response?.data?.message || error.message || 'Please try again.', 'error');
    }
}

async function archiveFaq(id) {
    if (!guardProgramPermission('edit_landing', 'You do not have permission to manage landing-page FAQs.')) return;
    const confirmation = await Swal.fire({ title: 'Archive this FAQ?', text: 'This question will be hidden from the landing page. You can reactivate it by editing its status.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Archive', confirmButtonColor: '#d89b22' });
    if (!confirmation.isConfirmed) return;
    try {
        const response = await axios.post(ADMIN_API_URL, { operation: 'archiveFaq', json: JSON.stringify({ faq_id: id }) });
        if (response.data?.status !== 'success') throw new Error(response.data?.message || 'Unable to archive FAQ.');
        await loadManagerFaqs();
        Swal.fire('Archived', response.data.message, 'success');
    } catch (error) {
        Swal.fire('Unable to archive', error.response?.data?.message || error.message || 'Please try again.', 'error');
    }
}

export function initFaqManager() {
    const body = document.getElementById('faq_table_body');
    if (!body || !canUseProgramPermission('view_landing')) return;
    document.getElementById('btnAddFaq')?.addEventListener('click', () => openFaqModal());
    document.getElementById('faqForm')?.addEventListener('submit', saveFaq);
    body.addEventListener('click', event => {
        const editButton = event.target.closest('[data-faq-edit]');
        const archiveButton = event.target.closest('[data-faq-archive]');
        if (editButton) openFaqModal(faqRecords.find(faq => Number(faq.faq_id) === Number(editButton.dataset.faqEdit)));
        if (archiveButton) archiveFaq(Number(archiveButton.dataset.faqArchive));
    });
    loadManagerFaqs();
}
