export async function chooseBillingStatementExportFormat() {
    const result = await Swal.fire({
        title: 'Export billing statement',
        text: 'Choose a file format.',
        icon: 'question',
        input: 'select',
        inputOptions: {
            pdf: 'PDF',
            csv: 'CSV',
            xlsx: 'Excel (.xlsx)'
        },
        inputValue: 'pdf',
        showCancelButton: true,
        confirmButtonText: 'Export'
    });

    return result.isConfirmed ? result.value : null;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function escapeCsvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function exportBillingStatementData({ format, filename, title, sections }) {
    const rows = [[title]];
    sections.forEach(section => {
        rows.push([], [section.name]);
        if (section.headers?.length) rows.push(section.headers);
        rows.push(...(section.rows || []));
    });

    if (format === 'csv') {
        const csv = rows.map(row => row.map(escapeCsvCell).join(',')).join('\r\n');
        downloadBlob(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' }), `${filename}.csv`);
        return;
    }

    if (format === 'xlsx') {
        if (!window.XLSX) throw new Error('Excel export library is unavailable.');
        const workbook = window.XLSX.utils.book_new();
        const worksheet = window.XLSX.utils.aoa_to_sheet(rows);
        const columnCount = Math.max(1, ...rows.map(row => row.length));
        worksheet['!cols'] = Array.from({ length: columnCount }, (_, columnIndex) => ({
            wch: Math.min(45, Math.max(12, ...rows.map(row => String(row[columnIndex] ?? '').length + 2)))
        }));
        window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Billing Statement');
        window.XLSX.writeFile(workbook, `${filename}.xlsx`);
    }
}
