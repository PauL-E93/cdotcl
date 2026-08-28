import { canUseProductPermission, guardProductPermission } from './product_rbac.js';

const RELEASE_API = '../../api/admin/product_release.php';
let releaseOrders = [];

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
    })[character]);
}

function money(value) {
    return `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function niceDateTime(value) {
    if (!value) return '—';
    const date = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleString('en-PH', {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
}

function displayStatus(order) {
    if (order.status === 'released') return { label: 'Released', badge: 'success' };
    if (!order.has_release_details) return { label: 'Uniform size required', badge: 'info text-dark' };
    if (!order.payment_ready) return { label: 'Waiting for payment', badge: 'warning text-dark' };
    if (order.stock_quantity < order.quantity) return { label: 'Insufficient stock', badge: 'danger' };
    if (order.ready_to_release) return { label: 'Ready to release', badge: 'primary' };
    return { label: 'Not ready', badge: 'secondary' };
}

async function request(operation, payload = {}, method = 'GET') {
    const response = method === 'GET'
        ? await axios.get(RELEASE_API, { params: { operation, ...payload } })
        : await axios.post(`${RELEASE_API}?operation=${encodeURIComponent(operation)}`, { operation, ...payload });
    if (response.data?.status !== 'success') throw new Error(response.data?.message || 'Product release request failed.');
    return response.data;
}

function orderActionHtml(order) {
    if (order.status === 'released' || !canUseProductPermission('edit')) return '<span class="text-muted">—</span>';
    const detailsButton = order.requires_size ? `<button type="button" class="btn btn-sm ${order.has_release_details ? 'btn-outline-primary' : 'btn-primary'} product-details-action" data-order-id="${order.product_order_id}">
        <i class="bi bi-card-checklist me-1"></i>${order.has_release_details ? 'Edit uniform size' : 'Set uniform size'}
    </button>` : '';
    const releaseButton = order.ready_to_release
        ? `<button type="button" class="btn btn-sm btn-success product-release-action" data-order-id="${order.product_order_id}" ${order.stock_quantity < order.quantity ? 'disabled' : ''}>
            <i class="bi bi-box-arrow-up-right me-1"></i>Release
          </button>`
        : (!order.has_release_details ? '' : '<span class="small text-muted">Payment required</span>');
    return `<div class="d-flex flex-wrap gap-1 align-items-center">${detailsButton}${releaseButton}</div>`;
}

function bindOrderActions(root) {
    root.querySelectorAll('.product-release-action').forEach(button => {
        button.addEventListener('click', () => releaseProductOrder(Number(button.dataset.orderId)));
    });
    root.querySelectorAll('.product-details-action').forEach(button => {
        button.addEventListener('click', () => editProductDetails(Number(button.dataset.orderId)));
    });
}

function renderReleaseOrders() {
    const tableBody = document.getElementById('productReleaseTableBody');
    if (!tableBody) return;
    const filter = document.getElementById('product-release-filter')?.value || 'pending';
    const query = document.getElementById('search-input')?.value.trim().toLowerCase() || '';
    const grouped = new Map();
    releaseOrders.forEach(order => {
        const key = String(order.enrollment_details_id);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(order);
    });

    const students = Array.from(grouped.values()).map(allOrders => {
        const filteredOrders = allOrders.filter(order => filter === 'all'
            || (filter === 'released' ? order.status === 'released' : order.status !== 'released'));
        const haystack = allOrders.map(order => `${order.student_name} ${order.student_id_number} ${order.product_name} ${order.program_name} ${order.product_order_id}`).join(' ').toLowerCase();
        return { allOrders, filteredOrders, matches: filteredOrders.length > 0 && (!query || haystack.includes(query)) };
    }).filter(group => group.matches);

    if (!students.length) {
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">No student product orders match this view.</td></tr>';
        return;
    }

    tableBody.innerHTML = students.map(group => {
        const first = group.allOrders[0];
        const orders = group.filteredOrders;
        const ready = orders.filter(order => order.ready_to_release && order.status !== 'released').length;
        const needsDetails = orders.filter(order => !order.has_release_details && order.status !== 'released').length;
        const waiting = orders.filter(order => !order.payment_ready && order.status !== 'released').length;
        const released = orders.filter(order => order.status === 'released').length;
        let status = { label: `${orders.length} order${orders.length === 1 ? '' : 's'}`, badge: 'secondary' };
        if (needsDetails > 0) status = { label: `${needsDetails} need uniform size`, badge: 'info text-dark' };
        else if (ready > 0) status = { label: `${ready} ready to release`, badge: 'primary' };
        else if (waiting > 0) status = { label: `${waiting} waiting for payment`, badge: 'warning text-dark' };
        else if (released === orders.length) status = { label: 'All released', badge: 'success' };
        const pendingTotal = group.allOrders.filter(order => order.status !== 'released').length;
        const releasedTotal = group.allOrders.length - pendingTotal;
        return `<tr data-release-row>
            <td><div class="fw-semibold">${escapeHtml(first.student_name)}</div><div class="small text-muted">${escapeHtml(first.student_id_number || '')}</div></td>
            <td>${escapeHtml(first.program_name)}</td>
            <td><div class="fw-semibold">${group.allOrders.length} total</div><div class="small text-muted">${pendingTotal} pending · ${releasedTotal} released</div></td>
            <td><span class="badge bg-${status.badge}">${status.label}</span></td>
            <td><button type="button" class="btn btn-sm btn-outline-primary view-student-orders" data-enrollment-id="${first.enrollment_details_id}"><i class="bi bi-eye me-1"></i>View Orders</button></td>
        </tr>`;
    }).join('');

    tableBody.querySelectorAll('.view-student-orders').forEach(button => {
        button.addEventListener('click', () => openStudentOrdersModal(Number(button.dataset.enrollmentId)));
    });
}

function openStudentOrdersModal(enrollmentId) {
    const orders = releaseOrders.filter(order => order.enrollment_details_id === enrollmentId);
    if (!orders.length) return;
    const first = orders[0];
    const existing = document.getElementById('studentProductOrdersModal');
    if (existing) {
        bootstrap.Modal.getInstance(existing)?.dispose();
        existing.remove();
        document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.remove());
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('padding-right');
    }

    const rows = orders.map(order => {
        const status = displayStatus(order);
        const typeLabel = order.order_type === 'additional_request' ? 'Additional request' : 'Included in program';
        const paymentLabel = order.order_type === 'enrollment_bundle' ? 'Included' : (order.payment_ready ? 'Paid' : 'Waiting for payment');
        const releaseDetails = order.status === 'released'
            ? `<div class="small text-muted mt-1">${niceDateTime(order.released_at)}${order.released_by_name ? ` · ${escapeHtml(order.released_by_name)}` : ''}</div>`
            : '';
        return `<tr>
            <td><div class="fw-semibold">${escapeHtml(order.product_name)} × ${order.quantity}</div><div class="small text-muted">Order #${order.product_order_id}</div></td>
            <td><span class="badge bg-light text-dark border">${typeLabel}</span><div class="small mt-1">${money(order.line_total)}</div></td>
            <td>${order.item_note ? escapeHtml(order.item_note) : (order.requires_size ? '<span class="text-danger small">Uniform size required</span>' : '<span class="text-muted small">Not required</span>')}</td>
            <td>${paymentLabel}</td>
            <td><span class="badge bg-${status.badge}">${status.label}</span>${releaseDetails}</td>
            <td>${orderActionHtml(order)}</td>
        </tr>`;
    }).join('');

    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="studentProductOrdersModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content border-0">    
                    <div class="modal-header">
                        <div><div class="small text-muted">${escapeHtml(first.program_name)}</div><h5 class="modal-title">${escapeHtml(first.student_name)} — Product Orders</h5></div>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="table-responsive">
                            <table class="table table-hover align-middle">
                                <thead><tr><th>Product</th><th>Type / Amount</th><th>Details</th><th>Payment</th><th>Status</th><th>Action</th></tr></thead>
                                <tbody>${rows}</tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button></div>
                </div>
            </div>
        </div>`);
    const modalElement = document.getElementById('studentProductOrdersModal');
    bindOrderActions(modalElement);
    const modal = new bootstrap.Modal(modalElement);
    modalElement.addEventListener('hidden.bs.modal', () => modalElement.remove(), { once: true });
    modal.show();
}

