import {
    createPlaySchoolChecklistPreview,
    createPlaySchoolTransmutationTable,
    getPlaySchoolStandardScoreRows,
    getPlaySchoolStandardScoreRowsFromEditor,
    getPlaySchoolInterpretationsFromEditor,
    getPlaySchoolTransmutationRowsFromEditor,
    getPlaySchoolTransmutationTables,
    normalizePlaySchoolDomainKey,
    normalizePlaySchoolDomains,
    normalizePlaySchoolStandardScoreRows,
    normalizePlaySchoolInterpretations,
    PLAY_SCHOOL_SCALED_SCORE_INTERPRETATIONS,
    PLAY_SCHOOL_STANDARD_SCORE_INTERPRETATIONS,
    normalizePlaySchoolTransmutationTables,
    validatePlaySchoolStandardScoreRows,
    validatePlaySchoolInterpretations,
    validatePlaySchoolTransmutationRows
} from './card_mangplay.js';
import { canUseProgramPermission, guardProgramPermission, initProgramPermissions } from './program_rbac.js';
import { getApiErrorMessage, isHostedBrowserChallenge, normalizeApiResponse } from '../utilities/api_response.js?v=20260812-hosted-json5';
import {
    getQuarterLabel,
    getQuarterNumbers,
    getQuarterPeriods,
    normalizeSchoolYearContext
} from '../utilities/school_year_context.js';

const LEARNING_AREA_API_URL = '../../api/admin/learning_area.php';
const CARD_MANAGEMENT_SETUP_URL = '../../api/admin/card_management_setup.php';

const CARD_CATEGORIES = [
    { key: 'play_school', label: 'ECCD Checklist' }
];

const DEFAULT_TRANSMUTATION_ROWS = [
    { min_percentage: 95, max_percentage: 100, transmuted_letter: 'A+' },
    { min_percentage: 90, max_percentage: 94.99, transmuted_letter: 'A' },
    { min_percentage: 85, max_percentage: 89.99, transmuted_letter: 'B' },
    { min_percentage: 80, max_percentage: 84.99, transmuted_letter: 'C' },
    { min_percentage: 75, max_percentage: 79.99, transmuted_letter: 'D' },
    { min_percentage: 0, max_percentage: 74.99, transmuted_letter: 'F' }
];

let learningAreas = [];
let transmutationRows = [];
let playSchoolTransmutationTables = [];
let playSchoolStandardScoreRows = [];
let playSchoolInterpretations = { scaled: [], standard: [] };
let activeCategory = 'play_school';
let pendingDeleteIds = [];
let pendingTransmutationDeleteIds = [];
let pendingPlaySchoolTransmutationArchiveIds = [];
let pendingPlaySchoolStandardArchiveIds = [];
let pendingPlaySchoolInterpretationArchiveIds = [];
let isSavingCardManagement = false;
let expandedPlaySchoolQuarterKeys = new Set();
let activeSchoolYearContext = normalizeSchoolYearContext(null);

function getCardQuarterPeriods() {
    return getQuarterPeriods(activeSchoolYearContext);
}

function getCardQuarterNumbers() {
    return getQuarterNumbers(activeSchoolYearContext);
}

function getCardQuarterLabel(quarter) {
    return getQuarterLabel(activeSchoolYearContext, quarter);
}

function getDefaultPlaySchoolInterpretations() {
    return {
        scaled: normalizePlaySchoolInterpretations(undefined, PLAY_SCHOOL_SCALED_SCORE_INTERPRETATIONS),
        standard: normalizePlaySchoolInterpretations(undefined, PLAY_SCHOOL_STANDARD_SCORE_INTERPRETATIONS)
    };
}

export async function initCardManagementPage() {
    if (!document.getElementById('report_card_table_body')) return;
    if (!canUseProgramPermission('view_checklists')) return;
    await loadLearningAreas();
    bindCardManagementEvents();
}

export async function initCardManagementEditorPage() {
    const root = document.getElementById('cardManagementPageRoot');
    if (!root) return;

    await initProgramPermissions();

    if (!guardProgramPermission('edit_checklists', 'You do not have permission to edit the ECCD checklist.')) {
        root.innerHTML = '<div class="alert alert-warning shadow-sm">You do not currently have permission to manage the ECCD checklist.</div>';
        return;
    }

    root.innerHTML = '<div class="text-center text-muted py-5">Loading report card editor...</div>';
    await loadLearningAreas({ renderList: false });

    const params = new URLSearchParams(window.location.search);
    const requestedCategory = params.get('category');
    const categoryKey = CARD_CATEGORIES.some(category => category.key === requestedCategory)
        ? requestedCategory
        : 'play_school';

    bindCardManagementEvents();
    renderCardManagementPage(categoryKey);
}

async function loadLearningAreas(options = {}) {
    const { renderList = true } = options;
    const tbody = document.getElementById('report_card_table_body');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Loading report cards...</td></tr>';
    }

    try {
        let data;
        try {
            const response = await requestLearningAreaOperation('getCardManagementSetup');
            data = normalizeApiResponse(response.data);
        } catch (setupError) {
            // A deployment may briefly have the updated JavaScript before the
            // new read-only PHP endpoint. Continue through the established
            // learning_area.php compatibility route in that case.
            console.warn('Combined card setup endpoint unavailable; using compatibility API.', setupError);
            data = normalizeApiResponse(setupError?.response?.data);
        }

        if (data?.status === 'success') {
            applyCardManagementSetup(data);
        } else if (Array.isArray(data)) {
            applyLegacyCardManagementSetup(data);
        } else {
            // A cached/older hosted PHP endpoint may not implement the combined
            // setup operation yet, or its automatic schema preparation may be
            // blocked. Its read-only individual operation is compatible.
            await loadLegacyCardManagementSetup(data);
        }

        if (!activeSchoolYearContext.school_year_id) {
            await loadActiveSchoolYearContext();
        }

        pendingPlaySchoolTransmutationArchiveIds = [];
        pendingPlaySchoolStandardArchiveIds = [];
        pendingPlaySchoolInterpretationArchiveIds = [];

        if (renderList) renderReportCardTypes();
    } catch (error) {
        console.error('Error loading learning areas:', error);
        if (tbody) {
            const message = getApiErrorMessage(error, 'Unable to load report card setup.');
            tbody.innerHTML = `<tr><td colspan="3" class="text-center text-danger">${escapeHtml(message)}</td></tr>`;
        }
    }
}

async function loadActiveSchoolYearContext() {
    try {
        const response = await axios.get('../../api/admin/school_year.php', {
            params: { operation: 'getSchoolYears', _request_time: Date.now() }
        });
        const rows = Array.isArray(response.data) ? response.data : [];
        const active = rows.find(row => row.sy_status === 'active') || rows[0];
        if (active) activeSchoolYearContext = normalizeSchoolYearContext(active);
    } catch (error) {
        console.warn('Unable to load the active school-year quarter map.', error);
    }
}

async function requestLearningAreaOperation(operation) {
    const isCombinedSetup = operation === 'getCardManagementSetup';
    return axios.get(isCombinedSetup ? CARD_MANAGEMENT_SETUP_URL : LEARNING_AREA_API_URL, {
        params: isCombinedSetup
            ? { _request_time: Date.now() }
            : { operation, _request_time: Date.now() },
        headers: {
            Accept: 'application/json'
        },
        responseType: 'text'
    });
}

function applyCardManagementSetup(data) {
    activeSchoolYearContext = normalizeSchoolYearContext(data.school_year);
    learningAreas = normalizeLearningAreas(data.learning_areas);
    transmutationRows = normalizeTransmutationRows(data.transmutation);
    playSchoolTransmutationTables = normalizePlaySchoolTransmutationTables(data.play_school_transmutation);
    playSchoolStandardScoreRows = normalizePlaySchoolStandardScoreRows(data.play_school_standard_scores);
    playSchoolInterpretations = {
        scaled: normalizePlaySchoolInterpretations(data.play_school_interpretations?.scaled, PLAY_SCHOOL_SCALED_SCORE_INTERPRETATIONS),
        standard: normalizePlaySchoolInterpretations(data.play_school_interpretations?.standard, PLAY_SCHOOL_STANDARD_SCORE_INTERPRETATIONS)
    };
}

function applyLegacyCardManagementSetup(areas, optionalData = {}) {
    learningAreas = normalizeLearningAreas(areas);
    transmutationRows = normalizeTransmutationRows(optionalData.transmutation || DEFAULT_TRANSMUTATION_ROWS);
    playSchoolTransmutationTables = normalizePlaySchoolTransmutationTables(
        optionalData.playSchoolTransmutation || getPlaySchoolTransmutationTables()
    );
    playSchoolStandardScoreRows = normalizePlaySchoolStandardScoreRows(
        optionalData.playSchoolStandardScores || getPlaySchoolStandardScoreRows()
    );
    playSchoolInterpretations = getDefaultPlaySchoolInterpretations();
}

async function loadLegacyCardManagementSetup(originalPayload) {
    if (isHostedBrowserChallenge(originalPayload)) {
        throw new Error('InfinityFree browser verification blocked the request. Refresh this page once, then try again.');
    }

    const areasResponse = await requestLearningAreaOperation('getAllLearningAreas');
    const areas = normalizeApiResponse(areasResponse.data);
    if (isHostedBrowserChallenge(areas)) {
        throw new Error('InfinityFree browser verification blocked the request. Refresh this page once, then try again.');
    }
    if (!Array.isArray(areas)) {
        const message = areas?.message || areas?.error || originalPayload?.message || originalPayload?.error;
        throw new Error(message || 'The hosted learning-area API returned an empty, HTML, or unsupported response.');
    }

    const optionalData = {};
    const operations = [
        ['getAllTransmutationRows', 'transmutation'],
        ['getAllPlaySchoolTransmutationRows', 'playSchoolTransmutation'],
        ['getAllPlaySchoolStandardScoreRows', 'playSchoolStandardScores']
    ];

    await Promise.all(operations.map(async ([operation, key]) => {
        try {
            const response = await requestLearningAreaOperation(operation);
            const value = normalizeApiResponse(response.data);
            if (Array.isArray(value)) optionalData[key] = value;
        } catch (error) {
            console.warn(`Unable to load optional card setup operation ${operation}:`, error);
        }
    }));

    applyLegacyCardManagementSetup(areas, optionalData);
}

function bindCardManagementEvents() {
    document.getElementById('btnAddReportCardType')?.addEventListener('click', () => {
        openCardManagementEditor('play_school');
    });

    window.openCardManagementEditor = openCardManagementEditor;
    window.openCardManagerModal = openCardManagerModal;
}

function openCardManagementEditor(categoryKey) {
    if (!guardProgramPermission('edit_checklists', 'You do not have permission to edit the ECCD checklist.')) {
        return;
    }

    if (window.location.pathname.includes('/owner/')) {
        window.location.href = `card_management.html?category=${encodeURIComponent(categoryKey)}`;
        return;
    }

    openCardManagerModal(categoryKey);
}

