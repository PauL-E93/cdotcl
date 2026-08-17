// js/modules/orf.js

const ORF_THEME = '#000';
const ORF_LINE = '#000';
const ORF_HEADER = '#fff';

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value, options = {}) {
    const date = parseDate(value);
    if (!date) return value || 'N/A';

    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        ...options
    });
}

function formatScheduleDate(value, day) {
    const date = parseDate(value);
    if (!date) return day || 'N/A';

    const baseDate = formatDate(value);
    const dayLabel = date.toLocaleDateString('en-US', { weekday: 'short' });
    return `${baseDate} (${dayLabel})`;
}

function formatTime(value) {
    if (!value) return '';
    const normalized = value.toString().trim();
    const match = normalized.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return normalized;

    let hour = Number(match[1]);
    const minute = match[2];
    const suffix = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    return `${hour}:${minute} ${suffix}`;
}

function formatMoney(value) {
    const amount = Number(value) || 0;
    return `₱${amount.toLocaleString('en-PH', {
        minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
        maximumFractionDigits: 2
    })}`;
}

function getStudentName(details) {
    return [details.first_name, details.last_name, details.ext]
        .filter(part => part && part.toString().trim())
        .map(part => part.toString().trim())
        .join(' ')
        || details.student_name
        || 'N/A';
}

function formatMoneyBw(value) {
    const amount = Number(value) || 0;
    return `PHP ${amount.toLocaleString('en-PH', {
        minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
        maximumFractionDigits: 2
    })}`;
}

function getAddress(details) {
    const address = [details.adr_street, details.adr_barangay, details.adr_city, details.adr_province]
        .filter(part => part && part.toString().trim())
        .map(part => part.toString().trim())
        .join(', ');

    return {
        line: address || 'N/A',
        note: details.adr_note ? details.adr_note.toString().trim() : ''
    };
}

function getScheduleRows(schedules = []) {
    if (!schedules.length) {
        return `
            <tr>
                <td colspan="2" class="orf-empty">No schedule assigned</td>
            </tr>
        `;
    }

    return schedules.map(schedule => {
        const date = formatScheduleDate(schedule.date, schedule.day);
        const start = formatTime(schedule.start_time || schedule.start || schedule.time);
        const end = formatTime(schedule.end_time || schedule.end || schedule.endTime);
        const time = end ? `${start} - ${end}` : (start || 'N/A');

        return `
            <tr>
                <td>${escapeHtml(date)}</td>
                <td>${escapeHtml(time)}</td>
            </tr>
        `;
    }).join('');
}

function getBillingRows(schedule = []) {
    if (!schedule.length) {
        return `
            <tr>
                <td colspan="3" class="orf-empty">No billing statement found</td>
            </tr>
        `;
    }

    return schedule.map(item => `
        <tr>
            <td class="orf-strong">${escapeHtml(item.billing_type || 'N/A')}</td>
            <td class="orf-strong">${escapeHtml(formatMoneyBw(item.amount || item.total_amount))}</td>
            <td>${escapeHtml(formatDate(item.due_date))}</td>
        </tr>
    `).join('');
}

function getPrePlayBillingSummary(billing = {}, miscItems = []) {
    const schedule = billing.schedule || [];
    const tuitionRows = schedule.filter(item => {
        const type = (item.billing_type || '').toLowerCase();
        return type.startsWith('month');
    });
    const miscRows = schedule.filter(item => {
        const type = (item.billing_type || '').toLowerCase();
        return type.includes('misc');
    });
    const monthlyAmount = Number(billing.month1_amount) || Number(tuitionRows[0]?.amount) || 0;
    const tuitionAmount = tuitionRows.reduce((sum, item) => sum + (Number(item.amount || item.total_amount) || 0), 0);
    const itemizedMiscAmount = miscItems.reduce((sum, item) => sum + (Number(item.price || item.amount || item.total_amount) || 0), 0);
    const miscAmount = itemizedMiscAmount || Number(billing.misc_amount) || miscRows.reduce((sum, item) => sum + (Number(item.amount || item.total_amount) || 0), 0);
    const grandTotal = Number(billing.total_amount) || tuitionAmount + miscAmount;

    return { tuitionAmount, monthlyAmount, miscAmount, grandTotal };
}

