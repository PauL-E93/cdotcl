// js/modules/product.js

// 1. CONFIGURATION
const API_BASE_URL = '../../api/admin/';

// Import program_products module
import { ProgramProductsModule, createProgramMultiSelect, getSelectedProgramIds, getProgramNameById } from './program_products.js';
import { canUseProductPermission, guardProductPermission } from './product_rbac.js';

// =========================================================
// SECTION A: DATA LAYER (API CALLS)
// =========================================================
const InventoryModule = {
    // ... existing code ...
    
    async getProducts() {
        try {
            const response = await fetch(`${API_BASE_URL}product.php?operation=getAllProducts`);
            return await response.json();
        } catch (error) {
            console.error("Error fetching products:", error);
            return [];
        }
    },

    async getProduct(productId) {
        try {
            const json = JSON.stringify({ product_id: productId });
            const response = await fetch(`${API_BASE_URL}product.php?operation=getProduct&json=${json}`);
            const data = await response.json();
            return data.length > 0 ? data[0] : null;
        } catch (error) {
            console.error("Error fetching product details:", error);
            return null;
        }
    },

    async addProduct(productData) {
        const formData = new FormData();
        formData.append('operation', 'insertProduct');
        formData.append('json', JSON.stringify(productData));
        try {
            const response = await fetch(`${API_BASE_URL}product.php`, { method: 'POST', body: formData });
            return await response.json(); 
        } catch (error) { return 0; }
    },

    async updateProduct(productData) {
        const formData = new FormData();
        formData.append('operation', 'updateProduct');
        formData.append('json', JSON.stringify(productData));
        try {
            const response = await fetch(`${API_BASE_URL}product.php`, { method: 'POST', body: formData });
            return await response.json();
        } catch (error) { return 0; }
    },

    async getCategories() {
        try {
            const response = await fetch(`${API_BASE_URL}category.php?operation=getAllCategories`);
            return await response.json();
        } catch (error) { return []; }
    },

    async getEnrollmentStats(type = '') {
        try {
            const url = `${API_BASE_URL}enrollment.php?operation=getEnrollmentStats${type ? `&type=${type}` : ''}`;
            const response = await fetch(url);
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Error fetching enrollment stats:', error);
            return { status: 'error', data: null };
        }
    },

    async addCategory(name) {
        const formData = new FormData();
        formData.append('operation', 'insertCategory');
        formData.append('json', JSON.stringify({ category_name: name }));
        try {
            const response = await fetch(`${API_BASE_URL}category.php`, { method: 'POST', body: formData });
            return await response.json();
        } catch (error) { return 0; }
    }
};

// =========================================================
// SECTION B: UI LAYER (DOM MANIPULATION)
// =========================================================

// Helper function to update the selected programs list
function updateSelectedProgramsList(listElement, selectedPrograms, programs) {
    listElement.innerHTML = '';
    selectedPrograms.forEach(programId => {
        const programName = getProgramNameById(programs, programId);
        const item = document.createElement('div');
        item.className = 'd-flex justify-content-between align-items-center mb-1';
        item.innerHTML = `
            <span>${programName}</span>
            <button type="button" class="btn btn-sm btn-outline-danger" onclick="removeProgram(${programId})">Remove</button>
        `;
        listElement.appendChild(item);
    });
}

