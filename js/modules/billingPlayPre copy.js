/**
 * PRESCHOOL & PLAYSCHOOL BILLING CONTROLLER 
 * Updated with FIFO logic + Payment History while maintaining original UI Layout
 */

window.openBillingPlayPreModal = async function(enrollmentId, showPayment = true) {
    Swal.fire({
        title: 'Loading Billing Details...',
        didOpen: () => Swal.showLoading()
    });

    try {
        // Updated to include getPaymentHistory and getEnrollmentDetails
        const [billingRes, methodsRes, paymentsRes, enrollmentRes] = await Promise.all([
            axios.get(`../../api/admin/billing.php?operation=getBillingDetails&enrollment_id=${enrollmentId}`),
            axios.get(`../../api/admin/billing.php?operation=getPaymentMethods`),
            axios.get(`../../api/admin/payment.php?operation=getPaymentHistory&enrollment_details_id=${enrollmentId}`).catch(err => ({ data: { status: 'error', history: [] } })),
            axios.get(`../../api/admin/enrollment.php?operation=getEnrollmentDetails&enrollment_details_id=${enrollmentId}`).catch(err => ({ data: { status: 'error', data: { details: { status: 'unknown' } } } }))
        ]);

        if (!(billingRes.data.status === 'success' && methodsRes.data.status === 'success')) {
            Swal.close();
            Swal.fire("Error", "Could not fetch billing details.", "error");
            return;
        }

        const enrollmentData = billingRes.data.data;
        const enrollmentDetails = enrollmentRes.data.status === 'success' ? enrollmentRes.data.data.details : { status: 'unknown' };
        const enrollmentStatus = enrollmentDetails.status || 'unknown';
        const paymentsHistory = paymentsRes.data.status === 'success' ? paymentsRes.data.history || [] : [];
        const totalPaymentsMade = paymentsHistory.reduce((sum, p) => sum + parseFloat(p.amount_paid || 0), 0);

        let programId = enrollmentData.program_id || enrollmentData.programId || enrollmentData.PROGRAM_ID;
        if (!programId && enrollmentData.program_name) {
            const programsRes = await axios.get(`../../api/admin/program.php?operation=getPrograms`);
            const programs = programsRes.data.status === 'success' ? programsRes.data.data : [];
            const matchedProgram = programs.find(p => p.name && p.name.trim().toLowerCase() === enrollmentData.program_name.trim().toLowerCase());
            if (matchedProgram) programId = matchedProgram.program_id;
        }

        let miscProducts = [];
        if (programId) {
            try {
                const prodRes = await axios.get(`../../api/admin/program_products.php?operation=getProductsByProgram&program_id=${programId}`);
                miscProducts = prodRes.data.status === 'success' ? prodRes.data.data : [];
            } catch (err) {
                console.warn('Could not fetch program products:', err);
            }
        }

        Swal.close();
        renderBillingPlayPreModal(enrollmentData, methodsRes.data.data, enrollmentId, miscProducts, totalPaymentsMade, showPayment, enrollmentStatus, paymentsHistory);
    } catch (err) {
        console.error(err);
        Swal.close();
        Swal.fire("Error", "Network error occurred.", "error");
    }
};

