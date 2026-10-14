function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeStatus(status) {
    return String(status || '').trim().toLowerCase();
}

function capitalizeStatus(status) {
    const normalized = normalizeStatus(status);
    if (!normalized) return 'Pending';
    if (normalized === 'no-show') return 'No-show';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function formatSessionDuration(startTime, endTime) {
    const toMinutes = value => {
        const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
        if (!match) return null;
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
    };
    const start = toMinutes(startTime);
    const end = toMinutes(endTime);
    if (start === null || end === null || start === end) return 'TBA';
    const totalMinutes = (end - start + 1440) % 1440;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return [
        hours ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : '',
        minutes ? `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}` : ''
    ].filter(Boolean).join(' ');
}

function detailTile(icon, label, value, highlightValue = false) {
    return `
        <div class="tc-detail-tile">
            <div class="tc-detail-tile-icon"><i class="bi bi-${escapeHtml(icon)}"></i></div>
            <div class="tc-detail-tile-copy">
                <div class="tc-detail-tile-label">${escapeHtml(label)}</div>
                <div class="tc-detail-tile-value${highlightValue ? ' is-highlighted' : ''}">${escapeHtml(value)}</div>
            </div>
        </div>
    `;
}

// Use the device's local clock so staff can test by changing their laptop time.
export function getSessionStartAvailability(schedule = {}, now = new Date()) {
    const date = String(schedule.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const parseTime = value => String(value || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    const startTime = parseTime(schedule.time);
    const endTime = parseTime(schedule.endTime);
    const unavailable = { allowed: false, message: 'Start unavailable: session date or time is missing or invalid.' };
    if (!date || !startTime || !endTime) return unavailable;
    const makeDate = time => {
        const hours = Number(time[1]), minutes = Number(time[2]), seconds = Number(time[3] || 0);
        if (hours > 23 || minutes > 59 || seconds > 59) return null;
        const value = new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3]), hours, minutes, seconds);
        return value.getFullYear() === Number(date[1]) && value.getMonth() === Number(date[2]) - 1
            && value.getDate() === Number(date[3]) ? value : null;
    };
    const start = makeDate(startTime);
    const end = makeDate(endTime);
    if (!start || !end || end <= start || !Number.isFinite(now.getTime())) return unavailable;
    if (now < start) return { allowed: false, message: `Start available on ${schedule.date} at ${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` };
    if (now >= end) return { allowed: false, message: 'Start unavailable: the scheduled session time has ended.' };
    return { allowed: true, message: '' };
}

