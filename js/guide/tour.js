let closeActiveTour;

function loadStyles() {
    if (document.getElementById('page-guide-styles')) return document.getElementById('page-guide-styles');
    const link = document.createElement('link');
    link.id = 'page-guide-styles';
    link.rel = 'stylesheet';
    link.href = new URL('./tour.css?v=20261022-dashboard-guide', import.meta.url).href;
    document.head.appendChild(link);
    return link;
}

function resolveTarget(step) {
    if (step.available && !step.available()) return null;
    for (const selector of [step.target, step.fallback].filter(Boolean)) {
        const element = Array.from(document.querySelectorAll(selector)).find(node =>
            node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' &&
            !node.matches(':disabled') && !node.closest('[hidden], [aria-hidden="true"], [aria-disabled="true"], .disabled')
        );
        if (element) return { element, fallback: selector === step.fallback };
    }
    return null;
}

export function startTour(definitions, returnFocus = document.activeElement, options = {}) {
    closeActiveTour?.();
    const stylesheet = loadStyles();
    const steps = definitions.filter(step => resolveTarget(step));
    if (!steps.length) return;
    const root = document.createElement('div');
    root.className = 'page-guide';
    root.innerHTML = `<div class="page-guide-spotlight"></div>
        <section class="page-guide-card" role="dialog" aria-modal="true" aria-labelledby="page-guide-title" aria-describedby="page-guide-description" tabindex="-1">
            <div class="page-guide-progress" aria-hidden="true"></div>
            <p class="page-guide-count" aria-live="polite"></p>
            <h2 id="page-guide-title"></h2><p id="page-guide-description"></p>
            <div class="page-guide-controls"><button type="button" data-guide="skip">Skip tour</button><div><button type="button" data-guide="back">Back</button><button type="button" data-guide="next">Next</button></div></div>
        </section>`;
    const background = Array.from(document.body.children).map(element => [element, element.inert]);
    background.forEach(([element]) => { element.inert = true; });
    document.body.appendChild(root);
    const card = root.querySelector('.page-guide-card');
    const spotlight = root.querySelector('.page-guide-spotlight');
    const back = root.querySelector('[data-guide="back"]');
    const next = root.querySelector('[data-guide="next"]');
    let index = 0;
    let frame;

    function position() {
        const resolved = resolveTarget(steps[index]);
        root.querySelector('#page-guide-description').textContent = resolved?.fallback && steps[index].fallbackDescription ? steps[index].fallbackDescription : steps[index].description;
        const width = document.documentElement.clientWidth;
        const height = window.innerHeight;
        const rect = resolved?.element.getBoundingClientRect();
        const left = rect ? Math.max(8, rect.left - 6) : width / 2;
        const top = rect ? Math.max(8, rect.top - 6) : height / 2;
        const right = rect ? Math.min(width - 8, rect.right + 6) : left;
        const bottom = rect ? Math.min(height - 8, rect.bottom + 6) : top;
        Object.assign(spotlight.style, { left: `${left}px`, top: `${top}px`, width: `${Math.max(0, right - left)}px`, height: `${Math.max(0, bottom - top)}px` });
        const cardWidth = card.offsetWidth;
        const cardHeight = card.offsetHeight;
        let x = Math.min(Math.max(12, left), width - cardWidth - 12);
        let y = bottom + 16;
        if (y + cardHeight > height - 12) {
            if (top - cardHeight - 16 >= 12) y = top - cardHeight - 16;
            else if (left - cardWidth - 16 >= 12) { x = left - cardWidth - 16; y = top; }
            else if (right + cardWidth + 16 < width - 12) { x = right + 16; y = top; }
            else y = height - cardHeight - 12;
        }
        card.style.left = `${Math.max(12, x)}px`;
        card.style.top = `${Math.max(12, Math.min(y, height - cardHeight - 12))}px`;
    }

    function schedulePosition() {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(position);
    }

    function onResize() {
        options.onStep?.(steps[index]);
        schedulePosition();
    }

    function showStep() {
        const step = steps[index];
        options.onStep?.(step);
        root.querySelector('#page-guide-title').textContent = step.title;
        root.querySelector('#page-guide-description').textContent = step.description;
        root.querySelector('.page-guide-count').textContent = `Step ${index + 1} of ${steps.length}`;
        root.querySelector('.page-guide-progress').innerHTML = steps.map((_, i) => `<span class="${i === index ? 'is-current' : ''}"></span>`).join('');
        back.disabled = index === 0;
        next.textContent = index === steps.length - 1 ? 'Finish' : 'Next';
        resolveTarget(step)?.element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
        position();
        card.focus({ preventScroll: true });
    }

    function close() {
        cancelAnimationFrame(frame);
        window.removeEventListener('scroll', schedulePosition, true);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('storage', onPermissionsChanged);
        window.removeEventListener('hashchange', close);
        document.removeEventListener('rbac-navigation-updated', close);
        observer.disconnect();
        cardObserver.disconnect();
        stylesheet.removeEventListener('load', schedulePosition);
        root.remove();
        background.forEach(([element, inert]) => { element.inert = inert; });
        options.onClose?.();
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        closeActiveTour = null;
    }

    root.addEventListener('click', event => {
        event.stopPropagation();
        const action = event.target.closest('[data-guide]')?.dataset.guide;
        if (action === 'skip' || (action === 'next' && index === steps.length - 1)) close();
        else if (action === 'next') { index++; showStep(); }
        else if (action === 'back' && index > 0) { index--; showStep(); }
    });
    root.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key === 'Tab') {
            const buttons = Array.from(card.querySelectorAll('button:not(:disabled)'));
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === card)) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && (document.activeElement === last || document.activeElement === card)) { event.preventDefault(); first.focus(); }
        }
    });
    const observer = new MutationObserver(schedulePosition);
    const cardObserver = new ResizeObserver(schedulePosition);
    cardObserver.observe(card);
    const main = document.querySelector('.main-content');
    if (main) observer.observe(main, { childList: true, subtree: true });
    window.addEventListener('scroll', schedulePosition, true);
    window.addEventListener('resize', onResize);
    function onPermissionsChanged(event) {
        if (!event.key || event.key === 'rbac_permissions' || event.key === 'user') close();
    }
    window.addEventListener('storage', onPermissionsChanged);
    window.addEventListener('hashchange', close);
    document.addEventListener('rbac-navigation-updated', close);
    stylesheet.addEventListener('load', schedulePosition);
    closeActiveTour = close;
    showStep();
}
