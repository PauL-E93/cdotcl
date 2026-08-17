import {
    PLAY_SCHOOL_AGE_GROUPS,
    PLAY_SCHOOL_SCALED_SCORE_INTERPRETATIONS,
    PLAY_SCHOOL_STANDARD_SCORE_INTERPRETATIONS,
    calculatePlaySchoolEccdResult,
    normalizePlaySchoolDomainKey,
    normalizePlaySchoolInterpretations,
    normalizePlaySchoolStandardScoreRows,
    normalizePlaySchoolTransmutationTables
} from './card_mangplay.js';
import { getApiErrorMessage, isHostedBrowserChallenge, normalizeApiResponse } from '../utilities/api_response.js?v=20260812-hosted-json5';
import {
    getFinalSummaryQuarter,
    getQuarterLabel,
    getQuarterNumbers,
    normalizeSchoolYearContext
} from '../utilities/school_year_context.js';

const defaultLearningAreas = [
    'Writing',
    'Reading',
    'Speaking',
    'Language',
    'Counting/Numbering',
    'Art and Craft',
    'Playing/Sharing'
];

const gradeOptions = ['A+', 'A', 'B', 'C', 'D', 'F'];
const gradeScores = { 'A+': 6, A: 5, B: 4, C: 3, D: 2, F: 1 };
const DEFAULT_TRANSMUTATION_ROWS = [
    { min_percentage: 95, max_percentage: 100, transmuted_letter: 'A+' },
    { min_percentage: 90, max_percentage: 94.99, transmuted_letter: 'A' },
    { min_percentage: 85, max_percentage: 89.99, transmuted_letter: 'B' },
    { min_percentage: 80, max_percentage: 84.99, transmuted_letter: 'C' },
    { min_percentage: 75, max_percentage: 79.99, transmuted_letter: 'D' },
    { min_percentage: 0, max_percentage: 74.99, transmuted_letter: 'F' }
];
const gradePercentages = {
    'A+': 95,
    A: 90,
    B: 85,
    C: 80,
    D: 75,
    F: 59
};
const playSchoolProgressLabels = [
    { grade: 'A+', label: 'Very Good' },
    { grade: 'A', label: 'Very Good' },
    { grade: 'B', label: 'Good' },
    { grade: 'C', label: 'Good' },
    { grade: 'D', label: 'Developing' },
    { grade: 'F', label: 'Developing' }
];
const playSchoolDomainLabels = {
    gross_motor: 'Gross Motor',
    fine_motor: 'Fine Motor',
    self_help: 'Self-Help',
    receptive_language: 'Receptive Language',
    expressive_language: 'Expressive Language',
    cognitive: 'Cognitive',
    social_emotional: 'Social-Emotional'
};

let currentSectionId = null;
let currentQuarter = 1;
let currentLearningAreas = defaultLearningAreas.map((label, index) => ({ area_id: index + 1, label }));
let currentSectionDetails = {};
let currentSchoolYearContext = normalizeSchoolYearContext(null);
let currentTransmutationRows = [...DEFAULT_TRANSMUTATION_ROWS];
let currentPlaySchoolTransmutationTables = normalizePlaySchoolTransmutationTables();
let currentPlaySchoolStandardScoreRows = normalizePlaySchoolStandardScoreRows();
let currentPlaySchoolInterpretations = {
    scaled: PLAY_SCHOOL_SCALED_SCORE_INTERPRETATIONS,
    standard: PLAY_SCHOOL_STANDARD_SCORE_INTERPRETATIONS
};
let reportCardRenderMode = 'modal';

function setCurrentSchoolYearContext(context) {
    currentSchoolYearContext = normalizeSchoolYearContext(context);
    const quarters = getReportQuarterNumbers();
    if (!quarters.includes(currentQuarter)) currentQuarter = quarters[0] || 1;
}

function getReportQuarterNumbers() {
    return getQuarterNumbers(currentSchoolYearContext);
}

function getReportQuarterLabels(short = false) {
    return getReportQuarterNumbers().map(quarter => getQuarterLabel(currentSchoolYearContext, quarter, short));
}

function getReportQuarterLabel(quarter, short = false) {
    return getQuarterLabel(currentSchoolYearContext, quarter, short);
}

function getReportFinalQuarter() {
    return getFinalSummaryQuarter(currentSchoolYearContext);
}

export async function openSectionReportCards(sectionId) {
    if (
        window.location.pathname.includes('/owner/class.html')
        || window.location.pathname.includes('/teacher/class.html')
        || window.location.pathname.includes('/secretary/class.html')
    ) {
        window.location.href = `section_report_cards.html?section_id=${encodeURIComponent(sectionId)}`;
        return;
    }

    reportCardRenderMode = 'modal';
    currentSectionId = sectionId;
    await loadAndRenderSectionReportCards();
}

// Opens one student's ECCD checklist directly from an embedded section view.
export async function openStudentEccdChecklist(sectionId, enrollmentId) {
    currentSectionId = Number(sectionId);
    currentQuarter = 1;

    try {
        const response = await requestSectionReportCards(currentSectionId, enrollmentId);
        const responseData = normalizeApiResponse(response.data);
        if (isHostedBrowserChallenge(responseData)) {
            throw new Error('InfinityFree browser verification blocked the request. Refresh this page once, then try again.');
        }
        if (responseData?.status !== 'success') {
            throw new Error(responseData?.message || responseData?.error || 'The hosted report-card API returned an empty, HTML, or unsupported response.');
        }

        const data = responseData.data || {};
        currentSectionDetails = data.section || {};
        currentLearningAreas = normalizeLearningAreas(data.learning_areas);
        currentTransmutationRows = normalizeTransmutationRows(data.transmutation);
        currentPlaySchoolTransmutationTables = normalizePlaySchoolTransmutationTables(data.play_school_transmutation);
        currentPlaySchoolStandardScoreRows = normalizePlaySchoolStandardScoreRows(data.play_school_standard_scores);
        currentPlaySchoolInterpretations = {
            scaled: normalizePlaySchoolInterpretations(data.play_school_interpretations?.scaled, PLAY_SCHOOL_SCALED_SCORE_INTERPRETATIONS),
            standard: normalizePlaySchoolInterpretations(data.play_school_interpretations?.standard, PLAY_SCHOOL_STANDARD_SCORE_INTERPRETATIONS)
        };

        const student = (Array.isArray(data.students) ? data.students : []).find(item => Number(item.enrollment_details_id) === Number(enrollmentId));
        if (!student) throw new Error('Student record was not found in this section.');
        setCurrentSchoolYearContext(student.report_card?.school_year || data.school_year);
        currentLearningAreas = normalizeLearningAreas(student.report_card?.learning_areas || data.learning_areas);
        openPlaySchoolEccdEditor(student, null, { reloadReportCards: false });
    } catch (error) {
        console.error('Error opening ECCD checklist:', error);
        Swal.fire('Error', error.message || 'Unable to open the ECCD checklist.', 'error');
    }
}

export async function initSectionReportCardsPage() {
    const root = document.getElementById('sectionReportCardsPageRoot');
    if (!root) return;

    const params = new URLSearchParams(window.location.search);
    currentSectionId = Number(params.get('section_id') || 0);
    reportCardRenderMode = 'page';

    root.innerHTML = createReportCardPageShell();

    if (!currentSectionId) {
        root.querySelector('.modal-body').innerHTML = `
            <div class="alert alert-warning mb-0">No section was selected.</div>
        `;
        return;
    }

    await loadAndRenderSectionReportCards();
}

async function loadAndRenderSectionReportCards() {
    if (!currentSectionId) return;

    if (reportCardRenderMode === 'page') {
        renderPageLoadingState();
    } else {
        showLoadingModal();
    }

    try {
        const response = await requestSectionReportCards(currentSectionId);
        const responseData = normalizeApiResponse(response.data);

        if (responseData?.status !== 'success') {
            Swal.fire('Error', responseData?.message || responseData?.error || 'Unable to load section report cards.', 'error');
            return;
        }

        renderReportCardModal(responseData.data);
    } catch (error) {
        console.error('Error loading section report cards:', error);
        Swal.fire('Error', getApiErrorMessage(error, 'Network error while loading section report cards.'), 'error');
    }
}

function requestSectionReportCards(sectionId, enrollmentId = null) {
    const params = {
        operation: 'getSectionReportCards',
        section_id: sectionId,
        _request_time: Date.now()
    };
    if (enrollmentId) params.enrollment_details_id = enrollmentId;

    return axios.get('../../api/admin/student_grade.php', {
        params,
        headers: { Accept: 'application/json' },
        responseType: 'text'
    });
}

function createReportCardPageShell() {
    return `
        <div id="sectionReportCardsModal" class="section-report-page">
            <style>
                .section-report-page {
                    display: grid;
                    gap: 1rem;
                }
                .section-report-page-heading,
                .section-report-page-body {
                    background: #fff;
                    border: 1px solid rgba(15, 23, 42, 0.08);
                    border-radius: 8px;
                    padding: 1rem;
                }
                .section-report-page-heading {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    gap: 1rem;
                    flex-wrap: wrap;
                }
                .section-report-page-body {
                    min-height: 420px;
                    overflow-x: auto;
                }
                .section-report-page .gradebook-shell {
                    padding: 0;
                    box-shadow: none;
                    border: 0;
                }
            </style>
            <div class="section-report-page-heading">
                <div>
                    <h2 class="modal-title h4 fw-bold mb-1">Section Report Cards</h2>
                    <div class="text-muted small">Loading section details...</div>
                </div>
                <a href="class.html" class="btn btn-outline-secondary">
                    <i class="bi bi-arrow-left me-1"></i>Back to Class
                </a>
            </div>
            <div class="modal-body section-report-page-body">
                <div class="text-muted py-4">
                    <i class="bi bi-hourglass-split me-2"></i>Loading report cards...
                </div>
            </div>
        </div>
    `;
}

function renderPageLoadingState() {
    const host = document.getElementById('sectionReportCardsModal');
    if (!host) return;

    host.querySelector('.modal-title').textContent = 'Section Report Cards';
    host.querySelector('.modal-body').innerHTML = `
        <div class="text-muted py-4">
            <i class="bi bi-hourglass-split me-2"></i>Loading report cards...
        </div>
    `;
}

function showLoadingModal() {
    const existing = document.getElementById('sectionReportCardsModal');
    if (existing) existing.remove();

    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="sectionReportCardsModal" tabindex="-1">
            <div class="modal-dialog modal-xl">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Section Report Cards</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="text-muted py-4">
                            <i class="bi bi-hourglass-split me-2"></i>Loading report cards...
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    bootstrap.Modal.getOrCreateInstance(document.getElementById('sectionReportCardsModal')).show();
}

function renderReportCardModal(data) {
    const modal = document.getElementById('sectionReportCardsModal');
    if (!modal) return;

    const section = data.section || {};
    const students = Array.isArray(data.students) ? data.students : [];
    const firstStudentReportCard = students[0]?.report_card || {};
    setCurrentSchoolYearContext(firstStudentReportCard.school_year || data.school_year);
    currentSectionDetails = section;
    currentLearningAreas = normalizeLearningAreas(firstStudentReportCard.learning_areas || data.learning_areas);
    currentTransmutationRows = normalizeTransmutationRows(data.transmutation);
    currentPlaySchoolTransmutationTables = normalizePlaySchoolTransmutationTables(data.play_school_transmutation);
    currentPlaySchoolStandardScoreRows = normalizePlaySchoolStandardScoreRows(data.play_school_standard_scores);
    currentPlaySchoolInterpretations = {
        scaled: normalizePlaySchoolInterpretations(data.play_school_interpretations?.scaled, PLAY_SCHOOL_SCALED_SCORE_INTERPRETATIONS),
        standard: normalizePlaySchoolInterpretations(data.play_school_interpretations?.standard, PLAY_SCHOOL_STANDARD_SCORE_INTERPRETATIONS)
    };

    const usesEccdChecklist = true;
    if (usesEccdChecklist && !getReportQuarterNumbers().includes(currentQuarter)) {
        currentQuarter = 1;
    }

    const periodLabels = getReportQuarterLabels(!usesEccdChecklist);

    modal.querySelector('.modal-title').textContent = `${section.section_name || 'Section'} Report Cards`;
    modal.querySelector('.modal-body').innerHTML = `
        <div class="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
            <div>
                <div class="fw-bold">${escapeHtml(section.program_name || 'Pre-school / Play-school')}</div>
                <div class="text-muted small">
                    ${escapeHtml(section.teacher_name || 'No teacher assigned')}
                    ${section.branch_name ? ` - ${escapeHtml(section.branch_name)}` : ''}
                </div>
            </div>
            <div class="btn-group" role="group" aria-label="Quarter selector">
                ${periodLabels.map((label, index) => `
                    <button type="button" class="btn btn-sm ${currentQuarter === index + 1 ? 'btn-danger' : 'btn-outline-danger'} report-quarter-btn" data-quarter="${index + 1}">
                        ${label}
                    </button>
                `).join('')}
            </div>
        </div>

        <div class="table-responsive">
            <table class="table table-sm table-bordered align-middle">
                <thead class="table-light">
                    <tr>
                        <th>Student</th>
                        <th>Program</th>
                        <th>School Year</th>
                        <th class="text-center">Attendance</th>
                        <th>Teacher Feedback</th>
                        <th class="text-center" style="width:110px;">Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${students.length ? students.map(student => createStudentRow(student)).join('') : `
                        <tr><td colspan="6" class="text-center text-muted">No enrolled students in this section.</td></tr>
                    `}
                </tbody>
            </table>
        </div>

        <div class="mt-3">
            <div class="fw-bold small mb-2">Learning Areas</div>
            <div class="d-flex flex-wrap gap-2">
                ${currentLearningAreas.map(area => `<span class="badge bg-light text-dark border">${escapeHtml(area.label)}</span>`).join('')}
            </div>
        </div>
    `;

    modal.querySelectorAll('.report-quarter-btn').forEach(button => {
        button.addEventListener('click', () => {
            currentQuarter = Number(button.dataset.quarter);
            renderReportCardModal(data);
        });
    });

    modal.querySelectorAll('.edit-report-card-btn').forEach(button => {
        button.addEventListener('click', () => {
            const enrollmentId = Number(button.dataset.enrollmentId);
            const student = students.find(item => Number(item.enrollment_details_id) === enrollmentId);
            if (student) {
                setCurrentSchoolYearContext(student.report_card?.school_year || data.school_year);
                currentLearningAreas = normalizeLearningAreas(student.report_card?.learning_areas || data.learning_areas);
                openQuarterEditor(student);
            }
        });
    });
}

function renderOwnerGradebookModal(modal, section, students, data) {
    const dialog = modal.querySelector('.modal-dialog');
    if (dialog) {
        dialog.className = 'modal-dialog modal-xl modal-dialog-scrollable preschool-gradebook-dialog';
    }

    modal.querySelector('.modal-title').textContent = `${section.section_name || 'Section'} Grading`;
    const visibleStudents = students.slice(0, 8);
    const visibleCount = visibleStudents.length;
    const totalStudents = students.length;
    const totalPages = Math.max(1, Math.ceil(totalStudents / 8));
    const hasWeightedAreas = currentLearningAreas.some(area => getAreaWeight(area) > 0);

    modal.querySelector('.modal-body').innerHTML = `
        ${createOwnerGradebookStyles()}
        <div class="gradebook-shell">
            <div class="gradebook-toolbar">
                <div>
                    <div class="gradebook-count">Showing 1 to ${visibleCount} of ${totalStudents} students</div>
                    <div class="text-muted small">${escapeHtml(section.program_name || 'Pre-school')} ${section.branch_name ? `- ${escapeHtml(section.branch_name)}` : ''}</div>
                </div>
                <div class="gradebook-actions">
                    <button type="button" class="btn btn-gradebook-primary" disabled>
                        <i class="bi bi-plus-lg"></i>
                        <span>Add Grade</span>
                    </button>
                    <button type="button" class="btn btn-gradebook-light" disabled>
                        <i class="bi bi-download"></i>
                        <span>Export</span>
                    </button>
                    <button type="button" class="btn btn-gradebook-primary" id="btnSaveGradebookScores">
                        <i class="bi bi-save"></i>
                        <span>Save</span>
                    </button>
                    <button type="button" class="btn btn-gradebook-icon" disabled>
                        <i class="bi bi-three-dots-vertical"></i>
                    </button>
                </div>
            </div>

            <div class="gradebook-quarter-row">
                <div class="btn-group" role="group" aria-label="Quarter selector">
                    ${getReportQuarterLabels(true).map((label, index) => `
                        <button type="button" class="btn btn-sm ${currentQuarter === index + 1 ? 'btn-danger' : 'btn-outline-danger'} report-quarter-btn" data-quarter="${index + 1}">
                            ${label}
                        </button>
                    `).join('')}
                </div>
                <div class="gradebook-weight-note">${hasWeightedAreas ? `Weights: ${formatScore(getTotalActiveWeight(currentLearningAreas))}% total` : 'No weights configured yet'}</div>
            </div>

            <div class="gradebook-table-wrap">
                <table class="gradebook-table">
                    <thead>
                        <tr>
                            <th class="select-col"><input class="form-check-input" type="checkbox" disabled></th>
                            <th class="student-col">Student Name</th>
                            ${currentLearningAreas.map(area => `
                                <th class="score-col">
                                    <div>${escapeHtml(area.label)}</div>
                                    <span>(${formatScore(getAreaWeight(area))}%)</span>
                                </th>
                            `).join('')}
                            <th class="score-col">
                                <div>Average</div>
                                <span>(100%)</span>
                            </th>
                            <th class="remarks-col">Remarks</th>
                            <th class="status-col">Status</th>
                            <th class="actions-col">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${visibleStudents.length ? visibleStudents.map((student, index) => createOwnerGradebookRow(student, index)).join('') : `
                            <tr><td colspan="${currentLearningAreas.length + 6}" class="text-center text-muted py-4">No enrolled students in this section.</td></tr>
                        `}
                    </tbody>
                </table>
            </div>

            <div class="gradebook-footer">
                <nav aria-label="Gradebook pages">
                    <ul class="pagination pagination-sm mb-0">
                        <li class="page-item disabled"><span class="page-link"><i class="bi bi-chevron-left"></i></span></li>
                        ${Array.from({ length: Math.min(totalPages, 4) }).map((_, index) => `
                            <li class="page-item ${index === 0 ? 'active' : ''}"><span class="page-link">${index + 1}</span></li>
                        `).join('')}
                        <li class="page-item ${totalPages <= 1 ? 'disabled' : ''}"><span class="page-link"><i class="bi bi-chevron-right"></i></span></li>
                    </ul>
                </nav>
                <div class="gradebook-rows-control">
                    <span>Rows per page:</span>
                    <select class="form-select form-select-sm" disabled>
                        <option selected>10</option>
                    </select>
                </div>
            </div>
        </div>
    `;

    modal.querySelectorAll('.report-quarter-btn').forEach(button => {
        button.addEventListener('click', () => {
            currentQuarter = Number(button.dataset.quarter);
            renderOwnerGradebookModal(modal, section, students, data);
        });
    });

    modal.querySelectorAll('.gradebook-score-input').forEach(input => {
        input.addEventListener('input', () => updateGradebookRow(input.closest('tr')));
        input.addEventListener('change', () => updateGradebookRow(input.closest('tr')));
    });

    modal.querySelector('#btnSaveGradebookScores')?.addEventListener('click', () => {
        saveGradebookScores(section.section_id);
    });

    modal.querySelectorAll('.gradebook-action-toggle').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            const wrapper = button.closest('.gradebook-action-menu-wrap');
            const menu = wrapper?.querySelector('.gradebook-action-menu');
            const shouldOpen = !menu?.classList.contains('show');
            closeGradebookActionMenus(modal);
            if (menu && shouldOpen) {
                menu.classList.add('show');
                button.setAttribute('aria-expanded', 'true');
            }
        });
    });

    modal.querySelectorAll('.download-report-card-btn').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            closeGradebookActionMenus(modal);
            const enrollmentId = Number(button.dataset.enrollmentId);
            const student = students.find(item => Number(item.enrollment_details_id) === enrollmentId);
            if (student) downloadSectionReportCard(student);
        });
    });

    modal.addEventListener('click', event => {
        if (!event.target.closest('.gradebook-action-menu-wrap')) {
            closeGradebookActionMenus(modal);
        }
    });
}

