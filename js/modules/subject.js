// js/modules/subject.js
import { canUseProgramPermission, guardProgramPermission } from './program_rbac.js';

let subjects = [];

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function loadSubjects(searchQuery = '') {
    if (!canUseProgramPermission('view_subjects')) return;
    const tableBody = document.getElementById('subject_table_body');
    if (!tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="2" class="text-center">Loading...</td></tr>';

    axios.get('../../api/admin/subject.php?operation=getSubjects')
        .then(res => {
            subjects = Array.isArray(res.data) ? res.data : [];
            const filteredSubjects = searchQuery
                ? subjects.filter(subject => subject.subject_name.toLowerCase().includes(searchQuery.toLowerCase()))
                : subjects;

            renderSubjectTable(filteredSubjects);
        })
        .catch(err => {
            console.error('Error loading subjects:', err);
            tableBody.innerHTML = '<tr><td colspan="2" class="text-center text-danger">Error loading data</td></tr>';
        });
}

function renderSubjectTable(rows = subjects) {
    const tableBody = document.getElementById('subject_table_body');
    if (!tableBody) return;

    if (rows.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="2" class="text-center text-muted">No subjects found</td></tr>';
        return;
    }

    tableBody.innerHTML = rows.map(subject => `
        <tr>
            <td class="fw-bold">${escapeHtml(subject.subject_name)}</td>
            <td class="text-center">
                ${canUseProgramPermission('edit_subjects')
                    ? `<button class="btn btn-sm btn-outline-primary me-1" onclick="window.editSubject(${subject.subject_id})" title="Edit">
                        <i class="bi bi-pencil"></i>
                    </button>`
                    : '<span class="text-muted">-</span>'
                }
            </td>
        </tr>
    `).join('');
}

export function setupAddSubjectModal() {
    if (!guardProgramPermission('create_subjects', 'You do not have permission to add subjects.')) {
        return;
    }

    document.getElementById('dynamicModalLabel').innerText = 'Add New Subject';
    document.getElementById('dynamicForm').innerHTML = `
        <div class="mb-3">
            <label for="subject_name" class="form-label">Subject Name <span class="text-danger" aria-hidden="true">*</span></label>
            <input type="text" class="form-control" id="subject_name" placeholder="Enter subject name" required>
        </div>
    `;
    document.getElementById('dynamicModalFooter').innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn btn-primary" id="btnSaveSubject">Save Subject</button>
    `;

    const modal = new bootstrap.Modal(document.getElementById('addProgramModal'));
    modal.show();

    document.getElementById('btnSaveSubject').onclick = () => submitSubjectData('insertSubject');
}

function setupEditSubjectModal(subject) {
    document.getElementById('dynamicModalLabel').innerText = 'Edit Subject';
    document.getElementById('dynamicForm').innerHTML = `
        <div class="mb-3">
            <label for="edit_subject_name" class="form-label">Subject Name <span class="text-danger" aria-hidden="true">*</span></label>
            <input type="text" class="form-control" id="edit_subject_name" value="${escapeHtml(subject.subject_name)}" required>
        </div>
    `;
    document.getElementById('dynamicModalFooter').innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn btn-success" id="btnUpdateSubject">Update Subject</button>
    `;

    const modal = new bootstrap.Modal(document.getElementById('addProgramModal'));
    modal.show();

    document.getElementById('btnUpdateSubject').onclick = () => submitSubjectData('updateSubject', subject.subject_id);
}

function submitSubjectData(operation, subjectId = null) {
    const inputId = operation === 'updateSubject' ? 'edit_subject_name' : 'subject_name';
    const subjectName = document.getElementById(inputId).value.trim();

    if (!subjectName) {
        Swal.fire('Error', 'Please enter a subject name', 'error');
        return;
    }

    const payload = { subject_name: subjectName };
    if (subjectId) payload.subject_id = subjectId;

    const params = new URLSearchParams();
    params.append('operation', operation);
    params.append('json', JSON.stringify(payload));

    axios.post('../../api/admin/subject.php', params)
        .then(res => {
            if (res.data == 1) {
                bootstrap.Modal.getInstance(document.getElementById('addProgramModal')).hide();
                loadSubjects();
                Swal.fire('Success', operation === 'updateSubject' ? 'Subject updated successfully!' : 'Subject added successfully!', 'success');
            } else {
                Swal.fire('Error', 'Subject name may already exist or no changes were made.', 'error');
            }
        })
        .catch(err => {
            console.error('Error saving subject:', err);
            Swal.fire('Error', 'Network error', 'error');
        });
}

export function initSubjectPage() {
    if (canUseProgramPermission('view_subjects')) loadSubjects();

    const addBtn = document.getElementById('btnAddSubject');
    if (addBtn) addBtn.onclick = setupAddSubjectModal;
}

window.editSubject = (id) => {
    if (!guardProgramPermission('edit_subjects', 'You do not have permission to edit subjects.')) {
        return;
    }

    const subject = subjects.find(item => item.subject_id == id);
    if (subject) setupEditSubjectModal(subject);
};

// window.deleteSubject = (id) => {
//     Swal.fire({
//         title: 'Are you sure?',
//         text: 'This will delete the subject permanently.',
//         icon: 'warning',
//         showCancelButton: true,
//         confirmButtonText: 'Yes, delete it!'
//     }).then(result => {
//         if (!result.isConfirmed) return;

//         const params = new URLSearchParams();
//         params.append('operation', 'deleteSubject');
//         params.append('json', JSON.stringify({ subject_id: id }));

//         axios.post('../../api/admin/subject.php', params)
//             .then(res => {
//                 if (res.data == 1) {
//                     Swal.fire('Deleted!', 'Subject has been deleted.', 'success');
//                     loadSubjects();
//                 } else {
//                     Swal.fire('Error', 'Failed to delete subject. It may already be used by an employee or enrollment.', 'error');
//                 }
//             })
//             .catch(err => {
//                 console.error('Error deleting subject:', err);
//                 Swal.fire('Error', 'Network error', 'error');
//             });
//     });
// };
