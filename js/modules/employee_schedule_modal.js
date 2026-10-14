let currentScheduleEmpId = null;
let canManageSchedule = () => false;
let loadVersion = 0;
let saving = false;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function initEmployeeScheduleModal(canManage) {
    canManageSchedule = canManage;
    injectScheduleModal();
}

function injectScheduleModal() {
    if (document.getElementById('scheduleModal')) return;
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = new URL('../../css/employee_schedule.css?v=20261013-theme-plus', import.meta.url).href;
    document.head.appendChild(style);
    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal fade" id="scheduleModal" tabindex="-1" aria-labelledby="employeeScheduleTitle" aria-hidden="true">
      <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable"><div class="modal-content">
        <div class="modal-header"><div><h5 class="modal-title" id="employeeScheduleTitle">Weekly schedule</h5><p class="mb-0 small">Set regular working hours for this employee.</p></div><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
        <div class="modal-body">
          <div id="scheduleStatus" class="small mb-3" role="status" aria-live="polite"></div>
          <fieldset id="scheduleEditor" disabled>
            <div class="schedule-builder">
              <h6 class="fw-bold mb-1">Add hours to multiple days</h6><p class="small text-muted mb-3">Choose the days, set the hours once, then add them to your week.</p>
              <div class="schedule-day-shortcuts" aria-label="Day selection shortcuts">
                ${[['weekdays', 'Weekdays'], ['weekend', 'Weekend'], ['all', 'All days'], ['none', 'Clear selection']].map(([value, label]) => `<button type="button" class="btn btn-sm btn-outline-secondary" data-days="${value}">${label}</button>`).join('')}
              </div>
              <div class="schedule-day-picker" role="group" aria-label="Days to add">
                ${DAYS.map((day, i) => `<input type="checkbox" class="btn-check" id="schedulePick${day}" value="${day}" ${i < 5 ? 'checked' : ''}><label class="btn schedule-day-choice" for="schedulePick${day}"><span aria-hidden="true">${day.slice(0, 3)}</span><span class="visually-hidden">${day}</span></label>`).join('')}
              </div>
              <div class="schedule-time-presets" aria-label="Suggested working hours"><span class="small text-muted">Quick times:</span>
                ${[['09:00', '17:00', '9 AM – 5 PM'], ['09:00', '12:00', 'Morning'], ['13:00', '17:00', 'Afternoon']].map(([start, end, label]) => `<button type="button" class="btn btn-sm btn-outline-secondary" data-start="${start}" data-end="${end}">${label}</button>`).join('')}
              </div>
              <div class="schedule-builder-times">
                <div><label for="scheduleBulkStart" class="form-label small fw-semibold">Start time</label><input id="scheduleBulkStart" type="time" step="60" class="form-control" value="09:00" required></div>
                <div><label for="scheduleBulkEnd" class="form-label small fw-semibold">End time</label><input id="scheduleBulkEnd" type="time" step="60" class="form-control" value="17:00" required></div>
                <button type="button" class="btn schedule-add-button" id="scheduleApplyDays"><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>Add to selected days</button>
              </div>
            </div>
            <div class="d-flex justify-content-between align-items-center gap-2 mt-4 mb-3 flex-wrap"><h6 class="fw-bold mb-0">Weekly overview</h6><span id="scheduleSummary" class="small text-muted"></span></div>
            <div id="scheduleRows" class="schedule-week">
              ${DAYS.map(day => `<section class="schedule-day-card" data-day="${day}" aria-labelledby="scheduleHeading${day}"><div class="schedule-day-header"><h6 id="scheduleHeading${day}" class="mb-0">${day}</h6><button type="button" class="btn schedule-day-add" data-add-day="${day}" aria-label="Add shift on ${day}" title="Add shift on ${day}"><i class="bi bi-plus-lg" aria-hidden="true"></i></button></div><div class="schedule-day-shifts"></div><p class="schedule-off mb-0 small text-muted">No hours scheduled</p></section>`).join('')}
            </div>
          </fieldset>
        </div>
        <div class="modal-footer"><span class="small text-muted me-auto">Changes apply when you save.</span><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button><button type="button" class="btn btn-primary" id="scheduleSaveButton">Save schedule</button></div>
      </div></div>
    </div>`);
    const modal = document.getElementById('scheduleModal');
    modal.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button || button.disabled || document.getElementById('scheduleEditor').disabled) return;
        if (button.dataset.days) modal.querySelectorAll('.schedule-day-picker input').forEach((input, i) => {
            input.checked = button.dataset.days === 'all' || (button.dataset.days === 'weekdays' && i < 5) || (button.dataset.days === 'weekend' && i >= 5);
        });
        if (button.dataset.start) {
            document.getElementById('scheduleBulkStart').value = button.dataset.start;
            document.getElementById('scheduleBulkEnd').value = button.dataset.end;
        }
        if (button.dataset.addDay) {
            const previous = button.closest('.schedule-day-card').querySelector('.schedule-shift:last-child');
            const row = addScheduleRow({ day_of_week: button.dataset.addDay, start_time: previous?.querySelector('.sched-start').value || document.getElementById('scheduleBulkStart').value, end_time: previous?.querySelector('.sched-end').value || document.getElementById('scheduleBulkEnd').value });
            row.querySelector('.sched-start').focus();
        }
        if (button.matches('.schedule-remove')) {
            const card = button.closest('.schedule-day-card');
            button.closest('.schedule-shift').remove();
            updateSummary();
            card.querySelector('[data-add-day]').focus();
        }
    });
    modal.addEventListener('input', updateSummary);
    modal.addEventListener('hide.bs.modal', event => { if (saving) event.preventDefault(); });
    document.getElementById('scheduleApplyDays').addEventListener('click', applySelectedDays);
    document.getElementById('scheduleSaveButton').addEventListener('click', saveSchedule);
}

function setStatus(message, error = false) {
    const status = document.getElementById('scheduleStatus');
    status.textContent = message;
    status.classList.toggle('text-danger', error);
    status.classList.toggle('text-muted', !error);
}

function updateSummary() {
    let count = 0, activeDays = 0, minutes = 0;
    document.querySelectorAll('#scheduleRows .schedule-day-card').forEach(card => {
        const shifts = card.querySelectorAll('.schedule-shift');
        card.querySelector('.schedule-off').hidden = shifts.length > 0;
        card.classList.toggle('has-shifts', shifts.length > 0);
        count += shifts.length;
        if (shifts.length) activeDays++;
        shifts.forEach(shift => {
            const start = shift.querySelector('.sched-start').value;
            const end = shift.querySelector('.sched-end').value;
            if (start && end && end > start) {
                const toMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
                minutes += toMinutes(end) - toMinutes(start);
            }
        });
    });
    document.getElementById('scheduleSummary').textContent = `${activeDays} days · ${count} shifts · ${Number((minutes / 60).toFixed(1))} hrs`;
}

export async function openEmployeeScheduleModal(id, employeeName = '') {
    if (!canManageSchedule()) {
        Swal.fire('Access Restricted', 'You do not have permission to manage employee schedules.', 'warning');
        return;
    }
    if (saving) return;
    injectScheduleModal();
    currentScheduleEmpId = id;
    const version = ++loadVersion;
    document.getElementById('employeeScheduleTitle').textContent = employeeName ? `Weekly schedule · ${employeeName}` : 'Weekly schedule';
    document.querySelectorAll('#scheduleRows .schedule-day-shifts').forEach(container => container.replaceChildren());
    document.querySelectorAll('.schedule-day-picker input').forEach((input, i) => { input.checked = i < 5; });
    document.getElementById('scheduleBulkStart').value = '09:00';
    document.getElementById('scheduleBulkEnd').value = '17:00';
    updateSummary();
    setStatus('Loading weekly schedule…');
    document.getElementById('scheduleEditor').disabled = true;
    document.getElementById('scheduleSaveButton').disabled = true;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('scheduleModal')).show();
    try {
        const res = await axios.get(`../../api/admin/employee.php?operation=getSchedule&id=${encodeURIComponent(id)}`);
        if (version !== loadVersion) return;
        if (res.data.status !== 'success' || !Array.isArray(res.data.data)) throw new Error(res.data.message || 'Unable to load schedule.');
        res.data.data.forEach(addScheduleRow);
        document.getElementById('scheduleEditor').disabled = false;
        document.getElementById('scheduleSaveButton').disabled = false;
        setStatus(res.data.data.length ? 'Your saved hours are ready to edit.' : 'No hours yet. Add a shift to your selected days to get started.');
    } catch (err) {
        if (version !== loadVersion) return;
        console.error(err);
        setStatus('Could not load the schedule. Close this window and try again.', true);
    }
}

function addScheduleRow(data = null) {
    const day = data?.day_of_week || 'Monday';
    if (!DAYS.includes(day)) return null;
    const card = document.querySelector(`#scheduleRows [data-day="${day}"]`);
    const row = document.createElement('div');
    row.className = 'schedule-shift';
    row.dataset.day = day;
    row.innerHTML = `<label class="schedule-shift-time"><span class="small text-muted">Start</span><input type="time" step="1" class="form-control form-control-sm sched-start" aria-label="${day} shift start time" required></label><span class="schedule-time-arrow" aria-hidden="true">–</span><label class="schedule-shift-time"><span class="small text-muted">End</span><input type="time" step="1" class="form-control form-control-sm sched-end" aria-label="${day} shift end time" required></label><button type="button" class="btn btn-sm btn-outline-danger schedule-remove" aria-label="Remove ${day} shift"><i class="bi bi-trash" aria-hidden="true"></i></button>`;
    row.querySelector('.sched-start').value = data?.start_time || document.getElementById('scheduleBulkStart').value;
    row.querySelector('.sched-end').value = data?.end_time || document.getElementById('scheduleBulkEnd').value;
    row.querySelectorAll('input').forEach(input => {
        // Keep stored second precision when present; ordinary shifts use minutes.
        input.step = input.value.length > 5 && input.value.slice(6) !== '00' ? '1' : '60';
    });
    card.querySelector('.schedule-day-shifts').appendChild(row);
    updateSummary();
    return row;
}

