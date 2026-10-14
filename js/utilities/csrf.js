// Attach the session-bound CSRF token to same-origin API writes.
function csrfToken() {
    const cookie = document.cookie.split('; ').find(part => part.startsWith('cdo_csrf='));
    return cookie ? decodeURIComponent(cookie.slice('cdo_csrf='.length)) : '';
}

function protectedWrite(url, method) {
    try {
        const target = new URL(url, location.href);
        return target.origin === location.origin
            && /\/api\//.test(target.pathname)
            && !['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase());
    } catch (_) {
        return false;
    }
}

const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
    const request = new Request(input, init);
    if (!protectedWrite(request.url, request.method)) return nativeFetch(request);
    const headers = new Headers(request.headers);
    const token = csrfToken();
    if (token) headers.set('X-CSRF-Token', token);
    return nativeFetch(new Request(request, { headers }));
};

if (window.axios?.interceptors?.request) {
    window.axios.interceptors.request.use(config => {
        if (protectedWrite(config.url, config.method)) {
            const token = csrfToken();
            if (token) config.headers['X-CSRF-Token'] = token;
        }
        return config;
    });
}
