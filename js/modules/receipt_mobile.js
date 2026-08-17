// js/modules/receipt_mobile.js

const MOBILE_RECEIPT_STYLE = `
    <style>
        .tc-mobile-receipt-shell {
            padding: 10px;
            background: #f7f5f2;
        }

        .tc-mobile-receipt {
            position: relative;
            width: 100%;
            max-width: 360px;
            margin: 0 auto;
            padding: 24px 18px 28px;
            background:
                radial-gradient(circle at top, rgba(0, 0, 0, 0.04), transparent 24%),
                #fffdf8;
            color: #111;
            box-shadow: 0 18px 45px rgba(0, 0, 0, 0.12);
            font-family: "Arial Narrow", Arial, Helvetica, sans-serif;
            overflow: hidden;
        }

        .tc-mobile-receipt::before,
        .tc-mobile-receipt::after {
            content: "";
            position: absolute;
            left: 0;
            width: 100%;
            height: 10px;
            background:
                linear-gradient(-45deg, transparent 75%, #f7f5f2 75%) 0 0/10px 10px,
                linear-gradient(45deg, transparent 75%, #f7f5f2 75%) 0 0/10px 10px;
        }

        .tc-mobile-receipt::before {
            top: 0;
        }

        .tc-mobile-receipt::after {
            bottom: 0;
            transform: rotate(180deg);
        }

        .tc-mobile-receipt-header {
            text-align: center;
            padding-top: 10px;
        }

        .tc-mobile-receipt-header h1 {
            margin: 0;
            font-size: 34px;
            line-height: 1;
            letter-spacing: 0.04em;
            font-weight: 800;
            text-transform: uppercase;
        }

        .tc-mobile-receipt-header h2 {
            margin: 10px 0 0;
            font-size: 20px;
            letter-spacing: 0.08em;
            font-weight: 700;
            text-transform: uppercase;
        }

        .tc-mobile-receipt-address {
            margin-top: 14px;
            font-size: 11px;
            line-height: 1.55;
            text-align: center;
        }

        .tc-mobile-receipt-non-vat {
            margin-top: 6px;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
        }

        .tc-mobile-divider {
            margin: 16px 0;
            border-top: 2px dashed #222;
        }

        .tc-mobile-meta,
        .tc-mobile-section {
            display: grid;
            gap: 10px;
        }

        .tc-mobile-meta-row,
        .tc-mobile-detail-row,
        .tc-mobile-item-row,
        .tc-mobile-total-row {
            display: grid;
            grid-template-columns: minmax(0, 42%) minmax(0, 58%);
            gap: 10px;
            align-items: start;
        }

        .tc-mobile-meta-label,
        .tc-mobile-detail-label,
        .tc-mobile-item-label {
            font-size: 12px;
            font-weight: 700;
        }

        .tc-mobile-meta-value,
        .tc-mobile-detail-value,
        .tc-mobile-item-value {
            font-size: 12px;
            text-align: right;
            white-space: pre-line;
            word-break: break-word;
        }

        .tc-mobile-table-head {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 12px;
            font-size: 12px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            padding-bottom: 8px;
            border-bottom: 2px solid #222;
        }

        .tc-mobile-section {
            margin-top: 12px;
        }

        .tc-mobile-detail-row,
        .tc-mobile-item-row {
            padding-bottom: 8px;
            border-bottom: 1px dotted #777;
        }

        .tc-mobile-total-block {
            margin-top: 18px;
            padding: 12px 0;
            border-top: 3px solid #111;
            border-bottom: 3px double #111;
        }

        .tc-mobile-total-row {
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
        }

        .tc-mobile-total-label,
        .tc-mobile-total-value {
            font-size: 24px;
            font-weight: 900;
            text-transform: uppercase;
        }

        .tc-mobile-signature {
            margin-top: 44px;
            display: flex;
            justify-content: space-between;
            align-items: end;
            gap: 12px;
        }

        .tc-mobile-signature-box {
            width: 150px;
            text-align: center;
        }

        .tc-mobile-signature-line {
            border-top: 2px solid #222;
            margin-bottom: 8px;
        }

        .tc-mobile-signature-label,
        .tc-mobile-copy-label {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .tc-mobile-receipt-actions {
            margin-top: 14px;
            text-align: center;
        }

        @media print {
            @page {
                size: 80mm auto;
                margin: 4mm;
            }

            html,
            body {
                margin: 0;
                background: #fff;
            }

            .swal2-container,
            .swal2-actions,
            .tc-mobile-receipt-actions {
                display: none !important;
            }

            .tc-mobile-receipt-shell {
                padding: 0;
                background: #fff;
            }

            .tc-mobile-receipt {
                max-width: none;
                box-shadow: none;
                margin: 0;
            }
        }
    </style>
`;

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatCurrency(value) {
    const amount = Number(value) || 0;
    return `PHP ${amount.toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
}

function formatDate(value = new Date()) {
    return new Date(value).toLocaleDateString("en-PH", {
        year: "numeric",
        month: "long",
        day: "numeric"
    });
}

function createReceiptNo(enrollmentId, value = new Date()) {
    const date = new Date(value);
    const year = String(date.getFullYear()).slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const sequence = String(Math.floor(Math.random() * 9999) + 1).padStart(4, "0");
    return `${year}${month}${day}${sequence}`;
}

function wordsUnderOneThousand(value) {
    const ones = [
        "",
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
        "ten",
        "eleven",
        "twelve",
        "thirteen",
        "fourteen",
        "fifteen",
        "sixteen",
        "seventeen",
        "eighteen",
        "nineteen"
    ];
    const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
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

    return parts.join(" ");
}

function numberToWords(value) {
    const amount = Math.floor(Number(value) || 0);

    if (amount === 0) return "zero";

    const scales = [
        { value: 1000000000, label: "billion" },
        { value: 1000000, label: "million" },
        { value: 1000, label: "thousand" }
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

    return parts.join(" ");
}

function formatPesoWords(value) {
    const amount = Number(value) || 0;
    const pesos = Math.floor(amount);
    const centavos = Math.round((amount - pesos) * 100);
    const pesoLabel = pesos === 1 ? "peso" : "pesos";
    const centavoLabel = centavos === 1 ? "centavo" : "centavos";
    const pesoWords = `${numberToWords(pesos)} ${pesoLabel}`;

    if (centavos > 0) {
        return `${pesoWords} and ${numberToWords(centavos)} ${centavoLabel} only`;
    }

    return `${pesoWords} only`;
}

function normalizeLineItems(receipt, amountPaid, paymentFor) {
    const penaltyAmount = Math.max(Number(receipt.penaltyAmount) || 0, 0);
    const lineItems = Array.isArray(receipt.lineItems)
        ? receipt.lineItems
            .map((item) => ({
                label: item.label || item.name || "Payment item",
                amount: Number(item.amount) || 0
            }))
            .filter((item) => item.amount > 0)
        : [];

    const hasPenaltyLine = lineItems.some((item) => item.label.toLowerCase().includes("penalty"));
    if (penaltyAmount > 0 && !hasPenaltyLine) {
        lineItems.push({ label: "Penalty", amount: penaltyAmount });
    }

    if (lineItems.length === 0 && amountPaid > 0) {
        lineItems.push({ label: paymentFor || "Payment", amount: amountPaid });
    }

    return lineItems;
}

function buildReceiptMarkup(receipt) {
    const paymentDate = receipt.paymentDate || new Date();
    const amountPaid = Number(receipt.amountPaid) || 0;
    const balance = Math.max(Number(receipt.balance) || 0, 0);
    const total = Number(receipt.totalAmount || amountPaid) || amountPaid;
    const paymentKind = receipt.paymentKind || receipt.service || receipt.paymentType || "Payment";
    const paymentFor = receipt.paymentFor || receipt.paymentDescription || "Tuition Fee";
    const amountWords = receipt.amountWords || formatPesoWords(amountPaid);
    const receiptNo = escapeHtml(receipt.receiptNo || createReceiptNo(receipt.enrollmentId, paymentDate));
    const lineItems = normalizeLineItems(receipt, amountPaid, paymentFor);

    const detailRows = [
        { label: "Sum amount in peso", value: amountWords },
        { label: "As", value: paymentKind },
        { label: "Payment for", value: paymentFor },
        ...lineItems.map((item) => ({ label: item.label, value: formatCurrency(item.amount) })),
        { label: lineItems.length > 0 ? "Total amount paid" : "Amount paid", value: formatCurrency(amountPaid) },
        { label: "Balance", value: formatCurrency(balance) }
    ];

    if (receipt.paymentMethod) {
        detailRows.push({ label: "Payment method", value: receipt.paymentMethod });
    }

    if (receipt.referenceNo) {
        detailRows.push({ label: "Reference no.", value: receipt.referenceNo });
    }

    return `
        ${MOBILE_RECEIPT_STYLE}
        <div class="tc-mobile-receipt-shell">
            <div class="tc-mobile-receipt">
                <div class="tc-mobile-receipt-header">
                    <h1>CDO TUTORIAL CENTER</h1>
                    <h2>Payment Receipt</h2>
                    <div class="tc-mobile-receipt-address">
                        G-Fir, Stonestown Fr. Masterson Avenue Upper Balulang, 9000<br>
                        Cagayan de Oro City (Capital) Misamis Oriental, Philippines<br>
                        JAMILA Y. UMPA - Prop. Service Invoices
                    </div>
                    <div class="tc-mobile-receipt-non-vat">Non-VAT</div>
                </div>

                <div class="tc-mobile-divider"></div>

                <div class="tc-mobile-meta">
                    <div class="tc-mobile-meta-row">
                        <div class="tc-mobile-meta-label">Student Name:</div>
                        <div class="tc-mobile-meta-value">${escapeHtml(receipt.studentName || "N/A")}</div>
                    </div>
                    <div class="tc-mobile-meta-row">
                        <div class="tc-mobile-meta-label">Date:</div>
                        <div class="tc-mobile-meta-value">${escapeHtml(formatDate(paymentDate))}</div>
                    </div>
                    <div class="tc-mobile-meta-row">
                        <div class="tc-mobile-meta-label">Program:</div>
                        <div class="tc-mobile-meta-value">${escapeHtml(receipt.programName || "N/A")}</div>
                    </div>
                    <div class="tc-mobile-meta-row">
                        <div class="tc-mobile-meta-label">Receipt No:</div>
                        <div class="tc-mobile-meta-value">${receiptNo}</div>
                    </div>
                </div>

                <div class="tc-mobile-divider"></div>

                <div class="tc-mobile-table-head">
                    <div>Description</div>
                    <div>Amount</div>
                </div>

                <div class="tc-mobile-section">
                    ${detailRows.map((row) => `
                        <div class="tc-mobile-detail-row">
                            <div class="tc-mobile-detail-label">${escapeHtml(row.label)}</div>
                            <div class="tc-mobile-detail-value">${escapeHtml(row.value)}</div>
                        </div>
                    `).join("")}
                </div>

                <div class="tc-mobile-total-block">
                    <div class="tc-mobile-total-row">
                        <div class="tc-mobile-total-label">Total</div>
                        <div class="tc-mobile-total-value">${escapeHtml(formatCurrency(total))}</div>
                    </div>
                </div>

                <div class="tc-mobile-signature">
                    <div class="tc-mobile-signature-box">
                        <div class="tc-mobile-signature-line"></div>
                        <div class="tc-mobile-signature-label">Authorized Signature</div>
                    </div>
                    <div class="tc-mobile-copy-label">Customer Copy</div>
                </div>
            </div>
        </div>
    `;
}

export function createPaymentReceiptMobileHtml(receipt) {
    return buildReceiptMarkup(receipt);
}

function loadScriptOnce(src, id) {
    return new Promise((resolve, reject) => {
        const existingScript = document.getElementById(id);
        if (existingScript) {
            if (existingScript.dataset.loaded === "true") {
                resolve();
                return;
            }

            existingScript.addEventListener("load", resolve, { once: true });
            existingScript.addEventListener("error", reject, { once: true });
            return;
        }

        const script = document.createElement("script");
        script.id = id;
        script.src = src;
        script.async = true;
        script.onload = () => {
            script.dataset.loaded = "true";
            resolve();
        };
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
}

async function ensurePdfLibraries() {
    if (window.html2canvas && (window.jspdf?.jsPDF || window.jsPDF)) {
        return;
    }

    await Promise.all([
        loadScriptOnce("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js", "html2canvas-loader"),
        loadScriptOnce("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", "jspdf-loader")
    ]);

    if (!window.html2canvas || !(window.jspdf?.jsPDF || window.jsPDF)) {
        throw new Error("PDF libraries are not available.");
    }
}

function getReceiptFilename(receipt = {}) {
    const student = String(receipt.studentName || "student")
        .trim()
        .replace(/[^a-z0-9]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase() || "student";
    const receiptNo = String(receipt.receiptNo || createReceiptNo(receipt.enrollmentId, receipt.paymentDate || new Date()))
        .trim()
        .replace(/[^a-z0-9]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase() || "receipt";

    return `${student}_receipt_${receiptNo}.pdf`;
}

export async function downloadPaymentReceiptMobile(receipt) {
    let host = null;

    try {
        Swal.fire({
            title: "Preparing receipt...",
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        await ensurePdfLibraries();

        host = document.createElement("div");
        host.style.position = "fixed";
        host.style.left = "-10000px";
        host.style.top = "0";
        host.style.width = "380px";
        host.style.background = "#ffffff";
        host.style.pointerEvents = "none";
        host.style.zIndex = "-1";
        host.innerHTML = createPaymentReceiptMobileHtml(receipt);
        document.body.appendChild(host);

        const receiptNode = host.querySelector(".tc-mobile-receipt");
        if (!receiptNode) {
            throw new Error("Receipt layout was not created.");
        }

        const canvas = await window.html2canvas(receiptNode, {
            scale: 3,
            useCORS: true,
            backgroundColor: "#fffdf8",
            width: receiptNode.scrollWidth,
            height: receiptNode.scrollHeight,
            windowWidth: receiptNode.scrollWidth,
            windowHeight: receiptNode.scrollHeight
        });

        const jsPDF = window.jspdf?.jsPDF || window.jsPDF;
        const pageWidth = 80;
        const pageHeight = (canvas.height / canvas.width) * pageWidth;
        const pdf = new jsPDF({
            orientation: "portrait",
            unit: "mm",
            format: [pageWidth, pageHeight]
        });

        const imageData = canvas.toDataURL("image/jpeg", 0.98);
        pdf.addImage(imageData, "JPEG", 0, 0, pageWidth, pageHeight);
        pdf.save(getReceiptFilename(receipt));
        Swal.close();
    } catch (error) {
        console.error("Error downloading receipt:", error);
        Swal.fire("Download Error", error.message || "Unable to download the receipt.", "error");
    } finally {
        host?.remove();
    }
}

export function showPaymentReceiptMobile(receipt) {
    const receiptHtml = createPaymentReceiptMobileHtml(receipt);

    return Swal.fire({
        title: "",
        html: `
            ${receiptHtml}
            <div class="tc-mobile-receipt-actions">
                <button type="button" class="btn btn-primary" id="btnDownloadPaymentReceiptMobile">
                    <i class="bi bi-download"></i> Download Receipt
                </button>
            </div>
        `,
        width: "420px",
        showConfirmButton: true,
        confirmButtonText: "Done",
        confirmButtonColor: "#5a67d8",
        customClass: {
            popup: "rounded-4"
        },
        didOpen: () => {
            document
                .getElementById("btnDownloadPaymentReceiptMobile")
                ?.addEventListener("click", () => downloadPaymentReceiptMobile(receipt));
        }
    });
}

window.createPaymentReceiptMobileHtml = createPaymentReceiptMobileHtml;
window.showPaymentReceiptMobile = showPaymentReceiptMobile;
window.downloadPaymentReceiptMobile = downloadPaymentReceiptMobile;
