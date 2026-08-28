import { guardPaymentPermission } from './payment_rbac.js';

const ASSESSMENT_API = '../../api/admin/assessment.php';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
    })[character]);
}

function money(value) {
    return `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function niceDate(value) {
    if (!value) return 'Not set';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleDateString('en-PH', {
        year: 'numeric', month: 'short', day: 'numeric'
    });
}

function ensureStyles() {
    if (document.getElementById('paymentAssessmentStyles')) return;
    const style = document.createElement('style');
    style.id = 'paymentAssessmentStyles';
    style.textContent = `
        .assessment-modal .modal-content{border:0;border-radius:18px;overflow:hidden}
        .assessment-modal .modal-header{background:linear-gradient(135deg,#e85d88,#d94f7a);color:#fff;padding:20px 24px}
        .assessment-modal .assessment-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
        .assessment-modal .assessment-summary>div,.assessment-modal .assessment-card{border:1px solid #eadfe3;border-radius:14px;background:#fff;padding:16px}
        .assessment-modal .assessment-label{color:#64748b;font-size:.76rem;text-transform:uppercase;letter-spacing:.04em;font-weight:700}
        .assessment-modal .assessment-value{color:#172033;font-weight:750;margin-top:3px}
        .assessment-modal .assessment-card-title{display:flex;align-items:center;gap:9px;font-weight:750;color:#263248;margin-bottom:12px}
        .assessment-modal .assessment-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 0;border-top:1px solid #f0e7ea}
        .assessment-modal .assessment-row:first-of-type{border-top:0}
        .assessment-modal .assessment-form{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(110px,.7fr) auto;gap:10px;align-items:end}
        .assessment-modal .assessment-service-form{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:10px;align-items:end}
        .assessment-modal .assessment-discount-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:end}
        .assessment-modal .assessment-empty{padding:12px;border-radius:10px;background:#f8fafc;color:#64748b;text-align:center}
        @media(max-width:767px){.assessment-modal .assessment-summary{grid-template-columns:1fr}.assessment-modal .assessment-form,.assessment-modal .assessment-service-form,.assessment-modal .assessment-discount-form{grid-template-columns:1fr}.assessment-modal .assessment-row{align-items:flex-start;flex-direction:column}}
    `;
    document.head.appendChild(style);
}

async function request(operation, payload = {}, method = 'POST') {
    const response = method === 'GET'
        ? await axios.get(ASSESSMENT_API, { params: { operation, ...payload } })
        : await axios.post(`${ASSESSMENT_API}?operation=${encodeURIComponent(operation)}`, { operation, ...payload });
    if (response.data?.status !== 'success') throw new Error(response.data?.message || 'Assessment request failed.');
    return response.data;
}

function billOptions(bills) {
    return bills.map((bill, index) => `<option value="${bill.billing_schedule_id}" ${index === 0 ? 'selected' : ''}>
        ${escapeHtml(bill.billing_type)} — ${niceDate(bill.due_date)} — ${money(bill.original_amount)}
    </option>`).join('');
}

function statusBadge(status) {
    const normalized = String(status || '').toLowerCase();
    const badge = normalized === 'released' ? 'success'
        : normalized === 'paid' || normalized === 'included' ? 'primary'
            : normalized === 'cancelled' ? 'secondary' : 'warning text-dark';
    return `<span class="badge bg-${badge}">${escapeHtml(status || 'Pending')}</span>`;
}

function serviceSection(data) {
    const current = data.current_service;
    const bills = data.adjustable_bills || [];
    const readOnly = data.read_only;
    if (current) {
        return `
            <div class="assessment-row">
                <div><div class="fw-semibold">${escapeHtml(current.service_name)}</div><small class="text-muted">${money(current.monthly_amount)} per month · ${escapeHtml(current.status)}</small></div>
                ${current.effective_end_date ? `<small class="text-muted">Ends ${niceDate(current.effective_end_date)}</small>` : ''}
            </div>
            ${readOnly ? '' : bills.length ? `
                <div class="assessment-service-form mt-3">
                    <div><label class="form-label small fw-semibold">Stop starting</label><select class="form-select" id="assessmentServiceBill">${billOptions(bills)}</select></div>
                    <div><label class="form-label small fw-semibold">Reason</label><input class="form-control" id="assessmentStopReason" maxlength="255" placeholder="Reason for stopping"></div>
                    <button class="btn btn-outline-danger" id="assessmentStopService"><i class="bi bi-stop-circle me-1"></i>Stop service</button>
                </div>` : '<div class="alert alert-info mt-3 mb-0">There are no untouched future monthly bills that can be adjusted.</div>'}
        `;
    }
    const services = data.available_services || [];
    return `
        <div class="assessment-empty">No active optional service.</div>
        ${readOnly ? '' : (services.length && bills.length) ? `
            <div class="assessment-service-form mt-3">
                <div><label class="form-label small fw-semibold">Service</label><select class="form-select" id="assessmentResumeService">${services.map(service => `<option value="${service.service_id}">${escapeHtml(service.service_name)} — ${money(service.amount)}/month</option>`).join('')}</select></div>
                <div><label class="form-label small fw-semibold">Start billing month</label><select class="form-select" id="assessmentResumeBill">${billOptions(bills)}</select></div>
                <button class="btn btn-success" id="assessmentStartService"><i class="bi bi-play-circle me-1"></i>Start service</button>
            </div>` : '<div class="alert alert-info mt-3 mb-0">No service or adjustable future month is available.</div>'}
    `;
}

function discountSection(data) {
    const enrollment = data.enrollment;
    const discounts = data.available_discounts || [];
    const currentId = Number(enrollment.discount_id || 0);
    const currentName = enrollment.discount_name || 'No discount';
    const options = discounts.map(discount => {
        const value = discount.discount_type === 'percentage' ? `${Number(discount.discount_value)}%`
            : discount.discount_type === 'full_waiver' ? 'Full waiver' : money(discount.discount_value);
        return `<option value="${discount.discount_id}" ${currentId === discount.discount_id ? 'selected' : ''}>${escapeHtml(discount.discount_name)} — ${value}</option>`;
    }).join('');
    return `
        <div class="assessment-row">
            <div><div class="fw-semibold">${escapeHtml(currentName)}</div><small class="text-muted">Current discount: ${money(enrollment.discount_amount || 0)}</small></div>
            ${currentId ? '<span class="badge bg-dark">Tagged</span>' : '<span class="badge bg-secondary">Not tagged</span>'}
        </div>
        ${data.read_only ? '' : `
            <div class="assessment-discount-form mt-3">
                <div><label class="form-label small fw-semibold">Student discount</label><select class="form-select" id="assessmentDiscount"><option value="0">No discount</option>${options}</select></div>
                <button class="btn btn-dark" id="assessmentApplyDiscount"><i class="bi bi-tag me-1"></i>${currentId ? 'Update discount' : 'Tag discount'}</button>
            </div>
            <div class="small text-muted mt-2">The adjustment applies only to untouched unpaid tuition bills. Paid bills and additional product charges are not changed.</div>`}
    `;
}

function includedProductsSection(data) {
    const products = data.included_products || [];
    if (!products.length) return '<div class="assessment-empty">No products are included in this program.</div>';
    return products.map(product => `
        <div class="assessment-row">
            <div><div class="fw-semibold">${escapeHtml(product.product_name)}</div><small class="text-muted">Included in enrollment · Stock: ${product.stock_quantity}</small></div>
            <div class="d-flex align-items-center gap-2">
                ${statusBadge(product.status)}
            </div>
        </div>`).join('');
}

function additionalOrdersSection(data) {
    const orders = data.additional_orders || [];
    if (!orders.length) return '<div class="assessment-empty">No additional product requests.</div>';
    return orders.map(order => `
        <div class="assessment-row">
            <div>
                <div class="fw-semibold">${escapeHtml(order.product_name)} × ${order.quantity}</div>
                <small class="text-muted">Order #${order.product_order_id} · ${money(order.line_total)}${order.item_note ? ` · ${escapeHtml(order.item_note)}` : ''}</small>
            </div>
            <div class="d-flex align-items-center gap-2 flex-wrap">
                ${statusBadge(order.status)}
                ${!data.read_only && order.status === 'awaiting_payment' && Number(order.paid_amount) === 0 ? `<button class="btn btn-sm btn-outline-danger assessment-cancel-order" data-order-id="${order.product_order_id}">Cancel</button>` : ''}
            </div>
        </div>`).join('');
}

function modalHtml(data) {
    const enrollment = data.enrollment;
    const products = data.available_products || [];
    return `
        <div class="modal fade assessment-modal" id="paymentAssessmentModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <div><div class="small text-uppercase opacity-75 fw-semibold">Billing and product control</div><h5 class="modal-title mb-0"><i class="bi bi-clipboard2-check me-2"></i>Assessment</h5></div>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body p-4 bg-light">
                        ${data.read_only ? '<div class="alert alert-info">View-only assessment. Your account cannot change services or products.</div>' : ''}
                        <div class="assessment-summary mb-3">
                            <div><div class="assessment-label">Student</div><div class="assessment-value">${escapeHtml(enrollment.student_name)}</div><small class="text-muted">${escapeHtml(enrollment.student_id_number || '')}</small></div>
                            <div><div class="assessment-label">Program</div><div class="assessment-value">${escapeHtml(enrollment.program_name)}</div><small class="text-muted text-capitalize">${escapeHtml(enrollment.enrollment_status)}</small></div>
                            <div><div class="assessment-label">Recorded total</div><div class="assessment-value">${money(enrollment.total_of_program)}</div><small class="text-muted">Updates after each assessment</small></div>
                        </div>
                        <section class="assessment-card mb-3"><div class="assessment-card-title"><i class="bi bi-tag text-dark"></i>Student Discount</div>${discountSection(data)}</section>
                        <section class="assessment-card mb-3"><div class="assessment-card-title"><i class="bi bi-bus-front text-primary"></i>Optional Service</div>${serviceSection(data)}</section>
                        <section class="assessment-card mb-3"><div class="assessment-card-title"><i class="bi bi-box-seam text-primary"></i>Included Products</div>${includedProductsSection(data)}<div class="small text-muted mt-2"><i class="bi bi-info-circle me-1"></i>Product release is managed from the Product page.</div></section>
                        <section class="assessment-card mb-3">
                            <div class="assessment-card-title"><i class="bi bi-bag-plus text-primary"></i>Additional Product Request</div>
                            ${data.read_only ? '' : products.length ? `
                                <div class="assessment-form mb-3">
                                    <div><label class="form-label small fw-semibold">Product</label><select class="form-select" id="assessmentProduct">${products.map(product => `<option value="${product.product_id}" data-price="${product.price}">${escapeHtml(product.product_name)} — ${money(product.price)} · Stock ${product.quantity}</option>`).join('')}</select></div>
                                    <div><label class="form-label small fw-semibold">Quantity</label><input type="number" min="1" max="20" value="1" class="form-control" id="assessmentProductQty"></div>
                                    <button class="btn btn-primary" id="assessmentAddProduct"><i class="bi bi-plus-circle me-1"></i>Add charge</button>
                                </div>` : '<div class="alert alert-warning">No active products are available.</div>'}
                            <div class="assessment-card-title mt-2 mb-1"><i class="bi bi-receipt text-secondary"></i>Request History</div>
                            ${additionalOrdersSection(data)}
                        </section>
                    </div>
                    <div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button></div>
                </div>
            </div>
        </div>`;
}

async function runAction(operation, payload, confirmation) {
    if (confirmation) {
        const result = await Swal.fire({
            icon: 'question', title: confirmation.title, text: confirmation.text,
            showCancelButton: true, confirmButtonText: confirmation.confirmText || 'Continue', confirmButtonColor: '#d94f7a'
        });
        if (!result.isConfirmed) return false;
    }
    Swal.fire({ title: 'Saving assessment…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    const response = await request(operation, payload);
    await Swal.fire('Saved', response.message || 'Assessment updated.', 'success');
    return true;
}

function bindActions(data, enrollmentId) {
    document.getElementById('assessmentApplyDiscount')?.addEventListener('click', async () => {
        const select = document.getElementById('assessmentDiscount');
        const discountId = Number(select?.value || 0);
        const label = select?.selectedOptions?.[0]?.textContent || 'No discount';
        try {
            const changed = await runAction('applyDiscount', {
                enrollment_id: enrollmentId,
                discount_id: discountId
            }, {
                title: discountId ? 'Tag this discount?' : 'Remove student discount?',
                text: discountId ? `${label} will be applied to untouched unpaid tuition bills.` : 'The current discount will be added back to an untouched unpaid tuition bill.',
                confirmText: discountId ? 'Tag discount' : 'Remove discount'
            });
            if (changed) await window.openPaymentAssessment(enrollmentId, true);
        } catch (error) { Swal.fire('Discount update failed', error.response?.data?.message || error.message, 'error'); }
    });

    document.getElementById('assessmentStopService')?.addEventListener('click', async () => {
        const reason = document.getElementById('assessmentStopReason')?.value.trim();
        if (!reason) return Swal.fire('Reason required', 'Enter why the service is being stopped.', 'warning');
        try {
            const changed = await runAction('stopService', {
                enrollment_id: enrollmentId,
                effective_billing_id: Number(document.getElementById('assessmentServiceBill').value), reason
            }, { title: 'Stop this service?', text: 'Only untouched future monthly bills will be reduced.', confirmText: 'Stop service' });
            if (changed) await window.openPaymentAssessment(enrollmentId, true);
        } catch (error) { Swal.fire('Assessment failed', error.message, 'error'); }
    });

    document.getElementById('assessmentStartService')?.addEventListener('click', async () => {
        try {
            const changed = await runAction('resumeService', {
                enrollment_id: enrollmentId,
                service_id: Number(document.getElementById('assessmentResumeService').value),
                effective_billing_id: Number(document.getElementById('assessmentResumeBill').value)
            }, { title: 'Start this service?', text: 'The monthly service amount will be added to untouched future bills.', confirmText: 'Start service' });
            if (changed) await window.openPaymentAssessment(enrollmentId, true);
        } catch (error) { Swal.fire('Assessment failed', error.message, 'error'); }
    });

    document.getElementById('assessmentAddProduct')?.addEventListener('click', async () => {
        const productSelect = document.getElementById('assessmentProduct');
        const quantity = Number(document.getElementById('assessmentProductQty')?.value || 1);
        const productLabel = productSelect?.selectedOptions?.[0]?.textContent || 'product';
        try {
            const changed = await runAction('addProductCharge', {
                enrollment_id: enrollmentId, product_id: Number(productSelect.value), quantity
            }, { title: 'Create product charge?', text: `${quantity} × ${productLabel}. Product details will be completed on the Product page before release.`, confirmText: 'Create charge' });
            if (changed) await window.openPaymentAssessment(enrollmentId, true);
        } catch (error) { Swal.fire('Assessment failed', error.message, 'error'); }
    });

    document.querySelectorAll('.assessment-cancel-order').forEach(button => button.addEventListener('click', async () => {
        try {
            const changed = await runAction('cancelProductOrder', {
                enrollment_id: enrollmentId, product_order_id: Number(button.dataset.orderId)
            }, { title: 'Cancel this request?', text: 'The unpaid charge will be removed from the outstanding balance.', confirmText: 'Cancel request' });
            if (changed) await window.openPaymentAssessment(enrollmentId, true);
        } catch (error) { Swal.fire('Cancellation failed', error.message, 'error'); }
    }));
}

window.openPaymentAssessment = async function openPaymentAssessment(enrollmentId, refresh = false) {
    if (!refresh && !guardPaymentPermission('view', 'You do not have permission to view billing assessments.')) return;
    ensureStyles();
    try {
        if (!refresh) Swal.fire({ title: 'Loading assessment…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        const response = await request('getAssessment', { enrollment_id: enrollmentId }, 'GET');
        Swal.close();
        const existing = document.getElementById('paymentAssessmentModal');
        if (existing) {
            bootstrap.Modal.getInstance(existing)?.dispose();
            existing.remove();
            document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.remove());
            document.body.classList.remove('modal-open');
            document.body.style.removeProperty('padding-right');
        }
        document.body.insertAdjacentHTML('beforeend', modalHtml(response.data));
        const modalElement = document.getElementById('paymentAssessmentModal');
        const modal = new bootstrap.Modal(modalElement);
        modalElement.addEventListener('hidden.bs.modal', () => modalElement.remove(), { once: true });
        bindActions(response.data, Number(enrollmentId));
        modal.show();
        window.dispatchEvent(new CustomEvent('payment-status-updated'));
    } catch (error) {
        Swal.fire('Assessment unavailable', error.response?.data?.message || error.message, 'error');
    }
};