function getMiscRows(miscItems = [], fallbackAmount = 0) {
    if (miscItems.length > 0) {
        return miscItems.map((item, index) => `
            <tr>
                <td>${index === 0 ? 'Other fees' : '-'}</td>
                <td>${escapeHtml(item.product_name || item.name || 'Miscellaneous')}</td>
                <td>${escapeHtml(formatMoneyBw(item.price || item.amount || item.total_amount))}</td>
            </tr>
        `).join('');
    }

    return `
        <tr>
            <td>Others</td>
            <td>Miscellaneous</td>
            <td>${escapeHtml(formatMoneyBw(fallbackAmount))}</td>
        </tr>
    `;
}

function buildBillingSection({ billing, isPrePlay, totalAmount, miscItems = [] }) {
    if (isPrePlay) {
        const summary = getPrePlayBillingSummary(billing, miscItems);
        return `
            <section class="orf-card">
                <div class="orf-band">Billing Statement</div>
                <table>
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th>Particular</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="orf-strong">Total Tuition</td>
                            <td class="orf-strong">
                                 ${escapeHtml(formatMoneyBw(summary.monthlyAmount))}
                                 <div class="orf-subtext">payable per month</div>
                               
                            </td>
                            <td class="orf-strong">
                                
                                
                                  ${escapeHtml(formatMoneyBw(summary.tuitionAmount))}
                                <div class="orf-subtext">divided by 10 months</div>
                            </td>
                        </tr>
                        ${getMiscRows(miscItems, summary.miscAmount)}
                    </tbody>
                </table>
                <div class="orf-total">
                    <span>Grand Total</span>
                    <span class="orf-total-amount">${escapeHtml(formatMoneyBw(summary.grandTotal))}</span>
                </div>
            </section>
        `;
    }

    return `
        <section class="orf-card">
            <div class="orf-band">Billing Statement</div>
            <table>
                <thead>
                    <tr>
                        <th>Payment Type</th>
                        <th>Amount</th>
                        <th>Due Date</th>
                    </tr>
                </thead>
                <tbody>${getBillingRows(billing.schedule || [])}</tbody>
            </table>
            <div class="orf-total">
                <span>Total Amount</span>
                <span class="orf-total-amount">${escapeHtml(formatMoneyBw(totalAmount))}</span>
            </div>
        </section>
    `;
}

function formatScheduleText(schedules = []) {
    if (!schedules.length) return 'Not set';

    return schedules.map(schedule => {
        const day = schedule.day || schedule.day_of_week || '';
        const start = formatTime(schedule.start_time || schedule.start || schedule.time);
        const end = formatTime(schedule.end_time || schedule.end || schedule.endTime);
        const time = end ? `${start} - ${end}` : start;
        return `${day}${time ? ' ' + time : ''}`.trim();
    }).join(', ');
}

function getClassSectionRows(details, sectionSchedules = []) {
    const classLabel = details.class_id_from_section || details.class_id
        ? `Class ${details.class_id_from_section || details.class_id}`
        : 'N/A';
    const sectionLabel = details.section_name || 'N/A';
    const teacher = details.section_teacher_name || details.teacher_name || 'Not assigned';
    const scheduleText = formatScheduleText(sectionSchedules);

    return `
        <tr>
            <td class="orf-strong">${escapeHtml(classLabel)}</td>
            <td class="orf-strong">${escapeHtml(sectionLabel)}</td>
            <td>${escapeHtml(teacher)}</td>
            <td>${escapeHtml(scheduleText)}</td>
        </tr>
    `;
}

function buildMiddleSection({ details, schedules, sectionSchedules, isPrePlay }) {
    if (isPrePlay) {
        return `
            <section class="orf-card">
                <div class="orf-band">Class &amp; Section Details</div>
                <table>
                    <thead>
                        <tr>
                            <th>Class</th>
                            <th>Section</th>
                            <th>Teacher</th>
                            <th>Schedule</th>
                        </tr>
                    </thead>
                    <tbody>${getClassSectionRows(details, sectionSchedules)}</tbody>
                </table>
            </section>
        `;
    }

    return `
        <section class="orf-card orf-schedule-card">
            <div class="orf-band">Preferred Schedule</div>
            <table>
                <thead>
                    <tr>
                        <th>Date (Day of Week)</th>
                        <th>Time</th>
                    </tr>
                </thead>
                <tbody>${getScheduleRows(schedules)}</tbody>
            </table>
        </section>
    `;
}