function renderBillingPlayPreModal(data, paymentMethods, enrollmentId, miscProducts = [], totalPaymentsMade = 0, showPayment = true, enrollmentStatus = 'unknown', paymentsHistory = []) {
    // 1. DATA CALCULATIONS (FIFO LOGIC)
    const allBillingItems = data.schedule ? data.schedule : [];
    
    const monthlyBilling = allBillingItems.filter(s => s.billing_type && s.billing_type.toLowerCase().includes('month'))
        .sort((a, b) => {
            const aNum = parseInt(a.billing_type.replace(/\D/g, '')) || 0;
            const bNum = parseInt(b.billing_type.replace(/\D/g, '')) || 0;
            return aNum - bNum;
        });

    const miscTotalFromProducts = miscProducts.reduce((sum, p) => sum + parseFloat(p.price || 0), 0);
    const monthlyTotal = monthlyBilling.reduce((sum, m) => sum + parseFloat(m.amount || 0), 0);
    const grandTotal = monthlyTotal + miscTotalFromProducts;

    // FIFO Order: Month 1 + Misc, then remaining months
    let orderedItems = [];
    if (monthlyBilling.length > 0) {
        orderedItems = [
            { id: 'm1_misc', type: 'Month 1 + Misc', amount: parseFloat(monthlyBilling[0].amount) + miscTotalFromProducts },
            ...monthlyBilling.slice(1).map((m, i) => ({ id: `m${i+2}`, type: m.billing_type, amount: parseFloat(m.amount) }))
        ];
    }

    // Apply FIFO Pool
    let remainingPool = totalPaymentsMade;
    const computedFIFO = orderedItems.map(item => {
        let paid = 0;
        if (remainingPool > 0) {
            if (remainingPool >= item.amount) {
                paid = item.amount;
                remainingPool -= item.amount;
            } else {
                paid = remainingPool;
                remainingPool = 0;
            }
        }
        return { ...item, remaining: item.amount - paid };
    });

    const firstDueItem = computedFIFO.find(i => i.remaining > 0);
    const initialPaymentAmount = firstDueItem ? firstDueItem.remaining : 0;
    const balance = computedFIFO.reduce((sum, i) => sum + i.remaining, 0);
    const isFullyPaid = balance <= 0;

    // 2. UI COMPONENTS
    const paymentOptions = paymentMethods.map(pm =>
        `<option value="${pm.payment_method_id}">${pm.payment_method}</option>`
    ).join('');

    const paymentSection = (showPayment && !isFullyPaid) ? `
        <div class="text-center mb-3 border-top pt-3">
            <h5 class="text-primary fw-bold"><i class="bi bi-credit-card"></i> Process Payment</h5>
        </div>
        <div class="row g-2 px-2">
            <div class="col-md-7">
                <label class="form-label fw-bold small mb-1">Payment Amount</label>
                <div class="input-group">
                    <span class="input-group-text bg-white text-muted">₱</span>
                    <input type="number" class="form-control" id="modalPaymentAmount" value="${initialPaymentAmount.toFixed(2)}" max="${balance}" step="0.01" data-max-balance="${balance}">
                </div>
            </div>
            <div class="col-md-5">
                <label class="form-label fw-bold small mb-1">Method</label>
                <select class="form-select" id="modalPaymentMethod">
                    <option value="">Select...</option>
                    ${paymentOptions}
                </select>
            </div>
            <div class="col-12" id="referenceContainer" style="display: none;">
                <label class="form-label fw-bold small mb-1">Reference No. (GCash)</label>
                <input type="text" class="form-control" id="modalReferenceNo" placeholder="Enter Ref #">
            </div>
        </div>
    ` : (isFullyPaid ? `<div class="alert alert-success text-center mx-3">Account Fully Paid</div>` : 
        `<div class="alert alert-info text-center mx-3"><i class="bi bi-eye"></i> Billing statement view only.</div>`);

    const html = `
        <div style="font-family: 'Segoe UI', sans-serif; padding: 20px; max-height: 85vh; overflow-y: auto;">
            
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 24px;">
                <h3 style="margin: 0; color: #ea9aa6; font-weight: 700; font-size: 1.3rem;">
                    <i class="bi bi-calendar2" style="margin-right: 8px;"></i>Preschool / Playschool Billing
                </h3>
            </div>

            <!-- Student Details -->
            <div style="margin-bottom: 24px;">
                <h5 style="margin: 0 0 12px 0; color: #ea9aa6; font-weight: 700; font-size: 0.95rem;">
                    <i class="bi bi-person-circle" style="margin-right: 6px;"></i>Student Details
                </h5>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 0.9rem;">
                    <div>
                        <div style="color: #999; font-size: 0.8rem; margin-bottom: 4px;">Name</div>
                        <div style="color: #333; font-weight: 600;">${data.student_name}</div>
                    </div>
                    <div>
                        <div style="color: #999; font-size: 0.8rem; margin-bottom: 4px;">Program</div>
                        <div style="color: #333; font-weight: 600;">${data.program_name}</div>
                    </div>
                </div>
            </div>

            <!-- Billing Schedule Header Metrics -->
            <div style="margin-bottom: 20px;">
                <h5 style="margin: 0 0 12px 0; color: #ea9aa6; font-weight: 700; font-size: 0.95rem;">
                    <i class="bi bi-receipt" style="margin-right: 6px;"></i>Billing Schedule
                </h5>
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px;">
                    <div style="text-align: center; padding: 12px; background: #f5f5f5; border-radius: 8px;">
                        <div style="font-size: 1.3rem; font-weight: 700; color: #333;">${monthlyBilling.length}</div>
                        <div style="font-size: 0.75rem; color: #999; margin-top: 4px;">Total Months</div>
                    </div>
                    <div style="text-align: center; padding: 12px; background: #fff5f7; border-radius: 8px;">
                        <div style="font-size: 1.3rem; font-weight: 700; color: #ea9aa6;">₱${monthlyTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
                        <div style="font-size: 0.75rem; color: #999; margin-top: 4px;">Tuition Total</div>
                    </div>
                    <div style="text-align: center; padding: 12px; background: #fff5f7; border-radius: 8px;">
                        <div style="font-size: 1.3rem; font-weight: 700; color: #f97316;">₱${miscTotalFromProducts.toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
                        <div style="font-size: 0.75rem; color: #999; margin-top: 4px;">Misc. Fees</div>
                    </div>
                    <div style="text-align: center; padding: 12px; background: #e0f2fe; border-radius: 8px;">
                        <div style="font-size: 1.3rem; font-weight: 700; color: #0284c7;">₱${initialPaymentAmount.toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
                        <div style="font-size: 0.75rem; color: #999; margin-top: 4px;">Total Due Now</div>
                    </div>
                </div>

                <!-- Billing Table -->
                <div style="overflow-x: auto; margin-bottom: 16px;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                        <thead>
                            <tr style="background: #f5f5f5; border-bottom: 2px solid #e5e5e5;">
                                <th style="text-align: left; padding: 10px; font-weight: 700; color: #333;">Month</th>
                                <th style="text-align: center; padding: 10px; font-weight: 700; color: #333;">Date</th>
                                <th style="text-align: right; padding: 10px; font-weight: 700; color: #333;">Amount</th>
                                <th style="text-align: center; padding: 10px; font-weight: 700; color: #333;">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${monthlyBilling.map(m => `
                                <tr style="font-size: 0.9rem;">
                                    <td style="text-align: left; padding: 8px; color: #666;">
                                        <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #ea9aa6; margin-right: 6px;"></span>
                                        ${m.billing_type}
                                    </td>
                                    <td style="text-align: center; padding: 8px;">${m.due_date ? new Date(m.due_date).toLocaleDateString('en-US', {year: 'numeric', month: 'short', day: 'numeric'}) : 'Not Set'}</td>
                                    <td style="text-align: right; padding: 8px; color: #10b981; font-weight: 600;">₱${parseFloat(m.amount).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                                    <td style="text-align: center; padding: 8px;"><span style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; background: ${m.status === 'paid' ? '#dcfce7' : m.status === 'partial' ? '#dbeafe' : '#fef3c7'}; color: ${m.status === 'paid' ? '#15803d' : m.status === 'partial' ? '#2563eb' : '#b45309'};">${m.status.charAt(0).toUpperCase() + m.status.slice(1)}</span></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Miscellaneous Fees -->
            ${miscProducts.length > 0 ? `
            <div style="margin-bottom: 20px; padding: 16px; background: #fafafa; border-radius: 8px;">
                <h5 style="margin: 0 0 12px 0; color: #ea9aa6; font-weight: 700; font-size: 0.95rem;">
                    <i class="bi bi-bag" style="margin-right: 6px;"></i>Miscellaneous Fees
                </h5>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 0.9rem;">
                    ${miscProducts.map(p => `
                        <div style="display: flex; justify-content: space-between; padding: 8px; border-bottom: 1px solid #e5e5e5;">
                            <span style="color: #666;">${p.product_name}</span>
                            <span style="font-weight: 600; color: #ea9aa6;">₱${parseFloat(p.price).toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                        </div>
                    `).join('')}
                    <div style="display: flex; justify-content: space-between; padding: 8px; font-weight: 700; grid-column: 1 / -1;">
                        <span style="color: #333;">Total</span>
                        <span style="color: #ea9aa6;">₱${miscTotalFromProducts.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                    </div>
                </div>
            </div>
            ` : ''}

            <!-- Summary Section -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
                <div style="text-align: left;">
                    <div style="font-size: 0.9rem; color: #999; margin-bottom: 4px;">Tuition Subtotal</div>
                    <div style="font-size: 1.4rem; font-weight: 700; color: #ea9aa6;">₱${monthlyTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
                </div>
                <div style="text-align: left;">
                    <div style="font-size: 0.9rem; color: #999; margin-bottom: 4px;">Grand Total</div>
                    <div style="font-size: 1.4rem; font-weight: 700; color: #333;">₱${grandTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; padding: 16px; background: #f0f9ff; border-radius: 8px;">
                <div>
                    <div style="font-size: 0.9rem; color: #999; margin-bottom: 4px;">Total Due Now</div>
                    <div style="font-size: 1.3rem; font-weight: 700; color: #0284c7;">₱${initialPaymentAmount.toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
                </div>
                <div>
                    <div style="font-size: 0.9rem; color: #999; margin-bottom: 4px;">Outstanding Balance</div>
                    <div style="font-size: 1.3rem; font-weight: 700; color: #dc2626;">₱${balance.toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
                </div>
            </div>

            ${enrollmentStatus === 'pending' ? `
            <div style="text-align: center; margin-bottom: 16px;">
                <button class="btn btn-success" onclick="confirmEnrollment(${enrollmentId})"><i class="bi bi-check-circle"></i> Receive Enrollment</button>
            </div>
            ` : ''}

            ${paymentSection}
        </div>`;

    Swal.fire({
        title: '',
        html: html,
        width: '700px',
        showCancelButton: false,
        confirmButtonText: (showPayment && !isFullyPaid) ? 'Confirm Payment' : 'Close',
        confirmButtonColor: '#ea9aa6',
        didOpen: () => {
            const methodSelect = document.getElementById('modalPaymentMethod');
            const referenceContainer = document.getElementById('referenceContainer');
            const paymentInput = document.getElementById('modalPaymentAmount');
            const maxBalance = parseFloat(paymentInput?.dataset.maxBalance || 0);

            methodSelect?.addEventListener('change', function() {
                referenceContainer.style.display = this.options[this.selectedIndex].text.toLowerCase().includes('gcash') ? 'block' : 'none';
            });

            paymentInput?.addEventListener('input', function() {
                const val = parseFloat(this.value) || 0;
                if (val > maxBalance) {
                    this.value = maxBalance.toFixed(2);
                }
            });
        },
        preConfirm: () => {
            if (!showPayment || isFullyPaid) return true;
            const amount = parseFloat(document.getElementById('modalPaymentAmount').value);
            const method = document.getElementById('modalPaymentMethod').value;
            if (!amount || amount <= 0) { Swal.showValidationMessage('Enter valid amount'); return false; }
            if (!method) { Swal.showValidationMessage('Select method'); return false; }
            return { amount, method, ref: document.getElementById('modalReferenceNo')?.value || null };
        }
    }).then((result) => {
        if (result.isConfirmed && showPayment && !isFullyPaid) {
            axios.post('../../api/admin/payment.php', {
                operation: 'processPayment',
                json: JSON.stringify({
                    enrollment_id: enrollmentId,
                    amount: result.value.amount,
                    method: result.value.method,
                    ref: result.value.ref,
                    payment_type: 'Tuition Fee'
                })
            }).then((res) => {x 
                if (res.data.status === 'success') {
                    Swal.fire('Success', 'Payment recorded successfully.', 'success')
                        .then(() => location.reload());
                } else {
                    Swal.fire('Error', res.data.message || 'Failed to record payment.', 'error');
                }
            }).catch((err) => {
                console.error(err);
                Swal.fire('Error', 'Network error occurred while recording payment.', 'error');
            });
        }
    });
}

window.confirmEnrollment = function(enrollmentId) {
    Swal.fire({
        title: 'Confirm Enrollment',
        text: 'Are you sure you want to receive this enrollment?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Yes, Receive'
    }).then((result) => {
        if (result.isConfirmed) {
            axios.post('../../api/admin/enrollment.php', {
                operation: 'updateEnrollmentStatus',
                json: JSON.stringify({ enrollment_details_id: enrollmentId })
            }).then((res) => {
                if (res.data.status === 'success') {
                    Swal.fire('Success', 'Enrollment received', 'success');
                    location.reload();
                } else {
                    Swal.fire('Error', res.data.message || 'Failed to update status', 'error');
                }
            }).catch(err => {
                console.error(err);
                Swal.fire('Error', 'Network error', 'error');
            });
        }
    });
};