function validTimes(startInput, endInput) {
    for (const input of [startInput, endInput]) {
        if (!input.value || !input.checkValidity()) {
            setStatus('Choose a valid start and end time for every shift.', true);
            input.focus();
            input.reportValidity();
            return false;
        }
    }
    if (normalizeTime(startInput.value) >= normalizeTime(endInput.value)) {
        setStatus('End time must be later than start time.', true);
        endInput.focus();
        return false;
    }
    return true;
}

function normalizeTime(value) { return value.length === 5 ? `${value}:00` : value; }

function applySelectedDays() {
    if (document.getElementById('scheduleEditor').disabled) return;
    const days = [...document.querySelectorAll('.schedule-day-picker input:checked')].map(input => input.value);
    if (!days.length) {
        setStatus('Select at least one day to add hours.', true);
        document.getElementById('schedulePickMonday').focus();
        return;
    }
    const start = document.getElementById('scheduleBulkStart');
    const end = document.getElementById('scheduleBulkEnd');
    if (!validTimes(start, end)) return;
    let added = 0;
    days.forEach(day => {
        const existing = [...document.querySelectorAll(`#scheduleRows [data-day="${day}"] .schedule-shift`)];
        if (existing.some(row => normalizeTime(row.querySelector('.sched-start').value) === normalizeTime(start.value) && normalizeTime(row.querySelector('.sched-end').value) === normalizeTime(end.value))) return;
        addScheduleRow({ day_of_week: day, start_time: start.value, end_time: end.value });
        added++;
    });
    const skipped = days.length - added;
    setStatus(`${added} ${added === 1 ? 'shift added' : 'shifts added'}.${skipped ? ` ${skipped} matching ${skipped === 1 ? 'shift already exists' : 'shifts already exist'}.` : ''} Save when your week is ready.`);
}