function renderReportCardTypes() {
    const tbody = document.getElementById('report_card_table_body');
    if (!tbody) return;

    tbody.innerHTML = CARD_CATEGORIES.map(category => {
        const enabledCount = getAreasByCategory(category.key).filter(area => Number(area.is_active) === 1).length;
        return `
            <tr>
                <td class="fw-bold">${escapeHtml(category.label)}</td>
                <td>
                    <span class="badge bg-info text-dark me-1">${enabledCount} active</span>
                    <span class="badge bg-light text-dark border me-1">${getCardQuarterPeriods().length} quarter${getCardQuarterPeriods().length === 1 ? '' : 's'}</span>
                    ${activeSchoolYearContext.school_year ? `<span class="badge bg-success-subtle text-success-emphasis">${escapeHtml(activeSchoolYearContext.school_year)}</span>` : ''}
                </td>
                <td class="text-center">
                    <div class="d-inline-flex gap-2 flex-wrap justify-content-center">
                        ${canUseProgramPermission('edit_checklists')
                            ? `<button type="button" class="btn btn-sm btn-outline-primary" data-card-category="${category.key}">
                                <i class="bi bi-pencil-square me-1"></i>Edit Card
                            </button>`
                            : '<span class="text-muted">-</span>'
                        }
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('[data-card-category]').forEach(button => {
        button.addEventListener('click', () => openCardManagementEditor(button.dataset.cardCategory));
    });
}

function createAreaBadge(area, showScoring) {
    const weight = getAreaWeight(area);
    const perfect = getAreaPerfectScore(area);
    const scoringText = showScoring && weight > 0
        ? ` <span class="text-muted">(${formatPercent(weight)}%, ${formatScore(perfect)} pts)</span>`
        : '';

    return `<span class="badge bg-light text-dark border me-1 mb-1">${escapeHtml(area.area_name)}${scoringText}</span>`;
}

function openCardManagerModal(categoryKey) {
    if (!guardProgramPermission('edit_checklists', 'You do not have permission to edit the ECCD checklist.')) {
        return;
    }

    activeCategory = categoryKey;
    pendingDeleteIds = [];
    pendingTransmutationDeleteIds = [];
    pendingPlaySchoolTransmutationArchiveIds = [];
    pendingPlaySchoolStandardArchiveIds = [];
    pendingPlaySchoolInterpretationArchiveIds = [];

    const category = CARD_CATEGORIES.find(item => item.key === categoryKey) || CARD_CATEGORIES[0];
    const existing = document.getElementById('cardManagementModal');
    if (existing) existing.remove();
    const transmutationHelp = categoryKey === 'play_school'
        ? 'Raw score ranges are converted to scaled scores by age group.'
        : 'Percentage ranges are used to convert computed averages to letter remarks.';
    const transmutationActions = categoryKey === 'play_school'
        ? `
            <button type="button" class="btn btn-sm btn-outline-secondary" id="btnResetPlayTransmutation">
                <i class="bi bi-arrow-counterclockwise me-1"></i>Reset
            </button>
        `
        : `
            <div class="d-flex gap-2">
                <button type="button" class="btn btn-sm btn-outline-secondary" id="btnResetTransmutation">
                    <i class="bi bi-arrow-counterclockwise me-1"></i>Reset
                </button>
                <button type="button" class="btn btn-sm btn-outline-primary" id="btnAddTransmutationRow">
                    <i class="bi bi-plus-lg me-1"></i>Add Range
                </button>
            </div>
        `;

    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="cardManagementModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <div>
                            <h5 class="modal-title">${escapeHtml(category.label)}</h5>
                            <div class="text-muted small">${escapeHtml(activeSchoolYearContext.school_year || 'Active school year')} curriculum &bull; ${getCardQuarterPeriods().length} quarter${getCardQuarterPeriods().length === 1 ? '' : 's'}</div>
                        </div>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <ul class="nav nav-tabs mb-3" role="tablist">
                            <li class="nav-item" role="presentation">
                                <button class="nav-link active" id="card-fields-tab" data-bs-toggle="tab" data-bs-target="#cardFieldsPane" type="button" role="tab">
                                    Fields
                                </button>
                            </li>
                            <li class="nav-item" role="presentation">
                                <button class="nav-link" id="card-transmutation-tab" data-bs-toggle="tab" data-bs-target="#cardTransmutationPane" type="button" role="tab">
                                    Transmutation
                                </button>
                            </li>
                        </ul>
                        <div class="tab-content">
                            <div class="tab-pane fade show active" id="cardFieldsPane" role="tabpanel" aria-labelledby="card-fields-tab">
                                <div class="row g-4">
                                    <div class="col-lg-5">
                                        <div class="d-flex justify-content-between align-items-center mb-2">
                                            <div>
                                                <h6 class="fw-bold mb-0">${categoryKey === 'play_school' ? 'Learning Areas' : 'Grade Fields'}</h6>
                                                <div id="gradeWeightSummary" class="small mt-1"></div>
                                            </div>
                                            <div class="d-flex gap-2">
                                                ${categoryKey === 'play_school' ? `
                                                    <button type="button" class="btn btn-sm btn-outline-danger" id="btnDeleteAllLearningAreas">
                                                        <i class="bi bi-trash me-1"></i>Delete All
                                                    </button>
                                                ` : ''}
                                                <button type="button" class="btn btn-sm btn-outline-primary" id="btnAddLearningArea">
                                                    <i class="bi bi-plus-lg me-1"></i>${categoryKey === 'play_school' ? 'Add Domain' : 'Add Field'}
                                                </button>
                                            </div>
                                        </div>
                                        <div id="learningAreaEditor"></div>
                                    </div>
                                    <div class="col-lg-7">
                                        ${createCardPreview(category.label, getAreasByCategory(categoryKey))}
                                    </div>
                                </div>
                            </div>
                            <div class="tab-pane fade" id="cardTransmutationPane" role="tabpanel" aria-labelledby="card-transmutation-tab">
                                <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                                    <div>
                                        <h6 class="fw-bold mb-0">Transmutation Table</h6>
                                        <div class="text-muted small">${transmutationHelp}</div>
                                    </div>
                                    ${transmutationActions}
                                </div>
                                <div id="transmutationEditor"></div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-primary" id="btnSaveCardManagement">Save Report Card</button>
                    </div>
                </div>
            </div>
        </div>
    `);

    renderLearningAreaEditor();
    renderTransmutationEditor();
    bindCardManagementEditorActions();

    bootstrap.Modal.getOrCreateInstance(document.getElementById('cardManagementModal')).show();
}

function renderCardManagementPage(categoryKey) {
    activeCategory = categoryKey;
    pendingDeleteIds = [];
    pendingTransmutationDeleteIds = [];
    pendingPlaySchoolTransmutationArchiveIds = [];
    pendingPlaySchoolStandardArchiveIds = [];
    pendingPlaySchoolInterpretationArchiveIds = [];

    const root = document.getElementById('cardManagementPageRoot');
    if (!root) return;

    const category = CARD_CATEGORIES.find(item => item.key === categoryKey) || CARD_CATEGORIES[0];
    const transmutationHelp = categoryKey === 'play_school'
        ? 'Raw score ranges are converted to scaled scores by age group.'
        : 'Percentage ranges are used to convert computed averages to letter remarks.';
    const transmutationActions = categoryKey === 'play_school'
        ? `
            <button type="button" class="btn btn-sm btn-outline-secondary" id="btnResetPlayTransmutation">
                <i class="bi bi-arrow-counterclockwise me-1"></i>Reset
            </button>
        `
        : `
            <div class="d-flex gap-2">
                <button type="button" class="btn btn-sm btn-outline-secondary" id="btnResetTransmutation">
                    <i class="bi bi-arrow-counterclockwise me-1"></i>Reset
                </button>
                <button type="button" class="btn btn-sm btn-outline-primary" id="btnAddTransmutationRow">
                    <i class="bi bi-plus-lg me-1"></i>Add Range
                </button>
            </div>
        `;

    root.innerHTML = `
        <style>
            .card-management-page {
                display: grid;
                gap: 1rem;
            }

            .card-management-toolbar {
                background: #fff;
                border: 1px solid rgba(15, 23, 42, 0.08);
                border-radius: 8px;
                padding: 1rem;
            }

            .card-management-editor {
                background: #fff;
                border: 1px solid rgba(15, 23, 42, 0.08);
                border-radius: 8px;
                padding: 1rem;
            }

            .card-management-editor .nav-tabs .nav-link {
                color: #334155;
                font-weight: 600;
            }

            .card-management-editor .nav-tabs .nav-link.active {
                color: #dc3545;
            }

            .card-management-page .learning-area-list {
                max-height: none;
            }

            /* Keep each domain-quarter compact; additional checklist items
               remain available in the quarter's own scroll area. */
            .card-management-page .play-school-quarter-group .learning-area-list {
                max-height: 340px;
                overflow-y: auto;
            }

            .card-management-page .play-school-quarter-toggle {
                cursor: pointer;
            }

            .card-management-page .play-school-quarter-group.is-collapsed .learning-area-list {
                display: none;
            }

            .card-management-page .report-card-preview {
                min-height: 360px;
            }
        </style>
        <div class="card-management-page">
            <div class="card-management-toolbar d-flex justify-content-between align-items-center gap-3 flex-wrap">
                <div>
                    <div class="text-muted small">Editing</div>
                    <h2 class="h4 fw-bold mb-0">${escapeHtml(category.label)}</h2>
                    <div class="text-muted small">${escapeHtml(activeSchoolYearContext.school_year || 'Active school year')} curriculum &bull; ${getCardQuarterPeriods().length} quarter${getCardQuarterPeriods().length === 1 ? '' : 's'}. Earlier school-year cards keep their original checklist.</div>
                </div>
                <div class="d-flex align-items-center gap-2 flex-wrap">
                    <button type="button" class="btn btn-outline-secondary btn-download-card-preview">
                        <i class="bi bi-download me-1"></i>Download
                    </button>
                    <button type="button" class="btn btn-primary" id="btnSaveCardManagement">
                        <i class="bi bi-save me-1"></i>Save Report Card
                    </button>
                </div>
            </div>

            <div class="card-management-editor">
                <ul class="nav nav-tabs mb-3" role="tablist">
                    <li class="nav-item" role="presentation">
                        <button class="nav-link active" id="card-fields-tab" data-bs-toggle="tab" data-bs-target="#cardFieldsPane" type="button" role="tab">
                            Fields
                        </button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" id="card-transmutation-tab" data-bs-toggle="tab" data-bs-target="#cardTransmutationPane" type="button" role="tab">
                            Transmutation
                        </button>
                    </li>
                </ul>
                <div class="tab-content">
                    <div class="tab-pane fade show active" id="cardFieldsPane" role="tabpanel" aria-labelledby="card-fields-tab">
                        <div class="row g-4">
                            <div class="col-xl-5">
                                <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
                                    <div>
                                        <h6 class="fw-bold mb-0">${categoryKey === 'play_school' ? 'Learning Areas' : 'Grade Fields'}</h6>
                                        <div id="gradeWeightSummary" class="small mt-1"></div>
                                    </div>
                                    <div class="d-flex gap-2">
                                        ${categoryKey === 'play_school' ? `
                                            <button type="button" class="btn btn-sm btn-outline-danger" id="btnDeleteAllLearningAreas">
                                                <i class="bi bi-trash me-1"></i>Delete All
                                            </button>
                                        ` : ''}
                                        <button type="button" class="btn btn-sm btn-outline-primary" id="btnAddLearningArea">
                                            <i class="bi bi-plus-lg me-1"></i>${categoryKey === 'play_school' ? 'Add Domain' : 'Add Field'}
                                        </button>
                                    </div>
                                </div>
                                <div id="learningAreaEditor"></div>
                            </div>
                            <div class="col-xl-7">
                                ${createCardPreview(category.label, getAreasByCategory(categoryKey))}
                            </div>
                        </div>
                    </div>
                    <div class="tab-pane fade" id="cardTransmutationPane" role="tabpanel" aria-labelledby="card-transmutation-tab">
                        <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                            <div>
                                <h6 class="fw-bold mb-0">Transmutation Table</h6>
                                <div class="text-muted small">${transmutationHelp}</div>
                            </div>
                            ${transmutationActions}
                        </div>
                        <div id="transmutationEditor"></div>
                    </div>
                </div>
            </div>
        </div>
    `;

    renderLearningAreaEditor();
    renderTransmutationEditor();
    bindCardManagementEditorActions();

}

function bindCardManagementEditorActions() {
    document.getElementById('btnAddLearningArea')?.addEventListener('click', () => addLearningAreaRow());
    document.getElementById('btnDeleteAllLearningAreas')?.addEventListener('click', deleteAllLearningAreaRows);
    document.getElementById('btnAddTransmutationRow')?.addEventListener('click', addTransmutationRow);
    document.getElementById('btnResetTransmutation')?.addEventListener('click', resetTransmutationRows);
    document.getElementById('btnResetPlayTransmutation')?.addEventListener('click', resetPlaySchoolTransmutationRows);
    document.getElementById('btnSaveCardManagement')?.addEventListener('click', saveCardManagement);
    bindCardPreviewDownloadButtons();
}

function bindCardPreviewDownloadButtons(scope = document) {
    scope.querySelectorAll('.btn-download-card-preview:not([data-download-bound="true"])').forEach(button => {
        button.dataset.downloadBound = 'true';
        button.addEventListener('click', () => downloadReportCardTemplate(activeCategory));
    });
}

function bindLearningAreaDragAndDrop(editor) {
    let draggedRow = null;

    editor.querySelectorAll('.learning-area-row').forEach(row => {
        row.addEventListener('dragstart', event => {
            draggedRow = row;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', row.dataset.tempId || row.dataset.areaId || 'learning-area');
            row.classList.add('opacity-50');
        });

        row.addEventListener('dragend', () => {
            draggedRow?.classList.remove('opacity-50');
            draggedRow = null;
            editor.querySelectorAll('.learning-area-row').forEach(item => item.classList.remove('border-primary'));
        });

        row.addEventListener('dragover', event => {
            if (!draggedRow || draggedRow === row || draggedRow.closest('.play-school-domain-group') !== row.closest('.play-school-domain-group')) return;
            event.preventDefault();
            row.classList.add('border-primary');
        });

        row.addEventListener('dragleave', () => row.classList.remove('border-primary'));

        row.addEventListener('drop', event => {
            if (!draggedRow || draggedRow === row || draggedRow.closest('.play-school-domain-group') !== row.closest('.play-school-domain-group')) return;
            event.preventDefault();
            const insertAfter = event.clientY > row.getBoundingClientRect().top + (row.offsetHeight / 2);
            row.parentElement.insertBefore(draggedRow, insertAfter ? row.nextSibling : row);
            const destinationQuarter = Number(row.closest('.play-school-quarter-group')?.dataset.quarter);
            if (destinationQuarter) {
                const quarterInput = draggedRow.querySelector('.card-area-quarter');
                if (quarterInput) quarterInput.value = String(destinationQuarter);
            }
            row.classList.remove('border-primary');
            updatePreviewFromEditor();
        });
    });

    editor.querySelectorAll('.play-school-quarter-group .learning-area-list').forEach(list => {
        list.addEventListener('dragover', event => {
            if (!draggedRow || draggedRow.closest('.play-school-domain-group') !== list.closest('.play-school-domain-group')) return;
            event.preventDefault();
        });

        list.addEventListener('drop', event => {
            if (!draggedRow || draggedRow.closest('.play-school-domain-group') !== list.closest('.play-school-domain-group')) return;
            event.preventDefault();
            list.appendChild(draggedRow);
            const quarter = list.closest('.play-school-quarter-group')?.dataset.quarter;
            const quarterInput = draggedRow.querySelector('.card-area-quarter');
            if (quarterInput && quarter) quarterInput.value = quarter;
            updatePreviewFromEditor();
        });
    });
}

function syncExpandedPlaySchoolQuarters(editor = document) {
    expandedPlaySchoolQuarterKeys = new Set(
        Array.from(editor.querySelectorAll('.play-school-quarter-group:not(.is-collapsed)'))
            .map(group => `${group.closest('.play-school-domain-group')?.dataset.domainKey || ''}:${group.dataset.quarter || ''}`)
    );
}

function renderLearningAreaEditor() {
    const editor = document.getElementById('learningAreaEditor');
    if (!editor) return;

    const areas = sortAreasByOrder(getAreasByCategory(activeCategory));
    if (activeCategory === 'play_school') {
        renderPlaySchoolAreaEditor(editor, areas);
        return;
    }

    editor.innerHTML = `
        <div class="list-group learning-area-list">
            ${areas.length ? areas.map(createAreaEditorRow).join('') : '<div class="text-muted small border rounded p-3">Add the first field for this card.</div>'}
        </div>
    `;

    editor.querySelectorAll('.btn-remove-learning-area').forEach(button => {
        button.addEventListener('click', () => removeLearningAreaRow(button.dataset.areaId, button.dataset.tempId, button));
    });

    editor.querySelectorAll('.card-area-input, .card-area-domain, .card-area-active, .card-area-weight, .card-area-perfect').forEach(input => {
        input.addEventListener('input', updatePreviewFromEditor);
        input.addEventListener('change', updatePreviewFromEditor);
    });
    editor.querySelectorAll('.card-area-domain').forEach(input => {
        input.addEventListener('change', () => {
            updatePlaySchoolTransmutationRows();
            renderTransmutationEditor();
        });
    });

    updateWeightSummary();
    bindLearningAreaDragAndDrop(editor);
}

function renderPlaySchoolAreaEditor(editor, areas) {
    const groups = groupPlaySchoolAreas(areas);

    editor.innerHTML = `
        <div class="play-school-domain-list d-grid gap-3">
            ${groups.length ? groups.map(createPlaySchoolDomainEditorGroup).join('') : '<div class="text-muted small border rounded p-3">Add the first domain for this card.</div>'}
        </div>
    `;

    editor.querySelectorAll('.btn-add-domain-field').forEach(button => {
        button.addEventListener('click', () => {
            const domainLabel = button.closest('.play-school-domain-group')?.querySelector('.card-domain-input')?.value || button.dataset.domainKey || '';
            addLearningAreaRow(domainLabel, Number(button.dataset.quarter));
        });
    });

    editor.querySelectorAll('.play-school-quarter-toggle').forEach(toggle => {
        toggle.addEventListener('click', event => {
            if (event.target.closest('.btn-add-domain-field')) return;

            const quarterGroup = toggle.closest('.play-school-quarter-group');
            const isCollapsed = quarterGroup.classList.toggle('is-collapsed');
            toggle.setAttribute('aria-expanded', String(!isCollapsed));
            toggle.querySelector('.play-school-quarter-chevron')?.classList.toggle('bi-chevron-down', !isCollapsed);
            toggle.querySelector('.play-school-quarter-chevron')?.classList.toggle('bi-chevron-up', isCollapsed);
            syncExpandedPlaySchoolQuarters(editor);
        });
    });

    editor.querySelectorAll('.btn-remove-learning-area').forEach(button => {
        button.addEventListener('click', () => removeLearningAreaRow(button.dataset.areaId, button.dataset.tempId, button));
    });

    editor.querySelectorAll('.card-domain-input, .card-area-input, .card-area-quarter, .card-area-active').forEach(input => {
        input.addEventListener('input', () => {
            updatePreviewFromEditor();
            updatePlaySchoolTransmutationRows();
            renderTransmutationEditor();
        });
        input.addEventListener('change', () => {
            updatePreviewFromEditor();
            updatePlaySchoolTransmutationRows();
            renderTransmutationEditor();
        });
    });

    editor.querySelectorAll('.card-area-quarter').forEach(input => {
        input.addEventListener('change', () => {
            // Preserve all in-progress edits, then re-render so the item appears
            // immediately beneath its newly selected introduction quarter.
            syncExpandedPlaySchoolQuarters(editor);
            setActiveCategoryAreas(getAreasFromEditor());
            renderLearningAreaEditor();
            updatePreviewFromEditor();
            updatePlaySchoolTransmutationRows();
            renderTransmutationEditor();
        });
    });

    updateWeightSummary();
    bindLearningAreaDragAndDrop(editor);
}

function createPlaySchoolQuarterEditorGroup(quarter, rows, domainKey) {
    const itemCount = rows.length;
    const isCollapsed = !expandedPlaySchoolQuarterKeys.has(`${domainKey}:${quarter}`);

    return `
        <section class="play-school-quarter-group border rounded overflow-hidden ${isCollapsed ? 'is-collapsed' : ''}" data-quarter="${quarter}">
            <div class="play-school-quarter-toggle bg-light border-bottom p-2 d-flex align-items-center justify-content-between gap-2" role="button" tabindex="0" aria-expanded="${isCollapsed ? 'false' : 'true'}" aria-label="Toggle ${escapeHtml(getCardQuarterLabel(quarter))}">
                <div>
                    <span class="fw-bold">${escapeHtml(getCardQuarterLabel(quarter))}</span>
                    <span class="small text-muted ms-2">${itemCount} item${itemCount === 1 ? '' : 's'}</span>
                </div>
                <div class="d-flex align-items-center gap-2">
                    <button type="button" class="btn btn-sm btn-outline-primary btn-add-domain-field" data-domain-key="${escapeHtml(domainKey)}" data-quarter="${quarter}">
                        <i class="bi bi-plus-lg me-1"></i>Add Item
                    </button>
                    <i class="bi ${isCollapsed ? 'bi-chevron-down' : 'bi-chevron-up'} play-school-quarter-chevron"></i>
                </div>
            </div>
            <div class="list-group list-group-flush learning-area-list">
                ${rows.length ? rows.map(createPlaySchoolAreaEditorRow).join('') : '<div class="text-muted small p-3">No items introduced this quarter.</div>'}
            </div>
        </section>
    `;
}

function createPlaySchoolDomainEditorGroup(group) {
    const domainKey = group.domain_key || normalizePlaySchoolDomainKey(group.domain_label || 'new_domain');
    const rows = sortAreasByOrder(group.rows, 'play_school');

    return `
        <section class="play-school-domain-group border rounded overflow-hidden" data-domain-key="${escapeHtml(domainKey)}">
            <div class="bg-light border-bottom p-2">
                <div class="row g-2 align-items-end">
                    <div class="col-md-7">
                        <label class="form-label small mb-1">Domain</label>
                        <input type="text" class="form-control form-control-sm card-domain-input" value="${escapeHtml(group.domain_label || '')}" placeholder="Gross Motor">
                    </div>
                    <div class="col-md-3">
                        <div class="small text-muted mb-2">${rows.length} item${rows.length === 1 ? '' : 's'} • later quarters include earlier items</div>
                    </div>
                </div>
            </div>
            <div class="p-2 d-grid gap-2">
                ${getCardQuarterNumbers().map(quarter => createPlaySchoolQuarterEditorGroup(
                    quarter,
                    rows.filter(row => getAreaIntroducedQuarter(row) === quarter),
                    domainKey
                )).join('')}
            </div>
        </section>
    `;
}

function createPlaySchoolAreaEditorRow(area) {
    const tempId = area.temp_id || '';

    return `
        <div class="list-group-item learning-area-row" draggable="true" data-area-id="${area.area_id || ''}" data-temp-id="${tempId}">
            <div class="row g-2 align-items-end">
                <div class="col-auto d-flex align-items-end pb-1 text-muted" title="Drag to reorder" aria-label="Drag to reorder">
                    <i class="bi bi-grip-vertical fs-5"></i>
                </div>
                <div class="col-md-5">
                    <label class="form-label small mb-1">Checklist Item</label>
                    <input type="text" class="form-control form-control-sm card-area-input" value="${escapeHtml(area.area_name || '')}" placeholder="Runs and jumps confidently">
                </div>
                <div class="col-md-2">
                    <label class="form-label small mb-1">Introduced in</label>
                    <select class="form-select form-select-sm card-area-quarter" aria-label="Quarter this checklist item starts">
                        ${getCardQuarterNumbers().map(quarter => `<option value="${quarter}" ${getAreaIntroducedQuarter(area) === quarter ? 'selected' : ''}>${escapeHtml(getCardQuarterLabel(quarter))}</option>`).join('')}
                    </select>
                </div>
                <div class="col-md-3 d-flex align-items-end justify-content-between gap-2">
                    <div class="form-check mb-1">
                        <input class="form-check-input card-area-active" type="checkbox" ${Number(area.is_active ?? 1) === 1 ? 'checked' : ''}>
                        <label class="form-check-label small">Active</label>
                    </div>
                    <button type="button" class="btn btn-sm btn-outline-danger btn-remove-learning-area" data-area-id="${area.area_id || ''}" data-temp-id="${tempId}">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
}

function createAreaEditorRow(area) {
    const tempId = area.temp_id || '';
    const isPlaySchool = activeCategory === 'play_school';
    const scoreColumns = activeCategory === 'pre_school'
        ? `
            <div class="col-md-2">
                <label class="form-label small mb-1">Weight %</label>
                <input type="number" min="0" max="100" step="0.01" class="form-control form-control-sm card-area-weight" value="${escapeHtml(formatNumberInput(getAreaWeight(area)))}">
            </div>
            <div class="col-md-2">
                <label class="form-label small mb-1">Perfect</label>
                <input type="number" min="0" step="0.01" class="form-control form-control-sm card-area-perfect" value="${escapeHtml(formatNumberInput(getAreaPerfectScore(area)))}">
            </div>
        `
        : '';
    const nameColumn = isPlaySchool
        ? `
            <div class="col-md-4">
                <label class="form-label small mb-1">Domain</label>
                <input type="text" class="form-control form-control-sm card-area-domain" value="${escapeHtml(area.domain_label || '')}" placeholder="Gross Motor">
            </div>
            <div class="col-md-4">
                <label class="form-label small mb-1">Checklist Item</label>
                <input type="text" class="form-control form-control-sm card-area-input" value="${escapeHtml(area.area_name || '')}" placeholder="Runs and jumps confidently">
            </div>
        `
        : `
            <div class="col-md-4">
                <label class="form-label small mb-1">Name</label>
                <input type="text" class="form-control form-control-sm card-area-input" value="${escapeHtml(area.area_name || '')}" placeholder="Quiz">
            </div>
        `;

    return `
        <div class="list-group-item learning-area-row" draggable="true" data-area-id="${area.area_id || ''}" data-temp-id="${tempId}">
            <div class="row g-2 align-items-center">
                <div class="col-auto text-muted" title="Drag to reorder" aria-label="Drag to reorder">
                    <i class="bi bi-grip-vertical fs-5"></i>
                </div>
                ${nameColumn}
                ${scoreColumns}
                <div class="${activeCategory === 'pre_school' ? 'col-md-2' : 'col-md-2'} d-flex align-items-end justify-content-between gap-2">
                    <div class="form-check mb-1">
                        <input class="form-check-input card-area-active" type="checkbox" ${Number(area.is_active ?? 1) === 1 ? 'checked' : ''}>
                    </div>
                    <button type="button" class="btn btn-sm btn-outline-danger btn-remove-learning-area" data-area-id="${area.area_id || ''}" data-temp-id="${tempId}">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
}

function addLearningAreaRow(domainKey = '', introducedQuarter = 1) {
    const currentRows = getAreasFromEditor();
    const nextOrder = getNextOrder(currentRows);
    const remainingWeight = activeCategory === 'pre_school'
        ? Math.max(0, roundNumber(100 - getTotalActiveWeight(currentRows), 2))
        : 0;
    const domainSource = activeCategory === 'play_school'
        ? getDomainSourceForNewRow(domainKey, currentRows)
        : { domain_key: '', domain_label: '' };

    setActiveCategoryAreas([
        ...currentRows,
        {
            temp_id: `new-${Date.now()}`,
            area_name: '',
            category: activeCategory,
            domain_key: domainSource.domain_key,
            domain_label: domainSource.domain_label,
            introduced_quarter: getCardQuarterNumbers().includes(Number(introducedQuarter)) ? Number(introducedQuarter) : 1,
            order_index: nextOrder,
            is_active: 1,
            weight_percentage: remainingWeight,
            default_perfect_score: 100
        }
    ]);

    renderLearningAreaEditor();
    updatePreviewFromEditor();
    if (activeCategory === 'play_school') {
        renderTransmutationEditor();
    }
}

async function removeLearningAreaRow(areaId, tempId, button = null) {
    if (activeCategory === 'play_school' && areaId) {
        const result = await Swal.fire({
            icon: 'warning',
            title: 'Delete checklist item?',
            text: `This will remove the ECCD checklist item from the ${activeSchoolYearContext.school_year || 'active school year'} curriculum.`,
            showCancelButton: true,
            confirmButtonText: 'Delete',
            confirmButtonColor: '#dc3545'
        });

        if (!result.isConfirmed) return;

        const originalHtml = button?.innerHTML;
        if (button) {
            button.disabled = true;
            button.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
        }

        try {
            const response = await postLearningArea('deleteLearningArea', { area_id: areaId });
            if (response.data?.status === 'error' || response.data === 0) {
                throw new Error(response.data?.message || 'Unable to delete checklist item.');
            }
        } catch (error) {
            console.error('Error deleting ECCD checklist item:', error);
            Swal.fire('Error', error.message || 'Unable to delete checklist item.', 'error');
            if (button) {
                button.disabled = false;
                button.innerHTML = originalHtml;
            }
            return;
        }
    } else if (areaId) {
        pendingDeleteIds.push(areaId);
    }

    const remainingRows = getAreasFromEditor().filter(area => {
        if (areaId) return String(area.area_id) !== String(areaId);
        return String(area.temp_id) !== String(tempId);
    });

    setActiveCategoryAreas(remainingRows);
    renderLearningAreaEditor();
    renderTransmutationEditor();
    updatePreviewFromEditor();
}

async function deleteAllLearningAreaRows() {
    const rows = getAreasFromEditor();
    if (!rows.length) {
        Swal.fire('No checklist items', 'There are no ECCD checklist items to delete.', 'info');
        return;
    }

    const savedIds = rows.map(row => row.area_id).filter(Boolean);
    const result = await Swal.fire({
        icon: 'warning',
        title: 'Delete all checklist items?',
        text: savedIds.length
            ? `This will remove all ECCD checklist items from the ${activeSchoolYearContext.school_year || 'active school year'} curriculum.`
            : 'This will clear all unsaved ECCD checklist items from the editor.',
        showCancelButton: true,
        confirmButtonText: 'Delete All',
        confirmButtonColor: '#dc3545'
    });

    if (!result.isConfirmed) return;

    const button = document.getElementById('btnDeleteAllLearningAreas');
    const originalHtml = button?.innerHTML;
    if (button) {
        button.disabled = true;
        button.innerHTML = '<span class="spinner-border spinner-border-sm"></span><span>Deleting</span>';
    }

    try {
        await Promise.all(savedIds.map(areaId => postLearningArea('deleteLearningArea', { area_id: areaId })));
        pendingDeleteIds = pendingDeleteIds.filter(id => !savedIds.includes(String(id)) && !savedIds.includes(Number(id)));
        setActiveCategoryAreas([]);
        renderLearningAreaEditor();
        renderTransmutationEditor();
        updatePreviewFromEditor();
    } catch (error) {
        console.error('Error deleting ECCD checklist items:', error);
        Swal.fire('Error', error.message || 'Unable to delete all checklist items.', 'error');
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = originalHtml;
        }
    }
}

