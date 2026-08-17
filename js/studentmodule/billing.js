// js/studentmodule/billing.js

/**
 * STUDENT BILLING CONTROLLER
 */

const STUDENT_PAYMENT_HISTORY_REFRESH_MS = 10000;

function getStudentReceiptHandler() {
    return typeof window.showPaymentReceipt === 'function'
        ? (receipt) => window.showPaymentReceipt({
            ...receipt,
            copyLabels: ['CUSTOMER COPY']
        })
        : null;
}

function getStudentModuleImportUrl(relativePath) {
    return new URL(relativePath, window.location.href).href;
}

async function ensureStudentTutorialEnrollmentHelpers() {
    if (typeof window.openPendingEnrollmentCompletion === 'function') {
        return;
    }

    await import(getStudentModuleImportUrl('../../js/studentmodule/student_enrollement.js'));
}

window.openStudentTutorialIncompleteEnrollment = async function(enrollmentId) {
    await ensureStudentTutorialEnrollmentHelpers();

    if (typeof window.openPendingEnrollmentCompletion === 'function') {
        return window.openPendingEnrollmentCompletion(enrollmentId, 'tutorial');
    }

    Swal.fire('Error', 'Enrollment completion is not available right now.', 'error');
};

function resolvePaymentProofUrl(proofPath) {
    if (!proofPath) return '';
    if (/^(?:https?:)?\/\//.test(proofPath)) {
        return proofPath;
    }

    const cleaned = String(proofPath).replace(/^\/+/, '');
    return `../../${cleaned}`;
}

function escapeStudentPaymentDetail(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function resolveStudentPaymentQrUrl(qrPath) {
    const value = String(qrPath || '').trim();
    if (!value) return '';
    if (/^(?:https?:|data:|blob:|\/)/i.test(value) || value.startsWith('../')) return value;
    return `../../${value.replace(/^\.\//, '')}`;
}

function buildStudentPaymentMethodDetails(method) {
    if (!method) return '';
    const accountName = String(method.account_name || '').trim();
    const accountNumber = String(method.account_number || '').trim();
    const qrUrl = resolveStudentPaymentQrUrl(method.qr_code);
    if (!accountName && !accountNumber && !qrUrl) return '';

    return `<div class="student-payment-method-details${qrUrl ? ' has-qr' : ''}" aria-label="${escapeStudentPaymentDetail(method.payment_method || 'Payment')} account details">
        <div class="student-payment-method-copy">
            <span class="student-payment-method-eyebrow"><i class="bi bi-shield-check" aria-hidden="true"></i> Send payment to</span>
            <h4>${escapeStudentPaymentDetail(method.payment_method || 'Payment account')}</h4>
            <dl>
                ${accountName ? `<div><dt>Account name</dt><dd>${escapeStudentPaymentDetail(accountName)}</dd></div>` : ''}
                ${accountNumber ? `<div><dt>Account number</dt><dd><span>${escapeStudentPaymentDetail(accountNumber)}</span><button type="button" id="studentPaymentCopyAccount" class="student-payment-copy-account"><i class="bi bi-copy" aria-hidden="true"></i><span>Copy</span></button></dd></div>` : ''}
            </dl>
            <p><i class="bi bi-info-circle" aria-hidden="true"></i> Verify the account details before sending your payment.</p>
        </div>
        ${qrUrl ? `<button type="button" class="student-payment-qr" id="studentPaymentOpenQr" title="View larger QR code">
            <img src="${escapeStudentPaymentDetail(qrUrl)}" alt="${escapeStudentPaymentDetail(method.payment_method || 'Payment')} QR code">
            <span><i class="bi bi-arrows-fullscreen" aria-hidden="true"></i> View larger</span>
        </button>` : ''}
    </div>`;
}

function bindStudentPaymentAccountCopy(buttonId, accountNumber) {
    const button = document.getElementById(buttonId);
    if (!button || !accountNumber) return;
    button.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(String(accountNumber));
            const label = button.querySelector('span');
            if (label) label.textContent = 'Copied';
            button.classList.add('is-copied');
            setTimeout(() => {
                if (label) label.textContent = 'Copy';
                button.classList.remove('is-copied');
            }, 1800);
        } catch (error) {
            console.warn('Unable to copy account number:', error);
        }
    });
}

function openStudentPaymentQrModal(method) {
    const qrUrl = resolveStudentPaymentQrUrl(method?.qr_code);
    if (!qrUrl) return;
    document.querySelector('.student-payment-qr-modal')?.remove();

    const modal = document.createElement('div');
    modal.className = 'student-payment-qr-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'studentPaymentQrModalTitle');
    modal.innerHTML = `<div class="student-payment-qr-dialog">
        <button type="button" class="student-payment-qr-close-icon" aria-label="Close QR code"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
        <h3 id="studentPaymentQrModalTitle">${escapeStudentPaymentDetail(method.payment_method || 'Payment')}</h3>
        <img src="${escapeStudentPaymentDetail(qrUrl)}" alt="${escapeStudentPaymentDetail(method.payment_method || 'Payment')} QR code">
        <button type="button" class="student-payment-qr-close-button">Close</button>
    </div>`;
    document.body.appendChild(modal);

    const closeModal = () => {
        document.removeEventListener('keydown', handleKeydown, true);
        modal.remove();
        document.getElementById('studentPaymentOpenQr')?.focus();
    };
    const handleKeydown = event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            closeModal();
        }
    };
    modal.addEventListener('click', event => {
        if (event.target === modal || event.target.closest('.student-payment-qr-close-icon, .student-payment-qr-close-button')) closeModal();
    });
    document.addEventListener('keydown', handleKeydown, true);
    modal.querySelector('.student-payment-qr-close-icon')?.focus();
}

function bindStudentPaymentQrModal(method) {
    document.getElementById('studentPaymentOpenQr')?.addEventListener('click', () => openStudentPaymentQrModal(method));
}

function getStudentReceiptKey(payment) {
    return String(payment.receipt_id || payment.payment_id || '');
}

function buildStudentReceiptData(enrollmentId, studentName, history, payment, billingData = {}) {
    const receiptKey = getStudentReceiptKey(payment);
    const receiptRows = history.filter(item => getStudentReceiptKey(item) === receiptKey);
    const rows = receiptRows.length > 0 ? receiptRows : [payment];
    const amountPaid = rows.reduce((sum, item) => sum + parseFloat(item.amount_paid || 0), 0);
    const balanceValues = rows
        .map(item => parseFloat(item.balance))
        .filter(value => !Number.isNaN(value));
    const balance = balanceValues.length > 0 ? Math.min(...balanceValues) : parseFloat(payment.balance || 0);
    const lineItems = rows.flatMap(item => {
        const paid = parseFloat(item.amount_paid || 0);
        const penalty = parseFloat(item.penalty_paid || 0);
        const base = parseFloat(item.base_amount_paid ?? Math.max(paid - penalty, 0));
        const billingType = item.billing_type || 'Payment';

        return [
            ...(base > 0 ? [{ label: billingType, amount: base }] : []),
            ...(penalty > 0 ? [{ label: `Penalty - ${billingType}`, amount: penalty }] : [])
        ];
    });
    const paymentFor = [...new Set(rows.map(item => item.billing_type).filter(Boolean))].join(', ') || 'Tuition Fee';

    return {
        enrollmentId,
        studentName,
        programName: billingData.program_name || 'N/A',
        programType: billingData.program_type || null,
        receiptNo: receiptKey,
        paymentKind: payment.payment_status || 'Payment',
        paymentType: payment.payment_status || 'Payment',
        paymentFor,
        paymentMethod: payment.payment_method || '',
        referenceNo: payment.reference_no || null,
        amountPaid,
        balance,
        totalAmount: amountPaid,
        lineItems,
        paymentDate: payment.payment_date || new Date()
    };
}

var GCASH_OCR_SCRIPT_URL = window.GCASH_OCR_SCRIPT_URL || 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

function ensureGcashOcrLibrary() {
    if (window.Tesseract?.recognize) {
        return Promise.resolve(window.Tesseract);
    }

    if (window.__gcashOcrScriptPromise) {
        return window.__gcashOcrScriptPromise;
    }

    window.__gcashOcrScriptPromise = new Promise((resolve, reject) => {
        const existingScript = document.querySelector('script[data-gcash-ocr="true"]');

        if (existingScript) {
            existingScript.addEventListener('load', () => resolve(window.Tesseract));
            existingScript.addEventListener('error', () => reject(new Error('Unable to load OCR library.')));
            return;
        }

        const script = document.createElement('script');
        script.src = GCASH_OCR_SCRIPT_URL;
        script.async = true;
        script.dataset.gcashOcr = 'true';
        script.onload = () => {
            if (window.Tesseract?.recognize) {
                resolve(window.Tesseract);
                return;
            }

            reject(new Error('OCR library loaded but is not available.'));
        };
        script.onerror = () => reject(new Error('Unable to load OCR library.'));
        document.head.appendChild(script);
    });

    return window.__gcashOcrScriptPromise;
}

