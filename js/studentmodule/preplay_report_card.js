import {
    PLAY_SCHOOL_SCALED_SCORE_INTERPRETATIONS,
    PLAY_SCHOOL_STANDARD_SCORE_INTERPRETATIONS,
    calculatePlaySchoolEccdResult,
    normalizePlaySchoolDomainKey,
    normalizePlaySchoolInterpretations,
    normalizePlaySchoolStandardScoreRows,
    normalizePlaySchoolTransmutationTables
} from '../modules/card_mangplay.js';
import {
    getFinalSummaryQuarter,
    getQuarterLabel,
    getQuarterNumbers,
    normalizeSchoolYearContext
} from '../utilities/school_year_context.js';

let currentStudentSchoolYearContext = normalizeSchoolYearContext(null);

function setStudentSchoolYearContext(context) {
    currentStudentSchoolYearContext = normalizeSchoolYearContext(context);
}

function getStudentQuarterNumbers() {
    return getQuarterNumbers(currentStudentSchoolYearContext);
}

function getStudentQuarterLabel(quarter, short = false) {
    return getQuarterLabel(currentStudentSchoolYearContext, quarter, short);
}

function getStudentFinalQuarter() {
    return getFinalSummaryQuarter(currentStudentSchoolYearContext);
}

function getStudentDisplayQuarterLabel(quarter, short = false) {
    return Number(quarter) === getStudentFinalQuarter()
        ? 'Final'
        : getStudentQuarterLabel(quarter, short);
}

export async function openPrePlayReportCard(enrollmentDetailsId) {
    if (!enrollmentDetailsId) return;

    Swal.fire({
        title: 'Loading Report Card',
        text: 'Please wait...',
        allowOutsideClick: false,
        showConfirmButton: false,
        willOpen: () => Swal.showLoading()
    });

    try {
        const response = await axios.get(`../../api/student/evaluation.php?operation=getPreschoolReportCard&enrollment_details_id=${enrollmentDetailsId}`);

        if (response.data.status !== 'success') {
            Swal.fire('Report Card', response.data.message || 'Report card is not available yet.', 'info');
            return;
        }

        showReportCardModal(response.data.data);
    } catch (error) {
        console.error('Error loading report card:', error);
        Swal.fire('Error', 'Unable to load report card right now.', 'error');
    }
}

