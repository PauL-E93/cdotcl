import { canUsePaymentPermission } from './payment_rbac.js';
import { startAutoRefresh } from '../utilities/auto_refresh.js';

const CATEGORY_META = {
    pending: { label: 'Pending Payments', subtitle: 'Payments scheduled for a future date', badge: 'warning' },
    due_today: { label: 'Due Today', subtitle: 'Payments due today', badge: 'info' },
    due_tomorrow: { label: 'Due Tomorrow', subtitle: 'Payments due tomorrow', badge: 'primary' },
    overdue: { label: 'Overdue', subtitle: 'Payments past due', badge: 'danger' },
    to_receive: { label: 'To Receive Payment', subtitle: 'Pending payments awaiting admin confirmation', badge: 'warning' }
};

const apiRoot = window.location.pathname.includes('/student/') ? '../../api/student/' : '../../api/admin/';
const summaryApiFile = window.location.pathname.includes('/student/') ? 'payment.php' : 'billing.php';
const summaryApiUrl = `${apiRoot}${summaryApiFile}?operation=getPaymentDueSummary`;
const notificationApiUrl = '../../api/payment_notif/payment_notif.php';
const PAYMENT_DUE_REFRESH_MS = 15000;

window.openStudentBilling = function(enrollmentId, programName) {
    const openBillingStatement = () => {
        if (typeof openBillingModalByProgram === 'function') {
            return openBillingModalByProgram(enrollmentId, programName);
        }
        if (typeof openBillingPlayPreModal === 'function') {
            return openBillingPlayPreModal(enrollmentId);
        }
        if (typeof openBillingModal === 'function') {
            return openBillingModal(enrollmentId);
        }
        Swal.fire('Error', 'Billing statement function not available.', 'error');
    };

    const listModalElement = document.getElementById('paymentDueListModal');
    const bootstrapModal = listModalElement && typeof bootstrap !== 'undefined'
        ? bootstrap.Modal.getInstance(listModalElement)
        : null;

    if (listModalElement?.classList.contains('show') && bootstrapModal) {
        listModalElement.addEventListener('hidden.bs.modal', openBillingStatement, { once: true });
        bootstrapModal.hide();
        return;
    }

    openBillingStatement();
};

let paymentDueSummary = {
    pending: [],
    due_today: [],
    due_tomorrow: [],
    overdue: [],
    to_receive: []
};

let currentPaymentDueCategory = null;

function toggleToReceiveCardVisibility() {
    const card = document.querySelector('.payment-summary-card[data-category="to_receive"]');
    if (!card) return;

    const canApprovePayment = canUsePaymentPermission('approve');
    card.style.display = canApprovePayment ? '' : 'none';
}

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

async function fetchPaymentDueSummary() {
    try {
        const response = await axios.get(summaryApiUrl);
        if (response.data?.status !== 'success') {
            throw new Error(response.data?.message || 'Unable to fetch payment due summary');
        }

        paymentDueSummary = response.data?.data || paymentDueSummary;
        renderPaymentCounts(paymentDueSummary);
        refreshOpenPaymentDueModal();
    } catch (error) {
        console.error('Error fetching payment due summary:', error);
        paymentDueSummary = { pending: [], due_today: [], due_tomorrow: [], overdue: [], to_receive: [] };
        renderPaymentCounts(paymentDueSummary);
        refreshOpenPaymentDueModal();
    }
}

function formatPenalty(item) {
    const appliedAmount = Number(item.penalty_amount || 0);
    const dailyRate = Number(item.penalty_rate || 0);

    if (appliedAmount > 0) {
        return `
            <span class="fw-semibold text-danger">${formatCurrency(appliedAmount)}</span>
            <div class="small text-muted">${formatCurrency(dailyRate)} / day after ${Number(item.grace_period_days || 0)} day(s)</div>
        `;
    }
    if (dailyRate <= 0) {
        return '<span class="text-muted">None</span>';
    }
    if (!item.due_date) {
        return '<span class="text-muted">Waiting for due date</span>';
    }

    return `
        <span class="text-muted">Not applied</span>
        <div class="small text-muted">Starts ${escapeHtml(formatDate(item.penalty_effective_date))} (${Number(item.grace_period_days || 0)} day(s) after due)</div>
    `;
}