function setActiveCategoryAreas(rows) {
    learningAreas = [
        ...learningAreas.filter(area => String(area.category || '').toLowerCase() !== activeCategory),
        ...rows.map((area, index) => ({
            ...area,
            category: activeCategory,
            domain_key: activeCategory === 'play_school' ? getAreaDomainKey(area) : '',
            domain_label: activeCategory === 'play_school' ? getAreaDomainLabel(area) : '',
            order_index: area.order_index || index + 1,
            weight_percentage: getAreaWeight(area),
            default_perfect_score: getAreaPerfectScore(area)
        }))
    ];
}

function updatePreviewFromEditor() {
    updateWeightSummary();
    const preview = document.getElementById('cardPreviewShell');
    if (!preview) return;

    const category = CARD_CATEGORIES.find(item => item.key === activeCategory) || CARD_CATEGORIES[0];
    preview.outerHTML = createCardPreview(category.label, sortAreasByOrder(getAreasFromEditor()));
    bindCardPreviewDownloadButtons();
}

function updateWeightSummary() {
    const summary = document.getElementById('gradeWeightSummary');
    if (!summary) return;

    if (activeCategory !== 'pre_school') {
        summary.innerHTML = '<span class="text-muted">Type a domain once, then add checklist items under it. No colon format needed.</span>';
        return;
    }

    const rows = getAreasFromEditor();
    const totalWeight = getTotalActiveWeight(rows);
    const badgeClass = getWeightBadgeClass(totalWeight);
    summary.innerHTML = `
        <span class="badge ${badgeClass} me-1">${formatPercent(totalWeight)}%</span>
        <span class="text-muted">active weight total</span>
    `;
}

