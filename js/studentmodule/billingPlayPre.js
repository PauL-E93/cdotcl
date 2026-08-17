/**
 * PRESCHOOL & PLAYSCHOOL BILLING CONTROLLER 
 * Updated with FIFO logic + Payment History while maintaining original UI Layout
 */

function getStudentReceiptHandler() {
    return typeof window.showPaymentReceipt === 'function'
        ? (receipt) => window.showPaymentReceipt({
            ...receipt,
            copyLabels: ['CUSTOMER COPY']
        })
        : null;
}

function escapePrePlayPaymentDetail(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function resolvePrePlayPaymentQrUrl(qrPath) {
    const value = String(qrPath || '').trim();
    if (!value) return '';
    if (/^(?:https?:|data:|blob:|\/)/i.test(value) || value.startsWith('../')) return value;
    return `../../${value.replace(/^\.\//, '')}`;
}

function buildPrePlayPaymentMethodDetails(method) {
    if (!method) return '';
    const accountName = String(method.account_name || '').trim();
    const accountNumber = String(method.account_number || '').trim();
    const qrUrl = resolvePrePlayPaymentQrUrl(method.qr_code);
    if (!accountName && !accountNumber && !qrUrl) return '';

    return `<div class="preplay-payment-method-details${qrUrl ? ' has-qr' : ''}" aria-label="${escapePrePlayPaymentDetail(method.payment_method || 'Payment')} account details">
        <div class="preplay-payment-method-copy">
            <span class="preplay-payment-method-eyebrow"><i class="bi bi-shield-check" aria-hidden="true"></i> Send payment to</span>
            <h4>${escapePrePlayPaymentDetail(method.payment_method || 'Payment account')}</h4>
            <dl>
                ${accountName ? `<div><dt>Account name</dt><dd>${escapePrePlayPaymentDetail(accountName)}</dd></div>` : ''}
                ${accountNumber ? `<div><dt>Account number</dt><dd><span>${escapePrePlayPaymentDetail(accountNumber)}</span><button type="button" id="preplayPaymentCopyAccount" class="preplay-payment-copy-account"><i class="bi bi-copy" aria-hidden="true"></i><span>Copy</span></button></dd></div>` : ''}
            </dl>
            <p><i class="bi bi-info-circle" aria-hidden="true"></i> Verify the account details before sending your payment.</p>
        </div>
        ${qrUrl ? `<button type="button" class="preplay-payment-qr" id="preplayPaymentOpenQr" title="View larger QR code"><img src="${escapePrePlayPaymentDetail(qrUrl)}" alt="${escapePrePlayPaymentDetail(method.payment_method || 'Payment')} QR code"><span><i class="bi bi-arrows-fullscreen" aria-hidden="true"></i> View larger</span></button>` : ''}
    </div>`;
}

function bindPrePlayPaymentAccountCopy(buttonId, accountNumber) {
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

function openPrePlayPaymentQrModal(method) {
    const qrUrl = resolvePrePlayPaymentQrUrl(method?.qr_code);
    if (!qrUrl) return;
    document.querySelector('.preplay-payment-qr-modal')?.remove();
    const modal = document.createElement('div');
    modal.className = 'preplay-payment-qr-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'preplayPaymentQrModalTitle');
    modal.innerHTML = `<div class="preplay-payment-qr-dialog">
        <button type="button" class="preplay-payment-qr-close-icon" aria-label="Close QR code"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
        <h3 id="preplayPaymentQrModalTitle">${escapePrePlayPaymentDetail(method.payment_method || 'Payment')}</h3>
        <img src="${escapePrePlayPaymentDetail(qrUrl)}" alt="${escapePrePlayPaymentDetail(method.payment_method || 'Payment')} QR code">
        <button type="button" class="preplay-payment-qr-close-button">Close</button>
    </div>`;
    document.body.appendChild(modal);

    const closeModal = () => {
        document.removeEventListener('keydown', handleKeydown, true);
        modal.remove();
        document.getElementById('preplayPaymentOpenQr')?.focus();
    };
    const handleKeydown = event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            closeModal();
        }
    };
    modal.addEventListener('click', event => {
        if (event.target === modal || event.target.closest('.preplay-payment-qr-close-icon, .preplay-payment-qr-close-button')) closeModal();
    });
    document.addEventListener('keydown', handleKeydown, true);
    modal.querySelector('.preplay-payment-qr-close-icon')?.focus();
}