async function closeStudentOrdersModal() {
    const modalElement = document.getElementById('studentProductOrdersModal');
    if (!modalElement) return;
    const modal = bootstrap.Modal.getInstance(modalElement);
    if (!modal || !modalElement.classList.contains('show')) {
        modal?.dispose();
        modalElement.remove();
        return;
    }
    await new Promise(resolve => {
        let finished = false;
        const complete = () => {
            if (finished) return;
            finished = true;
            resolve();
        };
        modalElement.addEventListener('hidden.bs.modal', complete, { once: true });
        modal.hide();
        setTimeout(complete, 500);
    });
    const lingeringModal = document.getElementById('studentProductOrdersModal');
    if (lingeringModal) {
        bootstrap.Modal.getInstance(lingeringModal)?.dispose();
        lingeringModal.remove();
    }
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('padding-right');
}

function updateReleaseStats() {
    const ready = releaseOrders.filter(order => order.ready_to_release && order.status !== 'released').length;
    const needsDetails = releaseOrders.filter(order => !order.has_release_details && order.status !== 'released').length;
    const waiting = releaseOrders.filter(order => !order.payment_ready && order.status !== 'released').length;
    const released = releaseOrders.filter(order => order.status === 'released').length;
    const values = {
        'ready-release-count': ready,
        'needs-details-count': needsDetails,
        'waiting-payment-count': waiting,
        'released-products-count': released
    };
    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    });
}

