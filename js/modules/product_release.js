// js/modules/product_release.js
import { guardProductPermission } from './product_rbac.js';

const API_BASE_URL = '../../api/admin/';
const releasedStudents = new Set(); // Track released students in this session
let releasedStudentsHistory = []; // Store full student data for history

export async function getReleaseStudents(search = '') {
    try {
        const params = new URLSearchParams({ operation: 'getReleaseStudents' });
        if (search) params.append('search', search);

        const response = await fetch(`${API_BASE_URL}enrollment.php?${params.toString()}`);
        const data = await response.json();
        if (data.status === 'success') {
            // Filter out already released students
            return data.data.filter(student => !releasedStudents.has(student.enrollment_details_id));
        }
        return [];
    } catch (error) {
        console.error('Error fetching release students:', error);
        return [];
    }
}

export function getReleasedStudentsHistory() {
    return releasedStudentsHistory;
}

export function addToReleasedHistory(student) {
    releasedStudentsHistory.push(student);
    // Sync with product_history module
    import('./product_history.js').then(module => {
        module.updateReleasedStudentsData(releasedStudentsHistory);
    });
}

export async function getProductsByProgram(programId) {
    try {
        const response = await fetch(`${API_BASE_URL}program_products.php?operation=getProductsByProgram&program_id=${programId}`);
        const data = await response.json();
        if (data.status === 'success') {
            return data.data;
        }
        return [];
    } catch (error) {
        console.error('Error fetching products:', error);
        return [];
    }
}

