// js/modules/edit_enrollment.js
import { guardEnrollmentPermission } from './enrollment_rbac.js';

let editLookups = {};
let editEnrollmentDetails = null;
let editSubjectIds = [];
let editSchedules = [];

window.teacherAvailableDates = [];
window.teacherAvailableSlots = [];
window.teacherBookedSlots = [];
window.teacherAvailableSlotsPerDate = {};
window.teacherFullShiftsPerDate = {};

function optionList(items, valueKey, labelKey, selectedValue = '') {
    return (items || []).map(item => {
        const selected = String(item[valueKey]) === String(selectedValue) ? ' selected' : '';
        return `<option value="${item[valueKey]}"${selected}>${item[labelKey]}</option>`;
    }).join('');
}

function getProgramTypeName(program) {
    if (!program) return '';
    if (program.type_name) return program.type_name;
    const type = (editLookups.program_types || []).find(item => String(item.program_type_id) === String(program.program_type));
    return type ? type.type : '';
}

function getProgramName(program) {
    const type = getProgramTypeName(program);
    return type ? `${program.name} (${type})` : program.name;
}

function formatStudentName(details = {}) {
    return [details.first_name, details.last_name, details.ext]
        .filter(part => part && part.toString().trim())
        .map(part => part.toString().trim())
        .join(' ');
}

function getSubjectName(subjectId) {
    const subject = (editLookups.subjects || []).find(item => String(item.subject_id) === String(subjectId));
    return subject ? subject.subject_name : `Subject ${subjectId}`;
}

function getSelectedProgram() {
    const programId = document.getElementById('editProgramId')?.value;
    return (editLookups.programs || []).find(program => String(program.program_id) === String(programId));
}

function updateProgramFee() {
    const program = getSelectedProgram();
    const feeInput = document.getElementById('editTotalFee');
    if (feeInput && program) {
        feeInput.value = parseFloat(program.tuition || 0).toFixed(2);
    }
}

