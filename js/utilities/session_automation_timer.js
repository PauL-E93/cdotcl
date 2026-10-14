const intervalMilliseconds = 60000;
const endpoint = new URL('../../api/session_automation_check.php', import.meta.url).href;
let started = false;

export function initSessionAutomationTimer() {
    if (started) return;
    let role = '';
    try { role = JSON.parse(localStorage.getItem('user') || 'null')?.role_name || ''; }
    catch (_) { return; }
    role = String(role).trim().toLowerCase().replace(/[\s_-]+/g, ' ');
    if (!['owner', 'secretary', 'admin', 'administrator', 'branch admin', 'auditor', 'teacher', 'student'].includes(role)) return;
    const useDeviceClock = ['owner', 'secretary', 'admin', 'administrator', 'branch admin', 'teacher'].includes(role);
    started = true;
    let inFlight = false;
    let lastAttempt = null;
    let timer;
    let stopped = false;

    function stop() {
        stopped = true;
        window.clearInterval(timer);
        document.removeEventListener('visibilitychange', check);
        window.removeEventListener('pageshow', resume);
    }

    async function check() {
        if (stopped || document.hidden || inFlight
            || (lastAttempt !== null && performance.now() - lastAttempt < intervalMilliseconds)) return;
        // A monotonic timer keeps checks running when the laptop clock moves backward.
        lastAttempt = performance.now();
        inFlight = true;
        try {
            const payload = {};
            if (useDeviceClock) {
                const now = new Date();
                const pad = value => String(value).padStart(2, '0');
                // Match Start Session's local date/time, without a UTC conversion.
                payload.client_time = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
            }
            // PHP still applies the saved policy, row locks, notifications, and CSRF checks.
            const { data } = await axios.post(endpoint, payload, { timeout: 60000 });
            if (data.status !== 'success') throw new Error(data.message || 'Session check failed.');
            if (!data.busy && !data.throttled) window.dispatchEvent(new CustomEvent('session-automation-checked', { detail: data }));
            if (Number(data.changed) > 0) window.dispatchEvent(new CustomEvent('session-automation-updated', { detail: data }));
        } catch (error) {
            if ([401, 403].includes(error.response?.status)) stop();
            else console.warn('Session deadline check failed; retrying while the page is active.', error);
        } finally { inFlight = false; }
    }

    function resume(event) {
        if (event.persisted && !stopped) {
            timer = window.setInterval(check, intervalMilliseconds);
            check();
        }
    }
    timer = window.setInterval(check, intervalMilliseconds);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('pageshow', resume);
    window.addEventListener('pagehide', () => window.clearInterval(timer));
    return check();
}