function closeGradebookActionMenus(root = document) {
    root.querySelectorAll('.gradebook-action-menu.show').forEach(menu => {
        menu.classList.remove('show');
        menu.closest('.gradebook-action-menu-wrap')?.querySelector('.gradebook-action-toggle')?.setAttribute('aria-expanded', 'false');
    });
}

function createOwnerGradebookRow(student, index) {
    const quarter = getStudentQuarter(student, currentQuarter);
    const scoreCells = currentLearningAreas.map(area => getGradebookScoreCell(quarter, area));
    const average = calculateGradebookAverage(scoreCells);
    const isIncomplete = !quarter || scoreCells.every(cell => cell.isMissing);
    const remark = isIncomplete ? 'F' : getTransmutedLetter(average);
    const status = getGradebookStatus(isIncomplete, average, remark);
    const avatar = createStudentAvatar(student, index);

    return `
        <tr data-enrollment-id="${student.enrollment_details_id}">
            <td class="select-col"><input class="form-check-input" type="checkbox" disabled></td>
            <td class="student-col">
                <div class="gradebook-student">
                    ${avatar}
                    <span>${escapeHtml(student.student_name || 'Student')}</span>
                </div>
            </td>
            ${scoreCells.map(cell => `
                <td class="score-cell">
                    <input
                        type="number"
                        min="0"
                        max="${escapeHtml(cell.perfectScore)}"
                        step="0.01"
                        class="gradebook-score-input"
                        value="${escapeHtml(cell.inputValue)}"
                        data-area-id="${escapeHtml(cell.areaId)}"
                        data-perfect-score="${escapeHtml(cell.perfectScore)}"
                        data-weight="${escapeHtml(cell.weight)}"
                    >
                </td>
            `).join('')}
            <td class="average-cell ${getAverageClass(average, isIncomplete)}">${isIncomplete ? '-' : formatScore(average)}</td>
            <td class="remarks-cell">${escapeHtml(remark)}</td>
            <td class="status-col"><span class="${getStatusClass(status)}">${escapeHtml(status)}</span></td>
            <td class="actions-col">
                <div class="gradebook-action-menu-wrap">
                    <button
                        type="button"
                        class="gradebook-action-blank gradebook-action-toggle"
                        title="Actions"
                        aria-label="Actions"
                        aria-haspopup="true"
                        aria-expanded="false"
                    >
                        <i class="bi bi-three-dots-vertical"></i>
                    </button>
                    <div class="gradebook-action-menu" role="menu">
                        <button
                            type="button"
                            class="gradebook-action-menu-item download-report-card-btn"
                            data-enrollment-id="${escapeHtml(student.enrollment_details_id)}"
                            role="menuitem"
                        >
                            <i class="bi bi-download"></i>
                            <span>Download</span>
                        </button>
                    </div>
                </div>
            </td>
        </tr>
    `;
}

function createOwnerGradebookStyles() {
    return `
        <style>
            #sectionReportCardsModal .modal-content {
                border: 0;
                border-radius: 12px;
                overflow: hidden;
                background: #fff;
            }
            #sectionReportCardsModal .modal-header {
                border-bottom: 1px solid #f2d8df;
                background: #fff;
            }
            .gradebook-shell {
                color: #162033;
                font-size: 13px;
            }
            .gradebook-toolbar,
            .gradebook-footer,
            .gradebook-quarter-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 14px;
                flex-wrap: wrap;
            }
            .gradebook-toolbar {
                margin-bottom: 14px;
            }
            .gradebook-count {
                font-weight: 700;
                color: #1f2937;
            }
            .gradebook-actions {
                display: flex;
                align-items: center;
                gap: 12px;
                flex-wrap: wrap;
            }
            .btn-gradebook-primary,
            .btn-gradebook-light,
            .btn-gradebook-icon {
                min-height: 38px;
                border-radius: 8px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                font-size: 13px;
                font-weight: 700;
                border: 1px solid #edf0f5;
                box-shadow: 0 3px 10px rgba(15, 23, 42, .04);
                opacity: 1;
            }
            .btn-gradebook-primary {
                background: #ea9aa6;
                color: #fff;
                border-color: #ea9aa6;
                min-width: 116px;
            }
            .btn-gradebook-light,
            .btn-gradebook-icon {
                background: #fff;
                color: #101827;
            }
            .btn-gradebook-light {
                min-width: 116px;
            }
            .btn-gradebook-icon {
                width: 44px;
            }
            .gradebook-quarter-row {
                margin-bottom: 12px;
            }
            .gradebook-weight-note {
                color: #64748b;
                font-size: 12px;
                font-weight: 600;
            }
            .gradebook-table-wrap {
                border: 1px solid #edf0f5;
                border-radius: 8px;
                overflow: auto;
                background: #fff;
            }
            .gradebook-table {
                width: 100%;
                min-width: 980px;
                border-collapse: separate;
                border-spacing: 0;
                margin: 0;
            }
            .gradebook-table th,
            .gradebook-table td {
                padding: 12px 14px;
                border-bottom: 1px solid #edf0f5;
                vertical-align: middle;
                white-space: nowrap;
            }
            .gradebook-table thead th {
                background: #fff0f5;
                color: #172033;
                font-size: 12px;
                font-weight: 800;
            }
            .gradebook-table thead th span {
                display: block;
                margin-top: 3px;
                color: #25324a;
                font-size: 11px;
                font-weight: 700;
            }
            .gradebook-table tbody tr:last-child td {
                border-bottom: 0;
            }
            .select-col {
                width: 42px;
                text-align: center;
            }
            .student-col {
                min-width: 220px;
            }
            .score-col,
            .score-cell,
            .average-cell,
            .remarks-cell,
            .status-col,
            .actions-col {
                text-align: center;
            }
            .score-cell,
            .remarks-cell {
                font-weight: 700;
                color: #263248;
            }
            .gradebook-score-input {
                width: 66px;
                height: 32px;
                border: 1px solid transparent;
                border-radius: 7px;
                text-align: center;
                font-weight: 800;
                color: #263248;
                background: #fff;
                outline: none;
            }
            .gradebook-score-input:focus {
                border-color: #ea9aa6;
                box-shadow: 0 0 0 3px rgba(247, 45, 131, .12);
            }
            .gradebook-score-input.is-invalid {
                border-color: #ef4444;
                background: #fff5f5;
            }
            .gradebook-student {
                display: flex;
                align-items: center;
                gap: 10px;
                font-weight: 800;
                color: #1e293b;
            }
            .gradebook-avatar {
                width: 26px;
                height: 26px;
                border-radius: 50%;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                color: #fff;
                font-size: 11px;
                font-weight: 800;
                flex: 0 0 auto;
            }
            .average-cell {
                font-weight: 900;
            }
            .avg-good {
                color: #00b83f;
            }
            .avg-warn {
                color: #ff8a00;
            }
            .avg-risk {
                color: #ff1f1f;
            }
            .avg-empty {
                color: #64748b;
            }
            .status-pill {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 78px;
                min-height: 24px;
                padding: 3px 10px;
                border-radius: 8px;
                font-size: 12px;
                font-weight: 800;
            }
            .status-passed {
                background: #ddf7df;
                color: #16a31f;
            }
            .status-review {
                background: #fff0d8;
                color: #ff8a00;
            }
            .status-incomplete {
                background: #eef1f6;
                color: #475569;
            }
            .gradebook-action-blank {
                border: 0;
                background: transparent;
                color: #111827;
                padding: 4px 8px;
                opacity: 1;
                cursor: pointer;
                border-radius: 6px;
            }
            .gradebook-action-blank:hover,
            .gradebook-action-blank:focus {
                background: #f8e8ef;
                color: #ea9aa6;
            }
            .gradebook-action-menu-wrap {
                position: relative;
                display: inline-flex;
                justify-content: center;
            }
            .gradebook-action-menu {
                display: none;
                position: absolute;
                top: calc(100% + 6px);
                right: 0;
                min-width: 142px;
                padding: 6px;
                border: 1px solid #edf0f5;
                border-radius: 8px;
                background: #fff;
                box-shadow: 0 14px 30px rgba(15, 23, 42, .12);
                z-index: 20;
            }
            .gradebook-action-menu.show {
                display: block;
            }
            .gradebook-action-menu-item {
                width: 100%;
                border: 0;
                border-radius: 6px;
                background: transparent;
                color: #1f2937;
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 10px;
                font-size: 12px;
                font-weight: 800;
                text-align: left;
            }
            .gradebook-action-menu-item:hover,
            .gradebook-action-menu-item:focus {
                background: #f8e8ef;
                color: #ea9aa6;
            }
            .gradebook-footer {
                margin-top: 16px;
            }
            .gradebook-footer .page-link {
                border: 1px solid #edf0f5;
                border-radius: 8px;
                margin-right: 8px;
                color: #25324a;
                font-weight: 700;
                min-width: 36px;
                min-height: 36px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            .gradebook-footer .page-item.active .page-link {
                background: #ea9aa6;
                border-color: #ea9aa6;
                color: #fff;
            }
            .gradebook-rows-control {
                display: flex;
                align-items: center;
                gap: 10px;
                color: #25324a;
                font-weight: 600;
            }
            .gradebook-rows-control .form-select {
                width: 72px;
                border-radius: 8px;
            }
            @media (max-width: 768px) {
                .gradebook-actions {
                    width: 100%;
                }
                .btn-gradebook-primary,
                .btn-gradebook-light {
                    flex: 1 1 120px;
                }
            }
        </style>
    `;
}

function createStudentRow(student) {
    const quarter = getStudentQuarter(student, currentQuarter);
    const usesEccdChecklist = true;
    const attendance = quarter && quarter.attendance !== null
        ? `${quarter.attendance}${quarter.total_school_days !== null ? ` / ${quarter.total_school_days}` : ''}`
        : '-';
    const remarks = quarter ? getQuarterDisplayRemarks(quarter) : '';

    return `
        <tr>
            <td>
                <div class="fw-semibold">${escapeHtml(student.student_name || 'Student')}</div>
                <div class="text-muted small">${escapeHtml(student.status || '')}</div>
            </td>
            <td>${escapeHtml(student.program_name || 'N/A')}</td>
            <td>${escapeHtml(student.school_year || 'N/A')}</td>
            <td class="text-center">${escapeHtml(attendance)}</td>
            <td class="small">${quarter ? escapeHtml(remarks || '-') : '<span class="text-muted">No feedback yet</span>'}</td>
            <td class="text-center">
                <button type="button" class="btn btn-sm btn-outline-primary edit-report-card-btn" data-enrollment-id="${student.enrollment_details_id}">
                    ${usesEccdChecklist ? 'Open ECCD' : 'Edit Report Card'}
                </button>
            </td>
        </tr>
    `;
}

function openQuarterEditor(student) {
    const quarter = getStudentQuarter(student, currentQuarter);
    const gradeMap = new Map((quarter?.grades || []).map(item => [String(item.area_id || item.label), item.grade]));
    const parentModal = document.getElementById('sectionReportCardsModal');
    const usesEccdChecklist = true;

    if (parentModal && reportCardRenderMode !== 'page') {
        const parentInstance = bootstrap.Modal.getInstance(parentModal);
        if (parentInstance) parentInstance.hide();
    }

    if (usesEccdChecklist) {
        openPlaySchoolEccdEditor(student, parentModal);
        return;
    }

    const fields = currentLearningAreas.map((area, index) => `
        <div class="row g-2 align-items-center mb-2">
            <div class="col-7">
                <label class="form-label small fw-semibold mb-0" for="preplay-grade-${index}">${escapeHtml(area.label)}</label>
            </div>
            <div class="col-5">
                <select class="form-select form-select-sm preplay-grade-input" id="preplay-grade-${index}" data-area-id="${area.area_id}">
                    ${gradeOptions.map(grade => `<option value="${grade}" ${gradeMap.get(String(area.area_id)) === grade || gradeMap.get(area.label) === grade ? 'selected' : ''}>${grade}</option>`).join('')}
                </select>
            </div>
        </div>
    `).join('');

    Swal.fire({
        title: `${getReportQuarterLabel(currentQuarter, true)} Report Card`,
        html: `
            <div class="text-start">
                <div class="p-3 mb-3 rounded-3" style="background:#f8fafc; border:1px solid #e2e8f0;">
                    <div class="fw-bold">${escapeHtml(student.student_name || 'Student')}</div>
                    <div class="text-muted small">${escapeHtml(student.program_name || 'Pre-school / Play-school')}</div>
                </div>

                ${fields}

                <div class="row g-2 mt-3">
                    <div class="col-md-6">
                        <label class="form-label small fw-semibold" for="preplay-attendance">Attendance</label>
                        <input type="number" min="0" class="form-control form-control-sm" id="preplay-attendance" value="${quarter?.attendance ?? ''}">
                    </div>
                    <div class="col-md-6">
                        <label class="form-label small fw-semibold" for="preplay-total-days">Total School Days</label>
                        <input type="number" min="0" class="form-control form-control-sm" id="preplay-total-days" value="${quarter?.total_school_days ?? ''}">
                    </div>
                </div>

                <div class="mt-3">
                    <label class="form-label small fw-semibold" for="preplay-feedback">Teacher Feedback</label>
                    <textarea class="form-control" id="preplay-feedback" rows="4">${escapeHtml(quarter?.remarks || '')}</textarea>
                </div>
            </div>
        `,
        width: 680,
        showCancelButton: true,
        confirmButtonText: 'Save Quarter',
        confirmButtonColor: '#2563eb',
        focusConfirm: false,
        didOpen: () => {
            const firstInput = Swal.getPopup().querySelector('#preplay-attendance');
            if (firstInput) firstInput.focus();

            const actions = Swal.getActions();
            const confirmButton = Swal.getConfirmButton();
            if (actions && confirmButton) {
                const printButton = document.createElement('button');
                printButton.type = 'button';
                printButton.className = 'swal2-styled';
                printButton.style.backgroundColor = '#ea9aa6';
                printButton.textContent = 'Print Card';
                printButton.addEventListener('click', () => {
                    printReportCard(student, collectQuarterFormData());
                });
                actions.insertBefore(printButton, confirmButton);
            }
        },
        preConfirm: () => {
            return collectQuarterFormData();
        }
    }).then(async result => {
        if (!result.isConfirmed) {
            if (parentModal && reportCardRenderMode !== 'page') {
                bootstrap.Modal.getOrCreateInstance(parentModal).show();
            }
            return;
        }

        await saveQuarter(student.enrollment_details_id, result.value);
    });
}

function openPlaySchoolEccdEditor(student, parentModal, { reloadReportCards = true } = {}) {
    const evaluationNumbers = getReportQuarterNumbers();
    const lastEvaluation = evaluationNumbers[evaluationNumbers.length - 1] || 1;
    const evaluations = evaluationNumbers.map(evaluation => {
        const quarter = getStudentQuarter(student, evaluation);
        const remarks = decodeQuarterRemarks(quarter);
        const meta = remarks.play_eccd || {};
        const ageDetails = getPlaySchoolStudentAgeDetails(student, meta.evaluation_date || '', meta.age_key || '');

        return {
            evaluation,
            quarter,
            date: meta.evaluation_date || '',
            age_key: ageDetails.age_key,
            age_text: ageDetails.age_text,
            age_group_label: ageDetails.age_group_label,
            suggested_age_key: ageDetails.suggested_age_key,
            age_warning: ageDetails.warning,
            age_is_computed: ageDetails.is_computed,
            comments: remarks.comments
        };
    });
    const checklistGroups = getPlaySchoolChecklistGroups();

    Swal.fire({
        title: 'ECCD Child\'s Record 2',
        html: createPlaySchoolEccdEditorHtml(student, evaluations, checklistGroups),
        width: 1180,
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: 'Save Record',
        denyButtonText: '<i class="bi bi-file-earmark-pdf me-1"></i>Download PDF',
        cancelButtonText: 'Close',
        confirmButtonColor: '#ea9aa6',
        focusConfirm: false,
        customClass: {
            popup: 'play-eccd-swal'
        },
        didOpen: () => {
            const popup = Swal.getPopup();
            if (!popup) return;

            popup.querySelectorAll('.play-eccd-check').forEach(input => {
                input.addEventListener('change', () => updatePlaySchoolEccdTable(popup));
            });

            popup.querySelectorAll('.play-eccd-date-input').forEach(input => {
                input.addEventListener('change', () => {
                    input.classList.remove('is-invalid');
                    if (Number(input.dataset.evaluation) === lastEvaluation) {
                        updatePlaySchoolFinalAgeField(popup, student, input.value);
                    }
                    updatePlaySchoolEccdTable(popup);
                });
            });

            popup.querySelectorAll('.play-eccd-final-age-select').forEach(input => {
                input.addEventListener('change', () => {
                    const finalAgeHeader = popup.querySelector('[data-play-final-age-key]');
                    if (finalAgeHeader) finalAgeHeader.dataset.playFinalAgeKey = input.value;
                    updatePlaySchoolEccdTable(popup);
                });
            });

            popup.querySelectorAll('.play-eccd-eval-tab').forEach(button => {
                button.addEventListener('click', () => switchPlaySchoolChecklistPanel(popup, Number(button.dataset.evaluation)));
            });

            updatePlaySchoolEccdTable(popup);
            switchPlaySchoolChecklistPanel(popup, 1);
        },
        preDeny: async () => {
            const popup = Swal.getPopup();
            if (!popup) return false;
            try {
                await downloadPlaySchoolEccdCardPdf(popup, student);
            } catch (error) {
                console.error('Error downloading ECCD card:', error);
                Swal.showValidationMessage(error.message || 'Unable to download the ECCD card.');
            } finally {
                Swal.hideLoading();
            }
            return false;
        },
        preConfirm: () => {
            const popup = Swal.getPopup();
            const missingDate = validatePlaySchoolEccdDates(popup);
            if (missingDate) {
                Swal.showValidationMessage(`Please enter the ${toOrdinal(missingDate.evaluation)} quarter assessment date.`);
                missingDate.focus();
                return false;
            }

            return collectPlaySchoolEccdFormData(popup);
        }
    }).then(async result => {
        if (!result.isConfirmed) {
            if (parentModal && reportCardRenderMode !== 'page') {
                bootstrap.Modal.getOrCreateInstance(parentModal).show();
            }
            return;
        }

        await savePlaySchoolEccdReport(student.enrollment_details_id, result.value, { reloadReportCards });
    });
}

