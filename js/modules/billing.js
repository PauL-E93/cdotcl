// js/modules/billing.js
import { showPaymentReceipt } from "./receipt.js";
import { canUsePaymentPermission, isPaymentModulePage } from "./payment_rbac.js";
import { chooseBillingStatementExportFormat, exportBillingStatementData } from "../utilities/billing_statement_export.js";

    /**
     * GLOBAL BILLING CONTROLLER
     */

    function isPreschoolProgram(programName) {
        if (!programName) return false;
        const lower = programName.toLowerCase();
        return lower.includes('preschool') || lower.includes('playschool') || lower.includes('pre-school') || lower.includes('play-school') || lower.includes('pre school') || lower.includes('play school');
    }

    function formatReceiptDueDate(dateValue) {
        if (!dateValue) return '';
        return new Date(dateValue).toLocaleDateString('en-PH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    function getReceiptBill(schedule = [], fallback = 'Tuition Fee') {
        const nextBill = schedule.find((item) => {
            const status = (item.status || '').toLowerCase();
            return status === 'unpaid' || status === 'partial';
        });

        if (!nextBill) {
            return {
                label: fallback,
                amount: 0
            };
        }

        const billType = nextBill.billing_type || fallback;
        const dueDate = formatReceiptDueDate(nextBill.due_date);
        return {
            label: dueDate ? `${billType} - ${dueDate}` : billType,
            amount: parseFloat(nextBill.amount || nextBill.total_amount || 0)
        };
    }

    function getReceiptLineItems(schedule = [], amount = 0) {
        let remainingPayment = Number(amount) || 0;
        const rows = [];

        schedule
            .filter(item => {
                const status = (item.status || '').toLowerCase();
                return status === 'unpaid' || status === 'partial';
            })
            .forEach(item => {
                if (remainingPayment <= 0) return;
                const billAmount = Number(item.remaining_amount ?? item.amount ?? item.total_amount ?? 0);
                const paidForItem = Math.min(remainingPayment, billAmount);
                if (paidForItem > 0) {
                    rows.push({
                        label: item.billing_type || 'Payment',
                        amount: paidForItem
                    });
                    remainingPayment -= paidForItem;
                }
            });

        return rows;
    }

    // Global function to open the modal
window.openBillingModal = function(enrollmentId, viewOnly = false) {
        const paymentPageContext = isPaymentModulePage();
        const effectiveViewOnly = viewOnly || (paymentPageContext && !canUsePaymentPermission('create'));

        // 1. Show loading state    
        Swal.fire({
            title: 'Loading Billing Details...',
            didOpen: () => Swal.showLoading()
        });

        // 2. Fetch Billing Details AND Payment Methods in parallel
        Promise.all([
            axios.get(`../../api/admin/billing.php?operation=getBillingDetails&enrollment_id=${enrollmentId}`),
            axios.get(`../../api/admin/billing.php?operation=getPaymentMethods`),
            axios.get(`../../api/admin/enrollment.php?operation=getEnrollmentDetails&id=${enrollmentId}`).catch(() => ({ data: { status: 'error', data: {} } }))
        ])
        .then(([billingRes, methodsRes, enrollmentRes]) => {
            console.log("Billing Response:", billingRes);
            console.log("Methods Response:", methodsRes);
            Swal.close();
            
            if (billingRes.data.status === 'success' && methodsRes.data.status === 'success') {
                // Fetch program details and products
                const programId = billingRes.data.data.program_id;
                Promise.all([
                    axios.get(`../../api/admin/program.php?operation=getProgram&json=${JSON.stringify({program_id: programId})}`),
                    axios.get(`../../api/admin/program_products.php?operation=getProgramProducts`),
                    axios.get(`../../api/admin/product.php?operation=getAllProducts`)
                ])
                .then(([programRes, productsRes, productsDetailRes]) => {
                    const programData = programRes.data.status === 'success' ? programRes.data.data : {};
                    const allProgramProducts = productsRes.data || [];
                    const programProducts = allProgramProducts.filter(pp => pp.program_id == programId);
                    const allProducts = productsDetailRes.data || [];
                    
                    // Add program tuition to billing data
                    billingRes.data.data.program_tuition = programData.tuition || 0;

                    const details = enrollmentRes.data?.data?.details || {};
                    billingRes.data.data.enrollment_status = details.header_status || details.status || billingRes.data.data.enrollment_status || '';
                    renderBillingModal(billingRes.data.data, methodsRes.data.data, enrollmentId, programProducts, allProducts, effectiveViewOnly);
                })
                .catch(err => {
                    console.error("Error fetching additional data:", err);
                    const details = enrollmentRes.data?.data?.details || {};
                    billingRes.data.data.enrollment_status = details.header_status || details.status || billingRes.data.data.enrollment_status || '';
                    renderBillingModal(billingRes.data.data, methodsRes.data.data, enrollmentId, [], [], effectiveViewOnly);
                });
            } else {
                Swal.fire("Error", "Could not fetch necessary data.", "error");
            }
        })
        .catch(err => {
            console.error(err);
            Swal.fire("Error", "Network error.", "error");
        });
    };

function ensureAdminBillingModalStyles() {
    if (document.getElementById('adminBillingModalStyles')) return;

    const styles = document.createElement('style');
    styles.id = 'adminBillingModalStyles';
    styles.textContent = `
        .admin-billing-modal-container{padding:6px}
        .admin-billing-popup{--ab-pink:#e85d88;--ab-pink-dark:#d94b78;--ab-soft:#fff4f7;--ab-border:#f4c4d3;--ab-ink:#1d2a3b;--ab-muted:#667085;width:min(1080px,calc(100vw - 24px))!important;max-width:1080px!important;padding:0!important;overflow:hidden;border:2px solid var(--ab-pink);border-radius:17px!important;background:#fff;box-shadow:0 24px 70px rgba(55,35,43,.18)!important}
        .admin-billing-popup .swal2-title{padding:36px 46px 24px;color:var(--ab-ink);text-align:left}
        .admin-billing-title{display:flex;align-items:center;gap:24px;font-size:clamp(1.65rem,4vw,2.2rem);font-weight:750}
        .admin-billing-title-icon{display:grid;flex:0 0 64px;width:64px;height:64px;place-items:center;border-radius:15px;color:var(--ab-pink);background:#fde7ee;font-size:1.65rem}
        .admin-billing-popup .swal2-close{top:22px;right:24px;width:42px;height:42px;color:var(--ab-pink);font-size:2.25rem;font-weight:300}
        .admin-billing-popup .swal2-close:hover{color:var(--ab-pink-dark);background:var(--ab-soft)}
        .admin-billing-popup .swal2-html-container{margin:0;padding:0 46px;overflow:visible;color:var(--ab-ink)}
        .admin-billing-container{display:grid;gap:22px;text-align:left}
        .admin-billing-card{padding:22px 24px;border:1px solid var(--ab-border);border-radius:14px;background:#fff;box-shadow:0 3px 9px rgba(90,44,59,.06)}
        .admin-billing-section-title{display:flex;align-items:center;gap:13px;margin:0 0 20px;color:var(--ab-pink);font-size:1.35rem;font-weight:750}
        .admin-billing-section-icon{display:grid;flex:0 0 38px;width:38px;height:38px;place-items:center;border-radius:10px;color:var(--ab-pink);background:#fdeaf0;font-size:1.1rem}
        .admin-student-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 48px;font-size:1rem}
        .admin-student-grid>div{min-width:0;overflow-wrap:anywhere}
        .admin-student-grid strong{color:#182336;font-weight:700}
        .admin-billing-table-wrap{overflow:hidden;border:1px solid var(--ab-border);border-radius:12px}
        .admin-billing-table{width:100%;margin:0;border-collapse:collapse;text-align:center;font-size:.9rem}
        .admin-billing-table th,.admin-billing-table td{padding:14px 9px;border-right:1px solid #f4d5df;border-bottom:1px solid #f4d5df;vertical-align:middle}
        .admin-billing-table tr>*:last-child{border-right:0}
        .admin-billing-table thead th{color:#243044;background:#fff6f8;font-weight:700;white-space:nowrap}
        .admin-billing-table .admin-row-amount{color:var(--ab-pink);font-weight:750}
        .admin-billing-table .admin-row-paid{color:#16a35c;font-weight:750}
        .admin-billing-table .admin-row-balance{color:#d94b78;font-weight:750}
        .admin-billing-table .admin-total-row td{padding:15px 26px;background:#fff8fa}
        .admin-billing-table .admin-total-label{color:#1e293b;text-align:left;font-weight:750}
        .admin-billing-table .admin-total-value{color:var(--ab-pink);text-align:right;font-size:1.65rem;font-weight:800}
        .admin-billing-status{display:inline-flex;align-items:center;justify-content:center;min-width:68px;padding:5px 9px;border:1px solid #f0a020;border-radius:8px;color:#e58900;background:#fffaf0;font-size:.78rem;font-weight:700;text-transform:lowercase}
        .admin-billing-status.paid{border-color:#76cf9a;color:#159452;background:#f0fbf5}
        .admin-billing-status.partial{border-color:#80b7ef;color:#2775c9;background:#f1f7ff}
        .admin-billing-status.item{border-color:#c7a6eb;color:#7b43b2;background:#f8f3ff}
        .admin-billing-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));padding:0;overflow:hidden}
        .admin-billing-summary-item{display:flex;align-items:center;justify-content:center;gap:22px;min-height:108px;padding:20px}
        .admin-billing-summary-item+.admin-billing-summary-item{border-left:1px solid #f1d9e1}
        .admin-billing-summary-icon{display:grid;flex:0 0 62px;width:62px;height:62px;place-items:center;border-radius:50%;color:var(--ab-pink);background:#fde9ef;font-size:1.5rem}
        .admin-billing-summary-item.paid .admin-billing-summary-icon{color:#16a35c;background:#eaf8f0}
        .admin-billing-summary-label{display:block;margin-bottom:3px;color:var(--ab-muted);font-size:.95rem}
        .admin-billing-summary-value{display:block;color:var(--ab-pink);font-size:1.8rem;font-weight:800;line-height:1.1}
        .admin-billing-summary-item.paid .admin-billing-summary-value{color:#16a35c}
        .admin-payment-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:18px 22px}
        .admin-payment-field{min-width:0}
        .admin-payment-field.full{grid-column:1/-1}
        .admin-payment-field label{margin-bottom:8px;color:var(--ab-ink);font-size:.94rem;font-weight:700}
        .admin-payment-field .form-control,.admin-payment-field .form-select,.admin-payment-field .input-group-text{min-height:52px;border-color:#d7dde6}
        .admin-payment-field .form-control:focus,.admin-payment-field .form-select:focus{border-color:#ef9bb5;box-shadow:0 0 0 .2rem rgba(232,93,136,.13)}
        .admin-payment-field .input-group-text{min-width:58px;justify-content:center;background:#f8f9fb;font-weight:700}
        .admin-payment-help{display:block;margin-top:7px;color:var(--ab-muted);font-size:.82rem}
        .admin-billing-popup .swal2-validation-message{margin:14px 46px 0;border-radius:9px}
        .admin-billing-popup .swal2-actions{display:flex;justify-content:space-between;gap:18px;width:100%;margin:0;padding:18px 46px 22px}
        .admin-billing-popup .admin-billing-confirm,.admin-billing-popup .admin-billing-cancel{min-height:50px;margin:0;padding:0 28px;border-radius:8px;font-weight:700}
        .admin-billing-popup .admin-billing-confirm{min-width:250px;margin-left:auto;border:1px solid var(--ab-pink);color:#fff;background:linear-gradient(135deg,var(--ab-pink),#df4e7c);box-shadow:0 8px 16px rgba(232,93,136,.18)}
        .admin-billing-popup .admin-billing-confirm:hover{color:#fff;background:linear-gradient(135deg,var(--ab-pink-dark),#c93f6b)}
        .admin-billing-popup .admin-billing-cancel{min-width:140px;margin-right:auto;border:1px solid #d7dde5;color:#475467;background:#fff}
        .admin-billing-popup .admin-billing-cancel:hover{background:#f8fafc}
        .admin-billing-popup .swal2-actions.admin-billing-single-action{justify-content:center}
        .admin-billing-popup .swal2-actions.admin-billing-single-action .admin-billing-confirm{margin:0}
        @media(max-width:767.98px){
            .admin-billing-popup{width:calc(100vw - 12px)!important;max-width:calc(100vw - 12px)!important;border-radius:13px!important}
            .admin-billing-popup .swal2-title{padding:24px 16px 18px}
            .admin-billing-title{gap:12px;padding-right:32px;font-size:clamp(1.3rem,6vw,1.6rem);line-height:1.12}
            .admin-billing-title-icon{flex-basis:48px;width:48px;height:48px;font-size:1.2rem}
            .admin-billing-popup .swal2-close{top:7px;right:7px}
            .admin-billing-popup .swal2-html-container{padding:0 12px;overflow:hidden}
            .admin-billing-container{gap:14px}
            .admin-billing-card{padding:18px 15px}
            .admin-billing-section-title{gap:10px;margin-bottom:16px;font-size:1.2rem}
            .admin-student-grid{grid-template-columns:1fr;gap:10px}
            .admin-billing-table-wrap{overflow:hidden}
            .admin-billing-table,.admin-billing-table tbody,.admin-billing-table tfoot,.admin-billing-table tr,.admin-billing-table td{display:block;width:100%}
            .admin-billing-table thead{display:none}
            .admin-billing-table tbody{display:grid;gap:12px;padding:12px;background:#fff}
            .admin-billing-table tbody tr{overflow:hidden;border:1px solid #f2cbd7;border-radius:10px;background:#fff}
            .admin-billing-table tbody td{display:grid;grid-template-columns:minmax(108px,42%) minmax(0,1fr);gap:12px;padding:10px 12px;border-right:0;border-bottom:1px solid #f5dce4;text-align:right;overflow-wrap:anywhere}
            .admin-billing-table tbody td:last-child{border-bottom:0}
            .admin-billing-table tbody td::before{content:attr(data-label);color:#344054;font-weight:700;text-align:left}
            .admin-billing-table tfoot{border-top:1px solid var(--ab-border);background:#fff8fa}
            .admin-billing-table .admin-total-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px}
            .admin-billing-table .admin-total-row td{width:auto;padding:0;border:0;background:transparent}
            .admin-billing-table .admin-total-label{flex:1 1 auto}
            .admin-billing-table .admin-total-value{flex:0 0 auto;font-size:1.35rem;white-space:nowrap}
            .admin-billing-summary{grid-template-columns:1fr}
            .admin-billing-summary-item{justify-content:flex-start;min-height:92px;padding:16px 20px}
            .admin-billing-summary-item+.admin-billing-summary-item{border-top:1px solid #f1d9e1;border-left:0}
            .admin-billing-summary-value{font-size:1.5rem}
            .admin-payment-grid{grid-template-columns:1fr;gap:15px}
            .admin-payment-field.full{grid-column:auto}
            .admin-billing-popup .swal2-validation-message{margin-inline:12px}
            .admin-billing-popup .swal2-actions{gap:10px;padding:15px 12px 18px}
        }
        @media(max-width:480px){
            .admin-billing-popup .swal2-actions{flex-direction:column}
            .admin-billing-popup .admin-billing-confirm,.admin-billing-popup .admin-billing-cancel{width:100%;min-width:0;margin:0}
        }
    `;
    document.head.appendChild(styles);
}

function createBillingExportFilename(studentName, enrollmentId) {
    const safeName = String(studentName || `enrollment-${enrollmentId}`)
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
    return `billing-statement-${safeName || enrollmentId}`;
}

function downloadTutorialBillingStatementPdf(data, enrollmentId, programProducts, allProducts, totalPaid, totalFee, hasPenalty, paymentHistory = []) {
    if (!window.jspdf?.jsPDF) throw new Error('PDF export library is unavailable.');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait' });
    const money = value => `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    pdf.setFontSize(17);
    pdf.text('Enrollment Billing Statement', 14, 16);
    pdf.setFontSize(9);
    pdf.setTextColor(90);
    pdf.text(`Generated: ${new Date().toLocaleString('en-PH')}`, 14, 22);
    pdf.setTextColor(0);

    pdf.autoTable({
        startY: 27,
        theme: 'plain',
        body: [
            ['Student', data.student_name || 'N/A', 'Program', data.program_name || 'N/A'],
            ['Subject', data.subject_name || 'N/A', 'Grade Level', data.grade_level || 'N/A'],
            ['Goal', data.goal || 'N/A', '', '']
        ],
        styles: { fontSize: 9, cellPadding: 2 },
        columnStyles: { 0: { fontStyle: 'bold' }, 2: { fontStyle: 'bold' } }
    });

    const headers = ['Payment Type', 'Original'];
    if (hasPenalty) headers.push('Penalty');
    headers.push('Amount', 'Paid', 'Balance', 'Due Date', 'Status');

    const scheduleRows = (data.schedule || []).map(item => {
        const amount = Number(item.amount || 0);
        const original = Number(item.original_amount || amount);
        const paid = Number(item.paid_amount || 0);
        const remaining = Number(item.remaining_amount ?? Math.max(amount - paid, 0));
        const row = [item.billing_type || 'Payment', money(original)];
        if (hasPenalty) row.push(money(item.penalty_amount || 0));
        row.push(
            money(amount),
            money(paid),
            money(remaining),
            item.due_date ? new Date(item.due_date).toLocaleDateString('en-PH') : 'Not Set',
            item.status || 'Unpaid'
        );
        return row;
    });

    programProducts.forEach(programProduct => {
        const product = allProducts.find(item => item.product_id == programProduct.product_id);
        if (!product) return;
        const row = [product.product_name || 'Program Item', money(product.price)];
        if (hasPenalty) row.push('-');
        row.push(money(product.price), '-', money(product.price), 'Not Set', 'Item');
        scheduleRows.push(row);
    });

    pdf.autoTable({
        startY: pdf.lastAutoTable.finalY + 5,
        head: [headers],
        body: scheduleRows,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [232, 93, 136] }
    });

    let historyTitleY = pdf.lastAutoTable.finalY + 10;
    if (historyTitleY > 270) {
        pdf.addPage();
        historyTitleY = 16;
    }
    pdf.setFontSize(12);
    pdf.text('Payment History', 14, historyTitleY);
    const paymentRows = paymentHistory.length
        ? paymentHistory.map(payment => {
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

    pdf.autoTable({
        startY: pdf.lastAutoTable.finalY + 5,
        theme: 'grid',
        body: [
            ['Total Amount', money(totalFee)],
            ['Total Paid', money(totalPaid)],
            ['Outstanding Balance', money(data.balance)]
        ],
        styles: { fontSize: 10 },
        columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' } }
    });

    pdf.save(`${createBillingExportFilename(data.student_name, enrollmentId)}.pdf`);
}

window.exportTutorialBillingStatement = async function(enrollmentId) {
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
        const [billingRes, productsRes, productDetailsRes, paymentsRes] = await Promise.all([
            axios.get(`../../api/admin/billing.php?operation=getBillingDetails&enrollment_id=${enrollmentId}`),
            axios.get('../../api/admin/program_products.php?operation=getProgramProducts').catch(() => ({ data: [] })),
            axios.get('../../api/admin/product.php?operation=getAllProducts').catch(() => ({ data: [] })),
            axios.get(`../../api/admin/payment.php?operation=getPaymentHistory&enrollment_details_id=${enrollmentId}`).catch(() => ({ data: { history: [] } }))
        ]);
        if (billingRes.data?.status !== 'success') {
            throw new Error(billingRes.data?.message || 'Could not fetch billing details.');
        }

        const data = billingRes.data.data;
        const programProducts = (Array.isArray(productsRes.data) ? productsRes.data : productsRes.data?.data || [])
            .filter(item => item.program_id == data.program_id);
        const allProducts = Array.isArray(productDetailsRes.data) ? productDetailsRes.data : productDetailsRes.data?.data || [];
        const totalFee = Number(data.total_amount || 0);
        const recordedTotalPaid = Number(data.total_paid);
        const totalPaid = Number.isFinite(recordedTotalPaid)
            ? recordedTotalPaid
            : Math.max(totalFee - Number(data.balance || 0), 0);
        const hasPenalty = (data.schedule || []).some(item => Number(item.penalty_amount || 0) > 0);
        const paymentHistory = paymentsRes.data?.history || [];

        if (format === 'pdf') {
            downloadTutorialBillingStatementPdf(data, enrollmentId, programProducts, allProducts, totalPaid, totalFee, hasPenalty, paymentHistory);
        } else {
            const billingHeaders = ['Payment Type', 'Original'];
            if (hasPenalty) billingHeaders.push('Penalty');
            billingHeaders.push('Amount', 'Paid', 'Balance', 'Due Date', 'Status');
            const billingRows = (data.schedule || []).map(item => {
                const amount = Number(item.amount || 0);
                const original = Number(item.original_amount || amount);
                const paid = Number(item.paid_amount || 0);
                const remaining = Number(item.remaining_amount ?? Math.max(amount - paid, 0));
                const row = [item.billing_type || 'Payment', original];
                if (hasPenalty) row.push(Number(item.penalty_amount || 0));
                row.push(amount, paid, remaining, item.due_date || 'Not Set', item.status || 'Unpaid');
                return row;
            });
            programProducts.forEach(programProduct => {
                const product = allProducts.find(item => item.product_id == programProduct.product_id);
                if (!product) return;
                const row = [product.product_name || 'Program Item', Number(product.price || 0)];
                if (hasPenalty) row.push(0);
                row.push(Number(product.price || 0), 0, Number(product.price || 0), 'Not Set', 'Item');
                billingRows.push(row);
            });

            exportBillingStatementData({
                format,
                filename: createBillingExportFilename(data.student_name, enrollmentId),
                title: 'Enrollment Billing Statement',
                sections: [
                    {
                        name: 'Student Details',
                        rows: [
                            ['Student', data.student_name || 'N/A'],
                            ['Program', data.program_name || 'N/A'],
                            ['Subject', data.subject_name || 'N/A'],
                            ['Grade Level', data.grade_level || 'N/A'],
                            ['Goal', data.goal || 'N/A']
                        ]
                    },
                    { name: 'Billing Schedule', headers: billingHeaders, rows: billingRows },
                    {
                        name: 'Payment History',
                        headers: ['Date', 'Paid For', 'Amount', 'Base Amount', 'Penalty', 'Payment Method', 'Reference No.', 'Status'],
                        rows: paymentHistory.length ? paymentHistory.map(payment => {
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
                    {
                        name: 'Summary',
                        rows: [
                            ['Total Amount', totalFee],
                            ['Total Paid', totalPaid],
                            ['Outstanding Balance', Number(data.balance || 0)]
                        ]
                    }
                ]
            });
        }
        Swal.close();
    } catch (error) {
        console.error('Billing statement PDF export failed:', error);
        Swal.fire('Download failed', error.message || 'Unable to download the billing statement.', 'error');
    }
};

function renderBillingModal(data, paymentMethods, enrollmentId, programProducts = [], allProducts = [], viewOnly = false, miscProducts = []) {
    ensureAdminBillingModalStyles();
    const paymentPageContext = isPaymentModulePage();
    const enrollmentStatus = String(data.enrollment_status || '').toLowerCase();
    const isIncompleteEnrollment = enrollmentStatus === 'incomplete';

    // Detect if this is "pending header only" state (needs enrollment proper)
    const isPendingHeaderOnly = data.schedule?.length === 1 && 
                               data.schedule[0].billing_type.toLowerCase().includes('downpayment') && 
                               data.schedule[0].status === 'paid';
    
    // No longer need client-side override since payment is now processed in database
    // The billing API will return the correct status from the database
    
    // Calculate breakdown from the schedule
    const totalFee = parseFloat(data.total_amount);

    const updatedTotalFee = totalFee;
    const recordedTotalPaid = parseFloat(data.total_paid);
    const totalPaid = Number.isFinite(recordedTotalPaid)
        ? recordedTotalPaid
        : Math.max(updatedTotalFee - parseFloat(data.balance || 0), 0);

    console.log('programProducts:', programProducts);
    console.log('allProducts:', allProducts);
    console.log('updatedTotalFee:', updatedTotalFee);

    const isFullyPaid = data.balance <= 0;

    // Handle case where schedule is missing
    if (data.schedule.length === 0 && !isFullyPaid) {
        Swal.fire({
            title: "Billing Not Found",
            text: "No billing schedule has been generated for this enrollment yet. Please generate the bill first.",
            icon: "warning",
            confirmButtonColor: '#e85d88'
        });
        return;
    }

    // Generate Payment Method Options from DB
    const paymentOptions = paymentMethods.map(pm => 
        `<option value="${pm.payment_method_id}">${pm.payment_method}</option>`
    ).join('');

    const hasPenalty = data.schedule.some(item => parseFloat(item.penalty_amount || 0) > 0);

    // Generate billing schedule rows dynamically
    const billingRows = data.schedule.map(item => {
        const amount = parseFloat(item.amount);
        const originalAmount = parseFloat(item.original_amount || amount);
        const penaltyAmount = parseFloat(item.penalty_amount || 0);
        const paidAmount = parseFloat(item.paid_amount || 0);
        const remainingAmount = parseFloat(item.remaining_amount ?? Math.max(amount - paidAmount, 0));
        const status = item.status || 'unpaid';
        const dueDate = item.due_date ? new Date(item.due_date).toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'}) : 'Not Set';
        const statusClass = status === 'paid' ? 'paid' : status === 'partial' ? 'partial' : 'unpaid';
        
        return `
        <tr>
            <td data-label="Payment Type">${item.billing_type}</td>
            <td data-label="Original">PHP ${originalAmount.toLocaleString()}</td>
            ${hasPenalty ? `<td data-label="Penalty">PHP ${penaltyAmount.toLocaleString()}</td>` : ''}
            <td data-label="Amount" class="admin-row-amount">&#8369;${amount.toLocaleString()}</td>
            <td data-label="Paid" class="admin-row-paid">&#8369;${paidAmount.toLocaleString()}</td>
            <td data-label="Balance" class="admin-row-balance">&#8369;${remainingAmount.toLocaleString()}</td>
            <td data-label="Due Date">${dueDate}</td>
            <td data-label="Status"><span class="admin-billing-status ${statusClass}">${status}</span></td>
        </tr>
        `;
    }).join('');

    // Generate product rows
    const productRows = programProducts.map(pp => {
        const product = allProducts.find(p => p.product_id == pp.product_id);
        if (!product) return '';
        return `
        <tr>
            <td data-label="Payment Type">${product.product_name}</td>
            <td data-label="Original">PHP ${parseFloat(product.price).toLocaleString()}</td>
            ${hasPenalty ? '<td data-label="Penalty">-</td>' : ''}
            <td data-label="Amount" class="admin-row-amount">&#8369;${parseFloat(product.price).toLocaleString()}</td>
            <td data-label="Paid">-</td>
            <td data-label="Balance" class="admin-row-balance">&#8369;${parseFloat(product.price).toLocaleString()}</td>
            <td data-label="Due Date">Not Set</td>
            <td data-label="Status"><span class="admin-billing-status item">Item</span></td>
        </tr>
        `;
    }).join('');

    const html = `
        <div class="admin-billing-container">
            <section class="admin-billing-card" aria-labelledby="adminStudentDetailsTitle">
                <h3 class="admin-billing-section-title" id="adminStudentDetailsTitle">
                    <span class="admin-billing-section-icon"><i class="bi bi-person-circle" aria-hidden="true"></i></span>
                    Student Details
                </h3>
                <div class="admin-student-grid">
                    <div><strong>Name:</strong> ${data.student_name || 'N/A'}</div>
                    <div><strong>Program:</strong> ${data.program_name || 'N/A'}</div>
                    <div><strong>Subject:</strong> ${data.subject_name || 'N/A'}</div>
                    <div><strong>Grade Level:</strong> ${data.grade_level || 'N/A'}</div>
                    <div><strong>Goal:</strong> ${data.goal || 'N/A'}</div>
                </div>
            </section>

            <section class="admin-billing-card" aria-labelledby="adminBillingStatementTitle">
                <h3 class="admin-billing-section-title" id="adminBillingStatementTitle">
                    <span class="admin-billing-section-icon"><i class="bi bi-table" aria-hidden="true"></i></span>
                    Billing Statement
                </h3>
                <div class="admin-billing-table-wrap">
                    <table class="admin-billing-table">
                        <thead>
                            <tr>
                                <th>Payment Type</th>
                                <th>Original</th>
                                ${hasPenalty ? '<th>Penalty</th>' : ''}
                                <th>Amount</th>
                                <th>Paid</th>
                                <th>Balance</th>
                                <th>Due Date</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>${billingRows}${productRows}</tbody>
                        <tfoot>
                            <tr class="admin-total-row">
                                <td colspan="${hasPenalty ? 4 : 3}" class="admin-total-label">Total Amount</td>
                                <td colspan="4" class="admin-total-value">&#8369;${updatedTotalFee.toLocaleString()}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </section>

            <section class="admin-billing-card admin-billing-summary" aria-label="Billing summary">
                <div class="admin-billing-summary-item">
                    <span class="admin-billing-summary-icon"><i class="bi bi-wallet2" aria-hidden="true"></i></span>
                    <div>
                        <span class="admin-billing-summary-label">Outstanding Balance</span>
                        <span class="admin-billing-summary-value">&#8369;${data.balance.toLocaleString()}</span>
                    </div>
                </div>
                <div class="admin-billing-summary-item paid">
                    <span class="admin-billing-summary-icon"><i class="bi bi-cash" aria-hidden="true"></i></span>
                    <div>
                        <span class="admin-billing-summary-label">Total Paid</span>
                        <span class="admin-billing-summary-value">&#8369;${totalPaid.toLocaleString()}</span>
                    </div>
                </div>
            </section>

            ${isIncompleteEnrollment && !viewOnly ? `
                <div class="alert alert-warning text-center mb-0">
                    <i class="bi bi-exclamation-triangle" aria-hidden="true"></i> This enrollment is incomplete. Please complete the enrollment first.
                </div>
            ` : (!isFullyPaid && !viewOnly) ? `
                <section class="admin-billing-card" aria-labelledby="adminInitialPaymentTitle">
                    <h3 class="admin-billing-section-title" id="adminInitialPaymentTitle">
                        <span class="admin-billing-section-icon"><i class="bi bi-credit-card" aria-hidden="true"></i></span>
                        Initial Payment
                    </h3>
                    <div class="admin-payment-grid">
                        <div class="admin-payment-field">
                            <label for="modalPaymentAmount" class="form-label">Payment Amount <span class="text-danger" aria-hidden="true">*</span></label>
                            <div class="input-group">
                                <span class="input-group-text">&#8369;</span>
                                <input type="number" class="form-control" id="modalPaymentAmount" placeholder="Enter amount" value="" max="${data.balance}" step="0.01" autofocus>
                            </div>
                            <small class="admin-payment-help"><em>Maximum: &#8369;${data.balance.toLocaleString()}</em></small>
                        </div>
                        <div class="admin-payment-field">
                            <label for="modalPaymentMethod" class="form-label">Payment Method <span class="text-danger" aria-hidden="true">*</span></label>
                            <select class="form-select" id="modalPaymentMethod">
                                <option value="">Select method</option>
                                ${paymentOptions}
                            </select>
                        </div>
                        <div class="admin-payment-field full" id="referenceContainer" style="display:none;">
                            <label for="modalReferenceNo" class="form-label">Reference No. <span class="text-danger" aria-hidden="true">*</span></label>
                            <input type="text" class="form-control" id="modalReferenceNo" placeholder="Enter reference number">
                            <small class="admin-payment-help"><em>Required when GCash is selected.</em></small>
                        </div>
                    </div>
                </section>
            ` : `<div class="alert alert-${viewOnly ? 'info' : 'success'} text-center mb-0"><i class="bi bi-${viewOnly ? 'eye' : 'check-circle'}"></i> ${viewOnly ? 'Billing statement is in view-only mode.' : 'This enrollment is fully paid.'}</div>`}
        </div>
    `;

    Swal.fire({
        title: `
            <span class="admin-billing-title">
                <span class="admin-billing-title-icon"><i class="bi bi-file-earmark-text" aria-hidden="true"></i></span>
                <span>Enrollment Billing Statement</span>
            </span>
        `,
        html: html,
        width: '1080px',
        showCloseButton: true,
        showCancelButton: !viewOnly,
        confirmButtonText: viewOnly
            ? 'Close'
            : (isIncompleteEnrollment
                ? 'Pls complete the enrollment'
                : (isFullyPaid ? 'Done' : 'Confirm Enrollment & Payment')),
        cancelButtonText: '<i class="bi bi-x-circle"></i> Close',
        reverseButtons: true,
        buttonsStyling: false,
        padding: 0,
        customClass: {
            container: 'admin-billing-modal-container',
            popup: 'admin-billing-popup',
            actions: viewOnly ? 'admin-billing-single-action' : '',
            confirmButton: 'admin-billing-confirm',
            cancelButton: 'admin-billing-cancel'
        },
        didOpen: () => {
            const methodSelect = document.getElementById('modalPaymentMethod');
            const referenceContainer = document.getElementById('referenceContainer');

            if (methodSelect) {
                methodSelect.addEventListener('change', function() {
                    if (referenceContainer) {
                        const selectedOption = methodSelect.options[methodSelect.selectedIndex];
                        const methodName = selectedOption.text.toLowerCase();
                        referenceContainer.style.display = methodName.includes('gcash') ? 'block' : 'none';
                    }
                });
            }
        },
        preConfirm: () => {
            if (isFullyPaid || viewOnly || isIncompleteEnrollment) return true;

            const amount = parseFloat(document.getElementById('modalPaymentAmount').value);
            const method = document.getElementById('modalPaymentMethod').value;
            const methodSelect = document.getElementById('modalPaymentMethod');
            const selectedOption = methodSelect.options[methodSelect.selectedIndex];
            const methodName = selectedOption.text.toLowerCase();
            const ref = methodName.includes('gcash') ? document.getElementById('modalReferenceNo').value.trim() : null;

            if (!amount || amount <= 0) {
                Swal.showValidationMessage('Please enter a valid payment amount');
                return false;
            }
            if (!method) {
                Swal.showValidationMessage('Please select a payment method');
                return false;
            }
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
            if (result.isConfirmed && !viewOnly) {
                if (isIncompleteEnrollment) {
                    if (typeof window.openPendingEnrollmentCompletion === 'function') {
                        window.openPendingEnrollmentCompletion(enrollmentId, 'tutorial');
                    } else {
                        Swal.fire('Incomplete Enrollment', 'Please complete the enrollment first.', 'info');
                    }
                    return;
                }

                if (isFullyPaid) return; 

                // The server now handles finding the correct bill. 
                // We just need to send the enrollment ID and payment details.
                
                const downpaymentRecord = data.schedule.find(s => s.billing_type && s.billing_type.toLowerCase() === 'downpayment');
                const receiptBill = getReceiptBill(data.schedule, 'Tuition Fee');

                // Construct the JSON payload for payment.php
                const paymentPayload = {
                    enrollment_id: enrollmentId, // Use the ID passed into the function
                    amount: result.value.amount,
                    method: result.value.method,
                    ref: result.value.ref || null,
                    // Set payment type based on whether the downpayment record exists and is unpaid
                    payment_type: (downpaymentRecord && downpaymentRecord.status === 'unpaid') ? 'Downpayment' : 'Tuition Fee'
                };

                axios.post('../../api/admin/payment.php', {
                    operation: 'processPayment',
                    json: JSON.stringify(paymentPayload)
                }).then(res => {
                    if (res.data.status === 'success') {
                        const paidAmount = parseFloat(result.value.amount || 0);
                        const currentBalance = parseFloat(data.balance || 0);
                        const newBalance = Math.max(currentBalance - paidAmount, 0);
                        const paymentKind = (receiptBill.amount && paidAmount >= receiptBill.amount) || newBalance <= 0
                            ? 'Full Payment'
                            : 'Partial Payment';
                        const receiptData = {
                            enrollmentId,
                            studentName: data.student_name,
                            programName: data.program_name,
                            service: paymentKind,
                            paymentType: paymentKind,
                            paymentKind,
                            paymentFor: receiptBill.label,
                            paymentMethod: result.value.methodName,
                            referenceNo: result.value.ref || null,
                            receiptNo: res.data.receipt_id || null,
                            amountPaid: paidAmount,
                            balance: newBalance,
                            totalAmount: paidAmount,
                            lineItems: Array.isArray(res.data.line_items) ? res.data.line_items : getReceiptLineItems(data.schedule, paidAmount),
                            paymentDate: new Date()
                        };

                        Swal.fire({
                            title: "Success!", 
                            text: "Payment recorded successfully.", 
                            icon: "success",
                            confirmButtonColor: '#e85d88'
                        }).then(() => showPaymentReceipt(receiptData)).then(() => {
                            if (typeof window.loadEnrollments === 'function') {
                                window.loadEnrollments();
                            } else {
                                location.reload();
                            }
                        });
                    } else {
                        Swal.fire("Error", res.data.message || "Failed to record payment.", "error");
                    }
                }).catch(err => {
                    console.error(err);
                    Swal.fire("Error", "A network error occurred while recording the payment.", "error");
                });
            }
        });
    }
