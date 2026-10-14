const endpoint = '../../api/admin/session_automation.php';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const formatAutomationTime = value => String(value ?? '').replace('T', ' ').replace(/\b(\d{2}):(\d{2})(?::(\d{2}))?\b/, (_, hour, minute, second) =>
    `${Number(hour) % 12 || 12}:${minute}${second === undefined ? '' : `:${second}`} ${Number(hour) >= 12 ? 'PM' : 'AM'}`);

export async function initSessionAutomation() {
    const section = document.getElementById('session-automation-section');
    if (!section || section.dataset.initialized) return;
    section.dataset.initialized = 'true';
    const body = document.getElementById('session-automation-table');
    const add = document.getElementById('add-session-automation');
    const worker = document.getElementById('session-automation-worker');
    const testTiming = document.getElementById('test-session-timing');
    let policy = null;
    let canManage = false;
    let canCreate = false;
    let canEdit = false;
    let canPreview = false;
    let serverTime = '';
    add.hidden = true;

    async function load() {
        try {
            const { data } = await axios.get(endpoint);
            if (data.status !== 'success') throw new Error(data.message);
            policy = data.policy;
            canManage = data.can_manage === true;
            canCreate = data.can_create ?? canManage;
            canEdit = data.can_edit ?? canManage;
            canPreview = data.can_preview === true;
            serverTime = data.server_time || '';
            if (testTiming) { testTiming.hidden = !canPreview; testTiming.disabled = !policy; }
            add.hidden = !canCreate || Boolean(policy);
            body.innerHTML = policy ? `<tr>
                <td>All branches</td>
                <td>${Number(policy.auto_no_show) ? `${Number(policy.no_show_minutes)} minutes after start` : 'Disabled'}</td>
                <td>${Number(policy.auto_done) ? (Number(policy.done_delay_minutes) ? `${Number(policy.done_delay_minutes)} minutes after end` : 'At scheduled end') : 'Disabled'}</td>
                <td>${escapeHtml(formatAutomationTime(policy.effective_from))}</td><td>${escapeHtml(formatAutomationTime(policy.updated_at))}</td>
                <td>${canEdit ? '<button type="button" class="btn btn-sm btn-outline-primary" data-automation-action="edit">Edit</button>' : '<span class="text-muted">View only</span>'}</td>
                </tr>` : `<tr><td colspan="6" class="text-center text-muted">${canManage ? 'No policy yet. Add a policy to enable automatic session updates.' : 'No automation policy has been configured by the owner yet.'}</td></tr>`;
            const state = data.worker;
            const lastRun = state?.last_run_at;
            const stale = lastRun && Date.now() - Date.parse(lastRun.replace(' ', 'T') + '+08:00') > 180000;
            worker.textContent = lastRun
                ? `Last session check: ${formatAutomationTime(lastRun)} (Philippine time). ${Number(state.last_changed)} session slots updated.${state.last_error ? ' The last check failed. Contact your administrator.' : stale ? ' Keep a logged-in system tab active to resume checks.' : ''}`
                : 'Session checks run every minute while any logged-in user has the system open in an active browser tab.';
            worker.classList.toggle('text-danger', Boolean(state?.last_error || stale));
        } catch (error) {
            add.hidden = true;
            if (testTiming) testTiming.hidden = true;
            body.innerHTML = `<tr><td colspan="6" class="text-center text-danger">${escapeHtml(error.response?.data?.message || error.message || 'Unable to load settings.')}</td></tr>`;
        }
    }

    async function edit() {
        if (policy ? !canEdit : !canCreate) return;
        const editing = Boolean(policy);
        const current = policy || { auto_no_show: 1, no_show_minutes: 30, auto_done: 1, done_delay_minutes: 0 };
        const result = await Swal.fire({
            title: editing ? 'Edit Session Automation' : 'Add Session Automation',
            html: `<form id="session-automation-form" class="text-start">
                <div class="form-check form-switch mb-2"><input class="form-check-input" type="checkbox" id="automation-no-show" ${Number(current.auto_no_show) ? 'checked' : ''}><label class="form-check-label" for="automation-no-show">Automatically mark unattended sessions as no-show</label></div>
                <label class="form-label" for="automation-grace">Minutes after scheduled start</label>
                <input class="form-control mb-3" id="automation-grace" type="number" min="0" max="1440" step="1" required value="${Number(current.no_show_minutes)}">
                <div class="form-check form-switch mb-2"><input class="form-check-input" type="checkbox" id="automation-done" ${Number(current.auto_done) ? 'checked' : ''}><label class="form-check-label" for="automation-done">Automatically complete ongoing sessions</label></div>
                <label class="form-label" for="automation-delay">Minutes after scheduled end (0 = at end time)</label>
                <input class="form-control mb-3" id="automation-delay" type="number" min="0" max="1440" step="1" required value="${Number(current.done_delay_minutes)}">
                <p class="small text-muted" id="automation-preview"></p>
                <p class="small mb-0">${editing ? 'Changes apply to unresolved sessions on the next background check. The activation date stays unchanged.' : 'Applies to meetings scheduled to start from the moment you save. Earlier meetings are excluded.'}</p>
                </form>`,
            showCancelButton: true, confirmButtonText: 'Save Policy', showLoaderOnConfirm: true,
            allowOutsideClick: () => !Swal.isLoading(),
            didOpen: () => {
                const form = document.getElementById('session-automation-form');
                const preview = () => {
                    const grace = Number(document.getElementById('automation-grace').value);
                    const delay = Number(document.getElementById('automation-delay').value);
                    document.getElementById('automation-preview').textContent = `For a 2:00–3:00 PM meeting: no-show after ${grace} minutes from 2:00 PM; completion ${delay} minutes after 3:00 PM. Each rule applies only when its switch is enabled.`;
                };
                form.addEventListener('input', preview);
                form.addEventListener('submit', event => event.preventDefault());
                preview();
            },
            preConfirm: async () => {
                const form = document.getElementById('session-automation-form');
                if (!form.reportValidity()) return false;
                const payload = { operation: editing ? 'update' : 'create',
                    auto_no_show: document.getElementById('automation-no-show').checked,
                    no_show_minutes: Number(document.getElementById('automation-grace').value),
                    auto_done: document.getElementById('automation-done').checked,
                    done_delay_minutes: Number(document.getElementById('automation-delay').value) };
                try {
                    const { data } = await axios.post(endpoint, payload);
                    if (data.status !== 'success') throw new Error(data.message);
                    return data;
                } catch (error) { Swal.showValidationMessage(error.response?.data?.message || error.message); return false; }
            }
        });
        if (result.isConfirmed) { await load(); await Swal.fire('Saved', result.value.message, 'success'); }
    }

    async function previewTiming() {
        if (!canPreview || !policy) return;
        const initialHour = Number(serverTime.slice(11, 13)) || 0;
        const result = await Swal.fire({
            title: 'Test Session Timing',
            html: `<div class="text-start"><p>Choose a date and time to preview which current sessions would become No-show or Done.</p>
                <label class="form-label" for="test-timing-date">Test date (Philippine time)</label>
                <input type="date" class="form-control mb-3" id="test-timing-date" required value="${escapeHtml(serverTime.slice(0, 10))}">
                <div class="row g-2">
                    <div class="col-4"><label class="form-label" for="test-timing-hour">Hour</label><select class="form-select" id="test-timing-hour">${Array.from({ length: 12 }, (_, index) => index + 1).map(hour => `<option value="${hour}" ${hour === (initialHour % 12 || 12) ? 'selected' : ''}>${hour}</option>`).join('')}</select></div>
                    <div class="col-4"><label class="form-label" for="test-timing-minute">Minute</label><select class="form-select" id="test-timing-minute">${Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0')).map(minute => `<option value="${minute}" ${minute === serverTime.slice(14, 16) ? 'selected' : ''}>${minute}</option>`).join('')}</select></div>
                    <div class="col-4"><label class="form-label" for="test-timing-period">AM/PM</label><select class="form-select" id="test-timing-period"><option value="AM" ${initialHour < 12 ? 'selected' : ''}>AM</option><option value="PM" ${initialHour >= 12 ? 'selected' : ''}>PM</option></select></div>
                </div>
                <p class="small text-muted mt-3">No-show applies to pending/confirmed sessions. Done applies to sessions already ongoing.</p>
                <p class="small text-muted mb-0">Previewing alone changes no records and sends no emails. You can send individual emails from the results. Uses current statuses and saved rules. Sessions before ${escapeHtml(formatAutomationTime(policy.effective_from))} are excluded.</p></div>`,
            confirmButtonText: 'Preview Results', showCancelButton: true, showLoaderOnConfirm: true,
            allowOutsideClick: () => !Swal.isLoading(),
            preConfirm: async () => {
                const input = document.getElementById('test-timing-date');
                if (!input.reportValidity()) return false;
                const hour = Number(document.getElementById('test-timing-hour').value) % 12
                    + (document.getElementById('test-timing-period').value === 'PM' ? 12 : 0);
                const previewAt = `${input.value}T${String(hour).padStart(2, '0')}:${document.getElementById('test-timing-minute').value}`;
                try {
                    const { data } = await axios.post(endpoint, { operation: 'preview', preview_at: previewAt });
                    if (data.status !== 'success') throw new Error(data.message);
                    return data;
                } catch (error) { Swal.showValidationMessage(error.response?.data?.message || error.message); return false; }
            }
        });
        if (!result.isConfirmed) return;
        const data = result.value;
        const rows = (data.preview || []).map((meeting, index) => `<tr>
            <td>${escapeHtml(meeting.student_name)}<br><small>${escapeHtml(meeting.program_name)} · ${escapeHtml(meeting.branch_name || 'N/A')}</small></td>
            <td>${escapeHtml(meeting.date)}<br><small>${escapeHtml(formatAutomationTime(meeting.start_time))} - ${escapeHtml(formatAutomationTime(meeting.end_time))}</small></td>
            <td>${escapeHtml(meeting.current_status)}</td><td><strong>${meeting.new_status === 'done' ? 'Done' : 'No-show'}</strong><br><small>${Number(meeting.slot_count)} slot(s)</small></td>
            <td><button type="button" class="btn btn-sm btn-outline-primary text-nowrap" data-preview-send-email="${index}">Send Email</button><small class="d-block mt-1" data-email-result role="status"></small></td></tr>`).join('');
        await Swal.fire({ title: 'Timing Preview', width: 850, confirmButtonText: 'Close',
            html: `<div class="text-start"><p>Test time: <strong>${escapeHtml(formatAutomationTime(data.preview_at))}</strong> (Philippine time)</p>
                <p>${Number(data.meetings)} meeting(s), covering ${Number(data.changed)} session slot(s), would change.</p>
                ${rows ? `<div class="table-responsive" style="max-height:400px;overflow:auto"><table class="table table-sm align-middle"><thead><tr><th>Student / Program</th><th>Schedule</th><th>Current status</th><th>Would become</th><th>Email</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="text-muted">${data.policy_enabled ? 'No eligible sessions would change at this time. Check the saved activation date, session statuses, and scheduled times.' : 'Both timing rules are disabled, or no policy exists.'}</p>`}
                ${Number(data.meetings) > 50 ? '<p class="small text-muted">Showing the first 50 meetings. The counts include all matching meetings.</p>' : ''}
                <p class="small text-muted mb-0">Attendance and enrollments remain unchanged. Send Email delivers the displayed No-show or Done email to that student's saved address. Previewing alone sends no email.</p></div>`,
            didOpen: modal => {
                modal.addEventListener('click', async event => {
                    const button = event.target.closest('[data-preview-send-email]');
                    if (!button || button.disabled) return;
                    const meeting = data.preview[Number(button.dataset.previewSendEmail)];
                    if (!meeting) return;
                    const message = button.parentElement.querySelector('[data-email-result]');
                    button.disabled = true;
                    button.textContent = 'Sending...';
                    message.textContent = '';
                    try {
                        const { data: sent } = await axios.post(endpoint, { operation: 'send_preview_email',
                            preview_at: data.preview_at.replace(' ', 'T').slice(0, 16), preference_ids: meeting.preference_ids });
                        if (sent.status !== 'success') throw new Error(sent.message);
                        button.textContent = 'Sent';
                        message.className = 'd-block mt-1 text-success';
                        message.textContent = sent.message;
                    } catch (error) {
                        button.disabled = false;
                        button.textContent = 'Retry Email';
                        message.className = 'd-block mt-1 text-danger';
                        message.textContent = error.response?.data?.message || error.message;
                    }
                });
            }
        });
    }

    testTiming?.addEventListener('click', previewTiming);
    add.addEventListener('click', edit);
    window.addEventListener('session-automation-checked', () => { if (!window.Swal?.isVisible()) load(); });
    body.addEventListener('click', async event => {
        const action = event.target.closest('[data-automation-action]')?.dataset.automationAction;
        if (action === 'edit') return edit();
    });
    await load();
}
