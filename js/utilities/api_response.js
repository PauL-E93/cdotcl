/**
 * Normalize API responses that arrive as text instead of parsed JSON.
 *
 * Some hosted PHP responses contain a small amount of output before the JSON
 * document. Axios therefore leaves the response as a string. Only discard
 * text when the remaining value is a complete, valid JSON object or array.
 */
export function normalizeApiResponse(payload) {
    if (typeof payload !== 'string') return payload;

    const text = payload.replace(/^\uFEFF/, '').trim();
    if (!text) return payload;

    try {
        return JSON.parse(text);
    } catch (_) {
        // Continue with a guarded recovery attempt below.
    }

    // Do not mistake JavaScript arrays/objects inside InfinityFree's browser
    // verification page (or another HTML error page) for an API response.
    if (looksLikeHtmlResponse(text)) return payload;

    // Hosted PHP can prepend warnings or append diagnostic/hosting output. Find
    // the first complete JSON document without discarding anything unless that
    // exact bounded substring parses successfully.
    for (let start = 0; start < text.length; start += 1) {
        if (text[start] !== '{' && text[start] !== '[') continue;

        const end = findJsonDocumentEnd(text, start);
        if (end < 0) continue;

        try {
            return JSON.parse(text.slice(start, end + 1));
        } catch (_) {
            // The bracketed section was not JSON; keep looking.
        }
    }

    return payload;
}

export function isHostedBrowserChallenge(payload) {
    if (typeof payload !== 'string') return false;
    const text = payload.toLowerCase();
    return text.includes('/aes.js')
        || (text.includes('__test') && text.includes('document.cookie'))
        || text.includes('this site requires javascript to work');
}

function looksLikeHtmlResponse(text) {
    const beginning = text.slice(0, 512).toLowerCase();
    return beginning.includes('<!doctype html')
        || beginning.includes('<html')
        || beginning.includes('<body')
        || isHostedBrowserChallenge(text);
}

function findJsonDocumentEnd(text, start) {
    const stack = [];
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
        const character = text[index];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }

        if (character === '"') {
            inString = true;
        } else if (character === '{' || character === '[') {
            stack.push(character);
        } else if (character === '}' || character === ']') {
            const opening = stack.pop();
            const matches = (opening === '{' && character === '}')
                || (opening === '[' && character === ']');
            if (!matches) return -1;
            if (stack.length === 0) return index;
        }
    }

    return -1;
}

export function getApiErrorMessage(error, fallback) {
    const data = normalizeApiResponse(error?.response?.data);
    return data?.message || data?.error || error?.message || fallback;
}
