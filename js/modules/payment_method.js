import { canUseProgramPermission, guardProgramPermission } from './program_rbac.js';

const PAYMENT_METHOD_API = '../../api/admin/payment_method.php';
const MAX_QR_FILE_SIZE = 5 * 1024 * 1024;
let paymentMethods = [];

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getQrCodeUrl(path) {
    const value = String(path || '').trim();
    if (!value) return '';
    if (/^(?:https?:|data:|blob:|\/)/i.test(value) || value.startsWith('../')) return value;
    return `../../${value.replace(/^\.\//, '')}`;
}

function renderPaymentMethods() {
    const tableBody = document.getElementById('payment_method_table_body');
    if (!tableBody) return;

    if (!paymentMethods.length) {
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">No payment methods found.</td></tr>';
        return;
    }

    const canEdit = canUseProgramPermission('edit_payment_methods');
    const canDelete = canUseProgramPermission('delete_payment_methods');
    tableBody.innerHTML = paymentMethods.map(method => {
        const id = Number(method.payment_method_id);
        const qrUrl = getQrCodeUrl(method.qr_code);
        const actions = [
            canEdit ? `<button type="button" class="btn btn-sm btn-outline-primary" data-payment-method-action="edit" data-payment-method-id="${id}" title="Edit" aria-label="Edit ${escapeHtml(method.payment_method)}"><i class="bi bi-pencil-square"></i></button>` : '',
            canDelete ? `<button type="button" class="btn btn-sm btn-outline-danger" data-payment-method-action="delete" data-payment-method-id="${id}" title="Delete" aria-label="Delete ${escapeHtml(method.payment_method)}"><i class="bi bi-trash"></i></button>` : ''
        ].filter(Boolean).join(' ');

        return `<tr>
            <td class="fw-bold">${escapeHtml(method.payment_method || 'N/A')}</td>
            <td>${method.account_name ? escapeHtml(method.account_name) : '<span class="text-muted">Not set</span>'}</td>
            <td>${method.account_number ? escapeHtml(method.account_number) : '<span class="text-muted">Not set</span>'}</td>
            <td>${qrUrl ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-payment-method-action="view-qr" data-payment-method-id="${id}"><i class="bi bi-qr-code me-1"></i>View QR</button>` : '<span class="text-muted">No QR code</span>'}</td>
            <td class="text-center"><div class="d-inline-flex gap-1">${actions || '<span class="text-muted">-</span>'}</div></td>
        </tr>`;
    }).join('');
}

export async function loadPaymentMethods() {
    if (!canUseProgramPermission('view_payment_methods')) return;
    const tableBody = document.getElementById('payment_method_table_body');
    if (!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4"><span class="spinner-border spinner-border-sm me-2"></span>Loading payment methods...</td></tr>';

    try {
        const response = await axios.get(PAYMENT_METHOD_API, { params: { operation: 'getPaymentMethods' } });
        if (response.data?.status !== 'success') throw new Error(response.data?.message || 'Unable to load payment methods.');
        paymentMethods = Array.isArray(response.data.data) ? response.data.data : [];
        renderPaymentMethods();
    } catch (error) {
        console.error('Unable to load payment methods:', error);
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-4">Unable to load payment methods.</td></tr>';
    }
}

export function initPaymentMethodsPage() {
    const tableBody = document.getElementById('payment_method_table_body');
    if (!tableBody) return;
    loadPaymentMethods();

    const addButton = document.getElementById('btnAddPaymentMethod');
    if (addButton && !addButton.dataset.paymentMethodBound) {
        addButton.dataset.paymentMethodBound = 'true';
        addButton.addEventListener('click', setupAddPaymentMethodModal);
    }

    if (!tableBody.dataset.paymentMethodBound) {
        tableBody.dataset.paymentMethodBound = 'true';
        tableBody.addEventListener('click', event => {
            const button = event.target.closest('[data-payment-method-action]');
            if (!button) return;
            const method = paymentMethods.find(item => String(item.payment_method_id) === String(button.dataset.paymentMethodId));
            if (!method) return;
            if (button.dataset.paymentMethodAction === 'edit') setupEditPaymentMethodModal(method);
            if (button.dataset.paymentMethodAction === 'delete') deletePaymentMethod(method);
            if (button.dataset.paymentMethodAction === 'view-qr') viewQrCode(method);
        });
    }
}

export function setupAddPaymentMethodModal() {
    if (!guardProgramPermission('create_payment_methods', 'You do not have permission to add payment methods.')) return;
    openPaymentMethodModal();
}

function setupEditPaymentMethodModal(method) {
    if (!guardProgramPermission('edit_payment_methods', 'You do not have permission to edit payment methods.')) return;
    openPaymentMethodModal(method);
}

function openPaymentMethodModal(method = null) {
    const modalElement = document.getElementById('paymentMethodModal');
    if (!modalElement) return;
    const isEdit = Boolean(method?.payment_method_id);
    document.getElementById('paymentMethodModalLabel').textContent = isEdit ? 'Edit Payment Method' : 'Add Payment Method';
    document.getElementById('paymentMethodForm').innerHTML = getPaymentMethodForm(method || {});
    document.getElementById('paymentMethodModalFooter').innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn ${isEdit ? 'btn-success' : 'btn-primary'}" id="btnSavePaymentMethod">${isEdit ? 'Update Changes' : 'Save Payment Method'}</button>`;

    const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
    modal.show();
    bindQrPreview(method || {});
    document.getElementById('btnSavePaymentMethod')?.addEventListener('click', () => submitPaymentMethod(method?.payment_method_id || null));
}

function getPaymentMethodForm(method) {
    const qrUrl = getQrCodeUrl(method.qr_code);
    return `<div class="row g-3">
        <div class="col-12">
            <label class="form-label" for="payment_method_name">Payment Method <span class="text-danger">*</span></label>
            <input type="text" class="form-control" id="payment_method_name" maxlength="50" value="${escapeHtml(method.payment_method)}" placeholder="e.g., Cash, GCash, Bank Transfer" required>
        </div>
        <div class="col-md-6">
            <label class="form-label" for="payment_method_account_name">Account Name</label>
            <input type="text" class="form-control" id="payment_method_account_name" maxlength="100" value="${escapeHtml(method.account_name)}" placeholder="Name shown on the account">
        </div>
        <div class="col-md-6">
            <label class="form-label" for="payment_method_account_number">Account Number</label>
            <input type="text" class="form-control" id="payment_method_account_number" maxlength="30" value="${escapeHtml(method.account_number)}" placeholder="Mobile or account number">
        </div>
        <div class="col-md-7">
            <label class="form-label" for="payment_method_qr_code">QR Code Image</label>
            <input type="file" class="form-control" id="payment_method_qr_code" accept="image/png,image/jpeg,image/webp,image/gif">
            <div class="form-text">PNG, JPG, WEBP, or GIF; maximum 5 MB.</div>
            ${qrUrl ? `<div class="form-check mt-2"><input class="form-check-input" type="checkbox" id="payment_method_remove_qr"><label class="form-check-label" for="payment_method_remove_qr">Remove the current QR code</label></div>` : ''}
        </div>
        <div class="col-md-5">
            <div class="border rounded bg-light d-flex align-items-center justify-content-center p-2" style="min-height:150px">
                <img id="payment_method_qr_preview" src="${escapeHtml(qrUrl)}" alt="QR code preview" class="img-fluid rounded${qrUrl ? '' : ' d-none'}" style="max-height:180px">
                <span id="payment_method_qr_empty" class="text-muted small${qrUrl ? ' d-none' : ''}">No QR image selected</span>
            </div>
        </div>
    </div>`;
}

function bindQrPreview(method) {
    const fileInput = document.getElementById('payment_method_qr_code');
    const preview = document.getElementById('payment_method_qr_preview');
    const emptyState = document.getElementById('payment_method_qr_empty');
    const removeCheckbox = document.getElementById('payment_method_remove_qr');
    let objectUrl = '';

    fileInput?.addEventListener('change', () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        const file = fileInput.files?.[0];
        if (!file) {
            preview.src = getQrCodeUrl(method.qr_code);
            preview.classList.toggle('d-none', !method.qr_code);
            emptyState.classList.toggle('d-none', Boolean(method.qr_code));
            return;
        }
        objectUrl = URL.createObjectURL(file);
        preview.src = objectUrl;
        preview.classList.remove('d-none');
        emptyState.classList.add('d-none');
        if (removeCheckbox) removeCheckbox.checked = false;
    });

    removeCheckbox?.addEventListener('change', () => {
        if (!removeCheckbox.checked) return;
        fileInput.value = '';
        preview.classList.add('d-none');
        emptyState.classList.remove('d-none');
    });
}