function ensureEditEnrollmentStyles() {
    if (document.getElementById('editEnrollmentTutorialStyles')) return;

    const style = document.createElement('style');
    style.id = 'editEnrollmentTutorialStyles';
    style.textContent = `
        .edit-enrollment-popup { --tutorial-accent:#e85d88; --tutorial-accent-dark:#d94f7a; --tutorial-soft:#fff0f5; --tutorial-border:#f5c6d5; --tutorial-neutral-border:#dfe3ea; --tutorial-text:#172033; --tutorial-muted:#697386; border-radius:20px !important; overflow:hidden; }
        .edit-enrollment-popup .swal2-title { display:flex; align-items:center; gap:16px; padding:18px 28px; color:var(--tutorial-text); font-size:25px; font-weight:750; text-align:left; border-bottom:1px solid #edf0f4; }
        .edit-enrollment-popup .edit-title-icon { display:inline-flex; align-items:center; justify-content:center; width:44px; height:44px; color:var(--tutorial-accent); background:var(--tutorial-soft); border:1px solid var(--tutorial-border); border-radius:10px; font-size:21px; }
        .edit-enrollment-popup .swal2-html-container { margin:0; padding:15px 28px 8px; text-align:left; }
        .edit-enrollment-popup .swal2-actions { width:100%; margin:0; padding:14px 28px 18px; justify-content:flex-end; gap:12px; border-top:1px solid #edf0f4; }
        .edit-enrollment-popup .edit-enrollment-alert { display:flex; align-items:center; gap:14px; min-height:52px; margin-bottom:14px; padding:13px 18px; color:var(--tutorial-text); border:1px solid var(--tutorial-border); border-radius:9px; background:#fff9fb; }
        .edit-enrollment-popup .edit-enrollment-alert i, .edit-enrollment-popup .edit-enrollment-alert strong { color:var(--tutorial-accent-dark); }
        .edit-enrollment-popup .edit-enrollment-alert i { font-size:20px; }
        .edit-enrollment-popup .tutorial-section { margin-bottom:14px; padding:18px; border:1px solid var(--tutorial-border); border-radius:12px; background:#fff; }
        .edit-enrollment-popup .tutorial-section-title { display:flex; align-items:center; gap:12px; margin:0 0 15px; color:var(--tutorial-text); font-size:18px; font-weight:700; }
        .edit-enrollment-popup .tutorial-section-icon { display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; color:var(--tutorial-accent); background:var(--tutorial-soft); border:1px solid var(--tutorial-border); border-radius:10px; font-size:16px; }
        .edit-enrollment-popup .form-label { margin-bottom:7px; color:var(--tutorial-text); font-size:13px; font-weight:500; }
        .edit-enrollment-popup .form-control, .edit-enrollment-popup .form-select { min-height:44px; color:var(--tutorial-text); border-color:var(--tutorial-neutral-border); border-radius:7px; font-size:14px; }
        .edit-enrollment-popup .form-control:focus, .edit-enrollment-popup .form-select:focus { border-color:var(--tutorial-accent); box-shadow:0 0 0 .2rem rgba(232,93,136,.12); }
        .edit-enrollment-popup .tutorial-subject-control { display:flex; gap:10px; }
        .edit-enrollment-popup .tutorial-subject-control .form-select { flex:1; }
        .edit-enrollment-popup .tutorial-add-btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; min-width:96px; min-height:44px; color:var(--tutorial-accent-dark); border:1px solid var(--tutorial-accent); background:#fff; border-radius:7px; font-weight:600; }
        .edit-enrollment-popup .tutorial-add-btn:hover { color:#fff; background:var(--tutorial-accent); }
        .edit-enrollment-popup .tutorial-subject-badge { display:inline-flex; align-items:center; gap:5px; padding:7px 9px; color:var(--tutorial-accent-dark); border:1px solid var(--tutorial-border); border-radius:7px; background:var(--tutorial-soft); }
        .edit-enrollment-popup .tutorial-schedule-grid { display:grid; grid-template-columns:1.15fr 1fr 1fr auto; gap:14px; align-items:end; }
        .edit-enrollment-popup .tutorial-date-field { position:relative; }
        .edit-enrollment-popup .tutorial-schedule-table { margin-top:13px; margin-bottom:0; border-color:#e1e4e9; }
        .edit-enrollment-popup .tutorial-schedule-table thead th { padding:10px; color:var(--tutorial-text); background:var(--tutorial-soft); border-color:#ead9df; font-size:12px; }
        .edit-enrollment-popup .tutorial-schedule-table tbody td { padding:10px; vertical-align:middle; font-size:13px; }
        .edit-enrollment-popup .tutorial-schedule-table .badge { color:var(--tutorial-accent-dark) !important; background:var(--tutorial-soft) !important; }
        .edit-enrollment-popup .tutorial-schedule-table .btn-outline-danger { color:var(--tutorial-accent-dark); border-color:var(--tutorial-border); }
        .edit-enrollment-popup .edit-unit-preview { margin-bottom:14px; padding:10px 18px; border:1px solid var(--tutorial-border); border-radius:9px; background:#fff8fb; color:var(--tutorial-text); }
        .edit-enrollment-popup .edit-save-button { min-width:170px; min-height:45px; padding:10px 24px; color:#fff !important; border:0 !important; border-radius:8px !important; background:linear-gradient(100deg,#e85d88,#f07ba0) !important; box-shadow:0 9px 20px rgba(232,93,136,.22); font-weight:600; }
        .edit-enrollment-popup .edit-cancel-button { min-width:105px; min-height:45px; padding:10px 24px; color:var(--tutorial-text) !important; border:1px solid var(--tutorial-neutral-border) !important; border-radius:8px !important; background:#fff !important; font-weight:600; }
        @media (max-width:767.98px) { .edit-enrollment-popup .swal2-title, .edit-enrollment-popup .swal2-html-container, .edit-enrollment-popup .swal2-actions { padding-left:18px; padding-right:18px; } .edit-enrollment-popup .tutorial-schedule-grid { grid-template-columns:1fr; } .edit-enrollment-popup .edit-save-button, .edit-enrollment-popup .edit-cancel-button { flex:1; min-width:0; } }
    `;
    document.head.appendChild(style);
}

function renderEditSubjects() {
    const list = document.getElementById('editSelectedSubjects');
    if (!list) return;

    if (editSubjectIds.length === 0) {
        list.innerHTML = '<span class="text-muted small">No subjects added yet.</span>';
        return;
    }

    list.innerHTML = editSubjectIds.map(subjectId => `
        <span class="tutorial-subject-badge">
            ${getSubjectName(subjectId)}
            <button type="button" class="btn-close btn-close-sm ms-1" aria-label="Remove ${getSubjectName(subjectId)}" onclick="removeEditSubject('${subjectId}')"></button>
        </span>
    `).join('');
}