// 1. Load and Render Product Table
export async function initProductPage() {
    const tableBody = document.getElementById('productTableBody'); 
    
    if (!tableBody) {
        console.warn("Table body 'productTableBody' not found.");
        return; 
    }

    const products = await InventoryModule.getProducts();

    // Update product stats
    const countEl = document.getElementById('total-products-count');
    if (countEl) countEl.innerText = products.length;

    let html = '';

    if (products.length === 0) {
        html = `<tr><td colspan="6" class="text-center">No products found.</td></tr>`;
    } else {
        products.forEach(p => {
            const quantity = parseInt(p.quantity);
            const dbStatus = p.status ? p.status.toLowerCase() : 'active';
            
            // Logic: Default to DB status
            let badgeClass = 'bg-success'; 
            let statusText = 'Active';

            if (dbStatus === 'inactive') {
                badgeClass = 'bg-secondary';
                statusText = 'Inactive';
            } else {
                // Only check stock levels if the product is actually Active
                if (quantity <= 5) {
                    badgeClass = 'bg-danger';
                    statusText = 'Critical';
                } else if (quantity <= 10) {
                    badgeClass = 'bg-warning text-dark';
                    statusText = 'Low Stock';
                } else {
                    badgeClass = 'bg-success';
                    statusText = 'Active';
                }
            }

            html += `
            <tr data-product-row>
                <td class="fw-bold">${p.name}</td>
                <td>${p.category_name || 'Uncategorized'}</td>
                <td>${p.quantity}</td>
                <td>₱${parseFloat(p.price).toFixed(2)}</td>
                <td><span class="badge ${badgeClass}">${statusText}</span></td>
                <td>
                    ${canUseProductPermission('edit')
                        ? `<button class="btn btn-sm btn-outline-primary me-1" onclick="editProductUI(${p.product_id})">
                            <i class="bi bi-pencil"></i>
                        </button>`
                        : '<span class="text-muted">-</span>'}
                </td>
            </tr>`;
        });
    }

    tableBody.innerHTML = html;

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        const applyProductSearch = () => {
            const query = searchInput.value.trim().toLowerCase();
            const productRows = Array.from(tableBody.querySelectorAll('[data-product-row]'));
            let visibleRows = 0;

            productRows.forEach(row => {
                const matches = row.textContent.toLowerCase().includes(query);
                row.hidden = !matches;
                if (matches) visibleRows += 1;
            });

            let emptySearchRow = tableBody.querySelector('[data-product-search-empty]');
            if (!emptySearchRow && productRows.length > 0) {
                emptySearchRow = document.createElement('tr');
                emptySearchRow.setAttribute('data-product-search-empty', '');
                emptySearchRow.innerHTML = '<td colspan="6" class="text-center text-muted">No products match your search.</td>';
                tableBody.appendChild(emptySearchRow);
            }

            if (emptySearchRow) {
                emptySearchRow.hidden = !query || visibleRows > 0;
            }
        };

        searchInput.oninput = applyProductSearch;
        applyProductSearch();
    }
}

// --- GLOBAL HANDLERS ---

window.editProductUI = async (id) => {
    await openEditProductModal(id);
};

window.removeProgram = (programId) => {
    // This will be set in the modal context
};


