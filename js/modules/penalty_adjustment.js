import { canUsePaymentPermission, isPaymentModulePage } from './payment_rbac.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
}[char]));
const money = value => Number(value || 0).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' });

function ensureStyles() {
    if (document.getElementById('penaltyAdjustmentStyles')) return;
    const style = document.createElement('style');
    style.id = 'penaltyAdjustmentStyles';
    style.textContent = `
        .penalty-settlement-card{padding:22px 24px;border:1px solid #f4c4d3;border-radius:14px;background:#fff;text-align:left;margin-bottom:16px;color:#334155;box-shadow:0 3px 9px rgba(90,44,59,.06)}
        .penalty-settlement-card h3{display:flex;align-items:center;gap:12px;color:#e85d88;font-size:1.2rem;font-weight:750;margin:0 0 12px}
        .penalty-settlement-card h3 i{padding:9px;border-radius:10px;background:#fdeaf0}
        .penalty-settlement-row{padding:14px 0;border-top:1px solid #f4d5df}
        .penalty-settlement-heading{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}
        .penalty-adjust-button{border:1px solid #e85d88;border-radius:9px;padding:8px 13px;background:#fff4f7;color:#d94b78;font-size:.85rem;font-weight:650}
        .penalty-adjust-button:hover{background:#fde7ee}
        .penalty-settlement-card small,.penalty-settlement-help{color:#667085;font-size:.85rem}
        .penalty-settlement-card details{margin-top:12px;font-size:.85rem}
        .penalty-settlement-card summary{cursor:pointer;color:#d94b78;font-weight:650}
        .penalty-settlement-history{padding:12px;margin-top:10px;border-radius:9px;background:#fff4f7;overflow-wrap:anywhere}
        .penalty-settlement-history p{margin:6px 0;white-space:pre-wrap}
        .penalty-adjust-popup{border:2px solid #e85d88!important;border-radius:17px!important;color:#334155!important}
        .penalty-adjust-popup .swal2-title{color:#d94b78;font-size:1.5rem}
        .penalty-adjust-form{text-align:left;font-size:.95rem}
        .penalty-adjust-form label{font-weight:650;margin:12px 0 6px}
        .penalty-adjust-form>label,.penalty-adjust-form>small{display:block}
        .penalty-adjust-form .form-control,.penalty-adjust-form .form-select{display:block;box-sizing:border-box;width:100%;padding:.6rem .75rem;border:1px solid #f4c4d3;border-radius:9px;background:#fff;color:#334155;font:inherit}
        .penalty-adjust-form .form-control:disabled{background:#f8fafc}
        .penalty-adjust-form .form-control:focus,.penalty-adjust-form .form-select:focus{border-color:#e85d88;box-shadow:0 0 0 .2rem #fde7ee}
        .penalty-adjust-preview{padding:13px;border:1px solid #f4c4d3;border-radius:10px;background:#fff4f7;margin-top:16px;font-weight:650}
        @media(max-width:600px){.penalty-settlement-card{padding:16px}.penalty-adjust-button{width:100%}}
    `;
    document.head.appendChild(style);
}

export function penaltyAdjustmentCard(schedule = [], readOnly = false) {
    ensureStyles();
    const canAdjust = !readOnly && isPaymentModulePage() && canUsePaymentPermission('view') && canUsePaymentPermission('adjust_penalty');
    const bills = schedule.filter(bill => !['cancelled', 'canceled'].includes(String(bill.status).toLowerCase())
        && (Number(bill.penalty_amount) > 0 || bill.penalty_adjustments?.length));
    if (!bills.length) return '';
    return `<section class="penalty-settlement-card" aria-label="Penalty adjustments">
        <h3><i class="bi bi-shield-check" aria-hidden="true"></i>Penalty Adjustments</h3>
        <p class="penalty-settlement-help">${readOnly ? 'Waivers and reductions agreed with the center appear here.' : 'Record a waiver or reduction agreed with the parent/guardian at the center.'}</p>
        ${bills.map(bill => {
            const history = bill.penalty_adjustments || [];
            const latest = history[0];
            const eligible = canAdjust && ['unpaid', 'partial', 'overdue'].includes(String(bill.status).toLowerCase())
                && Number(bill.penalty_amount) > Number(bill.penalty_paid || 0);
            return `<div class="penalty-settlement-row">
                <div class="penalty-settlement-heading"><div><strong>${escape(bill.billing_type)}</strong>
                <div class="small">Current penalty: <strong>${money(bill.penalty_amount)}</strong>${Number(bill.penalty_paid) > 0 ? ` · Paid: ${money(bill.penalty_paid)}` : ''}</div></div>
                ${eligible ? `<button type="button" class="penalty-adjust-button" data-adjust-penalty="${escape(bill.id)}"><i class="bi bi-pencil-square me-1"></i>Adjust Penalty</button>` : ''}</div>
                ${latest ? `<small>Last adjustment: ${money(latest.waived_amount)} waived.${latest.pause_until ? ` New penalties paused through ${escape(latest.pause_until)}; the daily rate resumes the following day if unpaid.` : ' The daily rate resumes the day after approval if unpaid.'}</small>
                <details><summary>View agreement history (${history.length})</summary>${history.map(record => `<div class="penalty-settlement-history">
                    <strong>${record.adjustment_type === 'waiver' ? 'Full waiver of unpaid penalty' : 'Partial reduction'}</strong>
                    <p>Before: ${money(record.previous_penalty)} · Waived: ${money(record.waived_amount)} · Revised: ${money(record.agreed_penalty)}</p>
                    <p>Parent/guardian: ${escape(record.guardian_name)}</p><p>Reason: ${escape(record.reason)}</p>
                    <p>Agreement: ${escape(record.agreement_notes)}</p>
                    ${record.pause_until ? `<p>New penalties paused through ${escape(record.pause_until)}.</p>` : ''}
                    <small>Approved by ${escape(record.approved_by_name)} · ${escape(record.created_at)}</small>
                </div>`).join('')}</details>` : ''}
            </div>`;
        }).join('')}
    </section>`;
}