function renderEditSchedules() {
    const tbody = document.getElementById('editProperScheduleBody');
    if (!tbody) return;

    if (editSchedules.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No schedules added yet.</td></tr>';
        return;
    }

    tbody.innerHTML = editSchedules.map((item, index) => `
        <tr>
            <td>${item.date || 'N/A'}</td>
            <td><span class="badge bg-secondary">${item.day || ''}</span></td>
            <td>
                <div class="d-flex align-items-center gap-2">
                    <input type="time" class="form-control form-control-sm" value="${item.time || '12:00'}" aria-label="Start time" onchange="updateEditProperScheduleTime(${index}, 'time', this.value)">
                    <span class="text-muted">-</span>
                    <input type="time" class="form-control form-control-sm" value="${item.endTime || '13:00'}" aria-label="End time" onchange="updateEditProperScheduleTime(${index}, 'endTime', this.value)">
                </div>
            </td>
            <td class="text-center">
                <button type="button" class="btn btn-sm btn-outline-danger" onclick="removeEditProperSchedule(${index})">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function buildPreferredTimeDay() {
    return editSchedules
        .map(s => `${s.day} ${s.time}${s.endTime ? ' - ' + s.endTime : ''}`)
        .join(', ');
}

function calculateEditScheduleMinutes(schedules = editSchedules) {
    return (Array.isArray(schedules) ? schedules : []).reduce((total, schedule) => {
        const start = parseTimeToMinutes(schedule?.time);
        const end = parseTimeToMinutes(schedule?.endTime);
        return end > start ? total + (end - start) : total;
    }, 0);
}

function getEditProgramScheduleRequirement(schedules = editSchedules) {
    const program = getSelectedProgram();
    const requiredUnits = parseFloat(program?.total_units || 0);
    const requiredMinutes = requiredUnits > 0 ? Math.round(requiredUnits * 60) : 0;
    const currentMinutes = calculateEditScheduleMinutes(schedules);
    const applicable = Boolean(program && String(program.unit_type || '').toLowerCase() === 'session' && requiredMinutes > 0);

    return {
        applicable,
        requiredMinutes,
        currentMinutes,
        differenceMinutes: requiredMinutes - currentMinutes,
        matches: !applicable || requiredMinutes === currentMinutes
    };
}

function formatEditScheduleUnits(minutes) {
    const units = Math.max(0, minutes) / 60;
    return Number.isInteger(units) ? String(units) : units.toFixed(2).replace(/\.?0+$/, '');
}

function showEditScheduleRequirementAlert(validation, title = 'Schedule Requirement') {
    const required = formatEditScheduleUnits(validation.requiredMinutes);
    const current = formatEditScheduleUnits(validation.currentMinutes);
    const difference = formatEditScheduleUnits(Math.abs(validation.differenceMinutes));
    let message = `This tutorial requires exactly ${required} session unit(s). Current total: ${current}.`;
    if (validation.differenceMinutes > 0) message += ` Add ${difference} more session unit(s) to match the program.`;
    if (validation.differenceMinutes < 0) message += ` Remove ${difference} session unit(s) to match the program.`;
    Swal.fire(title, message, 'warning');
}

function updateEditProgramSchedulePreview() {
    const preview = document.getElementById('editUnitPreview');
    if (!preview) return;

    const validation = getEditProgramScheduleRequirement();
    if (!validation.applicable) {
        preview.style.display = 'none';
        return;
    }

    preview.style.display = '';
    document.getElementById('editRequiredUnits').textContent = formatEditScheduleUnits(validation.requiredMinutes);
    document.getElementById('editCurrentUnits').textContent = formatEditScheduleUnits(validation.currentMinutes);
    const status = document.getElementById('editUnitStatus');
    if (validation.matches) {
        status.textContent = 'Matched';
        status.className = 'badge bg-success ms-2';
    } else if (validation.differenceMinutes > 0) {
        status.textContent = `Needs ${formatEditScheduleUnits(validation.differenceMinutes)} more`;
        status.className = 'badge bg-warning ms-2';
    } else {
        status.textContent = `Over by ${formatEditScheduleUnits(Math.abs(validation.differenceMinutes))}`;
        status.className = 'badge bg-danger ms-2';
    }
}

function getDayName(dateValue) {
    const date = new Date(`${dateValue}T00:00:00`);
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
}

function normalizeTime(timeValue) {
    return timeValue ? String(timeValue).slice(0, 5) : '';
}

function parseTimeToMinutes(timeString) {
    if (!timeString) return 0;
    const [hours, minutes] = String(timeString).split(':');
    return (parseInt(hours, 10) || 0) * 60 + (parseInt(minutes, 10) || 0);
}

function minutesToTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function subtractInterval(intervals, bStart, bEnd) {
    const result = [];
    intervals.forEach(int => {
        if (bEnd <= int.start || bStart >= int.end) {
            result.push(int);
        } else {
            if (bStart > int.start) {
                result.push({ start: int.start, end: bStart });
            }
            if (bEnd < int.end) {
                result.push({ start: bEnd, end: int.end });
            }
        }
    });
    return result;
}

function mergeTimeIntervals(intervals) {
    return intervals
        .filter(interval => interval.end > interval.start)
        .sort((a, b) => a.start - b.start)
        .reduce((merged, interval) => {
            const previous = merged[merged.length - 1];
            if (!previous || interval.start > previous.end) {
                merged.push({ ...interval });
            } else {
                previous.end = Math.max(previous.end, interval.end);
            }
            return merged;
        }, []);
}

function getAvailableTeacherDates(slots, bookings, daysAhead = 180) {
    if (!Array.isArray(slots) || slots.length === 0) return [];

    const bookingsByDate = {};
    (bookings || []).forEach(b => {
        if (!bookingsByDate[b.date]) bookingsByDate[b.date] = [];
        bookingsByDate[b.date].push({ start: b.start_time || b.start, end: b.end_time || b.end });
    });

    const dates = [];
    const today = new Date();
    for (let i = 0; i <= daysAhead; i++) {
        const current = new Date(today);
        current.setDate(today.getDate() + i);
        const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][current.getDay()];
        const formatted = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
        const daySlots = slots.filter(s => String(s.day_of_week || s.day).toLowerCase() === dayName.toLowerCase());
        if (daySlots.length === 0) continue;

        // A teacher may have separate morning and afternoon/evening shifts.
        // Preserve every shift instead of taking only the first row for a day.
        const fullShifts = mergeTimeIntervals(daySlots.map(shift => ({
            start: parseTimeToMinutes(shift.start_time),
            end: parseTimeToMinutes(shift.end_time)
        })));
        if (fullShifts.length === 0) continue;

        window.teacherFullShiftsPerDate[formatted] = {
            start: minutesToTime(fullShifts[0].start),
            end: minutesToTime(fullShifts[fullShifts.length - 1].end),
            totalMinutes: fullShifts.reduce((total, shift) => total + (shift.end - shift.start), 0)
        };
        let remaining = fullShifts.map(shift => ({ ...shift }));

        const booked = bookingsByDate[formatted] || [];
        booked.forEach(b => {
            const bStart = parseTimeToMinutes(b.start);
            const bEnd = parseTimeToMinutes(b.end);
            remaining = subtractInterval(remaining, bStart, bEnd);
        });

        if (remaining.length > 0) {
            window.teacherAvailableSlotsPerDate[formatted] = remaining.map(r => ({
                start: minutesToTime(r.start),
                end: minutesToTime(r.end)
            }));
            dates.push(formatted);
        }
    }

    return dates;
}

function populateEditAvailableDateOptions() {
    const dateInput = document.getElementById('editScheduleDateInput');
    const hiddenDate = document.getElementById('editScheduleDate');
    if (dateInput) {
        if (!window.teacherAvailableDates || window.teacherAvailableDates.length === 0) {
            dateInput.value = '';
            dateInput.placeholder = 'Select a teacher to load dates';
        } else {
            dateInput.value = '';
            dateInput.placeholder = 'Click to pick date';
        }
    }
    if (hiddenDate) {
        hiddenDate.value = '';
    }
}

window.validateEditTeacherDateSelection = function() {
    const teacherId = document.getElementById('editTeacherId')?.value;
    const dateValue = document.getElementById('editScheduleDate')?.value;
    if (!teacherId || !dateValue || !window.teacherAvailableDates?.length) return true;

    if (!window.teacherAvailableDates.includes(dateValue)) {
        Swal.fire('Date Not Available', 'Please select a date that is available for this teacher.', 'warning');
        document.getElementById('editScheduleDate').value = '';
        document.getElementById('editScheduleDateInput').value = '';
        return false;
    }
    return true;
};

window.handleEditTeacherChange = function() {
    window.teacherAvailableSlots = [];
    window.teacherBookedSlots = [];
    window.teacherAvailableDates = [];
    window.teacherAvailableSlotsPerDate = {};
    window.teacherFullShiftsPerDate = {};

    const teacherId = document.getElementById('editTeacherId')?.value;
    const dateInput = document.getElementById('editScheduleDateInput');
    const hiddenDate = document.getElementById('editScheduleDate');
    const calendarContainer = document.getElementById('editDateCalendarContainer');

    if (dateInput) {
        dateInput.value = teacherId ? 'Loading...' : '';
        dateInput.placeholder = teacherId ? 'Loading available dates...' : 'Select a teacher first';
    }
    if (hiddenDate) hiddenDate.value = '';
    if (calendarContainer) calendarContainer.style.display = 'none';

    if (!teacherId) {
        return;
    }

    const excludeEnrollmentId = editEnrollmentDetails?.enrollment_details_id
        || document.getElementById('editEnrollmentId')?.value
        || '';
    axios.get('../../api/admin/enrollment.php', {
        params: {
            operation: 'getTeacherAvailableSlots',
            teacher_id: teacherId,
            exclude_enrollment_id: excludeEnrollmentId,
            _request_time: Date.now()
        }
    })
        .then(res => {
            if (res.data.status === 'success') {
                window.teacherAvailableSlots = res.data.data.slots || [];
                window.teacherBookedSlots = res.data.data.bookings || [];
                window.teacherAvailableDates = getAvailableTeacherDates(window.teacherAvailableSlots, window.teacherBookedSlots, 180);

                if (dateInput) {
                    dateInput.value = '';
                    dateInput.placeholder = 'Click to pick date';
                }

                if (window.setupDatePicker) {
                    window.setupDatePicker({
                        dateInputId: 'editScheduleDateInput',
                        hiddenDateId: 'editScheduleDate',
                        containerId: 'editDateCalendarContainer',
                        startTimeId: 'editScheduleStart',
                        endTimeId: 'editScheduleEnd',
                        teacherSelectId: 'editTeacherId',
                        validateCallback: window.validateEditTeacherDateSelection,
                        parseTimeToMinutes
                    });
                }
            } else {
                if (dateInput) {
                    dateInput.value = '';
                    dateInput.placeholder = 'No dates available';
                }
            }
        })
        .catch(err => {
            console.error('Error loading teacher availability:', err);
            if (dateInput) {
                dateInput.value = '';
                dateInput.placeholder = 'Unable to load dates';
            }
        });
};

async function filterEditTeachers(keepTeacherId = null) {
    const teacherSelect = document.getElementById('editTeacherId');
    const programId = document.getElementById('editProgramId')?.value;
    if (!teacherSelect) return;

    if (!programId || editSubjectIds.length === 0) {
        teacherSelect.innerHTML = '<option value="">Select Teacher</option>' + optionList(editLookups.teachers, 'employee_id', 'name', keepTeacherId || '');
        populateEditAvailableDateOptions();
        return;
    }

    teacherSelect.innerHTML = '<option value="">Loading matching teachers...</option>';
    const schedulesJson = JSON.stringify(editSchedules);
    try {
        const excludeId = editEnrollmentDetails?.enrollment_details_id || document.getElementById('editEnrollmentId')?.value || '';
        const res = await axios.get(`../../api/admin/enrollment.php?operation=getFilteredTeachers&program_id=${programId}&subject_ids=${encodeURIComponent(editSubjectIds.join(','))}&preferred_schedules=${encodeURIComponent(schedulesJson)}&exclude_enrollment_id=${encodeURIComponent(excludeId)}`);
        const teachers = res.data.status === 'success' ? (res.data.data || []) : [];
        teacherSelect.innerHTML = '<option value="">Select Teacher</option>';
        if (teachers.length === 0) {
            teacherSelect.innerHTML += '<option disabled>No matching teachers found</option>';
        } else {
            teacherSelect.innerHTML += optionList(teachers, 'employee_id', 'name', keepTeacherId || '');
        }
        if (teacherSelect.value) {
            handleEditTeacherChange();
        }
    } catch (err) {
        console.error('Error filtering edit teachers:', err);
        teacherSelect.innerHTML = '<option value="">Unable to load teachers</option>';
    }
}

window.addEditSubject = function() {
    const select = document.getElementById('editSubjectSelect');
    if (!select || !select.value) {
        Swal.fire('Subject Required', 'Please choose a subject to add.', 'warning');
        return;
    }
    if (editSubjectIds.includes(select.value)) {
        Swal.fire('Already Added', 'That subject is already in the list.', 'info');
        return;
    }

    editSubjectIds.push(select.value);
    select.value = '';
    renderEditSubjects();
    filterEditTeachers(document.getElementById('editTeacherId')?.value || editEnrollmentDetails?.preferred_teacher || null);
};

window.removeEditSubject = function(subjectId) {
    editSubjectIds = editSubjectIds.filter(id => String(id) !== String(subjectId));
    renderEditSubjects();
    filterEditTeachers(document.getElementById('editTeacherId')?.value || editEnrollmentDetails?.preferred_teacher || null);
};

window.addEditProperSchedule = function() {
    const date = document.getElementById('editScheduleDate')?.value;
    const time = document.getElementById('editScheduleStart')?.value;
    const endTime = document.getElementById('editScheduleEnd')?.value;

    if (!date || !time || !endTime) {
        Swal.fire('Missing Schedule', 'Please select date, start time, and end time.', 'warning');
        return;
    }
    if (endTime <= time) {
        Swal.fire('Invalid Time', 'End time must be after start time.', 'warning');
        return;
    }

    const teacherId = document.getElementById('editTeacherId')?.value;
    if (teacherId) {
        const availableSlots = window.teacherAvailableSlotsPerDate[date];
        const startMinutes = parseTimeToMinutes(time);
        const endMinutes = parseTimeToMinutes(endTime);
        const fitsAvailableSlot = availableSlots?.some(slot =>
            startMinutes >= parseTimeToMinutes(slot.start) && endMinutes <= parseTimeToMinutes(slot.end)
        );
        if (!fitsAvailableSlot) {
            Swal.fire('Time Not Available', 'The selected time is not within the available slots for this teacher on this date.', 'warning');
            return;
        }
    }

    if (editSchedules.some(schedule => schedule.date === date && schedule.time === time && schedule.endTime === endTime)) {
        Swal.fire('Duplicate Schedule', 'This schedule has already been added. Please choose a different date or time.', 'warning');
        return;
    }

    const nextSchedule = { date, day: getDayName(date), time, endTime };
    const requirement = getEditProgramScheduleRequirement([...editSchedules, nextSchedule]);
    if (requirement.applicable && requirement.differenceMinutes < 0) {
        showEditScheduleRequirementAlert(requirement, 'Too Many Session Units');
        return;
    }

    editSchedules.push(nextSchedule);
    editSchedules.sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`));
    renderEditSchedules();
    updateEditProgramSchedulePreview();
    filterEditTeachers(document.getElementById('editTeacherId')?.value || editEnrollmentDetails?.preferred_teacher || null);
};

