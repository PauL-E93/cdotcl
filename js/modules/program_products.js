// js/modules/program_products.js

// 1. CONFIGURATION
const API_BASE_URL = '../../api/admin/';

// =========================================================
// SECTION A: DATA LAYER (API CALLS)
// =========================================================
export const ProgramProductsModule = {

    async getProducts() {
        try {
            const response = await fetch(`${API_BASE_URL}product.php?operation=getAllProducts`);
            return await response.json();
        } catch (error) {
            console.error("Error fetching products:", error);
            return [];
        }
    },

    async getProgramProductsForProgram(programId) {
        const allAssignments = await this.getProgramProducts();
        return allAssignments.filter(pp => pp.program_id == programId);
    },

    async getPrograms() {
        try {
            const response = await fetch(`${API_BASE_URL}program.php?operation=getPrograms`);
            const data = await response.json();
            return data.status === 'success' ? data.data : [];
        } catch (error) {
            console.error("Error fetching programs:", error);
            return [];
        }
    },

    async getProgramProducts() {
        try {
            const response = await fetch(`${API_BASE_URL}program_products.php?operation=getProgramProducts`);
            return await response.json();
        } catch (error) {
            console.error("Error fetching program products:", error);
            return [];
        }
    },

    async getProgramProductsForProduct(productId) {
        const allAssignments = await this.getProgramProducts();
        return allAssignments.filter(pp => pp.product_id == productId);
    },

    async addProgramProduct(programId, productId) {
        const formData = new FormData();
        formData.append('operation', 'insertProgramProduct');
        formData.append('json', JSON.stringify({ program_id: programId, product_id: productId }));
        try {
            const response = await fetch(`${API_BASE_URL}program_products.php`, { method: 'POST', body: formData });
            return await response.json();
        } catch (error) {
            console.error("Error adding program product:", error);
            return 0;
        }
    },

    async removeProgramProduct(programProductsId) {
        const formData = new FormData();
        formData.append('operation', 'deleteProgramProduct');
        formData.append('json', JSON.stringify({ program_products_id: programProductsId }));
        try {
            const response = await fetch(`${API_BASE_URL}program_products.php`, { method: 'POST', body: formData });
            return await response.json();
        } catch (error) {
            console.error("Error removing program product:", error);
            return 0;
        }
    },

    async updateProgramProductsForProduct(productId, selectedProgramIds) {
        // First, get current assignments
        const currentAssignments = await this.getProgramProductsForProduct(productId);
        const currentProgramIds = currentAssignments.map(pp => pp.program_id);

        // Determine which to add and which to remove
        const toAdd = selectedProgramIds.filter(id => !currentProgramIds.includes(id));
        const toRemove = currentAssignments.filter(pp => !selectedProgramIds.includes(pp.program_id));

        let success = true;

        // Add new assignments
        for (const programId of toAdd) {
            const result = await this.addProgramProduct(programId, productId);
            if (result !== 1) success = false;
        }

        // Remove old assignments
        for (const assignment of toRemove) {
            const result = await this.removeProgramProduct(assignment.id);
            if (result !== 1) success = false;
        }

        return success;
    }
};

// =========================================================
// SECTION B: UI LAYER (DOM MANIPULATION)
// =========================================================

// Function to create a multi-select dropdown for programs
export function createProgramMultiSelect(selectedProgramIds = []) {
    const programs = ProgramProductsModule.getPrograms();

    // Assuming programs is an array of {program_id, name, ...}
    const options = programs.map(p =>
        `<option value="${p.program_id}" ${selectedProgramIds.includes(p.program_id) ? 'selected' : ''}>${p.name}</option>`
    ).join('');

    return `
        <div class="mb-3">
            <label class="form-label">Associated Programs</label>
            <select class="form-select" name="program_ids" multiple required>
                ${options}
            </select>
            <small class="form-text text-muted">Hold Ctrl (or Cmd) to select multiple programs.</small>
        </div>`;
}

// Function to get selected program IDs from a multi-select
export function getSelectedProgramIds(selectElement) {
    const selectedOptions = Array.from(selectElement.selectedOptions);
    return selectedOptions.map(option => parseInt(option.value));
}

// Function to get program name by ID
export function getProgramNameById(programs, programId) {
    const program = programs.find(p => p.program_id == programId);
    return program ? program.name : 'Unknown Program';
}

// Function to create read-only view list of products for a program
export function createProductViewList(programProducts, allProducts) {
    if (!programProducts || programProducts.length === 0) {
        return '<div class="alert alert-info"><small>No products associated with this program.</small></div>';
    }

    const html = programProducts.map(pp => {
        const product = allProducts.find(p => p.product_id == pp.product_id);
        if (!product) return '';

        const statusBadge = product.status === 'Active' ? 'bg-success' : 'bg-secondary';
        return `
            <div class="d-flex justify-content-between align-items-center border-bottom pb-2 mb-2">
                <div>
                    <strong>${product.name}</strong><br>
                    <small class="text-muted">₱${parseFloat(product.price || 0).toFixed(2)} | Qty: ${product.quantity || 0}</small>
                </div>
                <span class="badge ${statusBadge}">${product.status || 'Unknown'}</span>
            </div>
        `;
    }).join('');

    return `<div class="p-3 border rounded"><h6>Associated Products <small class="text-muted"></small></h6>${html}</div>`;
}