async function downloadPlaySchoolEccdCardPdf(popup, student) {
    if (!popup.querySelector('.play-eccd-editor')) throw new Error('The ECCD card is not available.');

    Swal.showLoading();
    await ensureReportCardPdfLibraries();
    const evaluations = collectPlaySchoolEccdFormData(popup);
    const selectedEvaluation = Number(popup.querySelector('.play-eccd-eval-tab.active')?.dataset.evaluation || 1);
    const previousQuarter = currentQuarter;
    currentQuarter = selectedEvaluation;
    const quarters = createEccdPrintableQuarters(student, evaluations);
    const finalQuarter = getReportFinalQuarter();
    const lastEvaluation = getReportQuarterNumbers().at(-1) || 1;
    const selectedData = evaluations.find(item => item.quarter === (selectedEvaluation === finalQuarter ? lastEvaluation : selectedEvaluation)) || evaluations[0];
    const logoUrl = new URL('../../assist/logo.png', import.meta.url).href;
    const summaryCard = cloneEccdNodeWithFormValues(popup.querySelector('.play-eccd-table-wrap'));
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:11in;height:8.5in;background:#fff;pointer-events:none;z-index:-1;';
    host.innerHTML = createCombinedEccdDownloadHtml(student, quarters, selectedData, logoUrl, summaryCard?.outerHTML || '');
    document.body.appendChild(host);

    try {
        await waitForReportCardImages(host);
        const sheet = host.querySelector('.student-eccd-sheet');
        const canvas = await window.html2canvas(sheet, {
            scale: 3,
            useCORS: true,
            backgroundColor: '#ffffff',
            width: sheet.offsetWidth,
            height: sheet.offsetHeight,
            windowWidth: sheet.scrollWidth,
            windowHeight: sheet.scrollHeight
        });
        const JsPdf = window.jspdf?.jsPDF || window.jsPDF;
        if (!JsPdf) throw new Error('PDF generator is not available.');

        const pdf = new JsPdf({ orientation: 'landscape', unit: 'in', format: 'letter', compress: true });
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.98), 'JPEG', 0, 0, 11, 8.5);
        const studentSlug = String(student.student_name || 'student').trim().replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'student';
        pdf.save(`${studentSlug}_eccd_child_record_2.pdf`);
    } finally {
        host.remove();
        currentQuarter = previousQuarter;
    }
}

function normalizePrintableGroupTitle(title) {
    return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function splitPrintableGroup(group, keepCount = 10) {
    const items = Array.isArray(group?.items) ? group.items : [];
    if (items.length <= keepCount) return { primary: group, overflow: null };

    return {
        primary: { ...group, items: items.slice(0, keepCount) },
        overflow: { ...group, items: items.slice(keepCount) }
    };
}

function createCombinedEccdDownloadHtml(student, quarters, selectedData, logoUrl, summaryCardHtml) {
    const current = quarters[String(currentQuarter)] || {};
    const groups = createPlaySchoolPrintableGroups(current, { onlyItemsIntroducedThisQuarter: currentQuarter <= getReportQuarterNumbers().length });
    const { firstPageColumns, remainingGroups } = createDynamicEccdDownloadLayout(groups);
    const comments = decodeQuarterRemarks(current)?.comments || '';
    const teacher = currentSectionDetails.teacher_name || currentSectionDetails.instructor_name || '';
    const ageKey = decodeQuarterRemarks(current)?.play_eccd?.age_key || '';
    const ageLabel = getPlaySchoolAgeGroupByKey(ageKey)?.age_label || '';

    return createStudentEnrollmentEccdDownloadHtml({
        student,
        firstPageColumns,
        remainingGroups,
        selectedData,
        logoUrl,
        summaryCardHtml,
        comments,
        teacher,
        ageLabel,
        isFinal: currentQuarter === getReportFinalQuarter()
    });

    return `
        <style>
            .eccd-combined-sheet { width:11in; height:8.5in; overflow:hidden; padding:.18in .22in; background:#fff; color:#555; font-family:Arial,Helvetica,sans-serif; box-sizing:border-box; }
            .eccd-combined-sheet * { box-sizing:border-box; }
            .eccd-combined-head { display:grid; grid-template-columns:.48in 1.45in 1fr; gap:.12in; align-items:start; height:1.28in; }
            .eccd-combined-logo { width:.42in; height:.42in; object-fit:contain; }
            .eccd-combined-title { margin:0; font-size:16px; line-height:1.02; font-weight:900; text-transform:uppercase; }
            .eccd-combined-info { margin-top:.25in; font-size:7px; line-height:1.25; }
            .eccd-combined-line { display:inline-block; min-width:1.45in; border-bottom:1px solid #888; }
            .eccd-combined-top { display:grid; grid-template-columns: 1.58fr .7fr .85fr; gap:.16in; align-items:start; }
            .eccd-combined-summary { border:2px solid #07145f; overflow:hidden; transform-origin:top left; }
            .eccd-combined-summary .play-eccd-table-wrap { border:0 !important; overflow:visible !important; }
            .eccd-combined-summary .play-eccd-table { min-width:0 !important; width:100% !important; border-collapse:collapse; }
            .eccd-combined-summary .play-eccd-table th, .eccd-combined-summary .play-eccd-table td { border:1px solid #07145f !important; padding:2px 1px !important; font-size:6px !important; line-height:1.05 !important; min-height:0 !important; height:15px !important; }
            .eccd-combined-summary .play-eccd-domain-cell { font-size:7px !important; }
            .eccd-combined-summary .play-eccd-domain-cell small, .eccd-combined-summary small { font-size:4.5px !important; }
            .eccd-combined-summary .play-eccd-score-head { font-size:6px !important; }
            .eccd-combined-summary .play-eccd-score-head { background:#f80000; color:#fff; font-weight:800; }
            .eccd-combined-summary .play-eccd-age-head { color:#07145f; font-weight:800; }
            .eccd-combined-summary .play-eccd-summary-empty { background:#86a8bf; color:transparent; }
            .eccd-combined-summary .play-eccd-summary-label { color:#ed008c; font-weight:800; }
            .eccd-combined-summary .play-eccd-scaled-cell { background:#fff0d8; color:#b45309; }
            .eccd-combined-summary .play-eccd-raw-cell, .eccd-combined-summary .play-eccd-scaled-cell, .eccd-combined-summary .play-eccd-summary-value { font-size:7px !important; }
            .eccd-combined-summary .play-eccd-summary-label { font-size:7px !important; }
            .eccd-combined-summary .play-eccd-age-head { font-size:7px !important; }
            .eccd-combined-summary input, .eccd-combined-summary select { max-width:100%; height:14px; font-size:5px; padding:0; border:0; background:transparent; }
            .eccd-combined-side h2, .eccd-combined-progress h2 { margin:0 0 4px; font-size:11px; color:#555; }
            .eccd-combined-check { display:grid; grid-template-columns:9px 1fr; gap:3px; margin:1px 0; font-size:6px; line-height:1.06; }
            .eccd-combined-box { width:8px; height:8px; border:1px solid #999; position:relative; }
            .eccd-combined-box.checked::after { content:'✓'; position:absolute; left:0; top:-4px; font-size:11px; color:#555; }
            .eccd-combined-comments h2 { margin:0 0 4px; font-size:11px; color:#555; }
            .eccd-combined-comment-line { height:.31in; border-bottom:1px solid #999; font-size:6px; padding-top:2px; }
            .eccd-combined-signature { margin-top:.55in; font-size:11px; font-weight:800; color:#555; }
            .eccd-combined-signature span { display:inline-block; min-width:.85in; border-bottom:1px solid #888; }
            .eccd-combined-domains { display:grid; grid-template-columns:repeat(3,1fr); gap:.08in .18in; margin-top:.12in; }
            .eccd-combined-domain h2 { margin:0 0 3px; color:#555; font-size:9px; line-height:1; }
        </style>
        <section class="eccd-combined-sheet">
            <div class="eccd-combined-head">
                <img class="eccd-combined-logo" src="${logoUrl}" alt="">
                <div><h1 class="eccd-combined-title">ECCD Child's Record 2<br>Checklist</h1><div class="eccd-combined-info">Child Name: <span class="eccd-combined-line">${escapeHtml(student.student_name || '')}</span><br>Age: <span class="eccd-combined-line"></span><br>Observation Period: <span class="eccd-combined-line">${escapeHtml(currentQuarter === getReportFinalQuarter() ? 'Final' : getReportQuarterLabel(currentQuarter))}</span><br>Teacher: <span class="eccd-combined-line">${escapeHtml(teacher)}</span></div></div>
            </div>
            <div class="eccd-combined-top">
                <div class="eccd-combined-summary">${summaryCardHtml}</div>
                <div class="eccd-combined-side">${socialGroup ? createCompactEccdGroup(socialGroup) : ''}<div class="eccd-combined-progress"><h2>Overall Progress</h2>${['Very Good', 'Good', 'Developing'].map(label => `<div class="eccd-combined-check"><span class="eccd-combined-box ${getPlaySchoolProgressLabel(selectedData?.overall_grade) === label ? 'checked' : ''}"></span><span>${label}</span></div>`).join('')}</div></div>
                <div class="eccd-combined-comments"><h2>Teacher's Comments:</h2>${createCompactCommentLines(comments, 5)}<div class="eccd-combined-signature">Teacher's Signature: <span></span></div><div class="eccd-combined-signature">Date: <span></span></div></div>
            </div>
            <div class="eccd-combined-domains">${remainingGroups.map(createCompactEccdGroup).join('')}</div>
        </section>
    `;
}

// The checklist changes per quarter, so avoid reserving a fixed row for every
// domain.  This keeps short domains from leaving a large blank area beside a
// longer one, while retaining enough room below the score table on page one.
function createDynamicEccdDownloadLayout(groups, maximumFirstPageUnits = 24) {
    const printableGroups = (Array.isArray(groups) ? groups : [])
        .filter(group => Array.isArray(group?.items) && group.items.length)
        // Keep every domain together. Splitting a long domain caused a second
        // heading (for example, a duplicate "Self-Help") in the PDF.
        .map(group => ({ ...group, items: [...group.items] }));
    const firstPageColumns = [[], []];
    const columnUnits = [0, 0];
    const remainingGroups = [];

    printableGroups.forEach(group => {
        // A title takes approximately the same vertical room as one checklist item.
        const groupUnits = group.items.length + 1.25;
        const orderedColumns = [0, 1].sort((left, right) => columnUnits[left] - columnUnits[right]);
        const destination = orderedColumns.find(index => columnUnits[index] + groupUnits <= maximumFirstPageUnits);

        if (destination === undefined) {
            remainingGroups.push(group);
            return;
        }

        firstPageColumns[destination].push(group);
        columnUnits[destination] += groupUnits;
    });

    return { firstPageColumns, remainingGroups };
}

function distributeEccdGroupsAcrossColumns(groups) {
    const columns = [[], []];
    const columnUnits = [0, 0];

    (Array.isArray(groups) ? groups : [])
        .filter(group => Array.isArray(group?.items) && group.items.length)
        .forEach(group => {
            const destination = columnUnits[0] <= columnUnits[1] ? 0 : 1;
            columns[destination].push(group);
            columnUnits[destination] += group.items.length + 1.25;
        });

    return columns;
}

// Matches the two-panel ECCD report-card layout students receive from Enrollment.
function createStudentEnrollmentEccdDownloadHtml({ student, firstPageColumns, remainingGroups, selectedData, logoUrl, summaryCardHtml, comments, teacher, ageLabel, isFinal = false }) {
    const progress = getPlaySchoolProgressLabel(selectedData?.overall_grade);
    const printableFirstPageColumns = Array.isArray(firstPageColumns) ? firstPageColumns : [[], []];
    const [secondPageLeftGroups, secondPageRightGroups] = distributeEccdGroupsAcrossColumns(remainingGroups);
    return `
        <style>
            /* Keep the score card compact after making its Domain column narrower. */
            .student-eccd-sheet .student-eccd-summary .play-eccd-table{table-layout:auto!important}
            .student-eccd-sheet .student-eccd-summary .play-eccd-table th,.student-eccd-sheet .student-eccd-summary .play-eccd-table td{overflow-wrap:normal!important}
            .student-eccd-sheet .student-eccd-summary .play-eccd-domain-head,.student-eccd-sheet .student-eccd-summary .play-eccd-domain-cell{width:28%!important;max-width:28%!important}
            .student-eccd-sheet .student-eccd-summary .play-eccd-domain-head{font-size:12px!important;line-height:1!important;padding:1px!important;white-space:nowrap}
            .student-eccd-sheet .student-eccd-summary .play-eccd-domain-cell{font-size:6px!important;line-height:1!important}
            .student-eccd-sheet .student-eccd-summary .play-eccd-age-head{padding:1px!important;font-size:6px!important;line-height:1!important;white-space:nowrap}
            .student-eccd-sheet .student-eccd-summary .play-eccd-eval-head{padding:1px!important;vertical-align:top!important}
            .student-eccd-sheet .student-eccd-summary .play-eccd-eval-title{margin:0!important;font-size:9px!important;line-height:1!important;white-space:nowrap}
            .student-eccd-sheet .student-eccd-summary .play-eccd-eval-head label{display:block!important;margin:1px 0 0!important;font-size:5px!important;line-height:1!important;white-space:nowrap}
            .student-eccd-sheet .student-eccd-summary .play-eccd-eval-head input{display:inline-block!important;width:30px!important;min-width:0!important;height:9px!important;padding:0!important;font-size:4px!important;vertical-align:middle}
            .student-eccd-sheet .student-eccd-summary .play-eccd-final-age-label,.student-eccd-sheet .student-eccd-summary .play-eccd-final-age-readout,.student-eccd-sheet .student-eccd-summary .play-eccd-final-age-warning{display:none!important}
            /* Final contains more checklist entries, but it should not look cramped. */
            section.student-eccd-sheet.final-layout .student-eccd-group h2,section.student-eccd-sheet.final-layout .student-eccd-progress h2{margin:0 0 3px!important;font-size:11px!important;line-height:1.08!important}
            section.student-eccd-sheet.final-layout .student-eccd-check{grid-template-columns:10px 1fr!important;gap:3px!important;margin:.5px 0!important;font-size:7.8px!important;line-height:1.05!important}
            section.student-eccd-sheet.final-layout .student-eccd-box{width:9px!important;height:9px!important;margin-top:0!important}
            section.student-eccd-sheet.final-layout .student-eccd-box.checked:after{left:1px!important;top:-3px!important;width:4px!important;height:10px!important}
            section.student-eccd-sheet.final-layout .student-eccd-stack{gap:.09in!important}
            section.student-eccd-sheet.final-layout .student-eccd-page:first-child .student-eccd-stack{gap:.13in!important}
            .student-eccd-sheet{width:11in;height:8.5in;overflow:hidden;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;font-size:0}.student-eccd-sheet *{box-sizing:border-box}.student-eccd-page{display:inline-block;vertical-align:top;position:relative;width:5.5in;height:8.5in;overflow:hidden;padding:.25in .3in .38in;font-size:10px}.student-eccd-logo{position:absolute;left:.3in;top:.22in;width:.46in;height:.46in;object-fit:contain;opacity:.62}.student-eccd-title{text-align:center;text-transform:uppercase;font-size:16px;line-height:1.05;font-weight:800;margin:.03in 0 .18in}.student-eccd-info{width:3.1in;margin:0 0 .14in .52in;font-size:10px;line-height:1.15}.student-eccd-line{display:inline-block;min-width:1.36in;height:14px;padding:0 2px;vertical-align:bottom;border-bottom:1px solid #000}.student-eccd-grid{display:grid;grid-template-columns:1fr 1fr;gap:.14in .24in;align-items:start}.student-eccd-domains{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:.14in .24in;align-items:start}.student-eccd-group{min-width:0}.student-eccd-group h2,.student-eccd-progress h2{margin:0 0 2px;font-size:12px;line-height:1.05;font-weight:800}.student-eccd-check{display:grid;grid-template-columns:12px 1fr;gap:4px;align-items:start;margin:1px 0;font-size:8.2px;line-height:1.02}.student-eccd-box{width:10px;height:10px;margin-top:1px;border:1px solid #000;position:relative}.student-eccd-box.checked:after{content:"";position:absolute;left:2px;top:-3px;width:5px;height:11px;border-right:1px solid #000;border-bottom:1px solid #000;transform:rotate(42deg)}.student-eccd-summary{grid-column:1/-1;margin-bottom:0;border:1px solid #000;overflow:hidden}.student-eccd-summary .play-eccd-table-wrap{border:0!important;overflow:visible!important}.student-eccd-summary .play-eccd-table{min-width:0!important;width:100%!important;border-collapse:collapse;table-layout:fixed!important}.student-eccd-summary .play-eccd-table th,.student-eccd-summary .play-eccd-table td{border:1px solid #000!important;padding:2px 1px!important;font-size:6px!important;line-height:1.05!important;height:15px!important;overflow-wrap:anywhere}.student-eccd-summary .play-eccd-domain-head{width:21%!important;max-width:21%!important;font-size:15px!important;line-height:1!important;letter-spacing:-.2px}.student-eccd-summary .play-eccd-domain-cell{width:21%!important;max-width:21%!important;font-size:6.5px!important;line-height:1.05!important}.student-eccd-summary .play-eccd-domain-cell span{font-weight:800}.student-eccd-summary .play-eccd-domain-cell small,.student-eccd-summary small{font-size:4.5px!important}.student-eccd-summary input,.student-eccd-summary select{max-width:100%;height:14px;padding:0;border:0;background:transparent;font-size:5px}.student-eccd-back{display:grid;grid-template-columns:2.12in 1fr;gap:.22in;padding-top:.2in;align-items:start}.student-eccd-stack{display:grid;gap:.1in;align-content:start;min-width:0}.student-eccd-progress{margin-top:.26in}.student-eccd-comments-title,.student-eccd-signature{font-size:13px;font-weight:800;margin-bottom:.1in}.student-eccd-comment{height:.22in;border-bottom:1px solid #000;font-size:9px}.student-eccd-signature{margin-top:.45in}.student-eccd-sheet.final-layout .student-eccd-page{padding-bottom:.5in}.student-eccd-sheet.final-layout .student-eccd-group h2,.student-eccd-sheet.final-layout .student-eccd-progress h2{font-size:10.5px}.student-eccd-sheet.final-layout .student-eccd-check{grid-template-columns:10px 1fr;gap:3px;margin:0;font-size:7.2px;line-height:1}.student-eccd-sheet.final-layout .student-eccd-box{width:8px;height:8px;margin-top:0}.student-eccd-sheet.final-layout .student-eccd-box.checked:after{left:1px;top:-3px;width:4px;height:9px}.student-eccd-sheet.final-layout .student-eccd-stack{gap:.06in}.student-eccd-sheet.final-layout .student-eccd-comment{height:.19in;font-size:8px}
        </style>
        <section class="student-eccd-sheet ${isFinal ? 'final-layout' : ''}">
            <section class="student-eccd-page"><img class="student-eccd-logo" src="${logoUrl}" alt=""><div class="student-eccd-title">ECCD Child's Record 2<br>Checklist</div><div class="student-eccd-info">Child Name: <span class="student-eccd-line">${escapeHtml(student.student_name || '')}</span><br>Age: <span class="student-eccd-line">${escapeHtml(ageLabel)}</span><br>Observation Period: <span class="student-eccd-line">${escapeHtml(currentQuarter === getReportFinalQuarter() ? 'Final' : getReportQuarterLabel(currentQuarter))}</span><br>Teacher: <span class="student-eccd-line">${escapeHtml(teacher)}</span></div><div class="student-eccd-grid"><div class="student-eccd-summary">${summaryCardHtml}</div><div class="student-eccd-domains">${printableFirstPageColumns.map(column => `<div class="student-eccd-stack">${column.map(createStudentEccdGroup).join('')}</div>`).join('')}</div></div></section><section class="student-eccd-page"><div class="student-eccd-back"><div class="student-eccd-stack">${secondPageLeftGroups.map(createStudentEccdGroup).join('')}<div class="student-eccd-progress"><h2>Overall Progress</h2>${['Very Good','Good','Developing'].map(label => `<div class="student-eccd-check"><span class="student-eccd-box ${progress === label ? 'checked' : ''}"></span><span>${label}</span></div>`).join('')}</div></div><div><div class="student-eccd-stack">${secondPageRightGroups.map(createStudentEccdGroup).join('')}</div><div class="student-eccd-comments-title">Teacher's Comments:</div>${createStudentEccdCommentLines(comments, 3)}<div class="student-eccd-signature">Teacher's Signature: <span class="student-eccd-line" style="min-width:.95in;"></span></div><div class="student-eccd-signature" style="margin-top:.7in;">Date: <span class="student-eccd-line" style="min-width:.95in;"></span></div></div></div></section>
        </section>`;
}

function createStudentEccdGroup(group) {
    return `<section class="student-eccd-group"><h2>${escapeHtml(group.title)}</h2>${group.items.map(item => `<div class="student-eccd-check"><span class="student-eccd-box ${item.checked ? 'checked' : ''}"></span><span>${escapeHtml(item.label)}</span></div>`).join('')}</section>`;
}

function createStudentEccdCommentLines(comments, count) {
    const words = String(comments || '').trim().split(/\s+/).filter(Boolean);
    return Array.from({ length: count }, (_, index) => `<div class="student-eccd-comment">${escapeHtml(words.slice(index * 7, (index + 1) * 7).join(' '))}</div>`).join('');
}

function createCompactEccdGroup(group) {
    return `<section class="eccd-combined-domain"><h2>${escapeHtml(group.title)}</h2>${group.items.map(item => `<div class="eccd-combined-check"><span class="eccd-combined-box ${item.checked ? 'checked' : ''}"></span><span>${escapeHtml(item.label)}</span></div>`).join('')}</section>`;
}

function createCompactCommentLines(comments, count) {
    const lines = String(comments || '').split(/\r?\n/);
    return Array.from({ length: count }, (_, index) => `<div class="eccd-combined-comment-line">${escapeHtml(lines[index] || '')}</div>`).join('');
}

function cloneEccdNodeWithFormValues(node) {
    if (!node) return null;
    const clone = node.cloneNode(true);
    const originalFields = node.querySelectorAll('input, select, textarea');
    const clonedFields = clone.querySelectorAll('input, select, textarea');
    originalFields.forEach((field, index) => {
        const clonedField = clonedFields[index];
        if (!clonedField) return;
        if (field instanceof HTMLInputElement) {
            clonedField.setAttribute('value', field.value);
            if (field.checked) clonedField.setAttribute('checked', 'checked');
            else clonedField.removeAttribute('checked');
        } else if (field instanceof HTMLSelectElement) {
            Array.from(clonedField.options).forEach((option, optionIndex) => option.toggleAttribute('selected', field.options[optionIndex]?.selected));
        } else if (field instanceof HTMLTextAreaElement) {
            clonedField.textContent = field.value;
        }
    });
    return clone;
}

function addCanvasToBondPaper(pdf, canvas) {
    const pageWidth = 11;
    const pageHeight = 8.5;
    const ratio = canvas.width / canvas.height;
    let width = pageWidth;
    let height = width / ratio;
    if (height > pageHeight) {
        height = pageHeight;
        width = height * ratio;
    }
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.98), 'JPEG', (pageWidth - width) / 2, (pageHeight - height) / 2, width, height);
}