async function submitPaymentMethod(id) {
    const name = document.getElementById('payment_method_name')?.value.trim();
    const accountName = document.getElementById('payment_method_account_name')?.value.trim() || '';
    const accountNumber = document.getElementById('payment_method_account_number')?.value.trim() || '';
    const file = document.getElementById('payment_method_qr_code')?.files?.[0];
    const removeQr = document.getElementById('payment_method_remove_qr')?.checked || false;
    if (!name) {
        Swal.fire('Required field', 'Enter a payment method name.', 'warning');
        return;
    }
    if (file && file.size > MAX_QR_FILE_SIZE) {
        Swal.fire('Image too large', 'The QR-code image must be 5 MB or smaller.', 'warning');
        return;
    }

    const payload = { payment_method: name, account_name: accountName, account_number: accountNumber, remove_qr: removeQr };
    if (id) payload.payment_method_id = id;
    const formData = new FormData();
    formData.append('operation', id ? 'updatePaymentMethod' : 'insertPaymentMethod');
    formData.append('json', JSON.stringify(payload));
    if (file) formData.append('qr_code', file);

    const saveButton = document.getElementById('btnSavePaymentMethod');
    if (saveButton) saveButton.disabled = true;
    try {
        const response = await axios.post(PAYMENT_METHOD_API, formData);
        if (response.data?.status !== 'success') throw new Error(response.data?.message || 'Unable to save the payment method.');
        bootstrap.Modal.getInstance(document.getElementById('paymentMethodModal'))?.hide();
        await loadPaymentMethods();
        Swal.fire('Saved', response.data.message, 'success');
    } catch (error) {
        console.error('Unable to save payment method:', error);
        Swal.fire('Save failed', error.response?.data?.message || error.message || 'Unable to save the payment method.', 'error');
    } finally {
        if (saveButton) saveButton.disabled = false;
    }
}