export function bindPenaltyAdjustments(schedule, reopen) {
    Swal.getPopup()?.querySelectorAll('[data-adjust-penalty]').forEach(button => {
        button.addEventListener('click', () => {
            const bill = schedule.find(item => String(item.id) === button.dataset.adjustPenalty);
            if (bill) openAdjustment(bill, reopen);
        });
    });
}

async function openAdjustment(bill, reopen) {
    const current = Number(bill.penalty_amount || 0);
    const paid = Number(bill.penalty_paid || 0);
    const result = await Swal.fire({
        title: 'Adjust Penalty', width: 620, showCancelButton: true, showCloseButton: true,
        confirmButtonText: 'Save Approved Adjustment', cancelButtonText: 'Back to Billing',
        confirmButtonColor: '#e85d88', cancelButtonColor: '#64748b',
        customClass: { popup: 'penalty-adjust-popup' }, showLoaderOnConfirm: true,
        allowOutsideClick: () => !Swal.isLoading(),
        html: `<div class="penalty-adjust-form">
            <div class="penalty-adjust-preview">${escape(bill.billing_type)}<br>Current penalty: ${money(current)}${paid > 0 ? `<br>Already paid: ${money(paid)} (retained)` : ''}</div>
            <label for="penaltyAdjustmentType">Adjustment</label>
            <select id="penaltyAdjustmentType" class="form-select"><option value="waiver">Full waiver of unpaid penalty</option><option value="reduction">Partial reduction</option></select>
            <label for="penaltyAgreedAmount">Revised total penalty (PHP)</label>
            <input id="penaltyAgreedAmount" class="form-control" type="number" step="0.01" min="${paid}" max="${(current - .01).toFixed(2)}" value="${paid.toFixed(2)}" disabled>
            <small class="penalty-settlement-help">Includes any penalty already paid. Only the unpaid portion can be waived.</small>
            <label for="penaltyGuardian">Parent/guardian name</label><input id="penaltyGuardian" class="form-control" maxlength="255" autocomplete="name">
            <label for="penaltyReason">Reason for adjustment</label><textarea id="penaltyReason" class="form-control" maxlength="2000" rows="2" placeholder="Explain why the center approved this adjustment"></textarea>
            <label for="penaltyAgreement">Agreed terms</label><textarea id="penaltyAgreement" class="form-control" maxlength="4000" rows="3" placeholder="Record the payment arrangement discussed at the center"></textarea>
            <label for="penaltyPauseUntil">Settlement deadline (optional)</label><input id="penaltyPauseUntil" class="form-control" type="date">
            <small class="penalty-settlement-help">With a deadline, new penalties pause through that date and resume the following day if unpaid. Without one, the daily rate resumes tomorrow. The waived amount stays waived.</small>
            <div class="penalty-adjust-preview" id="penaltyAdjustmentPreview" aria-live="polite"></div>
            <div class="form-check mt-3"><input id="penaltyAcknowledged" class="form-check-input" type="checkbox"><label class="form-check-label mt-0" for="penaltyAcknowledged">The parent/guardian agreed to these terms at the center.</label></div>
        </div>`,
        didOpen: () => {
            const amount = document.getElementById('penaltyAgreedAmount');
            const type = document.getElementById('penaltyAdjustmentType');
            const update = () => {
                if (type.value === 'waiver') amount.value = paid.toFixed(2);
                amount.disabled = type.value === 'waiver';
                const agreed = Number(amount.value);
                document.getElementById('penaltyAdjustmentPreview').textContent = Number.isFinite(agreed) && agreed >= paid && agreed < current
                    ? `Waived: ${money(current - agreed)} · Penalty still payable: ${money(agreed - paid)}` : 'Enter a lower penalty that retains amounts already paid.';
            };
            amount.addEventListener('input', update); type.addEventListener('change', update); update();
        },
        preConfirm: async () => {
            const value = id => document.getElementById(id).value.trim();
            const amount = value('penaltyAgreedAmount');
            if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || Number(amount) < paid || Number(amount) >= current) {
                Swal.showValidationMessage('Enter a lower penalty that retains amounts already paid.'); return false;
            }
            if (!value('penaltyGuardian') || !value('penaltyReason') || !value('penaltyAgreement') || !document.getElementById('penaltyAcknowledged').checked) {
                Swal.showValidationMessage('Complete the parent/guardian, reason, agreed terms, and acknowledgment.'); return false;
            }
            try {
                const response = await axios.post('../../api/admin/penalty_adjustment.php', {
                    billing_schedule_id: bill.id, expected_penalty: current,
                    adjustment_type: value('penaltyAdjustmentType'), agreed_penalty: amount,
                    guardian_name: value('penaltyGuardian'), reason: value('penaltyReason'),
                    agreement_notes: value('penaltyAgreement'), pause_until: value('penaltyPauseUntil') || null, acknowledged: true
                });
                if (response.data?.status !== 'success') throw new Error(response.data?.message || 'Unable to save adjustment.');
                return true;
            } catch (error) {
                Swal.showValidationMessage(error.response?.data?.message || error.message || 'Unable to save adjustment.'); return false;
            }
        }
    });
    if (result.isConfirmed) await Swal.fire({ icon: 'success', title: 'Penalty adjusted', text: 'The approved agreement has been saved.', confirmButtonColor: '#e85d88' });
    reopen();
}
