export function createReportCardSection(data) {
    const reportCard = data.reportCard;

    if (!reportCard) {
        return `
            <div id="report-card-section" class="card shadow-sm border-0 p-4 mb-4">
                <div class="d-flex justify-content-between align-items-start gap-3">
                    <div>
                        <h5 class="fw-bold mb-1">Parent Report Card</h5>
                        <div class="text-muted small">Teacher evaluation will appear here once posted.</div>
                    </div>
                    <span class="badge bg-light text-muted border">Pending</span>
                </div>
            </div>
        `;
    }

    const average = reportCard.overall_average ?? 0;
    const status = (reportCard.status || '').toLowerCase();
    const criteria = Array.isArray(reportCard.criteria) ? reportCard.criteria : [];
    const rows = criteria.map(item => {
        const score = Number(item.score ?? 0);
        const safeScore = Math.max(0, Math.min(100, Number.isNaN(score) ? 0 : score));

        return `
            <div class="mb-3">
                <div class="d-flex justify-content-between gap-3 small mb-1">
                    <span class="fw-semibold">${escapeHtml(item.label)}</span>
                    <span class="fw-bold">${safeScore}%</span>
                </div>
                <div class="progress" style="height: 7px;">
                    <div class="progress-bar bg-danger" style="width: ${safeScore}%"></div>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div id="report-card-section" class="card shadow-sm border-0 p-4 mb-4">
            <div class="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-4">
                <div>
                    <h5 class="fw-bold mb-1">Parent Report Card</h5>
                    <div class="text-muted small">Posted by ${escapeHtml(reportCard.teacher_name || 'Teacher')}</div>
                </div>
                <span class="badge ${getReportStatusBadgeClass(status)} text-uppercase">${escapeHtml(status || 'posted')}</span>
            </div>

            <div class="row g-4 align-items-start">
                <div class="col-md-4">
                    <div class="p-3 rounded-3 text-center" style="background:#fff5f5; border:1px solid #fecaca;">
                        <div class="text-muted small mb-1">Overall Grade</div>
                        <div class="display-6 fw-bold text-danger">${average}%</div>
                    </div>
                </div>
                <div class="col-md-8">
                    ${rows}
                </div>
            </div>

            <div class="mt-3 pt-3 border-top">
                <div class="text-muted small mb-1">Teacher Remarks</div>
                <p class="mb-0">${escapeHtml(reportCard.remarks || 'No remarks added.')}</p>
            </div>
        </div>
    `;
}

function getReportStatusBadgeClass(status) {
    if (status === 'passed') return 'bg-success-subtle text-success';
    if (status === 'failed') return 'bg-danger-subtle text-danger';
    return 'bg-light text-muted border';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
