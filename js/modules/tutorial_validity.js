import { buildAppUrl } from '../utilities/app_url.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));

export function formatTutorialDate(value) {
    if (!value) return '';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-US', {
        month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'
    }).format(date);
}

export function ensureTutorialValidityStyles() {
    if (document.getElementById('tutorial-validity-styles')) return;
    const link = document.createElement('link');
    link.id = 'tutorial-validity-styles'; link.rel = 'stylesheet';
    link.href = buildAppUrl('css/tutorial_validity.css?v=20261013');
    document.head.appendChild(link);
}

function dateField(id, label, minimum = '') {
    return `<label for="${id}" class="form-label">${label}</label><div class="tutorial-validity-date">
        <input id="${id}-display" type="text" class="form-control" placeholder="Select a date" readonly tabindex="-1" aria-hidden="true">
        <input id="${id}" type="date" aria-label="${label}"${minimum ? ` min="${minimum}"` : ''}>
        <i class="bi bi-calendar3" aria-hidden="true"></i></div>`;
}

export function getTutorialValidityPreview(program, schedules = []) {
    if (program?.unit_type !== 'session') return null;
    const days = Number(program.validity_days);
    if (!Number.isInteger(days) || days < 1 || days > 3650) return { error: 'Set the program’s validity in days before finalizing enrollment.' };
    const dates = schedules.map(row => row.date).filter(Boolean).sort();
    if (!dates.length) return { days, message: `${days} days from the first agreed session date. Add session dates to see the deadline.` };
    const start = dates[0];
    const date = new Date(`${start}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return { error: 'Choose a valid first session date.' };
    date.setUTCDate(date.getUTCDate() + days - 1);
    const end = date.toISOString().slice(0, 10);
    return { days, start, end, error: dates.some(value => value > end) ? `All sessions must fall within ${formatTutorialDate(start)}–${formatTutorialDate(end)}. Adjust the schedule.` : '',
        message: `${days} days · Valid ${formatTutorialDate(start)} through ${formatTutorialDate(end)}, inclusive. Rescheduling keeps this deadline.` };
}

export async function renderTutorialValidity(container, enrollmentId) {
    if (!container || !enrollmentId) return;
    ensureTutorialValidityStyles();
    container.querySelector('[data-tutorial-validity]')?.remove();
    const card = document.createElement('section');
    card.dataset.tutorialValidity = String(enrollmentId);
    card.className = 'tutorial-validity-card';
    card.textContent = 'Loading tutorial validity…';
    container.appendChild(card);
    try {
        const response = await axios.get(buildAppUrl(`api/enrollment_validity.php?enrollment_details_id=${encodeURIComponent(enrollmentId)}`));
        if (!card.isConnected) return;
        if (response.data.status !== 'success') throw new Error(response.data.message);
        const data = response.data.data;
        if (!data.is_tutorial) { card.remove(); return; }
        const status = data.expired ? 'Expired' : data.validity_end_date ? (data.today < data.validity_start_date ? 'Upcoming' : 'Valid') : 'Needs review';
        card.innerHTML = `<div class="tutorial-validity-header">
            <div class="tutorial-validity-heading"><span class="tutorial-validity-icon"><i class="bi bi-calendar-check" aria-hidden="true"></i></span><div>
                <h6 class="tutorial-validity-title">Tutorial validity <span class="tutorial-validity-badge ${data.expired ? 'expired' : !data.validity_end_date ? 'review' : ''}">${status}</span></h6>
                <p class="tutorial-validity-subtitle">Your session consumption period</p></div></div>
            ${data.can_extend ? `<button type="button" class="tutorial-validity-button" data-validity-edit><i class="bi bi-calendar-plus me-1" aria-hidden="true"></i>${data.validity_end_date ? 'Extend validity' : 'Set validity'}</button>` : ''}
            </div>
            ${data.validity_end_date ? `<div class="tutorial-validity-grid">
                <div class="tutorial-validity-field"><span>Original validity</span><strong>${Number(data.validity_days)} days</strong></div>
                <div class="tutorial-validity-field"><span>Starts on</span><strong>${formatTutorialDate(data.validity_start_date)}</strong></div>
                <div class="tutorial-validity-field"><span>Valid through</span><strong>${formatTutorialDate(data.validity_end_date)}</strong></div></div>` : ''}
            <p class="tutorial-validity-note">${data.expired ? 'Unused sessions cannot be scheduled or rescheduled until validity is extended.' : data.validity_end_date ? 'The final date is included. Rescheduling keeps the same deadline.' : 'Validity has not been assigned to this package. Existing session access continues until its validity is reviewed.'}</p>
            ${data.history.length ? `<details class="tutorial-validity-history"><summary>Validity history</summary><ul>${data.history.map(item => `<li><strong>${formatTutorialDate(item.changed_at)}</strong> · ${escape(item.changed_by)}<br>${item.action === 'initialize' ? 'Validity set' : 'Extended'} through ${formatTutorialDate(item.new_end_date)} — ${escape(item.reason)}</li>`).join('')}</ul></details>` : ''}`;
        card.querySelector('[data-validity-edit]')?.addEventListener('click', () => editValidity(container, enrollmentId, data));
    } catch (error) {
        if (card.isConnected) card.textContent = error.response?.data?.message || error.message || 'Unable to load tutorial validity.';
    }
}

async function editValidity(container, enrollmentId, data) {
    const initializing = !data.validity_end_date;
    ensureTutorialValidityStyles();
    const result = await Swal.fire({
        title: initializing ? 'Set tutorial validity' : 'Extend tutorial validity',
        customClass: { popup: 'tutorial-validity-modal', confirmButton: 'tutorial-validity-save', cancelButton: 'tutorial-validity-cancel' },
        buttonsStyling: false, width: 520,
        html: initializing
            ? `${dateField('validity-start', 'Agreed first session date')}
               <label for="validity-days" class="form-label">Validity in days</label><input type="number" id="validity-days" class="form-control mb-3" min="1" max="3650" step="1" value="${Number(data.program_validity_days) || 30}">
               <div class="tutorial-validity-window" id="validity-window-preview">The first date counts as day 1. Review this existing package before saving.</div>
               <label for="validity-reason" class="form-label">Reason</label><textarea id="validity-reason" class="form-control" maxlength="1000"></textarea>`
            : `<div class="tutorial-validity-window">Current deadline: <strong>${formatTutorialDate(data.validity_end_date)}</strong></div>${dateField('validity-end', 'New expiry date', data.validity_end_date)}
               <label for="validity-reason" class="form-label">Reason</label><textarea id="validity-reason" class="form-control" maxlength="1000"></textarea>`,
        showCancelButton: true, confirmButtonText: 'Save validity', showLoaderOnConfirm: true,
        allowOutsideClick: () => !Swal.isLoading(),
        didOpen: () => {
            const id = initializing ? 'validity-start' : 'validity-end';
            const update = () => {
                const value = document.getElementById(id).value;
                document.getElementById(`${id}-display`).value = formatTutorialDate(value);
                if (initializing && value) {
                    const days = Number(document.getElementById('validity-days').value);
                    const preview = getTutorialValidityPreview({ unit_type: 'session', validity_days: days }, [{ date: value }]);
                    document.getElementById('validity-window-preview').textContent = preview?.error || preview?.message || '';
                }
            };
            document.getElementById(id).addEventListener('change', update);
            if (initializing) document.getElementById('validity-days').addEventListener('input', update);
        },
        preConfirm: async () => {
            const reason = document.getElementById('validity-reason').value.trim();
            const payload = { enrollment_details_id: enrollmentId, reason };
            if (!reason) { Swal.showValidationMessage('Enter a reason.'); return false; }
            if (initializing) {
                payload.validity_start_date = document.getElementById('validity-start').value;
                payload.validity_days = document.getElementById('validity-days').value;
                if (!payload.validity_start_date || !/^[0-9]+$/.test(payload.validity_days) || Number(payload.validity_days) < 1 || Number(payload.validity_days) > 3650) {
                    Swal.showValidationMessage('Choose the first session date and 1–3650 whole days.'); return false;
                }
            } else {
                payload.validity_end_date = document.getElementById('validity-end').value;
                if (payload.validity_end_date <= data.validity_end_date) { Swal.showValidationMessage('Choose a date later than the current deadline.'); return false; }
            }
            try {
                const response = await axios.post(buildAppUrl('api/enrollment_validity.php'), payload);
                if (response.data.status !== 'success') throw new Error(response.data.message);
                return response.data;
            } catch (error) {
                Swal.showValidationMessage(error.response?.data?.message || error.message); return false;
            }
        }
    });
    if (result.isConfirmed) await renderTutorialValidity(container, enrollmentId);
}
