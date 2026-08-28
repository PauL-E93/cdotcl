const DEFAULT_VISIBLE_SCHEDULE_ROWS = 5;

export function fitScheduleLogToRows(log, visibleRows = DEFAULT_VISIBLE_SCHEDULE_ROWS) {
    if (!log) return;

    const cards = Array.from(log.querySelectorAll('.schedule-log-card'));
    log.classList.remove('schedule-log--scrollable');
    log.style.removeProperty('max-height');
    log.scrollTop = 0;

    if (cards.length <= visibleRows) return;

    requestAnimationFrame(() => {
        const visibleCard = cards[visibleRows - 1];
        if (!visibleCard?.isConnected || !log.isConnected) return;

        const logStyles = window.getComputedStyle(log);
        const bottomPadding = Number.parseFloat(logStyles.paddingBottom) || 0;
        const visibleBottom = visibleCard.getBoundingClientRect().bottom - log.getBoundingClientRect().top;
        log.style.maxHeight = `${Math.ceil(visibleBottom + bottomPadding)}px`;
        log.classList.add('schedule-log--scrollable');
    });
}
