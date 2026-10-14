let disposePickers = () => {};
let refreshPickers = () => {};

const toMinutes = value => {
    const [hour, minute] = String(value || '').split(':').map(Number);
    return Number.isInteger(hour) && Number.isInteger(minute) ? hour * 60 + minute : null;
};
const toTime = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const labelTime = value => {
    const minute = toMinutes(value);
    return minute === null ? 'Select time' : `${Math.floor(minute / 60) % 12 || 12}:${String(minute % 60).padStart(2, '0')} ${minute >= 720 ? 'PM' : 'AM'}`;
};

export function availableTimeMinutes(slots, startValue = null) {
    const ranges = slots.map(slot => ({ start: toMinutes(slot.start), end: toMinutes(slot.end) }))
        .filter(slot => slot.start !== null && slot.end !== null && slot.end > slot.start)
        .sort((a, b) => a.start - b.start)
        .reduce((merged, slot) => {
            const last = merged[merged.length - 1];
            if (last && slot.start <= last.end) last.end = Math.max(last.end, slot.end);
            else merged.push({ ...slot });
            return merged;
        }, []);
    if (startValue !== null) {
        const start = toMinutes(startValue);
        const slot = ranges.find(slot => start !== null && start >= slot.start && start < slot.end);
        return slot ? Array.from({ length: slot.end - start }, (_, index) => start + index + 1) : [];
    }
    return ranges.flatMap(slot => Array.from({ length: slot.end - slot.start }, (_, index) => slot.start + index));
}

export function timePickerChoices(allowed, value) {
    const selected = toMinutes(value) ?? allowed[0] ?? 0;
    const hour = Math.floor(selected / 60) % 12;
    const period = selected >= 720 ? 1 : 0;
    return {
        hours: Array.from({ length: 12 }, (_, index) => {
            const displayHour = index + 1;
            return { label: String(displayHour).padStart(2, '0'), value: displayHour % 12,
                disabled: !allowed.some(time => Math.floor(time / 60) === displayHour % 12 + period * 12) };
        }),
        minutes: Array.from({ length: 60 }, (_, minute) => ({ label: String(minute).padStart(2, '0'), value: minute,
            disabled: !allowed.includes((hour + period * 12) * 60 + minute) })),
        periods: ['AM', 'PM'].map((label, period) => ({ label, value: period,
            disabled: !allowed.some(time => (time >= 720 ? 1 : 0) === period) }))
    };
}

export function refreshEnrollmentTimePickers() { refreshPickers(); }
export function disposeEnrollmentTimePickers() {
    disposePickers();
    disposePickers = () => {};
}