function showReportCardModal(data) {
    const existing = document.getElementById('studentPrePlayReportCardModal');
    if (existing) existing.remove();

    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="studentPrePlayReportCardModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <div>
                            <h5 class="modal-title">Report Card</h5>
                            <div class="text-muted small">${escapeHtml(data.details?.school_year || 'School year not set')}</div>
                        </div>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body student-report-card-modal-body">
                        <style>
                            .student-report-card-modal-body {
                                background: #ececec;
                            }
                            .student-play-quarter-panel {
                                width: min(100%, 8.5in);
                                min-height: 11in;
                                margin: 0 auto;
                                padding: .45in .55in;
                                background: #fff;
                                box-shadow: 0 .2rem .8rem rgba(0, 0, 0, .16);
                            }
                            .student-play-card-heading {
                                position: relative;
                                margin-bottom: 1rem;
                                text-align: center;
                            }
                            .student-play-card-heading img {
                                position: absolute;
                                top: 0;
                                left: 0;
                                width: 48px;
                                height: 48px;
                                object-fit: contain;
                            }
                            .student-play-card-heading h5 {
                                margin: 0;
                                color: #000;
                                font-weight: 900;
                                line-height: 1.05;
                                text-transform: uppercase;
                            }
                            .student-play-child-info {
                                width: min(100%, 360px);
                                margin: .9rem auto 1rem;
                                color: #111;
                                font-size: .8rem;
                                line-height: 1.25;
                            }
                            .student-play-child-info span {
                                display: inline-block;
                                min-width: 190px;
                                padding: 0 .25rem;
                                border-bottom: 1px solid #111;
                                font-weight: 600;
                            }
                            .student-play-quarter-panel > .row > .col-md-6 {
                                width: 50%;
                            }
                            .student-play-density-comfortable .small {
                                font-size: .9rem;
                            }
                            .student-play-density-regular .small {
                                font-size: .8rem;
                            }
                            .student-play-density-compact .small {
                                font-size: .72rem;
                            }
                            .student-play-check {
                                width: 16px;
                                height: 16px;
                                border: 1px solid #6b7280;
                                display: inline-block;
                                flex: 0 0 16px;
                                margin-top: 1px;
                                position: relative;
                            }
                            .student-play-check.checked::after {
                                content: "";
                                position: absolute;
                                left: 3px;
                                top: -3px;
                                width: 8px;
                                height: 15px;
                                border-right: 2px solid #374151;
                                border-bottom: 2px solid #374151;
                                transform: rotate(42deg);
                            }
                            @media (max-width: 767.98px) {
                                .student-play-quarter-panel {
                                    min-height: 0;
                                    padding: 1rem;
                                }
                                .student-play-quarter-panel > .row {
                                    --bs-gutter-x: .75rem;
                                }
                                .student-play-quarter-panel .small {
                                    font-size: .7rem;
                                }
                            }
                        </style>
                        ${createReportCardHtml(data)}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-primary" id="btnDownloadStudentReportCard">
                            <i class="bi bi-download me-1"></i>Download
                        </button>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        </div>
    `);

    Swal.close();
    const modal = document.getElementById('studentPrePlayReportCardModal');
    bindPlaySchoolQuarterTabs(modal);
    modal.querySelector('#btnDownloadStudentReportCard')?.addEventListener('click', () => {
        downloadStudentReportCard(data, getActiveStudentQuarter(modal));
    });
    bootstrap.Modal.getOrCreateInstance(modal).show();
}

function bindPlaySchoolQuarterTabs(modal) {
    if (!modal) return;

    modal.querySelectorAll('.student-play-quarter-btn').forEach(button => {
        button.addEventListener('click', () => {
            const quarter = button.dataset.quarter;

            modal.querySelectorAll('.student-play-quarter-btn').forEach(item => {
                item.classList.toggle('btn-danger', item === button);
                item.classList.toggle('btn-outline-danger', item !== button);
            });

            modal.querySelectorAll('.student-play-quarter-panel').forEach(panel => {
                panel.classList.toggle('d-none', panel.dataset.quarter !== quarter);
            });
        });
    });
}

function getActiveStudentQuarter(modal) {
    const activePanel = modal?.querySelector('.student-play-quarter-panel:not(.d-none)');
    return Number(activePanel?.dataset.quarter || 1);
}

function createReportCardHtml(data) {
    const details = data.details || {};
    const reportCard = data.report_card || {};
    setStudentSchoolYearContext(reportCard.school_year);
    const learningAreas = normalizeLearningAreas(reportCard.learning_areas);
    const quarters = reportCard.quarters || {};
    const hasAnyQuarter = Object.values(quarters).some(Boolean);
    const usesEccdChecklist = true;

    if (!hasAnyQuarter) {
        return `
            <div class="alert alert-light border mb-0">
                <h6 class="fw-bold mb-2">No report card posted yet</h6>
                <div class="text-muted small">Grades will appear here once your teacher saves a quarter report card.</div>
            </div>
        `;
    }

    if (usesEccdChecklist) {
        return createPlaySchoolReportCardHtml(details, learningAreas, quarters, reportCard);
    }

    return `
        <div class="row g-3 mb-3">
            <div class="col-md-6">
                <div class="p-3 border rounded bg-light h-100">
                    <div class="text-muted small">Student</div>
                    <div class="fw-bold">${escapeHtml(details.student_name || 'Student')}</div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="p-3 border rounded bg-light h-100">
                    <div class="text-muted small">Program / Section</div>
                    <div class="fw-bold">${escapeHtml(details.program_name || 'N/A')} ${details.section_name ? `- ${escapeHtml(details.section_name)}` : ''}</div>
                </div>
            </div>
        </div>

        <div class="table-responsive">
            <table class="table table-bordered align-middle">
                <thead>
                    <tr>
                        <th style="background-color:#ea9aa6;">Learning</th>
                        ${getStudentQuarterNumbers().map(quarter => `<th class="text-center" style="background-color:#ea9aa6;">${escapeHtml(getStudentQuarterLabel(quarter, true))}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${learningAreas.map(area => createLearningRow(area, quarters)).join('')}
                    <tr>
                        <td class="fw-bold">Attendance</td>
                        ${getStudentQuarterNumbers().map(quarter => `<td class="text-center">${escapeHtml(getAttendanceText(quarters[String(quarter)]))}</td>`).join('')}
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="row g-3">
            ${getStudentQuarterNumbers().map(quarter => createQuarterFeedback(quarter, quarters[String(quarter)])).join('')}
        </div>
    `;
}

function createPlaySchoolReportCardHtml(details, learningAreas, quarters, reportCard = {}) {
    const reportQuarters = createPlaySchoolReportQuarters(learningAreas, quarters);
    const savedQuarters = [...getStudentQuarterNumbers(), getStudentFinalQuarter()]
        .map(quarter => ({ quarter, data: reportQuarters[String(quarter)] }))
        .filter(item => item.data);
    const transmutationTables = normalizePlaySchoolTransmutationTables(reportCard.play_school_transmutation);
    const standardScoreRows = normalizePlaySchoolStandardScoreRows(reportCard.play_school_standard_scores);
    const interpretations = {
        scaled: normalizePlaySchoolInterpretations(reportCard.play_school_interpretations?.scaled, PLAY_SCHOOL_SCALED_SCORE_INTERPRETATIONS),
        standard: normalizePlaySchoolInterpretations(reportCard.play_school_interpretations?.standard, PLAY_SCHOOL_STANDARD_SCORE_INTERPRETATIONS)
    };

    return `
        <div class="row g-3 mb-3">
            <div class="col-md-6">
                <div class="p-3 border rounded bg-light h-100">
                    <div class="text-muted small">Student</div>
                    <div class="fw-bold">${escapeHtml(details.student_name || 'Student')}</div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="p-3 border rounded bg-light h-100">
                    <div class="text-muted small">Program / Section</div>
                    <div class="fw-bold">${escapeHtml(details.program_name || 'Pre-school / Play School')} ${details.section_name ? `- ${escapeHtml(details.section_name)}` : ''}</div>
                </div>
            </div>
        </div>

        <div class="d-flex flex-wrap gap-2 mb-3" role="tablist">
            ${savedQuarters.map((item, index) => `
                <button
                    type="button"
                    class="btn btn-sm ${index === 0 ? 'btn-danger' : 'btn-outline-danger'} student-play-quarter-btn"
                    data-quarter="${item.quarter}"
                >
                    ${escapeHtml(getStudentDisplayQuarterLabel(item.quarter))}
                </button>
            `).join('')}
        </div>

        <div>
            ${savedQuarters.map((item, index) => createPlayQuarterPanel(item.quarter, item.data, learningAreas, index === 0, transmutationTables, standardScoreRows, interpretations, details, reportQuarters)).join('')}
        </div>
    `;
}

function createPlayQuarterPanel(quarter, quarterData, learningAreas, isActive, transmutationTables = [], standardScoreRows = [], interpretations = {}, details = {}, quarters = {}) {
    const isFinal = quarter === getStudentFinalQuarter();
    const groups = createPlayChecklistGroups(learningAreas, quarterData, {
        onlyItemsIntroducedThisQuarter: !isFinal
    }).filter(group => Array.isArray(group.items) && group.items.length > 0);
    const totalItems = groups.reduce((total, group) => total + group.items.length, 0);
    const densityClass = totalItems <= 35
        ? 'student-play-density-comfortable'
        : totalItems > 60 ? 'student-play-density-compact' : 'student-play-density-regular';
    const progress = getPlaySchoolProgressLabel(quarterData?.overall_grade || '');
    const eccd = isFinal
        ? getPlaySchoolFinalEccdSummary(learningAreas, quarters, transmutationTables, standardScoreRows, interpretations)
        : getPlaySchoolQuarterEccdSummary(learningAreas, quarterData, transmutationTables, standardScoreRows, interpretations, {
            onlyItemsIntroducedThisQuarter: true
        });

    return `
        <div class="student-play-quarter-panel ${densityClass} ${isActive ? '' : 'd-none'}" data-quarter="${quarter}">
            <div class="student-play-card-heading">
                <img src="${new URL('../../assist/logo.png', import.meta.url).href}" alt="CDTLE logo">
                <h5>ECCD Child's Record 2<br>Checklist</h5>
            </div>
            <div class="student-play-child-info">
                <div>Child Name: <span>${escapeHtml(details.student_name || '')}</span></div>
                <div>Age: <span>${escapeHtml(formatPlaySchoolAgeKey(eccd.age_key || ''))}</span></div>
                <div>Observation Period: <span>${escapeHtml(getStudentDisplayQuarterLabel(quarter))}</span></div>
                <div>Teacher: <span>${escapeHtml(quarterData?.teacher_name || details.section_teacher || '')}</span></div>
            </div>
            <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
                <div>
                    <h6 class="fw-bold mb-1">${escapeHtml(getStudentDisplayQuarterLabel(quarter))} ECCD Checklist</h6>
                    <div class="text-muted small">Teacher: ${escapeHtml(quarterData?.teacher_name || 'Teacher')}</div>
                </div>
                <span class="badge bg-info-subtle text-info-emphasis border">${escapeHtml(progress)}</span>
            </div>

            ${createPlaySchoolEccdSummaryHtml(eccd)}

            <div class="row g-3">
                ${groups.map(group => `
                    <div class="col-md-6">
                        <div class="border rounded p-3 bg-white h-100">
                            <div class="fw-bold mb-2">${escapeHtml(group.title)}</div>
                            <div class="d-grid gap-2">
                                ${group.items.map(item => `
                                    <div class="d-flex align-items-start gap-2">
                                        <span class="student-play-check ${item.checked ? 'checked' : ''}"></span>
                                        <span class="small">${escapeHtml(item.label)}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="mt-3 p-3 border rounded bg-light">
                <div class="fw-bold small mb-1">Teacher's Comments</div>
                <div class="text-muted small">${escapeHtml(getQuarterRemarksText(quarterData) || 'No comments yet.')}</div>
            </div>
        </div>
    `;
}

function createPlaySchoolEccdSummaryHtml(summary) {
    const hasAge = Boolean(summary.age_key);
    const hasScores = hasPlaySummaryScores(summary);

    if (!hasScores) return '';
    if (summary.is_final) return createPlaySchoolFinalEccdSummaryHtml(summary);

    return `
        <div class="border rounded bg-white mb-3 overflow-hidden">
            <div class="px-3 py-2 bg-light border-bottom d-flex justify-content-between align-items-center gap-2 flex-wrap">
                <div>
                    <div class="fw-bold small">ECCD Child's Record 2</div>
                    <div class="text-muted small">${hasAge ? `Age table: ${escapeHtml(formatPlaySchoolAgeKey(summary.age_key))}` : 'Age table was not saved for this evaluation.'}</div>
                </div>
                <span class="badge ${summary.result?.requires_second_tier_evaluation ? 'bg-warning-subtle text-warning border' : 'bg-success-subtle text-success border'}">
                    ${escapeHtml(summary.interpretation || 'Incomplete')}
                </span>
            </div>
            <div class="table-responsive">
                <table class="table table-sm table-bordered align-middle mb-0">
                    <thead>
                        <tr>
                            <th style="background:#07146d;color:#fff;">Domain</th>
                            <th class="text-center" style="background:#ff1010;color:#fff;">Raw Score</th>
                            <th class="text-center" style="background:#ff1010;color:#fff;">Scaled Score</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${summary.domains.map(domain => `
                            <tr>
                                <td class="fw-semibold">${escapeHtml(domain.label)}</td>
                                <td class="text-center">${escapeHtml(domain.raw_score)}</td>
                                <td class="text-center fw-semibold">${escapeHtml(domain.scaled_score)}</td>
                            </tr>
                        `).join('')}
                        <tr>
                            <td class="fw-bold text-danger">Sum of Scaled Scores</td>
                            <td class="bg-secondary-subtle"></td>
                            <td class="text-center fw-bold">${escapeHtml(summary.sum_scaled_scores || '-')}</td>
                        </tr>
                        <tr>
                            <td class="fw-bold text-danger">Standard Score</td>
                            <td class="bg-secondary-subtle"></td>
                            <td class="text-center fw-bold">${escapeHtml(summary.standard_score || '-')}</td>
                        </tr>
                        <tr>
                            <td class="fw-bold text-danger">Interpretation</td>
                            <td colspan="2" class="fw-semibold">${escapeHtml(summary.interpretation || '-')}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function createPlaySchoolFinalEccdSummaryHtml(summary) {
    const summaryQuarterLabels = getStudentQuarterNumbers().map(quarter => getStudentQuarterLabel(quarter));

    return `
        <div class="border rounded bg-white mb-3 overflow-hidden">
            <div class="table-responsive">
                <table class="table table-sm table-bordered align-middle mb-0 play-summary-table">
                    <thead>
                        <tr>
                            <th rowspan="2" class="text-center align-middle" style="background:#07146d;color:#fff;">Domain</th>
                            ${summaryQuarterLabels.map((label, index) => `
                                <th class="text-center" style="background:#fff;color:#07146d;">
                                    ${label}
                                    ${summary.quarter_dates?.[index] ? `<small class="d-block fw-normal">${escapeHtml(summary.quarter_dates[index])}</small>` : ''}
                                </th>
                            `).join('')}
                            <th colspan="2" class="text-center" style="background:#fff;color:#07146d;">Final</th>
                        </tr>
                        <tr>
                            ${Array.from({ length: summaryQuarterLabels.length + 1 }, () => '<th class="text-center" style="background:#ff1010;color:#fff;">Raw Score</th>').join('')}
                            <th class="text-center" style="background:#ff1010;color:#fff;">Scaled Score</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${summary.domains.map(domain => `
                            <tr>
                                <td class="fw-semibold">${escapeHtml(domain.label)}</td>
                                ${(domain.quarter_raw_scores || []).map(score => `<td class="text-center fw-semibold">${escapeHtml(score)}</td>`).join('')}
                                <td class="text-center fw-semibold">${escapeHtml(domain.raw_score)}</td>
                                <td class="text-center fw-bold" style="background:#fff0d8;color:#b45309;">${escapeHtml(domain.scaled_score)}</td>
                            </tr>
                        `).join('')}
                        ${createPlaySchoolFinalEccdSummaryRows(summary)}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function createPlaySchoolFinalEccdSummaryRows(summary) {
    const quarterCount = getStudentQuarterNumbers().length;
    const emptyQuarterCells = `<td colspan="${quarterCount + 1}" style="background:#86a8bf;"></td>`;
    return `
        <tr>
            <td class="fw-bold" style="color:#ed008c;">Sum of Scaled Scores</td>
            ${emptyQuarterCells}
            <td class="text-center fw-bold">${escapeHtml(summary.sum_scaled_scores || '-')}</td>
        </tr>
        <tr>
            <td class="fw-bold" style="color:#ed008c;">Standard Score</td>
            ${emptyQuarterCells}
            <td class="text-center fw-bold">${escapeHtml(summary.standard_score || '-')}</td>
        </tr>
        <tr>
            <td class="fw-bold" style="color:#ed008c;">Interpretation</td>
            <td colspan="${quarterCount}" style="background:#86a8bf;"></td>
            <td colspan="2" class="text-center fw-semibold">${escapeHtml(summary.interpretation || '-')}</td>
        </tr>
    `;
}

function getPlaySchoolQuarterEccdSummary(learningAreas, quarterData, transmutationTables, standardScoreRows, interpretations = {}, options = {}) {
    const groups = createPlayChecklistGroups(learningAreas, quarterData, options);
    const remarksPayload = getQuarterRemarksPayload(quarterData);
    const ageKey = remarksPayload?.play_eccd?.age_key || '';
    const rawScores = {};
    const domainLabels = {};

    groups.forEach(group => {
        const key = normalizePlaySchoolDomainKey(group.key || group.title);
        rawScores[key] = group.items.filter(item => item.checked).length;
        domainLabels[key] = group.title;
    });

    const domainKeys = Object.keys(rawScores);
    const result = calculatePlaySchoolEccdResult(rawScores, ageKey, transmutationTables, standardScoreRows, domainKeys, interpretations);
    const domains = domainKeys.map(key => ({
        key,
        label: domainLabels[key] || key,
        raw_score: Number.isFinite(Number(rawScores[key])) ? rawScores[key] : '-',
        scaled_score: result.scaled_scores?.[key] === '' ? '-' : (result.scaled_scores?.[key] ?? '-')
    }));

    return {
        age_key: ageKey,
        domains,
        result,
        sum_scaled_scores: result.sum_scaled_scores || remarksPayload?.play_eccd?.sum_scaled_scores || '',
        standard_score: result.standard_score || remarksPayload?.play_eccd?.standard_score || '',
        interpretation: result.standard_interpretation?.label || remarksPayload?.play_eccd?.interpretation || ''
    };
}

function getPlaySchoolFinalEccdSummary(learningAreas, quarters, transmutationTables, standardScoreRows, interpretations = {}) {
    const quarterSummaries = {};
    const quarterNumbers = getStudentQuarterNumbers();

    quarterNumbers.forEach(quarter => {
        const quarterData = quarters[String(quarter)];
        quarterSummaries[quarter] = quarterData
            ? getPlaySchoolQuarterEccdSummary(
                learningAreas,
                quarterData,
                transmutationTables,
                standardScoreRows,
                interpretations,
                { onlyItemsIntroducedThisQuarter: true }
            )
            : null;
    });

    const lastQuarter = quarterNumbers.at(-1) || 1;
    const finalData = quarters[String(getStudentFinalQuarter())] || quarters[String(lastQuarter)] || {};
    const finalSummary = getPlaySchoolQuarterEccdSummary(
        learningAreas,
        finalData,
        transmutationTables,
        standardScoreRows,
        interpretations,
        { onlyItemsIntroducedThisQuarter: false }
    );

    return {
        ...finalSummary,
        is_final: true,
        quarter_dates: quarterNumbers.map(quarter =>
            getQuarterRemarksPayload(quarters[String(quarter)] || {})?.play_eccd?.evaluation_date || ''
        ),
        domains: finalSummary.domains.map(domain => ({
            ...domain,
            quarter_raw_scores: quarterNumbers.map(quarter => {
                const quarterSummary = quarterSummaries[quarter];
                if (!quarterSummary) return '-';
                return quarterSummary.domains.find(item => item.key === domain.key)?.raw_score ?? 0;
            })
        }))
    };
}

function createLearningRow(area, quarters) {
    return `
        <tr>
            <td class="fw-semibold">${escapeHtml(area.label)}</td>
            ${getStudentQuarterNumbers().map(quarter => {
                const grade = getQuarterGrade(quarters[String(quarter)], area);
                return `<td class="text-center fw-semibold">${escapeHtml(grade || '-')}</td>`;
            }).join('')}
        </tr>
    `;
}

function createQuarterFeedback(quarter, quarterData) {
    return `
        <div class="col-md-6">
            <div class="p-3 rounded border bg-white h-100">
                <div class="fw-bold small mb-1">${escapeHtml(getStudentQuarterLabel(quarter, true))} Feedback</div>
                <div class="text-muted small">${escapeHtml(getQuarterRemarksText(quarterData) || 'No feedback yet.')}</div>
            </div>
        </div>
    `;
}

function getQuarterGrade(quarterData, area) {
    return (quarterData?.grades || []).find(item => {
        if (item.area_id) return String(item.area_id) === String(area.area_id);
        return item.label === area.label;
    })?.grade || '';
}

function createPlayChecklistGroups(learningAreas, quarterData, { onlyItemsIntroducedThisQuarter = false } = {}) {
    const groups = new Map();
    const selectedQuarter = Number(quarterData?.quarter || 1);

    learningAreas
        .filter(area => !onlyItemsIntroducedThisQuarter || getAreaIntroducedQuarter(area) === selectedQuarter)
        .forEach(area => {
            const parsed = parseChecklistLabel(area.label);
            const domainLabel = String(area.domain_label || '').trim() || parsed.group;
            const domainKey = normalizePlaySchoolDomainKey(area.domain_key || domainLabel) || 'observation_checklist';
            if (!groups.has(domainKey)) {
                groups.set(domainKey, {
                    key: domainKey,
                    title: domainLabel || 'Observation Checklist',
                    items: []
                });
            }

            groups.get(domainKey).items.push({
                label: area.domain_label ? area.label : parsed.item,
                checked: isPlayChecklistChecked(getQuarterGrade(quarterData, area))
            });
        });

    return Array.from(groups.values());
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

function isPlayChecklistChecked(grade) {
    return ['A+', 'A', 'B', 'C'].includes(String(grade || '').toUpperCase());
}

function getPlaySchoolProgressLabel(grade) {
    const value = String(grade || '').toUpperCase();
    if (value === 'A+' || value === 'A') return 'Very Good';
    if (value === 'D' || value === 'F') return 'Developing';
    return 'Good';
}

function getQuarterRemarksPayload(quarterData) {
    const value = quarterData?.remarks;
    if (!value || typeof value !== 'string') return null;

    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
        return null;
    }
}

function getQuarterRemarksText(quarterData) {
    const payload = getQuarterRemarksPayload(quarterData);
    if (payload) return payload.comments || '';
    return quarterData?.remarks || '';
}

function formatPlaySchoolAgeKey(ageKey) {
    const map = {
        '3_1_to_4_0': '3.1 - 4.0 years',
        '4_1_to_5_0': '4.1 - 5.0 years',
        '5_1_to_5_11': '5.1 - 5.11 years'
    };

    return map[ageKey] || String(ageKey || '').replace(/_/g, ' ');
}

function getAttendanceText(quarterData) {
    if (!quarterData || quarterData.attendance === null || quarterData.attendance === undefined || quarterData.attendance === '') {
        return '-';
    }

    return `${quarterData.attendance}${quarterData.total_school_days !== null && quarterData.total_school_days !== undefined && quarterData.total_school_days !== '' ? ` / ${quarterData.total_school_days}` : ''}`;
}

function normalizeLearningAreas(areas) {
    if (!Array.isArray(areas)) return [];

    return areas.map((area, index) => {
        if (typeof area === 'string') {
            return { area_id: index + 1, label: area };
        }

        return {
            area_id: area.area_id || index + 1,
            label: area.label || area.area_name || `Learning Area ${index + 1}`,
            domain_key: area.domain_key || '',
            domain_label: area.domain_label || '',
            introduced_quarter: getAreaIntroducedQuarter(area)
        };
    });
}

function getAreaIntroducedQuarter(area) {
    const quarter = Number(area?.introduced_quarter ?? 1);
    return getStudentQuarterNumbers().includes(quarter) ? quarter : 1;
}

// Final is a cumulative report: every question uses the score saved in the
// quarter where that question was actually assessed.
function createPlaySchoolReportQuarters(learningAreas, quarters) {
    const reportQuarters = { ...quarters };
    const lastQuarter = getStudentQuarterNumbers().at(-1) || 1;
    const finalQuarter = getStudentFinalQuarter();
    const finalSource = quarters[String(lastQuarter)];

    if (!finalSource) return reportQuarters;

    reportQuarters[String(finalQuarter)] = {
        ...finalSource,
        quarter: finalQuarter,
        grades: learningAreas.map(area => ({
            area_id: area.area_id,
            label: area.label,
            grade: getQuarterGrade(quarters[String(getAreaIntroducedQuarter(area))], area)
        }))
    };

    return reportQuarters;
}

async function downloadStudentReportCard(data, selectedQuarter = 1) {
    const details = data.details || {};
    const reportCard = data.report_card || {};
    const learningAreas = normalizeLearningAreas(reportCard.learning_areas);
    const quarters = createPlaySchoolReportQuarters(learningAreas, reportCard.quarters || {});
    const usesEccdChecklist = true;
    const transmutationTables = normalizePlaySchoolTransmutationTables(reportCard.play_school_transmutation);
    const standardScoreRows = normalizePlaySchoolStandardScoreRows(reportCard.play_school_standard_scores);
    const interpretations = {
        scaled: normalizePlaySchoolInterpretations(reportCard.play_school_interpretations?.scaled, PLAY_SCHOOL_SCALED_SCORE_INTERPRETATIONS),
        standard: normalizePlaySchoolInterpretations(reportCard.play_school_interpretations?.standard, PLAY_SCHOOL_STANDARD_SCORE_INTERPRETATIONS)
    };
    const logoUrl = new URL('../../assist/logo.png', import.meta.url).href;
    const abcUrl = new URL('../../assist/abc.png', import.meta.url).href;
    const bookUrl = new URL('../../assist/book.png', import.meta.url).href;

    Swal.fire({
        title: 'Preparing PDF...',
        text: 'Please wait.',
        allowOutsideClick: false,
        showConfirmButton: false,
        willOpen: () => Swal.showLoading()
    });

    try {
        await ensureHtml2Pdf();
    } catch (error) {
        console.error('Unable to load PDF generator:', error);
        Swal.fire('Download Error', 'Unable to load the PDF generator. Please check your internet connection and try again.', 'error');
        return;
    }

    const pdfHost = document.createElement('div');
    pdfHost.style.position = 'fixed';
    pdfHost.style.left = '0';
    pdfHost.style.top = '0';
    pdfHost.style.width = '8.5in';
    pdfHost.style.minHeight = '11in';
    pdfHost.style.background = '#fff';
    pdfHost.style.pointerEvents = 'none';
    pdfHost.style.zIndex = '1050';
    pdfHost.innerHTML = `
            <style>
                @page { size: 8.5in 11in; margin: 0; }
                * { box-sizing: border-box; }
                .pdf-sheet {
                    width: 8.5in;
                    min-height: 11in;
                    margin: 0;
                    background: #fff;
                    color: #111;
                    font-family: Arial, Helvetica, sans-serif;
                    font-size: 0;
                }
                .sheet-panel {
                    display: block;
                    width: 8.5in;
                    height: 11in;
                    margin: 0;
                    overflow: hidden;
                    position: relative;
                    font-size: 10px;
                }
                .pre-panel {
                    padding: .28in .34in;
                    background: #fff;
                }
                .pre-header {
                    display: grid;
                    grid-template-columns: 48px 1fr 48px;
                    align-items: center;
                    gap: 10px;
                    margin-bottom: 16px;
                }
                .logo {
                    width: 44px;
                    height: 44px;
                    object-fit: contain;
                }
                .abc-img {
                    width: 46px;
                    justify-self: end;
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
                    font-size: 13px;
                    margin-top: 3px;
                    text-transform: uppercase;
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
                table {
                    width: 100%;
                    border-collapse: collapse;
                    table-layout: fixed;
                    background: #fff;
                }
                th, td {
                    border: 1.5px solid #111;
                    padding: 5px 4px;
                    text-align: center;
                    font-size: 9.5px;
                    height: 28px;
                    line-height: 1.08;
                }
                th {
                    background: #ea9aa6;
                    font-weight: 900;
                }
                .learning-col {
                    width: 42%;
                    font-weight: 900;
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
                    border: 1.5px solid #111;
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
                .feedback-line,
                .remark-writing-line,
                .play-writing-line {
                    border-bottom: 1px solid #111;
                }
                .feedback-line {
                    min-height: 18px;
                    margin-bottom: 9px;
                    font-size: 10px;
                    font-weight: 400;
                    text-transform: none;
                }
                .book-img {
                    position: absolute;
                    width: 64px;
                    right: .32in;
                    bottom: .28in;
                }
                .remarks-panel {
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
                    font-weight: 500;
                    text-transform: uppercase;
                }
                .remarks-logo {
                    position: absolute;
                    left: .18in;
                    top: .18in;
                    width: 48px;
                }
                .quarter-block {
                    margin-bottom: 26px;
                }
                .quarter-label {
                    font-size: 13px;
                    font-weight: 900;
                    text-transform: uppercase;
                    margin-bottom: 12px;
                }
                .remark-writing-line {
                    min-height: 20px;
                    margin-bottom: 10px;
                    font-size: 10px;
                }
                .play-panel {
                    padding: .45in .55in;
                    background: #fff;
                    color: #000;
                }
                .play-logo {
                    position: absolute;
                    left: .55in;
                    top: .45in;
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
                    margin: .03in 0 .18in;
                }
                .play-info {
                    width: 3.75in;
                    margin: 0 0 .14in .52in;
                    font-size: 11px;
                    line-height: 1.15;
                }
                .play-line {
                    display: inline-block;
                    border-bottom: 1px solid #000;
                    min-width: 1.36in;
                    height: 14px;
                    vertical-align: bottom;
                    padding: 0 2px;
                }
                .play-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: .14in .24in;
                }
                .play-grid-top-summary {
                    grid-column: 1 / -1;
                    margin-bottom: 0;
                }
                .play-section h2 {
                    color: #000;
                    font-size: 14px;
                    line-height: 1.05;
                    font-weight: 800;
                    margin: 0 0 4px;
                }
                .play-check {
                    display: grid;
                    grid-template-columns: 12px 1fr;
                    gap: 4px;
                    align-items: start;
                    font-size: 10.8px;
                    line-height: 1.14;
                    margin: 2px 0;
                }
                .play-density-comfortable .play-check {
                    font-size: 11.5px;
                    line-height: 1.16;
                    margin: 3px 0;
                }
                .play-density-compact .play-check {
                    font-size: 9.8px;
                    line-height: 1.08;
                    margin: 1px 0;
                }
                .play-check span:last-child {
                    display: block;
                    padding-bottom: 0;
                }
                .play-box {
                    width: 10px;
                    height: 10px;
                    border: 1px solid #000;
                    margin-top: 1px;
                    position: relative;
                }
                .play-box.checked::after {
                    content: "";
                    position: absolute;
                    left: 2px;
                    top: -3px;
                    width: 5px;
                    height: 11px;
                    border-right: 1px solid #000;
                    border-bottom: 1px solid #000;
                    transform: rotate(42deg);
                }
                .play-back-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: .22in;
                    padding-top: .2in;
                }
                .play-column-stack {
                    display: grid;
                    gap: .1in;
                    align-content: start;
                }
                .play-summary-panel {
                    margin-bottom: .14in;
                    border: 1px solid #000;
                    background: #fff;
                }
                .play-summary-head {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 8px;
                    padding: 6px 8px;
                    background: #fff;
                    border-bottom: 1px solid #000;
                }
                .play-summary-title {
                    color: #000;
                    font-size: 10px;
                    font-weight: 800;
                    text-transform: uppercase;
                }
                .play-summary-age {
                    font-size: 8px;
                    color: #000;
                }
                .play-summary-badge {
                    font-size: 8px;
                    font-weight: 700;
                    text-transform: uppercase;
                    color: #000;
                }
                .play-summary-table th,
                .play-summary-table td {
                    font-size: 9px;
                    line-height: 1.1;
                    height: auto;
                    padding: 4px 3px;
                }
                .play-summary-table th {
                    background: #fff;
                    color: #000;
                }
                .play-summary-table td:first-child {
                    text-align: left;
                    font-weight: 700;
                }
                .play-summary-label {
                    color: #000;
                    font-weight: 800;
                }
                .play-comments-title,
                .play-signature {
                    color: #000;
                    font-size: 13px;
                    font-weight: 800;
                    margin-bottom: .1in;
                }
                .play-comments-block {
                    margin-top: .08in;
                    align-self: start;
                    break-inside: avoid;
                }
                .play-writing-line {
                    height: .22in;
                    font-size: 9px;
                }
                .play-progress {
                    margin-top: .26in;
                }
                .play-signature {
                    margin-top: .45in;
                }
                @media print {
                    .pdf-sheet { background: #fff; }
                }
            </style>
            <div class="pdf-sheet">
            ${usesEccdChecklist
                ? createPrintablePlaySchool(details, learningAreas, quarters, selectedQuarter, logoUrl, transmutationTables, standardScoreRows, interpretations)
                : createPrintablePreschool(details, learningAreas, quarters, logoUrl, abcUrl, bookUrl)}
            </div>
    `;

    document.body.appendChild(pdfHost);
    const pdfSheet = pdfHost.querySelector('.pdf-sheet');

    try {
        await waitForImages(pdfSheet);
        const jsPDF = window.jspdf?.jsPDF || window.jsPDF;

        if (!jsPDF) {
            throw new Error('jsPDF is not available.');
        }

        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'in',
            format: 'letter',
            compress: true
        });

        const pages = Array.from(pdfSheet.querySelectorAll('.sheet-panel'));
        for (let index = 0; index < pages.length; index += 1) {
            const page = pages[index];
            const canvas = await window.html2canvas(page, {
                scale: 3,
                useCORS: true,
                backgroundColor: '#ffffff',
                width: page.offsetWidth,
                height: page.offsetHeight,
                windowWidth: page.scrollWidth,
                windowHeight: page.scrollHeight
            });

            if (index > 0) pdf.addPage('letter', 'portrait');
            pdf.addImage(canvas.toDataURL('image/jpeg', 0.98), 'JPEG', 0, 0, 8.5, 11);
        }
        pdf.save(createReportCardFilename(details, selectedQuarter));
        Swal.close();
    } catch (error) {
        console.error('Error generating report card PDF:', error);
        Swal.fire('Download Error', 'Unable to generate the PDF right now.', 'error');
    } finally {
        pdfHost.remove();
    }
}

function createPrintablePreschool(details, learningAreas, quarters, logoUrl, abcUrl, bookUrl) {
    const firstSavedQuarter = getStudentQuarterNumbers().find(quarter => quarters[String(quarter)]) || 1;
    const current = quarters[String(firstSavedQuarter)] || {};

    return `
        <section class="sheet-panel pre-panel">
            <div class="pre-header">
                <img class="logo" src="${logoUrl}" alt="">
                <div class="title-cloud">
                    <h1>Preschool</h1>
                    <div>Report Card</div>
                </div>
                <img class="abc-img" src="${abcUrl}" alt="">
            </div>

            <div class="info-grid">
                <div class="line-field"><span>Student:</span><span>${escapeHtml(details.student_name || '')}</span></div>
                <div class="line-field"><span>Section:</span><span>${escapeHtml(details.section_name || '')}</span></div>
                <div class="line-field"><span>Class Adviser:</span><span>${escapeHtml(details.section_teacher || '')}</span></div>
                <div class="line-field"><span>School Year:</span><span>${escapeHtml(details.school_year || '')}</span></div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th class="learning-col">Learning</th>
                        ${getStudentQuarterNumbers().map(quarter => `<th>${escapeHtml(getStudentQuarterLabel(quarter, true))}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${learningAreas.map(area => `
                        <tr>
                            <td class="learning-col">${escapeHtml(area.label)}</td>
                            ${getStudentQuarterNumbers().map(quarter => `<td>${escapeHtml(getQuarterGrade(quarters[String(quarter)], area))}</td>`).join('')}
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
                <div class="feedback-line">${escapeHtml(current.remarks || '')}</div>
                <div class="feedback-line"></div>
                <div class="feedback-line"></div>
            </div>
            <img class="book-img" src="${bookUrl}" alt="">
        </section>
        <section class="sheet-panel pre-panel remarks-panel">
            <img class="remarks-logo" src="${logoUrl}" alt="">
            <div class="remarks-title">Feedback & Remarks</div>
            ${getStudentQuarterNumbers().map(quarter => `
                <div class="quarter-block">
                    <div class="quarter-label">${escapeHtml(getStudentQuarterLabel(quarter))}</div>
                <div class="remark-writing-line">${escapeHtml(getQuarterRemarksText(quarters[String(quarter)]) || '')}</div>
                    <div class="remark-writing-line"></div>
                    <div class="remark-writing-line"></div>
                </div>
            `).join('')}
        </section>
    `;
}

function createPrintablePlaySchool(
    details,
    learningAreas,
    quarters,
    selectedQuarter,
    logoUrl,
    transmutationTables = [],
    standardScoreRows = [],
    interpretations = {}
) {
    const displayQuarters = [...getStudentQuarterNumbers(), getStudentFinalQuarter()];
    const quarter = quarters[String(selectedQuarter)] ? selectedQuarter : (displayQuarters.find(item => quarters[String(item)]) || 1);
    const quarterData = quarters[String(quarter)] || {};
    const isFinal = quarter === getStudentFinalQuarter();
    const groups = createPlayChecklistGroups(learningAreas, quarterData, {
        onlyItemsIntroducedThisQuarter: !isFinal
    }).filter(group => Array.isArray(group.items) && group.items.length > 0);
    const summary = isFinal
        ? getPlaySchoolFinalEccdSummary(learningAreas, quarters, transmutationTables, standardScoreRows, interpretations)
        : getPlaySchoolQuarterEccdSummary(learningAreas, quarterData, transmutationTables, standardScoreRows, interpretations, {
            onlyItemsIntroducedThisQuarter: true
        });
    const totalItems = groups.reduce((total, group) => total + group.items.length, 0);
    const densityClass = totalItems <= 35
        ? 'play-density-comfortable'
        : totalItems > 60 ? 'play-density-compact' : 'play-density-regular';
    const { firstPageGroups, secondPageGroups } = splitPrintableGroupsForPortrait(
        groups,
        totalItems,
        hasPlaySummaryScores(summary)
    );

    return `
        <section class="sheet-panel play-panel ${densityClass}">
            <img class="play-logo" src="${logoUrl}" alt="">
            <div class="play-title">ECCD Child's Record 2<br>Checklist</div>
            <div class="play-info">
                <div>Child Name: <span class="play-line">${escapeHtml(details.student_name || '')}</span></div>
                <div>Age: <span class="play-line">${escapeHtml(formatPlaySchoolAgeKey(getQuarterRemarksPayload(quarterData)?.play_eccd?.age_key || ''))}</span></div>
                <div>Observation Period: <span class="play-line">${escapeHtml(getStudentDisplayQuarterLabel(quarter))}</span></div>
                <div>Teacher: <span class="play-line">${escapeHtml(quarterData.teacher_name || details.section_teacher || '')}</span></div>
            </div>
            <div class="play-grid">
                <div class="play-grid-top-summary">
                    ${createPrintablePlaySummary(summary)}
                </div>
                ${firstPageGroups.map(createPrintablePlayGroup).join('')}
                ${secondPageGroups.length === 0 ? createPrintablePlayComments(quarterData) : ''}
            </div>
        </section>
        ${secondPageGroups.length ? `
            <section class="sheet-panel play-panel ${densityClass}">
                <div class="play-grid">
                    ${secondPageGroups.map(createPrintablePlayGroup).join('')}
                    ${createPrintablePlayComments(quarterData)}
                </div>
            </section>
        ` : ''}
    `;
}

function splitPrintableGroupsForPortrait(groups, totalItems = 0, hasSummary = true) {
    const firstPageGroups = [];
    const secondPageGroups = [];
    const baseCapacity = totalItems <= 35 ? 28 : totalItems > 60 ? 40 : 34;
    const firstPageCapacity = baseCapacity + (hasSummary ? 0 : 12);
    let usedCapacity = 0;

    for (let index = 0; index < groups.length; index += 2) {
        const pair = groups.slice(index, index + 2);
        const pairCapacity = Math.max(...pair.map(group => group.items.length), 0) + 2;

        if (firstPageGroups.length === 0 || usedCapacity + pairCapacity <= firstPageCapacity) {
            firstPageGroups.push(...pair);
            usedCapacity += pairCapacity;
        } else {
            secondPageGroups.push(...pair);
        }
    }

    return { firstPageGroups, secondPageGroups };
}

function createPrintablePlayComments(quarterData) {
    const comments = getQuarterRemarksText(quarterData);
    const lineCount = comments ? 3 : 1;

    return `
        <div class="play-comments-block">
            <div class="play-comments-title">Teacher's Comments:</div>
            ${createPrintableCommentLines(comments, lineCount)}
            <div class="play-signature">Teacher's Signature:<span class="play-line" style="min-width:1.35in;"></span></div>
            <div class="play-signature" style="margin-top:.35in;">Date:<span class="play-line" style="min-width:1.35in;"></span></div>
        </div>
    `;
}

function createPrintablePlaySummary(summary) {
    const hasAge = Boolean(summary?.age_key);
    const domains = Array.isArray(summary?.domains) ? summary.domains : [];
    const hasScores = hasPlaySummaryScores(summary);

    if (!hasScores) return '';
    if (summary.is_final) return createPrintablePlayFinalSummary(summary);

    return `
        <div class="play-summary-panel">
            <div class="play-summary-head">
                <div>
                    <div class="play-summary-title">ECCD Summary</div>
                    <div class="play-summary-age">${hasAge ? `Age table: ${escapeHtml(formatPlaySchoolAgeKey(summary.age_key))}` : 'Age table not saved'}</div>
                </div>
                <div class="play-summary-badge">${escapeHtml(summary?.interpretation || 'Incomplete')}</div>
            </div>
            <table class="play-summary-table">
                <thead>
                    <tr>
                        <th>Domain</th>
                        <th>Raw</th>
                        <th>Scaled</th>
                    </tr>
                </thead>
                <tbody>
                    ${domains.map(domain => `
                        <tr>
                            <td>${escapeHtml(domain.label)}</td>
                            <td>${escapeHtml(domain.raw_score)}</td>
                            <td>${escapeHtml(domain.scaled_score)}</td>
                        </tr>
                    `).join('')}
                    <tr>
                        <td class="play-summary-label">Sum of Scaled Scores</td>
                        <td></td>
                        <td>${escapeHtml(summary?.sum_scaled_scores || '-')}</td>
                    </tr>
                    <tr>
                        <td class="play-summary-label">Standard Score</td>
                        <td></td>
                        <td>${escapeHtml(summary?.standard_score || '-')}</td>
                    </tr>
                    <tr>
                        <td class="play-summary-label">Interpretation</td>
                        <td colspan="2">${escapeHtml(summary?.interpretation || '-')}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;
}

function createPrintablePlayFinalSummary(summary) {
    const summaryQuarterLabels = getStudentQuarterNumbers().map(quarter => getStudentQuarterLabel(quarter));

    return `
        <div class="play-summary-panel">
            <table class="play-summary-table">
                <thead>
                    <tr>
                        <th rowspan="2" style="background:#07146d;color:#fff;">Domain</th>
                        ${summaryQuarterLabels.map((label, index) => `
                            <th style="color:#07146d;">
                                ${label}${summary.quarter_dates?.[index] ? `<br><span style="font-size:7px;font-weight:400;">${escapeHtml(summary.quarter_dates[index])}</span>` : ''}
                            </th>
                        `).join('')}
                        <th colspan="2" style="color:#07146d;">Final</th>
                    </tr>
                    <tr>
                        ${Array.from({ length: summaryQuarterLabels.length + 1 }, () => '<th style="background:#ff1010;color:#fff;">Raw Score</th>').join('')}
                        <th style="background:#ff1010;color:#fff;">Scaled Score</th>
                    </tr>
                </thead>
                <tbody>
                    ${summary.domains.map(domain => `
                        <tr>
                            <td>${escapeHtml(domain.label)}</td>
                            ${(domain.quarter_raw_scores || []).map(score => `<td>${escapeHtml(score)}</td>`).join('')}
                            <td>${escapeHtml(domain.raw_score)}</td>
                            <td style="background:#fff0d8;color:#b45309;font-weight:800;">${escapeHtml(domain.scaled_score)}</td>
                        </tr>
                    `).join('')}
                    ${createPlaySchoolFinalEccdSummaryRows(summary)}
                </tbody>
            </table>
        </div>
    `;
}

function hasMeaningfulReportValue(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized !== '' && normalized !== '-' && normalized !== 'n/a' && normalized !== 'null';
}

function hasPlaySummaryScores(summary) {
    const domains = Array.isArray(summary?.domains) ? summary.domains : [];
    return domains.some(domain =>
        hasMeaningfulReportValue(domain.raw_score) || hasMeaningfulReportValue(domain.scaled_score)
    ) || hasMeaningfulReportValue(summary?.sum_scaled_scores) || hasMeaningfulReportValue(summary?.standard_score);
}

function normalizePrintableGroupTitle(title) {
    return String(title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

function splitPrintableGroup(group, keepCount = 13) {
    const items = Array.isArray(group?.items) ? group.items : [];

    if (items.length <= keepCount) {
        return {
            primary: group,
            overflow: null
        };
    }

    return {
        primary: {
            ...group,
            items: items.slice(0, keepCount)
        },
        overflow: {
            ...group,
            title: group.title,
            items: items.slice(keepCount)
        }
    };
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

function createPrintableCommentLines(comment, count) {
    const words = String(comment || '').trim().split(/\s+/).filter(Boolean);
    const lines = [];
    const wordsPerLine = 7;

    for (let index = 0; index < count; index++) {
        lines.push(words.slice(index * wordsPerLine, (index + 1) * wordsPerLine).join(' '));
    }

    return lines.map(line => `<div class="play-writing-line">${escapeHtml(line)}</div>`).join('');
}

function ensureHtml2Pdf() {
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

function createReportCardFilename(details, selectedQuarter) {
    const studentName = String(details.student_name || 'student')
        .trim()
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase() || 'student';
    const programName = String(details.program_name || 'report_card')
        .trim()
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase() || 'report_card';

    return `${studentName}_${programName}_q${selectedQuarter}_report_card.pdf`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