function setGcashOcrStatus(statusElement, message, tone = 'muted') {
    if (!statusElement) return;

    statusElement.textContent = message;
    statusElement.className = 'small d-block mt-1';

    const toneClassMap = {
        muted: 'text-muted',
        info: 'text-primary',
        success: 'text-success',
        warning: 'text-warning',
        danger: 'text-danger'
    };

    statusElement.classList.add(toneClassMap[tone] || toneClassMap.muted);
}

function normalizeGcashReferenceCandidate(value) {
    return String(value || '')
        .toUpperCase()
        .replace(/[OQ]/g, '0')
        .replace(/[IL]/g, '1')
        .replace(/\D/g, '');
}

function isLikelyGcashReference(value) {
    return value.length >= 8 && value.length <= 20 && !/^0+$/.test(value);
}

function scoreGcashReferenceCandidate(value) {
    let score = value.length;
    if (value.length === 13) score += 30;
    if (value.length === 12 || value.length === 14) score += 12;

    if (value.length >= 12) score += 10;
    if (value.startsWith('63') && value.length <= 12) score -= 20;

    return score;
}

function stripGcashDateArtifacts(value) {
    return String(value || '')
        .replace(/\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\b.*$/i, '')
        .replace(/\b\d{1,2}:\d{2}\b.*$/i, '')
        .replace(/\b(?:AM|PM)\b.*$/i, '')
        .trim();
}

function extractDigitRuns(value) {
    return [...String(value || '').matchAll(/\d[\d\s-]{6,24}\d/g)]
        .map(match => normalizeGcashReferenceCandidate(match[0]))
        .filter(isLikelyGcashReference);
}

function parseGcashAmountValue(value) {
    const normalizedValue = String(value || '')
        .replace(/[,\s]/g, '')
        .replace(/[â‚±₱Pp]/g, '');
    const matchedAmount = normalizedValue.match(/\d+(?:\.\d{1,2})?/);
    if (!matchedAmount) {
        return null;
    }

    const amount = parseFloat(matchedAmount[0]);
    if (!Number.isFinite(amount) || amount <= 0) {
        return null;
    }

    return amount;
}

function extractGcashAmount(text) {
    const normalizedText = String(text || '')
        .replace(/\r/g, '')
        .replace(/[â‚±]/g, '₱');

    const lines = normalizedText
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    const scoredCandidates = [];
    const pushCandidate = (rawValue, scoreBoost = 0) => {
        const amount = parseGcashAmountValue(rawValue);
        if (amount === null) {
            return;
        }

        scoredCandidates.push({ amount, score: scoreBoost });
    };

    lines.forEach(line => {
        const totalAmountMatch = line.match(/total\s+amount\s+sent\s*[:\-]?\s*(.+)$/i);
        if (totalAmountMatch) {
            pushCandidate(totalAmountMatch[1], 50);
        }

        const amountMatch = line.match(/^amount\s*[:\-]?\s*(.+)$/i);
        if (amountMatch) {
            pushCandidate(amountMatch[1], 30);
        }
    });

    const fullTextTotalMatch = normalizedText.match(/total\s+amount\s+sent[\s\S]{0,30}?([₱P]?\s*\d+(?:\.\d{1,2})?)/i);
    if (fullTextTotalMatch) {
        pushCandidate(fullTextTotalMatch[1], 45);
    }

    const fullTextAmountMatch = normalizedText.match(/\bamount\b[\s\S]{0,20}?([₱P]?\s*\d+(?:\.\d{1,2})?)/i);
    if (fullTextAmountMatch) {
        pushCandidate(fullTextAmountMatch[1], 25);
    }

    if (scoredCandidates.length === 0) {
        return null;
    }

    return scoredCandidates
        .sort((a, b) => b.score - a.score || b.amount - a.amount)[0]
        .amount;
}