async function openProductReleaseDetailsModal(student) {
    if (!guardProductPermission('edit', 'You do not have permission to manage product releases.')) {
        return;
    }

    const existingModal = document.getElementById('productReleaseDetailsModal');
    if (existingModal) {
        const existingModalInstance = bootstrap.Modal.getInstance(existingModal);
        if (existingModalInstance) existingModalInstance.dispose();
        existingModal.remove();
    }

    // Clean backdrops
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.remove());
    document.body.classList.remove('modal-open');

    const products = await getProductsByProgram(student.program_id || 0);

    let productsHtml = '';
    if (!products || products.length === 0) {
        productsHtml = '<p class="text-center text-muted">No products associated with this program.</p>';
    } else {
        productsHtml = `
            <div class="list-group">
                ${products.map((prod, idx) => `
                    <div class="list-group-item">
                        <div class="d-flex align-items-center">
                            <input type="checkbox" id="product_${idx}" value="${prod.product_id}" class="product-release-checkbox me-3" />
                            <label for="product_${idx}" class="form-check-label flex-grow-1">
                                <strong>${prod.product_name}</strong>
                                <br />
                                <small class="text-muted">₱${parseFloat(prod.price).toFixed(2)} | Stock: ${prod.quantity}</small>
                            </label>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    const modalHTML = `
    <div class="modal fade" id="productReleaseDetailsModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Release Products for ${student.student_name}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <p><strong>Program:</strong> ${student.program_name}</p>
            <p><strong>Status:</strong> <span class="badge bg-${student.status === 'enrolled' ? 'success' : 'warning'}">${student.status}</span></p>
            <hr />
            <p class="fw-bold">Select products to release:</p>
            ${productsHtml}
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
            <button type="button" class="btn btn-success" id="releaseProductsBtn">Release</button>
          </div>
        </div>
      </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modalEl = document.getElementById('productReleaseDetailsModal');
    const modal = new bootstrap.Modal(modalEl);

    document.getElementById('releaseProductsBtn').addEventListener('click', async () => {
        const selectedCheckboxes = document.querySelectorAll('.product-release-checkbox:checked');
        if (selectedCheckboxes.length === 0) {
            Swal.fire('Info', 'Please select at least one product to release.', 'info');
            return;
        }

        const productIds = Array.from(selectedCheckboxes).map(cb => cb.value);
        const enrollmentId = student.enrollment_details_id;

        try {
            const response = await fetch(`${API_BASE_URL}enrollment.php`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    operation: 'releaseProducts',
                    enrollment_id: enrollmentId,
                    product_ids: productIds
                })
            });
            
            const result = await response.json();
            if (result.status === 'success') {
                Swal.fire('Success', 'Products released successfully!', 'success');
                
                // Mark student as released and add to history
                releasedStudents.add(student.enrollment_details_id);
                addToReleasedHistory(student);
                
                // Destroy modal and cleanup
                const modalInstance = bootstrap.Modal.getInstance(modalEl);
                if (modalInstance) modalInstance.dispose();
                modalEl.remove();
                document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.remove());
                
                // Only remove modal-open if no other modals are open
                if (document.querySelectorAll('.modal').length === 0) {
                    document.body.classList.remove('modal-open');
                }
                
                // Update release card count and history
                if (window.initProductPage && typeof window.initProductPage === 'function') {
                    setTimeout(() => {
                        window.initProductPage();
                    }, 500);
                }
            } else {
                Swal.fire('Error', result.message || 'Failed to release products', 'error');
            }
        } catch (error) {
            console.error('Error releasing products:', error);
            Swal.fire('Error', 'An error occurred while releasing products.', 'error');
        }
    });

    modalEl.addEventListener('hidden.bs.modal', () => {
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) modalInstance.dispose();
        document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.remove());
        document.body.classList.remove('modal-open');
        modalEl.remove();
    });
    
    modal.show();
}

export async function openProductReleaseModal() {
    if (!guardProductPermission('edit', 'You do not have permission to manage product releases.')) {
        return;
    }

    // Remove any existing modal
    const existingModal = document.getElementById('productReleaseModal');
    if (existingModal) {
        const existingModalInstance = bootstrap.Modal.getInstance(existingModal);
        if (existingModalInstance) existingModalInstance.dispose();
        existingModal.remove();
    }

    // Remove all lingering modal backdrops and reset body
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.remove());
    document.body.classList.remove('modal-open');

    const modalHTML = `
    <div class="modal fade" id="productReleaseModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-xl modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Students for Book Release</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <div class="input-group">
                <input id="releaseStudentSearch" type="text" class="form-control" placeholder="Search student name or program..." />
                <button id="releaseStudentSearchBtn" class="btn btn-outline-secondary" type="button">Search</button>
              </div>
            </div>
            <div class="table-responsive">
              <table class="table table-striped table-hover">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Program</th>
                    <th>Enrolled</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody id="releaseStudentsTableBody">
                  <tr><td colspan="5" class="text-center">Loading...</td></tr>
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
    const modalEl = document.getElementById('productReleaseModal');
    const modal = new bootstrap.Modal(modalEl);

    const loadData = async (searchTerm = '') => {
        const body = document.getElementById('releaseStudentsTableBody');
        if (!body) return;
        
        body.innerHTML = '<tr><td colspan="5" class="text-center">Loading...</td></tr>';
        
        const data = await getReleaseStudents(searchTerm);
        body.innerHTML = '';

        if (!data || data.length === 0) {
            body.innerHTML = '<tr><td colspan="5" class="text-center">No students to release.</td></tr>';
            return;
        }

        data.forEach(item => {
            const row = `
                <tr style="cursor:pointer;" class="student-row" data-student='${JSON.stringify(item)}'>
                    <td>${item.student_id || item.enrollment_details_id || 'N/A'}</td>
                    <td>${item.student_name || 'N/A'}</td>
                    <td>${item.program_name || 'N/A'}</td>
                    <td>${item.enrollment_date || 'N/A'}</td>
                    <td><span class="badge bg-${item.status === 'enrolled' ? 'success' : item.status === 'pending' ? 'warning' : 'secondary'}">${item.status || 'N/A'}</span></td>
                </tr>`;
            body.insertAdjacentHTML('beforeend', row);
        });

        // Add click handlers to student rows
        document.querySelectorAll('.student-row').forEach(row => {
            row.addEventListener('click', function() {
                const studentData = JSON.parse(this.getAttribute('data-student'));
                const modalInstance = bootstrap.Modal.getInstance(modalEl);
                if (modalInstance) modalInstance.dispose();
                modalEl.remove();
                document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.remove());
                document.body.classList.remove('modal-open');
                
                setTimeout(() => openProductReleaseDetailsModal(studentData), 300);
            });
        });
    };

    const searchInput = document.getElementById('releaseStudentSearch');
    const searchBtn = document.getElementById('releaseStudentSearchBtn');

    const performSearch = () => { 
        loadData(searchInput.value.trim());
    };

    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') performSearch();
    });

    modal.show();
    loadData();

    modalEl.addEventListener('hidden.bs.modal', () => {
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) modalInstance.dispose();
        document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.remove());
        document.body.classList.remove('modal-open');
        modalEl.remove();
    });
}
