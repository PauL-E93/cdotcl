// js/modules/product_history.js
import { guardProductPermission } from './product_rbac.js';

const API_BASE_URL = '../../api/admin/';
let releasedStudentsData = [];

export function updateReleasedStudentsData(data) {
    releasedStudentsData = data;
}

export function getReleasedStudentsHistory() {
    return releasedStudentsData;
}

export function getReleaseHistoryCount() {
    return releasedStudentsData.length;
}

export async function openProductHistoryModal() {
    if (!guardProductPermission('export', 'You do not have permission to view product release history.')) {
        return;
    }

    const existingModal = document.getElementById('productHistoryModal');
    if (existingModal) {
        const existingModalInstance = bootstrap.Modal.getInstance(existingModal);
        if (existingModalInstance) {
            existingModalInstance.dispose();
        }
        existingModal.remove();
    }

    // Clean backdrops
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.remove());
    
    if (document.querySelectorAll('.modal').length === 0) {
        document.body.classList.remove('modal-open');
    }

    const modalHTML = `
    <div class="modal fade" id="productHistoryModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-lg modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Product Release History</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="table-responsive">
              <table class="table table-striped table-hover">
                <thead>
                  <tr>
                    <th>Student ID</th>
                    <th>Name</th>
                    <th>Program</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody id="releaseHistoryTableBody">
                  <tr><td colspan="4" class="text-center">Loading...</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modalEl = document.getElementById('productHistoryModal');
    const modal = new bootstrap.Modal(modalEl);

    const loadHistoryData = () => {
        const body = document.getElementById('releaseHistoryTableBody');
        if (!body) return;

        body.innerHTML = '';

        const data = releasedStudentsData;
        if (!data || data.length === 0) {
            body.innerHTML = '<tr><td colspan="4" class="text-center">No release history yet.</td></tr>';
            return;
        }

        data.forEach(item => {
            const row = `
                <tr>
                    <td>${item.student_id || item.enrollment_details_id || 'N/A'}</td>
                    <td>${item.student_name || 'N/A'}</td>
                    <td>${item.program_name || 'N/A'}</td>
                    <td><span class="badge bg-success">Released</span></td>
                </tr>`;
            body.insertAdjacentHTML('beforeend', row);
        });
    };

    modal.show();
    loadHistoryData();

    modalEl.addEventListener('hidden.bs.modal', () => {
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) {
            modalInstance.dispose();
        }
        document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.remove());
        if (document.querySelectorAll('.modal').length === 0) {
            document.body.classList.remove('modal-open');
        }
        modalEl.remove();
    });
}