function createEccdPrintableQuarters(student, evaluations) {
    const quarters = {};
    const finalQuarter = getReportFinalQuarter();
    const evaluationNumbers = getReportQuarterNumbers();
    for (const quarter of [...evaluationNumbers, finalQuarter]) {
        const existing = getStudentQuarter(student, quarter);
        quarters[String(quarter)] = existing ? { ...existing, grades: [...(existing.grades || [])] } : { grades: [], overall_grade: '', attendance: '', total_school_days: '', remarks: '' };
    }

    evaluations.forEach(evaluation => {
        quarters[String(evaluation.quarter)] = {
            ...quarters[String(evaluation.quarter)],
            grades: evaluation.grades.map(grade => ({ area_id: grade.area_id, grade: grade.grade_value })),
            overall_grade: evaluation.overall_grade,
            attendance: evaluation.attendance,
            total_school_days: evaluation.total_school_days,
            remarks: evaluation.remarks,
            quarter: evaluation.quarter
        };
    });

    // The Final tab combines each item's score from the quarter where it was introduced.
    const lastEvaluation = evaluationNumbers.at(-1) || 1;
    const finalSource = quarters[String(lastEvaluation)] || {};
    quarters[String(finalQuarter)] = {
        ...finalSource,
        quarter: finalQuarter,
        grades: currentLearningAreas.map(area => {
            const introducedQuarter = getAreaIntroducedQuarter(area);
            return {
                area_id: area.area_id,
                label: area.label,
                grade: getPrintableGrade(quarters[String(introducedQuarter)], area)
            };
        })
    };
    return quarters;
}

function createPlaySchoolEccdEditorHtml(student, evaluations, checklistGroups) {
    const finalEvaluation = evaluations[evaluations.length - 1] || {};
    const finalQuarter = getReportFinalQuarter();

    return `
        ${createPlaySchoolEccdStyles()}
        <div class="play-eccd-editor text-start">
            <div class="play-eccd-student-bar">
                <div>
                    <div class="play-eccd-student-name">${escapeHtml(student.student_name || 'Student')}</div>
                    <div class="play-eccd-student-meta">
                        ${escapeHtml(student.program_name || 'Pre-school / Play School')}
                        ${student.school_year ? ` / ${escapeHtml(student.school_year)}` : ''}
                    </div>
                </div>
                <div class="play-eccd-note">Each item is scored only in its assigned quarter. Final scores are calculated from all ${evaluations.length} quarter raw scores.</div>
            </div>

            <div class="play-eccd-table-wrap">
                <table class="play-eccd-table">
                    <thead>
                        <tr>
                            <th class="play-eccd-domain-head" rowspan="3">Domain</th>
                            <th class="play-eccd-age-head" colspan="5" data-play-final-age-key="${escapeHtml(finalEvaluation.age_key || evaluations[0]?.age_key || '')}" data-play-final-age-header>Age: ${escapeHtml(finalEvaluation.age_text || 'Age unavailable')}</th>
                        </tr>
                        <tr>
                            ${evaluations.map(item => `
                                <th class="play-eccd-eval-head">
                                    <div class="play-eccd-eval-title">${escapeHtml(getReportQuarterLabel(item.evaluation))}</div>
                                    <label>
                                        <span>Date:</span>
                                        <input type="date" class="play-eccd-date-input" data-evaluation="${item.evaluation}" value="${escapeHtml(item.date)}">
                                    </label>
                                </th>`).join('')}
                            <th class="play-eccd-eval-head" colspan="2">
                                <div class="play-eccd-eval-title">Final</div>
                                ${createPlaySchoolFinalAgeField(finalEvaluation)}
                            </th>
                        </tr>
                        <tr>
                            ${evaluations.map(() => '<th class="play-eccd-score-head">Raw Score</th>').join('')}
                            <th class="play-eccd-score-head">Raw Score</th>
                            <th class="play-eccd-score-head">Scaled Score</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${checklistGroups.map(group => createPlaySchoolEccdDomainRow(group, evaluations)).join('')}
                        ${createPlaySchoolEccdFinalSummaryRows(evaluations)}
                    </tbody>
                </table>
            </div>

            <div class="play-eccd-checklist-editor">
                <div class="play-eccd-checklist-top">
                    <div>
                        <div class="play-eccd-section-title">Checklist Items</div>
                        <div class="play-eccd-note">Items are cumulative: each quarter includes items introduced in earlier quarters. Click an item to count it in the raw score.</div>
                    </div>
                    <div class="btn-group play-eccd-eval-tabs" role="group" aria-label="Quarter checklist selector">
                        ${evaluations.map(item => `
                            <button type="button" class="btn btn-sm btn-outline-danger play-eccd-eval-tab" data-evaluation="${item.evaluation}">
                                ${escapeHtml(getReportQuarterLabel(item.evaluation))}
                            </button>
                        `).join('')}
                        <button type="button" class="btn btn-sm btn-outline-danger play-eccd-eval-tab" data-evaluation="${finalQuarter}">Final</button>
                    </div>
                </div>

                ${evaluations.map(item => createPlaySchoolChecklistPanel(item, checklistGroups)).join('')}
                <div class="play-eccd-checklist-panel" data-play-checklist-panel="${finalQuarter}">
                    <div class="play-eccd-note">Final prints all checklist items from the configured ${evaluations.length} quarters.</div>
                </div>
            </div>
        </div>
    `;
}

function createPlaySchoolEccdDomainRow(group, evaluations) {
    const key = group.key;
    const itemCount = group.items.length || 0;

    return `
        <tr>
            <td class="play-eccd-domain-cell" data-play-domain-row="${escapeHtml(key)}">
                <span>${escapeHtml(group.label || playSchoolDomainLabels[key] || key)}</span>
                <small>${itemCount ? `${itemCount} item${itemCount === 1 ? '' : 's'}` : 'No checklist items'}</small>
            </td>
            ${evaluations.map(item => `<td class="play-eccd-raw-cell" data-play-raw="${item.evaluation}:${key}">-</td>`).join('')}
            <td class="play-eccd-raw-cell" data-play-final-raw="${key}">-</td>
            <td class="play-eccd-scaled-cell" data-play-final-scaled="${key}">-</td>
        </tr>
    `;
}

function createPlaySchoolEccdFinalSummaryRows(evaluations) {
    const quarterPlaceholders = evaluations.map(() => '<td class="play-eccd-summary-empty">-</td>').join('');
    return `
        <tr class="play-eccd-summary-row">
            <td class="play-eccd-summary-label">Sum of Scaled Scores</td>
            ${quarterPlaceholders}<td class="play-eccd-summary-empty">-</td>
            <td class="play-eccd-summary-value" data-play-final-summary="sum">-</td>
        </tr>
        <tr class="play-eccd-summary-row">
            <td class="play-eccd-summary-label">Standard Score</td>
            ${quarterPlaceholders}<td class="play-eccd-summary-empty">-</td>
            <td class="play-eccd-summary-value" data-play-final-summary="standard">-</td>
        </tr>
        <tr class="play-eccd-summary-row">
            <td class="play-eccd-summary-label">Interpretation</td>
            ${quarterPlaceholders}<td class="play-eccd-summary-value play-eccd-interpretation-cell" colspan="2" data-play-final-summary="interpretation">-</td>
        </tr>
    `;
}

function createPlaySchoolAgeField(item) {
    return `
        <select class="play-eccd-manual-age-select play-eccd-age-key" data-play-age-key="${item.evaluation}">
            ${PLAY_SCHOOL_AGE_GROUPS.map(group => `
                <option value="${group.age_key}" ${group.age_key === item.age_key ? 'selected' : ''}>${escapeHtml(formatPlaySchoolAgeBandLabel(group.age_key))}</option>
            `).join('')}
        </select>
        <small class="play-eccd-age-band" data-play-age-band="${item.evaluation}">${escapeHtml(createPlaySchoolActualAgeText(item))}</small>
        <small class="play-eccd-age-warning ${item.age_warning ? '' : 'd-none'}" data-play-age-warning="${item.evaluation}">${escapeHtml(item.age_warning || '')}</small>
    `;
}

function createPlaySchoolFinalAgeField(item) {
    return `
        <label class="play-eccd-final-age-label">
            <span>Child's Age:</span>
            <select class="play-eccd-manual-age-select play-eccd-final-age-select">
                ${PLAY_SCHOOL_AGE_GROUPS.map(group => `
                    <option value="${group.age_key}" ${group.age_key === item.age_key ? 'selected' : ''}>${escapeHtml(formatPlaySchoolAgeBandLabel(group.age_key))}</option>
                `).join('')}
            </select>
        </label>
        <small class="play-eccd-final-age-readout" data-play-final-age-readout>${escapeHtml(createPlaySchoolActualAgeText(item))}</small>
        <small class="play-eccd-final-age-warning ${item.age_warning ? '' : 'd-none'}" data-play-final-age-warning>${escapeHtml(item.age_warning || '')}</small>
    `;
}

function createPlaySchoolActualAgeText(details) {
    if (!details.age_is_computed) return 'Actual age unavailable. Select the ECCD age table.';

    const suggestedBand = formatPlaySchoolAgeBandLabel(details.suggested_age_key);
    return `Actual age: ${details.age_text || 'Age unavailable'}${suggestedBand ? ` (suggested table: ${suggestedBand})` : ''}`;
}

function createPlaySchoolChecklistPanel(evaluation, checklistGroups) {
    return `
        <div class="play-eccd-checklist-panel" data-play-checklist-panel="${evaluation.evaluation}">
            <div class="play-eccd-check-grid">
                ${checklistGroups.map(group => `
                    <section class="play-eccd-check-group">
                        <div class="play-eccd-check-group-title">${escapeHtml(group.label)} <span class="play-eccd-quarter-caption">${escapeHtml(toOrdinal(evaluation.evaluation))} Quarter items</span></div>
                        ${getItemsIntroducedInEvaluation(group.items, evaluation.evaluation).length ? getItemsIntroducedInEvaluation(group.items, evaluation.evaluation).map(item => createPlaySchoolCheckItem(evaluation, item)).join('') : `
                            <div class="play-eccd-empty-items">No checklist items are introduced in this quarter.</div>
                        `}
                    </section>
                `).join('')}
            </div>
            <label class="play-eccd-comments-label" for="play-eccd-comments-${evaluation.evaluation}">Teacher's Comments</label>
            <textarea id="play-eccd-comments-${evaluation.evaluation}" class="form-control play-eccd-comments" rows="3">${escapeHtml(evaluation.comments || '')}</textarea>
        </div>
    `;
}

function createPlaySchoolCheckItem(evaluation, item) {
    const quarter = evaluation.quarter;
    const gradeMap = new Map((quarter?.grades || []).map(grade => [String(grade.area_id || grade.label), grade.grade]));
    const savedGrade = gradeMap.get(String(item.area_id)) || gradeMap.get(item.label) || '';
    const checked = isPlayChecklistChecked(savedGrade);
    const id = `play-eccd-check-${evaluation.evaluation}-${item.index}`;

    return `
        <label class="play-eccd-check-label" for="${id}">
            <input
                type="checkbox"
                class="form-check-input play-eccd-check"
                id="${id}"
                data-eval="${evaluation.evaluation}"
                data-area-id="${escapeHtml(item.area_id)}"
                data-domain="${escapeHtml(item.domain_key)}"
                ${checked ? 'checked' : ''}
            >
            <span>${escapeHtml(item.item)}</span>
        </label>
    `;
}

