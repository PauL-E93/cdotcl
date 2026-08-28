// index.js
import { createHeader } from "./utilities/header.js";
import { createSidebar } from "./utilities/navegation.js";
import { initRbacPermissions } from "./utilities/rbac_navigation.js";
import { handleLogin, handleEmployeeSignup, handleSignup, initLoginPage, initializeAuthGuard } from "./modules/login.js?v=20260809-captcha-expiry";
import "./modules/receipt.js";
import "./modules/receipt_mobile.js";
import "./modules/orf.js";
import "./modules/billing.js?v=20260828-assessment-sync";
import "./modules/payment_assessment.js?v=20260828-assessment-rbac";
import "./utilities/gcash_ocr.js?v=20260825-ref-row-2";
import { initProgramPage, setupAddProgramModal } from "./modules/program.js?v=20260814-program-filters";
import { setupAddProgramTypeModal, loadProgramTypes } from "./modules/program_type.js";
import { initSubjectPage, setupAddSubjectModal } from "./modules/subject.js";
import { initGradeLevelPage, setupAddGradeLevelModal } from "./modules/grade_level.js?v=20260823-grade-level-paging";
import { loadDiscounts, setupAddDiscountModal } from "./modules/discount.js";
import { loadRegistrationAmounts, setupAddRegistrationAmountModal } from "./modules/registration_amount.js";
import { initServicesPage, setupAddServiceModal } from "./modules/services.js";
import { initPaymentMethodsPage, setupAddPaymentMethodModal } from "./modules/payment_method.js?v=20260812-payment-methods";
import { loadSchoolYears, setupAddSchoolYearModal, setupEditSchoolYearStatusModal } from "./modules/school_year.js?v=20260814-schedule-details";
import { initCardManagementPage, initCardManagementEditorPage } from "./modules/card_mangpre.js?v=20260814-school-year-curriculum";
import "./modules/view_enrollment_pre_play.js?v=20260828-assessment-rbac";
import "./modules/view_enrollment.js?v=20260828-assessment-rbac";
import "./modules/edit_enrollment.js?v=20260823-grade-level-crud";
import "./modules/employee.js";
import "./modules/employee_rbac.js";
import "./modules/role_base.js?v=20260828-payment-assessment-rbac";
import { openAddClassModal } from "./modules/class_add.js";
import { initSectionView } from "./modules/section_view.js?v=20260814-profile-table-fields";
import { initSectionAttendancePage } from "./modules/section_attendance.js";
import { initSectionReportCardsPage } from "./modules/preschool_report_card.js?v=20260814-school-year-curriculum";
import { openAddSectionModal } from "./modules/section.js";
import { initProductPage, openAddProductModal, openAddCategoryModal } from "./modules/product.js?v=20260814-product-search";
import { initProductReleasePage } from "./modules/product_release.js?v=20260825-product-modal-focus";
import { resetEnrollmentState, openEnrollmentModal, openApplicationDownpaymentModal } from "./modules/addenrollment.js?v=20260823-admin-field-validation";
import { initNewStudentApplications } from "./modules/enrollment_applications.js?v=20260828-program-teacher-filter";
import { initLandingPage } from "./modules/landingpage.js?v=20260823-public-applications";
import { initLandingPageManager } from "./modules/landing_page_manager.js";
import { SessionManager } from './studentmodule/session.js?v=20260823-meeting-numbers';
import { canUseProgramPermission, initProgramPermissions } from "./modules/program_rbac.js";
import { applySchoolCalendarPagePermissions, canUseSchoolCalendarPermission, initSchoolCalendarPermissions } from "./modules/school_calendar_rbac.js";
import { applyPaymentPagePermissions, initPaymentPermissions } from "./modules/payment_rbac.js";
import { applyClassPagePermissions, canUseClassPermission, initClassPermissions } from "./modules/class_rbac.js";
import { applySessionPagePermissions, initSessionPermissions } from "./modules/session_rbac.js";
import { applyProductPagePermissions, canUseProductPermission, initProductPermissions } from "./modules/product_rbac.js";
import { applySchedulePagePermissions, initSchedulePermissions } from "./modules/schedule_rbac.js";
import { initStudentManagementPage } from "./modules/student_management.js?v=20260828-mobile";



window.handleLogin = handleLogin;
window.handleEmployeeSignup = handleEmployeeSignup;
window.handleSignup = handleSignup;
window.initProductPage = initProductPage;
window.openApplicationDownpaymentModal = openApplicationDownpaymentModal;