async function releaseProductOrder(orderId) {
    if (!guardProductPermission('edit', 'You do not have permission to release products.')) return;
    const order = releaseOrders.find(item => item.product_order_id === orderId);
    if (!order) return;
    await closeStudentOrdersModal();
    const confirmation = await Swal.fire({
        icon: 'question',
        title: 'Release this product?',
        html: `<strong>${escapeHtml(order.product_name)} × ${order.quantity}</strong><br>for ${escapeHtml(order.student_name)}<br><small>Stock will be reduced permanently and the release will be recorded.</small>`,
        showCancelButton: true,
        confirmButtonText: 'Release product',
        confirmButtonColor: '#198754'
    });
    if (!confirmation.isConfirmed) {
        openStudentOrdersModal(order.enrollment_details_id);
        return;
    }
    try {
        Swal.fire({ title: 'Releasing product…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        const response = await request('releaseOrder', { product_order_id: orderId }, 'POST');
        await Swal.fire('Released', response.message, 'success');
        await Promise.all([loadProductReleaseOrders(), window.initProductPage?.()]);
        openStudentOrdersModal(order.enrollment_details_id);
    } catch (error) {
        await Swal.fire('Release failed', error.response?.data?.message || error.message, 'error');
        openStudentOrdersModal(order.enrollment_details_id);
    }
}

async function editProductDetails(orderId) {
    if (!guardProductPermission('edit', 'You do not have permission to update product details.')) return;
    const order = releaseOrders.find(item => item.product_order_id === orderId);
    if (!order) return;
    await closeStudentOrdersModal();
    let currentSize = '';
    let currentDetails = order.item_note || '';
    if (order.requires_size && currentDetails.startsWith('Size: ')) {
        const parts = currentDetails.slice(6).split(' | ');
        currentSize = parts.shift() || '';
        currentDetails = parts.join(' | ');
    }
    const formHtml = order.requires_size ? `
        <div class="text-start">
            <label class="form-label fw-semibold" for="releaseProductSize">Uniform size <span class="text-danger">*</span></label>
            <input id="releaseProductSize" class="form-control mb-3" maxlength="30" value="${escapeHtml(currentSize)}" placeholder="e.g. Size 10, Small, Medium">
            <label class="form-label fw-semibold" for="releaseProductDetails">Other information</label>
            <textarea id="releaseProductDetails" class="form-control" maxlength="60" rows="3" placeholder="Name to print, preferred fit, or special instructions">${escapeHtml(currentDetails)}</textarea>
        </div>` : `
        <div class="text-start">
            <label class="form-label fw-semibold" for="releaseProductDetails">Product details <span class="text-danger">*</span></label>
            <textarea id="releaseProductDetails" class="form-control" maxlength="100" rows="3" placeholder="Edition, level, name, color, or other specifications">${escapeHtml(currentDetails)}</textarea>
        </div>`;
    const result = await Swal.fire({
        title: order.requires_size ? 'Set uniform details' : 'Set product details',
        html: `<div class="mb-3"><strong>${escapeHtml(order.product_name)} × ${order.quantity}</strong><br><span class="text-muted">${escapeHtml(order.student_name)}</span></div>${formHtml}`,
        showCancelButton: true,
        confirmButtonText: 'Save details',
        confirmButtonColor: '#0d6efd',
        focusConfirm: false,
        preConfirm: () => {
            const size = document.getElementById('releaseProductSize')?.value.trim() || '';
            const details = document.getElementById('releaseProductDetails')?.value.trim() || '';
            if (order.requires_size && !size) {
                Swal.showValidationMessage('Enter the uniform size.');
                return false;
            }
            if (!order.requires_size && !details) {
                Swal.showValidationMessage('Enter the product details.');
                return false;
            }
            return { size, details };
        }
    });
    if (!result.isConfirmed) {
        openStudentOrdersModal(order.enrollment_details_id);
        return;
    }
    try {
        Swal.fire({ title: 'Saving product details…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        const response = await request('updateOrderDetails', {
            product_order_id: order.product_order_id,
            product_order_item_id: order.product_order_item_id,
            ...result.value
        }, 'POST');
        await Swal.fire('Saved', response.message, 'success');
        await loadProductReleaseOrders();
        openStudentOrdersModal(order.enrollment_details_id);
    } catch (error) {
        await Swal.fire('Unable to save details', error.response?.data?.message || error.message, 'error');
        openStudentOrdersModal(order.enrollment_details_id);
    }
}

export async function loadProductReleaseOrders() {
    const tableBody = document.getElementById('productReleaseTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">Loading student product orders…</td></tr>';
    try {
        const response = await request('listOrders');
        releaseOrders = response.data || [];
        updateReleaseStats();
        renderReleaseOrders();
    } catch (error) {
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">${escapeHtml(error.response?.data?.message || error.message)}</td></tr>`;
    }
}

export function initProductReleasePage() {
    if (!document.getElementById('productReleaseTableBody')) return;
    document.getElementById('product-release-filter')?.addEventListener('change', renderReleaseOrders);
    document.getElementById('search-input')?.addEventListener('input', renderReleaseOrders);
    loadProductReleaseOrders();
}
