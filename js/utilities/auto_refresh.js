export function startAutoRefresh({
    callback,
    intervalMs = 30000,
    runOnStart = false,
    runOnFocus = true,
    pauseWhenHidden = true
} = {}) {
    if (typeof callback !== 'function') {
        return () => {};
    }

    let isRunning = false;

    const execute = async () => {
        if (isRunning) return;
        if (pauseWhenHidden && document.hidden) return;

        isRunning = true;
        try {
            await callback();
        } catch (error) {
            console.error('Auto-refresh callback failed:', error);
        } finally {
            isRunning = false;
        }
    };

    const handleVisibilityChange = () => {
        if (!document.hidden) {
            execute();
        }
    };

    const handleFocus = () => {
        execute();
    };

    if (runOnStart) {
        execute();
    }

    const timerId = window.setInterval(execute, intervalMs);

    if (runOnFocus) {
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('focus', handleFocus);
    }

    const cleanup = () => {
        window.clearInterval(timerId);
        if (runOnFocus) {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('focus', handleFocus);
        }
    };

    window.addEventListener('beforeunload', cleanup, { once: true });
    return cleanup;
}