document.addEventListener("DOMContentLoaded", async () => {
    const canInitializePage = await initializeAuthGuard();
    if (!canInitializePage) return;

    initLoginPage();
    await initRbacPermissions();
    const hasDynamicHeader = Boolean(document.getElementById('dynamic-header'));
    const hasApplicationShell = hasDynamicHeader || Boolean(document.querySelector('.main-content'));
    if (hasDynamicHeader) createHeader();
    if (hasApplicationShell) createSidebar();

    const pathname = window.location.pathname;

    if (pathname.includes('student_management.html')) {
        await initStudentManagementPage();
    }

    if (pathname.includes('/student/')) {
        import("./studentmodule/billingPlayPre.js?v=20260825-assessment-summary");
    } else {
        import("./modules/billingPlayPre.js?v=20260825-assessment-summary");
    }

    if (pathname.includes('schedule.html')) {
        await initSchedulePermissions();
        const access = applySchedulePagePermissions();
        if (!access.allowed) {
            return;
        }
    }

    if (pathname.includes('payment.html')) {
        await initPaymentPermissions();
        const access = applyPaymentPagePermissions();
        if (access.allowed) {
            if (pathname.includes('/student/')) {
                import("./studentmodule/payment_due.js");
            } else {
                import("./modules/payment_due.js");
            }
        }
    }

    if (pathname.includes('payment_pre_play.html')) {
        await initPaymentPermissions();
        const access = applyPaymentPagePermissions();
        if (access.allowed) {
            if (pathname.includes('/student/')) {
                import("./studentmodule/payment_due_preplay.js");
            } else {
                import("./modules/payment_due_preplay.js");
            }
        }
    }

    if (document.querySelector('[data-announcements]')) {
        initLandingPage();
    }

    if (pathname.endsWith('/enrollement.html') || pathname.endsWith('/enrollement_pre_play.html')) {
        if (!pathname.includes('/student/')) {
            initNewStudentApplications();
        }
        const enrollBtn = document.getElementById('btn-start-enrollment');
        if (enrollBtn) {
            enrollBtn.addEventListener('click', () => {
                if (pathname.includes('/student/enrollement_pre_play.html')) {
                    window.currentEnrollmentCategory = 'preschool';
                    import("./studentmodule/pre_play_enrollment.js").then((module) => {
                        module.openStudentPrePlayEnrollment();
                    });
                    return;
                }

                resetEnrollmentState();
                if (pathname.endsWith('/enrollement_pre_play.html')) {
                    window.currentEnrollmentCategory = 'preschool';
                } else {
                    window.currentEnrollmentCategory = 'tutorial';
                }
                openEnrollmentModal();
            });
        }
    }

    if (pathname.includes('product.html')) {
        await initProductPermissions();
        const access = applyProductPagePermissions();
        if (!access.allowed) {
            return;
        }

        const productOptions = [];
        if (canUseProductPermission('create')) {
            productOptions.push(
                { text: "Add Product", id: "add-product-option", action: () => openAddProductModal() },
                { text: "Add Category", id: "add-category-option", action: () => openAddCategoryModal() }
            );
        }

        if (productOptions.length > 0) {
            setupDynamicMoreOptions(productOptions);
        } else {
            document.getElementById('more_option')?.closest('.position-relative')?.classList.add('d-none');
        }

        initProductPage();
        initProductReleasePage();
    }

    else if (pathname.includes('/owner/card_management.html') || pathname.includes('/secretary/card_management.html')) {
        initCardManagementEditorPage();
    }

    else if (
        pathname.includes('/owner/attendance.html')
        || pathname.includes('/branch_admin/attendance.html')
        || pathname.includes('/secretary/attendance.html')
        || pathname.includes('/teacher/attendance.html')
    ) {
        await initClassPermissions();
        const access = applyClassPagePermissions();
        if (!access.allowed) {
            return;
        }

        initSectionAttendancePage();
    }

    else if (
        pathname.includes('/owner/section_report_cards.html')
        || pathname.includes('/teacher/section_report_cards.html')
        || pathname.includes('/secretary/section_report_cards.html')
    ) {
        await initClassPermissions();
        const access = applyClassPagePermissions();
        if (!access.allowed) {
            return;
        }

        initSectionReportCardsPage();
    }

    else if (pathname.includes('school_calendar.html')) {
        await initSchoolCalendarPermissions();
        const access = applySchoolCalendarPagePermissions();
        if (!access.allowed) {
            return;
        }

        loadSchoolYears();
        const addSchoolYearBtn = document.getElementById('btnAddSchoolYearPage');
        if (canUseSchoolCalendarPermission('create')) {
            addSchoolYearBtn?.addEventListener('click', () => setupAddSchoolYearModal());
        }
        if (document.getElementById('more_option')) {
            const schoolGuideOptions = [];

            if (canUseSchoolCalendarPermission('create')) {
                schoolGuideOptions.push({ text: "Add School Calendar", id: "add-school-year-option", action: () => setupAddSchoolYearModal() });
            }
            if (canUseSchoolCalendarPermission('edit')) {
                schoolGuideOptions.push({ text: "Edit School Year Status", id: "edit-school-year-status-option", action: () => setupEditSchoolYearStatusModal() });
            }

            if (schoolGuideOptions.length > 0) {
                setupDynamicMoreOptions(schoolGuideOptions);
            } else {
                document.getElementById('more_option')?.closest('.position-relative')?.classList.add('d-none');
            }
        }
    }

    else if (pathname.includes('program.html')) {
        await initProgramPermissions(true);
        await initProgramPage();

        loadProgramTypes();
        initGradeLevelPage();
        initSubjectPage();
        loadDiscounts();
        loadRegistrationAmounts();
        initServicesPage();
        initPaymentMethodsPage();
        initCardManagementPage();
        if (pathname.includes('/owner/') && canUseProgramPermission('view_landing')) initLandingPageManager();

        if (canUseProgramPermission('create')) {
            document.getElementById('btnAddProgram')?.addEventListener('click', () => setupAddProgramModal());
        }
        if (canUseProgramPermission('create_types')) {
            document.getElementById('btnAddProgramType')?.addEventListener('click', () => setupAddProgramTypeModal());
        }
        if (canUseProgramPermission('create_discounts')) {
            document.getElementById('btnAddDiscount')?.addEventListener('click', () => setupAddDiscountModal());
        }
        if (canUseProgramPermission('create_registration')) {
            document.getElementById('btnAddRegistration')?.addEventListener('click', () => setupAddRegistrationAmountModal());
        }
        if (document.getElementById('more_option')) {
            const programOptions = [];

            if (canUseProgramPermission('create')) {
                programOptions.push({ text: "Add Program", id: "add-program-option", action: () => setupAddProgramModal() });
            }
            if (canUseProgramPermission('create_types')) {
                programOptions.push({ text: "Add Program Type", id: "add-program-type-option", action: () => setupAddProgramTypeModal() });
            }
            if (canUseProgramPermission('create_grades')) {
                programOptions.push({ text: "Add Grade Level", id: "add-grade-level-option", action: () => setupAddGradeLevelModal() });
            }
            if (canUseProgramPermission('create_subjects')) {
                programOptions.push({ text: "Add Subject", id: "add-subject-option", action: () => setupAddSubjectModal() });
            }
            if (canUseProgramPermission('edit_checklists')) {
                programOptions.push({ text: "Manage ECCD Checklist", id: "manage-report-card-option", action: () => {
                    const openReportCardManager = window.openCardManagementEditor || window.openCardManagerModal;
                    openReportCardManager?.('play_school');
                } });
            }
            if (canUseProgramPermission('create_discounts')) {
                programOptions.push({ text: "Add Discount", id: "add-discount-option", action: () => setupAddDiscountModal() });
            }
            if (canUseProgramPermission('create_registration')) {
                programOptions.push({ text: "Add Registration", id: "add-registration-option", action: () => setupAddRegistrationAmountModal() });
            }
            if (canUseProgramPermission('create_services')) {
                programOptions.push({ text: "Add Service", id: "add-service-option", action: () => setupAddServiceModal() });
            }
            if (canUseProgramPermission('create_payment_methods') && document.getElementById('btnAddPaymentMethod')) {
                programOptions.push({ text: "Add Payment Method", id: "add-payment-method-option", action: () => setupAddPaymentMethodModal() });
            }

            if (programOptions.length > 0) {
                setupDynamicMoreOptions(programOptions);
            } else {
                document.getElementById('more_option')?.closest('.position-relative')?.classList.add('d-none');
            }
        }
    }

    else if (pathname.includes('/owner/class.html') ||
             pathname.includes('/auditor/class.html') ||
             pathname.includes('/branch_admin/class.html') ||
             pathname.includes('/secretary/class.html') ||
             pathname.includes('/teacher/class.html')) {
        await initClassPermissions();
        const access = applyClassPagePermissions();
        if (!access.allowed) {
            return;
        }

        const isTeacherClassPage = pathname.includes('/teacher/class.html');
        initSectionView();
        if (!isTeacherClassPage) {
            const addClassBtn = document.getElementById('btn-add-class') || document.querySelector('.btn-add');
            if (addClassBtn && canUseClassPermission('create')) {
                addClassBtn.addEventListener('click', () => {
                    openAddClassModal();
                });
            }

            const addSectionBtn = document.getElementById('btn-add-section');
            if (addSectionBtn && canUseClassPermission('manage_sections')) {
                addSectionBtn.addEventListener('click', () => {
                    const classId = document.getElementById('class-selector')?.value || null;
                    openAddSectionModal(classId);
                });
            }

            if (document.getElementById('more_option')) {
                const classOptions = [];

                if (canUseClassPermission('create')) {
                    classOptions.push({ text: "Add Class", id: "add-class-option", action: () => openAddClassModal() });
                }
                if (canUseClassPermission('manage_sections')) {
                    classOptions.push({ text: "Add Section", id: "add-section-option", action: () => openAddSectionModal() });
                }

                if (classOptions.length > 0) {
                    setupDynamicMoreOptions(classOptions);
                } else {
                    document.getElementById('more_option')?.closest('.position-relative')?.classList.add('d-none');
                }
            }
        }
    }

    else if (pathname.includes('/student/schedule.html')) {
        import("./studentmodule/CalendarModule.js").then((module) => {
            const CalendarModule = module.default || module.CalendarModule;
            new CalendarModule('calendar-module-root');
        });
    }

    else if (pathname.includes('/student/profile.html')) {
        import("./studentmodule/profile.js").then((module) => {
            module.initStudentProfile();
        });
    }

    else if (pathname.includes('/employee/profile.html') ||
             pathname.includes('/owner/profile.html') ||
             pathname.includes('/auditor/profile.html') ||
             pathname.includes('/branch_admin/profile.html') ||
             pathname.includes('/secretary/profile.html') ||
             pathname.includes('/teacher/profile.html')) {
        import("./modules/employee_profile.js").then((module) => {
            module.initEmployeeProfile();
        });
    }

    if ((pathname.includes("enrollement.html") || pathname.includes("program.html") || pathname.includes("school_calendar.html") || pathname.includes("payment.html") || pathname.includes("card_management.html") || pathname.includes("section_report_cards.html") || pathname.includes("attendance.html"))
         && !JSON.parse(localStorage.getItem("user"))) {
        window.location.href = "../../login.html";
    }
});

