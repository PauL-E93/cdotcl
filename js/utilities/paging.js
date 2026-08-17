// js/utilities/paging.js

class PaginationManager {
    constructor(options) {
        this.container = options.container; // The element where pagination will be rendered
        this.apiUrl = options.apiUrl; // The API endpoint for fetching data
        this.tableBody = options.tableBody; // The table body element to update
        this.onDataLoad = options.onDataLoad; // Callback function to handle data rendering
        this.localData = Array.isArray(options.localData) ? options.localData : null;
        this.showingElement = options.showingElement || null;
        this.currentPage = 1;
        this.perPage = options.perPage || 10;
        this.totalPages = 1;
        this.totalItems = 0;
    }

    // Initialize pagination
    init() {
        if (this.usesLocalData()) {
            this.setLocalData(this.localData || []);
            return;
        }

        this.loadPage(1);
    }

    usesLocalData() {
        return Array.isArray(this.localData);
    }

    // Load data for a specific page
    loadPage(page) {
        if (this.usesLocalData()) {
            this.renderLocalPage(page);
            return;
        }

        this.currentPage = page;
        const url = `${this.apiUrl}&page=${page}&limit=${this.perPage}`;

        axios.get(url)
            .then(response => {
                if (response.data.status === 'success') {
                    const data = response.data.data;
                    const pagination = response.data.pagination;

                    this.totalPages = pagination.total_pages;
                    this.totalItems = pagination.total;

                    // Update table body
                    this.renderTable(data);

                    // Update pagination UI
                    this.renderPagination();

                    // Update showing info
                    this.updateShowingInfo();
                }
            })
            .catch(error => {
                console.error('Error loading page:', error);
                this.tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Error loading data</td></tr>';
            });
    }

    setLocalData(data) {
        this.localData = Array.isArray(data) ? data : [];
        this.totalItems = this.localData.length;
        this.totalPages = Math.max(1, Math.ceil(this.totalItems / this.perPage));
        const targetPage = Math.min(this.currentPage, this.totalPages) || 1;
        this.renderLocalPage(targetPage);
    }

    renderLocalPage(page) {
        if (!this.usesLocalData()) return;

        this.currentPage = Math.min(Math.max(page, 1), this.totalPages);
        const startIndex = (this.currentPage - 1) * this.perPage;
        const pageData = this.localData.slice(startIndex, startIndex + this.perPage);

        this.renderTable(pageData);
        this.renderPagination();
        this.updateShowingInfo();
    }

    // Render table data
    renderTable(data) {
        if (this.onDataLoad) {
            this.onDataLoad(data);
        }
    }

    // Render pagination controls
    renderPagination() {
        const paginationHtml = this.generatePaginationHtml();
        this.container.innerHTML = paginationHtml;
        this.attachPaginationEvents();
    }

    // Generate HTML for pagination
    generatePaginationHtml() {
        let html = '<nav><ul class="pagination mb-0">';

        // Previous button
        const prevDisabled = this.currentPage === 1 ? 'disabled' : '';
        html += `<li class="page-item ${prevDisabled}"><a class="page-link" href="#" data-page="${this.currentPage - 1}" aria-label="Previous page">&#8249;</a></li>`;

        // Page numbers
        const startPage = Math.max(1, this.currentPage - 2);
        const endPage = Math.min(this.totalPages, this.currentPage + 2);

        if (startPage > 1) {
            html += `<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>`;
            if (startPage > 2) {
                html += `<li class="page-item disabled"><span class="page-link">&hellip;</span></li>`;
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            const activeClass = i === this.currentPage ? 'active' : '';
            html += `<li class="page-item ${activeClass}"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
        }

        if (endPage < this.totalPages) {
            if (endPage < this.totalPages - 1) {
                html += `<li class="page-item disabled"><span class="page-link">&hellip;</span></li>`;
            }
            html += `<li class="page-item"><a class="page-link" href="#" data-page="${this.totalPages}">${this.totalPages}</a></li>`;
        }

        // Next button
        const nextDisabled = this.currentPage === this.totalPages ? 'disabled' : '';
        html += `<li class="page-item ${nextDisabled}"><a class="page-link" href="#" data-page="${this.currentPage + 1}" aria-label="Next page">&#8250;</a></li>`;

        html += '</ul></nav>';
        return html;
    }

    // Attach click events to pagination links
    attachPaginationEvents() {
        const links = this.container.querySelectorAll('.page-link');
        links.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = parseInt(e.target.getAttribute('data-page'));
                if (page && page !== this.currentPage && page >= 1 && page <= this.totalPages) {
                    if (this.usesLocalData()) {
                        this.renderLocalPage(page);
                        return;
                    }

                    this.loadPage(page);
                }
            });
        });
    }

    // Update the "Showing X to Y of Z entries" text
    updateShowingInfo() {
        let infoText = 'Showing 0 of 0 entries';

        if (this.totalItems > 0) {
            const start = (this.currentPage - 1) * this.perPage + 1;
            const end = Math.min(this.currentPage * this.perPage, this.totalItems);
            infoText = `Showing ${start} to ${end} of ${this.totalItems} entries`;
        }

        const showingElement = this.showingElement || this.container.previousElementSibling;
        if (showingElement && showingElement.classList.contains('text-muted')) {
            showingElement.textContent = infoText;
        }
    }

    // Refresh current page
    refresh() {
        if (this.usesLocalData()) {
            this.renderLocalPage(this.currentPage);
            return;
        }

        this.loadPage(this.currentPage);
    }

    // Change items per page
    setPerPage(perPage) {
        this.perPage = perPage;
        if (this.usesLocalData()) {
            this.totalPages = Math.max(1, Math.ceil(this.totalItems / this.perPage));
            this.renderLocalPage(1);
            return;
        }

        this.loadPage(1);
    }
}

// Export for use in other modules
window.PaginationManager = PaginationManager;