function renderTransmutationEditor() {
    const editor = document.getElementById('transmutationEditor');
    if (!editor) return;

    if (activeCategory === 'play_school') {
        editor.innerHTML = createPlaySchoolTransmutationTable(playSchoolTransmutationTables, {
            editable: true,
            standardScores: playSchoolStandardScoreRows,
            interpretations: playSchoolInterpretations,
            domains: getPlaySchoolDomainsFromAreas(getAreasFromEditor().length ? getAreasFromEditor() : getAreasByCategory('play_school'))
        });
        editor.querySelectorAll('.play-transmutation-input').forEach(input => {
            input.addEventListener('input', updatePlaySchoolTransmutationRows);
            input.addEventListener('change', updatePlaySchoolTransmutationRows);
        });
        editor.querySelectorAll('.btn-add-play-transmutation-row').forEach(button => {
            button.addEventListener('click', () => addPlaySchoolTransmutationRow(button.dataset.ageKey));
        });
        editor.querySelectorAll('.btn-archive-play-transmutation').forEach(button => {
            button.addEventListener('click', () => archivePlaySchoolTransmutationRow(
                button.dataset.playTransmutationId,
                button.dataset.tempId,
                button.dataset.ageKey
            ));
        });
        editor.querySelector('.btn-add-play-standard-score-row')?.addEventListener('click', addPlaySchoolStandardScoreRow);
        editor.querySelectorAll('.btn-archive-play-standard-score').forEach(button => {
            button.addEventListener('click', () => archivePlaySchoolStandardScoreRow(button.dataset.standardScoreId, button.dataset.tempId));
        });
        editor.querySelectorAll('.btn-add-play-interpretation-row').forEach(button => {
            button.addEventListener('click', () => addPlaySchoolInterpretationRow(button.dataset.scoreType));
        });
        editor.querySelectorAll('.btn-archive-play-interpretation').forEach(button => {
            button.addEventListener('click', () => archivePlaySchoolInterpretationRow(
                button.dataset.scoreType,
                button.dataset.interpretationId,
                button.dataset.tempId
            ));
        });
        return;
    }

    const rows = sortTransmutationRows(transmutationRows.length ? transmutationRows : DEFAULT_TRANSMUTATION_ROWS);
    editor.innerHTML = `
        <div class="table-responsive">
            <table class="table table-sm table-bordered align-middle mb-2">
                <thead class="table-light">
                    <tr>
                        <th style="width: 24%;">Min %</th>
                        <th style="width: 24%;">Max %</th>
                        <th>Letter</th>
                        <th style="width: 70px;" class="text-center">Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.length ? rows.map(createTransmutationEditorRow).join('') : '<tr><td colspan="4" class="text-center text-muted">Add a transmutation range.</td></tr>'}
                </tbody>
            </table>
        </div>
        <div class="small text-muted">Example: 95 to 100 becomes A+.</div>
    `;

    editor.querySelectorAll('.btn-remove-transmutation').forEach(button => {
        button.addEventListener('click', () => removeTransmutationRow(button.dataset.transmutationId, button.dataset.tempId));
    });

    editor.querySelectorAll('.transmutation-min, .transmutation-max, .transmutation-letter').forEach(input => {
        input.addEventListener('input', updateTransmutationPreview);
        input.addEventListener('change', updateTransmutationPreview);
    });
}