window.removeEditProperSchedule = function(index) {
    editSchedules.splice(index, 1);
    renderEditSchedules();
    updateEditProgramSchedulePreview();
    filterEditTeachers(document.getElementById('editTeacherId')?.value || editEnrollmentDetails?.preferred_teacher || null);
};

window.updateEditProperScheduleTime = function(index, field, value) {
    const schedule = editSchedules[index];
    if (!schedule || !['time', 'endTime'].includes(field) || !value) return;

    const updatedSchedule = { ...schedule, [field]: value };
    if (parseTimeToMinutes(updatedSchedule.endTime) <= parseTimeToMinutes(updatedSchedule.time)) {
        Swal.fire('Invalid Time', 'End time must be after start time.', 'warning');
        renderEditSchedules();
        return;
    }

    if (editSchedules.some((item, itemIndex) => itemIndex !== index && item.date === updatedSchedule.date && item.time === updatedSchedule.time && item.endTime === updatedSchedule.endTime)) {
        Swal.fire('Duplicate Schedule', 'This schedule has already been added. Please choose a different date or time.', 'warning');
        renderEditSchedules();
        return;
    }

    const nextSchedules = editSchedules.map((item, itemIndex) => itemIndex === index ? updatedSchedule : item);
    const requirement = getEditProgramScheduleRequirement(nextSchedules);
    if (requirement.applicable && requirement.differenceMinutes < 0) {
        showEditScheduleRequirementAlert(requirement, 'Too Many Session Units');
        renderEditSchedules();
        return;
    }

    editSchedules = nextSchedules.sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`));
    renderEditSchedules();
    updateEditProgramSchedulePreview();
    filterEditTeachers(document.getElementById('editTeacherId')?.value || editEnrollmentDetails?.preferred_teacher || null);
};

function buildEditHtml(details) {
    const tutorials = (editLookups.programs || []).filter(program => program.program_type == 1 || program.program_type == 2);
    const programOptions = tutorials.map(program => {
        const selected = String(program.program_id) === String(details.program_id) ? ' selected' : '';
        return `<option value="${program.program_id}" data-tuition="${program.tuition || 0}"${selected}>${getProgramName(program)}</option>`;
    }).join('');

    return `
        <div class="text-start edit-enrollment-content">
            <div class="edit-enrollment-alert">
                <i class="bi bi-info-circle"></i>
                <span><strong>Tutorial Enrollment</strong> for ${formatStudentName(details)}</span>
            </div>
            <input type="hidden" id="editEnrollmentId" value="${details.enrollment_details_id}">
            <section class="tutorial-section">
                <h3 class="tutorial-section-title"><span class="tutorial-section-icon"><i class="bi bi-mortarboard-fill"></i></span><span>Program &amp; Assignment</span></h3>
                <div class="row g-3">
                <div class="col-md-6">
                    <label class="form-label">Program</label>
                    <select class="form-select" id="editProgramId" onchange="updateEditProgramSelection()">
                        <option value="">Select Tutorial</option>
                        ${programOptions}
                    </select>
                </div>
                <div class="col-md-6">
                    <label class="form-label">Grade Level</label>
                    <select class="form-select" id="editGradeLevelId">
                        <option value="">Select Grade</option>
                        ${optionList(editLookups.grade_levels_all || editLookups.grade_levels, 'grade_level_id', 'grade_level', details.grade_level_id || '')}
                    </select>
                </div>
                <div class="col-md-6">
                    <label class="form-label">Subjects</label>
                    <div class="tutorial-subject-control">
                        <select class="form-select" id="editSubjectSelect">
                            <option value="">Select Subject</option>
                            ${optionList(editLookups.subjects, 'subject_id', 'subject_name')}
                        </select>
                        <button type="button" class="btn tutorial-add-btn" onclick="addEditSubject()">
                            <i class="bi bi-plus-lg"></i><span>Add</span>
                        </button>
                    </div>
                    <div id="editSelectedSubjects" class="mt-2 d-flex flex-wrap gap-2"></div>
                </div>
                <div class="col-md-6">
                    <label class="form-label">Teacher</label>
                    <select class="form-select" id="editTeacherId" onchange="handleEditTeacherChange()">
                        <option value="">Select Teacher</option>
                    </select>
                </div>
                </div>
            </section>
            <section class="tutorial-section tutorial-learning-section">
                <h3 class="tutorial-section-title"><span class="tutorial-section-icon"><i class="bi bi-bullseye"></i></span><span>Learning Goal</span></h3>
                <div class="col-12">
                    <label class="form-label">Learning Goal</label>
                    <textarea class="form-control" id="editGoal" rows="2">${details.goal || ''}</textarea>
                </div>
            </section>
            <div id="editUnitPreview" class="edit-unit-preview" style="display:none;">
                <strong>Required Units:</strong> <span id="editRequiredUnits">-</span>
                <strong class="ms-3">Current Schedule Units:</strong> <span id="editCurrentUnits">0</span>
                <span id="editUnitStatus" class="badge bg-warning ms-2">Needs more</span>
            </div>
            <section class="tutorial-section">
                <h3 class="tutorial-section-title"><span class="tutorial-section-icon"><i class="bi bi-calendar-week"></i></span><span>Schedule Preferences</span></h3>
                <div class="tutorial-schedule-grid">
                    <div class="tutorial-date-field">
                        <label class="form-label">Select Date</label>
                                    <input type="text" class="form-control" id="editScheduleDateInput" placeholder="Select a teacher to load dates" readonly>
                                    <input type="hidden" id="editScheduleDate">
                                    <div id="editDateCalendarContainer" style="display:none; position:absolute; top:100%; left:0; width:100%; z-index:1100;"></div>
                    </div>
                    <div><label class="form-label">Start Time</label><input type="time" class="form-control" id="editScheduleStart" value="12:00"></div>
                    <div><label class="form-label">End Time</label><input type="time" class="form-control" id="editScheduleEnd" value="13:00"></div>
                    <div><button type="button" class="btn tutorial-add-btn" onclick="addEditProperSchedule()"><i class="bi bi-plus-lg"></i><span>Add</span></button></div>
                </div>
                <div class="table-responsive">
                    <table class="table table-sm table-bordered bg-white tutorial-schedule-table">
                            <thead class="table-light"><tr><th>Date</th><th>Day</th><th>Start - End</th><th style="width:60px;">Action</th></tr></thead>
                            <tbody id="editProperScheduleBody"></tbody>
                        </table>
                </div>
            </section>
        </div>
    `;
}

window.updateEditProgramSelection = function() {
    updateProgramFee();
    updateEditProgramSchedulePreview();
    filterEditTeachers(document.getElementById('editTeacherId')?.value || editEnrollmentDetails?.preferred_teacher || null);
};

window.openFullEnrollmentEditor = async function(enrollmentId) {
    if (!guardEnrollmentPermission('edit', 'You do not have permission to update enrollment records.')) {
        return;
    }

    try {
        ensureEditEnrollmentStyles();
        Swal.fire({ title: 'Loading enrollment...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
        const [lookupRes, detailRes] = await Promise.all([
            axios.get('../../api/admin/enrollment.php?operation=getLookups'),
            axios.get(`../../api/admin/enrollment.php?operation=getEnrollmentDetails&id=${enrollmentId}`)
        ]);

        if (detailRes.data.status !== 'success') {
            Swal.fire('Error', detailRes.data.message || 'Unable to load enrollment details.', 'error');
            return;
        }

        editLookups = lookupRes.data || {};
        editEnrollmentDetails = detailRes.data.data.details || {};
        const scheduleRows = detailRes.data.data.schedule || [];
        const rawSubjectIds = editEnrollmentDetails.subject_ids || editEnrollmentDetails.subject_id || '';
        editSubjectIds = String(rawSubjectIds).split(',').filter(Boolean);
        editSchedules = scheduleRows.map(row => ({
            date: row.date,
            day: row.day,
            time: normalizeTime(row.start_time),
            endTime: normalizeTime(row.end_time) || null
        }));

        Swal.fire({
            title: '<span class="edit-title-icon" aria-hidden="true"><i class="bi bi-mortarboard-fill"></i></span><span>Edit Enrollment</span>',
            html: buildEditHtml(editEnrollmentDetails),
            width: '900px',
            showCancelButton: true,
            confirmButtonText: 'Save Changes',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#5a67d8',
            buttonsStyling: false,
            customClass: {
                popup: 'edit-enrollment-popup',
                confirmButton: 'edit-save-button',
                cancelButton: 'edit-cancel-button'
            },
            didOpen: async () => {
                renderEditSubjects();
                renderEditSchedules();
                updateProgramFee();
                updateEditProgramSchedulePreview();
                await filterEditTeachers(editEnrollmentDetails.preferred_teacher || null);

                import('./enrollmentDatePicker.js?v=20260812-edit-teacher-schedule').then(module => {
                    module.initEnrollmentDatePicker({
                        dateInputId: 'editScheduleDateInput',
                        hiddenDateId: 'editScheduleDate',
                        containerId: 'editDateCalendarContainer',
                        startTimeId: 'editScheduleStart',
                        endTimeId: 'editScheduleEnd',
                        teacherSelectId: 'editTeacherId',
                        validateCallback: window.validateEditTeacherDateSelection,
                        parseTimeToMinutes
                    });
                }).catch(err => {
                    console.error('Edit date picker load error:', err);
                }).finally(() => {
                    if (!document.getElementById('editTeacherId')?.value) {
                        populateEditAvailableDateOptions();
                    }
                });
            },
            preConfirm: () => {
                const programId = document.getElementById('editProgramId')?.value;
                const gradeLevelId = document.getElementById('editGradeLevelId')?.value;
                const teacherId = document.getElementById('editTeacherId')?.value;

                if (!programId) {
                    Swal.showValidationMessage('Please select a program.');
                    return false;
                }
                if (!gradeLevelId) {
                    Swal.showValidationMessage('Please select a grade level.');
                    return false;
                }
                if (editSubjectIds.length === 0) {
                    Swal.showValidationMessage('Please add at least one subject.');
                    return false;
                }
                if (!teacherId) {
                    Swal.showValidationMessage('Please select a teacher.');
                    return false;
                }

                const scheduleRequirement = getEditProgramScheduleRequirement();
                if (scheduleRequirement.applicable && !scheduleRequirement.matches) {
                    Swal.showValidationMessage(`Schedule must total exactly ${formatEditScheduleUnits(scheduleRequirement.requiredMinutes)} session unit(s).`);
                    return false;
                }

                return {
                    enrollment_details_id: enrollmentId,
                    program_id: programId,
                    grade_level_id: gradeLevelId,
                    subject_id: editSubjectIds[0],
                    subject_ids: editSubjectIds,
                    preferred_teacher: teacherId,
                    goal: document.getElementById('editGoal')?.value || null,
                    total_of_program: parseFloat(getSelectedProgram()?.tuition || 0),
                    preferred_time_day: buildPreferredTimeDay() || null,
                    preferences: editSchedules
                };
            }
        }).then(result => {
            if (!result.isConfirmed) return;

            axios.post('../../api/admin/enrollment.php', {
                operation: 'updateEnrollment',
                json: JSON.stringify(result.value)
            }).then(res => {
                if (res.data.status === 'success') {
                    Swal.fire('Updated', 'Enrollment details updated.', 'success').then(() => {
                        if (typeof window.loadEnrollments === 'function') {
                            window.loadEnrollments();
                        }
                    });
                } else {
                    Swal.fire('Error', res.data.message || 'Unable to update enrollment.', 'error');
                }
            }).catch(err => {
                console.error(err);
                Swal.fire('Error', 'Network error while updating enrollment.', 'error');
            });
        });
    } catch (err) {
        console.error(err);
        Swal.fire('Error', 'Network error while loading enrollment editor.', 'error');
    }
};

window.editEnrollment = window.openFullEnrollmentEditor;
