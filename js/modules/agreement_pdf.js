export function downloadAgreementPdf({pending = [], accepted = []}, reference = '') {
    const JsPDF = window.jspdf?.jsPDF;
    if (!JsPDF) throw new Error('The PDF download could not load. Refresh the page and try again.');
    const pdf = new JsPDF({unit:'mm', format:'a4'});
    const margin = 18;
    const width = pdf.internal.pageSize.getWidth() - margin * 2;
    const bottom = pdf.internal.pageSize.getHeight() - margin;
    let y = margin;
    function text(value, size = 11, bold = false, checked = null) {
        pdf.setFont('helvetica', bold ? 'bold' : 'normal');
        pdf.setFontSize(size);
        const indent = checked === null ? 0 : 5;
        const lines = pdf.splitTextToSize(String(value ?? '').replace(/\r\n/g, '\n'), width - indent);
        const lineHeight = size * 0.45;
        for (const [index, line] of lines.entries()) {
            if (y + lineHeight > bottom) { pdf.addPage(); y = margin; }
            if (indent && index === 0) {
                // Draw the checkbox and tick so they do not depend on font glyph support.
                const top = y - 3;
                pdf.setLineWidth(0.3);
                pdf.rect(margin, top, 3, 3);
                if (checked) {
                    pdf.line(margin + 0.5, top + 1.5, margin + 1.2, top + 2.3);
                    pdf.line(margin + 1.2, top + 2.3, margin + 2.6, top + 0.6);
                }
            }
            pdf.text(line, margin + indent, y);
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
            for (const clause of template.clauses) text(`${clause.clause_text}${Number(clause.is_required) ? ' (required)' : ' (optional)'}`, 11, false, false);
        }
    }
    text('Accepted agreements', 14, true);
    if (!accepted.length) text('No accepted agreement is recorded.');
    for (const record of accepted) {
        text(record.snapshot.title, 12, true);
        if (record.application_number) text(`Application: ${record.application_number}`);
        text(`Setup: ${record.tutorial_setup}`);
        text(`Accepted by: ${record.guardian_name}`);
        const acceptedAt = String(record.accepted_at ?? '').replace(/\b([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?\b/, (_, hour, minute, seconds = '') => {
            const hourNumber = Number(hour);
            return `${hourNumber % 12 || 12}:${minute}${seconds} ${hourNumber >= 12 ? 'PM' : 'AM'}`;
        });
        text(`Accepted on: ${acceptedAt} (Asia/Manila)`);
        const checked = record.checked_clause_ids.map(Number);
        for (const clause of record.snapshot.clauses) text(clause.clause_text, 11, false, checked.includes(Number(clause.clause_id)));
    }
    const suffix = String(reference).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '');
    pdf.save(`agreements${suffix ? '-' + suffix : ''}.pdf`);
}
