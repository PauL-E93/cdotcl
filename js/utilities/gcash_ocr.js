(() => {
    const OCR_URL = window.GCASH_OCR_SCRIPT_URL || 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

    function ensureLibrary() {
        if (window.Tesseract?.recognize) return Promise.resolve(window.Tesseract);
        if (window.__gcashOcrScriptPromise) return window.__gcashOcrScriptPromise;
        window.__gcashOcrScriptPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = OCR_URL;
            script.async = true;
            script.dataset.gcashOcr = 'true';
            script.onload = () => window.Tesseract?.recognize ? resolve(window.Tesseract) : reject(new Error('OCR library is unavailable.'));
            script.onerror = () => reject(new Error('Unable to load the OCR library.'));
            document.head.appendChild(script);
        });
        return window.__gcashOcrScriptPromise;
    }

    function status(element, message, tone = 'muted') {
        if (!element) return;
        element.textContent = message;
        element.className = `small d-block mt-2 text-${tone}`;
    }

    function normalizeReference(value) {
        return String(value || '').toUpperCase().replace(/[OQ]/g, '0').replace(/[IL]/g, '1').replace(/\D/g, '');
    }

    function extractReference(text) {
        const normalized = String(text || '').replace(/[|]/g, 'I').replace(/\s+/g, ' ');
        const anchored = [...normalized.matchAll(/ref(?:erence)?\s*(?:no|n0|number|#)?\.?\s*[:\-]?\s*([A-Z0-9\s-]{8,30})/gi)]
            .map(match => normalizeReference(match[1]))
            .filter(value => value.length >= 8 && value.length <= 20 && !/^0+$/.test(value));
        if (anchored.length) return anchored.sort((a, b) => Math.abs(a.length - 13) - Math.abs(b.length - 13))[0];
        const fallback = [...normalized.matchAll(/\d[\d\s-]{7,22}\d/g)]
            .map(match => normalizeReference(match[0]))
            .filter(value => value.length >= 8 && value.length <= 20);
        return fallback.sort((a, b) => Math.abs(a.length - 13) - Math.abs(b.length - 13))[0] || '';
    }

    function loadImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error('Unable to read the receipt image.'));
                image.src = reader.result;
            };
            reader.onerror = () => reject(new Error('Unable to read the receipt image.'));
            reader.readAsDataURL(file);
        });
    }

    function cropForReference(image, crop) {
        const sourceX = Math.floor(image.width * crop.x);
        const sourceY = Math.floor(image.height * crop.y);
        const sourceWidth = Math.floor(image.width * crop.width);
        const sourceHeight = Math.floor(image.height * crop.height);
        const scale = crop.scale || 3;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(sourceWidth * scale));
        canvas.height = Math.max(1, Math.floor(sourceHeight * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let index = 0; index < pixels.data.length; index += 4) {
            const gray = (pixels.data[index] * .299) + (pixels.data[index + 1] * .587) + (pixels.data[index + 2] * .114);
            const value = gray > 155 ? 255 : 0;
            pixels.data[index] = value;
            pixels.data[index + 1] = value;
            pixels.data[index + 2] = value;
        }
        context.putImageData(pixels, 0, 0);
        return canvas;
    }

    function bestReferenceCandidate(values) {
        const candidates = values
            .flatMap(value => String(value || '').match(/\d{8,20}/g) || [])
            .filter(value => value.length >= 8 && value.length <= 20);
        return candidates.sort((a, b) => {
            const aExact = a.length === 13 ? 1 : 0;
            const bExact = b.length === 13 ? 1 : 0;
            return bExact - aExact || Math.abs(a.length - 13) - Math.abs(b.length - 13);
        })[0] || '';
    }

    async function detectReferencePrecisely(Tesseract, file, onProgress) {
        const image = await loadImage(file);
        // Current GCash receipts place the 13-digit Ref No. on the left side of
        // the row around the middle of the screenshot. Multiple narrow crops
        // cover both the compact and tall receipt layouts without including
        // the transaction date/time on the right.
        const crops = [
            { x: .225, y: .515, width: .36, height: .065, scale: 6 },
            { x: .07, y: .485, width: .55, height: .075, scale: 4 },
            { x: .05, y: .55, width: .66, height: .11, scale: 3.5 },
            { x: .04, y: .59, width: .67, height: .09, scale: 3.5 }
        ];
        const recognized = [];
        let currentCropIndex = 0;
        const worker = await Tesseract.createWorker('eng', undefined, {
            logger: message => {
                if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
                    onProgress?.(`Reading reference number… ${Math.round(((currentCropIndex + message.progress) / crops.length) * 100)}%`);
                }
            }
        });
        try {
            await worker.setParameters({
                tessedit_char_whitelist: '0123456789',
                tessedit_pageseg_mode: '7',
                preserve_interword_spaces: '1'
            });
            for (let index = 0; index < crops.length; index += 1) {
                currentCropIndex = index;
                const result = await worker.recognize(cropForReference(image, crops[index]));
                const digits = normalizeReference(result?.data?.text || '');
                if (digits.length === 13) return digits;
                recognized.push(digits);
            }
        } finally {
            await worker.terminate();
        }
        return bestReferenceCandidate(recognized);
    }

    function amountValue(value) {
        const match = String(value || '').replace(/[,\s]/g, '').match(/\d+(?:\.\d{1,2})?/);
        const amount = match ? Number(match[0]) : 0;
        return Number.isFinite(amount) && amount > 0 ? amount : null;
    }

    function extractAmount(text) {
        const normalized = String(text || '').replace(/\r/g, '');
        const patterns = [
            /total\s+amount\s+sent\s*[:\-]?\s*(?:PHP|P|₱)?\s*([\d,]+(?:\.\d{1,2})?)/i,
            /\bamount\b\s*[:\-]?\s*(?:PHP|P|₱)?\s*([\d,]+(?:\.\d{1,2})?)/i,
            /(?:PHP|₱)\s*([\d,]+(?:\.\d{1,2})?)/i
        ];
        for (const pattern of patterns) {
            const match = normalized.match(pattern);
            const amount = match ? amountValue(match[1]) : null;
            if (amount !== null) return amount;
        }
        return null;
    }

    function preview(file, wrapper, image) {
        if (!wrapper || !image) return;
        if (!file) {
            wrapper.classList.add('d-none');
            image.removeAttribute('src');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            image.src = reader.result;
            wrapper.classList.remove('d-none');
        };
        reader.readAsDataURL(file);
    }

    window.readGcashReceiptImage = async function readGcashReceiptImage(file, onProgress) {
        const Tesseract = await ensureLibrary();
        const result = await Tesseract.recognize(file, 'eng', {
            logger: message => {
                if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
                    onProgress?.(`Reading receipt… ${Math.round(message.progress * 100)}%`);
                }
            }
        });
        const text = result?.data?.text || '';
        const amount = extractAmount(text);
        const preciseReference = await detectReferencePrecisely(Tesseract, file, onProgress);
        const fallbackReference = extractReference(text);
        const reference = [preciseReference, fallbackReference]
            .find(candidate => /^\d{13}$/.test(candidate || '')) || '';
        return { amount, reference, text };
    };

    window.attachGcashOcrAutoFill = function attachGcashOcrAutoFill(options) {
        const fileInput = document.getElementById(options.fileInputId);
        const actionButton = document.getElementById(options.actionButtonId);
        const amountInput = document.getElementById(options.amountInputId);
        const refInput = document.getElementById(options.refInputId);
        const statusElement = document.getElementById(options.statusId);
        const previewWrapper = document.getElementById(options.previewWrapperId);
        const previewImage = document.getElementById(options.previewImageId);
        const confirmButton = window.Swal?.getConfirmButton?.();
        if (!fileInput || !actionButton || !amountInput || !refInput || !statusElement) return;

        const run = async () => {
            const file = fileInput.files?.[0];
            preview(file, previewWrapper, previewImage);
            if (!file) return status(statusElement, 'Upload the GCash receipt screenshot first.', 'warning');
            if (!/^image\//i.test(file.type || '') && !/\.(png|jpe?g|webp|bmp)$/i.test(file.name || '')) {
                return status(statusElement, 'Choose a valid receipt image.', 'danger');
            }
            statusElement.dataset.ocrBusy = 'true';
            fileInput.disabled = true;
            actionButton.disabled = true;
            if (confirmButton) confirmButton.disabled = true;
            status(statusElement, 'Preparing the receipt reader…', 'primary');
            try {
                const { amount, reference } = await window.readGcashReceiptImage(
                    file,
                    message => status(statusElement, message, 'primary')
                );
                if (amount !== null) amountInput.value = amount.toFixed(2);
                if (reference) refInput.value = reference;
                if (amount !== null && reference) status(statusElement, `Detected ${amount.toFixed(2)} and reference ${reference}. Please verify both.`, 'success');
                else if (amount !== null) status(statusElement, 'Amount detected. Please verify or enter the reference number.', 'warning');
                else if (reference) status(statusElement, 'Reference detected. Please verify the receipt amount.', 'warning');
                else status(statusElement, 'The receipt was unclear. Please enter the amount and reference number manually.', 'warning');
            } catch (error) {
                console.error('GCash OCR failed:', error);
                status(statusElement, 'OCR is unavailable. You may enter the receipt details manually.', 'danger');
            } finally {
                statusElement.dataset.ocrBusy = 'false';
                fileInput.disabled = false;
                actionButton.disabled = false;
                if (confirmButton) confirmButton.disabled = false;
            }
        };
        fileInput.addEventListener('change', run);
        actionButton.addEventListener('click', run);
    };
})();
