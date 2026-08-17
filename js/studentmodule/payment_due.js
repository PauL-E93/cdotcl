import { startAutoRefresh } from '../utilities/auto_refresh.js';

const CATEGORY_META = {
    pending: { label: 'Pending Payments', subtitle: 'Payments scheduled for a future date', badgeClass: 'bg-warning text-dark' },
    due_today: { label: 'Due Today', subtitle: 'Payments due today', badgeClass: 'bg-info text-dark' },
    due_tomorrow: { label: 'Due Tomorrow', subtitle: 'Payments due tomorrow', badgeClass: 'bg-primary' },
    overdue: { label: 'Overdue', subtitle: 'Payments past due', badgeClass: 'bg-danger' },
    pending_review: { label: 'Pending Review', subtitle: 'GCash payments waiting for admin review', badgeClass: 'bg-secondary' }
};

const summaryApiUrl = '../../api/student/payment.php?operation=getPaymentDueSummary';
const PAYMENT_DUE_REFRESH_MS = 15000;

let paymentDueSummary = {
    pending: [],
    due_today: [],
    due_tomorrow: [],
    overdue: [],
    pending_review: []
};

let currentPaymentDueCategory = null;

function formatCurrency(value) {
    return Number(value || 0).toLocaleString('en-PH', {
        style: 'currency',
        currency: 'PHP',
        maximumFractionDigits: 2
    });
}

function formatDate(value) {
    if (!value) return 'No due date';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[char]));
}

function createCountElement(id, count) {
    const element = document.createElement('h4');
    element.id = id;
    element.className = 'mb-0 fw-bold';
    element.textContent = count;
    return element;
}

async function fetchPaymentDueSummary() {
    try {
        const response = await axios.get(summaryApiUrl);
        if (response.data?.status !== 'success') {
            throw new Error(response.data?.message || 'Unable to fetch student payment summary');
        }

        paymentDueSummary = response.data?.data || paymentDueSummary;
        renderPaymentCounts(paymentDueSummary);
        refreshOpenPaymentDueModal();
    } catch (error) {
        console.error('Error fetching student payment summary:', error);
        paymentDueSummary = {
            pending: [],
            due_today: [],
            due_tomorrow: [],
            overdue: [],
            pending_review: []
        };
        renderPaymentCounts(paymentDueSummary);
        refreshOpenPaymentDueModal();
    }
}

function renderPaymentCounts(summary) {
    document.getElementById('pendingCount')?.replaceWith(createCountElement('pendingCount', summary.pending?.length || 0));
    document.getElementById('dueTodayCount')?.replaceWith(createCountElement('dueTodayCount', summary.due_today?.length || 0));
    document.getElementById('dueTomorrowCount')?.replaceWith(createCountElement('dueTomorrowCount', summary.due_tomorrow?.length || 0));
    document.getElementById('overdueCount')?.replaceWith(createCountElement('overdueCount', summary.overdue?.length || 0));
    document.getElementById('pendingReviewCount')?.replaceWith(createCountElement('pendingReviewCount', summary.pending_review?.length || 0));
}

function buildDueRows(items, category) {
    if (!items || items.length === 0) {
        return `
            <tr>
                <td colspan="6" class="text-center text-muted">No records found for this category.</td>
            </tr>
        `;
    }

    return items.map(item => {
        const enrollmentId = item.enrollment_details_id || '';
        const meta = CATEGORY_META[category] || CATEGORY_META.pending;
        const statusLabel = category === 'pending_review'
            ? (item.status || 'Pending')
            : (item.status || 'Unpaid');

        return `
            <tr class="payment-due-row" role="button" tabindex="0" style="cursor: pointer;" data-enrollment-id="${escapeHtml(enrollmentId)}" data-category="${escapeHtml(category)}">
                <td class="text-start">
                    <span class="text-primary fw-semibold">${escapeHtml(item.student_name || '')}</span>
                </td>
                <td>${escapeHtml(item.program_name || 'N/A')}</td>
                <td>${escapeHtml(item.billing_type || (category === 'pending_review' ? 'GCash Payment' : 'N/A'))}</td>
                <td>${escapeHtml(formatDate(item.due_date))}</td>
                <td>${formatCurrency(item.amount)}</td>
                <td><span class="badge ${meta.badgeClass} text-uppercase">${escapeHtml(statusLabel)}</span></td>
            </tr>
        `;
    }).join('');
}

