const APP_ROOT_URL = new URL('../../', import.meta.url);

export function buildAppUrl(path = '') {
    return new URL(String(path).replace(/^\/+/, ''), APP_ROOT_URL).href;
}
