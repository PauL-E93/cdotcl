// js/modules/section.js

import { refreshSectionsForClass } from './section_view.js';
import { guardClassPermission } from './class_rbac.js';

let classes = [];
let employees = [];
let selectedSchedules = [];

    export function openEditSectionModal(sectionId) {
        if (!guardClassPermission('edit_sections', 'You do not have permission to update class sections.')) {
            return;
        }

        selectedSchedules = [];
        // Fetch section data and schedules
        axios.get(`../../api/admin/section.php?operation=getSectionById&section_id=${sectionId}`)
            .then(res => {
                let data = res.data;
                if (typeof data === 'string' && data.startsWith('e')) {
                    data = JSON.parse(data.substring(1));
                }
                const sectionData = Array.isArray(data) ? data[0] : data;

                return axios.get(`../../api/admin/section.php?operation=getSectionSchedules&section_id=${sectionId}`)
                    .then(res2 => {
                        let schedData = res2.data;
                        if (typeof schedData === 'string' && schedData.startsWith('e')) {
                            schedData = JSON.parse(schedData.substring(1));
                        }
                        // Accept array or object with data property
                        const rawSched = Array.isArray(schedData) ? schedData : (schedData && schedData.data ? schedData.data : []);
                        selectedSchedules = rawSched.map(s => ({
                            schedule_id: s.schedule_id || s.id || null,
                            day: s.day || s.day_of_week || s.day_name || '',
                            start: s.start || s.start_time || s.from || '',
                            end: s.end || s.end_time || s.to || ''
                        }));

                        // Build schedule table HTML (editable for edit modal)
                        const schedTableBody = selectedSchedules.length > 0 ? selectedSchedules.map((s, index) => `
                            <tr>
                                <td>
                                    <select class="form-select" onchange="updateSchedDay(${index}, this.value)">
                                        <option value="Monday" ${s.day === 'Monday' ? 'selected' : ''}>Monday</option>
                                        <option value="Tuesday" ${s.day === 'Tuesday' ? 'selected' : ''}>Tuesday</option>
                                        <option value="Wednesday" ${s.day === 'Wednesday' ? 'selected' : ''}>Wednesday</option>
                                        <option value="Thursday" ${s.day === 'Thursday' ? 'selected' : ''}>Thursday</option>
                                        <option value="Friday" ${s.day === 'Friday' ? 'selected' : ''}>Friday</option>
                                        <option value="Saturday" ${s.day === 'Saturday' ? 'selected' : ''}>Saturday</option>
                                        <option value="Sunday" ${s.day === 'Sunday' ? 'selected' : ''}>Sunday</option>
                                    </select>
                                </td>
                                <td>
                                    <input type="time" class="form-control" value="${s.start}" onchange="updateSchedStart(${index}, this.value)">
                                </td>
                                <td>
                                    <input type="time" class="form-control" value="${s.end}" onchange="updateSchedEnd(${index}, this.value)">
                                </td>
                                <td class="text-center">
                                    <button class="btn btn-outline-danger btn-sm border-0" onclick="removeSched(${index}, true)" title="Remove">
                                        <i class="bi bi-trash-fill"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('') : '<tr><td colspan="4" class="text-center text-muted">No schedules added yet</td></tr>';

                        // Modal HTML with pre-filled data
                        const modalHTML = `
                            <div class="modal fade" id="editSectionModal" tabindex="-1">
                                <div class="modal-dialog">
                                    <div class="modal-content">
                                        <div class="modal-header">
                                            <h5 class="modal-title">Edit Section</h5>
                                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                                        </div>
                                        <div class="modal-body">
                                            <form id="editSectionForm">
                                                <div class="mb-3">
                                                    <label class="form-label">Section Name <span class="text-danger" aria-hidden="true">*</span></label>
                                                    <input type="text" class="form-control" id="editSectionName" value="${sectionData.section_name}" placeholder="Section 1" required>
                                                </div>

                                                <div class="mb-3">
                                                    <label class="form-label">Class (Program) <span class="text-danger" aria-hidden="true">*</span></label>
                                                    <select class="form-select" id="editClassSelect" required>
                                                        <option value="">Select Class</option>
                                                    </select>
                                                </div>

                                                <div class="mb-3">
                                                    <label class="form-label">Employee (Instructor) <span class="text-danger" aria-hidden="true">*</span></label>
                                                    <select class="form-select" id="editEmployeeSelect" required>
                                                        <option value="">Select Employee</option>
                                                    </select>
                                                </div>

                                                <div class="mb-3">
                                                    <label class="form-label">Status <span class="text-danger" aria-hidden="true">*</span></label>
                                                    <select class="form-select" id="editStatusSelect" required>
                                                        <option value="open">Open</option>
                                                        <option value="full">Full</option>
                                                        <option value="close">Close</option>
                                                        <option value="completed">Completed</option>
                                                    </select>
                                                </div>

                                                <div class="mb-3">
                                                    <label class="form-label">Max Capacity <span class="text-danger" aria-hidden="true">*</span></label>
                                                    <input type="number" class="form-control" id="editMaxCapacity" placeholder="e.g., 30" min="1" required>
                                                </div>

                                                <hr>
                                                <h6 class="mb-3">Schedule Management</h6>

                                                <div class="mb-3">
                                                    <label class="form-label small">Day</label>
                                                    <select class="form-select" id="editScheduleDay">
                                                        <option value="Monday">Monday</option>
                                                        <option value="Tuesday">Tuesday</option>
                                                        <option value="Wednesday">Wednesday</option>
                                                        <option value="Thursday">Thursday</option>
                                                        <option value="Friday">Friday</option>
                                                        <option value="Saturday">Saturday</option>
                                                        <option value="Sunday">Sunday</option>
                                                    </select>
                                                </div>

                                                <div class="row mb-3">
                                                    <div class="col">
                                                        <label class="form-label small">Start Time</label>
                                                        <input type="time" class="form-control" id="editStartTime">
                                                    </div>
                                                    <div class="col">
                                                        <label class="form-label small">End Time</label>
                                                        <input type="time" class="form-control" id="editEndTime">
                                                    </div>
                                                </div>

                                                <button type="button" class="btn btn-primary w-100 mb-4" id="editAddSchedToListBtn">
                                                    Add Schedule Entry
                                                </button>

                                                <div class="table-responsive">
                                                    <table class="table table-sm table-bordered">
                                                        <thead class="table-light">
                                                            <tr>
                                                                <th>Day</th>
                                                                <th>Start Time</th>
                                                                <th>End Time</th>
                                                                <th class="text-center">Action</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody id="editSchedTableBody">
                                                            ${schedTableBody}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </form>
                                        </div>
                                        <div class="modal-footer">
                                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                                            <button type="button" class="btn btn-primary" id="editSaveSectionBtn">Update All</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `;

                        const existingModal = document.getElementById('editSectionModal');
                        if (existingModal) {
                            existingModal.remove();
                        }
                        document.body.insertAdjacentHTML('beforeend', modalHTML);

                        const modal = new bootstrap.Modal(document.getElementById('editSectionModal'));

                        document.getElementById('editAddSchedToListBtn').onclick = () => addScheduleToList(true);
                        document.getElementById('editSaveSectionBtn').onclick = () => updateSection(sectionId);

                        modal.show();

                        // Load classes and employees to populate selects
                        // After selects are populated, render the schedule table so existing
                        // schedules are visible in the edit modal (even if user won't change them).
                        Promise.all([loadClasses(), loadEmployees()]).then(() => {
                            const editClassEl = document.getElementById('editClassSelect');
                            const editEmployeeEl = document.getElementById('editEmployeeSelect');
                            const editStatusEl = document.getElementById('editStatusSelect');
                            const editMaxEl = document.getElementById('editMaxCapacity');

                            if (editClassEl) editClassEl.value = sectionData.class_id;
                            if (editEmployeeEl) editEmployeeEl.value = sectionData.employee_id;
                            if (editStatusEl) editStatusEl.value = sectionData.status || 'open';
                            if (editMaxEl) editMaxEl.value = sectionData.max || '';

                            // Fetch and render schedules (normalizes backend fields)
                            loadSectionSchedules(sectionId).then(() => {
                                // Pre-fill the quick-edit schedule inputs with the first schedule
                                if (selectedSchedules.length > 0) {
                                    const firstSched = selectedSchedules[0];
                                    const dayEl = document.getElementById('editScheduleDay');
                                    const startEl = document.getElementById('editStartTime');
                                    const endEl = document.getElementById('editEndTime');
                                    if (dayEl && firstSched.day) dayEl.value = firstSched.day;
                                    if (startEl && firstSched.start) startEl.value = firstSched.start;
                                    if (endEl && firstSched.end) endEl.value = firstSched.end;
                                }
                            }).catch(err => console.warn('Unable to load schedules:', err));
                        });
                    });
            })
            .catch(err => console.error('Error loading section:', err));
}

export function openAddSectionModal(classId = null) {
    if (!guardClassPermission('manage_sections', 'You do not have permission to create class sections.')) {
        return;
    }

    selectedSchedules = [];
    const modalHTML = `
        <div class="modal fade" id="addSectionModal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Add New Section</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <form id="addSectionForm">
                            <div class="mb-3">
                                <label class="form-label">Section Name <span class="text-danger" aria-hidden="true">*</span></label>
                                <input type="text" class="form-control" id="sectionName" placeholder="Section 1" required>
                            </div>

                            <div class="mb-3">
                                <label class="form-label">Class (Program) <span class="text-danger" aria-hidden="true">*</span></label>
                                <select class="form-select" id="classSelect" required>
                                    <option value="">Select Class</option>
                                </select>
                            </div>

                            <div class="mb-3">
                                <label class="form-label">Employee (Instructor) <span class="text-danger" aria-hidden="true">*</span></label>
                                <select class="form-select" id="employeeSelect" required>
                                    <option value="">Select Employee</option>
                                </select>
                            </div>

                            <div class="mb-3">
                                <label class="form-label">Status <span class="text-danger" aria-hidden="true">*</span></label>
                                <select class="form-select" id="statusSelect" required>
                                    <option value="open">Open</option>
                                    <option value="full">Full</option>
                                    <option value="close">Close</option>
                                    <option value="completed">Completed</option>
                                </select>
                            </div>

                            <div class="mb-3">
                                <label class="form-label">Max Capacity <span class="text-danger" aria-hidden="true">*</span></label>
                                <input type="number" class="form-control" id="maxCapacity" placeholder="e.g., 30" min="1" required>
                            </div>

                            <hr>
                            <h6 class="mb-3">Schedule Management</h6>
                            
                            <div class="mb-3">
                                <label class="form-label small">Day</label>
                                <select class="form-select" id="scheduleDay">
                                    <option value="Monday">Monday</option>
                                    <option value="Tuesday">Tuesday</option>
                                    <option value="Wednesday">Wednesday</option>
                                    <option value="Thursday">Thursday</option>
                                    <option value="Friday">Friday</option>
                                    <option value="Saturday">Saturday</option>
                                    <option value="Sunday">Sunday</option>
                                </select>
                            </div>

                            <div class="row mb-3">
                                <div class="col">
                                    <label class="form-label small">Start Time</label>
                                    <input type="time" class="form-control" id="startTime">
                                </div>
                                <div class="col">
                                    <label class="form-label small">End Time</label>
                                    <input type="time" class="form-control" id="endTime">
                                </div>
                            </div>

                            <button type="button" class="btn btn-primary w-100 mb-4" id="addSchedToListBtn">
                                Add Schedule Entry
                            </button>

                            <div class="table-responsive">
                                <table class="table table-sm table-bordered">
                                    <thead class="table-light">
                                        <tr>
                                            <th>Day</th>
                                            <th>Time Slot</th>
                                            <th class="text-center">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody id="schedTableBody">
                                        <tr><td colspan="3" class="text-center text-muted">No schedules added yet</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-primary" id="saveSectionBtn">Save All</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    if (!document.getElementById('addSectionModal')) {
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    const modal = new bootstrap.Modal(document.getElementById('addSectionModal'));

    modal.show();

    // Set event handlers after modal is shown
    modal._element.addEventListener('shown.bs.modal', () => {
        document.getElementById('addSchedToListBtn').onclick = () => addScheduleToList(false);
        document.getElementById('saveSectionBtn').onclick = saveSection;
    });

    Promise.all([loadClasses(classId), loadEmployees()]);
}

function addScheduleToList(isEdit = false) {
    const dayId = isEdit ? 'editScheduleDay' : 'scheduleDay';
    const startId = isEdit ? 'editStartTime' : 'startTime';
    const endId = isEdit ? 'editEndTime' : 'endTime';

    const dayEl = document.getElementById(dayId);
    const startEl = document.getElementById(startId);
    const endEl = document.getElementById(endId);

    if (!dayEl || !startEl || !endEl) {
        Swal.fire('Error', 'Form elements not found', 'error');
        return;
    }

    const day = dayEl.value;
    const start = startEl.value;
    const end = endEl.value;

    if (!day || !start || !end) {
        Swal.fire('Wait', 'Please select day and set both start and end times', 'warning');
        return;
    }

    selectedSchedules.push({ day, start, end });
    renderSchedTable(isEdit);

    startEl.value = "";
    endEl.value = "";
}

function renderSchedTable(isEdit = false) {
    const tbodyId = isEdit ? 'editSchedTableBody' : 'schedTableBody';
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    if (selectedSchedules.length === 0) {
        const colspan = isEdit ? '4' : '3';
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-center text-muted">No schedules added yet</td></tr>`;
        return;
    }

    if (isEdit) {
        tbody.innerHTML = selectedSchedules.map((s, index) => `
            <tr>
                <td>
                    <select class="form-select" onchange="updateSchedDay(${index}, this.value)">
                        <option value="Monday" ${s.day === 'Monday' ? 'selected' : ''}>Monday</option>
                        <option value="Tuesday" ${s.day === 'Tuesday' ? 'selected' : ''}>Tuesday</option>
                        <option value="Wednesday" ${s.day === 'Wednesday' ? 'selected' : ''}>Wednesday</option>
                        <option value="Thursday" ${s.day === 'Thursday' ? 'selected' : ''}>Thursday</option>
                        <option value="Friday" ${s.day === 'Friday' ? 'selected' : ''}>Friday</option>
                        <option value="Saturday" ${s.day === 'Saturday' ? 'selected' : ''}>Saturday</option>
                        <option value="Sunday" ${s.day === 'Sunday' ? 'selected' : ''}>Sunday</option>
                    </select>
                </td>
                <td>
                    <input type="time" class="form-control" value="${s.start}" onchange="updateSchedStart(${index}, this.value)">
                </td>
                <td>
                    <input type="time" class="form-control" value="${s.end}" onchange="updateSchedEnd(${index}, this.value)">
                </td>
                <td class="text-center">
                    <button class="btn btn-outline-danger btn-sm border-0" onclick="removeSched(${index}, true)" title="Remove">
                        <i class="bi bi-trash-fill"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    } else {
        tbody.innerHTML = selectedSchedules.map((s, index) => `
            <tr>
                <td>${s.day}</td>
                <td>${s.start} - ${s.end}</td>
                <td class="text-center">
                    <button class="btn btn-outline-danger btn-sm border-0" onclick="removeSched(${index}, false)" title="Remove">
                        <i class="bi bi-trash-fill"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }
}

function renderEditSchedTable() {
    renderSchedTable(true);
}

window.removeSched = (index, isEdit = false) => {
    selectedSchedules.splice(index, 1);
    renderSchedTable(isEdit);
};

window.updateSchedDay = (index, value) => {
    selectedSchedules[index].day = value;
};

window.updateSchedStart = (index, value) => {
    selectedSchedules[index].start = value;
};

window.updateSchedEnd = (index, value) => {
    selectedSchedules[index].end = value;
};

function loadClasses(classId = null) {
    return axios.get('../../api/admin/class.php?operation=getAllClasses')
        .then(res => {
            let rawData = res.data;
            if (typeof rawData === 'string' && rawData.startsWith('e')) {
                rawData = JSON.parse(rawData.substring(1));
            }
            classes = Array.isArray(rawData) ? rawData : (rawData.data || []);
            const select = document.getElementById('classSelect');
            const editSelect = document.getElementById('editClassSelect');

            const options = '<option value="">Select Class</option>' +
                classes.map(c => `<option value="${c.class_id}">${c.program_name || 'Class ' + c.class_id} (${c.branch_name})</option>`).join('');

            if (select) select.innerHTML = options;
            if (editSelect) editSelect.innerHTML = options;

            if (classId) {
                if (select) select.value = classId;
            }
        })
        .catch(err => console.error('Error loading classes:', err));
}

function loadEmployees() {
    return axios.get('../../api/admin/employee.php?operation=getAllEmployees')
        .then(res => {
            const allEmployees = Array.isArray(res.data) ? res.data : (res.data.data || []);
            employees = allEmployees.filter(employee => String(employee.status || '').trim().toLowerCase() === 'active');
            const select = document.getElementById('employeeSelect');
            const editSelect = document.getElementById('editEmployeeSelect');
            const options = '<option value="">Select Employee</option>' +
                employees.map(e => `<option value="${e.employee_id}">${e.first_name} ${e.last_name}</option>`).join('');
            if (select) select.innerHTML = options;
            if (editSelect) editSelect.innerHTML = options;
        })
        .catch(err => console.error('Error loading employees:', err));
}

function updateSection(sectionId) {
    if (!guardClassPermission('edit_sections', 'You do not have permission to update class sections.')) {
        return;
    }

    const sectionName = document.getElementById('editSectionName').value;
    const classId = document.getElementById('editClassSelect').value;
    const employeeId = document.getElementById('editEmployeeSelect').value;
    const status = document.getElementById('editStatusSelect').value;
    const maxCapacity = document.getElementById('editMaxCapacity').value;

    if (!sectionName || !classId || !employeeId || !status || !maxCapacity) {
        Swal.fire('Error', 'Please fill all required fields including max capacity', 'error');
        return;
    }

    if (selectedSchedules.length === 0) {
        Swal.fire('Error', 'Please add at least one day/time to the schedule', 'error');
        return;
    }

    // Fetch current enrollment count for the section
    axios.get(`../../api/admin/enrollment.php?operation=getSectionEnrollmentCount&section_id=${sectionId}`)
        .then(res => {
            const count = res.data.count || 0;
            let finalStatus = status;
            if (count >= parseInt(maxCapacity)) {
                finalStatus = 'full';
            }

            const data = {
                section_id: sectionId,
                section_name: sectionName,
                class_id: classId,
                employee_id: employeeId,
                status: finalStatus,
                max: parseInt(maxCapacity),
                schedules: selectedSchedules
            };

            const params = new URLSearchParams();
            params.append('operation', 'updateSection');
            params.append('json', JSON.stringify(data));

            axios.post('../../api/admin/section.php', params)
            .then(res => {
                if (res.data.toString().includes('1')) {
                    Swal.fire('Success', 'Section updated successfully!', 'success');
                    bootstrap.Modal.getInstance(document.getElementById('editSectionModal')).hide();
                    // Refresh the sections for the class
                    refreshSectionsForClass(classId);
                } else {
                    Swal.fire('Error', 'Failed to update: ' + res.data, 'error');
                }
            })
            .catch(err => {
                console.error('Error:', err);
                Swal.fire('Error', 'Network or Server error', 'error');
            });
        })
        .catch(err => {
            console.error('Error fetching enrollment count:', err);
            Swal.fire('Error', 'Failed to check enrollment count', 'error');
        });
}

function loadSectionSchedules(sectionId) {
    return axios.get(`../../api/admin/section.php?operation=getSectionSchedules&section_id=${sectionId}`)
        .then(res => {
            let data = res.data;
            if (typeof data === 'string' && data.startsWith('e')) {
                data = JSON.parse(data.substring(1));
            }
            const raw = Array.isArray(data) ? data : (data && data.data ? data.data : []);
            selectedSchedules = raw.map(s => ({
                schedule_id: s.schedule_id || s.id || null,
                day: s.day || s.day_of_week || s.day_name || '',
                start: s.start || s.start_time || s.from || '',
                end: s.end || s.end_time || s.to || ''
            }));
            renderSchedTable(true);
        })
        .catch(err => console.error('Error loading schedules:', err));
}

function saveSection() {
    if (!guardClassPermission('manage_sections', 'You do not have permission to create class sections.')) {
        return;
    }

    const sectionName = document.getElementById('sectionName').value;
    const classId = document.getElementById('classSelect').value;
    const employeeId = document.getElementById('employeeSelect').value;
    const status = document.getElementById('statusSelect').value;
    const maxCapacity = document.getElementById('maxCapacity').value;

    if (!sectionName || !classId || !employeeId || !status || !maxCapacity) {
        Swal.fire('Error', 'Please fill all required fields including max capacity', 'error');
        return;
    }

    if (selectedSchedules.length === 0) {
        Swal.fire('Error', 'Please add at least one day/time to the schedule', 'error');
        return;
    }

    const data = {
        section_name: sectionName,
        class_id: classId,
        employee_id: employeeId,
        status: status,
        max: parseInt(maxCapacity),
        schedules: selectedSchedules
    };

    const params = new URLSearchParams();
    params.append('operation', 'insertSection');
    params.append('json', JSON.stringify(data));

    axios.post('../../api/admin/section.php', params)
    .then(res => {
        if (res.data.toString().includes('1')) {
            Swal.fire('Success', 'Section and multiple schedules saved!', 'success');
            bootstrap.Modal.getInstance(document.getElementById('addSectionModal')).hide();
            // Refresh the sections for the class
            refreshSectionsForClass(classId);
        } else {
            Swal.fire('Error', 'Failed to save: ' + res.data, 'error');
        }
    })
    .catch(err => {
        console.error('Error:', err);
        Swal.fire('Error', 'Network or Server error', 'error');
    });
}
