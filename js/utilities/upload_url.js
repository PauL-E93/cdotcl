(() => {
const APP_ROOT_URL = new URL('../../', document.currentScript.src);

// Resolve stored uploads independently of the current screen or deployment folder.
window.resolveUploadUrl = function(path) {
    const value = String(path || '').trim().replace(/\\/g, '/');
    if (!value) return '';
    if (/^(?:data:image\/|blob:)/i.test(value)) return value;

    let pathname = value;
    if (/^(?:https?:)?\/\//i.test(value)) {
        const url = new URL(value, APP_ROOT_URL);
        if (url.origin !== APP_ROOT_URL.origin) return url.href;
        pathname = url.pathname;
    }
    const match = pathname.match(/(?:^|\/)uploads\/(employee_profiles|student_profiles|payment_screenshots|payment_methods)\/([^/?#]+)$/);
    if (match) {
        const url = new URL('api/upload_image.php', APP_ROOT_URL);
        url.searchParams.set('path', `uploads/${match[1]}/${decodeURIComponent(match[2])}`);
        return url.href;
    }
    return new URL(value, APP_ROOT_URL).href;
}

})();