function createTransmutationEditorRow(row) {
    const tempId = row.temp_id || '';
    return `
        <tr class="transmutation-row" data-transmutation-id="${row.transmutation_id || ''}" data-temp-id="${tempId}">
            <td>
                <input type="number" min="0" max="100" step="0.01" class="form-control form-control-sm transmutation-min" value="${escapeHtml(formatNumberInput(row.min_percentage))}">
            </td>
            <td>
                <input type="number" min="0" max="100" step="0.01" class="form-control form-control-sm transmutation-max" value="${escapeHtml(formatNumberInput(row.max_percentage))}">
            </td>
            <td>
                <input type="text" maxlength="5" class="form-control form-control-sm transmutation-letter" value="${escapeHtml(row.transmuted_letter || '')}" placeholder="A+">
            </td>
            <td class="text-center">
                <button type="button" class="btn btn-sm btn-outline-danger btn-remove-transmutation" data-transmutation-id="${row.transmutation_id || ''}" data-temp-id="${tempId}">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        </tr>
    `;
}

function addTransmutationRow() {
    setTransmutationRows([
        ...getTransmutationRowsFromEditor(),
        {
            temp_id: `transmutation-${Date.now()}`,
            min_percentage: 0,
            max_percentage: 0,
            transmuted_letter: ''
        }
    ]);
    renderTransmutationEditor();
    updateTransmutationPreview();
}

function resetTransmutationRows() {
    pendingTransmutationDeleteIds = [
        ...new Set([
            ...pendingTransmutationDeleteIds,
            ...transmutationRows.map(row => row.transmutation_id).filter(Boolean)
        ])
    ];
    setTransmutationRows(DEFAULT_TRANSMUTATION_ROWS.map((row, index) => ({
        ...row,
        temp_id: `default-${index}-${Date.now()}`
    })));
    renderTransmutationEditor();
    updateTransmutationPreview();
}

function removeTransmutationRow(transmutationId, tempId) {
    if (transmutationId) pendingTransmutationDeleteIds.push(transmutationId);
    const rows = getTransmutationRowsFromEditor().filter(row => {
        if (transmutationId) return String(row.transmutation_id) !== String(transmutationId);
        return String(row.temp_id) !== String(tempId);
    });

    setTransmutationRows(rows);
    renderTransmutationEditor();
    updateTransmutationPreview();
}

function updateTransmutationPreview() {
    setTransmutationRows(getTransmutationRowsFromEditor());
    updatePreviewFromEditor();
}

function setTransmutationRows(rows) {
    transmutationRows = normalizeTransmutationRows(rows);
}

function updatePlaySchoolTransmutationRows() {
    const editor = document.getElementById('transmutationEditor');
    if (!editor) return;
    const interpretations = getPlaySchoolInterpretationsFromEditor(editor);
    playSchoolTransmutationTables = normalizePlaySchoolTransmutationTables(getPlaySchoolTransmutationRowsFromEditor(editor));
    playSchoolStandardScoreRows = normalizePlaySchoolStandardScoreRows(getPlaySchoolStandardScoreRowsFromEditor(editor));
    playSchoolInterpretations = {
        scaled: normalizePlaySchoolInterpretations(interpretations.scaled, PLAY_SCHOOL_SCALED_SCORE_INTERPRETATIONS),
        standard: normalizePlaySchoolInterpretations(interpretations.standard, PLAY_SCHOOL_STANDARD_SCORE_INTERPRETATIONS)
    };
}

function resetPlaySchoolTransmutationRows() {
    playSchoolTransmutationTables = getPlaySchoolTransmutationTables();
    playSchoolStandardScoreRows = getPlaySchoolStandardScoreRows();
    playSchoolInterpretations = getDefaultPlaySchoolInterpretations();
    pendingPlaySchoolTransmutationArchiveIds = [];
    pendingPlaySchoolStandardArchiveIds = [];
    pendingPlaySchoolInterpretationArchiveIds = [];
    renderTransmutationEditor();
}

function addPlaySchoolTransmutationRow(ageKey) {
    const editor = document.getElementById('transmutationEditor');
    const tables = normalizePlaySchoolTransmutationTables(getPlaySchoolTransmutationRowsFromEditor(editor));
    playSchoolTransmutationTables = tables.map(table => {
        if (table.age_key !== ageKey) return table;
        const orderedRows = [...table.rows].sort((a, b) => Number(a.order_index) - Number(b.order_index));
        const lastRow = orderedRows[orderedRows.length - 1];
        return {
            ...table,
            rows: [
                ...table.rows,
                {
                    temp_id: `play-transmutation-${ageKey}-${Date.now()}`,
                    scaled_score: lastRow ? Number(lastRow.scaled_score) + 1 : 1,
                    order_index: table.rows.length + 1,
                    ...Object.fromEntries(
                        getPlaySchoolDomainsFromAreas(getAreasFromEditor().length ? getAreasFromEditor() : getAreasByCategory('play_school'))
                            .map(domain => [domain.domain_key, '-'])
                    )
                }
            ]
        };
    });
    renderTransmutationEditor();
}

async function archivePlaySchoolTransmutationRow(playTransmutationId, tempId, ageKey) {
    const rows = getPlaySchoolTransmutationRowsFromEditor(document.getElementById('transmutationEditor'));
    const ageRows = rows.filter(row => String(row.age_key) === String(ageKey));
    if (ageRows.length <= 1) {
        Swal.fire('Keep one row', 'Please keep at least one scaled-score row per age group.', 'info');
        return;
    }

    const result = await Swal.fire({
        icon: 'warning',
        title: 'Archive transmutation row?',
        text: 'Archived raw-score rows will be hidden from the table after you save.',
        showCancelButton: true,
        confirmButtonText: 'Archive'
    });
    if (!result.isConfirmed) return;

    if (playTransmutationId) pendingPlaySchoolTransmutationArchiveIds.push(playTransmutationId);
    const filteredRows = rows.filter(row => playTransmutationId
        ? String(row.play_transmutation_id) !== String(playTransmutationId)
        : String(row.temp_id) !== String(tempId));
    const orderByAge = new Map();
    playSchoolTransmutationTables = normalizePlaySchoolTransmutationTables(
        filteredRows.map(row => {
            const nextOrder = (orderByAge.get(row.age_key) || 0) + 1;
            orderByAge.set(row.age_key, nextOrder);
            return { ...row, order_index: nextOrder };
        })
    );
    renderTransmutationEditor();
}