function renderPaymentCounts(summary) {
    const counts = {
        pending: summary.pending?.length || 0,
        due_today: summary.due_today?.length || 0,
        due_tomorrow: summary.due_tomorrow?.length || 0,
        overdue: summary.overdue?.length || 0,
        to_receive: summary.to_receive?.length || 0
    };

    document.getElementById('pendingCount')?.replaceWith(createCountElement('pendingCount', counts.pending));
    document.getElementById('dueTodayCount')?.replaceWith(createCountElement('dueTodayCount', counts.due_today));
    document.getElementById('dueTomorrowCount')?.replaceWith(createCountElement('dueTomorrowCount', counts.due_tomorrow));
    document.getElementById('overdueCount')?.replaceWith(createCountElement('overdueCount', counts.overdue));
    document.getElementById('toReceiveCount')?.replaceWith(createCountElement('toReceiveCount', counts.to_receive));
}

async function sendPaymentDueNotification(category) {
    if (!canUsePaymentPermission('export')) {
        Swal.fire({ icon: 'warning', title: 'Access Restricted', text: 'You do not have permission to send payment notifications.' });
        return;
    }

    if (!category) {
        Swal.fire({ icon: 'warning', title: 'No category selected', text: 'Please open a payment category first.' });
        return;
    }

    try {
        const button = document.getElementById('sendPaymentEmailButton');
        if (button) {
            button.disabled = true;
            button.textContent = 'Sending...';
        }

        const response = await axios.post(notificationApiUrl, {
            operation: 'sendPaymentDueNotification',
            category
        });

        if (button) {
            button.disabled = false;
            button.textContent = 'Send Email';
        }

        if (response.data?.status !== 'success') {
            throw new Error(response.data?.message || 'Failed to send payment notifications');
        }

        Swal.fire({
            icon: 'success',
            title: 'Email Sent',
            text: response.data.message || 'Payment notification email sent successfully.'
        });
    } catch (error) {
        console.error('Error sending payment notification email:', error);
        if (document.getElementById('sendPaymentEmailButton')) {
            document.getElementById('sendPaymentEmailButton').disabled = false;
            document.getElementById('sendPaymentEmailButton').textContent = 'Send Email';
        }
        Swal.fire({
            icon: 'error',
            title: 'Send Failed',
            text: error.response?.data?.message || error.message || 'Unable to send the payment notification email.'
        });
    }
}

function createCountElement(id, count) {
    const element = document.createElement('h4');
    element.id = id;
    element.className = 'mb-0 fw-bold';
    element.textContent = count;
    return element;
}

