export function initClauseSorting(container, status) {
    let drag = null;
    const animations = new WeakMap();
    const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    function reorder(change) {
        const rows = [...container.children];
        const positions = new Map(rows.map(row => [row, row.getBoundingClientRect().top]));
        rows.forEach(row => animations.get(row)?.cancel());
        change();
        if (reduceMotion()) return;
        rows.forEach(row => {
            const distance = positions.get(row) - row.getBoundingClientRect().top;
            if (!distance || !row.animate) return;
            animations.set(row, row.animate([
                { transform: `translateY(${distance}px)` },
                { transform: 'translateY(0)' }
            ], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' }));
        });
    }
    function refresh(announce = false) {
        [...container.children].forEach((row, index) => {
            const number = row.querySelector('[data-clause-number]');
            if (number) number.textContent = `Statement ${index + 1}`;
        });
        if (announce && status) status.textContent = 'Statement order updated. Save the agreement to keep this order.';
    }
    function finish(cancel = false) {
        if (!drag) return;
        const {row, originalOrder, pointerId} = drag;
        drag = null;
        if (cancel) reorder(() => container.append(...originalOrder));
        row.classList.remove('clause-dragging');
        if (!cancel && !reduceMotion() && row.animate) {
            row.animate([
                { backgroundColor: '#fff2f6', boxShadow: '0 4px 16px rgba(114,53,75,.18)' },
                { backgroundColor: '#fff', boxShadow: '0 0 0 rgba(114,53,75,0)' }
            ], { duration: 260, easing: 'ease-out' });
        }
        container.classList.remove('clause-sorting');
        if (container.hasPointerCapture(pointerId)) container.releasePointerCapture(pointerId);
        refresh(!cancel);
    }
    container.addEventListener('pointerdown', event => {
        const handle = event.target.closest('[data-clause-drag-handle]');
        if (!handle || event.button !== 0 || drag) return;
        const row = handle.closest('[data-clause-row]');
        if (!row || row.parentElement !== container) return;
        event.preventDefault();
        handle.focus();
        drag = {row, pointerId:event.pointerId, originalOrder:[...container.children]};
        row.classList.add('clause-dragging');
        container.classList.add('clause-sorting');
        // Capture on the container so moving the row cannot interrupt dragging.
        container.setPointerCapture(event.pointerId);
    });
    container.addEventListener('pointermove', event => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-clause-row]');
        if (target && target !== drag.row && target.parentElement === container) {
            const rect = target.getBoundingClientRect();
            const before = event.clientY < rect.top + rect.height / 2;
            const alreadyPlaced = before ? drag.row.nextElementSibling === target : drag.row.previousElementSibling === target;
            if (!alreadyPlaced) reorder(() => target.insertAdjacentElement(before ? 'beforebegin' : 'afterend', drag.row));
            refresh();
        }
        if (event.clientY < 70) window.scrollBy(0, -18);
        else if (event.clientY > window.innerHeight - 70) window.scrollBy(0, 18);
    });
    container.addEventListener('pointerup', event => {
        if (drag?.pointerId === event.pointerId) finish();
    });
    container.addEventListener('pointercancel', event => {
        if (drag?.pointerId === event.pointerId) finish(true);
    });
    container.addEventListener('lostpointercapture', () => finish(true));
    container.addEventListener('keydown', event => {
        if (event.key === 'Escape' && drag) { event.preventDefault(); finish(true); return; }
        const handle = event.target.closest('[data-clause-drag-handle]');
        if (!handle || !['ArrowUp','ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const row = handle.closest('[data-clause-row]');
        if (event.key === 'ArrowUp' && row.previousElementSibling) reorder(() => row.previousElementSibling.before(row));
        if (event.key === 'ArrowDown' && row.nextElementSibling) reorder(() => row.nextElementSibling.after(row));
        handle.focus();
        refresh(true);
    });
    return refresh;
}