export function initEnrollmentTimePickers(options = {}) {
    disposePickers();
    const getField = id => options.root ? options.root.querySelector(`#${id}`) : document.getElementById(id);
    const startId = options.startTimeId || 'schedTime';
    const endId = options.endTimeId || 'schedEndTime';
    const start = getField(startId);
    const end = getField(endId);
    const startButton = getField(`${startId}Display`);
    const endButton = getField(`${endId}Display`);
    if (!start || !end || !startButton || !endButton) return;
    if (!document.getElementById('enrollmentTimePickerStyles')) {
        const style = document.createElement('style');
        style.id = 'enrollmentTimePickerStyles';
        style.textContent = `
            .enrollment-time-popup { position:fixed; z-index:1080; width:224px; padding:10px; background:#fff; border:1px solid #dfe3ea; border-radius:9px; box-shadow:0 8px 24px #17203326; }
            .enrollment-time-popup[hidden] { display:none; }
            .enrollment-time-columns { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; }
            .enrollment-time-column { max-height:190px; overflow-y:auto; scrollbar-width:thin; }
            .enrollment-time-choice { display:block; width:100%; min-height:34px; padding:6px 4px; border:0; border-radius:4px; background:#fff; color:#172033; font-size:14px; }
            .enrollment-time-choice:hover:enabled { background:#fff0f5; }
            .enrollment-time-choice[aria-pressed="true"] { background:#e85d88; color:white; }
            .enrollment-time-choice:disabled { color:#b5bbc5; background:#f7f8fa; cursor:not-allowed; }
            .enrollment-time-caption { margin:0 0 8px; font-size:12px; color:#697386; }
            .enrollment-time-trigger { display:flex; align-items:center; justify-content:space-between; text-align:left; background:white; }
        `;
        document.head.appendChild(style);
    }
    const popup = document.createElement('div');
    popup.className = 'enrollment-time-popup';
    popup.hidden = true;
    popup.setAttribute('role', 'dialog');
    // Keep the popup inside the modal's focus boundary, outside its scrolling body.
    (options.root || startButton.closest('.modal') || document.body).appendChild(popup);
    let active = null;
    const slots = () => {
        const teacher = getField('preferredTeacher')?.value;
        const date = getField(options.hiddenDateId || 'schedDate')?.value;
        return teacher && date ? window.teacherAvailableSlotsPerDate?.[date] || [] : [];
    };
    const allowedFor = field => availableTimeMinutes(slots(), field === end ? start.value : null);
    const close = () => {
        popup.hidden = true;
        startButton.setAttribute('aria-expanded', 'false');
        endButton.setAttribute('aria-expanded', 'false');
        active = null;
    };
    const sync = () => {
        for (const [field, button] of [[start, startButton], [end, endButton]]) {
            const allowed = allowedFor(field);
            if (!allowed.includes(toMinutes(field.value))) field.value = allowed.length ? toTime(field === end ? allowed[allowed.length - 1] : allowed[0]) : '';
            button.disabled = !allowed.length;
            button.replaceChildren(document.createTextNode(field.value ? labelTime(field.value) : 'Select teacher and date'), Object.assign(document.createElement('i'), { className: 'bi bi-clock' }));
        }
        if (active && !allowedFor(active.field).length) close();
    };
    const render = () => {
        if (!active) return;
        const { field, button } = active;
        const allowed = allowedFor(field);
        const selected = toMinutes(field.value);
        const choices = timePickerChoices(allowed, field.value);
        popup.replaceChildren();
        popup.setAttribute('aria-label', field === start ? 'Choose start time' : 'Choose end time');
        const caption = document.createElement('p');
        caption.className = 'enrollment-time-caption';
        caption.textContent = 'Unavailable times are disabled';
        const columns = document.createElement('div');
        columns.className = 'enrollment-time-columns';
        for (const key of ['hours', 'minutes', 'periods']) {
            const column = document.createElement('div');
            column.className = 'enrollment-time-column';
            column.setAttribute('role', 'group');
            column.setAttribute('aria-label', key);
            for (const choice of choices[key]) {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'enrollment-time-choice';
                item.textContent = choice.label;
                item.disabled = choice.disabled;
                item.dataset.unit = key;
                item.dataset.value = String(choice.value);
                const selectedUnit = key === 'hours' ? Math.floor(selected / 60) % 12 : key === 'minutes' ? selected % 60 : selected >= 720 ? 1 : 0;
                item.setAttribute('aria-pressed', String(selectedUnit === choice.value));
                item.addEventListener('click', () => {
                    const candidates = allowed.filter(time => key === 'hours' ? Math.floor(time / 60) === choice.value + (selected >= 720 ? 12 : 0)
                        : key === 'minutes' ? time === Math.floor(selected / 60) * 60 + choice.value : (time >= 720 ? 1 : 0) === choice.value);
                    if (!candidates.length) return;
                    const desired = key === 'hours' ? (choice.value + (selected >= 720 ? 12 : 0)) * 60 + selected % 60
                        : key === 'minutes' ? Math.floor(selected / 60) * 60 + choice.value : (Math.floor(selected / 60) % 12 + choice.value * 12) * 60 + selected % 60;
                    field.value = toTime(candidates.includes(desired) ? desired : candidates[0]);
                    field.dispatchEvent(new Event('change', { bubbles: true }));
                    button.dispatchEvent(new Event('change', { bubbles: true }));
                    sync();
                    render();
                    popup.querySelector(`[data-unit="${key}"][data-value="${choice.value}"]`)?.focus({ preventScroll: true });
                });
                column.appendChild(item);
            }
            columns.appendChild(column);
        }
        popup.append(caption, columns);
        const done = document.createElement('button');
        done.type = 'button';
        done.className = 'btn btn-sm btn-outline-secondary w-100 mt-2';
        done.textContent = 'Done';
        done.addEventListener('click', () => { close(); button.focus(); });
        popup.appendChild(done);
        popup.hidden = false;
        const rect = button.getBoundingClientRect();
        popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 240))}px`;
        popup.style.top = `${rect.bottom + 278 > window.innerHeight ? Math.max(8, rect.top - 278) : rect.bottom + 6}px`;
        for (const column of columns.children) {
            const selectedButton = column.querySelector('[aria-pressed="true"]');
            if (selectedButton) column.scrollTop = selectedButton.offsetTop - column.offsetTop - 60;
        }
    };
    const openStart = () => open(start, startButton);
    const openEnd = () => open(end, endButton);
    const open = (field, button) => {
        if (active?.field === field) { close(); return; }
        close();
        sync();
        if (button.disabled) return;
        active = { field, button };
        button.setAttribute('aria-expanded', 'true');
        render();
    };
    const outside = event => { if (!popup.contains(event.target) && event.target !== startButton && !startButton.contains(event.target) && event.target !== endButton && !endButton.contains(event.target)) close(); };
    const escape = event => { if (event.key === 'Escape' && active) { const button = active.button; close(); button.focus(); } };
    const scroll = event => { if (!popup.contains(event.target)) close(); };
    popup.addEventListener('click', event => event.stopPropagation());
    startButton.addEventListener('click', openStart);
    endButton.addEventListener('click', openEnd);
    document.addEventListener('click', outside);
    document.addEventListener('keydown', escape);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    const modal = startButton.closest('.modal');
    modal?.addEventListener('hide.bs.modal', close);
    refreshPickers = () => { close(); sync(); };
    refreshPickers();
    disposePickers = () => {
        popup.remove();
        startButton.removeEventListener('click', openStart);
        endButton.removeEventListener('click', openEnd);
        document.removeEventListener('click', outside);
        document.removeEventListener('keydown', escape);
        document.removeEventListener('scroll', scroll, true);
        window.removeEventListener('resize', close);
        modal?.removeEventListener('hide.bs.modal', close);
        refreshPickers = () => {};
    };
}