function buildStudentInfoFields(details, isPrePlay) {
    const commonTop = `
        <div class="orf-field">
            <div class="orf-label">Student Name</div>
            <div class="orf-value">${escapeHtml(getStudentName(details))}</div>
        </div>
        ${isPrePlay ? `
            <div class="orf-field">
                <div class="orf-label">Student ID</div>
                <div class="orf-value">${escapeHtml(details.student_id_number || 'N/A')}</div>
            </div>
        ` : ''}
        <div class="orf-field">
            <div class="orf-label">Program</div>
            <div class="orf-value">${escapeHtml(details.program_name || 'Tutorial')}</div>
        </div>
    `;

    const tutorialOnly = isPrePlay ? '' : `
        <div class="orf-field">
            <div class="orf-label">Subject &amp; Grade</div>
            <div class="orf-value">${escapeHtml(`${details.subject_name || 'N/A'} (${details.grade_level || '?'})`)}</div>
        </div>
        <div class="orf-field">
            <div class="orf-label">Teacher</div>
            <div class="orf-value">${escapeHtml(details.teacher_name || 'Not assigned')}</div>
        </div>
    `;

    const sharedBottom = `
        <div class="orf-field">
            <div class="orf-label">Branch</div>
            <div class="orf-value">${escapeHtml(details.branch_name || 'N/A')}</div>
        </div>
        <div class="orf-field">
            <div class="orf-label">School Year</div>
            <div class="orf-value">${escapeHtml(details.school_year_label || 'N/A')}</div>
        </div>
        <div class="orf-field">
            <div class="orf-label">Status</div>
            <div class="orf-value">${escapeHtml((details.status || 'N/A').toUpperCase())}</div>
        </div>
    `;

    const goal = isPrePlay ? `
        <div class="orf-field">
            <div class="orf-label">Teacher</div>
            <div class="orf-value">${escapeHtml(details.section_teacher_name || details.teacher_name || 'Not assigned')}</div>
        </div>
    ` : `
        <div class="orf-field">
            <div class="orf-label">Goal</div>
            <div class="orf-value orf-normal"><em>${escapeHtml(details.goal || 'No goal set')}</em></div>
        </div>
    `;

    return commonTop + tutorialOnly + sharedBottom + goal;
}

