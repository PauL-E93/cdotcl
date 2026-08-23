/**
 * PRESCHOOL & PLAYSCHOOL BILLING CONTROLLER 
 * Updated with FIFO logic + Payment History while maintaining original UI Layout
 */
import { showPaymentReceipt } from "./receipt.js";
import { canUsePaymentPermission, guardPaymentPermission, isPaymentModulePage } from "./payment_rbac.js";
import { chooseBillingStatementExportFormat, exportBillingStatementData } from "../utilities/billing_statement_export.js";

function formatReceiptDueDate(dateValue) {
    if (!dateValue) return '';
    return new Date(dateValue).toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

window.openBillingPlayPreModal = async function(enrollmentId, showPayment = true) {
    const effectiveShowPayment = showPayment && (!isPaymentModulePage() || canUsePaymentPermission('create'));

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
            axios.get(`../../api/admin/enrollment.php?operation=getEnrollmentDetails&id=${enrollmentId}`).catch(err => ({ data: { status: 'error', data: { details: { status: 'unknown' } } } }))
        ]);

        if (!(billingRes.data.status === 'success' && methodsRes.data.status === 'success')) {
            Swal.close();
            Swal.fire("Error", "Could not fetch billing details.", "error");
            return;
        }

        const enrollmentData = billingRes.data.data;
        const enrollmentDetails = enrollmentRes.data.status === 'success' ? enrollmentRes.data.data.details : { status: 'unknown' };
        const enrollmentStatus = enrollmentDetails.header_status || enrollmentDetails.status || enrollmentDetails.details_status || 'unknown';
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
        renderBillingPlayPreModal(enrollmentData, methodsRes.data.data, enrollmentId, miscProducts, totalPaymentsMade, effectiveShowPayment, enrollmentStatus, paymentsHistory, enrollmentDetails);
    } catch (err) {
        console.error(err);
        Swal.close();
        Swal.fire("Error", "Network error occurred.", "error");
    }
};

function ensureAdminPrePlayBillingStyles() {
    if (document.getElementById('adminPrePlayBillingStyles')) return;

    const styles = document.createElement('style');
    styles.id = 'adminPrePlayBillingStyles';
    styles.textContent = `
        .admin-preplay-modal-container{padding:6px}
        .admin-preplay-popup{--app-pink:#e85d88;--app-pink-dark:#d94b78;--app-soft:#fff4f7;--app-border:#f4c4d3;--app-ink:#1d2a3b;--app-muted:#667085;width:min(1000px,calc(100vw - 20px))!important;max-width:1000px!important}
        .admin-preplay-popup .swal2-html-container{margin-inline:1em}
        .admin-preplay-timeline-content{display:grid;grid-template-columns:minmax(150px,1fr) minmax(270px,1.25fr) auto;align-items:center;gap:16px;min-width:0;flex:1}
        .admin-preplay-timeline-main{min-width:0}
        .admin-preplay-timeline-title{font-weight:700;overflow-wrap:anywhere}
        .admin-preplay-timeline-metrics{display:grid;grid-template-columns:repeat(2,minmax(115px,1fr));gap:12px}
        .admin-preplay-timeline-metric{min-width:0;padding:9px 12px;border-radius:10px;background:#f8fafc;text-align:right}
        .admin-preplay-timeline-metric-label{margin-bottom:2px;color:#6b7280;font-size:.78rem}
        .admin-preplay-timeline-metric-value{font-weight:750;line-height:1.2;overflow-wrap:anywhere}
        .admin-preplay-timeline-status{justify-self:end}
        .admin-preplay-popup .payment-timeline-indicator{align-self:stretch}
        .admin-preplay-popup .payment-timeline-connector{flex:1;min-height:2.75rem}
        .admin-preplay-payment-card{padding:22px 24px;margin-top:18px;border:1px solid var(--app-border);border-radius:14px;background:#fff;box-shadow:0 3px 9px rgba(90,44,59,.06)}
        .admin-preplay-payment-title{display:flex;align-items:center;gap:12px;margin:0 0 18px;color:var(--app-pink);font-size:1.35rem;font-weight:750}
        .admin-preplay-payment-title-icon{display:grid;flex:0 0 38px;width:38px;height:38px;place-items:center;border-radius:10px;color:var(--app-pink);background:#fdeaf0;font-size:1.05rem}
        .admin-preplay-payment-copy{margin:0 0 16px;color:var(--app-muted);font-size:.94rem}
        .admin-preplay-payment-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:18px 22px}
        .admin-preplay-payment-field{min-width:0}
        .admin-preplay-payment-field.full{grid-column:1/-1}
        .admin-preplay-payment-field label{margin-bottom:8px;color:var(--app-ink);font-size:.94rem;font-weight:700}
        .admin-preplay-payment-field .form-control,.admin-preplay-payment-field .form-select,.admin-preplay-payment-field .input-group-text{min-height:52px;border-color:#d7dde6}
        .admin-preplay-payment-field .form-control:focus,.admin-preplay-payment-field .form-select:focus{border-color:#ef9bb5;box-shadow:0 0 0 .2rem rgba(232,93,136,.13)}
        .admin-preplay-payment-field .input-group-text{min-width:58px;justify-content:center;background:#f8f9fb;font-weight:700}
        .admin-preplay-payment-help{display:block;margin-top:7px;color:var(--app-muted);font-size:.82rem}
        .admin-preplay-popup .swal2-close{color:var(--app-pink)}
        .admin-preplay-popup .swal2-validation-message{border-radius:9px}
        @media(max-width:767.98px){
            .admin-preplay-popup{width:calc(100vw - 12px)!important;max-width:calc(100vw - 12px)!important;padding:0!important;border-radius:14px!important}
            .admin-preplay-popup .swal2-title{padding:24px 44px 14px 16px;font-size:1.3rem;line-height:1.2}
            .admin-preplay-popup .swal2-html-container{margin:0;padding:0 10px;overflow:hidden}
            .admin-preplay-popup .billing-container>.card,.admin-preplay-popup .billing-container>.row{margin-bottom:12px!important}
            .admin-preplay-popup .card{border-radius:14px!important}
            .admin-preplay-popup .card-body.p-4{padding:16px!important}
            .admin-preplay-popup .payment-timeline-step{gap:10px;margin-bottom:12px}
            .admin-preplay-popup .payment-timeline-indicator{width:2.25rem}
            .admin-preplay-popup .payment-timeline-marker{width:2.15rem;height:2.15rem}
            .admin-preplay-timeline-content{display:block;padding:12px;overflow:hidden;border:1px solid #e5e7eb;border-radius:12px;background:#fff}
            .admin-preplay-timeline-main{padding-bottom:10px;border-bottom:1px solid #edf0f3}
            .admin-preplay-timeline-title{font-size:1rem}
            .admin-preplay-timeline-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}
            .admin-preplay-timeline-metric{padding:9px 8px;text-align:left}
            .admin-preplay-timeline-metric-label{font-size:.72rem}
            .admin-preplay-timeline-metric-value{font-size:.9rem}
            .admin-preplay-timeline-status{margin-top:10px}
            .admin-preplay-timeline-status .badge{display:inline-flex;padding:6px 10px}
            .admin-preplay-payment-card{padding:18px 14px;margin-top:14px}
            .admin-preplay-payment-title{gap:10px;margin-bottom:14px;font-size:1.2rem}
            .admin-preplay-payment-grid{grid-template-columns:1fr;gap:15px}
            .admin-preplay-payment-field.full{grid-column:auto}
            .admin-preplay-popup .billing-container .row.g-3{--bs-gutter-y:12px}
            .admin-preplay-popup .billing-container .d-flex.justify-content-between{gap:12px}
            .admin-preplay-popup .billing-container .d-flex.justify-content-between>*{min-width:0;overflow-wrap:anywhere}
            .admin-preplay-popup .swal2-actions{width:100%;margin:0;padding:14px 10px 18px}
            .admin-preplay-popup .swal2-confirm,.admin-preplay-popup .swal2-cancel{width:100%;margin:0;min-height:48px}
        }
        @media(max-width:380px){
            .admin-preplay-timeline-metrics{grid-template-columns:1fr}
            .admin-preplay-popup .payment-timeline-indicator{width:2rem}
            .admin-preplay-popup .payment-timeline-marker{width:2rem;height:2rem}
            .admin-preplay-popup .payment-timeline-step{gap:7px}
        }
    `;
    document.head.appendChild(styles);
}