// 2. Open Add Product Modal
export async function openAddProductModal() {
    if (!guardProductPermission('create', 'You do not have permission to create product records.')) {
        return;
    }

    const [categories, programs] = await Promise.all([
        InventoryModule.getCategories(),
        ProgramProductsModule.getPrograms()
    ]);

    let categoryOptions = categories.map(c =>
        `<option value="${c.category_id}">${c.category_name}</option>`
    ).join('');

    let programOptions = programs.map(p =>
        `<option value="${p.program_id}">${p.name}</option>`
    ).join('');

    const modalHTML = `
    <div class="modal fade" id="addProductModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Add New Product</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <form id="addProductForm">
                <div class="mb-3">
                    <label class="form-label">Product Name <span class="text-danger" aria-hidden="true">*</span></label>
                    <input type="text" class="form-control" name="name" required>
                </div>
                <div class="row">
                    <div class="col-md-6 mb-3">
                        <label class="form-label">Price <span class="text-danger" aria-hidden="true">*</span></label>
                        <input type="number" step="0.01" class="form-control" name="price" required>
                    </div>
                    <div class="col-md-6 mb-3">
                        <label class="form-label">Quantity <span class="text-danger" aria-hidden="true">*</span></label>
                        <input type="number" class="form-control" name="quantity" required>
                    </div>
                </div>
                <div class="mb-3">
                    <label class="form-label">Category <span class="text-danger" aria-hidden="true">*</span></label>
                    <select class="form-select" name="category_id" required>
                        <option value="">Select Category...</option>
                        ${categoryOptions}
                    </select>
                </div>
                <div class="mb-3">
                    <label class="form-label">Associated Programs</label>
                    <div class="d-flex gap-2 mb-2">
                        <select class="form-select" id="programSelect">
                            <option value="">Select Program...</option>
                            ${programOptions}
                        </select>
                        <button type="button" class="btn btn-outline-primary" id="addProgramBtn">Add</button>
                    </div>
                    <div id="selectedProgramsList" class="border rounded p-2" style="min-height: 50px;">
                        <!-- Selected programs will be added here -->
                    </div>
                </div>
                <div class="mb-3">
                    <label class="form-label">Status</label>
                    <select class="form-select" name="status">
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                    </select>
                </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
            <button type="button" class="btn btn-primary" id="saveProductBtn">Save Product</button>
          </div>
        </div>
      </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modalEl = document.getElementById('addProductModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();

    // Handle adding programs
    let selectedPrograms = [];
    const programSelect = document.getElementById('programSelect');
    const addProgramBtn = document.getElementById('addProgramBtn');
    const selectedProgramsList = document.getElementById('selectedProgramsList');

    addProgramBtn.addEventListener('click', () => {
        const selectedProgramId = parseInt(programSelect.value);
        if (selectedProgramId && !selectedPrograms.includes(selectedProgramId)) {
            selectedPrograms.push(selectedProgramId);
            updateSelectedProgramsList(selectedProgramsList, selectedPrograms, programs);
            programSelect.value = '';
        }
    });

    document.getElementById('saveProductBtn').addEventListener('click', async () => {
        const form = document.getElementById('addProductForm');
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        // Add product first
        const productSuccess = await InventoryModule.addProduct(data);
        let programSuccess = true;
        if (productSuccess) {
            // Get the newly added product ID
            const products = await InventoryModule.getProducts();
            const newProduct = products.find(p => p.name === data.name);
            if (newProduct) {
                // Add program-products
                for (const programId of selectedPrograms) {
                    const result = await ProgramProductsModule.addProgramProduct(programId, newProduct.product_id);
                    if (result !== 1) programSuccess = false;
                }
            }
        }

        if (productSuccess && programSuccess) {
            Swal.fire('Success', 'Product Added Successfully!', 'success');
            modal.hide();
            initProductPage();
        } else {
            Swal.fire('Error', 'Failed to add product.', 'error');
        }
        setTimeout(() => modalEl.remove(), 500);
    });

    modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
}

// 3. Open Edit Product Modal
export async function openEditProductModal(productId) {
    if (!guardProductPermission('edit', 'You do not have permission to update product records.')) {
        return;
    }

    const [product, categories, programs, currentProgramProducts] = await Promise.all([
        InventoryModule.getProduct(productId),
        InventoryModule.getCategories(),
        ProgramProductsModule.getPrograms(),
        ProgramProductsModule.getProgramProductsForProduct(productId)
    ]);

    if (!product) {
        Swal.fire('Error', 'Product not found', 'error');
        return;
    }

    let categoryOptions = categories.map(c =>
        `<option value="${c.category_id}" ${c.category_id == product.category_id ? 'selected' : ''}>
            ${c.category_name}
        </option>`
    ).join('');

    let programOptions = programs.map(p =>
        `<option value="${p.program_id}">${p.name}</option>`
    ).join('');

    // Logic for Pre-selecting Active/Inactive
    const pStatus = product.status ? product.status.toLowerCase() : 'active';
    const statusActive = pStatus === 'active' ? 'selected' : '';
    const statusInactive = pStatus === 'inactive' ? 'selected' : '';

    const modalHTML = `
    <div class="modal fade" id="editProductModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Edit Product</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <form id="editProductForm">
                <input type="hidden" name="product_id" value="${product.product_id}">

                <div class="mb-3">
                    <label class="form-label">Product Name <span class="text-danger" aria-hidden="true">*</span></label>
                    <input type="text" class="form-control" name="name" value="${product.name}" required>
                </div>
                <div class="row">
                    <div class="col-md-6 mb-3">
                        <label class="form-label">Price <span class="text-danger" aria-hidden="true">*</span></label>
                        <input type="number" step="0.01" class="form-control" name="price" value="${product.price}" required>
                    </div>
                    <div class="col-md-6 mb-3">
                        <label class="form-label">Quantity <span class="text-danger" aria-hidden="true">*</span></label>
                        <input type="number" class="form-control" name="quantity" value="${product.quantity}" required>
                    </div>
                </div>
                <div class="mb-3">
                    <label class="form-label">Category <span class="text-danger" aria-hidden="true">*</span></label>
                    <select class="form-select" name="category_id" required>
                        <option value="">Select Category...</option>
                        ${categoryOptions}
                    </select>
                </div>
                <div class="mb-3">
                    <label class="form-label">Associated Programs</label>
                    <div class="d-flex gap-2 mb-2">
                        <select class="form-select" id="editProgramSelect">
                            <option value="">Select Program...</option>
                            ${programOptions}
                        </select>
                        <button type="button" class="btn btn-outline-primary" id="editAddProgramBtn">Add</button>
                    </div>
                    <div id="editSelectedProgramsList" class="border rounded p-2" style="min-height: 50px;">
                        <!-- Selected programs will be added here -->
                    </div>
                </div>
                <div class="mb-3">
                    <label class="form-label">Status</label>
                    <select class="form-select" name="status">
                        <option value="Active" ${statusActive}>Active</option>
                        <option value="Inactive" ${statusInactive}>Inactive</option>
                    </select>
                </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
            <button type="button" class="btn btn-primary" id="updateProductBtn">Update Product</button>
          </div>
        </div>
      </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modalEl = document.getElementById('editProductModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();

    // Handle adding/removing programs
    let selectedPrograms = currentProgramProducts.map(pp => pp.program_id);
    const programSelect = document.getElementById('editProgramSelect');
    const addProgramBtn = document.getElementById('editAddProgramBtn');
    const selectedProgramsList = document.getElementById('editSelectedProgramsList');

    // Initialize the list with current programs
    updateSelectedProgramsList(selectedProgramsList, selectedPrograms, programs);

    addProgramBtn.addEventListener('click', () => {
        const selectedProgramId = parseInt(programSelect.value);
        if (selectedProgramId && !selectedPrograms.includes(selectedProgramId)) {
            selectedPrograms.push(selectedProgramId);
            updateSelectedProgramsList(selectedProgramsList, selectedPrograms, programs);
            programSelect.value = '';
        }
    });

    // Override the global removeProgram function for this modal
    window.removeProgram = (programId) => {
        selectedPrograms = selectedPrograms.filter(id => id !== programId);
        updateSelectedProgramsList(selectedProgramsList, selectedPrograms, programs);
    };

    document.getElementById('updateProductBtn').addEventListener('click', async () => {
        const form = document.getElementById('editProductForm');
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        // Update product (the API returns 1 on row-change, 0 if no rows affected)
        const productResp = await InventoryModule.updateProduct(data);
        console.log('updateProduct response:', productResp);

        // Treat numeric response (1 or 0) as a successful API call —
        // 0 can mean "no rows changed" which is fine when only program assignments change.
        const productCallSuccess = (typeof productResp === 'number');

        let programSuccess = true;
        if (productCallSuccess) {
            // Always attempt to update program-products even if DB reported 0 rows affected
            programSuccess = await ProgramProductsModule.updateProgramProductsForProduct(productId, selectedPrograms);
        }

        if (productCallSuccess && programSuccess) {
            Swal.fire('Success', 'Product Updated!', 'success');
            modal.hide();
            initProductPage();
        } else {
            // Provide more details to help debugging
            const details = {
                productResp,
                programSuccess
            };
            console.error('Failed to update product or programs:', details);
            Swal.fire('Error', 'Failed to update product. See console for details.', 'error');
        }
        setTimeout(() => modalEl.remove(), 500);
    });

    modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
}


// 4. Open Add Category Modal
export function openAddCategoryModal() {
    if (!guardProductPermission('create', 'You do not have permission to create product categories.')) {
        return;
    }

    const modalHTML = `
    <div class="modal fade" id="addCategoryModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-sm">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Add Category</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <label class="form-label">Category Name <span class="text-danger" aria-hidden="true">*</span></label>
            <input type="text" id="newCategoryName" class="form-control" placeholder="Category Name" required>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-primary" id="saveCategoryBtn">Save</button>
          </div>
        </div>
      </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modalEl = document.getElementById('addCategoryModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();

    document.getElementById('saveCategoryBtn').addEventListener('click', async () => {
        const name = document.getElementById('newCategoryName').value;
        if(name) {
            const success = await InventoryModule.addCategory(name);
            if(success) {
                Swal.fire('Success', 'Category Added!', 'success');
                modal.hide();
            } else {
                Swal.fire('Error', 'Error adding category', 'error');
            }
        }
        setTimeout(() => modalEl.remove(), 500);
    });

    modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
}