function addPlaySchoolStandardScoreRow() {
    const editor = document.getElementById('transmutationEditor');
    const rows = normalizePlaySchoolStandardScoreRows(getPlaySchoolStandardScoreRowsFromEditor(editor));
    const lastRow = rows[rows.length - 1];
    rows.push({
        temp_id: `play-standard-${Date.now()}`,
        sum_scaled_score: lastRow ? Number(lastRow.sum_scaled_score) + 1 : 1,
        standard_score: lastRow ? Number(lastRow.standard_score) : 1,
        order_index: rows.length + 1
    });
    playSchoolStandardScoreRows = rows;
    renderTransmutationEditor();
}

async function archivePlaySchoolStandardScoreRow(standardScoreId, tempId) {
    const rows = getPlaySchoolStandardScoreRowsFromEditor(document.getElementById('transmutationEditor'));
    if (rows.length <= 1) {
        Swal.fire('Keep one row', 'Please keep at least one standard score row.', 'info');
        return;
    }

    const result = await Swal.fire({
        icon: 'warning',
        title: 'Archive standard score row?',
        text: 'Archived rows will be hidden from the table after you save.',
        showCancelButton: true,
        confirmButtonText: 'Archive'
    });
    if (!result.isConfirmed) return;

    if (standardScoreId) pendingPlaySchoolStandardArchiveIds.push(standardScoreId);
    playSchoolStandardScoreRows = normalizePlaySchoolStandardScoreRows(
        rows
            .filter(row => standardScoreId
                ? String(row.standard_score_id) !== String(standardScoreId)
                : String(row.temp_id) !== String(tempId))
            .map((row, index) => ({ ...row, order_index: index + 1 }))
    );
    renderTransmutationEditor();
}

function addPlaySchoolInterpretationRow(scoreType) {
    const editor = document.getElementById('transmutationEditor');
    const interpretations = getPlaySchoolInterpretationsFromEditor(editor);
    const rows = normalizePlaySchoolInterpretations(
        interpretations[scoreType] || [],
        scoreType === 'scaled' ? PLAY_SCHOOL_SCALED_SCORE_INTERPRETATIONS : PLAY_SCHOOL_STANDARD_SCORE_INTERPRETATIONS
    );
    rows.push({
        temp_id: `play-interpretation-${scoreType}-${Date.now()}`,
        min: null,
        max: null,
        code: `${scoreType}_custom_${rows.length + 1}`,
        label: '',
        level: 'average',
        follow_up_months: null,
        order_index: rows.length + 1
    });

    playSchoolInterpretations = {
        scaled: normalizePlaySchoolInterpretations(
            scoreType === 'scaled' ? rows : interpretations.scaled || [],
            PLAY_SCHOOL_SCALED_SCORE_INTERPRETATIONS
        ),
        standard: normalizePlaySchoolInterpretations(
            scoreType === 'standard' ? rows : interpretations.standard || [],
            PLAY_SCHOOL_STANDARD_SCORE_INTERPRETATIONS
        )
    };
    renderTransmutationEditor();
}

async function archivePlaySchoolInterpretationRow(scoreType, interpretationId, tempId) {
    const editor = document.getElementById('transmutationEditor');
    const interpretations = getPlaySchoolInterpretationsFromEditor(editor);
    const rows = interpretations[scoreType] || [];
    if (rows.length <= 1) {
        Swal.fire('Keep one row', `Please keep at least one ${scoreType} interpretation row.`, 'info');
        return;
    }

    const result = await Swal.fire({
        icon: 'warning',
        title: 'Archive interpretation row?',
        text: 'Archived interpretation rows will be hidden from the table after you save.',
        showCancelButton: true,
        confirmButtonText: 'Archive'
    });
    if (!result.isConfirmed) return;

    if (interpretationId) pendingPlaySchoolInterpretationArchiveIds.push(interpretationId);

    playSchoolInterpretations = {
        scaled: normalizePlaySchoolInterpretations(
            scoreType === 'scaled'
                ? rows
                    .filter(row => interpretationId
                        ? String(row.interpretation_id) !== String(interpretationId)
                        : String(row.temp_id) !== String(tempId))
                    .map((row, index) => ({ ...row, order_index: index + 1 }))
                : interpretations.scaled || [],
            PLAY_SCHOOL_SCALED_SCORE_INTERPRETATIONS
        ),
        standard: normalizePlaySchoolInterpretations(
            scoreType === 'standard'
                ? rows
                    .filter(row => interpretationId
                        ? String(row.interpretation_id) !== String(interpretationId)
                        : String(row.temp_id) !== String(tempId))
                    .map((row, index) => ({ ...row, order_index: index + 1 }))
                : interpretations.standard || [],
            PLAY_SCHOOL_STANDARD_SCORE_INTERPRETATIONS
        )
    };
    renderTransmutationEditor();
}

async function saveCardManagement() {
    if (isSavingCardManagement) return;

    if (!guardProgramPermission('edit_checklists', 'You do not have permission to edit the ECCD checklist.')) {
        return;
    }

    const rows = sortAreasByOrder(getAreasFromEditor())
        .filter(area => area.area_name.trim() !== '')
        .map((area, index) => ({
            ...area,
            order_index: activeCategory === 'play_school' ? (Number(area.order_index) || index + 1) : index + 1,
            weight_percentage: getAreaWeight(area),
            default_perfect_score: getAreaPerfectScore(area)
        }));

    if (!rows.length) {
        Swal.fire('Missing rows', 'Please add at least one field.', 'warning');
        return;
    }

    const perfectScoreError = rows.find(area => Number(area.is_active) === 1 && getAreaPerfectScore(area) <= 0);
    if (perfectScoreError) {
        Swal.fire('Invalid perfect score', `${perfectScoreError.area_name} needs a perfect score greater than 0.`, 'warning');
        return;
    }

    if (activeCategory === 'pre_school') {
        const activeWeightTotal = getTotalActiveWeight(rows);
        const hasWeightedRows = rows.some(row => Number(row.is_active) === 1 && getAreaWeight(row) > 0);
        if (hasWeightedRows && Math.abs(activeWeightTotal - 100) > 0.01) {
            const result = await Swal.fire({
                icon: 'warning',
                title: `Weights total ${formatPercent(activeWeightTotal)}%`,
                text: 'Final grades are normally computed from 100%. Save this setup anyway?',
                showCancelButton: true,
                confirmButtonText: 'Save Anyway'
            });

            if (!result.isConfirmed) return;
        }
    }

    if (activeCategory === 'pre_school') {
        const transmutationValidation = validateTransmutationRows(getTransmutationRowsFromEditor());
        if (transmutationValidation) {
            Swal.fire('Invalid transmutation', transmutationValidation, 'warning');
            return;
        }
    } else if (activeCategory === 'play_school') {
        updatePlaySchoolTransmutationRows();
        const editor = document.getElementById('transmutationEditor');
        const playRows = getPlaySchoolTransmutationRowsFromEditor(editor);
        const standardRows = getPlaySchoolStandardScoreRowsFromEditor(editor);
        const interpretations = getPlaySchoolInterpretationsFromEditor(editor);
        const playValidation = validatePlaySchoolTransmutationRows(playRows);
        if (playValidation) {
            Swal.fire('Invalid transmutation', playValidation, 'warning');
            return;
        }

        const standardValidation = validatePlaySchoolStandardScoreRows(standardRows);
        if (standardValidation) {
            Swal.fire('Invalid standard score', standardValidation, 'warning');
            return;
        }
        const interpretationValidation = validatePlaySchoolInterpretations(interpretations);
        if (interpretationValidation) {
            Swal.fire('Invalid interpretation', interpretationValidation, 'warning');
            return;
        }
    }

    isSavingCardManagement = true;
    setSaveCardManagementLoading(true);
    Swal.fire({
        title: 'Saving report card...',
        text: 'Please wait while your changes are saved.',
        allowOutsideClick: false,
        allowEscapeKey: false,
        showConfirmButton: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        await Promise.all(pendingDeleteIds.map(areaId => postLearningArea('deleteLearningArea', { area_id: areaId })));
        await Promise.all(rows.map(area => {
            const payload = {
                area_name: area.area_name.trim(),
                category: activeCategory,
                domain_key: activeCategory === 'play_school' ? getAreaDomainKey(area) : '',
                domain_label: activeCategory === 'play_school' ? getAreaDomainLabel(area) : '',
                introduced_quarter: activeCategory === 'play_school' ? getAreaIntroducedQuarter(area) : 1,
                order_index: area.order_index,
                is_active: area.is_active,
                weight_percentage: area.weight_percentage,
                default_perfect_score: area.default_perfect_score
            };

            if (area.area_id) {
                payload.area_id = area.area_id;
                return postLearningArea('updateLearningArea', payload);
            }

            return postLearningArea('insertLearningArea', payload);
        }));

        if (activeCategory === 'pre_school') {
            const savedTransmutation = await postLearningArea('saveTransmutationRows', {
                rows: sortTransmutationRows(getTransmutationRowsFromEditor()),
                delete_ids: [...new Set(pendingTransmutationDeleteIds)]
            });

            if (savedTransmutation.data?.status === 'error') {
                throw new Error(savedTransmutation.data.message || 'Unable to save transmutation.');
            }
        } else if (activeCategory === 'play_school') {
            const editor = document.getElementById('transmutationEditor');
            const savedPlayTransmutation = await postLearningArea('savePlaySchoolTransmutationRows', {
                rows: getPlaySchoolTransmutationRowsFromEditor(editor),
                standard_rows: getPlaySchoolStandardScoreRowsFromEditor(editor),
                interpretations: getPlaySchoolInterpretationsFromEditor(editor),
                archive_transmutation_ids: [...new Set(pendingPlaySchoolTransmutationArchiveIds)],
                archive_standard_ids: [...new Set(pendingPlaySchoolStandardArchiveIds)],
                archive_interpretation_ids: [...new Set(pendingPlaySchoolInterpretationArchiveIds)]
            });

            if (savedPlayTransmutation.data?.status === 'error') {
                throw new Error(savedPlayTransmutation.data.message || 'Unable to save ECCD transmutation.');
            }

            playSchoolTransmutationTables = normalizePlaySchoolTransmutationTables(savedPlayTransmutation.data?.play_school_transmutation);
            playSchoolStandardScoreRows = normalizePlaySchoolStandardScoreRows(savedPlayTransmutation.data?.play_school_standard_scores);
            playSchoolInterpretations = {
                scaled: normalizePlaySchoolInterpretations(savedPlayTransmutation.data?.play_school_interpretations?.scaled, PLAY_SCHOOL_SCALED_SCORE_INTERPRETATIONS),
                standard: normalizePlaySchoolInterpretations(savedPlayTransmutation.data?.play_school_interpretations?.standard, PLAY_SCHOOL_STANDARD_SCORE_INTERPRETATIONS)
            };
            pendingPlaySchoolTransmutationArchiveIds = [];
            pendingPlaySchoolStandardArchiveIds = [];
            pendingPlaySchoolInterpretationArchiveIds = [];
        }

        const modal = document.getElementById('cardManagementModal');
        const pageRoot = document.getElementById('cardManagementPageRoot');

        if (modal) {
            bootstrap.Modal.getInstance(modal)?.hide();
            await loadLearningAreas();
        } else if (pageRoot) {
            await loadLearningAreas({ renderList: false });
            renderCardManagementPage(activeCategory);
        }

        Swal.fire({ icon: 'success', title: 'Saved', text: 'Report card setup updated.', timer: 1400, showConfirmButton: false });
    } catch (error) {
        console.error('Error saving card setup:', error);
        Swal.fire('Error', error.message || 'Unable to save report card setup.', 'error');
    } finally {
        isSavingCardManagement = false;
        setSaveCardManagementLoading(false);
    }
}

function setSaveCardManagementLoading(isLoading) {
    document.querySelectorAll('#btnSaveCardManagement').forEach(button => {
        if (isLoading) {
            button.dataset.originalContent = button.innerHTML;
            button.disabled = true;
            button.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Saving...';
            return;
        }

        button.disabled = false;
        if (button.dataset.originalContent) {
            button.innerHTML = button.dataset.originalContent;
            delete button.dataset.originalContent;
        }
    });
}

async function downloadReportCardTemplate(categoryKey = activeCategory) {
    const category = CARD_CATEGORIES.find(item => item.key === categoryKey) || CARD_CATEGORIES[0];
    const previousCategory = activeCategory;
    activeCategory = category.key;
    updateStateFromVisibleEditor();

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
    host.style.width = category.key === 'play_school' ? '8.5in' : '11in';
    host.style.minHeight = category.key === 'play_school' ? '11in' : '8.5in';
    host.style.background = '#ffffff';
    host.style.pointerEvents = 'none';
    host.style.zIndex = '-1';
    host.innerHTML = `
        <div class="card-download-sheet">
            ${createCardPreview(category.label, getAreasByCategory(category.key))}
        </div>
    `;
    document.body.appendChild(host);

    try {
        await ensurePdfLibraries();
        await waitForImages(host);

        const sheet = host.querySelector('.card-download-sheet');
        const canvas = await window.html2canvas(sheet, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            width: sheet.scrollWidth,
            height: sheet.scrollHeight,
            windowWidth: sheet.scrollWidth,
            windowHeight: sheet.scrollHeight
        });
        const imageData = canvas.toDataURL('image/jpeg', 0.98);
        const jsPDF = window.jspdf?.jsPDF || window.jsPDF;

        if (!jsPDF) {
            throw new Error('PDF generator is not available.');
        }

        const isPlaySchool = category.key === 'play_school';
        const pdf = new jsPDF({
            orientation: isPlaySchool ? 'portrait' : 'landscape',
            unit: 'in',
            format: 'letter',
            compress: true
        });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imageRatio = canvas.width / Math.max(canvas.height, 1);
        const imageWidth = pageWidth;
        const imageHeight = imageWidth / imageRatio;
        let positionY = 0;
        let remainingHeight = imageHeight;

        pdf.addImage(imageData, 'JPEG', 0, positionY, imageWidth, imageHeight);
        remainingHeight -= pageHeight;

        while (remainingHeight > 0) {
            positionY -= pageHeight;
            pdf.addPage();
            pdf.addImage(imageData, 'JPEG', 0, positionY, imageWidth, imageHeight);
            remainingHeight -= pageHeight;
        }

        pdf.save(createCardTemplateFilename(category));
        Swal.close();
    } catch (error) {
        console.error('Error downloading report card template:', error);
        Swal.fire('Download Error', error.message || 'Unable to download the report card template.', 'error');
    } finally {
        host.remove();
        activeCategory = previousCategory;
    }
}