function buildDueRows(items) {
    if (!items || items.length === 0) {
        return `
            <tr>
                <td colspan="7" class="text-center text-muted">No records found for this category.</td>
            </tr>
        `;
    }

    return items.map(item => {
        const enrollmentId = item.enrollment_details_id || '';
        const programName = item.program_name || '';
        const categoryBadge = CATEGORY_META[item.category]?.badge || 'secondary';

        return `
            <tr class="payment-due-row" role="button" tabindex="0" style="cursor: pointer;" data-enrollment-id="${escapeHtml(enrollmentId)}" data-program-name="${escapeHtml(programName)}" data-category="${escapeHtml(item.category || '')}">
                <td class="text-start">
                    <span class="text-primary fw-semibold">${escapeHtml(item.student_name)}</span>
                </td>
                <td>${escapeHtml(item.program_name || 'N/A')}</td>
                <td>${escapeHtml(item.billing_type || 'N/A')}</td>
                <td>${escapeHtml(formatDate(item.due_date))}</td>
                <td>${formatPenalty(item)}</td>
                <td>${formatCurrency(item.amount)}</td>
                <td><span class="badge bg-${categoryBadge} text-uppercase">${escapeHtml(item.status || 'unpaid')}</span></td>
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
                                        <th>Due Date</th>
                                        <th>Penalty</th>
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
                        <button type="button" class="btn" id="sendPaymentEmailButton" style="background-color:#ea9aa6; border-color:#d7768e; color:#fff;">Send Email</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    modalElement = template.firstElementChild;
    document.body.appendChild(modalElement);

    const sendButton = modalElement.querySelector('#sendPaymentEmailButton');
    if (sendButton) {
        sendButton.addEventListener('click', async () => {
            await sendPaymentDueNotification(currentPaymentDueCategory);
        });
    }

    return modalElement;
}

function openBillingFromPaymentDueRow(row) {
    const enrollmentId = row?.dataset?.enrollmentId;
    if (!enrollmentId) return;

    if (row.dataset.category === 'to_receive' && typeof openPaymentHistoryModal === 'function') {
        const listModalElement = document.getElementById('paymentDueListModal');
        const bootstrapModal = listModalElement && typeof bootstrap !== 'undefined'
            ? bootstrap.Modal.getInstance(listModalElement)
            : null;
        const openPaymentReview = () => openPaymentHistoryModal(enrollmentId, !canUsePaymentPermission('approve'));

        if (listModalElement?.classList.contains('show') && bootstrapModal) {
            listModalElement.addEventListener('hidden.bs.modal', openPaymentReview, { once: true });
            bootstrapModal.hide();
            return;
        }

        openPaymentReview();
        return;
    }

    openStudentBilling(enrollmentId, row.dataset.programName || '');
}

function updatePaymentDueModalContent(category) {
    if (!category) return;

    const modalElement = ensurePaymentDueModal();
    const categoryMeta = CATEGORY_META[category] || { label: 'Payments', subtitle: '', badge: 'secondary' };
    const items = (paymentDueSummary[category] || []).map(item => ({ ...item, category }));
    const modalLabel = modalElement.querySelector('#paymentDueListModalLabel');
    const modalHeader = modalElement.querySelector('#paymentDueListHeader');
    const modalSubtitle = modalElement.querySelector('#paymentDueListSubtitle');
    const tableBody = modalElement.querySelector('#paymentDueListTableBody');

    if (!modalLabel || !modalHeader || !tableBody) {
        console.warn('Payment due modal elements missing');
        return;
    }

    modalLabel.textContent = categoryMeta.label;
    modalHeader.textContent = `${categoryMeta.label} (${items.length})`;
    modalSubtitle.textContent = categoryMeta.subtitle;
    tableBody.innerHTML = buildDueRows(items);

    const sendButton = modalElement.querySelector('#sendPaymentEmailButton');
    if (sendButton) {
        sendButton.style.display = category === 'to_receive' || !canUsePaymentPermission('export') ? 'none' : '';
    }

    tableBody.querySelectorAll('.payment-due-row').forEach(row => {
        row.addEventListener('click', () => openBillingFromPaymentDueRow(row));
        row.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            openBillingFromPaymentDueRow(row);
        });
    });
}

function refreshOpenPaymentDueModal() {
    const modalElement = document.getElementById('paymentDueListModal');
    if (!modalElement?.classList.contains('show') || !currentPaymentDueCategory) return;
    updatePaymentDueModalContent(currentPaymentDueCategory);
}

function showPaymentDueModal(category) {
    if (category === 'to_receive' && !canUsePaymentPermission('approve')) {
        return;
    }

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
    toggleToReceiveCardVisibility();
    setupCardInteractions();
    fetchPaymentDueSummary();
    startAutoRefresh({ callback: fetchPaymentDueSummary, intervalMs: PAYMENT_DUE_REFRESH_MS });
    window.addEventListener('payment-status-updated', fetchPaymentDueSummary);
}

// Initialize immediately when this module is imported
initPaymentDueCards();