function buildContent(options) {
    const schedule = options.schedule || {};
    const formatTime = typeof options.formatTime === 'function'
        ? options.formatTime
        : value => String(value || '');
    const formatDate = typeof options.formatDate === 'function'
        ? options.formatDate
        : value => String(value || '');
    const timeRange = `${formatTime(schedule.time)}${schedule.endTime ? ` - ${formatTime(schedule.endTime)}` : ''}`;
    const personLabel = options.personLabel || 'Student';
    const personValue = options.personValue ?? schedule.student ?? 'TBA';

    return `
        <div class="tc-detail-scroll">
            <div class="tc-detail-feature">
                <div class="tc-detail-feature-icon"><i class="bi bi-clock"></i></div>
                <div>
                    <div class="tc-detail-feature-label">Preferred Time</div>
                    <div class="tc-detail-feature-value">${escapeHtml(timeRange || 'TBA')}</div>
                </div>
            </div>
            <div class="tc-detail-grid tc-detail-grid-single">
                ${detailTile('hourglass-split', 'Duration', formatSessionDuration(schedule.time, schedule.endTime))}
            </div>
            ${Object.values(options.actions || {}).some(action => action.visible && action.action === 'ongoing') ? `
                <div id="session-start-time-notice" class="small text-muted mb-3" role="status" aria-live="polite">${escapeHtml(getSessionStartAvailability(schedule).message)}</div>
            ` : ''}
            <div class="tc-detail-grid">
                ${detailTile('calendar-event', 'Day', schedule.day || 'TBA')}
                ${detailTile('calendar2-check', 'Registered', formatDate(schedule.date) || 'TBA')}
            </div>
            ${options.showCenter ? `
                <div class="tc-detail-grid">
                    ${detailTile('shop', 'Center', schedule.branch || 'Unassigned Center')}
                    ${detailTile('geo-alt', 'Location', schedule.branch_location || 'N/A')}
                </div>
            ` : ''}
            <div class="tc-detail-grid">
                ${detailTile('book', 'Subject', schedule.subject || 'TBA')}
                ${detailTile('person', personLabel, personValue || 'TBA')}
            </div>
            ${options.showTeacher ? `
                <div class="tc-detail-grid">
                    ${detailTile('person-badge', schedule.substitute_teacher_id ? 'Teacher for this session' : 'Teacher', schedule.teacher || 'TBA')}
                    ${detailTile('mortarboard', 'Program', schedule.program || 'N/A')}
                </div>
            ` : `
                <div class="tc-detail-grid tc-detail-grid-single">
                    ${detailTile('mortarboard', 'Program', schedule.program || 'N/A')}
                </div>
            `}
            <div class="tc-detail-grid">
                ${detailTile('check-circle', 'Status', capitalizeStatus(schedule.status), true)}
                ${detailTile('bell', 'Notification', schedule.isNotified ? 'Sent' : 'Pending')}
            </div>
            ${schedule.substitute_teacher_id || options.onAssignSubstitute ? `
                <div class="tc-detail-grid">
                    ${detailTile('person-badge', 'Regular teacher', schedule.regular_teacher || schedule.teacher || 'TBA')}
                    ${detailTile('person-check', 'Substitute for this session', schedule.substitute_teacher || 'None assigned')}
                </div>
                ${schedule.substitute_reason ? detailTile('chat-left-text', 'Substitute reason', schedule.substitute_reason) : ''}
                ${options.onAssignSubstitute ? `
                    <div class="d-flex flex-wrap gap-2 mt-3">
                        <button type="button" class="tc-detail-btn tc-detail-btn-outline" id="assign-session-substitute">${schedule.substitute_teacher_id ? 'Change Substitute' : 'Assign Substitute'}</button>
                        ${schedule.substitute_teacher_id ? '<button type="button" class="tc-detail-btn tc-detail-btn-outline" id="remove-session-substitute">Remove Substitute</button>' : ''}
                    </div>
                ` : ''}
            ` : ''}
        </div>
    `;
}

export function getManagerScheduleModalActions(status, options = {}) {
    const normalized = normalizeStatus(status);
    const canEdit = options.canEdit !== false;
    const canReschedule = Boolean(options.canReschedule && canEdit && normalized === 'pending');
    const actions = {
        confirm: { visible: false, text: '', variant: 'outline', action: null },
        deny: { visible: false, text: '', variant: 'primary', action: null },
        cancel: {
            visible: canReschedule,
            text: '<i class="bi bi-calendar-event"></i> Reschedule',
            variant: 'outline',
            action: canReschedule ? 'reschedule' : null
        }
    };

    if (normalized === 'no-show' && options.canCorrectNoShow) {
        actions.confirm = {
            visible: true,
            text: '<i class="bi bi-pencil-square"></i> Correct No-show',
            variant: 'primary',
            action: 'correct-no-show'
        };
        return actions;
    }
    if (!canEdit) return actions;

    if (normalized === 'pending') {
        actions.confirm = {
            visible: true,
            text: '<i class="bi bi-x-lg"></i> No-show',
            variant: 'outline',
            action: 'no-show'
        };
        actions.deny = {
            visible: true,
            text: '<i class="bi bi-play-circle"></i> Start Session',
            variant: 'primary',
            action: 'ongoing'
        };
    } else if (normalized === 'confirmed') {
        actions.confirm = {
            visible: true,
            text: '<i class="bi bi-play-circle"></i> Start Session',
            variant: 'primary',
            action: 'ongoing'
        };
    } else if (normalized === 'ongoing') {
        actions.confirm = {
            visible: true,
            text: '<i class="bi bi-check-circle"></i> Done',
            variant: 'primary',
            action: 'done'
        };
    }

    return actions;
}

