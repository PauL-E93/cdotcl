import { PROGRAM_SECTIONS, resolveProgramSection } from '../utilities/program_sections.js';
import { canUseProgramPermission, initProgramPermissions } from './program_rbac.js?v=20261001-payment-view-only';

let initialized = false;

function sectionCard(section) {
    return document.querySelector(`[data-program-feature="${section.key}"]`)
        || (section.key === 'session_automation' ? document.getElementById('session-automation-section') : null);
}

export function showProgramSection() {
    const available = canUseProgramPermission('view')
        ? PROGRAM_SECTIONS.filter(section => canUseProgramPermission(section.permission) && sectionCard(section)) : [];
    const selected = resolveProgramSection(window.location.hash, available);
    PROGRAM_SECTIONS.forEach(section => {
        const card = sectionCard(section);
        if (card) {
            card.dataset.programPanel = section.key;
            card.hidden = section.key !== selected?.key;
        }
    });
    const showPrograms = selected?.key === 'programs';
    document.querySelector('.top-bar .search-wrapper')?.toggleAttribute('hidden', !showPrograms);
    document.querySelector('.filter-container')?.toggleAttribute('hidden', !showPrograms);
    const title = document.querySelector('.page-title');
    if (title) title.textContent = selected ? selected.label.toUpperCase() : 'PROGRAM';
    if (selected && window.location.hash !== `#${selected.key}`) {
        history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${selected.key}`);
    }
    // Update the existing sidebar without rebuilding it or losing its open state.
    document.querySelectorAll('[data-program-section-link]').forEach(link => {
        const active = link.dataset.programSectionLink === selected?.key;
        link.parentElement.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
}

export function initProgramSections() {
    if (initialized) { showProgramSection(); return; }
    initialized = true;
    window.addEventListener('hashchange', showProgramSection);
    document.addEventListener('rbac-navigation-updated', async () => {
        await initProgramPermissions();
        showProgramSection();
    });
    showProgramSection();
}