function updateStateFromVisibleEditor() {
    if (document.getElementById('learningAreaEditor')) {
        setActiveCategoryAreas(getAreasFromEditor());
    }

    if (document.getElementById('transmutationEditor')) {
        if (activeCategory === 'play_school') {
            updatePlaySchoolTransmutationRows();
        } else {
            setTransmutationRows(getTransmutationRowsFromEditor());
        }
    }
}

function createCardTemplateFilename(category) {
    const slug = String(category?.label || 'report_card')
        .trim()
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase() || 'report_card';
    return `${slug}_template.pdf`;
}

function ensurePdfLibraries() {
    if (window.html2canvas && (window.jspdf?.jsPDF || window.jsPDF)) {
        return Promise.resolve();
    }

    return Promise.all([
        loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', 'html2canvas-loader'),
        loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'jspdf-loader')
    ]).then(() => {
        if (!window.html2canvas || !(window.jspdf?.jsPDF || window.jsPDF)) {
            throw new Error('PDF libraries did not load correctly.');
        }
    });
}

function loadScriptOnce(src, loaderId) {
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

function waitForImages(container) {
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

function postLearningArea(operation, payload) {
    const form = new URLSearchParams();
    form.append('operation', operation);
    form.append('json', JSON.stringify(payload));
    return axios.post('../../api/admin/learning_area.php', form);
}

function getAreasByCategory(categoryKey) {
    return sortAreasByOrder(
        learningAreas.filter(area => String(area.category || '').toLowerCase() === categoryKey),
        categoryKey
    );
}

function getAreasFromEditor() {
    if (activeCategory === 'play_school') {
        return Array.from(document.querySelectorAll('#learningAreaEditor .learning-area-row')).map((row, index) => {
            const domainGroup = row.closest('.play-school-domain-group');
            const domainLabel = domainGroup?.querySelector('.card-domain-input')?.value || '';

            return {
                area_id: row.dataset.areaId || '',
                temp_id: row.dataset.tempId || '',
                area_name: row.querySelector('.card-area-input')?.value || '',
                category: activeCategory,
                domain_label: domainLabel,
                domain_key: normalizePlaySchoolDomainKey(domainLabel),
                introduced_quarter: Number(row.querySelector('.card-area-quarter')?.value || 1),
            order_index: index + 1,
                is_active: row.querySelector('.card-area-active')?.checked ? 1 : 0,
                weight_percentage: 0,
                default_perfect_score: 100
            };
        });
    }

    return Array.from(document.querySelectorAll('#learningAreaEditor .learning-area-row')).map((row, index) => ({
        area_id: row.dataset.areaId || '',
        temp_id: row.dataset.tempId || '',
        area_name: row.querySelector('.card-area-input')?.value || '',
        category: activeCategory,
        domain_label: '',
        domain_key: '',
        introduced_quarter: 1,
        order_index: index + 1,
        is_active: row.querySelector('.card-area-active')?.checked ? 1 : 0,
        weight_percentage: Number(row.querySelector('.card-area-weight')?.value || 0),
        default_perfect_score: Number(row.querySelector('.card-area-perfect')?.value || 100)
    }));
}

function getTransmutationRowsFromEditor() {
    return Array.from(document.querySelectorAll('#transmutationEditor .transmutation-row')).map(row => ({
        transmutation_id: row.dataset.transmutationId || '',
        temp_id: row.dataset.tempId || '',
        min_percentage: Number(row.querySelector('.transmutation-min')?.value || 0),
        max_percentage: Number(row.querySelector('.transmutation-max')?.value || 0),
        transmuted_letter: (row.querySelector('.transmutation-letter')?.value || '').trim().toUpperCase()
    })).filter(row => row.transmuted_letter || row.min_percentage || row.max_percentage);
}

function createCardPreview(title, areas) {
    const activeAreas = sortAreasByOrder(areas).filter(area => Number(area.is_active ?? 1) === 1 && String(area.area_name || '').trim() !== '');

    if (activeCategory === 'play_school') {
        return createPlaySchoolChecklistPreview(activeAreas, getCardQuarterPeriods());
    }

    return createGradebookPreview(title, activeAreas);
}

function createGradebookPreview(title, areas) {
    const samples = [
        { name: 'Dela Cruz, Maria Sofia', ratios: [0.95, 0.85, 0.90, 0.87, 1.00] },
        { name: 'Santos, Juan Miguel', ratios: [0.95, 0.90, 1.00, 0.93, 1.00] },
        { name: 'Reyes, Angelique', ratios: [0.80, 0.70, 0.80, 0.67, 0.80] },
        { name: 'Garcia, Ethan James', ratios: [1.00, 0.95, 1.00, 0.93, 1.00] },
        { name: 'Navarro, Isabell', ratios: [], incomplete: true }
    ];

    return `
        <div id="cardPreviewShell" class="report-card-preview border rounded p-3 bg-light">
            <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
                <div>
                    <div class="fw-black fs-5">${escapeHtml(title)} Gradebook Preview</div>
                    <div class="text-muted small">Weighted raw scores are transmuted into letter remarks.</div>
                </div>
                <div class="d-flex gap-2">
                    <button type="button" class="btn btn-sm btn-danger" disabled><i class="bi bi-plus-lg me-1"></i>Add Grade</button>
                    <button type="button" class="btn btn-sm btn-outline-secondary btn-download-card-preview"><i class="bi bi-download me-1"></i>Export</button>
                    <button type="button" class="btn btn-sm btn-danger" disabled><i class="bi bi-save me-1"></i>Save</button>
                </div>
            </div>

            <div class="table-responsive">
                <table class="table table-sm table-bordered align-middle bg-white">
                    <thead>
                        <tr>
                            <th style="background:#fde8ef;">Student Name</th>
                            ${areas.length ? areas.map(area => `
                                <th class="text-center" style="background:#fde8ef;">
                                    <div>${escapeHtml(area.area_name)}</div>
                                    <div class="small text-muted">(${formatPercent(getAreaWeight(area))}% / ${formatScore(getAreaPerfectScore(area))} pts)</div>
                                </th>
                            `).join('') : ''}
                            <th class="text-center" style="background:#fde8ef;">Average<br><span class="small text-muted">(100%)</span></th>
                            <th class="text-center" style="background:#fde8ef;">Remarks</th>
                            <th class="text-center" style="background:#fde8ef;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${areas.length ? samples.map(sample => createGradebookPreviewRow(sample, areas)).join('') : '<tr><td colspan="4" class="text-center text-muted">Add active grade fields to preview the gradebook.</td></tr>'}
                    </tbody>
                </table>
            </div>
            <div class="d-flex flex-wrap gap-2 mt-2 small">
                ${sortTransmutationRows(transmutationRows).map(row => `
                    <span class="badge bg-white text-dark border">${escapeHtml(row.transmuted_letter)}: ${formatPercent(row.min_percentage)}-${formatPercent(row.max_percentage)}%</span>
                `).join('')}
            </div>
        </div>
    `;
}

function createGradebookPreviewRow(sample, areas) {
    if (sample.incomplete) {
        return `
            <tr>
                <td class="fw-semibold">${escapeHtml(sample.name)}</td>
                ${areas.map(() => '<td class="text-center">-</td>').join('')}
                <td class="text-center">-</td>
                <td class="text-center">F</td>
                <td class="text-center"><span class="badge bg-secondary-subtle text-secondary">Incomplete</span></td>
            </tr>
        `;
    }

    const scoreCells = areas.map((area, index) => {
        const perfect = getAreaPerfectScore(area);
        const ratio = sample.ratios[index % sample.ratios.length] ?? 0;
        return {
            score: roundNumber(perfect * ratio, 1),
            perfect,
            ratio
        };
    });
    const average = calculateWeightedAverage(areas, scoreCells);
    const letter = getTransmutedLetter(average);
    const status = letter === 'F' || average < 75 ? 'Needs Review' : 'Passed';
    const averageClass = average >= 85 ? 'text-success' : average >= 75 ? 'text-warning' : 'text-danger';
    const statusClass = status === 'Passed' ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning';

    return `
        <tr>
            <td class="fw-semibold">${escapeHtml(sample.name)}</td>
            ${scoreCells.map(cell => `<td class="text-center">${formatScore(cell.score)}</td>`).join('')}
            <td class="text-center fw-bold ${averageClass}">${formatScore(average)}</td>
            <td class="text-center fw-semibold">${escapeHtml(letter)}</td>
            <td class="text-center"><span class="badge ${statusClass}">${escapeHtml(status)}</span></td>
        </tr>
    `;
}

function calculateWeightedAverage(areas, scoreCells) {
    const weightTotal = getTotalActiveWeight(areas);

    if (weightTotal > 0) {
        const weightedScore = areas.reduce((sum, area, index) => {
            const perfect = Math.max(getAreaPerfectScore(area), 1);
            const percent = (scoreCells[index].score / perfect) * 100;
            return sum + (percent * getAreaWeight(area));
        }, 0);

        return roundNumber(weightedScore / weightTotal, 1);
    }

    const simpleAverage = scoreCells.reduce((sum, cell) => {
        const perfect = Math.max(cell.perfect, 1);
        return sum + ((cell.score / perfect) * 100);
    }, 0) / Math.max(scoreCells.length, 1);

    return roundNumber(simpleAverage, 1);
}

function getTransmutedLetter(percentage) {
    const rows = sortTransmutationRows(transmutationRows.length ? transmutationRows : DEFAULT_TRANSMUTATION_ROWS);
    const match = rows.find(row => percentage >= Number(row.min_percentage) && percentage <= Number(row.max_percentage));
    return match?.transmuted_letter || 'F';
}

function sortAreasByOrder(areas, categoryKey = activeCategory) {
    return [...areas].sort((a, b) => {
        const aOrder = Number(a.order_index) || Number.MAX_SAFE_INTEGER;
        const bOrder = Number(b.order_index) || Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return String(a.area_name || '').localeCompare(String(b.area_name || ''));
    });
}

function sortTransmutationRows(rows) {
    return normalizeTransmutationRows(rows).sort((a, b) => {
        const maxDiff = Number(b.max_percentage) - Number(a.max_percentage);
        if (maxDiff !== 0) return maxDiff;
        return Number(b.min_percentage) - Number(a.min_percentage);
    });
}

function getNextOrder(areas) {
    const highestOrder = areas.reduce((highest, area) => {
        const order = Number(area.order_index) || 0;
        return Math.max(highest, order);
    }, 0);

    return highestOrder + 1;
}

function groupPlaySchoolAreas(areas) {
    const groups = [];
    const groupMap = new Map();

    areas.forEach(area => {
        const domainLabel = getAreaDomainLabel(area) || 'New Domain';
        const domainKey = normalizePlaySchoolDomainKey(domainLabel);

        if (!groupMap.has(domainKey)) {
            const group = {
                domain_key: domainKey,
                domain_label: domainLabel,
                rows: []
            };
            groupMap.set(domainKey, group);
            groups.push(group);
        }

        groupMap.get(domainKey).rows.push({
            ...area,
            domain_key: domainKey,
            domain_label: domainLabel
        });
    });

    return groups;
}

function getDomainSourceForNewRow(domainValue, currentRows) {
    const normalizedDomainKey = normalizePlaySchoolDomainKey(domainValue || '');
    const matchingDomain = currentRows.find(row => normalizePlaySchoolDomainKey(row.domain_label || row.domain_key || '') === normalizedDomainKey);

    if (matchingDomain) {
        return {
            domain_key: getAreaDomainKey(matchingDomain),
            domain_label: getAreaDomainLabel(matchingDomain)
        };
    }

    if (domainValue) {
        const domainLabel = String(domainValue).trim();
        return {
            domain_key: normalizePlaySchoolDomainKey(domainLabel),
            domain_label: domainLabel
        };
    }

    return createNextDomainSource(currentRows);
}

function createNextDomainSource(currentRows) {
    const existingKeys = new Set(currentRows.map(row => getAreaDomainKey(row)).filter(Boolean));
    const baseLabel = 'New Domain';
    let domainLabel = baseLabel;
    let counter = 2;

    while (existingKeys.has(normalizePlaySchoolDomainKey(domainLabel))) {
        domainLabel = `${baseLabel} ${counter}`;
        counter += 1;
    }

    return {
        domain_key: normalizePlaySchoolDomainKey(domainLabel),
        domain_label: domainLabel
    };
}

function getPlaySchoolDomainsFromAreas(areas) {
    return normalizePlaySchoolDomains(areas.map((area, index) => ({
        domain_key: getAreaDomainKey(area),
        domain_label: getAreaDomainLabel(area),
        order_index: index + 1,
        is_active: area.is_active
    })));
}

function getAreaDomainLabel(area) {
    return String(area.domain_label || normalizePlaySchoolAreaShape(area).domain_label || '').trim();
}

function getAreaDomainKey(area) {
    return normalizePlaySchoolDomainKey(area.domain_key || getAreaDomainLabel(area));
}

function getAreaIntroducedQuarter(area) {
    const quarter = Number(area?.introduced_quarter ?? 1);
    return getCardQuarterNumbers().includes(quarter) ? quarter : 1;
}

function toOrdinal(number) {
    return `${number}${number === 1 ? 'st' : number === 2 ? 'nd' : number === 3 ? 'rd' : 'th'}`;
}

function normalizePlaySchoolAreaShape(area) {
    const rawName = String(area.area_name || '').trim();
    let domainLabel = String(area.domain_label || '').trim();
    let itemName = rawName;

    if (!domainLabel && String(area.category || '').toLowerCase() === 'play_school') {
        const parts = rawName.split(':');
        if (parts.length > 1) {
            domainLabel = parts.shift().trim();
            itemName = parts.join(':').trim() || rawName;
        }
    }

    return {
        area_name: itemName,
        domain_label: getCanonicalPlaySchoolDomainLabel(domainLabel, itemName),
        domain_key: normalizePlaySchoolDomainKey(area.domain_key || getCanonicalPlaySchoolDomainLabel(domainLabel, itemName))
    };
}

function getCanonicalPlaySchoolDomainLabel(domainLabel, itemName = '') {
    const text = `${domainLabel || ''} ${itemName || ''}`.toLowerCase();
    if (text.includes('gross')) return 'Gross Motor';
    if (text.includes('fine')) return 'Fine Motor';
    if (text.includes('self') || text.includes('independence') || text.includes('toilet') || text.includes('eats')) return 'Self-Help';
    if (text.includes('understand') || text.includes('instruction') || text.includes('receptive')) return 'Receptive Language';
    if (text.includes('uses words') || text.includes('speak') || text.includes('conversation') || text.includes('expressive')) return 'Expressive Language';
    if (text.includes('social') || text.includes('emotional') || text.includes('behavior') || text.includes('friend')) return 'Social-Emotional';
    if (text.includes('cognitive') || text.includes('early learning') || text.includes('color') || text.includes('shape') || text.includes('count') || text.includes('creativity')) return 'Cognitive';
    return String(domainLabel || '').trim();
}

function normalizeLearningAreas(areas) {
    if (!Array.isArray(areas)) return [];

    return areas.map((area, index) => {
        const normalized = normalizePlaySchoolAreaShape(area);

        return {
            ...area,
            area_id: area.area_id || '',
            temp_id: area.temp_id || '',
            area_name: normalized.area_name,
            category: area.category || '',
            domain_key: normalized.domain_key,
            domain_label: normalized.domain_label,
            introduced_quarter: getAreaIntroducedQuarter(area),
            order_index: Number(area.order_index) || index + 1,
            is_active: Number(area.is_active ?? 1),
            weight_percentage: roundNumber(Number(area.weight_percentage ?? area.weight ?? 0), 2),
            default_perfect_score: roundNumber(Number(area.default_perfect_score ?? area.highest_possible_score ?? 100), 2)
        };
    });
}

function normalizeTransmutationRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return DEFAULT_TRANSMUTATION_ROWS.map(row => ({ ...row }));
    }

    return rows.map(row => ({
        ...row,
        transmutation_id: row.transmutation_id || '',
        temp_id: row.temp_id || '',
        min_percentage: roundNumber(Number(row.min_percentage ?? 0), 2),
        max_percentage: roundNumber(Number(row.max_percentage ?? 0), 2),
        transmuted_letter: String(row.transmuted_letter || row.letter || '').trim().toUpperCase()
    }));
}

