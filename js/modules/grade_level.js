import { canUseProgramPermission, guardProgramPermission } from './program_rbac.js';
import '../utilities/paging.js';

let gradeLevels = [];
let gradeLevelPagination = null;
const GRADE_LEVELS_PER_PAGE = 4;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showRequestError(error, fallback) {
    const message = error?.response?.data?.message || error?.message || fallback;
    Swal.fire('Unable to Save', message, 'error');
}

function renderGradeLevels(rows = []) {
    const tableBody = document.getElementById('grade_level_table_body');
    if (!tableBody) return;

    if (!rows.length) {
        tableBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-4">No grade levels configured.</td></tr>';
        return;
    }

    tableBody.innerHTML = rows.map(grade => {
        const isActive = String(grade.status).toLowerCase() === 'active';
        const editButton = canUseProgramPermission('edit_grades')
            ? `<button type="button" class="btn btn-sm btn-outline-primary" onclick="window.editGradeLevel(${Number(grade.grade_level_id)})" title="Edit grade level"><i class="bi bi-pencil-square"></i></button>`
            : '';

        return `<tr>
            <td class="fw-bold">${escapeHtml(grade.grade_level)}</td>
            <td><span class="badge ${isActive ? 'bg-success' : 'bg-secondary'}">${isActive ? 'Active' : 'Inactive'}</span></td>
            <td class="text-center">${editButton || '<span class="text-muted">-</span>'}</td>
        </tr>`;
    }).join('');
}

function setupGradeLevelPagination() {
    const container = document.getElementById('grade-level-pagination');
    const tableBody = document.getElementById('grade_level_table_body');
    const showingElement = document.getElementById('grade-level-page-summary');
    if (!container || !tableBody || typeof window.PaginationManager !== 'function') return;

    gradeLevelPagination = new window.PaginationManager({
        container,
        tableBody,
        onDataLoad: renderGradeLevels,
        showingElement,
        localData: [],
        perPage: GRADE_LEVELS_PER_PAGE
    });
    gradeLevelPagination.init();
}

export async function loadGradeLevels() {
    if (!canUseProgramPermission('view_grades')) return;
    const tableBody = document.getElementById('grade_level_table_body');
    if (!tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="3" class="text-center py-4">Loading grade levels...</td></tr>';
    try {
        const response = await axios.get('../../api/admin/grade_level.php', {
            params: { operation: 'getGradeLevels', _: Date.now() }
        });
        if (response.data?.status !== 'success') {
            throw new Error(response.data?.message || 'Unable to load grade levels.');
        }
        gradeLevels = Array.isArray(response.data.data) ? response.data.data : [];
        if (gradeLevelPagination) {
            gradeLevelPagination.setLocalData(gradeLevels);
        } else {
            renderGradeLevels(gradeLevels.slice(0, GRADE_LEVELS_PER_PAGE));
        }
    } catch (error) {
        console.error('Error loading grade levels:', error);
        tableBody.innerHTML = `<tr><td colspan="3" class="text-center text-danger py-4">${escapeHtml(error?.response?.data?.message || error.message || 'Unable to load grade levels.')}</td></tr>`;
    }
}

function gradeLevelForm(data = {}) {
    const status = String(data.status || 'active').toLowerCase();
    return `<div class="mb-3">
        <label class="form-label" for="managed_grade_level">Grade Level <span class="text-danger" aria-hidden="true">*</span></label>
        <input type="text" class="form-control" id="managed_grade_level" maxlength="50" value="${escapeHtml(data.grade_level || '')}" placeholder="Example: Grade 7" required>
    </div>
    <div class="mb-2">
        <label class="form-label" for="managed_grade_status">Enrollment Availability <span class="text-danger" aria-hidden="true">*</span></label>
        <select class="form-select" id="managed_grade_status" required>
            <option value="active" ${status === 'active' ? 'selected' : ''}>Active - available in new enrollments</option>
            <option value="inactive" ${status === 'inactive' ? 'selected' : ''}>Inactive - hidden from new enrollments</option>
        </select>
        <div class="form-text">Inactive grades remain visible in existing enrollment history.</div>
    </div>`;
}

function openGradeLevelModal(data = null) {
    const modalElement = document.getElementById('addProgramModal');
    if (!modalElement) return;

    const editing = Boolean(data);
    document.getElementById('dynamicModalLabel').textContent = editing ? 'Edit Grade Level' : 'Add Grade Level';
    document.getElementById('dynamicForm').innerHTML = gradeLevelForm(data || {});
    document.getElementById('dynamicModalFooter').innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
        <button type="button" class="btn ${editing ? 'btn-success' : 'btn-primary'}" id="btnSaveGradeLevel">${editing ? 'Update Grade Level' : 'Save Grade Level'}</button>`;

    const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
    modal.show();
    const input = document.getElementById('managed_grade_level');
    modalElement.addEventListener('shown.bs.modal', () => input?.focus(), { once: true });
    document.getElementById('btnSaveGradeLevel').onclick = () => saveGradeLevel(data?.grade_level_id || null);
}

async function saveGradeLevel(gradeLevelId = null) {
    const editing = Boolean(gradeLevelId);
    const permission = editing ? 'edit_grades' : 'create_grades';
    if (!guardProgramPermission(permission, `You do not have permission to ${editing ? 'edit' : 'add'} grade levels.`)) return;

    const gradeLevel = document.getElementById('managed_grade_level')?.value.trim() || '';
    const status = document.getElementById('managed_grade_status')?.value || 'active';
    if (!gradeLevel) {
        Swal.fire('Grade Level Required', 'Enter a grade level name before saving.', 'warning');
        return;
    }

    const button = document.getElementById('btnSaveGradeLevel');
    button.disabled = true;
    try {
        const response = await axios.post('../../api/admin/grade_level.php', {
            operation: editing ? 'updateGradeLevel' : 'addGradeLevel',
            json: {
                grade_level_id: gradeLevelId,
                grade_level: gradeLevel,
                status
            }
        });
        if (response.data?.status !== 'success') throw new Error(response.data?.message || 'Unable to save grade level.');
        bootstrap.Modal.getInstance(document.getElementById('addProgramModal'))?.hide();
        await loadGradeLevels();
        Swal.fire('Saved', response.data.message, 'success');
    } catch (error) {
        showRequestError(error, 'Unable to save grade level.');
    } finally {
        button.disabled = false;
    }
}

export function setupAddGradeLevelModal() {
    if (!guardProgramPermission('create_grades', 'You do not have permission to add grade levels.')) return;
    openGradeLevelModal();
}

export function initGradeLevelPage() {
    setupGradeLevelPagination();
    if (canUseProgramPermission('view_grades')) loadGradeLevels();
    document.getElementById('btnAddGradeLevel')?.addEventListener('click', setupAddGradeLevelModal);
}

window.editGradeLevel = gradeLevelId => {
    if (!guardProgramPermission('edit_grades', 'You do not have permission to edit grade levels.')) return;
    const grade = gradeLevels.find(item => Number(item.grade_level_id) === Number(gradeLevelId));
    if (grade) openGradeLevelModal(grade);
};