const setupDynamicMoreOptions = (options) => {
    const moreOptionBtn = document.getElementById("more_option");
    const moreOptionDropdown = document.getElementById("more_option_dropdown");

    if (!moreOptionBtn || !moreOptionDropdown) return;

    moreOptionBtn.addEventListener("click", (event) => {
        event.stopPropagation();

        if (moreOptionDropdown.innerHTML !== "") {
            moreOptionDropdown.innerHTML = "";
            return;
        }

        const optionList = document.createElement("ul");
        // Added fw-normal to ensure the list inherits normal font weight
        optionList.classList.add("list-group", "shadow", "rounded", "bg-white", "mt-1", "fw-normal");
        optionList.style.minWidth = "180px";

        options.forEach((option) => {
            const li = document.createElement("li");
            // Added small and py-2 for size and spacing consistency
            li.classList.add("list-group-item", "list-group-item-action", "small", "py-2");
            li.style.cursor = "pointer";
            li.id = option.id;
            li.textContent = option.text;

            li.addEventListener("click", () => {
                option.action();
                moreOptionDropdown.innerHTML = "";
            });

            optionList.appendChild(li);
        });

        moreOptionDropdown.appendChild(optionList);
    });

    document.addEventListener("click", (event) => {
        if (!moreOptionBtn.contains(event.target) && !moreOptionDropdown.contains(event.target)) {
            moreOptionDropdown.innerHTML = "";
        }
    });
};

// Fetch and load student session dynamically
async function loadStudentSession() {
    try {
        const mainContent = document.querySelector('.main-content');
        if (!mainContent) return;

        if ((window.location.pathname.includes('session.html') || window.location.pathname.includes('tracking.html')) && !window.location.pathname.includes('/student/')) {
            await initSessionPermissions();
            const access = applySessionPagePermissions();
            if (!access.allowed) {
                return;
            }
        }

        const tracker = new SessionManager('.main-content');
        tracker.init();
    } catch (error) {
        console.error('Error initializing session:', error);
        document.querySelector('.main-content').innerHTML = `
            <div class="alert alert-danger" role="alert">
                <i class="bi bi-exclamation-circle"></i> Error loading session. Please refresh the page.
            </div>
        `;
    }
}

// Initialize shared session view on page load for legacy tracking/session routes
const pathname = window.location.pathname;
if (pathname.includes('tracking.html') || pathname.includes('session.html')) {
    document.addEventListener('DOMContentLoaded', () => {
        loadStudentSession();
    });
}