function ensurePaymentDueModal() {
    let modalElement = document.getElementById('paymentDueListModal');
    if (modalElement) return modalElement;

    const template = document.createElement('div');
    template.innerHTML = `
        <div class="modal fade" id="paymentDueListModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header text-white" style="background: #ea9aa6;">
                        <h5 class="modal-title" id="paymentDueListModalLabel">Payment Due List</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <h6 class="fw-bold" id="paymentDueListHeader"></h6>
                            <p class="text-muted small" id="paymentDueListSubtitle"></p>
                        </div>
                        <div class="table-responsive">
                            <table class="table table-striped table-bordered align-middle">
                                <thead class="table-light">
                                    <tr>
                                        <th>Student</th>
                                        <th>Program</th>
                                        <th>Billing Type</th>
                                        <th>Date</th>
                                        <th>Amount</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody id="paymentDueListTableBody"></tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    modalElement = template.firstElementChild;
    document.body.appendChild(modalElement);
    return modalElement;
}

function openDueRowAction(row) {
    const enrollmentId = row?.dataset?.enrollmentId;
    if (!enrollmentId) return;

    if (row.dataset.category === 'pending_review') {
        if (typeof window.openStudentPaymentHistoryModal === 'function') {
            window.openStudentPaymentHistoryModal(enrollmentId);
        }
        return;
    }

    if (typeof window.openStudentBillingModal === 'function') {
        window.openStudentBillingModal(enrollmentId);
    }
}

function updatePaymentDueModalContent(category) {
    if (!category) return;

    const modalElement = ensurePaymentDueModal();
    const categoryMeta = CATEGORY_META[category] || CATEGORY_META.pending;
    const items = paymentDueSummary[category] || [];
    const modalLabel = modalElement.querySelector('#paymentDueListModalLabel');
    const modalHeader = modalElement.querySelector('#paymentDueListHeader');
    const modalSubtitle = modalElement.querySelector('#paymentDueListSubtitle');
    const tableBody = modalElement.querySelector('#paymentDueListTableBody');

    if (!modalLabel || !modalHeader || !modalSubtitle || !tableBody) {
        return;
    }

    modalLabel.textContent = categoryMeta.label;
    modalHeader.textContent = `${categoryMeta.label} (${items.length})`;
    modalSubtitle.textContent = categoryMeta.subtitle;
    tableBody.innerHTML = buildDueRows(items, category);

    tableBody.querySelectorAll('.payment-due-row').forEach(row => {
        row.addEventListener('click', () => openDueRowAction(row));
        row.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            openDueRowAction(row);
        });
    });
}

function refreshOpenPaymentDueModal() {
    const modalElement = document.getElementById('paymentDueListModal');
    if (!modalElement?.classList.contains('show') || !currentPaymentDueCategory) return;
    updatePaymentDueModalContent(currentPaymentDueCategory);
}

function showPaymentDueModal(category) {
    currentPaymentDueCategory = category;
    const modalElement = ensurePaymentDueModal();
    updatePaymentDueModalContent(category);
    const modal = new bootstrap.Modal(modalElement);
    modal.show();
}

function setupCardInteractions() {
    const cards = document.querySelectorAll('.payment-summary-card');
    cards.forEach(card => {
        card.addEventListener('click', () => {
            const category = card.dataset.category;
            if (!category) return;
            showPaymentDueModal(category);
        });
    });
}

function initPaymentDueCards() {
    setupCardInteractions();
    fetchPaymentDueSummary();
    startAutoRefresh({ callback: fetchPaymentDueSummary, intervalMs: PAYMENT_DUE_REFRESH_MS });
    window.addEventListener('payment-status-updated', fetchPaymentDueSummary);
}

initPaymentDueCards();
