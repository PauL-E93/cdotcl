// js/modules/receipt.js

const RECEIPT_STYLE = `
    <style>
        .tc-receipt-wrap {
            font-family: Arial, Helvetica, sans-serif;
            color: #111;
            background: #fff;
            padding: 12px;
            max-width: 100%;
            margin: 0 auto;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
            align-items: stretch;
        }

        .tc-receipt-wrap--single {
            grid-template-columns: minmax(0, 1fr);
            max-width: 5.3in;
        }

        .tc-receipt-copy {
            background: #fff;
            border: 1px solid #ddd;
            padding: 16px 14px 18px;
            display: flex;
            flex-direction: column;
            min-height: 100%;
            width: 100%;
            max-width: 5.3in;
            box-sizing: border-box;
        }

        .tc-receipt-title {
            text-align: center;
            margin-bottom: 20px;
        }

        .tc-receipt-title h1 {
            font-size: 26px;
            font-weight: 700;
            letter-spacing: 0;
            margin: 0;
        }

        .tc-receipt-title h2 {
            font-size: 18px;
            font-weight: 600;
            margin: 6px 0 0;
        }

        .tc-receipt-subtitle {
            font-size: 12px;
            margin-top: 8px;
            line-height: 1.4;
            color: #333;
        }

        .tc-receipt-non-vat {
            margin-top: 6px;
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
        }

        .tc-receipt-meta {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px 24px;
            font-size: 14px;
            margin-bottom: 18px;
            text-align: left;
        }

        .tc-receipt-field {
            display: grid;
            grid-template-columns: max-content minmax(0, 1fr);
            gap: 6px;
            align-items: start;
        }

        .tc-receipt-value {
            font-weight: 700;
            overflow-wrap: anywhere;
        }

        .tc-receipt-field-nowrap .tc-receipt-value {
            overflow-wrap: normal;
            word-break: normal;
            white-space: nowrap;
        }

        .tc-receipt-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            font-size: 14px;
            margin-bottom: 18px;
        }

        .tc-receipt-table th,
        .tc-receipt-table td {
            border: 1px solid #111;
            padding: 10px 8px;
            vertical-align: top;
        }

        .tc-receipt-table th {
            font-weight: 600;
            text-align: left;
        }

        .tc-receipt-table th:last-child,
        .tc-receipt-table td:last-child {
            text-align: right;
            width: 42%;
        }

        .tc-receipt-lines {
            min-height: 120px;
            display: grid;
            gap: 7px;
            align-content: start;
            padding: 2px 0;
        }

        .tc-receipt-line {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 12px;
            align-items: start;
            line-height: 1.22;
        }

        .tc-receipt-line-label {
            text-align: left;
            overflow-wrap: anywhere;
        }

        .tc-receipt-line-value {
            text-align: right;
            font-weight: 700;
            overflow-wrap: anywhere;
            word-break: normal;
            hyphens: auto;
            white-space: nowrap;
        }

        .tc-receipt-total-label {
            text-align: right;
            font-weight: 700;
            font-size: 16px;
        }

        .tc-signature-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            margin-top: auto;
        }

        .tc-signature {
            width: 220px;
            text-align: center;
            font-size: 14px;
        }

        .tc-signature-line {
            border-top: 2px solid #111;
            margin-bottom: 8px;
        }

        .tc-copy-label {
            font-size: 12px;
            font-weight: 700;
            text-align: right;
            margin: 0;
            letter-spacing: 0.04em;
            white-space: nowrap;
        }

        .tc-receipt-actions {
            text-align: center;
            margin-top: 18px;
        }

        .tc-receipt-or-entry {
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            align-items: center;
            gap: 8px;
            margin-bottom: 10px;
        }

        .tc-receipt-or-input {
            min-width: 220px;
            max-width: 260px;
        }

        .tc-receipt-or-value {
            color: #dc2626;
            font-weight: 800;
        }

        .tc-receipt-or-status {
            font-size: 12px;
            color: #16a34a;
            font-weight: 600;
        }

        @media (max-width: 900px) {
            .tc-receipt-wrap {
                grid-template-columns: 1fr;
            }

            .tc-receipt-copy {
                padding: 16px;
            }
        }

        @media print {
            @page {
                size: landscape;
                margin: 0.2in;
            }

            html,
            body {
                margin: 0;
                background: #fff;
                width: 11in;
                min-height: auto;
                overflow: visible;
            }

            body {
                display: flex;
                justify-content: center;
                align-items: flex-start;
            }

            .tc-receipt-wrap {
                width: 10.4in;
                max-width: 10.4in;
                padding: 0;
                margin: 0 auto;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 0.12in;
            }

            .tc-receipt-wrap--single {
                width: 5.1in;
                max-width: 5.1in;
                grid-template-columns: 1fr;
            }

            .tc-receipt-actions,
            .swal2-actions {
                display: none !important;
            }

            .tc-receipt-copy {
                padding: 0.18in 0.18in 0.18in;
                border: none;
                width: 5.1in;
                max-width: 5.1in;
            }

            .tc-receipt-title {
                margin-bottom: 0.18in;
            }

            .tc-receipt-title h1 {
                font-size: 24px;
            }

            .tc-receipt-title h2 {
                font-size: 16px;
            }

            .tc-receipt-meta {
                gap: 0.08in 0.18in;
                font-size: 13px;
                margin-bottom: 0.14in;
            }

            .tc-receipt-table {
                font-size: 12px;
            }

            .tc-receipt-table th,
            .tc-receipt-table td {
                padding: 6px 8px;
            }

            .tc-receipt-lines {
                min-height: 1in;
                gap: 6px;
            }

            .tc-receipt-line {
                gap: 6px;
                line-height: 1.16;
            }

            .tc-signature {
                width: 2.2in;
                margin: 0.18in auto 0;
                font-size: 12px;
            }

            .tc-signature-line {
                border-top-width: 2px;
                margin-bottom: 6px;
            }

            .tc-copy-label {
                margin-top: 0.1in;
                font-size: 11px;
            }
        }
    </style>
`;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatCurrency(value) {
    const amount = Number(value) || 0;
    return `PHP ${amount.toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
}

function formatDate(value = new Date()) {
    return new Date(value).toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function createReceiptNo(enrollmentId, value = new Date()) {
    const datePart = new Date(value).toISOString().slice(0, 10).replace(/-/g, '');
    const randomSequence = String(Math.floor(Math.random() * 1000) + 1).padStart(4, '0');
    return `RCT-${datePart}-${randomSequence}`;
}

function wordsUnderOneThousand(value) {
    const ones = [
        '',
        'one',
        'two',
        'three',
        'four',
        'five',
        'six',
        'seven',
        'eight',
        'nine',
        'ten',
        'eleven',
        'twelve',
        'thirteen',
        'fourteen',
        'fifteen',
        'sixteen',
        'seventeen',
        'eighteen',
        'nineteen'
    ];
    const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
    const parts = [];

    if (value >= 100) {
        parts.push(`${ones[Math.floor(value / 100)]} hundred`);
        value %= 100;
    }

    if (value >= 20) {
        const ten = tens[Math.floor(value / 10)];
        const one = ones[value % 10];
        parts.push(one ? `${ten}-${one}` : ten);
    } else if (value > 0) {
        parts.push(ones[value]);
    }

    return parts.join(' ');
}

function numberToWords(value) {
    const amount = Math.floor(Number(value) || 0);

    if (amount === 0) return 'zero';

    const scales = [
        { value: 1000000000, label: 'billion' },
        { value: 1000000, label: 'million' },
        { value: 1000, label: 'thousand' }
    ];
    const parts = [];
    let remaining = amount;

    scales.forEach((scale) => {
        if (remaining >= scale.value) {
            const scaleValue = Math.floor(remaining / scale.value);
            parts.push(`${wordsUnderOneThousand(scaleValue)} ${scale.label}`);
            remaining %= scale.value;
        }
    });

    if (remaining > 0) {
        parts.push(wordsUnderOneThousand(remaining));
    }

    return parts.join(' ');
}

function formatPesoWords(value) {
    const amount = Number(value) || 0;
    const pesos = Math.floor(amount);
    const centavos = Math.round((amount - pesos) * 100);
    const pesoLabel = pesos === 1 ? 'peso' : 'pesos';
    const centavoLabel = centavos === 1 ? 'centavo' : 'centavos';
    const pesoWords = `${numberToWords(pesos)} ${pesoLabel}`;

    if (centavos > 0) {
        return `${pesoWords} and ${numberToWords(centavos)} ${centavoLabel} only`;
    }

    return `${pesoWords} only`;
}

function buildReceiptMarkup(receipt) {
    const paymentDate = receipt.paymentDate || new Date();
    const amountPaid = Number(receipt.amountPaid) || 0;
    const balance = Math.max(Number(receipt.balance) || 0, 0);
    const total = Number(receipt.totalAmount || amountPaid) || amountPaid;
    const paymentKind = receipt.paymentKind || receipt.service || receipt.paymentType || 'Payment';
    const paymentFor = receipt.paymentFor || receipt.paymentDescription || 'Tuition Fee';
    const amountWords = receipt.amountWords || formatPesoWords(amountPaid);
    const copyLabels = Array.isArray(receipt.copyLabels) && receipt.copyLabels.length > 0
        ? receipt.copyLabels
        : ['CUSTOMER COPY', 'COMPANY COPY'];
    const receiptNo = escapeHtml(receipt.receiptNo || createReceiptNo(receipt.enrollmentId, paymentDate));
    const orNo = receipt.orNo ? String(receipt.orNo) : '';
    const penaltyAmount = Math.max(Number(receipt.penaltyAmount) || 0, 0);
    const lineItems = Array.isArray(receipt.lineItems)
        ? receipt.lineItems
            .map(item => ({
                label: item.label || item.name || 'Payment item',
                amount: Number(item.amount) || 0
            }))
            .filter(item => item.amount > 0)
        : [];
    const hasPenaltyLine = lineItems.some(item => item.label.toLowerCase().includes('penalty'));
    if (penaltyAmount > 0 && !hasPenaltyLine) {
        lineItems.push({ label: 'Penalty', amount: penaltyAmount });
    }

    const amountRows = [
        { label: 'Sum amount in peso :', value: amountWords },
        { label: 'As:', value: paymentKind },
        { label: 'Payment for:', value: paymentFor },
        ...lineItems.map(item => ({ label: `${item.label}:`, value: formatCurrency(item.amount) })),
        { label: lineItems.length > 0 ? 'Total amount paid:' : 'Amount paid:', value: formatCurrency(amountPaid) },
        { label: 'Balance:', value: formatCurrency(balance) }
    ];

    if (receipt.paymentMethod) {
        amountRows.push({ label: 'Payment method:', value: receipt.paymentMethod });
    }

    if (receipt.referenceNo) {
        amountRows.push({ label: 'Reference no:', value: receipt.referenceNo });
    }

    const buildCopy = (copyLabel) => `
        <div class="tc-receipt-copy">
            <div class="tc-receipt-title">
                <h1>CDO TUTORIAL CENTER</h1>
                <h2>Payment Receipt</h2>
                <div class="tc-receipt-subtitle">
                    G-Fir, Stonestown Fr. Masterson Avenue Upper Balulang, 9000<br>
                    Cagayan de Oro City (Capital) Misamis Oriental, Philippines<br>
                    JAMILA Y. UMPA - Prop. Service Invoices
                </div>
                <div class="tc-receipt-non-vat">Non-Vat Reg. TIN 771-827-429-00000</div>
            </div>

            <div class="tc-receipt-meta">
                <div class="tc-receipt-field">
                    <span>Student Name:</span>
                    <span class="tc-receipt-value">${escapeHtml(receipt.studentName || 'N/A')}</span>
                </div>
                <div class="tc-receipt-field tc-receipt-field-nowrap">
                    <span>Date:</span>
                    <span class="tc-receipt-value">${escapeHtml(formatDate(paymentDate))}</span>
                </div>
                <div class="tc-receipt-field">
                    <span>Program:</span>
                    <span class="tc-receipt-value">${escapeHtml(receipt.programName || 'N/A')}</span>
                </div>
                <div class="tc-receipt-field tc-receipt-field-nowrap">
                    <span>Transaction NO:</span>
                    <span class="tc-receipt-value">${receiptNo}</span>
                </div>
                ${orNo ? `
                <div class="tc-receipt-field tc-receipt-field-nowrap">
                    <span>OR No:</span>
                    <span class="tc-receipt-value tc-receipt-or-value">${escapeHtml(orNo)}</span>
                </div>
                ` : ''}
            </div>

            <table class="tc-receipt-table">
                <thead>
                    <tr>
                        <th>Item/service</th>
                        <th>Amount</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td colspan="2">
                            <div class="tc-receipt-lines">
                                ${amountRows.map((row) => `
                                    <div class="tc-receipt-line">
                                        <span class="tc-receipt-line-label">${escapeHtml(row.label)}</span>
                                        <span class="tc-receipt-line-value">${escapeHtml(row.value)}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td class="tc-receipt-total-label">Total :</td>
                        <td><strong>${escapeHtml(formatCurrency(total))}</strong></td>
                    </tr>
                </tbody>
            </table>

            <div class="tc-signature-row">
                <div class="tc-signature">
                    <div class="tc-signature-line"></div>
                    <div>Authorized Signature</div>
                </div>
                <div class="tc-copy-label">${copyLabel}</div>
            </div>
        </div>
    `;

    return `
        ${RECEIPT_STYLE}
        <div class="tc-receipt-wrap${copyLabels.length === 1 ? ' tc-receipt-wrap--single' : ''}">
            ${copyLabels.map(buildCopy).join('')}
        </div>
    `;
}

export function createPaymentReceiptHtml(receipt) {
    return buildReceiptMarkup(receipt);
}

export function printPaymentReceipt(receiptHtml) {
    const printWindow = window.open('', '_blank', 'width=1000,height=800');

    if (!printWindow) {
        Swal.fire('Print Blocked', 'Please allow pop-ups so the receipt can be printed.', 'warning');
        return;
    }

    printWindow.document.open();
    printWindow.document.write(`
        <!doctype html>
        <html>
            <head>
                <title>Payment Receipt</title>
            </head>
            <body>
                ${receiptHtml}
                <script>
                    window.onload = function() {
                        window.focus();
                        window.print();
                    };
                <\/script>
            </body>
        </html>
    `);
    printWindow.document.close();
}

export function showPaymentReceipt(receipt) {
    const receiptHtml = createPaymentReceiptHtml(receipt);
    const hasPaymentId = Boolean(receipt.paymentId);
    const initialOrNo = receipt.orNo ? String(receipt.orNo) : '';

    return Swal.fire({
        title: '',
        html: `
            ${receiptHtml}
            <div class="tc-receipt-actions">
                ${hasPaymentId ? `
                    <div class="tc-receipt-or-entry">
                        <button type="button" class="btn btn-danger btn-sm" id="btnGenerateOrNo">
                            <i class="bi bi-pen"></i> Generate OR
                        </button>
                    </div>
                ` : ''}
                <div>
                    <button type="button" class="btn btn-primary" id="btnPrintPaymentReceipt">
                        <i class="bi bi-printer"></i> Print Receipt
                    </button>
                </div>
            </div>
        `,
        width: '1050px',
        showConfirmButton: true,
        confirmButtonText: 'Done',
        confirmButtonColor: '#5a67d8',
        customClass: {
            popup: 'rounded-3'
        },
        didOpen: () => {
            document
                .getElementById('btnPrintPaymentReceipt')
                ?.addEventListener('click', () => printPaymentReceipt(receiptHtml));

            const orButton = document.getElementById('btnGenerateOrNo');
            if (orButton && receipt.paymentId) {
                orButton.addEventListener('click', () => {
                    const http = (typeof window !== 'undefined' && window.axios) ? window.axios : (typeof axios !== 'undefined' ? axios : null);
                    if (!http) {
                        Swal.fire('Error', 'The request client is unavailable.', 'error');
                        return;
                    }

                    Swal.fire({
                        title: 'Official Receipt Number',
                        html: `
                            <div class="text-start">
                                <label class="form-label fw-bold small text-secondary">Enter OR number</label>
                                <input id="tcOrNoModalInput" class="form-control" value="${escapeHtml(initialOrNo)}" placeholder="e.g. OR-001234">
                            </div>
                        `,
                        showCancelButton: true,
                        confirmButtonText: 'Save OR',
                        confirmButtonColor: '#dc3545',
                        preConfirm: () => {
                            const value = document.getElementById('tcOrNoModalInput')?.value?.trim() || '';
                            if (!value) {
                                Swal.showValidationMessage('Please enter an official receipt number.');
                                return false;
                            }
                            return value;
                        }
                    }).then(result => {
                        if (!result.isConfirmed) {
                            return;
                        }

                        const rawValue = result.value;
                        orButton.disabled = true;
                        orButton.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Saving';

                        http.post('../../api/admin/payment.php', {
                            operation: 'updatePaymentOrNo',
                            json: JSON.stringify({ payment_id: receipt.paymentId, or_no: rawValue })
                        }).then(res => {
                            if (res.data?.status === 'success') {
                                const savedOrNo = res.data.or_no || rawValue;
                                receipt.orNo = savedOrNo;
                                Swal.fire({
                                    icon: 'success',
                                    title: 'Saved',
                                    text: 'Official receipt number saved successfully.',
                                    timer: 1200,
                                    showConfirmButton: false
                                }).then(() => {
                                    showPaymentReceipt({ ...receipt, orNo: savedOrNo });
                                });
                            } else {
                                Swal.fire('Error', res.data?.message || 'Failed to save OR number.', 'error');
                            }
                        }).catch(err => {
                            console.error(err);
                            Swal.fire('Error', 'Network error while saving OR number.', 'error');
                        }).finally(() => {
                            orButton.disabled = false;
                            orButton.innerHTML = '<i class="bi bi-pen"></i> Generate OR';
                        });
                    });
                });
            }
        }
    });
}

window.createPaymentReceiptHtml = createPaymentReceiptHtml;
window.showPaymentReceipt = showPaymentReceipt;
window.printPaymentReceipt = printPaymentReceipt;