function extractGcashReferenceNumber(text) {
    const normalizedText = String(text || '')
        .replace(/[|]/g, 'I')
        .replace(/[‘’´`]/g, '')
        .replace(/\s+/g, ' ');

    const anchoredCandidates = [...normalizedText.matchAll(/ref(?:erence)?\s*(?:no|n0|number|#|mo)?\.?\s*[:\-]?\s*([A-Z0-9\s,.:-]{8,50})/gi)]
        .flatMap(match => {
            const withoutDate = stripGcashDateArtifacts(match[1]);
            const directCandidates = extractDigitRuns(withoutDate);
            if (directCandidates.length > 0) {
                return directCandidates;
            }

            const leftSideOnly = withoutDate.split(/\s{2,}/)[0] || withoutDate;
            return extractDigitRuns(leftSideOnly);
        });

    if (anchoredCandidates.length > 0) {
        return anchoredCandidates.sort((a, b) => scoreGcashReferenceCandidate(b) - scoreGcashReferenceCandidate(a))[0];
    }

    const improvedFallbackCandidates = extractDigitRuns(stripGcashDateArtifacts(normalizedText));
    if (improvedFallbackCandidates.length > 0) {
        return improvedFallbackCandidates.sort((a, b) => scoreGcashReferenceCandidate(b) - scoreGcashReferenceCandidate(a))[0];
    }

    const anchoredMatches = [...normalizedText.matchAll(/ref(?:erence)?\s*(?:no|n0|number|#|mo)?\.?\s*[:\-]?\s*([A-Z0-9\s]{8,30})/gi)]
        .map(match => normalizeGcashReferenceCandidate(match[1]))
        .filter(isLikelyGcashReference);

    if (anchoredMatches.length > 0) {
        return anchoredMatches.sort((a, b) => scoreGcashReferenceCandidate(b) - scoreGcashReferenceCandidate(a))[0];
    }

    const fallbackCandidates = [...normalizedText.matchAll(/\d[\d\s]{7,24}\d/g)]
        .map(match => normalizeGcashReferenceCandidate(match[0]))
        .filter(isLikelyGcashReference);

    if (fallbackCandidates.length === 0) {
        return '';
    }

    return fallbackCandidates.sort((a, b) => scoreGcashReferenceCandidate(b) - scoreGcashReferenceCandidate(a))[0];
}

function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('Unable to read the selected screenshot.'));
            image.src = reader.result;
        };
        reader.onerror = () => reject(new Error('Unable to read the selected screenshot.'));
        reader.readAsDataURL(file);
    });
}

function buildGcashOcrCanvasData(image, cropConfig = {}) {
    const scale = cropConfig.scale || 2;
    const sourceX = Math.max(0, Math.floor((cropConfig.x || 0) * image.width));
    const sourceY = Math.max(0, Math.floor((cropConfig.y || 0) * image.height));
    const sourceWidth = Math.max(1, Math.floor((cropConfig.width || 1) * image.width));
    const sourceHeight = Math.max(1, Math.floor((cropConfig.height || 1) * image.height));

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(sourceWidth * scale);
    canvas.height = Math.floor(sourceHeight * scale);

    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;

    for (let i = 0; i < pixels.length; i += 4) {
        const grayscale = (pixels[i] * 0.299) + (pixels[i + 1] * 0.587) + (pixels[i + 2] * 0.114);
        const normalized = grayscale > 170 ? 255 : 0;
        pixels[i] = normalized;
        pixels[i + 1] = normalized;
        pixels[i + 2] = normalized;
    }

    context.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
}

async function buildGcashOcrTargets(file) {
    const image = await loadImageFromFile(file);

    return [
        {
            label: 'reference number strip',
            image: buildGcashOcrCanvasData(image, { x: 0.06, y: 0.605, width: 0.54, height: 0.06, scale: 3.2 })
        },
        {
            label: 'reference line left side',
            image: buildGcashOcrCanvasData(image, { x: 0.04, y: 0.575, width: 0.64, height: 0.09, scale: 3 })
        },
        {
            label: 'reference area',
            image: buildGcashOcrCanvasData(image, { x: 0.04, y: 0.55, width: 0.78, height: 0.16, scale: 2.6 })
        },
        {
            label: 'full receipt',
            image: buildGcashOcrCanvasData(image, { x: 0, y: 0, width: 1, height: 1, scale: 1.6 })
        }
    ];
}

async function buildGcashAmountOcrTargets(file) {
    const image = await loadImageFromFile(file);

    return [
        {
            label: 'total amount sent row',
            image: buildGcashOcrCanvasData(image, { x: 0.05, y: 0.43, width: 0.88, height: 0.12, scale: 3 })
        },
        {
            label: 'amount row',
            image: buildGcashOcrCanvasData(image, { x: 0.05, y: 0.31, width: 0.88, height: 0.11, scale: 3 })
        },
        {
            label: 'amount value area',
            image: buildGcashOcrCanvasData(image, { x: 0.68, y: 0.31, width: 0.24, height: 0.25, scale: 3.2 })
        },
        {
            label: 'full receipt',
            image: buildGcashOcrCanvasData(image, { x: 0, y: 0, width: 1, height: 1, scale: 1.6 })
        }
    ];
}

async function detectGcashReferenceFromFile(file, onProgress) {
    const Tesseract = await ensureGcashOcrLibrary();
    const targets = await buildGcashOcrTargets(file);
    let lastText = '';

    for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        const result = await Tesseract.recognize(target.image, 'eng', {
            logger: message => {
                if (typeof onProgress !== 'function') return;
                if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
                    const percent = Math.round(message.progress * 100);
                    onProgress(`Reading ${target.label}... ${percent}%`);
                }
            }
        });

        const text = result?.data?.text || '';
        lastText = text || lastText;

        const referenceNo = extractGcashReferenceNumber(text);
        if (referenceNo) {
            return referenceNo;
        }
    }

    return extractGcashReferenceNumber(lastText);
}

async function detectGcashAmountFromFile(file, onProgress) {
    const Tesseract = await ensureGcashOcrLibrary();
    const targets = await buildGcashAmountOcrTargets(file);
    let lastText = '';

    for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        const result = await Tesseract.recognize(target.image, 'eng', {
            logger: message => {
                if (typeof onProgress !== 'function') return;
                if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
                    const percent = Math.round(message.progress * 100);
                    onProgress(`Reading ${target.label}... ${percent}%`);
                }
            }
        });

        const text = result?.data?.text || '';
        lastText = text || lastText;

        const amount = extractGcashAmount(text);
        if (amount !== null) {
            return amount;
        }
    }

    return extractGcashAmount(lastText);
}

function renderGcashReceiptPreview(file, previewWrapper, previewImage) {
    if (!previewWrapper || !previewImage) {
        return;
    }

    if (!file) {
        previewWrapper.classList.add('d-none');
        previewImage.removeAttribute('src');
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        previewImage.src = reader.result;
        previewWrapper.classList.remove('d-none');
    };
    reader.onerror = () => {
        previewWrapper.classList.add('d-none');
        previewImage.removeAttribute('src');
    };
    reader.readAsDataURL(file);
}

function attachGcashOcrAutoFill({
    fileInputId,
    actionButtonId,
    amountInputId,
    refInputId,
    statusId,
    previewWrapperId,
    previewImageId
}) {
    const fileInput = document.getElementById(fileInputId);
    const actionButton = document.getElementById(actionButtonId);
    const amountInput = document.getElementById(amountInputId);
    const refInput = document.getElementById(refInputId);
    const statusElement = document.getElementById(statusId);
    const previewWrapper = document.getElementById(previewWrapperId);
    const previewImage = document.getElementById(previewImageId);
    const confirmButton = Swal.getConfirmButton();

    if (!fileInput || !actionButton || !amountInput || !refInput || !statusElement) {
        return;
    }

    const toggleBusyState = isBusy => {
        statusElement.dataset.ocrBusy = isBusy ? 'true' : 'false';
        fileInput.disabled = isBusy;
        actionButton.disabled = isBusy;
        if (confirmButton) confirmButton.disabled = isBusy;
    };

    const runOcr = async () => {
        const file = fileInput.files?.[0];
        renderGcashReceiptPreview(file, previewWrapper, previewImage);

        if (!file) {
            setGcashOcrStatus(statusElement, 'Upload the GCash receipt screenshot first.', 'warning');
            return;
        }

        const isImageFile = /^image\//i.test(file.type || '') || /\.(png|jpe?g|webp|bmp)$/i.test(file.name || '');
        if (!isImageFile) {
            setGcashOcrStatus(statusElement, 'Please choose an image file for the receipt screenshot.', 'danger');
            return;
        }

        toggleBusyState(true);
        setGcashOcrStatus(statusElement, 'Preparing OCR for amount and reference number...', 'info');

        try {
            const amount = await detectGcashAmountFromFile(file, progressMessage => {
                setGcashOcrStatus(statusElement, progressMessage, 'info');
            });
            const referenceNo = await detectGcashReferenceFromFile(file, progressMessage => {
                setGcashOcrStatus(statusElement, progressMessage, 'info');
            });

            if (amount !== null) {
                amountInput.value = amount.toFixed(2);
            }
            if (referenceNo) {
                refInput.value = referenceNo;
            }

            if (amount !== null && referenceNo) {
                setGcashOcrStatus(statusElement, `Detected amount ${amount.toFixed(2)} and reference number ${referenceNo}.`, 'success');
                return;
            }

            if (amount !== null) {
                setGcashOcrStatus(statusElement, `Detected amount ${amount.toFixed(2)}. Please verify or type the reference number manually.`, 'warning');
                return;
            }

            if (referenceNo) {
                setGcashOcrStatus(statusElement, `Reference number detected: ${referenceNo}. Please verify or type the amount manually.`, 'warning');
                return;
            }

            setGcashOcrStatus(statusElement, 'We could not read the amount or Ref No. clearly. Please fill them in manually after checking the screenshot.', 'warning');
        } catch (error) {
            console.error('GCash OCR failed:', error);
            setGcashOcrStatus(statusElement, 'OCR could not read the screenshot right now. You can still type the amount and Ref No. manually.', 'danger');
        } finally {
            toggleBusyState(false);
        }
    };

    fileInput.addEventListener('change', () => {
        renderGcashReceiptPreview(fileInput.files?.[0] || null, previewWrapper, previewImage);
        runOcr();
    });
    actionButton.addEventListener('click', runOcr);
}

// Global function to open the billing modal for students
window.openStudentBillingModal = function(enrollmentId, showPayment = true) {
    // 1. Show loading state
    Swal.fire({
        title: 'Loading Billing Details...',
        didOpen: () => Swal.showLoading()
    });

    // 2. Fetch Billing Details AND Payment Methods in parallel
    Promise.all([
        axios.get(`../../api/student/payment.php?operation=getBillingDetails&enrollment_id=${enrollmentId}`),
        axios.get(`../../api/student/payment.php?operation=getPaymentMethods`),
        axios.get(`../../api/admin/enrollment.php?operation=getEnrollmentDetails&id=${enrollmentId}`).catch(() => ({ data: { status: 'error', data: { details: {} } } }))
    ])
    .then(([billingRes, methodsRes, enrollmentRes]) => {
        console.log("Billing Response:", billingRes);
        console.log("Methods Response:", methodsRes);
        Swal.close();

        if (billingRes.data.status === 'success' && methodsRes.data.status === 'success') {
            const enrollmentDetails = enrollmentRes.data?.status === 'success' ? enrollmentRes.data.data?.details || {} : {};
            const enrollmentStatus = enrollmentDetails.header_status || enrollmentDetails.status || billingRes.data.data.enrollment_status || '';
            renderStudentBillingModal(billingRes.data.data, methodsRes.data.data, enrollmentId, showPayment, enrollmentStatus);
        } else {
            Swal.fire("Error", "Could not fetch necessary data.", "error");
        }
    })
    .catch(err => {
        console.error(err);
        Swal.fire("Error", "Network error.", "error");
    });
};

async function fetchStudentPaymentHistoryModalData(enrollmentId) {
    const [historyRes, billingRes, enrollmentRes] = await Promise.all([
        axios.get(`../../api/student/payment.php?operation=getPaymentHistory&enrollment_details_id=${enrollmentId}`),
        axios.get(`../../api/student/payment.php?operation=getBillingDetails&enrollment_id=${enrollmentId}`),
        axios.get(`../../api/student/enrollment.php?operation=getEnrollmentDetails&id=${enrollmentId}`).catch(() => ({ data: { status: 'error' } }))
    ]);

    if (historyRes.data.status !== 'success') {
        throw new Error(historyRes.data.message || 'Could not fetch payment history.');
    }

    if (billingRes.data.status !== 'success') {
        throw new Error(billingRes.data.message || 'Could not fetch billing details.');
    }

    return {
        studentName: historyRes.data.student_name || 'Unknown Student',
        history: historyRes.data.history || [],
        billingData: billingRes.data.data || {},
        enrollmentStatus: enrollmentRes.data?.status === 'success'
            ? enrollmentRes.data.data?.details?.status || ''
            : ''
    };
}

function refreshStudentPaymentPageData() {
    if (typeof window.loadStudentPayments === 'function') {
        window.loadStudentPayments();
        return;
    }

    if (typeof loadStudentPayments === 'function') {
        loadStudentPayments();
    }
}

// Global function to open student payment history modal
window.openStudentPaymentHistoryModal = function(enrollmentId) {
    fetchStudentPaymentHistoryModalData(enrollmentId)
        .then(({ studentName, history, billingData, enrollmentStatus }) => {
            renderPaymentHistoryModal(enrollmentId, studentName, history, billingData, enrollmentStatus);
        })
        .catch(err => {
            console.error(err);
            Swal.fire("Error", err.message || "Network error.", "error");
        });
};

function ensureStudentBillingModalStyles() {
    if (document.getElementById('studentBillingModalStyles')) return;

    const styles = document.createElement('style');
    styles.id = 'studentBillingModalStyles';
    styles.textContent = `
        .student-billing-modal-container { padding: 6px; }
        .student-billing-popup {
            --billing-pink: #e85d88;
            --billing-pink-dark: #d94b78;
            --billing-pink-soft: #fff4f7;
            --billing-pink-border: #f4c4d3;
            --billing-ink: #1d2a3b;
            --billing-muted: #667085;
            width: min(970px, calc(100vw - 24px)) !important;
            max-width: 970px !important;
            padding: 0 !important;
            overflow: hidden;
            border: 2px solid var(--billing-pink);
            border-radius: 17px !important;
            background: #fff;
            box-shadow: 0 24px 70px rgba(55, 35, 43, .18) !important;
        }
        .student-billing-popup .swal2-title {
            padding: 38px 46px 24px;
            color: var(--billing-ink);
            text-align: left;
        }
        .student-billing-title {
            display: flex;
            align-items: center;
            gap: 28px;
            font-size: clamp(1.65rem, 4vw, 2.35rem);
            font-weight: 750;
        }
        .student-billing-title-icon {
            display: grid;
            flex: 0 0 66px;
            width: 66px;
            height: 66px;
            place-items: center;
            border-radius: 15px;
            color: var(--billing-pink);
            background: #fde7ee;
            font-size: 1.75rem;
        }
        .student-billing-popup .swal2-close {
            top: 24px;
            right: 25px;
            width: 42px;
            height: 42px;
            color: var(--billing-pink);
            font-size: 2.25rem;
            font-weight: 300;
        }
        .student-billing-popup .swal2-close:hover {
            color: var(--billing-pink-dark);
            background: var(--billing-pink-soft);
        }
        .student-billing-popup .swal2-html-container {
            margin: 0;
            padding: 0 46px;
            overflow: visible;
            color: var(--billing-ink);
        }
        .student-billing-container {
            display: grid;
            gap: 22px;
            text-align: left;
        }
        .student-billing-card {
            padding: 22px 24px;
            border: 1px solid var(--billing-pink-border);
            border-radius: 14px;
            background: #fff;
            box-shadow: 0 3px 9px rgba(90, 44, 59, .06);
        }
        .student-billing-section-title {
            display: flex;
            align-items: center;
            gap: 13px;
            margin: 0 0 20px;
            color: var(--billing-pink);
            font-size: 1.35rem;
            font-weight: 750;
        }
        .student-billing-section-icon {
            display: grid;
            flex: 0 0 38px;
            width: 38px;
            height: 38px;
            place-items: center;
            border-radius: 10px;
            color: var(--billing-pink);
            background: #fdeaf0;
            font-size: 1.1rem;
        }
        .student-enrollment-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 14px 48px;
            font-size: 1rem;
        }
        .student-enrollment-grid strong {
            color: #182336;
            font-weight: 700;
        }
        .student-enrollment-grid > div {
            min-width: 0;
            overflow-wrap: anywhere;
        }
        .student-billing-table-wrap {
            overflow: hidden;
            border: 1px solid var(--billing-pink-border);
            border-radius: 12px;
        }
        .student-billing-table {
            width: 100%;
            margin: 0;
            border-collapse: collapse;
            text-align: center;
            font-size: .94rem;
        }
        .student-billing-table th,
        .student-billing-table td {
            padding: 16px 12px;
            border-right: 1px solid #f4d5df;
            border-bottom: 1px solid #f4d5df;
            vertical-align: middle;
        }
        .student-billing-table tr > *:last-child { border-right: 0; }
        .student-billing-table tbody tr:last-child td { border-bottom: 0; }
        .student-billing-table thead th {
            color: #243044;
            background: #fff6f8;
            font-weight: 700;
            white-space: nowrap;
        }
        .student-billing-table .billing-row-amount {
            color: var(--billing-pink);
            font-size: 1rem;
            font-weight: 750;
        }
        .student-billing-table .billing-total-row td {
            padding: 15px 26px;
            background: #fff8fa;
        }
        .student-billing-table .billing-total-label {
            color: #1e293b;
            text-align: left;
            font-weight: 750;
        }
        .student-billing-table .billing-total-value {
            color: var(--billing-pink);
            text-align: right;
            font-size: 1.65rem;
            font-weight: 800;
        }
        .student-billing-status {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 74px;
            padding: 5px 10px;
            border: 1px solid #f0a020;
            border-radius: 8px;
            color: #e58900;
            background: #fffaf0;
            font-size: .8rem;
            font-weight: 700;
            text-transform: lowercase;
        }
        .student-billing-status.paid {
            border-color: #76cf9a;
            color: #159452;
            background: #f0fbf5;
        }
        .student-billing-status.partial {
            border-color: #80b7ef;
            color: #2775c9;
            background: #f1f7ff;
        }
        .student-billing-summary {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            padding: 0;
            overflow: hidden;
        }
        .student-billing-summary-item {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 22px;
            min-height: 112px;
            padding: 20px;
        }
        .student-billing-summary-item + .student-billing-summary-item {
            border-left: 1px solid #f1d9e1;
        }
        .student-billing-summary-icon {
            display: grid;
            flex: 0 0 64px;
            width: 64px;
            height: 64px;
            place-items: center;
            border-radius: 50%;
            color: var(--billing-pink);
            background: #fde9ef;
            font-size: 1.55rem;
        }
        .student-billing-summary-item.paid .student-billing-summary-icon {
            color: #16a35c;
            background: #eaf8f0;
        }
        .student-billing-summary-label {
            display: block;
            margin-bottom: 3px;
            color: var(--billing-muted);
            font-size: .95rem;
        }
        .student-billing-summary-value {
            display: block;
            color: var(--billing-pink);
            font-size: 1.85rem;
            font-weight: 800;
            line-height: 1.1;
        }
        .student-billing-summary-item.paid .student-billing-summary-value { color: #16a35c; }
        .student-payment-card .student-billing-section-title { margin-bottom: 16px; }
        .student-payment-receipt-heading {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 20px;
            margin-bottom: 14px;
        }
        .student-payment-receipt-copy {
            color: var(--billing-muted);
            font-size: .94rem;
            line-height: 1.5;
        }
        .student-payment-receipt-copy strong {
            display: block;
            margin-bottom: 5px;
            color: var(--billing-ink);
            font-size: 1rem;
        }
        .student-gcash-badge {
            display: inline-flex;
            padding: 3px 10px;
            margin-left: 7px;
            border: 1px solid #f4bfd0;
            border-radius: 999px;
            color: var(--billing-pink);
            background: #fff4f7;
            font-size: .78rem;
            font-weight: 700;
        }
        .student-payment-read-receipt {
            display: inline-flex;
            flex: 0 0 auto;
            align-items: center;
            justify-content: center;
            gap: 9px;
            min-height: 50px;
            padding: 0 20px;
            border: 1px solid var(--billing-pink);
            border-radius: 9px;
            color: var(--billing-pink);
            background: #fff;
            font-weight: 700;
        }
        .student-payment-read-receipt:hover {
            color: var(--billing-pink-dark);
            background: var(--billing-pink-soft);
        }
        .student-payment-method-details {
            display: grid;
            grid-template-columns: 1fr;
            gap: 22px;
            align-items: center;
            margin-bottom: 20px;
            padding: 20px;
            border: 1px solid #f1c4d2;
            border-radius: 12px;
            background: linear-gradient(135deg, #fff8fa, #fff);
        }
        .student-payment-method-details.has-qr { grid-template-columns: minmax(0, 1fr) minmax(170px, 220px); }
        .student-payment-method-eyebrow {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            margin-bottom: 7px;
            color: var(--billing-pink);
            font-size: .78rem;
            font-weight: 800;
            letter-spacing: .05em;
            text-transform: uppercase;
        }
        .student-payment-method-copy h4 { margin: 0 0 14px; color: var(--billing-ink); font-size: 1.15rem; font-weight: 750; }
        .student-payment-method-copy dl { display: grid; gap: 10px; margin: 0; }
        .student-payment-method-copy dl div { display: grid; grid-template-columns: 118px minmax(0, 1fr); gap: 12px; align-items: center; }
        .student-payment-method-copy dt { color: var(--billing-muted); font-size: .8rem; font-weight: 650; }
        .student-payment-method-copy dd { display: flex; align-items: center; gap: 9px; min-width: 0; margin: 0; color: var(--billing-ink); font-weight: 750; overflow-wrap: anywhere; }
        .student-payment-method-copy p { display: flex; gap: 7px; margin: 14px 0 0; color: var(--billing-muted); font-size: .79rem; }
        .student-payment-copy-account {
            display: inline-flex;
            flex: 0 0 auto;
            align-items: center;
            gap: 5px;
            padding: 5px 9px;
            border: 1px solid #edb5c6;
            border-radius: 7px;
            color: var(--billing-pink-dark);
            background: #fff;
            font-size: .75rem;
            font-weight: 750;
        }
        .student-payment-copy-account:hover, .student-payment-copy-account.is-copied { background: #fdeaf0; }
        .student-payment-qr {
            display: grid;
            justify-items: center;
            gap: 8px;
            padding: 10px;
            border: 1px solid #efd3dc;
            border-radius: 11px;
            color: var(--billing-pink-dark);
            background: #fff;
            font-size: .78rem;
            font-weight: 750;
            text-decoration: none;
        }
        .student-payment-qr img { width: 100%; max-width: 190px; max-height: 190px; border-radius: 7px; object-fit: contain; }
        .student-payment-qr:hover { color: var(--billing-pink-dark); border-color: var(--billing-pink); }
        .student-payment-qr-modal {
            position: fixed;
            inset: 0;
            z-index: 20000;
            display: grid;
            place-items: center;
            padding: 18px;
            background: rgba(15, 23, 42, .58);
            backdrop-filter: blur(2px);
        }
        .student-payment-qr-dialog {
            position: relative;
            display: grid;
            justify-items: center;
            width: min(640px, calc(100vw - 28px));
            max-height: calc(100vh - 28px);
            padding: 30px 30px 26px;
            overflow: auto;
            border-radius: 10px;
            background: #fff;
            box-shadow: 0 24px 70px rgba(15, 23, 42, .3);
        }
        .student-payment-qr-dialog h3 { margin: 0 42px 22px; color: #4a4a4a; font-size: 2rem; font-weight: 750; text-align: center; }
        .student-payment-qr-dialog img { display: block; max-width: 100%; max-height: 65vh; border-radius: 10px; object-fit: contain; }
        .student-payment-qr-close-icon {
            position: absolute;
            top: 14px;
            right: 14px;
            display: grid;
            width: 36px;
            height: 36px;
            place-items: center;
            border: 0;
            border-radius: 50%;
            color: #667085;
            background: transparent;
        }
        .student-payment-qr-close-icon:hover { background: #f2f4f7; }
        .student-payment-qr-close-button {
            min-width: 92px;
            min-height: 46px;
            margin-top: 24px;
            padding: 0 22px;
            border: 0;
            border-radius: 7px;
            color: #fff;
            background: var(--billing-pink);
            font-weight: 750;
        }
        .student-payment-qr-close-button:hover { background: var(--billing-pink-dark); }
        .student-payment-upload-zone {
            position: relative;
            display: flex;
            min-height: 174px;
            align-items: center;
            justify-content: center;
            padding: 24px;
            overflow: hidden;
            border: 2px dashed var(--billing-pink);
            border-radius: 11px;
            background: #fff8fa;
            text-align: center;
            cursor: pointer;
        }
        .student-payment-upload-zone:hover { background: #fff0f5; }
        .student-payment-upload-zone input[type="file"] {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            cursor: pointer;
            opacity: 0;
        }
        .student-payment-upload-copy { pointer-events: none; }
        .student-payment-upload-copy i {
            display: block;
            margin-bottom: 9px;
            color: var(--billing-pink);
            font-size: 2.7rem;
        }
        .student-payment-upload-title {
            display: block;
            color: var(--billing-ink);
            font-size: 1.05rem;
            font-weight: 750;
        }
        .student-payment-upload-subtitle {
            display: block;
            margin-top: 8px;
            color: var(--billing-muted);
            font-size: .92rem;
        }
        .student-payment-file-help,
        .student-payment-field-help {
            display: block;
            margin-top: 7px;
            color: var(--billing-muted);
            font-size: .82rem;
        }
        .student-payment-fields {
            display: grid;
            gap: 15px;
            margin-top: 14px;
        }
        .student-payment-field label {
            margin-bottom: 7px;
            color: var(--billing-ink);
            font-size: .94rem;
            font-weight: 700;
        }
        .student-payment-field .form-control,
        .student-payment-field .input-group-text {
            min-height: 50px;
            border-color: #d7dde6;
        }
        .student-payment-field .form-control:focus {
            border-color: #ef9bb5;
            box-shadow: 0 0 0 .2rem rgba(232, 93, 136, .13);
        }
        .student-payment-field .input-group-text {
            min-width: 58px;
            justify-content: center;
            background: #f8f9fb;
            font-weight: 700;
        }
        .student-payment-preview {
            margin-top: 13px;
            padding: 10px;
            border: 1px solid #f1d4de;
            border-radius: 11px;
            background: #fff9fb;
            text-align: center;
        }
        .student-payment-preview img {
            max-height: 280px;
            object-fit: contain;
        }
        .student-billing-popup .swal2-validation-message {
            margin: 14px 46px 0;
            border-radius: 9px;
        }
        .student-billing-popup .swal2-actions {
            display: flex;
            justify-content: center;
            gap: 22px;
            width: 100%;
            margin: 0;
            padding: 16px 46px 20px;
            border-top: 0;
        }
        .student-billing-popup .student-billing-confirm,
        .student-billing-popup .student-billing-cancel {
            min-height: 50px;
            margin: 0;
            padding: 0 28px;
            border-radius: 8px;
            font-weight: 700;
        }
        .student-billing-popup .student-billing-confirm {
            min-width: 220px;
            border: 1px solid var(--billing-pink);
            color: #fff;
            background: linear-gradient(135deg, var(--billing-pink), #df4e7c);
            box-shadow: 0 8px 16px rgba(232, 93, 136, .18);
        }
        .student-billing-popup .student-billing-confirm:hover {
            color: #fff;
            background: linear-gradient(135deg, var(--billing-pink-dark), #c93f6b);
        }
        .student-billing-popup .student-billing-cancel {
            min-width: 140px;
            border: 1px solid #d7dde5;
            color: #475467;
            background: #fff;
        }
        .student-billing-popup .student-billing-cancel:hover { background: #f8fafc; }
        @media (max-width: 767.98px) {
            .student-billing-popup {
                width: calc(100vw - 12px) !important;
                max-width: calc(100vw - 12px) !important;
                border-radius: 13px !important;
            }
            .student-billing-popup .swal2-title { padding: 24px 16px 18px; }
            .student-billing-title {
                gap: 12px;
                padding-right: 32px;
                font-size: clamp(1.35rem, 6vw, 1.65rem);
                line-height: 1.12;
            }
            .student-billing-title-icon {
                flex-basis: 48px;
                width: 48px;
                height: 48px;
                font-size: 1.2rem;
            }
            .student-billing-popup .swal2-close {
                top: 7px;
                right: 7px;
            }
            .student-billing-popup .swal2-html-container {
                padding: 0 12px;
                overflow: hidden;
            }
            .student-billing-container { gap: 14px; }
            .student-billing-card { padding: 18px 15px; }
            .student-billing-section-title {
                gap: 10px;
                margin-bottom: 16px;
                font-size: 1.2rem;
            }
            .student-enrollment-grid { grid-template-columns: 1fr; gap: 10px; }
            .student-billing-table-wrap { overflow: hidden; }
            .student-billing-table,
            .student-billing-table tbody,
            .student-billing-table tfoot,
            .student-billing-table tr,
            .student-billing-table td {
                display: block;
                width: 100%;
            }
            .student-billing-table { min-width: 0; }
            .student-billing-table thead { display: none; }
            .student-billing-table tbody {
                display: grid;
                gap: 12px;
                padding: 12px;
                background: #fff;
            }
            .student-billing-table tbody tr {
                overflow: hidden;
                border: 1px solid #f2cbd7;
                border-radius: 10px;
                background: #fff;
            }
            .student-billing-table tbody td {
                display: grid;
                grid-template-columns: minmax(108px, 42%) minmax(0, 1fr);
                gap: 12px;
                padding: 10px 12px;
                border-right: 0;
                border-bottom: 1px solid #f5dce4;
                text-align: right;
                overflow-wrap: anywhere;
            }
            .student-billing-table tbody td:last-child { border-bottom: 0; }
            .student-billing-table tbody td::before {
                content: attr(data-label);
                color: #344054;
                font-weight: 700;
                text-align: left;
            }
            .student-billing-table tbody td.billing-schedule-empty {
                display: block;
                padding: 18px 12px;
                text-align: center;
            }
            .student-billing-table tbody td.billing-schedule-empty::before { content: none; }
            .student-billing-table tfoot {
                border-top: 1px solid var(--billing-pink-border);
                background: #fff8fa;
            }
            .student-billing-table .billing-total-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 14px;
            }
            .student-billing-table .billing-total-row td {
                width: auto;
                padding: 0;
                border: 0;
                background: transparent;
            }
            .student-billing-table .billing-total-label { flex: 1 1 auto; }
            .student-billing-table .billing-total-value {
                flex: 0 0 auto;
                font-size: 1.35rem;
                white-space: nowrap;
            }
            .student-billing-summary { grid-template-columns: 1fr; }
            .student-billing-summary-item + .student-billing-summary-item {
                border-top: 1px solid #f1d9e1;
                border-left: 0;
            }
            .student-billing-summary-item {
                justify-content: flex-start;
                min-height: 94px;
                padding: 16px 20px;
            }
            .student-billing-summary-value { font-size: 1.55rem; }
            .student-payment-receipt-heading { display: block; }
            .student-payment-method-details,
            .student-payment-method-details.has-qr { grid-template-columns: 1fr; gap: 16px; padding: 16px; }
            .student-payment-method-copy dl div { grid-template-columns: 1fr; gap: 3px; }
            .student-payment-qr { width: min(220px, 100%); justify-self: center; }
            .student-payment-qr-modal { padding: 10px; }
            .student-payment-qr-dialog { width: calc(100vw - 20px); max-height: calc(100vh - 20px); padding: 24px 16px 20px; }
            .student-payment-qr-dialog h3 { margin-bottom: 18px; font-size: 1.55rem; }
            .student-payment-qr-dialog img { max-height: 68vh; }
            .student-payment-read-receipt {
                width: 100%;
                margin-top: 14px;
            }
            .student-billing-popup .swal2-validation-message { margin-inline: 14px; }
            .student-billing-popup .swal2-actions {
                gap: 10px;
                padding: 15px 14px 18px;
            }
        }
        @media (max-width: 480px) {
            .student-billing-popup .swal2-actions { flex-direction: column; }
            .student-billing-popup .student-billing-confirm,
            .student-billing-popup .student-billing-cancel {
                width: 100%;
                min-width: 0;
            }
        }
    `;
    document.head.appendChild(styles);
}

function renderStudentBillingModal(data, paymentMethods, enrollmentId, showPayment = true, enrollmentStatus = '') {
    ensureStudentBillingModalStyles();
    // Calculate breakdown from the schedule
    const totalFee = parseFloat(data.total_amount);
    const isIncompleteEnrollment = String(enrollmentStatus || '').toLowerCase() === 'incomplete';

    const isFullyPaid = data.balance <= 0;

    // Find GCash payment method ID
    const gcashMethod = paymentMethods.find(pm => pm.payment_method.toLowerCase() === 'gcash');
    const gcashId = gcashMethod ? gcashMethod.payment_method_id : null;
    const gcashPaymentDetails = buildStudentPaymentMethodDetails(gcashMethod);

    console.log("Payment Methods:", paymentMethods);
    console.log("GCash Method:", gcashMethod, "ID:", gcashId);

    // Handle case where schedule is missing - show modal with message instead of returning
    const scheduleContent = data.schedule.length === 0 
        ? `<tr><td colspan="6" class="billing-schedule-empty text-warning"><i class="bi bi-info-circle"></i> Billing schedule not yet generated. Please contact administrator for payment due dates.</td></tr>`
        : data.schedule.map(item => {
            const amount = parseFloat(item.amount);
            const originalAmount = parseFloat(item.original_amount || amount);
            const penaltyAmount = parseFloat(item.penalty_amount || 0);
            const status = item.status || 'unpaid';
            const dueDate = item.due_date ? new Date(item.due_date).toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'}) : 'Not Set';
            const statusClass = status === 'paid' ? 'paid' : status === 'partial' ? 'partial' : 'unpaid';
            
            return `
            <tr>
                <td data-label="Payment Type">${item.billing_type}</td>
                <td data-label="Original">PHP ${originalAmount.toLocaleString()}</td>
                <td data-label="Penalty">PHP ${penaltyAmount.toLocaleString()}</td>
                <td data-label="Amount" class="billing-row-amount">&#8369;${amount.toLocaleString()}</td>
                <td data-label="Due Date">${dueDate}</td>
                <td data-label="Status"><span class="student-billing-status ${statusClass}">${status}</span></td>
            </tr>
            `;
        }).join('');

    const html = `
        <div class="student-billing-container">
            <section class="student-billing-card" aria-labelledby="studentEnrollmentDetailsTitle">
                <h3 class="student-billing-section-title" id="studentEnrollmentDetailsTitle">
                    <span class="student-billing-section-icon"><i class="bi bi-person-circle" aria-hidden="true"></i></span>
                    Enrollment Details
                </h3>
                <div class="student-enrollment-grid">
                    <div><strong>Program:</strong> ${data.program_name || 'N/A'}${data.program_type ? ` (${data.program_type})` : ''}</div>
                    <div><strong>Subject:</strong> ${data.subject_name || 'N/A'}</div>
                    <div><strong>Grade Level:</strong> ${data.grade_level || 'N/A'}</div>
                    <div><strong>Goal:</strong> ${data.goal || 'N/A'}</div>
                </div>
            </section>

            <section class="student-billing-card" aria-labelledby="studentBillingStatementTitle">
                <h3 class="student-billing-section-title" id="studentBillingStatementTitle">
                    <span class="student-billing-section-icon"><i class="bi bi-table" aria-hidden="true"></i></span>
                    Billing Statement
                </h3>
                <div class="student-billing-table-wrap">
                    <table class="student-billing-table">
                        <thead>
                            <tr>
                                <th>Payment Type</th>
                                <th>Original</th>
                                <th>Penalty</th>
                                <th>Amount</th>
                                <th>Due Date</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>${scheduleContent}</tbody>
                        <tfoot>
                            <tr class="billing-total-row">
                                <td colspan="3" class="billing-total-label">Total Amount</td>
                                <td colspan="3" class="billing-total-value">&#8369;${totalFee.toLocaleString()}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </section>

            <section class="student-billing-card student-billing-summary" aria-label="Payment summary">
                <div class="student-billing-summary-item">
                    <span class="student-billing-summary-icon"><i class="bi bi-wallet2" aria-hidden="true"></i></span>
                    <div>
                        <span class="student-billing-summary-label">Outstanding Balance</span>
                        <span class="student-billing-summary-value">&#8369;${data.balance.toLocaleString()}</span>
                    </div>
                </div>
                <div class="student-billing-summary-item paid">
                    <span class="student-billing-summary-icon"><i class="bi bi-cash" aria-hidden="true"></i></span>
                    <div>
                        <span class="student-billing-summary-label">Total Paid</span>
                        <span class="student-billing-summary-value">&#8369;${data.total_paid.toLocaleString()}</span>
                    </div>
                </div>
            </section>

            ${isIncompleteEnrollment ? `
                <div class="alert alert-warning text-center mb-0">
                    <i class="bi bi-exclamation-triangle" aria-hidden="true"></i> This enrollment is incomplete. Please complete the enrollment first.
                </div>
            ` : (!isFullyPaid && showPayment) ? `
                <section class="student-billing-card student-payment-card" aria-labelledby="studentMakePaymentTitle">
                    <h3 class="student-billing-section-title" id="studentMakePaymentTitle">
                        <span class="student-billing-section-icon"><i class="bi bi-credit-card" aria-hidden="true"></i></span>
                        Make Payment
                    </h3>

                    ${gcashPaymentDetails}

                    <div class="student-payment-receipt-heading">
                        <div class="student-payment-receipt-copy">
                            <strong>Payment Receipt <span class="student-gcash-badge">GCash</span></strong>
                            Upload your GCash payment screenshot so we can read the amount<br class="d-none d-md-block"> and reference number automatically.
                        </div>
                        <button type="button" class="student-payment-read-receipt" id="studentPaymentRunOcr">
                            <i class="bi bi-bounding-box" aria-hidden="true"></i> Read Receipt
                        </button>
                    </div>

                    <label class="student-payment-upload-zone" for="studentPaymentScreenshot">
                        <input type="file" id="studentPaymentScreenshot" accept="image/jpeg,image/png,.jpg,.jpeg,.png" required>
                        <span class="student-payment-upload-copy">
                            <i class="bi bi-cloud-arrow-up" aria-hidden="true"></i>
                            <span class="student-payment-upload-title">Upload GCash screenshot</span>
                            <span class="student-payment-upload-subtitle" id="studentPaymentFilename">Drag and drop your file here, or click to browse</span>
                        </span>
                    </label>
                    <small class="student-payment-file-help">Supports JPG, PNG files up to 10MB.</small>
                    <small id="studentPaymentOcrStatus" class="small text-muted d-block mt-1">
                        Upload the GCash screenshot and we will read the paid amount and reference number for you.
                    </small>
                    <div id="studentPaymentPreviewWrapper" class="student-payment-preview d-none">
                        <img id="studentPaymentPreviewImage" alt="GCash receipt preview" class="img-fluid rounded-2">
                    </div>

                    <div class="student-payment-fields">
                        <div class="student-payment-field">
                            <label class="form-label" for="studentPaymentAmount">Payment Amount <span class="text-danger" aria-hidden="true">*</span></label>
                            <div class="input-group">
                                <span class="input-group-text">&#8369;</span>
                                <input type="number" class="form-control" id="studentPaymentAmount" placeholder="Enter amount" max="${data.balance}" step="0.01" required>
                            </div>
                            <small class="student-payment-field-help"><em>Maximum: &#8369;${data.balance.toLocaleString()}</em></small>
                        </div>
                        <div class="student-payment-field">
                            <label class="form-label" for="studentPaymentReference">GCash Reference Number <span class="text-danger" aria-hidden="true">*</span></label>
                            <input type="text" class="form-control" id="studentPaymentReference" placeholder="Enter GCash reference number" required>
                            <small class="student-payment-field-help"><em>Required for payment verification. You can still correct the number manually if needed.</em></small>
                        </div>
                    </div>
                </section>
            ` : `<div class="alert alert-success text-center mb-0"><i class="bi bi-check-circle"></i> ${isFullyPaid ? 'This enrollment is fully paid.' : 'Downpayment completed. Please note with the billing schedule.'}</div>`}
        </div>
    `;

    Swal.fire({
        title: `
            <span class="student-billing-title">
                <span class="student-billing-title-icon"><i class="bi bi-file-earmark-text" aria-hidden="true"></i></span>
                <span>My Billing Statement</span>
            </span>
        `,
        html: html,
        width: '970px',
        showCloseButton: true,
        showCancelButton: true,
        confirmButtonText: isIncompleteEnrollment
            ? 'pls complete the enrollment'
            : ((!isFullyPaid && showPayment) ? '<i class="bi bi-credit-card"></i> Make Payment' : (isFullyPaid ? '<i class="bi bi-clock-history"></i> View Payment History' : '<i class="bi bi-x-circle"></i> Close')),
        cancelButtonText: '<i class="bi bi-x-circle"></i> Close',
        reverseButtons: true,
        buttonsStyling: false,
        padding: 0,
        customClass: {
            container: 'student-billing-modal-container',
            popup: 'student-billing-popup',
            confirmButton: 'student-billing-confirm',
            cancelButton: 'student-billing-cancel'
        },
        didOpen: () => {
            if (!isIncompleteEnrollment && !isFullyPaid && showPayment) {
                bindStudentPaymentAccountCopy('studentPaymentCopyAccount', gcashMethod?.account_number);
                bindStudentPaymentQrModal(gcashMethod);
                const screenshotInput = document.getElementById('studentPaymentScreenshot');
                const filename = document.getElementById('studentPaymentFilename');
                if (screenshotInput && filename) {
                    screenshotInput.addEventListener('change', () => {
                        filename.textContent = screenshotInput.files?.[0]?.name || 'Drag and drop your file here, or click to browse';
                    });
                }

                attachGcashOcrAutoFill({
                    fileInputId: 'studentPaymentScreenshot',
                    actionButtonId: 'studentPaymentRunOcr',
                    amountInputId: 'studentPaymentAmount',
                    refInputId: 'studentPaymentReference',
                    statusId: 'studentPaymentOcrStatus',
                    previewWrapperId: 'studentPaymentPreviewWrapper',
                    previewImageId: 'studentPaymentPreviewImage'
                });
            }
        },
        preConfirm: () => {
            if (isIncompleteEnrollment || isFullyPaid || !showPayment) return true;

            if (!gcashId) {
                Swal.showValidationMessage('GCash payment method not configured. Please contact administrator.');
                return false;
            }

            const amount = parseFloat(document.getElementById('studentPaymentAmount').value);
            const screenshotFile = document.getElementById('studentPaymentScreenshot')?.files?.[0] || null;
            const ref = document.getElementById('studentPaymentReference').value.trim();
            const ocrBusy = document.getElementById('studentPaymentOcrStatus')?.dataset.ocrBusy === 'true';

            if (!amount || amount <= 0 || isNaN(amount)) {
                Swal.showValidationMessage('Please enter a valid payment amount');
                return false;
            }
            if (amount > parseFloat(data.balance)) {
                Swal.showValidationMessage('Payment amount cannot exceed outstanding balance');
                return false;
            }
            if (!screenshotFile) {
                Swal.showValidationMessage('Please upload the GCash payment screenshot first');
                return false;
            }
            if (screenshotFile.size > 10 * 1024 * 1024) {
                Swal.showValidationMessage('Please upload a JPG or PNG receipt no larger than 10MB');
                return false;
            }
            if (ocrBusy) {
                Swal.showValidationMessage('OCR is still reading the screenshot. Please wait a moment.');
                return false;
            }
            if (!ref || ref.trim() === '') {
                Swal.showValidationMessage('GCash reference number is required');
                return false;
            }

            return { amount, ref, screenshotFile };
        }
    }).then((result) => {
        if (result.isConfirmed) {
            if (isIncompleteEnrollment) {
                window.openStudentTutorialIncompleteEnrollment(enrollmentId);
            } else if (isFullyPaid) {
                // Open payment history modal
                openStudentPaymentHistoryModal(enrollmentId);
            } else if (showPayment) {
                // Process payment
                const paymentData = result.value;

                // Show loading
                Swal.fire({
                    title: 'Processing Payment...',
                    didOpen: () => Swal.showLoading(),
                    allowOutsideClick: false
                });

                const payload = {
                    enrollment_id: enrollmentId,
                    method: gcashId,
                    amount: paymentData.amount,
                    ref: paymentData.ref
                };
                const formData = new FormData();
                formData.append('operation', 'processPayment');
                formData.append('json', JSON.stringify(payload));
                if (paymentData.screenshotFile) {
                    formData.append('payment_screenshot', paymentData.screenshotFile);
                }
                console.log("Sending payment payload:", payload);

                axios.post('../../api/student/payment.php', formData).then(res => {
                    if (res.data.status === 'success') {
                        const paidAmount = parseFloat(paymentData.amount || 0);
                        const currentBalance = parseFloat(data.balance || 0);
                        const newBalance = Math.max(currentBalance - paidAmount, 0);
                        const receiptBill = Array.isArray(data.schedule)
                            ? data.schedule.find(item => item.status !== 'paid') || data.schedule[0]
                            : null;
                        const paymentKind = paidAmount >= currentBalance ? 'Full Payment' : 'Partial Payment';
                        const receiptData = {
                            enrollmentId,
                            studentName: data.student_name,
                            programName: data.program_name,
                            programType: data.program_type,
                            paymentKind,
                            paymentType: paymentKind,
                            paymentFor: receiptBill ? receiptBill.billing_type || 'Tuition Fee' : 'Tuition Fee',
                            paymentMethod: 'GCash',
                            referenceNo: paymentData.ref || null,
                            paymentScreenshotPath: res.data.payment_screenshot_path || null,
                            receiptNo: res.data.receipt_id || null,
                            amountPaid: paidAmount,
                            balance: newBalance,
                            totalAmount: paidAmount,
                            lineItems: Array.isArray(res.data.line_items) ? res.data.line_items : [],
                            paymentDate: new Date()
                        };

                        Swal.fire({
                            title: "Payment Submitted!",
                            text: res.data.message,
                            icon: "success",
                            confirmButtonColor: '#e85d88'
                        }).then(() => {
                            const receiptHandler = getStudentReceiptHandler();
                            if (typeof receiptHandler === 'function') {
                                return receiptHandler(receiptData);
                            }
                        }).then(() => {
                            window.dispatchEvent(new CustomEvent('payment-status-updated', {
                                detail: { scope: 'tutorial', source: 'student-payment-submit' }
                            }));
                        }).then(() => {
                            refreshStudentPaymentPageData();
                        });
                    } else {
                        Swal.fire("Error", res.data.message || "Failed to process payment.", "error");
                    }
                }).catch(err => {
                    console.error(err);
                    Swal.fire("Error", "A network error occurred while processing the payment.", "error");
                });
            }
            // else just close
        }
    });
}

function renderPaymentHistoryModal(enrollmentId, studentName, history, billingData = {}, enrollmentStatus = '') {
    let currentStudentName = studentName;
    let currentHistory = Array.isArray(history) ? history : [];
    let currentBillingData = billingData || {};
    let currentEnrollmentStatus = enrollmentStatus;
    let refreshTimer = null;
    let isRefreshing = false;

    const getPaymentStatusPresentation = status => {
        const normalized = String(status || '').toLowerCase();
        if (['received', 'enrolled', 'complete', 'completed', 'active'].includes(normalized)) {
            return { tone: 'success', icon: 'bi-check-circle-fill', label: String(status).toUpperCase() };
        }
        if (['pending', 'incomplete'].includes(normalized)) {
            return { tone: 'pending', icon: 'bi-clock-fill', label: String(status).toUpperCase() };
        }
        if (['declined', 'cancelled', 'canceled'].includes(normalized)) {
            return { tone: 'danger', icon: 'bi-x-circle-fill', label: String(status).toUpperCase() };
        }
        return { tone: 'neutral', icon: 'bi-info-circle', label: status ? String(status).toUpperCase() : 'UNKNOWN' };
    };

    const showStudentPaymentDetailsModal = payment => {
        const receiptKey = getStudentReceiptKey(payment);
        const receiptRows = currentHistory.filter(item => getStudentReceiptKey(item) === receiptKey);
        const detailRows = receiptRows.length > 0 ? receiptRows : [payment];
        const screenshotHtml = payment.payment_screenshot_path
            ? `<img src="${resolvePaymentProofUrl(payment.payment_screenshot_path)}" alt="GCash payment screenshot" class="img-fluid rounded-3" style="max-height: 420px; object-fit: contain;">`
            : '<div class="text-muted py-5">No payment screenshot was uploaded for this record.</div>';
        const totalAmountPaid = detailRows.reduce((sum, item) => sum + parseFloat(item.amount_paid || 0), 0);
        const amountValue = totalAmountPaid.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        Swal.fire({
            title: 'Payment Details',
            width: '720px',
            showCancelButton: true,
            cancelButtonText: 'Close',
            confirmButtonText: 'View Receipt',
            confirmButtonColor: '#5a67d8',
            cancelButtonColor: '#6c757d',
            reverseButtons: true,
            html: `
                <div class="text-start">
                    <label class="form-label fw-bold text-secondary small mb-1">GCash Payment Screenshot</label>
                    <div class="border rounded-3 p-2 bg-light text-center mb-3">
                        ${screenshotHtml}
                    </div>
                    <div class="mb-3">
                        <label class="form-label fw-bold text-secondary small mb-1">Payment Amount</label>
                        <div class="input-group">
                            <span class="input-group-text bg-white text-muted">₱</span>
                            <input type="text" class="form-control" value="${amountValue}" readonly>
                        </div>
                    </div>
                    <div>
                        <label class="form-label fw-bold text-secondary small mb-1">GCash Reference Number</label>
                        <input type="text" class="form-control" value="${payment.reference_no || ''}" readonly>
                    </div>
                </div>
            `
        }).then(result => {
            if (!result.isConfirmed) {
                return;
            }

            const receiptHandler = getStudentReceiptHandler();
            if (typeof receiptHandler !== 'function') {
                Swal.fire('Error', 'Receipt viewer is not available.', 'error');
                return;
            }

            receiptHandler(buildStudentReceiptData(enrollmentId, currentStudentName, currentHistory, payment, currentBillingData));
        });
    };

    const renderHistoryContent = () => {
        const statusElement = document.getElementById('studentPaymentHistoryStatus');
        const tableBody = document.getElementById('studentPaymentHistoryTableBody');

        const resolvedEnrollmentStatus = currentEnrollmentStatus || (currentHistory.some(payment => String(payment.payment_status).toLowerCase() === 'pending')
            ? 'pending'
            : currentHistory.length ? 'received' : 'unknown');
        const enrollmentPresentation = getPaymentStatusPresentation(resolvedEnrollmentStatus);
        if (statusElement) {
            statusElement.className = `payment-enrollment-status payment-enrollment-status--${enrollmentPresentation.tone}`;
            statusElement.innerHTML = `<i class="bi ${enrollmentPresentation.icon}"></i><span>Status: ${enrollmentPresentation.label}</span>`;
        }

        if (!tableBody) {
            return;
        }

        const historyRows = currentHistory.length > 0
            ? currentHistory.map(payment => {
                const amountPaid = parseFloat(payment.amount_paid || 0);
                const penaltyPaid = parseFloat(payment.penalty_paid || 0);
                const baseAmountPaid = parseFloat(payment.base_amount_paid ?? Math.max(amountPaid - penaltyPaid, 0));
                const amountBreakdown = amountPaid
                    ? `PHP ${amountPaid.toLocaleString()}${penaltyPaid > 0
                        ? `<div class="small text-muted">Base: PHP ${baseAmountPaid.toLocaleString()} + <span class="text-danger">Penalty: PHP ${penaltyPaid.toLocaleString()}</span></div>`
                        : ''}`
                    : 'N/A';
                const paymentPresentation = getPaymentStatusPresentation(payment.payment_status);

                return `
                    <tr>
                        <td data-label="Date">${payment.payment_date || 'N/A'}</td>
                        <td data-label="Paid For">${payment.billing_type || payment.payment_type || 'N/A'}</td>
                        <td data-label="Amount">${amountBreakdown}</td>
                        <td data-label="Payment Method">${payment.payment_method || 'N/A'}</td>
                        <td data-label="Reference No.">${payment.reference_no || 'N/A'}</td>
                        <td data-label="Status"><span class="payment-row-status payment-row-status--${paymentPresentation.tone}"><i class="bi ${paymentPresentation.icon}"></i>${payment.payment_status || 'N/A'}</span></td>
                        <td data-label="Actions"><div class="payment-history-actions"><button type="button" class="payment-history-action view-student-payment-receipt" data-receipt-key="${getStudentReceiptKey(payment)}"><i class="bi bi-receipt"></i>View Receipt</button></div></td>
                    </tr>
                `;
            }).join('')
            : '<tr><td colspan="7" class="payment-history-empty">No payment history found.</td></tr>';

        tableBody.innerHTML = historyRows;

        document.querySelectorAll('.view-student-payment-receipt').forEach(button => {
            button.addEventListener('click', () => {
                const receiptKey = button.getAttribute('data-receipt-key');
                const payment = currentHistory.find(item => getStudentReceiptKey(item) === receiptKey);
                if (!payment) {
                    Swal.fire('Error', 'Payment details are not available.', 'error');
                    return;
                }

                const receiptHandler = getStudentReceiptHandler();
                if (typeof receiptHandler === 'function') {
                    receiptHandler(buildStudentReceiptData(enrollmentId, currentStudentName, currentHistory, payment, currentBillingData));
                    return;
                }

                showStudentPaymentDetailsModal(payment);
            });
        });
    };

    const refreshHistory = async () => {
        if (isRefreshing || !Swal.isVisible()) return;

        const popup = Swal.getPopup();
        if (!popup || !popup.querySelector('#studentPaymentHistoryTableBody')) return;

        isRefreshing = true;
        try {
            const refreshed = await fetchStudentPaymentHistoryModalData(enrollmentId);
            currentStudentName = refreshed.studentName;
            currentHistory = refreshed.history;
            currentBillingData = refreshed.billingData;
            currentEnrollmentStatus = refreshed.enrollmentStatus;
            renderHistoryContent();
            refreshStudentPaymentPageData();
        } catch (error) {
            console.error('Unable to refresh student payment history:', error);
        } finally {
            isRefreshing = false;
        }
    };

    Swal.fire({
        title: `Payment History - ${currentStudentName}`,
        html: `
            <div class="payment-history-status-row">
                <span class="payment-enrollment-status payment-enrollment-status--neutral" id="studentPaymentHistoryStatus"></span>
            </div>
            <div class="payment-history-table-wrap">
                <table class="payment-history-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Paid For</th>
                            <th>Amount</th>
                            <th>Payment Method</th>
                            <th>Reference No.</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="studentPaymentHistoryTableBody"></tbody>
                </table>
            </div>
        `,
        width: 'min(92vw, 1050px)',
        showCloseButton: true,
        confirmButtonText: 'Close',
        buttonsStyling: false,
        customClass: {
            popup: 'payment-history-popup',
            title: 'payment-history-title',
            htmlContainer: 'payment-history-content',
            closeButton: 'payment-history-x',
            confirmButton: 'payment-history-close'
        },
        didOpen: () => {
            renderHistoryContent();
            refreshTimer = window.setInterval(refreshHistory, STUDENT_PAYMENT_HISTORY_REFRESH_MS);
        },
        willClose: () => {
            if (refreshTimer) {
                window.clearInterval(refreshTimer);
                refreshTimer = null;
            }
        }
    });
}