function validateTransmutationRows(rows) {
    if (!rows.length) return 'Please add at least one transmutation range.';

    const normalized = rows.map(row => ({
        min: Number(row.min_percentage),
        max: Number(row.max_percentage),
        letter: String(row.transmuted_letter || '').trim()
    })).sort((a, b) => a.min - b.min);

    for (const row of normalized) {
        if (!row.letter) return 'Every transmutation row needs a letter value.';
        if (row.min < 0 || row.max > 100 || row.min > row.max) {
            return 'Ranges must stay between 0 and 100, with Min less than or equal to Max.';
        }
    }

    for (let index = 1; index < normalized.length; index++) {
        if (normalized[index].min <= normalized[index - 1].max) {
            return 'Transmutation ranges cannot overlap.';
        }
    }

    return '';
}

function getTotalActiveWeight(areas) {
    return roundNumber(areas
        .filter(area => Number(area.is_active ?? 1) === 1)
        .reduce((sum, area) => sum + getAreaWeight(area), 0), 2);
}

function getAreaWeight(area) {
    return Math.max(0, roundNumber(Number(area.weight_percentage ?? area.weight ?? 0), 2));
}

function getAreaPerfectScore(area) {
    return Math.max(0, roundNumber(Number(area.default_perfect_score ?? area.highest_possible_score ?? 100), 2));
}

function getWeightBadgeClass(weight) {
    if (Math.abs(Number(weight) - 100) <= 0.01) return 'bg-success';
    if (Number(weight) === 0) return 'bg-secondary';
    return 'bg-warning text-dark';
}

function roundNumber(value, places = 2) {
    const factor = 10 ** places;
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function formatPercent(value) {
    return formatScore(value);
}

function formatScore(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0';
    return number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function formatNumberInput(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '';
    return String(number);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
