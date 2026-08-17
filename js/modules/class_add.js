// js/modules/class_add.js
import { guardClassPermission } from './class_rbac.js';


let programs = [];
let branches = [];

export function openEditClassModal(classId) {
    if (!guardClassPermission('edit', 'You do not have permission to update class records.')) {
        return;
    }

    // Fetch class data
    axios.get(`../../api/admin/class.php?operation=getClassById&class_id=${classId}`)
        .then(res => {
            let data = res.data;
            if (typeof data === 'string' && data.startsWith('e')) {
                data = JSON.parse(data.substring(1));
            }
            const classData = Array.isArray(data) ? data[0] : data;

            // Modal HTML
            const modalHTML = `
                <div class="modal fade" id="editClassModal" tabindex="-1">
                    <div class="modal-dialog">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Edit Class</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <form id="editClassForm">
                                    <div class="mb-3">
                                        <label class="form-label">Branch <span class="text-danger" aria-hidden="true">*</span></label>
                                        <select class="form-select" id="editBranchSelect" required>
                                            <option value="">Select Branch</option>
                                        </select>
                                    </div>
                                    <div class="mb-3">
                                        <label class="form-label">Program <span class="text-danger" aria-hidden="true">*</span></label>
                                        <select class="form-select" id="editProgramSelect" required>
                                            <option value="">Select Program</option>
                                        </select>
                                    </div>
                                    <div class="mb-3">
                                        <label class="form-label">Status <span class="text-danger" aria-hidden="true">*</span></label>
                                        <select class="form-select" id="editStatusSelect" required>
                                            <option value="">Select Status</option>
                                            <option value="open">Open</option>
                                            <option value="full">Full</option>
                                            <option value="close">Close</option>
                                            <option value="completed">Completed</option>
                                        </select>
                                    </div>
                                </form>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                                <button type="button" class="btn btn-primary" id="updateClassBtn">Update</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            if (!document.getElementById('editClassModal')) {
                document.body.insertAdjacentHTML('beforeend', modalHTML);
            }

            const modal = new bootstrap.Modal(document.getElementById('editClassModal'));
            modal.show();

            // Pre-fill form and load selects - wait for both to complete
            Promise.all([loadPrograms(), loadBranches()]).then(() => {
                document.getElementById('editBranchSelect').value = classData.branch_id;
                document.getElementById('editProgramSelect').value = classData.program_id;
                document.getElementById('editStatusSelect').value = classData.status;
            });

            document.getElementById('updateClassBtn').onclick = () => updateClass(classId);
        })
        .catch(err => console.error('Error loading class:', err));
}

export function openAddClassModal() {
    if (!guardClassPermission('create', 'You do not have permission to create class records.')) {
        return;
    }

    // ... (Modal HTML remains the same)
    const modalHTML = `
        <div class="modal fade" id="addClassModal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Add New Class</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <form id="addClassForm">
                            <div class="mb-3">
                                <label class="form-label">Branch <span class="text-danger" aria-hidden="true">*</span></label>
                                <select class="form-select" id="branchSelect" required>
                                    <option value="">Select Branch</option>
                                </select>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Program <span class="text-danger" aria-hidden="true">*</span></label>
                                <select class="form-select" id="programSelect" required>
                                    <option value="">Select Program</option>
                                </select>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Status <span class="text-danger" aria-hidden="true">*</span></label>
                                <select class="form-select" id="statusSelect" required>
                                    <option value="">Select Status</option>
                                    <option value="open">Open</option>
                                    <option value="full">Full</option>
                                    <option value="close">Close</option>
                                    <option value="completed">Completed</option>
                                </select>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-primary" id="saveClassBtn">Save</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    if (!document.getElementById('addClassModal')) {
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    const modal = new bootstrap.Modal(document.getElementById('addClassModal'));
    modal.show();

    loadPrograms();
    loadBranches(); 

    document.getElementById('saveClassBtn').onclick = saveClass;
}

function loadBranches() {
    return axios.get('../../api/admin/branch.php?operation=getBranches')
        .then(res => {
            branches = res.data;
            const select = document.getElementById('branchSelect');
            const editSelect = document.getElementById('editBranchSelect');
            const options = '<option value="">Select Branch</option>' +
                branches.map(b => `<option value="${b.branch_id}">${b.branch_name}</option>`).join('');
            if (select) select.innerHTML = options;
            if (editSelect) editSelect.innerHTML = options;
        })
        .catch(err => console.error('Error loading branches:', err));
}

function loadPrograms() {
    return axios.get('../../api/admin/program.php?operation=getPrograms')
        .then(res => {
            const data = res.data.data ? res.data.data : res.data;

            // DYNAMIC FILTER: Keep any program that has "school" in its name
            programs = data.filter(p => {
                const programName = (p.program_name || p.name).toLowerCase();
                return programName.includes('school');
            });

            const select = document.getElementById('programSelect');
            const editSelect = document.getElementById('editProgramSelect');
            const options = '<option value="">Select Program</option>' +
                programs.map(p => `<option value="${p.program_id}">${p.program_name || p.name}</option>`).join('');
            if (select) select.innerHTML = options;
            if (editSelect) editSelect.innerHTML = options;
        })
        .catch(err => console.error('Error loading programs:', err));
}
function updateClass(classId) {
    if (!guardClassPermission('edit', 'You do not have permission to update class records.')) {
        return;
    }

    const branchId = document.getElementById('editBranchSelect').value;
    const programId = document.getElementById('editProgramSelect').value;
    const status = document.getElementById('editStatusSelect').value;

    if (!branchId || !programId || !status) {
        Swal.fire('Error', 'Please fill all fields', 'error');
        return;
    }

    const data = { class_id: classId, branch_id: branchId, program_id: programId, status: status };
    const params = new URLSearchParams();
    params.append('operation', 'updateClass');
    params.append('json', JSON.stringify(data));

    axios.post('../../api/admin/class.php', params)
    .then(res => {
        if (res.data.toString().includes('1')) {
            Swal.fire('Success', 'Class updated successfully', 'success');
            bootstrap.Modal.getInstance(document.getElementById('editClassModal')).hide();
            // Refresh the class list
            import('./section_view.js').then(module => {
                module.refreshClasses();
            });
        } else {
            Swal.fire('Error', 'Failed: ' + res.data, 'error');
        }
    })
    .catch(err => {
        Swal.fire('Error', 'Network error', 'error');
    });
}

function saveClass() {
    if (!guardClassPermission('create', 'You do not have permission to create class records.')) {
        return;
    }

    const branchId = document.getElementById('branchSelect').value;
    const programId = document.getElementById('programSelect').value;
    const status = document.getElementById('statusSelect').value;

    if (!branchId || !programId || !status) {
        Swal.fire('Error', 'Please fill all fields', 'error');
        return;
    }

    const data = { branch_id: branchId, program_id: programId, status: status };
    const params = new URLSearchParams();
    params.append('operation', 'insertClass');
    params.append('json', JSON.stringify(data));

    axios.post('../../api/admin/class.php', params)
    .then(res => {
        // Updated check to handle strings like "e1" or "1"
        if (res.data.toString().includes('1')) {
            Swal.fire('Success', 'Class added successfully', 'success');
            bootstrap.Modal.getInstance(document.getElementById('addClassModal')).hide();
            import('./section_view.js').then(module => {
                module.refreshClasses();
            });
        } else {
            Swal.fire('Error', 'Failed: ' + res.data, 'error');
        }
    })
    .catch(err => {
        Swal.fire('Error', 'Network error', 'error');
    });
}