export function getStudentScheduleModalActions(status) {
    const isPending = normalizeStatus(status) === 'pending';
    const canReschedule = !/^no[\s_-]*show$/.test(normalizeStatus(status));
    return {
        confirm: {
            visible: true,
            text: isPending ? 'Confirm' : 'Already Confirmed',
            variant: 'primary',
            action: isPending ? 'confirm' : null,
            disabled: !isPending
        },
        deny: { visible: false, text: '', variant: 'primary', action: null },
        cancel: {
            visible: canReschedule,
            text: '<i class="bi bi-calendar-event"></i> Reschedule',
            variant: 'outline',
            action: canReschedule ? 'reschedule' : null
        }
    };
}

export function openScheduleDetailsModal(options = {}) {
    const actions = options.actions || {};
    const confirm = actions.confirm || {};
    const deny = actions.deny || {};
    const cancel = actions.cancel || {};
    const hasStartAction = [confirm, deny].some(action => action.visible && action.action === 'ongoing');
    let startTimer = null;
    const clearStartTimer = () => {
        if (startTimer !== null) clearInterval(startTimer);
        startTimer = null;
    };
    const guardStart = action => {
        if (action.action !== 'ongoing') return true;
        const availability = getSessionStartAvailability(options.schedule);
        if (!availability.allowed) {
            Swal.showValidationMessage(availability.message);
            return false;
        }
        return true;
    };

    return Swal.fire({
        title: 'Schedule Details',
        html: buildContent(options),
        showCloseButton: true,
        closeButtonHtml: '&times;',
        closeButtonAriaLabel: 'Close Schedule Details',
        showConfirmButton: Boolean(confirm.visible),
        showDenyButton: Boolean(deny.visible),
        showCancelButton: Boolean(cancel.visible),
        confirmButtonText: confirm.text || 'Confirm',
        denyButtonText: deny.text || 'Continue',
        cancelButtonText: cancel.text || 'Close',
        width: 920,
        heightAuto: false,
        preConfirm: () => guardStart(confirm),
        preDeny: () => guardStart(deny),
        willClose: clearStartTimer,
        didDestroy: clearStartTimer,
        customClass: {
            popup: 'calendar-schedule-popup tc-detail-popup',
            title: 'tc-detail-title',
            htmlContainer: 'tc-detail-body',
            closeButton: 'tc-detail-close',
            actions: 'tc-detail-actions',
            confirmButton: `tc-detail-btn tc-detail-btn-${confirm.variant || 'primary'}`,
            denyButton: `tc-detail-btn tc-detail-btn-${deny.variant || 'primary'}`,
            cancelButton: `tc-detail-btn tc-detail-btn-${cancel.variant || 'outline'}`
        },
        didOpen: modal => {
            if (hasStartAction) {
                const updateStartButtons = () => {
                    const availability = getSessionStartAvailability(options.schedule);
                    [[confirm, '.swal2-confirm'], [deny, '.swal2-deny']].forEach(([action, selector]) => {
                        if (action.action !== 'ongoing') return;
                        const button = modal.querySelector(selector);
                        if (button) button.disabled = Boolean(action.disabled) || !availability.allowed;
                    });
                    const notice = modal.querySelector('#session-start-time-notice');
                    if (notice) notice.textContent = availability.message;
                };
                updateStartButtons();
                startTimer = setInterval(updateStartButtons, 1000);
            }
            modal.querySelector('#assign-session-substitute')?.addEventListener('click', () => {
                Swal.close();
                options.onAssignSubstitute();
            });
            modal.querySelector('#remove-session-substitute')?.addEventListener('click', () => {
                Swal.close();
                options.onRemoveSubstitute?.();
            });
            if (confirm.disabled) {
                const confirmButton = modal.querySelector('.swal2-confirm');
                if (confirmButton) confirmButton.disabled = true;
            }
        }
    }).then(result => {
        clearStartTimer();
        let action = null;
        if (result.isConfirmed) action = confirm.action || null;
        if (result.isDenied) action = deny.action || null;
        if (result.dismiss === Swal.DismissReason.cancel) action = cancel.action || null;
        if (action === 'ongoing' && !getSessionStartAvailability(options.schedule).allowed) action = null;
        return { action, result };
    });
}