function buildOrfMarkup({ details, schedules, sectionSchedules, billing, miscItems, variant, autoPrint = true }) {
    const address = getAddress(details);
    const billingSchedule = billing.schedule || [];
    const programName = (details.program_name || '').toLowerCase();
    const isPrePlay = variant === 'preplay'
        || programName.includes('preschool')
        || programName.includes('playschool')
        || programName.includes('pre-school')
        || programName.includes('play-school')
        || programName.includes('pre school')
        || programName.includes('play school');
    const totalAmount = billing.total_amount ?? details.total_fee ?? billingSchedule.reduce((sum, item) => {
        return sum + (Number(item.amount || item.total_amount) || 0);
    }, 0);

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>ORF - ${escapeHtml(getStudentName(details))}</title>
            <style>
                * {
                    box-sizing: border-box;
                }

                body {
                    margin: 0;
                    background: #fff;
                    color: ${ORF_THEME};
                    font-family: Arial, Helvetica, sans-serif;
                }

                .orf-page {
                    width: 7.8in;
                    min-height: 5in;
                    margin: 0 auto;
                    padding: 0.1in;
                }

                .orf-top {
                    display: grid;
                    grid-template-columns: 1.35in minmax(0, 1fr) 1.35in;
                    align-items: start;
                    gap: 0.1in;
                    min-height: 0.56in;
                    margin-bottom: 0.07in;
                }

                .orf-logo-space {
                    min-height: 0.45in;
                }

                .orf-title {
                    margin: 0;
                    text-align: center;
                    font-family: Georgia, 'Times New Roman', serif;
                    font-size: 0.34in;
                    line-height: 0.9;
                    letter-spacing: 0;
                    color: ${ORF_THEME};
                    font-weight: 700;
                    white-space: nowrap;
                }

                .orf-meta {
                    border: 2px solid ${ORF_LINE};
                    border-radius: 4px;
                    padding: 0.09in 0.1in;
                    min-height: 0.54in;
                    display: grid;
                    align-content: center;
                    gap: 0.07in;
                    font-size: 0.1in;
                    font-weight: 700;
                }

                .orf-meta-row {
                    display: grid;
                    grid-template-columns: max-content 1fr;
                    gap: 0.06in;
                    align-items: end;
                }

                .orf-line {
                    border-bottom: 2px solid ${ORF_THEME};
                    min-height: 0.1in;
                }

                .orf-card {
                    border: 2px solid ${ORF_LINE};
                    border-radius: 4px;
                    overflow: hidden;
                    margin-bottom: 0.07in;
                    break-inside: avoid;
                    page-break-inside: avoid;
                }

                .orf-band {
                    background: ${ORF_HEADER};
                    color: ${ORF_THEME};
                    padding: 0.04in 0.09in;
                    font-size: 0.13in;
                    line-height: 1.15;
                    font-weight: 800;
                    text-transform: uppercase;
                }

                .orf-info-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                }

                .orf-field {
                    min-height: 0.38in;
                    padding: 0.06in 0.09in 0.05in;
                    border-top: 2px solid ${ORF_LINE};
                }

                .orf-field:nth-child(odd) {
                    border-right: 2px solid ${ORF_LINE};
                }

                .orf-field.orf-address {
                    grid-column: 1 / -1;
                    min-height: 0.46in;
                    border-right: 0;
                }

                .orf-label {
                    margin-bottom: 0.03in;
                    font-size: 0.1in;
                    line-height: 1;
                    font-weight: 400;
                }

                .orf-value {
                    font-size: 0.12in;
                    line-height: 1.15;
                    font-weight: 800;
                    overflow-wrap: anywhere;
                }

                .orf-value.orf-normal {
                    font-weight: 400;
                }

                .orf-note {
                    margin-top: 0.03in;
                    font-size: 0.1in;
                    font-weight: 400;
                }

                .orf-bottom {
                    display: block;
                }

                table {
                    width: 100%;
                    border-collapse: collapse;
                    table-layout: fixed;
                    color: ${ORF_THEME};
                }

                .orf-schedule-card table {
                    min-height: auto;
                }

                th,
                td {
                    border-top: 2px solid ${ORF_LINE};
                    border-right: 2px solid ${ORF_LINE};
                    border-bottom: 0;
                    padding: 0.045in 0.06in;
                    text-align: center;
                    vertical-align: middle;
                    font-size: 0.1in;
                    line-height: 1.15;
                }

                th:last-child,
                td:last-child {
                    border-right: 0;
                }

                tbody tr:last-child td {
                    border-bottom: 0;
                }

                th {
                    font-weight: 800;
                }

                td {
                    font-weight: 400;
                }

                .orf-strong {
                    font-weight: 800;
                }

                .orf-empty {
                    height: 0.34in;
                    font-style: italic;
                }

                .orf-total {
                    display: grid;
                    grid-template-columns: 1fr max-content;
                    align-items: center;
                    border-top: 2px solid ${ORF_LINE};
                    padding: 0.06in 0.1in;
                    font-size: 0.12in;
                    font-weight: 800;
                }

                .orf-total-amount {
                    font-size: 0.15in;
                }

                .orf-subtext {
                    margin-top: 0.01in;
                    font-size: 0.075in;
                    line-height: 1.1;
                    font-weight: 400;
                }

                @media print {
                    @page {
                        size: letter portrait;
                        margin: 0.25in;
                    }

                    html,
                    body {
                        width: 8.5in;
                        height: 11in;
                    }

                    .orf-page {
                        width: 7.5in;
                        min-height: 5in;
                        padding: 0;
                        margin: 0 auto;
                        page-break-after: avoid;
                    }
                }
            </style>
        </head>
        <body>
            <main class="orf-page">
                <header class="orf-top">
                    <div class="orf-logo-space"></div>
                    <h1 class="orf-title">CDO TUTORIAL</h1>
                    <div class="orf-meta">
                        <div class="orf-meta-row">
                            <span>ORF No.</span>
                            <span class="orf-line"></span>
                        </div>
                        <div class="orf-meta-row">
                            <span>Date</span>
                            <span class="orf-line">${escapeHtml(formatDate(new Date()))}</span>
                        </div>
                    </div>
                </header>

                <section class="orf-card">
                    <div class="orf-band">Student Information</div>
                    <div class="orf-info-grid">
                        ${buildStudentInfoFields(details, isPrePlay)}
                        <div class="orf-field orf-address">
                            <div class="orf-label">Address</div>
                            <div class="orf-value">${escapeHtml(address.line)}</div>
                            ${address.note ? `<div class="orf-note">${escapeHtml(address.note)}</div>` : ''}
                        </div>
                    </div>
                </section>

                <div class="orf-bottom">
                    ${buildMiddleSection({ details, schedules, sectionSchedules, isPrePlay })}
                    ${buildBillingSection({ billing, isPrePlay, totalAmount, miscItems })}
                </div>
            </main>
            ${autoPrint ? `
            <script>
                window.addEventListener('load', function() {
                    window.print();
                });
            </script>
            ` : ''}
        </body>
        </html>
    `;
}

function loadScriptOnce(src, id) {
    return new Promise((resolve, reject) => {
        if (document.getElementById(id)) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.id = id;
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
}

async function ensurePdfLibraries() {
    if (window.html2canvas && (window.jspdf?.jsPDF || window.jsPDF)) {
        return;
    }

    await Promise.all([
        loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', 'html2canvas-loader'),
        loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'jspdf-loader')
    ]);

    if (!window.html2canvas || !(window.jspdf?.jsPDF || window.jsPDF)) {
        throw new Error('PDF libraries are not available.');
    }
}

function waitForImages(root) {
    const images = Array.from(root.querySelectorAll('img'));
    return Promise.all(images.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
            img.onload = resolve;
            img.onerror = resolve;
        });
    }));
}

function getOrfFilename(details, variant) {
    const studentName = getStudentName(details).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'student';
    const program = (details.program_name || variant || 'orf').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'orf';
    return `${studentName}_${program}_orf.pdf`;
}

function getOrfData(enrollmentId, variant = 'tutorial') {
    return Promise.all([
        axios.get(`../../api/admin/enrollment.php?operation=getEnrollmentDetails&id=${enrollmentId}`),
        axios.get(`../../api/admin/billing.php?operation=getBillingDetails&enrollment_id=${enrollmentId}`)
    ]).then(([enrollmentRes, billingRes]) => {
        if (enrollmentRes.data.status !== 'success') {
            throw new Error(enrollmentRes.data.message || 'Failed to load enrollment details.');
        }

        const details = enrollmentRes.data.data.details || {};
        const schedules = enrollmentRes.data.data.schedule || [];
        const sectionSchedules = enrollmentRes.data.data.section_schedule || [];
        const billing = billingRes.data.status === 'success' ? (billingRes.data.data || {}) : {};
        const programName = (details.program_name || '').toLowerCase();
        const isPrePlay = variant === 'preplay'
            || programName.includes('preschool')
            || programName.includes('playschool')
            || programName.includes('pre-school')
            || programName.includes('play-school')
            || programName.includes('pre school')
            || programName.includes('play school');
        const miscRequest = isPrePlay && details.program_id
            ? axios.get(`../../api/admin/program_products.php?operation=getProductsByProgram&program_id=${details.program_id}`)
            : Promise.resolve({ data: { status: 'success', data: [] } });

        return miscRequest.then(miscRes => ({
            details,
            schedules,
            sectionSchedules,
            billing,
            miscItems: miscRes.data.status === 'success' ? (miscRes.data.data || []) : []
        }));
    });
}

export function printORF(enrollmentId, variant = 'tutorial') {
    const printWindow = window.open('', '_blank', 'width=900,height=650');

    if (!printWindow) {
        return Swal.fire('Error', 'Please allow pop-ups to print the ORF.', 'error');
    }

    printWindow.document.open();
    printWindow.document.write('<!DOCTYPE html><html><head><title>Loading ORF</title></head><body style="font-family: Arial, Helvetica, sans-serif; padding: 24px;">Preparing ORF...</body></html>');
    printWindow.document.close();

    Promise.all([
        axios.get(`../../api/admin/enrollment.php?operation=getEnrollmentDetails&id=${enrollmentId}`),
        axios.get(`../../api/admin/billing.php?operation=getBillingDetails&enrollment_id=${enrollmentId}`)
    ])
        .then(([enrollmentRes, billingRes]) => {
            if (enrollmentRes.data.status !== 'success') {
                printWindow.close();
                return Swal.fire('Error', enrollmentRes.data.message || 'Failed to load enrollment details.', 'error');
            }

            const details = enrollmentRes.data.data.details || {};
            const schedules = enrollmentRes.data.data.schedule || [];
            const sectionSchedules = enrollmentRes.data.data.section_schedule || [];
            const billing = billingRes.data.status === 'success' ? (billingRes.data.data || {}) : {};
            const programName = (details.program_name || '').toLowerCase();
            const isPrePlay = variant === 'preplay'
                || programName.includes('preschool')
                || programName.includes('playschool')
                || programName.includes('pre-school')
                || programName.includes('play-school')
                || programName.includes('pre school')
                || programName.includes('play school');
            const miscRequest = isPrePlay && details.program_id
                ? axios.get(`../../api/admin/program_products.php?operation=getProductsByProgram&program_id=${details.program_id}`)
                : Promise.resolve({ data: { status: 'success', data: [] } });

            return miscRequest.then(miscRes => {
                const miscItems = miscRes.data.status === 'success' ? (miscRes.data.data || []) : [];

                printWindow.document.open();
                printWindow.document.write(buildOrfMarkup({ details, schedules, sectionSchedules, billing, miscItems, variant }));
                printWindow.document.close();
            });
        })
        .catch(err => {
            console.error('Error printing ORF:', err);
            printWindow.close();
            Swal.fire('Error', 'An error occurred while preparing the ORF.', 'error');
        });
}

window.printORF = printORF;

export async function downloadORF(enrollmentId, variant = 'tutorial') {
    let iframe = null;

    try {
        Swal.fire({
            title: 'Preparing ORF PDF...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        await ensurePdfLibraries();
        const orfData = await getOrfData(enrollmentId, variant);

        iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.left = '-10000px';
        iframe.style.top = '0';
        iframe.style.width = '8.5in';
        iframe.style.height = '11in';
        iframe.style.border = '0';
        document.body.appendChild(iframe);

        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        iframeDoc.open();
        iframeDoc.write(buildOrfMarkup({ ...orfData, variant, autoPrint: false }));
        iframeDoc.close();

        await new Promise(resolve => {
            iframe.onload = resolve;
            setTimeout(resolve, 300);
        });

        const orfPage = iframeDoc.querySelector('.orf-page');
        if (!orfPage) {
            throw new Error('ORF layout was not created.');
        }

        await waitForImages(orfPage);

        const canvas = await window.html2canvas(orfPage, {
            scale: 2,
            backgroundColor: '#ffffff',
            useCORS: true,
            width: orfPage.scrollWidth,
            height: orfPage.scrollHeight,
            windowWidth: orfPage.scrollWidth,
            windowHeight: orfPage.scrollHeight
        });

        const jsPDF = window.jspdf?.jsPDF || window.jsPDF;
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'in',
            format: 'letter'
        });

        const pageWidth = 8.5;
        const pageHeight = 11;
        const imageData = canvas.toDataURL('image/jpeg', 0.98);
        const imageRatio = canvas.width / canvas.height;
        let imageWidth = pageWidth;
        let imageHeight = imageWidth / imageRatio;

        if (imageHeight > pageHeight) {
            imageHeight = pageHeight;
            imageWidth = imageHeight * imageRatio;
        }

        const x = (pageWidth - imageWidth) / 2;
        pdf.addImage(imageData, 'JPEG', x, 0, imageWidth, imageHeight);
        pdf.save(getOrfFilename(orfData.details, variant));
        Swal.close();
    } catch (err) {
        console.error('Error downloading ORF:', err);
        Swal.fire('Error', err.message || 'An error occurred while downloading the ORF.', 'error');
    } finally {
        if (iframe) {
            iframe.remove();
        }
    }
}

window.downloadORF = downloadORF;