async function saveSchedule() {
    if (!canManageSchedule()) {
        Swal.fire('Access Restricted', 'You do not have permission to manage employee schedules.', 'warning');
        return;
    }
    const saveButton = document.getElementById('scheduleSaveButton');
    if (!currentScheduleEmpId || saveButton.disabled) return;
    const schedules = [], seen = new Set();
    for (const row of document.querySelectorAll('#scheduleRows .schedule-shift')) {
        const day = row.dataset.day;
        const startInput = row.querySelector('.sched-start');
        const endInput = row.querySelector('.sched-end');
        if (!validTimes(startInput, endInput)) return;
        const start = startInput.value, end = endInput.value;
        const key = `${day}|${normalizeTime(start)}|${normalizeTime(end)}`;
        if (seen.has(key)) {
            setStatus(`This shift is listed twice on ${day}. Remove the duplicate before saving.`, true);
            startInput.focus();
            return;
        }
        seen.add(key);
        schedules.push({ day, start, end });
    }
    saving = true;
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    document.getElementById('scheduleEditor').disabled = true;
    try {
        const res = await axios.post('../../api/admin/employee.php', { operation: 'saveSchedule', json: JSON.stringify({ employee_id: currentScheduleEmpId, schedules }) });
        if (res.data.status !== 'success') throw new Error(res.data.message || 'Failed to save schedule.');
        saving = false;
        bootstrap.Modal.getInstance(document.getElementById('scheduleModal')).hide();
        Swal.fire('Saved', 'Schedule updated successfully', 'success');
    } catch (err) {
        console.error(err);
        setStatus(err.response?.data?.message || err.message || 'Failed to save schedule. Please try again.', true);
    } finally {
        saving = false;
        saveButton.disabled = false;
        saveButton.textContent = 'Save schedule';
        document.getElementById('scheduleEditor').disabled = false;
    }
}

window.addScheduleRow = addScheduleRow;
window.openScheduleModal = openEmployeeScheduleModal;
window.saveSchedule = saveSchedule;