function createPrePlayBillingExportFilename(studentName, enrollmentId) {
    const safeName = String(studentName || `enrollment-${enrollmentId}`)
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
    return `pre-play-billing-statement-${safeName || enrollmentId}`;
}

function downloadPrePlayBillingStatementPdf({
    data,
    enrollmentId,
    enrollmentDetails,
    monthlyBilling,
    getBillingBaseAmount,
    getBillingBaseRemaining,
    itemizedMiscProducts,
    miscBilling,
    registrationBilling,
    totalTuition,
    otherFeeTotal,
    servicesTotal,
    grandTotal,
    discountAmount,
    discountName,
    totalPenalty,
    totalPaymentsMade,
    balance,
    paymentsHistory = []
}) {
    if (!window.jspdf?.jsPDF) throw new Error('PDF export library is unavailable.');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait' });
    const money = value => `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const className = enrollmentDetails.class_id_from_section || enrollmentDetails.class_id;

    pdf.setFontSize(17);
    pdf.text('Preschool / Playschool Billing Statement', 14, 16);
    pdf.setFontSize(9);
    pdf.setTextColor(90);
    pdf.text(`Generated: ${new Date().toLocaleString('en-PH')}`, 14, 22);
    pdf.setTextColor(0);

    pdf.autoTable({
        startY: 27,
        theme: 'plain',
        body: [
            ['Student', data.student_name || 'N/A', 'Program', data.program_name || 'N/A'],
            ['Class', className ? `Class ${className}` : 'N/A', 'Section', enrollmentDetails.section_name || 'N/A'],
            ['Section Teacher', enrollmentDetails.section_teacher_name || enrollmentDetails.teacher_name || 'Not assigned', '', '']
        ],
        styles: { fontSize: 9, cellPadding: 2 },
        columnStyles: { 0: { fontStyle: 'bold' }, 2: { fontStyle: 'bold' } }
    });

    const scheduleRows = monthlyBilling.map(item => [
        item.billing_type || 'Monthly Payment',
        item.due_date ? new Date(item.due_date).toLocaleDateString('en-PH') : 'Not Set',
        money(getBillingBaseAmount(item)),
        money(item.paid_amount || 0),
        money(getBillingBaseRemaining(item)),
        item.status || 'Unpaid'
    ]);

    pdf.autoTable({
        startY: pdf.lastAutoTable.finalY + 5,
        head: [['Payment Type', 'Due Date', 'Amount', 'Paid', 'Balance', 'Status']],
        body: scheduleRows,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [232, 93, 136] }
    });

    const feeRows = [];
    registrationBilling.forEach(item => feeRows.push([item.billing_type || 'Registration Fee', money(item.amount || item.total_amount)]));
    if (itemizedMiscProducts.length) {
        itemizedMiscProducts.forEach(item => feeRows.push([item.label, money(item.amount)]));
    } else {
        miscBilling.forEach(item => feeRows.push(['Program Item Fees', money(item.amount || item.total_amount)]));
    }
    if (servicesTotal > 0) feeRows.push([data.services ? `Services (${data.services})` : 'Services', money(servicesTotal)]);

    if (feeRows.length) {
        pdf.autoTable({
            startY: pdf.lastAutoTable.finalY + 5,
            head: [['Other Fees', 'Amount']],
            body: feeRows,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [232, 93, 136] },
            columnStyles: { 1: { halign: 'right' } }
        });
    }

    let historyTitleY = pdf.lastAutoTable.finalY + 10;
    if (historyTitleY > 270) {
        pdf.addPage();
        historyTitleY = 16;
    }
    pdf.setFontSize(12);
    pdf.text('Payment History', 14, historyTitleY);
    const paymentRows = paymentsHistory.length
        ? paymentsHistory.map(payment => {
            const amount = Number(payment.amount_paid || 0);
            const penalty = Number(payment.penalty_paid || 0);
            const base = Number(payment.base_amount_paid ?? Math.max(amount - penalty, 0));
            const amountDisplay = penalty > 0
                ? `${money(amount)}\nBase: ${money(base)} + Penalty: ${money(penalty)}`
                : money(amount);
            return [
                payment.payment_date || 'N/A',
                payment.payment_type || payment.billing_type || 'N/A',
                amountDisplay,
                payment.payment_method || 'N/A',
                payment.reference_no || 'N/A',
                payment.payment_status || 'N/A'
            ];
        })
        : [['No payment history found.', '', '', '', '', '']];
    pdf.autoTable({
        startY: historyTitleY + 3,
        head: [['Date', 'Paid For', 'Amount', 'Payment Method', 'Reference No.', 'Status']],
        body: paymentRows,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [232, 93, 136] }
    });

    const summaryRows = [
        ['Total Tuition', money(totalTuition)],
        ['Other Fees', money(otherFeeTotal)],
        ['Grand Total', money(grandTotal)]
    ];
    const recordedTotalPaid = Number(data.total_paid);
    const effectiveTotalPaid = Number.isFinite(recordedTotalPaid) ? recordedTotalPaid : totalPaymentsMade;
    if (discountAmount > 0) summaryRows.push([discountName || 'Discount', `-${money(discountAmount)}`]);
    if (totalPenalty > 0) summaryRows.push(['Penalty', money(totalPenalty)]);
    summaryRows.push(['Total Paid', money(effectiveTotalPaid)], ['Outstanding Balance', money(balance)]);

    pdf.autoTable({
        startY: pdf.lastAutoTable.finalY + 5,
        theme: 'grid',
        body: summaryRows,
        styles: { fontSize: 9 },
        columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' } }
    });

    pdf.save(`${createPrePlayBillingExportFilename(data.student_name, enrollmentId)}.pdf`);
}

window.exportPrePlayBillingStatement = async function(enrollmentId) {
    if (!canUsePaymentPermission('export')) {
        Swal.fire('Access Restricted', 'You do not have permission to export payment data.', 'warning');
        return;
    }

    const format = await chooseBillingStatementExportFormat();
    if (!format) return;

    Swal.fire({
        title: 'Preparing billing statement...',
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const [billingRes, paymentsRes, enrollmentRes] = await Promise.all([
            axios.get(`../../api/admin/billing.php?operation=getBillingDetails&enrollment_id=${enrollmentId}`),
            axios.get(`../../api/admin/payment.php?operation=getPaymentHistory&enrollment_details_id=${enrollmentId}`).catch(() => ({ data: { history: [] } })),
            axios.get(`../../api/admin/enrollment.php?operation=getEnrollmentDetails&id=${enrollmentId}`).catch(() => ({ data: { data: { details: {} } } }))
        ]);
        if (billingRes.data?.status !== 'success') {
            throw new Error(billingRes.data?.message || 'Could not fetch billing details.');
        }

        const data = billingRes.data.data;
        const enrollmentDetails = enrollmentRes.data?.data?.details || {};
        const paymentsHistory = paymentsRes.data?.history || [];
        const totalPaymentsMade = paymentsHistory.reduce((sum, payment) => sum + Number(payment.amount_paid || 0), 0);
        let programId = data.program_id || data.programId || data.PROGRAM_ID;

        if (!programId && data.program_name) {
            const programsRes = await axios.get('../../api/admin/program.php?operation=getPrograms');
            const programs = programsRes.data?.status === 'success' ? programsRes.data.data || [] : [];
            programId = programs.find(program => String(program.name || '').trim().toLowerCase() === String(data.program_name).trim().toLowerCase())?.program_id;
        }

        let miscProducts = [];
        if (programId) {
            try {
                const productsRes = await axios.get(`../../api/admin/program_products.php?operation=getProductsByProgram&program_id=${programId}`);
                miscProducts = productsRes.data?.status === 'success' ? productsRes.data.data || [] : [];
            } catch (error) {
                console.warn('Could not load optional program products for the billing PDF:', error);
            }
        }

        const allBillingItems = data.schedule || [];
        const monthlyBilling = allBillingItems
            .filter(item => String(item.billing_type || '').toLowerCase().includes('month'))
            .sort((a, b) => (parseInt(a.billing_type.replace(/\D/g, '')) || 0) - (parseInt(b.billing_type.replace(/\D/g, '')) || 0));
        const miscBilling = allBillingItems.filter(item => String(item.billing_type || '').toLowerCase() === 'miscellaneous');
        const registrationBilling = allBillingItems.filter(item => String(item.billing_type || '').toLowerCase() === 'registration fee');
        const getAmount = item => Number(item?.amount || item?.total_amount || 0);
        const getPaid = item => Number(item?.paid_amount || 0);
        const getRemaining = item => item?.remaining_amount != null
            ? Math.max(0, Number(item.remaining_amount || 0))
            : ((item?.status || '').toLowerCase() === 'paid' ? 0 : Math.max(0, getAmount(item) - getPaid(item)));
        const getBaseAmount = item => Number(item?.original_amount || 0) > 0
            ? Number(item.original_amount)
            : Math.max(0, getAmount(item) - Number(item?.penalty_amount || 0));
        const getBaseRemaining = item => Math.max(0, getBaseAmount(item) - Math.max(0, getPaid(item) - Number(item?.penalty_paid || 0)));
        const miscTotalFromSchedule = miscBilling.reduce((sum, item) => sum + getAmount(item), 0);
        const miscProductsTotal = miscProducts.reduce((sum, item) => sum + Number(item.price || 0), 0);
        const miscScale = miscTotalFromSchedule > 0 && miscProductsTotal > 0 ? miscTotalFromSchedule / miscProductsTotal : 1;
        const itemizedMiscProducts = miscProducts.map(item => ({
            label: item.product_name || item.name || 'Program Item',
            amount: Number(item.price || 0) * miscScale
        })).filter(item => item.amount > 0);
        const grandTotal = Number(data.total_amount || 0) || allBillingItems.reduce((sum, item) => sum + getAmount(item), 0);
        const totalPenalty = Number(data.total_penalty || 0) || allBillingItems.reduce((sum, item) => sum + Number(item.penalty_amount || 0), 0);
        const discountAmount = Number(data.discount_amount || 0);
        const programTuition = Number(data.program_tuition || 0);
        const totalTuition = programTuition > 0
            ? programTuition * monthlyBilling.length
            : monthlyBilling.reduce((sum, item) => sum + getAmount(item), 0);
        const registrationFeeTotal = registrationBilling.reduce((sum, item) => sum + getAmount(item), 0) || Number(data.registration_fee || 0);
        const otherFeeTotal = Math.max(0, (miscTotalFromSchedule || miscProductsTotal) + registrationFeeTotal);
        const servicesTotal = Math.max(0, grandTotal + discountAmount - totalTuition - otherFeeTotal - totalPenalty);
        const balance = Number(data.balance || 0) || allBillingItems
            .filter(item => ['unpaid', 'partial'].includes(String(item.status || '').toLowerCase()))
            .reduce((sum, item) => sum + getRemaining(item), 0);

        if (format === 'pdf') {
            downloadPrePlayBillingStatementPdf({
                data,
                enrollmentId,
                enrollmentDetails,
                monthlyBilling,
                getBillingBaseAmount: getBaseAmount,
                getBillingBaseRemaining: getBaseRemaining,
                itemizedMiscProducts,
                miscBilling,
                registrationBilling,
                totalTuition,
                otherFeeTotal,
                servicesTotal,
                grandTotal,
                discountAmount,
                discountName: data.discount_name || 'Discount',
                totalPenalty,
                totalPaymentsMade,
                balance,
                paymentsHistory
            });
        } else {
            const feeRows = registrationBilling.map(item => [item.billing_type || 'Registration Fee', getAmount(item)]);
            if (itemizedMiscProducts.length) {
                itemizedMiscProducts.forEach(item => feeRows.push([item.label, item.amount]));
            } else {
                miscBilling.forEach(item => feeRows.push(['Program Item Fees', getAmount(item)]));
            }
            if (servicesTotal > 0) feeRows.push([data.services ? `Services (${data.services})` : 'Services', servicesTotal]);
            const recordedTotalPaid = Number(data.total_paid);
            const effectiveTotalPaid = Number.isFinite(recordedTotalPaid) ? recordedTotalPaid : totalPaymentsMade;
            const className = enrollmentDetails.class_id_from_section || enrollmentDetails.class_id;
            const summaryRows = [
                ['Total Tuition', totalTuition],
                ['Other Fees', otherFeeTotal],
                ['Grand Total', grandTotal]
            ];
            if (discountAmount > 0) summaryRows.push([data.discount_name || 'Discount', -discountAmount]);
            if (totalPenalty > 0) summaryRows.push(['Penalty', totalPenalty]);
            summaryRows.push(['Total Paid', effectiveTotalPaid], ['Outstanding Balance', balance]);

            exportBillingStatementData({
                format,
                filename: createPrePlayBillingExportFilename(data.student_name, enrollmentId),
                title: 'Preschool / Playschool Billing Statement',
                sections: [
                    {
                        name: 'Student Details',
                        rows: [
                            ['Student', data.student_name || 'N/A'],
                            ['Program', data.program_name || 'N/A'],
                            ['Class', className ? `Class ${className}` : 'N/A'],
                            ['Section', enrollmentDetails.section_name || 'N/A'],
                            ['Section Teacher', enrollmentDetails.section_teacher_name || enrollmentDetails.teacher_name || 'Not assigned']
                        ]
                    },
                    {
                        name: 'Billing Schedule',
                        headers: ['Payment Type', 'Due Date', 'Amount', 'Paid', 'Balance', 'Status'],
                        rows: monthlyBilling.map(item => [
                            item.billing_type || 'Monthly Payment',
                            item.due_date || 'Not Set',
                            getBaseAmount(item),
                            getPaid(item),
                            getBaseRemaining(item),
                            item.status || 'Unpaid'
                        ])
                    },
                    { name: 'Other Fees', headers: ['Fee', 'Amount'], rows: feeRows.length ? feeRows : [['No other fees.', 0]] },
                    {
                        name: 'Payment History',
                        headers: ['Date', 'Paid For', 'Amount', 'Base Amount', 'Penalty', 'Payment Method', 'Reference No.', 'Status'],
                        rows: paymentsHistory.length ? paymentsHistory.map(payment => {
                            const amount = Number(payment.amount_paid || 0);
                            const penalty = Number(payment.penalty_paid || 0);
                            return [
                                payment.payment_date || 'N/A',
                                payment.payment_type || payment.billing_type || 'N/A',
                                amount,
                                Number(payment.base_amount_paid ?? Math.max(amount - penalty, 0)),
                                penalty,
                                payment.payment_method || 'N/A',
                                payment.reference_no || 'N/A',
                                payment.payment_status || 'N/A'
                            ];
                        }) : [['No payment history found.']]
                    },
                    { name: 'Summary', rows: summaryRows }
                ]
            });
        }
        Swal.close();
    } catch (error) {
        console.error('Pre and Play School billing PDF export failed:', error);
        Swal.fire('Download failed', error.message || 'Unable to download the billing statement.', 'error');
    }
};

function renderBillingPlayPreModal(data, paymentMethods, enrollmentId, miscProducts = [], totalPaymentsMade = 0, showPayment = true, enrollmentStatus = 'unknown', paymentsHistory = [], enrollmentDetails = {}) {
    ensureAdminPrePlayBillingStyles();
    const isIncompleteEnrollment = String(enrollmentStatus || '').toLowerCase() === 'incomplete';
    // 1. DATA CALCULATIONS (FIFO LOGIC)
    const allBillingItems = data.schedule ? data.schedule : [];
    
    const monthlyBilling = allBillingItems.filter(s => s.billing_type && s.billing_type.toLowerCase().includes('month'))
        .sort((a, b) => {
            const aNum = parseInt(a.billing_type.replace(/\D/g, '')) || 0;
            const bNum = parseInt(b.billing_type.replace(/\D/g, '')) || 0;
            return aNum - bNum;
        });

    const miscBilling = allBillingItems.filter(s => s.billing_type && s.billing_type.toLowerCase() === 'miscellaneous');
    const registrationBilling = allBillingItems.filter(s => s.billing_type && s.billing_type.toLowerCase() === 'registration fee');
    const formatCurrency = amount => parseFloat(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const miscTotalFromSchedule = miscBilling.reduce((sum, item) => sum + parseFloat(item.amount || item.total_amount || 0), 0);
    const registrationTotal = registrationBilling.reduce((sum, item) => sum + parseFloat(item.amount || item.total_amount || 0), 0);
    const miscTotalFromCurrentProducts = miscProducts.reduce((sum, p) => sum + parseFloat(p.price || 0), 0);
    const miscTotalFromProducts = miscTotalFromSchedule || miscTotalFromCurrentProducts;
    const miscScale = miscTotalFromSchedule > 0 && miscTotalFromCurrentProducts > 0
        ? miscTotalFromSchedule / miscTotalFromCurrentProducts
        : 1;
    const itemizedMiscProducts = miscProducts.map(p => ({
        label: p.product_name || p.name || 'Program Item',
        amount: parseFloat(p.price || 0) * miscScale
    })).filter(item => item.amount > 0);
    const monthlyTotal = monthlyBilling.reduce((sum, m) => sum + parseFloat(m.amount || 0), 0);
    const grandTotal = parseFloat(data.total_amount || 0) || allBillingItems.reduce((sum, item) => sum + parseFloat(item.amount || item.total_amount || 0), 0);
    const totalPenalty = parseFloat(data.total_penalty || 0) || allBillingItems.reduce((sum, item) => sum + parseFloat(item.penalty_amount || 0), 0);
    const discountAmount = parseFloat(data.discount_amount || 0);
    const discountName = data.discount_name || 'Discount';
    const discountType = (data.discount_type || '').toLowerCase();
    const discountValue = parseFloat(data.discount_value || 0);
    const discountDisplay = discountType === 'percentage'
        ? `${formatCurrency(discountValue).replace(/\.00$/, '')}%`
        : `₱${formatCurrency(discountValue || discountAmount)}`;
    const programTuition = parseFloat(data.program_tuition || 0);
    const totalTuition = programTuition > 0
        ? programTuition * monthlyBilling.length
        : monthlyTotal;
    const registrationFeeTotal = registrationTotal || parseFloat(data.registration_fee || 0);
    const otherFeeTotal = Math.max(0, miscTotalFromProducts + registrationFeeTotal);
    const servicesTotal = Math.max(0, grandTotal + discountAmount - totalTuition - otherFeeTotal - totalPenalty);

    const getBillingAmount = item => parseFloat(item?.amount || item?.total_amount || 0);
    const getBillingPaid = item => parseFloat(item?.paid_amount || 0);
    const getBillingRemaining = item => {
        if (!item) return 0;
        if (item.remaining_amount !== undefined && item.remaining_amount !== null) {
            return Math.max(0, parseFloat(item.remaining_amount || 0));
        }
        const status = (item.status || '').toLowerCase();
        if (status === 'paid') return 0;
        return Math.max(0, getBillingAmount(item) - getBillingPaid(item));
    };
    // The month timeline shows the original bill only. Penalties remain in
    // the payment amount shown by Summary → Total Due Now.
    const getBillingBaseAmount = item => {
        const originalAmount = Number(item?.original_amount);
        if (Number.isFinite(originalAmount) && originalAmount > 0) {
            return originalAmount;
        }
        return Math.max(0, getBillingAmount(item) - Number(item?.penalty_amount || 0));
    };
    const getBillingBasePaid = item => Math.max(0,
        getBillingPaid(item) - Number(item?.penalty_paid || 0)
    );
    const getBillingBaseRemaining = item => Math.max(0,
        getBillingBaseAmount(item) - getBillingBasePaid(item)
    );

    const dueScheduleItems = allBillingItems.filter(item => {
        const status = (item.status || '').toLowerCase();
        return status === 'unpaid' || status === 'partial';
    });
    const monthOneBill = monthlyBilling[0] || null;
    const monthOneRemaining = getBillingRemaining(monthOneBill);
    const firstMonthlyDue = monthlyBilling.find(item => getBillingRemaining(item) > 0);
    const miscRemaining = miscBilling.reduce((sum, item) => sum + getBillingRemaining(item), 0);
    const hasMonthlyService = Boolean(data.services);
    const baseMonthlyAmount = monthlyBilling[1] ? getBillingBaseAmount(monthlyBilling[1]) : getBillingBaseAmount(monthOneBill);
    const monthOneHasIncludedFees = monthOneBill && getBillingBaseAmount(monthOneBill) > baseMonthlyAmount + 0.01;
    const shouldBundleMonthOneFees = monthOneBill && miscRemaining > 0;
    const firstDueBill = shouldBundleMonthOneFees ? monthOneBill : (firstMonthlyDue || dueScheduleItems[0]);
    const isFirstMonthDue = shouldBundleMonthOneFees || (firstMonthlyDue && monthOneBill && String(firstMonthlyDue.billing_type) === String(monthOneBill.billing_type));
    const firstDueLabelParts = [];
    if (firstDueBill) {
        firstDueLabelParts.push(firstDueBill.billing_type);
        if (hasMonthlyService) firstDueLabelParts.push(data.services);
        if (isFirstMonthDue && (miscRemaining > 0 || monthOneHasIncludedFees)) firstDueLabelParts.push('Other Fees');
    }
    const firstDueLabel = firstDueLabelParts.join(' + ');
    const firstDueItem = firstDueBill ? {
        type: firstDueLabel,
        receiptType: firstDueLabel,
        dueDate: firstDueBill.due_date,
        remaining: getBillingRemaining(firstDueBill) + (isFirstMonthDue ? miscRemaining : 0)
    } : null;
    const initialPaymentAmount = firstDueItem ? firstDueItem.remaining : 0;
    const balance = parseFloat(data.balance || 0) || dueScheduleItems.reduce((sum, item) => sum + parseFloat(item.amount || item.total_amount || 0), 0);
    const isFullyPaid = balance <= 0;
    const receiptService = firstDueItem
        ? `${firstDueItem.receiptType || firstDueItem.type}${firstDueItem.dueDate ? ` - ${formatReceiptDueDate(firstDueItem.dueDate)}` : ''}`
        : 'Tuition Fee';

    // 2. UI COMPONENTS
    const paymentOptions = paymentMethods.map(pm =>
        `<option value="${pm.payment_method_id}">${pm.payment_method}</option>`
    ).join('');

    const totalMonths = monthlyBilling.length;
    const tuitionBalance = monthlyBilling.reduce((sum, item) => sum + getBillingRemaining(item), 0);
    const getStatusMeta = status => {
        const normalized = (status || '').toString().trim().toLowerCase();
        if (normalized === 'paid') return { label: 'Paid', badgeClass: 'bg-success', timelineState: 'paid' };
        if (normalized === 'partial') return { label: 'Partial', badgeClass: 'bg-warning text-dark', timelineState: 'partial' };
        if (normalized === 'unpaid') return { label: 'Unpaid', badgeClass: 'bg-secondary', timelineState: 'unpaid' };
        return { label: status || 'Pending', badgeClass: 'bg-secondary', timelineState: 'unpaid' };
    };

    const scheduleRows = monthlyBilling.map((m, index) => {
        const { label, badgeClass, timelineState } = getStatusMeta(m.status);
        const dueDate = m.due_date ? new Date(m.due_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Not Set';
        const amount = getBillingBaseAmount(m);
        const remaining = getBillingBaseRemaining(m);
        const amountLabel = index === 0 ? 'Total' : (hasMonthlyService ? 'Tuition + Service' : 'Tuition');
        return `
            <div class="payment-timeline-step">
                <div class="payment-timeline-indicator">
                    <div class="payment-timeline-marker is-${timelineState}">
                        ${index + 1}
                    </div>
                    ${index < monthlyBilling.length - 1 ? `<div class="payment-timeline-connector is-${timelineState}"></div>` : ''}
                </div>
                <div class="admin-preplay-timeline-content">
                    <div class="admin-preplay-timeline-main">
                        <div class="admin-preplay-timeline-title">${m.billing_type}</div>
                        <div class="small text-muted">${dueDate}</div>
                    </div>
                    <div class="admin-preplay-timeline-metrics">
                        <div class="admin-preplay-timeline-metric">
                            <div class="admin-preplay-timeline-metric-label">${amountLabel}</div>
                            <div class="admin-preplay-timeline-metric-value text-success">&#8369;${formatCurrency(amount)}</div>
                        </div>
                        <div class="admin-preplay-timeline-metric">
                            <div class="admin-preplay-timeline-metric-label">Balance</div>
                            <div class="admin-preplay-timeline-metric-value ${remaining > 0 ? 'text-danger' : 'text-success'}">&#8369;${formatCurrency(remaining)}</div>
                        </div>
                    </div>
                    <div class="admin-preplay-timeline-status">
                        <span class="badge ${badgeClass} text-uppercase">${label}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    const miscRows = itemizedMiscProducts.length > 0 ? itemizedMiscProducts.map(item => `
        <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
            <div class="text-muted">${item.label}</div>
            <div class="fw-bold text-danger">₱${formatCurrency(item.amount)}</div>
        </div>
    `).join('') : miscBilling.map(item => `
        <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
            <div class="text-muted">Program Item Fees</div>
            <div class="fw-bold text-danger">₱${formatCurrency(item.amount || item.total_amount)}</div>
        </div>
    `).join('');

    const registrationRows = registrationBilling.map(item => `
        <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
            <div class="text-muted">${item.billing_type}</div>
            <div class="fw-bold text-danger">₱${formatCurrency(item.amount || item.total_amount)}</div>
        </div>
    `).join('');

    const paymentSection = isIncompleteEnrollment ? `
        <div class="alert alert-warning text-center mx-3">
            <i class="bi bi-exclamation-triangle"></i> This enrollment is incomplete. Please complete the enrollment first.
        </div>
    ` : (showPayment && !isFullyPaid) ? `
        <section class="admin-preplay-payment-card" aria-labelledby="adminPrePlayPaymentTitle">
            <h3 class="admin-preplay-payment-title" id="adminPrePlayPaymentTitle">
                <span class="admin-preplay-payment-title-icon"><i class="bi bi-credit-card" aria-hidden="true"></i></span>
                Make Payment
            </h3>
            <p class="admin-preplay-payment-copy">Record the student's payment and select the payment method used.</p>
            <div class="admin-preplay-payment-grid">
                <div class="admin-preplay-payment-field">
                    <label class="form-label" for="modalPaymentAmount">Payment Amount <span class="text-danger" aria-hidden="true">*</span></label>
                    <div class="input-group">
                        <span class="input-group-text">&#8369;</span>
                        <input type="number" class="form-control" id="modalPaymentAmount" value="${initialPaymentAmount.toFixed(2)}" max="${balance}" step="0.01" data-max-balance="${balance}">
                    </div>
                    <small class="admin-preplay-payment-help"><em>Maximum: &#8369;${formatCurrency(balance)}</em></small>
                </div>
                <div class="admin-preplay-payment-field">
                    <label class="form-label" for="modalPaymentMethod">Payment Method <span class="text-danger" aria-hidden="true">*</span></label>
                    <select class="form-select" id="modalPaymentMethod">
                        <option value="">Select method</option>
                        ${paymentOptions}
                    </select>
                </div>
                <div class="admin-preplay-payment-field full" id="referenceContainer" style="display:none;">
                    <label class="form-label" for="modalReferenceNo">Reference No. (GCash) <span class="text-danger" aria-hidden="true">*</span></label>
                    <input type="text" class="form-control" id="modalReferenceNo" placeholder="Enter reference number">
                    <small class="admin-preplay-payment-help"><em>Required when GCash is selected.</em></small>
                </div>
            </div>
        </section>
    ` : (isFullyPaid ? `<div class="alert alert-success text-center mx-3">Account Fully Paid</div>` : 
        `<div class="alert alert-info text-center mx-3">No payment due at this time</div>`  );

    const html = `
        <div class="billing-container text-start" style="font-family: 'Segoe UI', sans-serif; color: #334155;">
            <div class="card border-0 shadow-sm mb-4" style="border-radius: 18px; background: rgba(255, 236, 240, 0.8);">
                <div class="card-body p-4">
                    <div class="row gx-3 gy-3">
                        <div class="col-md-6">
                            <div class="small text-muted">Name</div>
                            <div class="fw-bold">${data.student_name}</div>
                        </div>
                        <div class="col-md-6">
                            <div class="small text-muted">Program</div>
                            <div class="fw-bold">${data.program_name}</div>
                        </div>
                        <div class="col-md-4">
                            <div class="small text-muted">Class</div>
                            <div class="fw-bold">${(enrollmentDetails.class_id_from_section || enrollmentDetails.class_id) ? 'Class ' + (enrollmentDetails.class_id_from_section || enrollmentDetails.class_id) : 'N/A'}</div>
                        </div>
                        <div class="col-md-4">
                            <div class="small text-muted">Section</div>
                            <div class="fw-bold">${enrollmentDetails.section_name && enrollmentDetails.section_name !== 'N/A' ? enrollmentDetails.section_name : 'N/A'}</div>
                        </div>
                        <div class="col-md-4">
                            <div class="small text-muted">Section Teacher</div>
                            <div class="fw-bold">${(enrollmentDetails.section_teacher_name || enrollmentDetails.teacher_name) ? (enrollmentDetails.section_teacher_name || enrollmentDetails.teacher_name) : 'Not assigned'}</div>
                        </div>
                    </div>
                </div>
            </div>


            <div class="row g-3 mb-4">
                <div class="col-lg-12">
                    <div class="card border-0 shadow-sm h-100">
                        <div class="card-body p-4">
                            <div class="d-flex align-items-center justify-content-between mb-4">
                                <div>
                                    <div class="small text-muted text-uppercase">Billing Schedule</div>
                                    <div class="h6 fw-bold mb-0">Payment Timeline</div>
                                </div>
                                <span class="badge bg-secondary bg-opacity-10 text-secondary py-2 px-3 rounded-pill">Tuition</span>
                            </div>
                            ${scheduleRows}
                        </div>
                    </div>
                </div>
            </div>

            <div class="row g-3">
                <div class="col-lg-7">
                    <div class="card border-0 shadow-sm h-100">
                        <div class="card-body p-4">
                            <div class="d-flex align-items-center mb-3">
                                <span class="rounded-circle bg-danger bg-opacity-10 text-danger me-2 p-2">
                                    <i class="bi bi-bag-check"></i>
                                </span>
                                <div>
                                <div class="small text-muted text-uppercase">Other Fees</div>
                                </div>
                            </div>
                            ${registrationRows}${(miscBilling.length > 0 || miscProducts.length > 0) ? miscRows : `<div class="text-muted small">No other fees.</div>`}
                            <div class="d-flex justify-content-between align-items-center border-top pt-3 mt-3">
                                <div class="fw-bold">Total</div>
                                <div class="fw-bold text-danger">₱${formatCurrency(miscTotalFromProducts + registrationFeeTotal)}</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-lg-5">
                    <div class="card border-0 shadow-sm h-100">
                        <div class="card-body p-4">
                            <div class="fw-bold text-uppercase text-muted mb-3">Summary</div>
                            <div class="d-flex justify-content-between align-items-center mb-3">
                                <div class="text-muted">Total Tuition</div>
                                <div class="fw-bold">₱${formatCurrency(totalTuition)}</div>
                            </div>
                            <div class="d-flex justify-content-between align-items-center mb-3">
                                <div class="text-muted">Other Fee (Total)</div>
                                <div class="fw-bold">₱${formatCurrency(otherFeeTotal)}</div>
                            </div>
                            ${servicesTotal > 0 ? `
                            <div class="d-flex justify-content-between align-items-center mb-3">
                                <div class="text-muted">Services${data.services ? ` (${data.services})` : ''}</div>
                                <div class="fw-bold">₱${formatCurrency(servicesTotal)}</div>
                            </div>
                            ` : ''}
                            <div class="d-flex justify-content-between align-items-center mb-3">
                                <div class="text-muted">Grand Total</div>
                                <div class="fw-bold">₱${formatCurrency(grandTotal)}</div>
                            </div>
                            ${discountAmount > 0 ? `
                            <div class="d-flex justify-content-between align-items-center mb-3">
                                <div class="text-muted">Discount (${discountName})</div>
                                <div class="fw-bold text-success">${discountDisplay}</div>
                            </div>
                            ` : ''}
                            ${totalPenalty > 0 ? `
                            <div class="d-flex justify-content-between align-items-center mb-3">
                                <div class="text-muted">Penalty</div>
                                <div class="fw-bold text-danger">${formatCurrency(totalPenalty)}</div>
                            </div>
                            ` : ''}
                            <div class="d-flex justify-content-between align-items-center mb-3">
                                <div class="text-muted">Total Due Now</div>
                                <div class="fw-bold text-info">₱${formatCurrency(initialPaymentAmount)}</div>
                            </div>
                            <div class="d-flex justify-content-between align-items-center">
                                <div class="text-muted">Outstanding Balance</div>
                                <div class="fw-bold text-danger">₱${formatCurrency(balance)}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="text-center mt-4">
                <div class="text-muted small"><i class="bi bi-eye"></i> Billing statement y.</div>
            </div>

            ${paymentSection}
        </div>`;

    // SweetAlert initialization remains the same...
    Swal.fire({
        title: '<span class="fw-bold text-secondary">Preschool / Playschool Billing</span>',
        html: html,
        width: '1000px',
        showCloseButton: true,
        showCancelButton: showPayment && !isFullyPaid && !isIncompleteEnrollment,
        confirmButtonText: isIncompleteEnrollment
            ? 'pls complete the enrollment'
            : ((showPayment && !isFullyPaid) ? 'Confirm Payment' : 'Close'),
        confirmButtonColor: '#e85d88',
        cancelButtonText: '<i class="bi bi-x-circle" aria-hidden="true"></i> Cancel',
        cancelButtonColor: '#6c757d',
        reverseButtons: true,
        customClass: {
            container: 'admin-preplay-modal-container',
            popup: 'admin-preplay-popup'
        },
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
            if (isIncompleteEnrollment || !showPayment || isFullyPaid) return true;
            const amount = parseFloat(document.getElementById('modalPaymentAmount').value);
            const method = document.getElementById('modalPaymentMethod').value;
            const methodSelect = document.getElementById('modalPaymentMethod');
            const selectedOption = methodSelect.options[methodSelect.selectedIndex];
            const methodName = selectedOption.text.toLowerCase();
            const ref = document.getElementById('modalReferenceNo')?.value.trim() || null;
            if (!amount || amount <= 0) { Swal.showValidationMessage('Enter valid amount'); return false; }
            if (!method) { Swal.showValidationMessage('Select method'); return false; }
            if (methodName.includes('gcash') && !ref) {
                Swal.showValidationMessage('Please enter a reference number for GCash payment');
                return false;
            }
            return {
                amount,
                method,
                methodName: selectedOption.text,
                ref
            };
        }
    }).then((result) => {
        if (!result.isConfirmed) {
            return;
        }

        if (isIncompleteEnrollment) {
            if (typeof window.openPendingEnrollmentCompletion === 'function') {
                window.openPendingEnrollmentCompletion(enrollmentId, 'preschool');
            } else {
                Swal.fire('Incomplete Enrollment', 'Please complete the enrollment first.', 'info');
            }
            return;
        }

        if (showPayment && !isFullyPaid) {

            const paymentPayload = {
                enrollment_id: enrollmentId,
                amount: result.value.amount,
                method: result.value.method,
                ref: result.value.ref,
                payment_type: firstDueItem?.type || 'Tuition Fee'
            };

            axios.post('../../api/admin/payment.php', {
                operation: 'processPayment',
                json: JSON.stringify(paymentPayload)
            }).then((res) => {
                if (res.data.status === 'success') {
                    const paidAmount = parseFloat(result.value.amount || 0);
                    const newBalance = Math.max(balance - paidAmount, 0);
                    const paymentKind = firstDueItem && paidAmount >= firstDueItem.remaining
                        ? 'Full Payment'
                        : 'Partial Payment';
                    const receiptData = {
                        enrollmentId,
                        studentName: data.student_name,
                        programName: data.program_name,
                        service: paymentKind,
                        paymentType: paymentKind,
                        paymentKind,
                        paymentFor: receiptService,
                        paymentMethod: result.value.methodName,
                        referenceNo: result.value.ref || null,
                        receiptNo: res.data.receipt_id || null,
                        amountPaid: paidAmount,
                        balance: newBalance,
                        totalAmount: paidAmount,
                        lineItems: Array.isArray(res.data.line_items) ? res.data.line_items : [],
                        paymentDate: new Date()
                    };

                    Swal.fire('Success', 'Payment recorded successfully.', 'success')
                        .then(() => showPaymentReceipt(receiptData))
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
    if (!guardPaymentPermission('approve', 'You do not have permission to approve pending payment-related enrollment actions.')) {
        return;
    }

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