function createPlaySchoolEccdStyles() {
    return `
        <style>
            .play-eccd-swal {
                padding: 0 0 1rem;
            }
            .play-eccd-editor {
                color: #07145f;
                font-family: Arial, Helvetica, sans-serif;
                font-size: 13px;
            }
            .play-eccd-student-bar,
            .play-eccd-checklist-top {
                display: flex;
                justify-content: space-between;
                gap: 14px;
                align-items: flex-start;
                margin-bottom: 12px;
                flex-wrap: wrap;
            }
            .play-eccd-student-name {
                color: #111827;
                font-size: 16px;
                font-weight: 800;
            }
            .play-eccd-student-meta,
            .play-eccd-note {
                color: #64748b;
                font-size: 12px;
                font-weight: 600;
            }
            .play-eccd-table-wrap {
                border: 3px solid #07145f;
                overflow-x: auto;
                background: #fff;
            }
            .play-eccd-table {
                width: 100%;
                min-width: 1060px;
                border-collapse: collapse;
                table-layout: fixed;
            }
            .play-eccd-table th,
            .play-eccd-table td {
                border: 1px solid #071d85;
                padding: 7px 8px;
                text-align: center;
                vertical-align: middle;
            }
            .play-eccd-domain-head {
                width: 250px;
                background: #07145f;
                color: #fff;
                font-size: 42px;
                font-weight: 900;
                letter-spacing: 0;
            }
            .play-eccd-age-head {
                color: #07145f;
                font-size: 24px;
                font-weight: 900;
                background: #fff;
            }
            .play-eccd-eval-head {
                background: #fff;
                color: #111;
                font-size: 13px;
                font-weight: 700;
            }
            .play-eccd-eval-title {
                margin-bottom: 5px;
                font-size: 14px;
            }
            .play-eccd-eval-head label {
                display: inline-grid;
                grid-template-columns: auto minmax(118px, 1fr);
                align-items: center;
                gap: 6px;
                margin: 2px 6px;
                color: #111;
                font-size: 12px;
                font-weight: 600;
            }
            .play-eccd-date-input,
            .play-eccd-manual-age-select {
                height: 28px;
                border: 1px solid #9bb0d6;
                border-radius: 4px;
                padding: 2px 6px;
                font-size: 12px;
            }
            .play-eccd-age-readout {
                display: inline-flex;
                min-height: 28px;
                align-items: center;
                border: 1px solid #9bb0d6;
                border-radius: 4px;
                padding: 2px 8px;
                background: #f8fafc;
                color: #07145f;
                font-size: 12px;
                font-weight: 800;
            }
            .play-eccd-final-age-title {
                margin-bottom: 4px;
                font-size: 14px;
            }
            .play-eccd-final-age-label {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                color: #111;
                font-size: 12px;
                font-weight: 700;
            }
            .play-eccd-final-age-readout,
            .play-eccd-final-age-warning {
                display: block;
                margin-top: 3px;
                color: #64748b;
                font-size: 10px;
                font-weight: 700;
                line-height: 1.2;
            }
            .play-eccd-final-age-warning {
                color: #b45309;
            }
            .play-eccd-age-band {
                display: block;
                grid-column: 2;
                color: #64748b;
                font-size: 10px;
                font-weight: 700;
                line-height: 1.2;
                text-align: left;
            }
            .play-eccd-age-warning {
                display: block;
                grid-column: 1 / -1;
                margin: 3px 6px 0;
                padding: 5px 7px;
                border: 1px solid #f4c36a;
                border-radius: 6px;
                background: #fff7e6;
                color: #8a5400;
                font-size: 10px;
                font-weight: 700;
                line-height: 1.3;
                text-align: left;
            }
            .play-eccd-score-head {
                background: #f80000;
                color: #fff;
                font-size: 14px;
                font-weight: 900;
            }
            .play-eccd-domain-cell {
                text-align: left !important;
                color: #111;
                font-size: 18px;
                line-height: 1.1;
            }
            .play-eccd-domain-cell span {
                display: block;
                font-weight: 700;
            }
            .play-eccd-domain-cell small {
                display: block;
                margin-top: 2px;
                color: #64748b;
                font-size: 11px;
                font-weight: 600;
            }
            .play-eccd-raw-cell,
            .play-eccd-scaled-cell,
            .play-eccd-summary-value {
                min-height: 34px;
                color: #07145f;
                font-size: 16px;
                font-weight: 800;
            }
            .play-eccd-low-score {
                background: #fff0d8;
                color: #b45309;
            }
            .play-eccd-summary-label {
                color: #f00077;
                text-align: left !important;
                font-size: 17px;
                font-weight: 800;
            }
            .play-eccd-summary-empty {
                background: #86a8bf;
                color: transparent;
            }
            .play-eccd-interpretation-cell {
                color: #07145f;
                font-size: 12px;
                line-height: 1.25;
                white-space: normal;
            }
            .play-eccd-checklist-editor {
                margin-top: 14px;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 12px;
                background: #f8fafc;
            }
            .play-eccd-section-title {
                color: #111827;
                font-size: 15px;
                font-weight: 800;
            }
            .play-eccd-eval-tabs .btn.active {
                background: #ea9aa6;
                border-color: #ea9aa6;
                color: #fff;
            }
            .play-eccd-checklist-panel {
                display: none;
            }
            .play-eccd-checklist-panel.active {
                display: block;
            }
            .play-eccd-check-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 10px;
            }
            .play-eccd-check-group {
                background: #fff;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 10px;
            }
            .play-eccd-check-group-title {
                margin-bottom: 8px;
                color: #07145f;
                font-weight: 800;
            }
            .play-eccd-quarter-caption {
                color: #64748b;
                font-size: 10px;
                font-weight: 700;
            }
            .play-eccd-check-label {
                display: flex;
                align-items: flex-start;
                gap: 8px;
                margin: 0 0 7px;
                color: #111827;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
            }
            .play-eccd-check-label:last-child {
                margin-bottom: 0;
            }
            .play-eccd-empty-items {
                color: #94a3b8;
                font-size: 12px;
                font-weight: 600;
            }
            .play-eccd-comments-label {
                display: block;
                margin: 12px 0 5px;
                color: #111827;
                font-size: 12px;
                font-weight: 800;
            }
            @media (max-width: 768px) {
                .play-eccd-domain-head {
                    font-size: 28px;
                    width: 190px;
                }
                .play-eccd-check-grid {
                    grid-template-columns: 1fr;
                }
            }
        </style>
    `;
}

function switchPlaySchoolChecklistPanel(root, evaluation) {
    root.querySelectorAll('.play-eccd-eval-tab').forEach(button => {
        button.classList.toggle('active', Number(button.dataset.evaluation) === evaluation);
    });
    root.querySelectorAll('.play-eccd-checklist-panel').forEach(panel => {
        panel.classList.toggle('active', Number(panel.dataset.playChecklistPanel) === evaluation);
    });
}

function updatePlaySchoolEccdTable(root = document) {
    const domainKeys = getPlaySchoolDomainKeysFromEditor(root);
    const evaluationData = new Map();

    getReportQuarterNumbers().forEach(evaluation => {
        const data = getPlaySchoolEccdEvaluationData(root, evaluation);
        evaluationData.set(evaluation, data);

        domainKeys.forEach(key => {
            const rawCell = root.querySelector(`[data-play-raw="${evaluation}:${key}"]`);
            const hasItems = data.itemCounts[key] > 0;

            if (rawCell) rawCell.textContent = hasItems ? String(data.rawScores[key]) : '-';
        });
    });

    const finalData = getPlaySchoolEccdFinalData(root, domainKeys, evaluationData);
    domainKeys.forEach(key => {
        const rawCell = root.querySelector(`[data-play-final-raw="${key}"]`);
        const scaledCell = root.querySelector(`[data-play-final-scaled="${key}"]`);
        const rawScore = finalData.rawScores[key];
        const scaledScore = finalData.result.scaled_scores[key];
        if (rawCell) rawCell.textContent = String(rawScore ?? '-');
        if (scaledCell) {
            scaledCell.textContent = scaledScore === '' ? '-' : String(scaledScore);
            scaledCell.classList.toggle('play-eccd-low-score', scaledScore !== '' && Number(scaledScore) <= 6);
        }
    });

    setPlaySchoolFinalSummaryCell(root, 'sum', finalData.result.sum_scaled_scores);
    setPlaySchoolFinalSummaryCell(root, 'standard', finalData.result.standard_score);
    setPlaySchoolFinalSummaryCell(root, 'interpretation', finalData.result.standard_interpretation?.label || '-');
}

function setPlaySchoolFinalSummaryCell(root, type, value) {
    const cell = root.querySelector(`[data-play-final-summary="${type}"]`);
    if (!cell) return;

    const hasValue = value !== '' && value !== null && value !== undefined;
    cell.textContent = hasValue ? String(value) : '-';
    cell.classList.toggle('play-eccd-low-score', type === 'standard' && hasValue && Number(value) <= 79);
}

function getPlaySchoolEccdFinalData(root, domainKeys, evaluationData) {
    const rawScores = {};
    domainKeys.forEach(key => {
        rawScores[key] = getReportQuarterNumbers().reduce((total, evaluation) => {
            return total + Number(evaluationData.get(evaluation)?.rawScores[key] || 0);
        }, 0);
    });

    const ageKey = root.querySelector('.play-eccd-final-age-select')?.value
        || root.querySelector('[data-play-final-age-key]')?.dataset.playFinalAgeKey
        || PLAY_SCHOOL_AGE_GROUPS[0]?.age_key
        || '';

    return {
        rawScores,
        result: calculatePlaySchoolEccdResult(
            rawScores,
            ageKey,
            currentPlaySchoolTransmutationTables,
            currentPlaySchoolStandardScoreRows,
            domainKeys,
            currentPlaySchoolInterpretations
        )
    };
}

function getPlaySchoolDomainKeysFromEditor(root) {
    return Array.from(root.querySelectorAll('[data-play-domain-row]'))
        .map(cell => cell.dataset.playDomainRow)
        .filter(Boolean);
}

function getPlaySchoolEccdEvaluationData(root, evaluation) {
    const ageControl = root.querySelector(`[data-play-age-key="${evaluation}"]`);
    const ageKey = ageControl ? ageControl.value : (PLAY_SCHOOL_AGE_GROUPS[0]?.age_key || '');
    const rawScores = {};
    const itemCounts = {};
    const domainKeys = getPlaySchoolDomainKeysFromEditor(root);

    domainKeys.forEach(key => {
        const inputs = Array.from(root.querySelectorAll(`.play-eccd-check[data-eval="${evaluation}"][data-domain="${key}"]`));
        itemCounts[key] = inputs.length;
        if (inputs.length) {
            rawScores[key] = inputs.filter(input => input.checked).length;
        }
    });

    return {
        ageKey,
        rawScores,
        itemCounts,
        result: calculatePlaySchoolEccdResult(
            rawScores,
            ageKey,
            currentPlaySchoolTransmutationTables,
            currentPlaySchoolStandardScoreRows,
            domainKeys,
            currentPlaySchoolInterpretations
        )
    };
}

function validatePlaySchoolEccdDates(root) {
    const dateInputs = Array.from(root?.querySelectorAll('.play-eccd-date-input') || []);
    dateInputs.forEach(input => input.classList.remove('is-invalid'));

    const missingDate = dateInputs.find(input => !input.value);
    if (missingDate) missingDate.classList.add('is-invalid');

    return missingDate || null;
}

function collectPlaySchoolEccdFormData(root) {
    const domainKeys = getPlaySchoolDomainKeysFromEditor(root);
    const evaluationNumbers = getReportQuarterNumbers();
    const lastEvaluation = evaluationNumbers.at(-1) || 1;
    const evaluationData = new Map(evaluationNumbers.map(evaluation => [
        evaluation,
        getPlaySchoolEccdEvaluationData(root, evaluation)
    ]));
    const finalData = getPlaySchoolEccdFinalData(root, domainKeys, evaluationData);

    return evaluationNumbers.map(evaluation => {
        const quarterData = evaluationData.get(evaluation);
        const scoreData = evaluation === lastEvaluation ? finalData : quarterData;
        const comments = root.querySelector(`#play-eccd-comments-${evaluation}`)?.value.trim() || '';
        const date = root.querySelector(`.play-eccd-date-input[data-evaluation="${evaluation}"]`)?.value || '';

        return {
            quarter: evaluation,
            // The API validates every configured learning area. Items introduced in a
            // later quarter are not rendered in this panel, so submit them as F until
            // their checkbox becomes available for assessment.
            grades: currentLearningAreas.map((area, index) => {
                const input = root.querySelector(`#play-eccd-check-${evaluation}-${index}`);
                return {
                    area_id: area.area_id,
                    grade_value: input?.checked ? 'A+' : 'F'
                };
            }),
            overall_grade: getPlaySchoolEccdOverallGrade(scoreData.result),
            attendance: '',
            total_school_days: '',
            remarks: JSON.stringify({
                comments,
                play_eccd: {
                    evaluation_date: date,
                    age_key: evaluation === lastEvaluation ? finalData.result.age_key : quarterData.ageKey,
                    sum_scaled_scores: scoreData.result.sum_scaled_scores,
                    standard_score: scoreData.result.standard_score,
                    interpretation: scoreData.result.standard_interpretation?.label || '',
                    requires_second_tier_evaluation: scoreData.result.requires_second_tier_evaluation,
                    is_final_cumulative_result: evaluation === lastEvaluation
                }
            })
        };
    });
}

function getPlaySchoolEccdOverallGrade(result) {
    if (!result?.is_complete) return 'F';
    const standardScore = Number(result.standard_score);
    if (!Number.isFinite(standardScore)) return 'F';
    if (standardScore >= 120) return 'A+';
    if (standardScore >= 80) return 'B';
    if (standardScore >= 70) return 'D';
    return 'F';
}

async function savePlaySchoolEccdReport(enrollmentDetailsId, evaluations, { reloadReportCards = true } = {}) {
    Swal.fire({
        title: 'Saving ECCD Record...',
        allowOutsideClick: false,
        showConfirmButton: false,
        willOpen: () => Swal.showLoading()
    });

    try {
        for (const evaluation of evaluations) {
            const response = await axios.post('../../api/admin/student_grade.php?operation=savePreschoolReportCard', {
                enrollment_details_id: enrollmentDetailsId,
                quarter: evaluation.quarter,
                grades: evaluation.grades,
                overall_grade: evaluation.overall_grade,
                attendance: evaluation.attendance,
                total_school_days: evaluation.total_school_days,
                remarks: evaluation.remarks
            });

            if (response.data.status !== 'success') {
                throw new Error(response.data.message || 'Unable to save ECCD record.');
            }
        }

        Swal.fire({
            icon: 'success',
            title: 'Saved',
            text: 'ECCD record was saved.',
            timer: 1400,
            showConfirmButton: false
        }).then(() => {
            if (reloadReportCards) loadAndRenderSectionReportCards();
        });
    } catch (error) {
        console.error('Error saving ECCD record:', error);
        Swal.fire('Error', error.message || 'Network error while saving ECCD record.', 'error');
    }
}

function getPlaySchoolChecklistGroups() {
    const groups = [];
    const groupMap = new Map();

    const ensureGroup = (key, label) => {
        const normalizedKey = normalizePlaySchoolDomainKey(key || label) || 'observation_checklist';
        if (!groupMap.has(normalizedKey)) {
            const group = {
                key: normalizedKey,
                label: label || playSchoolDomainLabels[normalizedKey] || normalizedKey,
                items: []
            };
            groupMap.set(normalizedKey, group);
            groups.push(group);
        }
        return groupMap.get(normalizedKey);
    };

    currentLearningAreas.forEach((area, index) => {
        const parsed = parseChecklistLabel(area.label);
        const storedDomainLabel = String(area.domain_label || '').trim();
        const storedDomainKey = normalizePlaySchoolDomainKey(area.domain_key || storedDomainLabel);
        const domainKey = storedDomainKey || mapLearningAreaToPlaySchoolDomain(parsed.group, parsed.item);
        const domainLabel = storedDomainLabel || playSchoolDomainLabels[domainKey] || parsed.group || 'Observation Checklist';
        const group = ensureGroup(domainKey, domainLabel);
        group.items.push({
            ...area,
            index,
            domain_key: group.key,
            introduced_quarter: getAreaIntroducedQuarter(area),
            item: storedDomainLabel ? area.label : (parsed.item || parsed.group || area.label)
        });
    });

    return groups;
}

function mapLearningAreaToPlaySchoolDomain(group, item) {
    const text = `${group || ''} ${item || ''}`.toLowerCase();

    if (text.includes('gross')) return 'gross_motor';
    if (text.includes('fine')) return 'fine_motor';
    if (text.includes('self') || text.includes('independence') || text.includes('toilet') || text.includes('eats')) return 'self_help';
    if (text.includes('receptive') || text.includes('understand') || text.includes('instruction')) return 'receptive_language';
    if (text.includes('expressive') || text.includes('uses words') || text.includes('speaks') || text.includes('conversation')) return 'expressive_language';
    if (text.includes('social') || text.includes('emotional') || text.includes('behavior') || text.includes('friend')) return 'social_emotional';
    if (text.includes('cognitive') || text.includes('early learning') || text.includes('color') || text.includes('shape') || text.includes('count')) return 'cognitive';
    if (text.includes('communication') || text.includes('language')) return 'expressive_language';
    if (text.includes('creativity') || text.includes('play') || text.includes('music') || text.includes('imagination')) return 'cognitive';

    return 'cognitive';
}

function decodeQuarterRemarks(quarter) {
    const rawRemarks = String(quarter?.remarks || '').trim();
    if (!rawRemarks.startsWith('{')) {
        return { comments: rawRemarks, play_eccd: {} };
    }

    try {
        const parsed = JSON.parse(rawRemarks);
        if (!parsed || typeof parsed !== 'object') {
            return { comments: rawRemarks, play_eccd: {} };
        }

        return {
            comments: String(parsed.comments || ''),
            play_eccd: parsed.play_eccd && typeof parsed.play_eccd === 'object' ? parsed.play_eccd : {}
        };
    } catch (error) {
        return { comments: rawRemarks, play_eccd: {} };
    }
}

function getQuarterDisplayRemarks(quarter) {
    return decodeQuarterRemarks(quarter).comments;
}

function updatePlaySchoolComputedAgeField(root, student, evaluation, dateValue) {
    const details = getPlaySchoolStudentAgeDetails(student, dateValue, '');
    if (!details.is_computed) return;

    const ageInput = root.querySelector(`.play-eccd-age-key[data-play-age-key="${evaluation}"]`);
    const ageBand = root.querySelector(`[data-play-age-band="${evaluation}"]`);
    const ageWarning = root.querySelector(`[data-play-age-warning="${evaluation}"]`);

    if (ageInput) ageInput.value = details.age_key;
    if (ageBand) ageBand.textContent = createPlaySchoolActualAgeText({
        ...details,
        age_is_computed: details.is_computed
    });
    if (ageWarning) {
        ageWarning.textContent = details.warning || '';
        ageWarning.classList.toggle('d-none', !details.warning);
    }
}

function updatePlaySchoolFinalAgeField(root, student, dateValue) {
    const details = getPlaySchoolStudentAgeDetails(student, dateValue, '');
    const ageSelect = root.querySelector('.play-eccd-final-age-select');
    const ageHeader = root.querySelector('[data-play-final-age-key]');
    const ageHeaderText = root.querySelector('[data-play-final-age-header]');
    const ageReadout = root.querySelector('[data-play-final-age-readout]');
    const ageWarning = root.querySelector('[data-play-final-age-warning]');

    if (details.is_computed && ageSelect) ageSelect.value = details.age_key;
    if (ageHeader && ageSelect) ageHeader.dataset.playFinalAgeKey = ageSelect.value;
    if (ageHeaderText) ageHeaderText.textContent = `Age: ${details.age_text || 'Age unavailable'}`;
    if (ageReadout) ageReadout.textContent = createPlaySchoolActualAgeText(details);
    if (ageWarning) {
        ageWarning.textContent = details.warning || '';
        ageWarning.classList.toggle('d-none', !details.warning);
    }
}

function getPlaySchoolStudentAgeDetails(student, dateValue = '', fallbackAgeKey = '') {
    const birthDate = parseDateOnly(student?.birthday);
    const asOfDate = parseDateOnly(dateValue) || new Date();
    const fallbackGroup = getPlaySchoolAgeGroupByKey(fallbackAgeKey);
    const firstGroup = PLAY_SCHOOL_AGE_GROUPS[0] || null;

    if (!birthDate) {
        const selectedGroup = fallbackGroup || firstGroup;
        return {
            age_key: selectedGroup?.age_key || '',
            age_text: '',
            age_group_label: '',
            suggested_age_key: '',
            warning: 'Student birthday is missing. Select the appropriate ECCD age table manually.',
            months: null,
            is_computed: false
        };
    }

    const months = getAgeInCompletedMonths(birthDate, asOfDate);
    const group = PLAY_SCHOOL_AGE_GROUPS.find(item => months >= item.min_months && months <= item.max_months) || null;
    const nearestGroup = getNearestPlaySchoolAgeGroup(months);
    const selectedGroup = fallbackGroup || group || nearestGroup;
    return {
        age_key: selectedGroup?.age_key || '',
        age_text: formatStudentAgeFromMonths(months),
        age_group_label: group?.age_label || 'Outside ECCD Child\'s Record 2 age range',
        suggested_age_key: (group || nearestGroup)?.age_key || '',
        warning: createPlaySchoolAgeRangeWarning(birthDate, asOfDate, months),
        months,
        is_computed: true
    };
}

function getNearestPlaySchoolAgeGroup(ageInMonths) {
    if (!PLAY_SCHOOL_AGE_GROUPS.length) return null;

    const months = Number(ageInMonths);
    if (!Number.isFinite(months) || months < PLAY_SCHOOL_AGE_GROUPS[0].min_months) {
        return PLAY_SCHOOL_AGE_GROUPS[0];
    }

    return PLAY_SCHOOL_AGE_GROUPS[PLAY_SCHOOL_AGE_GROUPS.length - 1];
}

