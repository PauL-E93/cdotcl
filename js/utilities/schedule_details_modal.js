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
                    ${detailTile('person-badge', 'Teacher', schedule.teacher || 'TBA')}
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
            visible: true,
            text: '<i class="bi bi-calendar-event"></i> Reschedule',
            variant: 'outline',
            action: 'reschedule'
        }
    };
}

export function openScheduleDetailsModal(options = {}) {
    const actions = options.actions || {};
    const confirm = actions.confirm || {};
    const deny = actions.deny || {};
    const cancel = actions.cancel || {};

    return Swal.fire({
        title: 'Schedule Details',
        html: buildContent(options),
        showCloseButton: true,
        showConfirmButton: Boolean(confirm.visible),
        showDenyButton: Boolean(deny.visible),
        showCancelButton: Boolean(cancel.visible),
        confirmButtonText: confirm.text || 'Confirm',
        denyButtonText: deny.text || 'Continue',
        cancelButtonText: cancel.text || 'Close',
        width: 920,
        heightAuto: false,
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
            if (confirm.disabled) {
                const confirmButton = modal.querySelector('.swal2-confirm');
                if (confirmButton) confirmButton.disabled = true;
            }
        }
    }).then(result => {
        let action = null;
        if (result.isConfirmed) action = confirm.action || null;
        if (result.isDenied) action = deny.action || null;
        if (result.dismiss === Swal.DismissReason.cancel) action = cancel.action || null;
        return { action, result };
    });
}