function bindPrePlayPaymentQrModal(method) {
    document.getElementById('preplayPaymentOpenQr')?.addEventListener('click', () => openPrePlayPaymentQrModal(method));
}

function getStudentModuleImportUrl(relativePath) {
    return new URL(relativePath, window.location.href).href;
}

function redirectToStudentPrePlayEnrollment(enrollmentId) {
    sessionStorage.setItem('studentPendingPrePlayEnrollmentCompletion', JSON.stringify({ enrollmentId }));
    window.location.href = './enrollement_pre_play.html';
}

async function ensureStudentPrePlayEnrollmentHelpers() {
    if (typeof window.openPendingPrePlayEnrollmentCompletion === 'function') {
        return;
    }

    await import(getStudentModuleImportUrl('../../js/studentmodule/pre_play_enrollment.js'));
}

window.openStudentPrePlayIncompleteEnrollment = async function(enrollmentId) {
    if (!window.location.pathname.includes('/student/enrollement_pre_play.html')) {
        redirectToStudentPrePlayEnrollment(enrollmentId);
        return;
    }

    await ensureStudentPrePlayEnrollmentHelpers();

    if (typeof window.openPendingPrePlayEnrollmentCompletion === 'function') {
        return window.openPendingPrePlayEnrollmentCompletion(enrollmentId);
    }

    Swal.fire('Error', 'Enrollment completion is not available right now.', 'error');
};

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