async function deletePaymentMethod(method) {
    if (!guardProgramPermission('delete_payment_methods', 'You do not have permission to delete payment methods.')) return;
    const result = await Swal.fire({
        title: 'Delete payment method?',
        text: `${method.payment_method} will be permanently removed.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc3545',
        confirmButtonText: 'Delete'
    });
    if (!result.isConfirmed) return;

    try {
        const response = await axios.post(PAYMENT_METHOD_API, {
            operation: 'deletePaymentMethod',
            json: JSON.stringify({ payment_method_id: method.payment_method_id })
        });
        if (response.data?.status !== 'success') throw new Error(response.data?.message || 'Unable to delete the payment method.');
        await loadPaymentMethods();
        Swal.fire('Deleted', response.data.message, 'success');
    } catch (error) {
        Swal.fire('Delete failed', error.response?.data?.message || error.message || 'This method may already be used by payment records.', 'error');
    }
}

function viewQrCode(method) {
    const qrUrl = getQrCodeUrl(method.qr_code);
    if (!qrUrl) return;
    Swal.fire({
        title: escapeHtml(method.payment_method),
        html: `<img src="${escapeHtml(qrUrl)}" alt="${escapeHtml(method.payment_method)} QR code" style="display:block;max-width:100%;max-height:60vh;margin:auto;border-radius:8px">`,
        confirmButtonText: 'Close'
    });
}