function createPlaySchoolAgeRangeWarning(birthDate, asOfDate, ageInMonths) {
    const firstGroup = PLAY_SCHOOL_AGE_GROUPS[0];
    const lastGroup = PLAY_SCHOOL_AGE_GROUPS[PLAY_SCHOOL_AGE_GROUPS.length - 1];
    if (!firstGroup || !lastGroup || !Number.isFinite(ageInMonths)) return '';

    if (ageInMonths < firstGroup.min_months) {
        const eligibilityDate = addCalendarMonths(birthDate, firstGroup.min_months);
        const timeRemaining = formatTimeUntilDate(asOfDate, eligibilityDate);
        const milestone = formatStudentAgeMilestone(firstGroup.min_months);
        return `Outside the ECCD age range. The child will turn ${milestone}${timeRemaining ? ` in ${timeRemaining}` : ''}, on ${formatDisplayDate(eligibilityDate)}. You may select an ECCD age table manually.`;
    }

    if (ageInMonths > lastGroup.max_months) {
        const monthsOver = ageInMonths - lastGroup.max_months;
        return `Outside the ECCD age range by ${formatMonthDuration(monthsOver)}. The oldest ECCD table ends at ${formatStudentAgeMilestone(lastGroup.max_months)}. You may select an ECCD age table manually.`;
    }

    return '';
}

function addCalendarMonths(date, monthsToAdd) {
    const totalMonths = (date.getFullYear() * 12) + date.getMonth() + Number(monthsToAdd || 0);
    const year = Math.floor(totalMonths / 12);
    const month = totalMonths % 12;
    const lastDay = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(date.getDate(), lastDay));
}

function formatTimeUntilDate(fromDate, targetDate) {
    if (!(fromDate instanceof Date) || !(targetDate instanceof Date) || targetDate <= fromDate) return '';

    let totalMonths = (targetDate.getFullYear() - fromDate.getFullYear()) * 12;
    totalMonths += targetDate.getMonth() - fromDate.getMonth();
    if (targetDate.getDate() < fromDate.getDate()) totalMonths -= 1;
    totalMonths = Math.max(0, totalMonths);

    const monthAnchor = addCalendarMonths(fromDate, totalMonths);
    const remainingDays = Math.max(0, Math.round((targetDate - monthAnchor) / 86400000));
    const parts = [];

    if (totalMonths) parts.push(formatMonthDuration(totalMonths));
    if (remainingDays) parts.push(`${remainingDays} day${remainingDays === 1 ? '' : 's'}`);
    return parts.join(' and ') || 'less than 1 day';
}

function formatMonthDuration(totalMonths) {
    const value = Math.max(0, Number(totalMonths) || 0);
    const years = Math.floor(value / 12);
    const months = value % 12;
    const parts = [];

    if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`);
    if (months) parts.push(`${months} month${months === 1 ? '' : 's'}`);
    return parts.join(' and ') || '0 months';
}

function formatStudentAgeMilestone(totalMonths) {
    return formatMonthDuration(totalMonths);
}

function formatDisplayDate(date) {
    return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }).format(date);
}

function getPlaySchoolDefaultAgeKey(student, dateValue = '') {
    const details = getPlaySchoolStudentAgeDetails(student, dateValue, '');
    if (details.age_key) return details.age_key;
    return details.is_computed ? '' : (PLAY_SCHOOL_AGE_GROUPS[0]?.age_key || '');
}

function getPlaySchoolAgeKeyFromBirthday(birthday, dateValue = '') {
    const birthDate = parseDateOnly(birthday);
    if (!birthDate) return '';

    const asOfDate = parseDateOnly(dateValue) || new Date();
    const months = getAgeInCompletedMonths(birthDate, asOfDate);

    const group = PLAY_SCHOOL_AGE_GROUPS.find(item => months >= item.min_months && months <= item.max_months);
    return group?.age_key || '';
}

function getAgeInCompletedMonths(birthDate, asOfDate) {
    let months = (asOfDate.getFullYear() - birthDate.getFullYear()) * 12;
    months += asOfDate.getMonth() - birthDate.getMonth();
    if (asOfDate.getDate() < birthDate.getDate()) months -= 1;
    return Math.max(0, months);
}

function formatStudentAgeFromMonths(totalMonths) {
    const monthsValue = Number(totalMonths);
    if (!Number.isFinite(monthsValue)) return '';

    const years = Math.floor(monthsValue / 12);
    const months = monthsValue % 12;
    const yearLabel = `${years} year${years === 1 ? '' : 's'}`;
    const monthLabel = `${months} month${months === 1 ? '' : 's'}`;
    return `${yearLabel} ${monthLabel}`;
}

function formatPlaySchoolAgeBandLabel(ageGroupLabel) {
    const group = PLAY_SCHOOL_AGE_GROUPS.find(item => item.age_label === ageGroupLabel)
        || getPlaySchoolAgeGroupByKey(ageGroupLabel);
    if (!group) return '';

    return `${formatStudentAgeFromMonths(group.min_months)} - ${formatStudentAgeFromMonths(group.max_months)}`;
}

function getPlaySchoolAgeGroupByKey(ageKey) {
    return PLAY_SCHOOL_AGE_GROUPS.find(group => group.age_key === ageKey) || null;
}

function parseDateOnly(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;

    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
}

function collectQuarterFormData() {
    const grades = currentLearningAreas.map((area, index) => ({
        area_id: area.area_id,
        grade_value: getQuarterInputValue(index)
    }));
    const isPlaySchool = Boolean(document.querySelector('.preplay-check-input'));

    return {
        grades,
        overall_grade: isPlaySchool ? getPlaySchoolOverallGradeInput() : calculateOverallGradeFromValues(grades.map(item => item.grade_value)),
        attendance: isPlaySchool ? '' : (document.getElementById('preplay-attendance')?.value || ''),
        total_school_days: isPlaySchool ? '' : (document.getElementById('preplay-total-days')?.value || ''),
        remarks: document.getElementById('preplay-feedback')?.value.trim() || ''
    };
}

function getQuarterInputValue(index) {
    const checkbox = document.getElementById(`preplay-check-${index}`);
    if (checkbox) {
        return checkbox.checked ? 'A+' : 'F';
    }

    return document.getElementById(`preplay-grade-${index}`)?.value || '';
}

function createPlaySchoolChecklistFields(gradeMap) {
    const groups = new Map();

    currentLearningAreas.forEach((area, index) => {
        const parsed = parseChecklistLabel(area.label);
        if (!groups.has(parsed.group)) groups.set(parsed.group, []);

        const savedGrade = gradeMap.get(String(area.area_id)) || gradeMap.get(area.label) || '';
        groups.get(parsed.group).push({
            ...area,
            index,
            item: parsed.item,
            checked: isPlayChecklistChecked(savedGrade)
        });
    });

    return `
        <div class="play-checklist-editor">
            ${Array.from(groups, ([group, items]) => `
                <div class="mb-3">
                    <div class="fw-bold mb-2">${escapeHtml(group)}</div>
                    <div class="d-grid gap-2">
                        ${items.map(item => `
                            <label class="d-flex align-items-start gap-2 border rounded p-2 bg-white" for="preplay-check-${item.index}">
                                <input
                                    class="form-check-input mt-1 preplay-check-input"
                                    type="checkbox"
                                    id="preplay-check-${item.index}"
                                    data-area-id="${item.area_id}"
                                    ${item.checked ? 'checked' : ''}
                                >
                                <span class="small fw-semibold">${escapeHtml(item.item)}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function createPlaySchoolProgressFields(quarter) {
    const selectedProgress = getPlaySchoolProgressLabel(quarter?.overall_grade || '');
    const options = [
        { label: 'Very Good', grade: 'A+' },
        { label: 'Good', grade: 'B' },
        { label: 'Developing', grade: 'D' }
    ];

    return `
        <div class="mt-3">
            <div class="fw-bold small mb-2">Overall Progress</div>
            <div class="d-grid gap-2">
                ${options.map(option => `
                    <label class="d-flex align-items-center gap-2 border rounded p-2 bg-white" for="preplay-progress-${option.grade}">
                        <input
                            class="form-check-input preplay-progress-input"
                            type="radio"
                            name="preplay-progress"
                            id="preplay-progress-${option.grade}"
                            value="${option.grade}"
                            ${selectedProgress === option.label ? 'checked' : ''}
                        >
                        <span class="small fw-semibold">${escapeHtml(option.label)}</span>
                    </label>
                `).join('')}
            </div>
        </div>
    `;
}

function getPlaySchoolOverallGradeInput() {
    return document.querySelector('input[name="preplay-progress"]:checked')?.value || 'B';
}

function parseChecklistLabel(label) {
    const value = String(label || '').trim();
    const separatorIndex = value.indexOf(':');

    if (separatorIndex === -1) {
        return {
            group: 'Observation Checklist',
            item: value || 'Checklist item'
        };
    }

    return {
        group: value.slice(0, separatorIndex).trim() || 'Observation Checklist',
        item: value.slice(separatorIndex + 1).trim() || value
    };
}

function calculateOverallGradeFromValues(values) {
    const scores = values
        .map(value => gradeScores[String(value || '').toUpperCase()])
        .filter(score => Number.isFinite(score));

    if (!scores.length) return 'C';

    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const rounded = Math.round(average);
    return gradeOptions.find(grade => gradeScores[grade] === rounded) || 'C';
}

async function saveQuarter(enrollmentDetailsId, formData) {
    Swal.fire({
        title: 'Saving Report Card...',
        allowOutsideClick: false,
        showConfirmButton: false,
        willOpen: () => Swal.showLoading()
    });

    try {
        const response = await axios.post('../../api/admin/student_grade.php?operation=savePreschoolReportCard', {
            enrollment_details_id: enrollmentDetailsId,
            quarter: currentQuarter,
            grades: formData.grades,
            overall_grade: formData.overall_grade,
            attendance: formData.attendance,
            total_school_days: formData.total_school_days,
            remarks: formData.remarks
        });

        if (response.data.status !== 'success') {
            Swal.fire('Error', response.data.message || 'Unable to save report card.', 'error');
            return;
        }

        Swal.fire({
            icon: 'success',
            title: 'Saved',
            text: `${getReportQuarterLabel(currentQuarter, true)} report card was saved.`,
            timer: 1400,
            showConfirmButton: false
        }).then(() => loadAndRenderSectionReportCards());
    } catch (error) {
        console.error('Error saving report card:', error);
        Swal.fire('Error', 'Network error while saving report card.', 'error');
    }
}

function getStudentQuarter(student, quarter) {
    return student?.report_card?.quarters?.[String(quarter)] || null;
}

function updateGradebookRow(row) {
    if (!row) return;

    const scoreCells = Array.from(row.querySelectorAll('.gradebook-score-input')).map(input => {
        const rawValue = input.value.trim();
        const perfectScore = Number(input.dataset.perfectScore || 100);
        const weight = Number(input.dataset.weight || 0);
        const isMissing = rawValue === '';
        const rawScore = Number(rawValue);
        const isInvalid = !isMissing && (!Number.isFinite(rawScore) || rawScore < 0 || rawScore > perfectScore);

        input.classList.toggle('is-invalid', isInvalid);

        return {
            percentage: isMissing || isInvalid ? null : (rawScore / Math.max(perfectScore, 1)) * 100,
            weight,
            isMissing: isMissing || isInvalid
        };
    });

    const average = calculateGradebookAverage(scoreCells);
    const isIncomplete = scoreCells.every(cell => cell.isMissing);
    const remark = isIncomplete ? 'F' : getTransmutedLetter(average);
    const status = getGradebookStatus(isIncomplete, average, remark);

    const averageCell = row.querySelector('.average-cell');
    if (averageCell) {
        averageCell.className = `average-cell ${getAverageClass(average, isIncomplete)}`;
        averageCell.textContent = isIncomplete ? '-' : formatScore(average);
    }

    const remarksCell = row.querySelector('.remarks-cell');
    if (remarksCell) remarksCell.textContent = remark;

    const statusCell = row.querySelector('.status-col');
    if (statusCell) {
        statusCell.innerHTML = `<span class="${getStatusClass(status)}">${escapeHtml(status)}</span>`;
    }
}

function collectGradebookRows() {
    return Array.from(document.querySelectorAll('#sectionReportCardsModal .gradebook-table tbody tr[data-enrollment-id]')).map(row => ({
        enrollment_details_id: Number(row.dataset.enrollmentId),
        scores: Array.from(row.querySelectorAll('.gradebook-score-input')).map(input => ({
            area_id: Number(input.dataset.areaId),
            raw_score: input.value.trim()
        }))
    }));
}

async function saveGradebookScores(sectionId) {
    document.querySelectorAll('#sectionReportCardsModal .gradebook-table tbody tr[data-enrollment-id]').forEach(updateGradebookRow);
    const invalidInput = document.querySelector('#sectionReportCardsModal .gradebook-score-input.is-invalid');
    if (invalidInput) {
        Swal.fire('Invalid score', 'Please fix scores that are above the perfect score or below zero.', 'warning');
        invalidInput.focus();
        return;
    }

    const saveButton = document.getElementById('btnSaveGradebookScores');
    const originalHtml = saveButton?.innerHTML;
    if (saveButton) {
        saveButton.disabled = true;
        saveButton.innerHTML = '<span class="spinner-border spinner-border-sm"></span><span>Saving</span>';
    }

    try {
        const response = await axios.post('../../api/admin/student_grade.php?operation=saveGradebookScores', {
            section_id: sectionId,
            quarter: currentQuarter,
            students: collectGradebookRows()
        });

        if (response.data.status !== 'success') {
            Swal.fire('Error', response.data.message || 'Unable to save gradebook.', 'error');
            return;
        }

        Swal.fire({
            icon: 'success',
            title: 'Saved',
            text: 'Gradebook scores were saved.',
            timer: 1300,
            showConfirmButton: false
        }).then(() => loadAndRenderSectionReportCards());
    } catch (error) {
        console.error('Error saving gradebook scores:', error);
        Swal.fire('Error', 'Network error while saving gradebook.', 'error');
    } finally {
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.innerHTML = originalHtml;
        }
    }
}

function getGradebookScoreCell(quarter, area) {
    const savedItem = getPrintableGradeItem(quarter, area);
    const savedGrade = savedItem?.grade ?? '';
    const perfectScore = getAreaPerfectScore(area);
    const rawScore = savedItem?.raw_score;

    if (rawScore !== null && rawScore !== undefined && rawScore !== '' && isNumeric(rawScore)) {
        const numericScore = Number(rawScore);
        return {
            areaId: area.area_id,
            display: formatScore(numericScore),
            inputValue: formatInputScore(numericScore),
            percentage: perfectScore > 0 ? (numericScore / perfectScore) * 100 : null,
            weight: getAreaWeight(area),
            perfectScore,
            isMissing: false
        };
    }

    if (savedGrade === '' || savedGrade === null || savedGrade === undefined) {
        return {
            areaId: area.area_id,
            display: '-',
            inputValue: '',
            percentage: null,
            weight: getAreaWeight(area),
            perfectScore,
            isMissing: true
        };
    }

    if (isNumeric(savedGrade)) {
        const numericScore = Number(savedGrade);
        return {
            areaId: area.area_id,
            display: formatScore(numericScore),
            inputValue: formatInputScore(numericScore),
            percentage: perfectScore > 0 ? (numericScore / perfectScore) * 100 : null,
            weight: getAreaWeight(area),
            perfectScore,
            isMissing: false
        };
    }

    const letter = String(savedGrade || '').toUpperCase();
    const percentage = gradePercentages[letter] ?? null;
    const estimatedRawScore = percentage !== null ? (percentage / 100) * perfectScore : null;

    return {
        areaId: area.area_id,
        display: estimatedRawScore === null ? escapeHtml(letter) : formatScore(estimatedRawScore),
        inputValue: estimatedRawScore === null ? '' : formatInputScore(estimatedRawScore),
        percentage,
        weight: getAreaWeight(area),
        perfectScore,
        isMissing: estimatedRawScore === null
    };
}

function getPrintableGradeItem(quarterData, area) {
    return (quarterData?.grades || []).find(item => {
        if (item.area_id) return String(item.area_id) === String(area.area_id);
        return item.label === area.label;
    }) || null;
}

function calculateGradebookAverage(scoreCells) {
    const completeCells = scoreCells.filter(cell => cell.percentage !== null && !cell.isMissing);
    if (!completeCells.length) return null;

    const weightedCells = completeCells.filter(cell => cell.weight > 0);
    if (weightedCells.length) {
        const totalWeight = weightedCells.reduce((sum, cell) => sum + cell.weight, 0);
        if (totalWeight > 0) {
            return roundNumber(weightedCells.reduce((sum, cell) => sum + (cell.percentage * cell.weight), 0) / totalWeight, 1);
        }
    }

    return roundNumber(completeCells.reduce((sum, cell) => sum + cell.percentage, 0) / completeCells.length, 1);
}

function getTransmutedLetter(percentage) {
    if (percentage === null || percentage === undefined) return 'F';

    const rows = normalizeTransmutationRows(currentTransmutationRows)
        .sort((a, b) => Number(b.max_percentage) - Number(a.max_percentage));
    const match = rows.find(row => percentage >= Number(row.min_percentage) && percentage <= Number(row.max_percentage));
    return match?.transmuted_letter || 'F';
}

function getGradebookStatus(isIncomplete, average, remark) {
    if (isIncomplete || average === null) return 'Incomplete';
    return remark === 'F' || average < 75 ? 'Needs Review' : 'Passed';
}

function getAverageClass(average, isIncomplete) {
    if (isIncomplete || average === null) return 'avg-empty';
    if (average >= 85) return 'avg-good';
    if (average >= 75) return 'avg-warn';
    return 'avg-risk';
}

function getStatusClass(status) {
    if (status === 'Passed') return 'status-pill status-passed';
    if (status === 'Needs Review') return 'status-pill status-review';
    return 'status-pill status-incomplete';
}

function createStudentAvatar(student, index) {
    const palette = ['#f47aa2', '#2f80ed', '#f2994a', '#9b51e0', '#00a86b'];
    const name = String(student.student_name || 'Student').trim();
    const initials = name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0])
        .join('')
        .toUpperCase() || 'S';

    return `<span class="gradebook-avatar" style="background:${palette[index % palette.length]};">${escapeHtml(initials)}</span>`;
}

function getTotalActiveWeight(areas) {
    return roundNumber(areas.reduce((sum, area) => sum + getAreaWeight(area), 0), 2);
}

function getAreaWeight(area) {
    return Math.max(0, roundNumber(Number(area.weight_percentage ?? area.weight ?? 0), 2));
}

function getAreaPerfectScore(area) {
    return Math.max(1, roundNumber(Number(area.default_perfect_score ?? area.highest_possible_score ?? 100), 2));
}

function normalizeTransmutationRows(rows) {
    if (!Array.isArray(rows) || !rows.length) {
        return DEFAULT_TRANSMUTATION_ROWS.map(row => ({ ...row }));
    }

    return rows.map(row => ({
        min_percentage: Number(row.min_percentage ?? 0),
        max_percentage: Number(row.max_percentage ?? 0),
        transmuted_letter: String(row.transmuted_letter || row.letter || '').trim().toUpperCase()
    })).filter(row => row.transmuted_letter);
}