window.openBillingPlayPreModal = async function(enrollmentId, showPayment = true) {
    Swal.fire({
        title: 'Loading Billing Details...',
        didOpen: () => Swal.showLoading()
    });

    try {
        const paymentApiBase = '../../api/student/payment.php';
        const enrollmentApiBase = '../../api/student/enrollment.php';

        const [billingRes, methodsRes, paymentsRes, enrollmentRes] = await Promise.all([
            axios.get(`${paymentApiBase}?operation=getBillingDetails&enrollment_id=${enrollmentId}`),
            axios.get(`${paymentApiBase}?operation=getPaymentMethods`),
            axios.get(`${paymentApiBase}?operation=getPaymentHistory&enrollment_details_id=${enrollmentId}`).catch(err => ({ data: { status: 'error', history: [] } })),
            axios.get(`${enrollmentApiBase}?operation=getEnrollmentDetails&id=${enrollmentId}`).catch(err => ({ data: { status: 'error', data: { details: { status: 'unknown' } } } }))
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
        const totalPaymentsMade = paymentsHistory
            .filter(p => p.payment_status === 'Received')
            .reduce((sum, p) => sum + parseFloat(p.amount_paid || 0), 0);

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
        renderBillingPlayPreModal(enrollmentData, methodsRes.data.data, enrollmentId, miscProducts, totalPaymentsMade, showPayment, enrollmentStatus, paymentsHistory, enrollmentDetails);
    } catch (err) {
        console.error(err);
        Swal.close();
        Swal.fire("Error", "Network error occurred.", "error");
    }
};

function ensureStudentPrePlayBillingResponsiveStyles() {
    if (document.getElementById('studentPrePlayBillingResponsiveStyles')) return;

    const styles = document.createElement('style');
    styles.id = 'studentPrePlayBillingResponsiveStyles';
    styles.textContent = `
        .preplay-billing-modal-container{padding:6px}
        .preplay-billing-popup{--pp-pink:#e85d88;--pp-pink-dark:#d94b78;--pp-pink-soft:#fff4f7;--pp-pink-border:#f4c4d3;--pp-ink:#1d2a3b;--pp-muted:#667085;width:min(1000px,calc(100vw - 20px))!important;max-width:1000px!important}
        .preplay-billing-popup .swal2-html-container{margin-inline:1em}
        .preplay-timeline-content{display:grid;grid-template-columns:minmax(150px,1fr) minmax(270px,1.25fr) auto;align-items:center;gap:16px;min-width:0;flex:1}
        .preplay-timeline-main{min-width:0}
        .preplay-timeline-title{font-weight:700;overflow-wrap:anywhere}
        .preplay-timeline-metrics{display:grid;grid-template-columns:repeat(2,minmax(115px,1fr));gap:12px}
        .preplay-timeline-metric{min-width:0;padding:9px 12px;border-radius:10px;background:#f8fafc;text-align:right}
        .preplay-timeline-metric-label{margin-bottom:2px;color:#6b7280;font-size:.78rem}
        .preplay-timeline-metric-value{font-weight:750;line-height:1.2;overflow-wrap:anywhere}
        .preplay-timeline-status{justify-self:end}
        .preplay-billing-popup .payment-timeline-indicator{align-self:stretch}
        .preplay-billing-popup .payment-timeline-connector{flex:1;min-height:2.75rem}
        .preplay-payment-card{padding:22px 24px;margin-top:18px;border:1px solid var(--pp-pink-border);border-radius:14px;background:#fff;box-shadow:0 3px 9px rgba(90,44,59,.06)}
        .preplay-payment-title{display:flex;align-items:center;gap:12px;margin:0 0 18px;color:var(--pp-pink);font-size:1.35rem;font-weight:750}
        .preplay-payment-title-icon{display:grid;flex:0 0 38px;width:38px;height:38px;place-items:center;border-radius:10px;color:var(--pp-pink);background:#fdeaf0;font-size:1.05rem}
        .preplay-payment-receipt-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:14px}
        .preplay-payment-receipt-copy{color:var(--pp-muted);font-size:.94rem;line-height:1.5}
        .preplay-payment-receipt-copy strong{display:block;margin-bottom:5px;color:var(--pp-ink);font-size:1rem}
        .preplay-gcash-badge{display:inline-flex;padding:3px 10px;margin-left:7px;border:1px solid var(--pp-pink-border);border-radius:999px;color:var(--pp-pink);background:var(--pp-pink-soft);font-size:.78rem;font-weight:700}
        .preplay-payment-read-receipt{display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;gap:9px;min-height:50px;padding:0 20px;border:1px solid var(--pp-pink);border-radius:9px;color:var(--pp-pink);background:#fff;font-weight:700}
        .preplay-payment-read-receipt:hover{color:var(--pp-pink-dark);background:var(--pp-pink-soft)}
        .preplay-payment-method-details{display:grid;grid-template-columns:1fr;gap:22px;align-items:center;margin-bottom:20px;padding:20px;border:1px solid #f1c4d2;border-radius:12px;background:linear-gradient(135deg,#fff8fa,#fff)}
        .preplay-payment-method-details.has-qr{grid-template-columns:minmax(0,1fr) minmax(170px,220px)}
        .preplay-payment-method-eyebrow{display:inline-flex;align-items:center;gap:7px;margin-bottom:7px;color:var(--pp-pink);font-size:.78rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase}
        .preplay-payment-method-copy h4{margin:0 0 14px;color:var(--pp-ink);font-size:1.15rem;font-weight:750}
        .preplay-payment-method-copy dl{display:grid;gap:10px;margin:0}
        .preplay-payment-method-copy dl div{display:grid;grid-template-columns:118px minmax(0,1fr);gap:12px;align-items:center}
        .preplay-payment-method-copy dt{color:var(--pp-muted);font-size:.8rem;font-weight:650}
        .preplay-payment-method-copy dd{display:flex;align-items:center;gap:9px;min-width:0;margin:0;color:var(--pp-ink);font-weight:750;overflow-wrap:anywhere}
        .preplay-payment-method-copy p{display:flex;gap:7px;margin:14px 0 0;color:var(--pp-muted);font-size:.79rem}
        .preplay-payment-copy-account{display:inline-flex;flex:0 0 auto;align-items:center;gap:5px;padding:5px 9px;border:1px solid #edb5c6;border-radius:7px;color:var(--pp-pink-dark);background:#fff;font-size:.75rem;font-weight:750}
        .preplay-payment-copy-account:hover,.preplay-payment-copy-account.is-copied{background:#fdeaf0}
        .preplay-payment-qr{display:grid;justify-items:center;gap:8px;padding:10px;border:1px solid #efd3dc;border-radius:11px;color:var(--pp-pink-dark);background:#fff;font-size:.78rem;font-weight:750;text-decoration:none}
        .preplay-payment-qr img{width:100%;max-width:190px;max-height:190px;border-radius:7px;object-fit:contain}
        .preplay-payment-qr:hover{color:var(--pp-pink-dark);border-color:var(--pp-pink)}
        .preplay-payment-qr-modal{position:fixed;inset:0;z-index:20000;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.58);backdrop-filter:blur(2px)}
        .preplay-payment-qr-dialog{position:relative;display:grid;justify-items:center;width:min(640px,calc(100vw - 28px));max-height:calc(100vh - 28px);padding:30px 30px 26px;overflow:auto;border-radius:10px;background:#fff;box-shadow:0 24px 70px rgba(15,23,42,.3)}
        .preplay-payment-qr-dialog h3{margin:0 42px 22px;color:#4a4a4a;font-size:2rem;font-weight:750;text-align:center}
        .preplay-payment-qr-dialog img{display:block;max-width:100%;max-height:65vh;border-radius:10px;object-fit:contain}
        .preplay-payment-qr-close-icon{position:absolute;top:14px;right:14px;display:grid;width:36px;height:36px;place-items:center;border:0;border-radius:50%;color:#667085;background:transparent}
        .preplay-payment-qr-close-icon:hover{background:#f2f4f7}
        .preplay-payment-qr-close-button{min-width:92px;min-height:46px;margin-top:24px;padding:0 22px;border:0;border-radius:7px;color:#fff;background:var(--pp-pink);font-weight:750}
        .preplay-payment-qr-close-button:hover{background:var(--pp-pink-dark)}
        .preplay-payment-upload-zone{position:relative;display:flex;min-height:174px;align-items:center;justify-content:center;padding:24px;overflow:hidden;border:2px dashed var(--pp-pink);border-radius:11px;background:#fff8fa;text-align:center;cursor:pointer}
        .preplay-payment-upload-zone:hover{background:#fff0f5}
        .preplay-payment-upload-zone input[type=file]{position:absolute;inset:0;width:100%;height:100%;cursor:pointer;opacity:0}
        .preplay-payment-upload-copy{pointer-events:none}
        .preplay-payment-upload-copy i{display:block;margin-bottom:9px;color:var(--pp-pink);font-size:2.7rem}
        .preplay-payment-upload-title{display:block;color:var(--pp-ink);font-size:1.05rem;font-weight:750}
        .preplay-payment-upload-subtitle{display:block;margin-top:8px;color:var(--pp-muted);font-size:.92rem}
        .preplay-payment-file-help,.preplay-payment-field-help{display:block;margin-top:7px;color:var(--pp-muted);font-size:.82rem}
        .preplay-payment-preview{margin-top:13px;padding:10px;border:1px solid #f1d4de;border-radius:11px;background:#fff9fb;text-align:center}
        .preplay-payment-preview img{max-height:280px;object-fit:contain}
        .preplay-payment-fields{display:grid;gap:15px;margin-top:14px}
        .preplay-payment-field label{margin-bottom:7px;color:var(--pp-ink);font-size:.94rem;font-weight:700}
        .preplay-payment-field .form-control,.preplay-payment-field .input-group-text{min-height:50px;border-color:#d7dde6}
        .preplay-payment-field .form-control:focus{border-color:#ef9bb5;box-shadow:0 0 0 .2rem rgba(232,93,136,.13)}
        .preplay-payment-field .input-group-text{min-width:58px;justify-content:center;background:#f8f9fb;font-weight:700}
        @media(max-width:767.98px){
            .preplay-billing-popup{width:calc(100vw - 12px)!important;max-width:calc(100vw - 12px)!important;padding:0!important;border-radius:14px!important}
            .preplay-billing-popup .swal2-title{padding:24px 44px 14px 16px;font-size:1.3rem;line-height:1.2}
            .preplay-billing-popup .swal2-html-container{margin:0;padding:0 10px;overflow:hidden}
            .preplay-billing-popup .billing-container>.card,.preplay-billing-popup .billing-container>.row{margin-bottom:12px!important}
            .preplay-billing-popup .card{border-radius:14px!important}
            .preplay-billing-popup .card-body.p-4{padding:16px!important}
            .preplay-billing-popup .payment-timeline-step{gap:10px;margin-bottom:12px}
            .preplay-billing-popup .payment-timeline-indicator{width:2.25rem}
            .preplay-billing-popup .payment-timeline-marker{width:2.15rem;height:2.15rem}
            .preplay-timeline-content{display:block;padding:12px;overflow:hidden;border:1px solid #e5e7eb;border-radius:12px;background:#fff}
            .preplay-timeline-main{padding-bottom:10px;border-bottom:1px solid #edf0f3}
            .preplay-timeline-title{font-size:1rem}
            .preplay-timeline-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}
            .preplay-timeline-metric{padding:9px 8px;text-align:left}
            .preplay-timeline-metric-label{font-size:.72rem}
            .preplay-timeline-metric-value{font-size:.9rem}
            .preplay-timeline-status{justify-self:auto;margin-top:10px}
            .preplay-timeline-status .badge{display:inline-flex;padding:6px 10px}
            .preplay-payment-card{padding:18px 14px;margin-top:14px}
            .preplay-payment-title{gap:10px;margin-bottom:16px;font-size:1.2rem}
            .preplay-payment-receipt-heading{display:block}
            .preplay-payment-method-details,.preplay-payment-method-details.has-qr{grid-template-columns:1fr;gap:16px;padding:16px}
            .preplay-payment-method-copy dl div{grid-template-columns:1fr;gap:3px}
            .preplay-payment-qr{width:min(220px,100%);justify-self:center}
            .preplay-payment-qr-modal{padding:10px}
            .preplay-payment-qr-dialog{width:calc(100vw - 20px);max-height:calc(100vh - 20px);padding:24px 16px 20px}
            .preplay-payment-qr-dialog h3{margin-bottom:18px;font-size:1.55rem}
            .preplay-payment-qr-dialog img{max-height:68vh}
            .preplay-payment-read-receipt{width:100%;margin-top:14px}
            .preplay-payment-upload-zone{min-height:160px;padding:20px 12px}
            .preplay-payment-upload-subtitle{font-size:.84rem}
            .preplay-billing-popup .billing-container .row.g-3{--bs-gutter-y:12px}
            .preplay-billing-popup .billing-container .d-flex.justify-content-between{gap:12px}
            .preplay-billing-popup .billing-container .d-flex.justify-content-between>*{min-width:0;overflow-wrap:anywhere}
            .preplay-billing-popup .swal2-actions{width:100%;margin:0;padding:14px 10px 18px}
            .preplay-billing-popup .swal2-confirm,.preplay-billing-popup .swal2-cancel{width:100%;margin:0;min-height:48px}
        }
        @media(max-width:380px){
            .preplay-timeline-metrics{grid-template-columns:1fr}
            .preplay-billing-popup .payment-timeline-indicator{width:2rem}
            .preplay-billing-popup .payment-timeline-marker{width:2rem;height:2rem}
            .preplay-billing-popup .payment-timeline-step{gap:7px}
        }
    `;
    document.head.appendChild(styles);
}

function renderBillingPlayPreModal(data, paymentMethods, enrollmentId, miscProducts = [], totalPaymentsMade = 0, showPayment = true, enrollmentStatus = 'unknown', paymentsHistory = [], enrollmentDetails = {}) {
    ensureStudentPrePlayBillingResponsiveStyles();
    const isIncompleteEnrollment = String(enrollmentStatus || '').toLowerCase() === 'incomplete';
    // 1. DATA CALCULATIONS
    // The API's schedule amount is billing_schedule.total_amount, which includes
    // the calculated penalty. Do not replace it with original_amount.
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
    // Keep the monthly timeline focused on the original tuition amount and
    // base balance. The penalty stays included in Summary → Total Due Now.
    const getBillingBaseAmount = item => {
        const originalAmount = Number(item?.original_amount);
        if (Number.isFinite(originalAmount) && originalAmount > 0) {
            return originalAmount;
        }
        return Math.max(0, getBillingAmount(item) - Number(item?.penalty_amount || 0));
    };
    const getBillingBasePaid = item => {
        if (item?.base_paid_amount !== undefined && item?.base_paid_amount !== null) {
            return Math.max(0, Number(item.base_paid_amount) || 0);
        }
        return Math.max(0, getBillingPaid(item) - Number(item?.penalty_paid_amount ?? item?.penalty_paid ?? 0));
    };
    const getBillingBaseRemaining = item => Math.max(0,
        getBillingBaseAmount(item) - getBillingBasePaid(item)
    );

    const dueScheduleItems = allBillingItems.filter(item => {
        const status = (item.status || '').toLowerCase();
        return status === 'unpaid' || status === 'partial';
    });
    const monthOneBill = monthlyBilling[0] || null;
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
    const firstDueItem = firstDueBill ? {
        type: firstDueLabelParts.join(' + '),
        remaining: getBillingRemaining(firstDueBill) + (isFirstMonthDue ? miscRemaining : 0)
    } : null;
    const initialPaymentAmount = firstDueItem ? firstDueItem.remaining : 0;
    const balance = parseFloat(data.balance || 0) || dueScheduleItems.reduce((sum, item) => sum + getBillingAmount(item), 0);
    const maxPayableAmount = balance;
    const isFullyPaid = balance <= 0;
    const pendingPayments = paymentsHistory.filter(p => p.payment_status === 'Pending');
    const hasPendingPayment = pendingPayments.length > 0;
    const pendingPaymentTotal = pendingPayments.reduce((sum, p) => sum + parseFloat(p.amount_paid || 0), 0);

    // 2. UI COMPONENTS
    const gcashMethod = paymentMethods.find(pm => (pm.payment_method || '').toLowerCase().includes('gcash'));
    const gcashMethodId = gcashMethod ? gcashMethod.payment_method_id : '';
    const gcashPaymentDetails = buildPrePlayPaymentMethodDetails(gcashMethod);

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
                <div class="preplay-timeline-content">
                    <div class="preplay-timeline-main">
                        <div class="preplay-timeline-title">${m.billing_type}</div>
                        <div class="small text-muted">${dueDate}</div>
                    </div>
                    <div class="preplay-timeline-metrics">
                        <div class="preplay-timeline-metric">
                            <div class="preplay-timeline-metric-label">${amountLabel}</div>
                            <div class="preplay-timeline-metric-value text-success">PHP ${formatCurrency(amount)}</div>
                        </div>
                        <div class="preplay-timeline-metric">
                            <div class="preplay-timeline-metric-label">Balance</div>
                            <div class="preplay-timeline-metric-value ${remaining > 0 ? 'text-danger' : 'text-success'}">PHP ${formatCurrency(remaining)}</div>
                        </div>
                    </div>
                    <div class="preplay-timeline-status">
                        <span class="badge ${badgeClass} text-uppercase">${label}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    const miscRows = itemizedMiscProducts.length > 0 ? itemizedMiscProducts.map(item => `
        <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
            <div class="text-muted">${item.label}</div>
            <div class="fw-bold text-danger">PHP ${formatCurrency(item.amount)}</div>
        </div>
    `).join('') : miscBilling.map(item => `
        <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
            <div class="text-muted">Program Item Fees</div>
            <div class="fw-bold text-danger">PHP ${formatCurrency(item.amount || item.total_amount)}</div>
        </div>
    `).join('');
    const registrationRows = registrationBilling.map(item => `
        <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
            <div class="text-muted">${item.billing_type}</div>
            <div class="fw-bold text-danger">PHP ${formatCurrency(item.amount || item.total_amount)}</div>
        </div>
    `).join('');

    const paymentSection = isIncompleteEnrollment ? `
        <div class="alert alert-warning text-center mx-3">
            <i class="bi bi-exclamation-triangle"></i> This enrollment is incomplete. Please complete the enrollment first.
        </div>
    ` : hasPendingPayment ? `
        <div class="alert alert-warning text-center mx-3">
            Your GCash payment of ${formatCurrency(pendingPaymentTotal)} is pending admin review.
        </div>
    ` : (showPayment && !isFullyPaid) ? `
        <section class="preplay-payment-card" aria-labelledby="preplayMakePaymentTitle">
            <h3 class="preplay-payment-title" id="preplayMakePaymentTitle">
                <span class="preplay-payment-title-icon"><i class="bi bi-credit-card" aria-hidden="true"></i></span>
                Make Payment
            </h3>

            ${gcashPaymentDetails}

            <div class="preplay-payment-receipt-heading">
                <div class="preplay-payment-receipt-copy">
                    <strong>Payment Receipt <span class="preplay-gcash-badge">GCash</span></strong>
                    Upload your GCash payment screenshot so we can read the amount<br class="d-none d-md-block"> and reference number automatically.
                </div>
                <button type="button" class="preplay-payment-read-receipt" id="modalPaymentRunOcr">
                    <i class="bi bi-bounding-box" aria-hidden="true"></i> Read Receipt
                </button>
            </div>

            <label class="preplay-payment-upload-zone" for="modalPaymentScreenshot">
                <input type="file" id="modalPaymentScreenshot" accept="image/jpeg,image/png,.jpg,.jpeg,.png" required>
                <span class="preplay-payment-upload-copy">
                    <i class="bi bi-cloud-arrow-up" aria-hidden="true"></i>
                    <span class="preplay-payment-upload-title">Upload GCash screenshot</span>
                    <span class="preplay-payment-upload-subtitle" id="preplayPaymentFilename">Drag and drop your file here, or click to browse</span>
                </span>
            </label>
            <small class="preplay-payment-file-help">Supports JPG, PNG files up to 10MB.</small>
            <small id="modalPaymentOcrStatus" class="small text-muted d-block mt-1">
                Upload the GCash screenshot and we will read the paid amount and reference number for you.
            </small>
            <div id="modalPaymentPreviewWrapper" class="preplay-payment-preview d-none">
                <img id="modalPaymentPreviewImage" alt="GCash receipt preview" class="img-fluid rounded-2">
            </div>

            <div class="preplay-payment-fields">
                <div class="preplay-payment-field">
                    <label class="form-label" for="modalPaymentAmount">Payment Amount <span class="text-danger" aria-hidden="true">*</span></label>
                    <div class="input-group">
                        <span class="input-group-text">&#8369;</span>
                        <input type="number" class="form-control" id="modalPaymentAmount" value="${initialPaymentAmount.toFixed(2)}" max="${maxPayableAmount}" step="0.01" data-max-balance="${maxPayableAmount}">
                    </div>
                    <small class="preplay-payment-field-help"><em>Maximum: &#8369;${formatCurrency(maxPayableAmount)}</em></small>
                </div>
                <div class="preplay-payment-field" id="referenceContainer">
                    <label class="form-label" for="modalReferenceNo">GCash Reference Number <span class="text-danger" aria-hidden="true">*</span></label>
                    <input type="text" class="form-control" id="modalReferenceNo" placeholder="Enter GCash reference number">
                    <small class="preplay-payment-field-help"><em>Required for payment verification. You can still correct the number manually if needed.</em></small>
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
                            ${registrationRows}${miscProducts.length > 0 ? miscRows : (registrationRows ? '' : `<div class="text-muted small">No other fees.</div>`)}
                            <div class="d-flex justify-content-between align-items-center border-top pt-3 mt-3">
                                <div class="fw-bold">Total</div>
                                <div class="fw-bold text-danger">₱${formatCurrency(otherFeeTotal)}</div>
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
                <div class="text-muted small"><i class="bi bi-eye"></i> Billing statement view only.</div>
            </div>

            ${paymentSection}
        </div>`;

    // SweetAlert initialization remains the same...
    Swal.fire({
        title: '<span class="fw-bold text-secondary">Preschool / Playschool Billing</span>',
        html: html,
        width: '1000px',
        showCloseButton: true,
        showCancelButton: showPayment && !isFullyPaid && !hasPendingPayment && !isIncompleteEnrollment,
        confirmButtonText: isIncompleteEnrollment
            ? 'pls complete the enrollment'
            : ((showPayment && !isFullyPaid && !hasPendingPayment) ? 'Confirm Payment' : 'Close'),
        confirmButtonColor: '#e85d88',
        cancelButtonText: '<i class="bi bi-x-circle" aria-hidden="true"></i> Cancel',
        cancelButtonColor: '#6c757d',
        reverseButtons: true,
        customClass: {
            container: 'preplay-billing-modal-container',
            popup: 'preplay-billing-popup'
        },
        didOpen: () => {
            const paymentInput = document.getElementById('modalPaymentAmount');
            const maxBalance = parseFloat(paymentInput?.dataset.maxBalance || 0);

            paymentInput?.addEventListener('input', function() {
                const val = parseFloat(this.value) || 0;
                if (val > maxBalance) {
                    this.value = maxBalance.toFixed(2);
                }
            });

            if (!isIncompleteEnrollment && showPayment && !isFullyPaid && !hasPendingPayment) {
                bindPrePlayPaymentAccountCopy('preplayPaymentCopyAccount', gcashMethod?.account_number);
                bindPrePlayPaymentQrModal(gcashMethod);
                const screenshotInput = document.getElementById('modalPaymentScreenshot');
                const filename = document.getElementById('preplayPaymentFilename');
                if (screenshotInput && filename) {
                    screenshotInput.addEventListener('change', () => {
                        filename.textContent = screenshotInput.files?.[0]?.name || 'Drag and drop your file here, or click to browse';
                    });
                }

                attachGcashOcrAutoFill({
                    fileInputId: 'modalPaymentScreenshot',
                    actionButtonId: 'modalPaymentRunOcr',
                    amountInputId: 'modalPaymentAmount',
                    refInputId: 'modalReferenceNo',
                    statusId: 'modalPaymentOcrStatus',
                    previewWrapperId: 'modalPaymentPreviewWrapper',
                    previewImageId: 'modalPaymentPreviewImage'
                });
            }
        },
        preConfirm: () => {
            if (isIncompleteEnrollment || !showPayment || isFullyPaid || hasPendingPayment) return true;
            const amount = parseFloat(document.getElementById('modalPaymentAmount').value);
            const screenshotFile = document.getElementById('modalPaymentScreenshot')?.files?.[0] || null;
            const ref = document.getElementById('modalReferenceNo')?.value.trim() || '';
            const ocrBusy = document.getElementById('modalPaymentOcrStatus')?.dataset.ocrBusy === 'true';
            if (!amount || amount <= 0) { Swal.showValidationMessage('Enter valid amount'); return false; }
            if (!gcashMethodId) { Swal.showValidationMessage('GCash payment method is not available'); return false; }
            if (!screenshotFile) { Swal.showValidationMessage('Upload the GCash payment screenshot first'); return false; }
            if (screenshotFile.size > 10 * 1024 * 1024) { Swal.showValidationMessage('Please upload a JPG or PNG receipt no larger than 10MB'); return false; }
            if (ocrBusy) { Swal.showValidationMessage('OCR is still reading the screenshot. Please wait a moment.'); return false; }
            if (!ref) { Swal.showValidationMessage('Enter GCash reference number'); return false; }
            return { amount, method: gcashMethodId, ref, screenshotFile };
        }
    }).then((result) => {
        if (!result.isConfirmed) {
            return;
        }

        if (isIncompleteEnrollment) {
            window.openStudentPrePlayIncompleteEnrollment(enrollmentId);
            return;
        }

        if (showPayment && !isFullyPaid && !hasPendingPayment) {
            const formData = new FormData();
            formData.append('operation', 'processPayment');
            formData.append('json', JSON.stringify({
                enrollment_id: enrollmentId,
                amount: result.value.amount,
                method: result.value.method,
                ref: result.value.ref
            }));
            if (result.value.screenshotFile) {
                formData.append('payment_screenshot', result.value.screenshotFile);
            }

            axios.post('../../api/student/payment.php', formData).then((res) => {
                if (res.data.status === 'success') {
                    const paidAmount = parseFloat(result.value.amount || 0);
                    const newBalance = Math.max(balance - paidAmount, 0);
                    const receiptData = {
                        enrollmentId,
                        studentName: data.student_name,
                        programName: data.program_name,
                        programType: data.program_type,
                        paymentKind: firstDueItem && paidAmount >= firstDueItem.remaining ? 'Full Payment' : 'Partial Payment',
                        paymentType: firstDueItem && paidAmount >= firstDueItem.remaining ? 'Full Payment' : 'Partial Payment',
                        paymentFor: firstDueItem ? firstDueItem.type : 'Enrollment Payment',
                        paymentMethod: 'GCash',
                        referenceNo: result.value.ref || null,
                        paymentScreenshotPath: res.data.payment_screenshot_path || null,
                        receiptNo: res.data.receipt_id || null,
                        amountPaid: paidAmount,
                        balance: newBalance,
                        totalAmount: paidAmount,
                        lineItems: Array.isArray(res.data.line_items) ? res.data.line_items : [],
                        paymentDate: new Date()
                    };

                    Swal.fire('Success', res.data.message || 'Payment submitted for admin review.', 'success')
                        .then(() => {
                            const receiptHandler = getStudentReceiptHandler();
                            if (typeof receiptHandler === 'function') {
                                return receiptHandler(receiptData);
                            }
                        })
                        .then(() => {
                            window.dispatchEvent(new CustomEvent('payment-status-updated', {
                                detail: { scope: 'preplay', source: 'student-payment-submit' }
                            }));
                        })
                        .then(() => {
                            if (typeof window.loadEnrollments === 'function') {
                                window.loadEnrollments();
                            }
                        });
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
