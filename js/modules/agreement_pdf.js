export function downloadAgreementPdf({pending = [], accepted = []}, reference = '') {
    const JsPDF = window.jspdf?.jsPDF;
    if (!JsPDF) throw new Error('The PDF download could not load. Refresh the page and try again.');
    const pdf = new JsPDF({unit:'mm', format:'a4'});
    const margin = 18;
    const width = pdf.internal.pageSize.getWidth() - margin * 2;
    const bottom = pdf.internal.pageSize.getHeight() - margin;
    let y = margin;
    function text(value, size = 11, bold = false) {
        pdf.setFont('helvetica', bold ? 'bold' : 'normal');
        pdf.setFontSize(size);
        const lines = pdf.splitTextToSize(String(value ?? '').replace(/\r\n/g, '\n'), width);
        const lineHeight = size * 0.45;
        for (const line of lines) {
            if (y + lineHeight > bottom) { pdf.addPage(); y = margin; }
            pdf.text(line, margin, y);
            y += lineHeight;
        }
        y += 3;
    }
    text('CDO Tutor - Enrollment Agreements', 18, true);
    if (reference) text(reference);
    if (pending.length) {
        text('Awaiting parent agreement', 14, true);
        for (const template of pending) {
            text(template.title, 12, true);
            for (const clause of template.clauses) text(`[ ] ${clause.clause_text}${Number(clause.is_required) ? ' (required)' : ' (optional)'}`);
        }
    }
    text('Accepted agreements', 14, true);
    if (!accepted.length) text('No accepted agreement is recorded.');
    for (const record of accepted) {
        text(record.snapshot.title, 12, true);
        if (record.application_number) text(`Application: ${record.application_number}`);
        text(`Setup: ${record.tutorial_setup}`);
        text(`Accepted by: ${record.guardian_name}`);
        text(`Accepted on: ${record.accepted_at} (Asia/Manila)`);
        const checked = record.checked_clause_ids.map(Number);
        for (const clause of record.snapshot.clauses) text(`[${checked.includes(Number(clause.clause_id)) ? 'x' : ' '}] ${clause.clause_text}`);
    }
    const suffix = String(reference).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '');
    pdf.save(`agreements${suffix ? '-' + suffix : ''}.pdf`);
}