function isNumeric(value) {
    return value !== '' && value !== null && value !== undefined && !Number.isNaN(Number(value));
}

function roundNumber(value, places = 2) {
    const factor = 10 ** places;
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function formatScore(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '-';
    return number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function formatInputScore(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '';
    return number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function normalizeLearningAreas(areas) {
    if (!Array.isArray(areas) || areas.length === 0) {
        return defaultLearningAreas.map((label, index) => ({ area_id: index + 1, label }));
    }

    return areas.map((area, index) => {
        if (typeof area === 'string') {
            return { area_id: index + 1, label: area };
        }

        const parsed = parseChecklistLabel(area.label || area.area_name || '');
        const domainLabel = String(area.domain_label || '').trim();
        const domainKey = normalizePlaySchoolDomainKey(area.domain_key || domainLabel);

        return {
            area_id: area.area_id || index + 1,
            label: area.label || area.area_name || `Learning Area ${index + 1}`,
            domain_key: domainKey || mapLearningAreaToPlaySchoolDomain(parsed.group, parsed.item),
            domain_label: domainLabel || parsed.group || '',
            introduced_quarter: getAreaIntroducedQuarter(area),
            weight_percentage: Number(area.weight_percentage ?? area.weight ?? 0),
            default_perfect_score: Number(area.default_perfect_score ?? area.highest_possible_score ?? 100)
        };
    });
}

function getAreaIntroducedQuarter(area) {
    const quarter = Number(area?.introduced_quarter ?? 1);
    return getReportQuarterNumbers().includes(quarter) ? quarter : 1;
}

function getItemsAvailableForEvaluation(items, evaluation) {
    return items.filter(item => getAreaIntroducedQuarter(item) <= evaluation);
}

function getItemsIntroducedInEvaluation(items, evaluation) {
    return items.filter(item => getAreaIntroducedQuarter(item) === evaluation);
}

function toOrdinal(number) {
    return `${number}${number === 1 ? 'st' : number === 2 ? 'nd' : number === 3 ? 'rd' : 'th'}`;
}

async function downloadSectionReportCard(student) {
    const row = document.querySelector(`#sectionReportCardsModal .gradebook-table tbody tr[data-enrollment-id="${student.enrollment_details_id}"]`);
    if (row) updateGradebookRow(row);

    const invalidInput = row?.querySelector('.gradebook-score-input.is-invalid');
    if (invalidInput) {
        Swal.fire('Invalid score', 'Please fix this student\'s scores before downloading the report card.', 'warning');
        invalidInput.focus();
        return;
    }

    const formData = collectGradebookDownloadFormData(student, row);
    const quarters = createPrintableQuarters(student, formData);
    const cardTitle = getPrintableCardTitle(student.program_name || currentSectionDetails.program_name);
    const logoUrl = new URL('../../assist/logo.png', import.meta.url).href;
    const abcUrl = new URL('../../assist/abc.png', import.meta.url).href;
    const bookUrl = new URL('../../assist/book.png', import.meta.url).href;
    const usesEccdChecklist = true;

    Swal.fire({
        title: 'Preparing Download',
        text: 'Please wait...',
        allowOutsideClick: false,
        showConfirmButton: false,
        willOpen: () => Swal.showLoading()
    });

    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '-10000px';
    host.style.top = '0';
    host.style.width = '11in';
    host.style.height = '8.5in';
    host.style.background = '#ffffff';
    host.style.pointerEvents = 'none';
    host.style.zIndex = '-1';
    host.innerHTML = createSectionReportDownloadHtml(
        student,
        quarters,
        formData,
        cardTitle,
        { logoUrl, abcUrl, bookUrl },
        usesEccdChecklist
    );
    document.body.appendChild(host);

    try {
        await ensureReportCardPdfLibraries();
        await waitForReportCardImages(host);

        const sheet = host.querySelector('.section-report-download-sheet');
        const canvas = await window.html2canvas(sheet, {
            scale: 3,
            useCORS: true,
            backgroundColor: '#ffffff',
            width: sheet.offsetWidth,
            height: sheet.offsetHeight,
            windowWidth: sheet.scrollWidth,
            windowHeight: sheet.scrollHeight
        });
        const imageData = canvas.toDataURL('image/jpeg', 0.98);
        const jsPDF = window.jspdf?.jsPDF || window.jsPDF;

        if (!jsPDF) {
            throw new Error('PDF generator is not available.');
        }

        const pdf = new jsPDF({
            orientation: 'landscape',
            unit: 'in',
            format: 'letter',
            compress: true
        });
        pdf.addImage(imageData, 'JPEG', 0, 0, 11, 8.5);
        pdf.save(createSectionReportCardFilename(student, cardTitle));
        Swal.close();
    } catch (error) {
        console.error('Error downloading report card:', error);
        Swal.fire('Download Error', error.message || 'Unable to download the report card.', 'error');
    } finally {
        host.remove();
    }
}

function collectGradebookDownloadFormData(student, row) {
    const quarter = getStudentQuarter(student, currentQuarter) || {};
    const grades = row
        ? Array.from(row.querySelectorAll('.gradebook-score-input')).map(input => ({
            area_id: Number(input.dataset.areaId),
            grade_value: getTransmutedLetterFromRawScore(input.value.trim(), Number(input.dataset.perfectScore || 100))
        }))
        : currentLearningAreas.map(area => {
            const savedItem = getPrintableGradeItem(quarter, area);
            const rawScore = savedItem?.raw_score;
            return {
                area_id: area.area_id,
                grade_value: savedItem?.grade || (rawScore !== null && rawScore !== undefined && rawScore !== ''
                    ? getTransmutedLetterFromRawScore(rawScore, getAreaPerfectScore(area))
                    : '')
            };
        });

    return {
        grades,
        overall_grade: row?.querySelector('.remarks-cell')?.textContent.trim() || quarter.overall_grade || '',
        attendance: quarter.attendance ?? '',
        total_school_days: quarter.total_school_days ?? '',
        remarks: getQuarterDisplayRemarks(quarter)
    };
}

function getTransmutedLetterFromRawScore(rawScore, perfectScore) {
    if (rawScore === '' || rawScore === null || rawScore === undefined || !isNumeric(rawScore)) {
        return '';
    }

    const score = Number(rawScore);
    const maxScore = Math.max(1, Number(perfectScore) || 100);
    return getTransmutedLetter((score / maxScore) * 100);
}

function createSectionReportDownloadHtml(student, quarters, formData, cardTitle, assets, usesEccdChecklist) {
    return `
        <div class="section-report-download-sheet">
            ${createSectionReportDownloadStyles()}
            ${usesEccdChecklist
                ? createPrintablePlaySchoolChecklist(student, quarters, formData, assets.logoUrl)
                : `${createPrintableFrontPage(student, quarters, cardTitle, assets.logoUrl, assets.abcUrl, assets.bookUrl)}${createPrintableRemarksPage(quarters, assets.logoUrl)}`}
        </div>
    `;
}

function createSectionReportDownloadStyles() {
    return `
        <style>
            .section-report-download-sheet,
            .section-report-download-sheet * {
                box-sizing: border-box;
            }
            .section-report-download-sheet {
                width: 11in;
                height: 8.5in;
                background: #ffffff;
                color: #111111;
                font-family: Arial, Helvetica, sans-serif;
                font-size: 0;
            }
            .page,
            .play-page {
                display: inline-block;
                vertical-align: top;
                width: 5.5in;
                height: 8.5in;
                margin: 0;
                overflow: hidden;
                position: relative;
                background: #ffffff;
                font-size: 10px;
            }
            .page {
                padding: .28in .34in;
            }
            .front-header {
                display: grid;
                grid-template-columns: 48px 1fr 48px;
                align-items: center;
                gap: 10px;
                margin-bottom: 16px;
            }
            .school-logo {
                width: 44px;
                height: 44px;
                object-fit: contain;
            }
            .title-cloud {
                text-align: center;
                background: #ea9aa6;
                border-radius: 28px;
                padding: 8px 12px 6px;
                border: 2px solid #ea9aa6;
            }
            .title-cloud h1 {
                margin: 0;
                text-transform: uppercase;
                font-size: 20px;
                line-height: 1;
                font-weight: 900;
                letter-spacing: 0;
            }
            .title-cloud div {
                margin-top: 3px;
                font-size: 13px;
                text-transform: uppercase;
            }
            .abc-img {
                width: 46px;
                justify-self: end;
            }
            .info-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 9px 20px;
                margin-bottom: 16px;
                font-size: 10px;
            }
            .line-field {
                display: grid;
                grid-template-columns: auto 1fr;
                gap: 7px;
                align-items: end;
            }
            .line-field span:last-child {
                border-bottom: 1.5px solid #222;
                min-height: 14px;
                padding: 0 4px;
            }
            .section-report-download-sheet table {
                width: 100%;
                border-collapse: collapse;
                table-layout: fixed;
                background: #ffffff;
            }
            .section-report-download-sheet th,
            .section-report-download-sheet td {
                border: 1.5px solid #111111;
                padding: 5px 4px;
                text-align: center;
                font-size: 9.5px;
                line-height: 1.08;
                height: 28px;
            }
            .section-report-download-sheet th {
                background: #ea9aa6;
                font-weight: 900;
            }
            .learning-col {
                width: 42%;
                font-weight: 900;
            }
            .grade-col {
                width: 14.5%;
            }
            .summary-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 16px;
                margin-top: 16px;
                align-items: start;
            }
            .grading-title {
                background: #ea9aa6;
                border: 1.5px solid #111111;
                padding: 6px 4px;
                text-align: center;
                font-size: 11px;
                font-weight: 900;
                text-transform: uppercase;
                margin-bottom: 8px;
            }
            .grading-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 4px 10px;
                font-size: 9.5px;
                font-weight: 700;
            }
            .attendance-lines {
                font-size: 10px;
                padding-top: 30px;
            }
            .attendance-lines .line-field {
                margin-bottom: 10px;
            }
            .teacher-feedback {
                margin-top: 22px;
                font-size: 11px;
                font-weight: 900;
                text-transform: uppercase;
            }
            .feedback-lines {
                margin-top: 10px;
            }
            .feedback-line {
                border-bottom: 1px solid #111111;
                min-height: 18px;
                margin-bottom: 9px;
                font-weight: 400;
                text-transform: none;
                font-size: 10px;
            }
            .book-img {
                position: absolute;
                width: 64px;
                right: .32in;
                bottom: .28in;
            }
            .remarks-page {
                border: 2px solid #ea9aa6;
                padding: .36in .32in .22in;
            }
            .remarks-title {
                width: 78%;
                margin: 0 auto 30px;
                padding: 10px 14px;
                text-align: center;
                background: #ea9aa6;
                border-radius: 22px;
                font-size: 20px;
                letter-spacing: 1px;
                text-transform: uppercase;
            }
            .remarks-logo {
                position: absolute;
                left: .18in;
                top: .18in;
                width: 48px;
            }
            .remarks-pencil {
                display: none;
            }
            .remarks-pencil::after {
                content: "";
                position: absolute;
                left: 2px;
                bottom: -20px;
                width: 0;
                height: 0;
                border-left: 5px solid transparent;
                border-right: 5px solid transparent;
                border-top: 9px solid #111111;
            }
            .quarter-block {
                margin: 0 0 26px;
            }
            .quarter-label {
                font-size: 13px;
                font-weight: 900;
                text-transform: uppercase;
                margin-bottom: 12px;
            }
            .remark-writing-line {
                border-bottom: 1px solid #111111;
                min-height: 20px;
                margin-bottom: 10px;
                font-size: 10px;
                padding-bottom: 2px;
            }
            .play-page {
                padding: .25in .3in;
                background: #ffffff;
                color: #5d605d;
            }
            .play-logo {
                position: absolute;
                left: .3in;
                top: .22in;
                width: .46in;
                height: .46in;
                object-fit: contain;
                opacity: .62;
            }
            .play-title {
                text-align: center;
                text-transform: uppercase;
                font-size: 18px;
                line-height: 1.05;
                font-weight: 800;
                margin: .03in 0 .22in;
            }
            .play-info {
                width: 3.1in;
                margin: 0 0 .2in .52in;
                font-size: 11px;
                line-height: 1.25;
            }
            .play-line {
                display: inline-block;
                border-bottom: 1px solid #676a67;
                min-width: 1.36in;
                height: 14px;
                vertical-align: bottom;
                padding: 0 2px;
            }
            .play-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: .22in .34in;
            }
            .play-section h2 {
                color: #555855;
                font-size: 15.5px;
                line-height: 1.05;
                font-weight: 800;
                margin: 0 0 5px;
            }
            .play-check {
                display: grid;
                grid-template-columns: 14px 1fr;
                gap: 7px;
                align-items: start;
                font-size: 10.5px;
                line-height: 1.12;
                margin: 3px 0;
            }
            .play-box {
                width: 12px;
                height: 12px;
                border: 1px solid #747774;
                margin-top: 1px;
                position: relative;
            }
            .play-box.checked::after {
                content: "";
                position: absolute;
                left: 2px;
                top: -4px;
                width: 7px;
                height: 14px;
                border-right: 1px solid #747774;
                border-bottom: 1px solid #747774;
                transform: rotate(42deg);
            }
            .play-back-grid {
                display: grid;
                grid-template-columns: 2.12in 1fr;
                gap: .34in;
                padding-top: .32in;
            }
            .play-comments-title,
            .play-signature {
                color: #555855;
                font-size: 16px;
                font-weight: 800;
                margin-bottom: .18in;
            }
            .play-writing-line {
                border-bottom: 1px solid #676a67;
                height: .31in;
                font-size: 10.5px;
            }
            .play-progress {
                margin-top: .65in;
            }
            .play-signature {
                margin-top: 1.05in;
            }
        </style>
    `;
}

function createSectionReportCardFilename(student, cardTitle) {
    const studentSlug = String(student?.student_name || 'student')
        .trim()
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase() || 'student';
    const cardSlug = String(cardTitle || 'report_card')
        .trim()
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase() || 'report_card';
    return `${studentSlug}_${cardSlug}_q${currentQuarter}.pdf`;
}

function ensureReportCardPdfLibraries() {
    if (window.html2canvas && (window.jspdf?.jsPDF || window.jsPDF)) {
        return Promise.resolve();
    }

    return Promise.all([
        loadReportCardScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', 'html2canvas-loader'),
        loadReportCardScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'jspdf-loader')
    ]).then(() => {
        if (!window.html2canvas || !(window.jspdf?.jsPDF || window.jsPDF)) {
            throw new Error('PDF libraries did not load correctly.');
        }
    });
}

function loadReportCardScriptOnce(src, loaderId) {
    return new Promise((resolve, reject) => {
        const existingScript = document.querySelector(`script[data-loader-id="${loaderId}"]`);
        if (existingScript) {
            if (existingScript.dataset.loaded === 'true') {
                resolve();
                return;
            }

            existingScript.addEventListener('load', resolve, { once: true });
            existingScript.addEventListener('error', reject, { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.dataset.loaderId = loaderId;
        script.onload = () => {
            script.dataset.loaded = 'true';
            resolve();
        };
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

function waitForReportCardImages(container) {
    const images = Array.from(container?.querySelectorAll('img') || []);
    if (!images.length) return Promise.resolve();

    return Promise.all(images.map(image => {
        if (image.complete) return Promise.resolve();

        return new Promise(resolve => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
        });
    }));
}

function printReportCard(student, formData) {
    const quarters = createPrintableQuarters(student, formData);
    const cardTitle = getPrintableCardTitle(student.program_name || currentSectionDetails.program_name);
    const logoUrl = new URL('../../assist/logo.png', import.meta.url).href;
    const abcUrl = new URL('../../assist/abc.png', import.meta.url).href;
    const bookUrl = new URL('../../assist/book.png', import.meta.url).href;
    const usesEccdChecklist = true;

    const printWindow = window.open('', '_blank', 'width=900,height=1100');
    if (!printWindow) {
        Swal.fire('Popup blocked', 'Please allow popups so the report card can print.', 'warning');
        return;
    }

    printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>${escapeHtml(student.student_name || 'Report Card')}</title>
            <style>
                @page {
                    size: 8.5in 11in;
                    margin: 0;
                }
                * { box-sizing: border-box; }
                body {
                    margin: 0;
                    background: #f3f4f6;
                    color: #111;
                    font-family: Arial, Helvetica, sans-serif;
                    width: 8.5in;
                }
                .page {
                    width: 5.5in;
                    height: 8.5in;
                    margin: 0;
                    padding: .28in .34in;
                    background: #f7f7f7;
                    position: relative;
                    overflow: hidden;
                    page-break-after: always;
                }
                .front-header {
                    display: grid;
                    grid-template-columns: 58px 1fr 58px;
                    align-items: center;
                    gap: 10px;
                    margin-bottom: 16px;
                }
                .school-logo {
                    width: 48px;
                    height: 48px;
                    object-fit: contain;
                }
                .title-cloud {
                    text-align: center;
                    background: #ea9aa6;
                    border-radius: 34px;
                    padding: 10px 12px 8px;
                    border: 3px solid #ea9aa6;
                }
                .title-cloud h1 {
                    margin: 0;
                    text-transform: uppercase;
                    font-size: 23px;
                    line-height: 1;
                    font-weight: 900;
                    letter-spacing: 0;
                }
                .title-cloud div {
                    margin-top: 4px;
                    font-size: 15px;
                    text-transform: uppercase;
                }
                .abc-img {
                    width: 52px;
                    justify-self: end;
                }
                .info-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 10px 22px;
                    margin-bottom: 18px;
                    font-size: 11px;
                }
                .line-field {
                    display: grid;
                    grid-template-columns: auto 1fr;
                    gap: 7px;
                    align-items: end;
                }
                .line-field span:last-child {
                    border-bottom: 2px solid #222;
                    min-height: 15px;
                    padding: 0 4px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    table-layout: fixed;
                    background: #fff;
                }
                th, td {
                    border: 2px solid #111;
                    padding: 6px 5px;
                    text-align: center;
                    font-size: 10.5px;
                    line-height: 1.15;
                    height: 31px;
                }
                th {
                    background: #ea9aa6;
                    font-weight: 900;
                }
                .learning-col {
                    width: 42%;
                    font-weight: 900;
                }
                .grade-col {
                    width: 14.5%;
                }
                .summary-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 16px;
                    margin-top: 18px;
                    align-items: start;
                }
                .grading-title {
                    background: #ea9aa6;
                    border: 2px solid #111;
                    padding: 7px 5px;
                    text-align: center;
                    font-size: 12px;
                    font-weight: 900;
                    text-transform: uppercase;
                    margin-bottom: 10px;
                }
                .grading-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 5px 10px;
                    font-size: 10.5px;
                    font-weight: 700;
                }
                .attendance-lines {
                    font-size: 11px;
                    padding-top: 31px;
                }
                .attendance-lines .line-field {
                    margin-bottom: 10px;
                }
                .teacher-feedback {
                    margin-top: 22px;
                    font-size: 12px;
                    font-weight: 900;
                    text-transform: uppercase;
                }
                .feedback-lines {
                    margin-top: 10px;
                }
                .feedback-line {
                    border-bottom: 2px solid #111;
                    min-height: 19px;
                    margin-bottom: 10px;
                    font-weight: 400;
                    text-transform: none;
                    font-size: 10.5px;
                }
                .book-img {
                    position: absolute;
                    width: 72px;
                    right: .3in;
                    bottom: .26in;
                }
                .remarks-page {
                    border: 3px solid #ea9aa6;
                    padding: .38in .36in .28in;
                }
                .remarks-title {
                    width: 72%;
                    margin: 0 auto 36px;
                    padding: 12px 16px;
                    text-align: center;
                    background: #ea9aa6;
                    border-radius: 22px;
                    font-size: 23px;
                    font-weight: 500;
                    letter-spacing: 1px;
                    text-transform: uppercase;
                }
                .remarks-logo {
                    position: absolute;
                    left: .18in;
                    top: .18in;
                    width: 52px;
                }
                .remarks-pencil {
                    position: absolute;
                    right: .42in;
                    top: .28in;
                    width: 15px;
                    height: 72px;
                    background: #243d68;
                    border-radius: 4px;
                    transform: rotate(34deg);
                    transform-origin: center;
                    border-top: 10px solid #f3a9ad;
                    border-bottom: 14px solid #e8d3a3;
                }
                .remarks-pencil::after {
                    content: "";
                    position: absolute;
                    left: 2px;
                    bottom: -20px;
                    width: 0;
                    height: 0;
                    border-left: 5px solid transparent;
                    border-right: 5px solid transparent;
                    border-top: 9px solid #111;
                }
                .quarter-block {
                    margin: 0 0 28px;
                }
                .quarter-label {
                    font-size: 14px;
                    font-weight: 900;
                    text-transform: uppercase;
                    margin-bottom: 14px;
                }
                .remark-writing-line {
                    border-bottom: 2px solid #111;
                    min-height: 22px;
                    margin-bottom: 12px;
                    font-size: 11px;
                    padding-bottom: 2px;
                }
                @media print {
                    body { background: #fff; }
                    .page {
                        margin: 0;
                        width: 5.5in;
                        height: 8.5in;
                        break-after: page;
                    }
                }
                .play-page {
                    width: 8.5in;
                    height: 11in;
                    padding: .62in .72in;
                    background: #f4f5ef;
                    color: #5d605d;
                    font-family: Arial, Helvetica, sans-serif;
                    page-break-after: always;
                    position: relative;
                    overflow: hidden;
                }
                .play-logo {
                    position: absolute;
                    left: .72in;
                    top: .48in;
                    width: .62in;
                    height: .62in;
                    object-fit: contain;
                    opacity: .62;
                }
                .play-title {
                    text-align: center;
                    text-transform: uppercase;
                    font-size: 21px;
                    line-height: 1.05;
                    font-weight: 800;
                    letter-spacing: 0;
                    margin: .48in 0 .26in;
                }
                .play-info {
                    width: 3.7in;
                    margin: 0 0 .32in .82in;
                    font-size: 16px;
                    line-height: 1.35;
                }
                .play-line {
                    display: inline-block;
                    border-bottom: 1.5px solid #676a67;
                    min-width: 1.72in;
                    height: 18px;
                    vertical-align: bottom;
                    padding: 0 4px;
                }
                .play-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: .28in .58in;
                }
                .play-section h2 {
                    color: #555855;
                    font-size: 21px;
                    line-height: 1.05;
                    font-weight: 800;
                    margin: 0 0 5px;
                    letter-spacing: 0;
                }
                .play-check {
                    display: grid;
                    grid-template-columns: 18px 1fr;
                    gap: 8px;
                    align-items: start;
                    font-size: 18px;
                    line-height: 1.12;
                    margin: 3px 0;
                }
                .play-box {
                    width: 15px;
                    height: 15px;
                    border: 1.5px solid #747774;
                    margin-top: 2px;
                    position: relative;
                }
                .play-box.checked::after {
                    content: "";
                    position: absolute;
                    left: 2px;
                    top: -4px;
                    width: 9px;
                    height: 17px;
                    border-right: 2px solid #747774;
                    border-bottom: 2px solid #747774;
                    transform: rotate(42deg);
                }
                .play-back-grid {
                    display: grid;
                    grid-template-columns: 3.55in 1fr;
                    gap: .62in;
                    padding-top: .9in;
                }
                .play-comments-title,
                .play-signature {
                    color: #555855;
                    font-size: 22px;
                    font-weight: 800;
                    margin-bottom: .22in;
                    letter-spacing: 0;
                }
                .play-writing-line {
                    border-bottom: 1.5px solid #676a67;
                    height: .28in;
                }
                .play-progress {
                    margin-top: .72in;
                }
                .play-signature {
                    margin-top: 1.34in;
                }
                @media print {
                    .play-page {
                        width: 8.5in;
                        height: 11in;
                        break-after: page;
                    }
                }
                body {
                    font-size: 0;
                }
                .page,
                .play-page {
                    display: inline-block;
                    vertical-align: top;
                    width: 4.25in !important;
                    height: 5.5in !important;
                    margin: 0 !important;
                    page-break-after: auto !important;
                    break-after: auto !important;
                    font-size: 10px;
                }
                .page {
                    padding: .12in .18in;
                }
                .front-header {
                    grid-template-columns: 30px 1fr 30px;
                    gap: 4px;
                    margin-bottom: 6px;
                }
                .school-logo {
                    width: 27px;
                    height: 27px;
                }
                .title-cloud {
                    border-radius: 18px;
                    padding: 4px 8px 3px;
                    border-width: 1.5px;
                }
                .title-cloud h1 {
                    font-size: 13px;
                }
                .title-cloud div {
                    font-size: 8px;
                    margin-top: 1px;
                }
                .abc-img {
                    width: 29px;
                }
                .info-grid {
                    gap: 4px 10px;
                    margin-bottom: 7px;
                    font-size: 6.5px;
                }
                .line-field {
                    gap: 4px;
                }
                .line-field span:last-child {
                    border-bottom-width: 1px;
                    min-height: 8px;
                    padding: 0 2px;
                }
                th,
                td {
                    border-width: 1px;
                    padding: 2px;
                    font-size: 6.4px;
                    height: 15px;
                    line-height: 1.08;
                }
                .summary-grid {
                    gap: 8px;
                    margin-top: 8px;
                }
                .grading-title {
                    border-width: 1px;
                    padding: 3px 2px;
                    font-size: 7px;
                    margin-bottom: 4px;
                }
                .grading-grid {
                    gap: 2px 7px;
                    font-size: 6.4px;
                }
                .attendance-lines {
                    font-size: 6.5px;
                    padding-top: 16px;
                }
                .attendance-lines .line-field {
                    margin-bottom: 5px;
                }
                .teacher-feedback {
                    margin-top: 10px;
                    font-size: 7px;
                }
                .feedback-lines {
                    margin-top: 5px;
                }
                .feedback-line {
                    border-bottom-width: 1px;
                    min-height: 10px;
                    margin-bottom: 5px;
                    font-size: 6.5px;
                }
                .book-img {
                    width: 31px;
                    right: .2in;
                    bottom: .18in;
                }
                .remarks-page {
                    border-width: 2px;
                    padding: .18in .18in .14in;
                }
                .remarks-title {
                    width: 78%;
                    margin-bottom: 14px;
                    padding: 5px 8px;
                    border-radius: 14px;
                    font-size: 13px;
                    letter-spacing: 0;
                }
                .remarks-logo {
                    left: .12in;
                    top: .12in;
                    width: 29px;
                }
                .remarks-pencil {
                    right: .2in;
                    top: .16in;
                    width: 8px;
                    height: 36px;
                    border-radius: 2px;
                    border-top-width: 5px;
                    border-bottom-width: 7px;
                }
                .remarks-pencil::after {
                    left: 1px;
                    bottom: -10px;
                    border-left-width: 3px;
                    border-right-width: 3px;
                    border-top-width: 5px;
                }
                .quarter-block {
                    margin-bottom: 12px;
                }
                .quarter-label {
                    font-size: 8px;
                    margin-bottom: 6px;
                }
                .remark-writing-line {
                    border-bottom-width: 1px;
                    min-height: 12px;
                    margin-bottom: 6px;
                    font-size: 6.8px;
                }
                .play-page {
                    padding: .16in .18in;
                    background: #f8f8f4;
                }
                .play-logo {
                    left: .18in;
                    top: .12in;
                    width: .38in;
                    height: .38in;
                }
                .play-title {
                    font-size: 13px;
                    margin: .08in 0 .12in;
                }
                .play-info {
                    width: 2.18in;
                    margin: 0 0 .13in .34in;
                    font-size: 8px;
                    line-height: 1.22;
                }
                .play-line {
                    min-width: .98in;
                    height: 10px;
                    border-bottom-width: 1px;
                    padding: 0 2px;
                }
                .play-grid {
                    grid-template-columns: 1fr 1fr;
                    gap: .14in .24in;
                }
                .play-section h2 {
                    font-size: 11.4px;
                    margin-bottom: 3px;
                }
                .play-check {
                    grid-template-columns: 11px 1fr;
                    gap: 5px;
                    font-size: 8px;
                    line-height: 1.12;
                    margin: 2px 0;
                }
                .play-box {
                    width: 9px;
                    height: 9px;
                    border-width: 1px;
                    margin-top: 1px;
                }
                .play-box.checked::after {
                    left: 1px;
                    top: -3px;
                    width: 6px;
                    height: 11px;
                    border-right-width: 1px;
                    border-bottom-width: 1px;
                }
                .play-back-grid {
                    grid-template-columns: 1.72in 1fr;
                    gap: .24in;
                    padding-top: .24in;
                }
                .play-comments-title,
                .play-signature {
                    font-size: 11.5px;
                    margin-bottom: .11in;
                }
                .play-writing-line {
                    border-bottom-width: 1px;
                    height: .2in;
                    font-size: 8px;
                }
                .play-progress {
                    margin-top: .42in;
                }
                .play-signature {
                    margin-top: .7in;
                }
                @media print {
                    body {
                        width: 8.5in;
                        height: 11in;
                        background: #fff;
                    }
                }
            </style>
        </head>
        <body>
            ${usesEccdChecklist
                ? createPrintablePlaySchoolChecklist(student, quarters, formData, logoUrl)
                : `${createPrintableFrontPage(student, quarters, cardTitle, logoUrl, abcUrl, bookUrl)}${createPrintableRemarksPage(quarters, logoUrl)}`}
            <script>
                window.addEventListener('load', function() {
                    window.focus();
                    window.print();
                });
            <\/script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

function createPrintableQuarters(student, formData) {
    const quarters = {};

    for (const quarter of getReportQuarterNumbers()) {
        const existing = getStudentQuarter(student, quarter);
        quarters[String(quarter)] = existing ? { ...existing, grades: [...(existing.grades || [])] } : {
            grades: [],
            overall_grade: '',
            attendance: '',
            total_school_days: '',
            remarks: ''
        };
    }

    quarters[String(currentQuarter)] = {
        ...quarters[String(currentQuarter)],
        grades: currentLearningAreas.map(area => {
            const grade = (formData.grades || []).find(item => String(item.area_id) === String(area.area_id));
            return {
                area_id: area.area_id,
                label: area.label,
                grade: grade?.grade_value || ''
            };
        }),
        overall_grade: formData.overall_grade || '',
        attendance: formData.attendance || '',
        total_school_days: formData.total_school_days || '',
        remarks: formData.remarks || ''
    };

    return quarters;
}

function createPrintableFrontPage(student, quarters, cardTitle, logoUrl, abcUrl, bookUrl) {
    const current = quarters[String(currentQuarter)] || {};
    return `
        <section class="page">
            <div class="front-header">
                <img class="school-logo" src="${logoUrl}" alt="">
                <div class="title-cloud">
                    <h1>${escapeHtml(cardTitle)}</h1>
                    <div>Report Card</div>
                </div>
                <img class="abc-img" src="${abcUrl}" alt="">
            </div>

            <div class="info-grid">
                <div class="line-field"><span>Student:</span><span>${escapeHtml(student.student_name || '')}</span></div>
                <div class="line-field"><span>Section:</span><span>${escapeHtml(currentSectionDetails.section_name || '')}</span></div>
                <div class="line-field"><span>Class Adviser:</span><span>${escapeHtml(currentSectionDetails.teacher_name || '')}</span></div>
                <div class="line-field"><span>School Year:</span><span>${escapeHtml(student.school_year || '')}</span></div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th class="learning-col">Learning</th>
                        ${getReportQuarterLabels(true).map(label => `<th class="grade-col">${escapeHtml(label)}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${currentLearningAreas.map(area => `
                        <tr>
                            <td class="learning-col">${escapeHtml(area.label)}</td>
                            ${getReportQuarterNumbers().map(quarter => `<td>${escapeHtml(getPrintableGrade(quarters[String(quarter)], area))}</td>`).join('')}
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="summary-grid">
                <div>
                    <div class="grading-title">Grading System</div>
                    <div class="grading-grid">
                        <div>A+ Excellent</div>
                        <div>B-Very Good</div>
                        <div>A-Outstanding</div>
                        <div>C-Good</div>
                        <div>D-Satisfaction</div>
                        <div>F- Fair</div>
                    </div>
                </div>
                <div class="attendance-lines">
                    <div class="line-field"><span>Total School Day:</span><span>${escapeHtml(current.total_school_days || '')}</span></div>
                    <div class="line-field"><span>Attendance:</span><span>${escapeHtml(current.attendance || '')}</span></div>
                </div>
            </div>

            <div class="teacher-feedback">
                Teachers Feedback
                <div class="feedback-lines">
                    <div class="feedback-line">${escapeHtml(getQuarterDisplayRemarks(current))}</div>
                    <div class="feedback-line"></div>
                    <div class="feedback-line"></div>
                </div>
            </div>
            <img class="book-img" src="${bookUrl}" alt="">
        </section>
    `;
}

function createPrintableRemarksPage(quarters, logoUrl) {
    return `
        <section class="page remarks-page">
            <img class="remarks-logo" src="${logoUrl}" alt="">
            <div class="remarks-pencil"></div>
            <div class="remarks-title">Feedback & Remarks</div>
            ${getReportQuarterNumbers().map(quarter => `
                <div class="quarter-block">
                    <div class="quarter-label">${escapeHtml(getReportQuarterLabel(quarter))}</div>
                    <div class="remark-writing-line">${escapeHtml(getQuarterDisplayRemarks(quarters[String(quarter)]))}</div>
                    <div class="remark-writing-line"></div>
                    <div class="remark-writing-line"></div>
                </div>
            `).join('')}
        </section>
    `;
}

function getPrintableGrade(quarterData, area) {
    return (quarterData?.grades || []).find(item => {
        if (item.area_id) return String(item.area_id) === String(area.area_id);
        return item.label === area.label;
    })?.grade || '';
}

function createPrintablePlaySchoolChecklist(student, quarters, formData, logoUrl) {
    const current = quarters[String(currentQuarter)] || {};
    const groups = createPlaySchoolPrintableGroups(current);
    const firstPageGroups = groups.slice(0, 6);
    const secondPageGroups = groups.slice(6);
    const progress = getPlaySchoolProgressLabel(formData.overall_grade || current.overall_grade || '');

    return `
        <section class="play-page">
            <img class="play-logo" src="${logoUrl}" alt="">
            <div class="play-title">ECCD Child's Record 2<br>Checklist</div>
            <div class="play-info">
                <div>Child Name: <span class="play-line">${escapeHtml(student.student_name || '')}</span></div>
                <div>Age: <span class="play-line"></span></div>
                <div>Observation Period: <span class="play-line">${escapeHtml(getReportQuarterLabel(currentQuarter))}</span></div>
                <div>Teacher: <span class="play-line">${escapeHtml(currentSectionDetails.teacher_name || '')}</span></div>
            </div>
            <div class="play-grid">
                ${firstPageGroups.map(createPrintablePlayGroup).join('')}
            </div>
        </section>
        <section class="play-page">
            <div class="play-back-grid">
                <div>
                    ${secondPageGroups.map(createPrintablePlayGroup).join('')}
                    <div class="play-progress play-section">
                        <h2>Overall Progress</h2>
                        ${['Very Good', 'Good', 'Developing'].map(label => `
                            <div class="play-check">
                                <span class="play-box ${progress === label ? 'checked' : ''}"></span>
                                <span>${escapeHtml(label)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div>
                    <div class="play-comments-title">Teacher's Comments:</div>
                    ${createCommentLines(getQuarterDisplayRemarks(current), 8)}
                    <div class="play-signature">Teacher's Signature:<span class="play-line" style="min-width:.95in;"></span></div>
                    <div class="play-signature" style="margin-top:.7in;">Date:<span class="play-line" style="min-width:.95in;"></span></div>
                </div>
            </div>
        </section>
    `;
}

function createPlaySchoolPrintableGroups(quarterData, { onlyItemsIntroducedThisQuarter = false } = {}) {
    const groups = new Map();

    const selectedQuarter = Number(quarterData?.quarter || currentQuarter || 1);

    currentLearningAreas
        .filter(area => onlyItemsIntroducedThisQuarter
            ? getAreaIntroducedQuarter(area) === selectedQuarter
            : getAreaIntroducedQuarter(area) <= selectedQuarter)
        .forEach(area => {
            const rawLabel = String(area.label || '').trim();
            if (!rawLabel) return;

            const parts = rawLabel.split(':');
            const title = String(area.domain_label || '').trim() || (parts.length > 1 ? parts.shift().trim() : 'Observation Checklist');
            const item = String(area.domain_label || '').trim()
                ? rawLabel
                : (parts.join(':').trim() || rawLabel);

            if (!groups.has(title)) groups.set(title, []);
            groups.get(title).push({
                label: item,
                checked: isPlayChecklistChecked(getPrintableGrade(quarterData, area))
            });
        });

    return Array.from(groups, ([title, items]) => ({ title, items }));
}

function createPrintablePlayGroup(group) {
    return `
        <div class="play-section">
            <h2>${escapeHtml(group.title)}</h2>
            ${group.items.map(item => `
                <div class="play-check">
                    <span class="play-box ${item.checked ? 'checked' : ''}"></span>
                    <span>${escapeHtml(item.label)}</span>
                </div>
            `).join('')}
        </div>
    `;
}

function isPlayChecklistChecked(grade) {
    return ['A+', 'A', 'B', 'C'].includes(String(grade || '').toUpperCase());
}

function getPlaySchoolProgressLabel(grade) {
    return playSchoolProgressLabels.find(item => item.grade === String(grade || '').toUpperCase())?.label || 'Good';
}

function createCommentLines(comment, count) {
    const words = String(comment || '').trim().split(/\s+/).filter(Boolean);
    const lines = [];
    const wordsPerLine = 7;

    for (let index = 0; index < count; index++) {
        lines.push(words.slice(index * wordsPerLine, (index + 1) * wordsPerLine).join(' '));
    }

    return lines.map(line => `<div class="play-writing-line">${escapeHtml(line)}</div>`).join('');
}

function getPrintableCardTitle(programName) {
    return 'ECCD Checklist';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
