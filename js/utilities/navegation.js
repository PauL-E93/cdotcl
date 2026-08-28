import { canRoleAccessModule, getRbacModulePermission, RBAC_NAV_UPDATED_EVENT } from "./rbac_navigation.js";
import { buildAppUrl } from "./app_url.js";

let hasBoundRbacSidebarRefresh = false;

function bindRbacSidebarRefresh() {
    if (hasBoundRbacSidebarRefresh) return;

    document.addEventListener(RBAC_NAV_UPDATED_EVENT, (event) => {
        const userData = localStorage.getItem('user');
        let currentUserRole = 'guest';

        if (userData) {
            try {
                currentUserRole = JSON.parse(userData).role_name?.toLowerCase() || 'guest';
            } catch (error) {}
        }

        const changedRole = event.detail?.roleKey;
        if (changedRole && changedRole !== currentUserRole) {
            return;
        }

        if (document.querySelector('.main-content')) {
            createSidebar();
        }
    });

    hasBoundRbacSidebarRefresh = true;
}

export function createSidebar() {
    const existingSidebar = document.getElementById('sidebar');
    if (existingSidebar) {
        existingSidebar.remove();
    }

    bindRbacSidebarRefresh();

    const sidebarContainer = document.createElement('div');
    sidebarContainer.id = 'sidebar';
    sidebarContainer.className = 'sidebar';

    // Get user role
    const userData = localStorage.getItem('user');
    let userRole = 'guest';
    if (userData) {
        try {
            const user = JSON.parse(userData);
            userRole = user.role_name?.toLowerCase() || 'guest';
        } catch (e) {}
    }

    const currentPath = window.location.pathname;
    const isSmallScreen = () => window.matchMedia('(max-width: 992px)').matches;
    const closeSidebarOnMobile = () => {
        if (!isSmallScreen()) return;
        document.body.classList.remove('sidebar-open');
        localStorage.setItem('sidebarOpen', 'false');
    };

    // Role mapping
    const roleFolderMap = {
        'owner': 'owner',
        'auditor': 'auditor',
        'branch admin': 'branch_admin',
        'secretary': 'secretary',
        'student': 'student',
        'teacher': 'teacher'
    };

    const userFolder = roleFolderMap[userRole] || 'owner';

    const navItems = [
        { name: 'DASHBOARD', href: buildAppUrl(`html/${userFolder}/dashboard.html`), icon: 'bi-speedometer2', roles: ['owner','auditor','branch admin','secretary','student','teacher'] },
        { name: 'SCHEDULE', href: buildAppUrl(`html/${userFolder}/schedule.html`), icon: 'bi-calendar3', moduleKey: 'schedule', roles: ['owner','branch admin','student','teacher','secretary','auditor'] },

        {
            name: 'STUDENTS',
            href: buildAppUrl(`html/${userFolder}/student_management.html`),
            icon: 'bi-person-vcard',
            moduleKey: 'student_management',
            restrictToRoles: true,
            roles: ['owner', 'branch admin', 'secretary', 'auditor', 'teacher']
        },

        {
            name: 'ENROLLMENT',
            icon: 'bi-journal-check',
            moduleKey: 'enrollment',
            roles: ['owner','branch admin','student','auditor','secretary'],
            children: [
                { name: 'Tutorial', href: buildAppUrl(`html/${userFolder}/enrollement.html`) },
                { name: 'Pre-school / Play-school', href: buildAppUrl(`html/${userFolder}/enrollement_pre_play.html`) }
            ]
        },

        { name: 'PROFILE', href: buildAppUrl(`html/${userFolder}/profile.html`), icon: 'bi-person-circle', roles: ['owner','auditor','branch admin','secretary','student','teacher'] },
        {
            name: 'EMPLOYEE',
            icon: 'bi-people',
            moduleKey: 'employee',
            roles: ['owner','secretary'],
            children: [
                { name: 'Employee List', href: buildAppUrl(`html/${userFolder}/employee.html`), moduleKey: 'employee', permissionKey: 'view' },
                { name: 'Modules', href: buildAppUrl(`html/${userFolder}/role_base.html`), moduleKey: 'employee', permissionKey: 'manage_rbac' }
            ]
        },
        { name: 'PROGRAM', href: buildAppUrl(`html/${userFolder}/program.html`), icon: 'bi-grid', moduleKey: 'program', roles: ['owner','auditor','secretary'] },
        { name: 'SCHOOL CALENDAR', href: buildAppUrl(`html/${userFolder}/school_calendar.html`), icon: 'bi-calendar-range', moduleKey: 'school_calendar', roles: ['owner','secretary'] },

        {
            name: 'PAYMENT',
            icon: 'bi-credit-card',
            moduleKey: 'payment',
            roles: ['owner','auditor','branch admin','student','secretary'],
            children: [
                { name: 'Tutorial', href: buildAppUrl(`html/${userFolder}/payment.html`) },
                { name: 'Pre-school / Play-school', href: buildAppUrl(`html/${userFolder}/payment_pre_play.html`) }
            ]
        },

        { name: 'CLASS', href: buildAppUrl(`html/${userFolder}/class.html`), icon: 'bi-building', moduleKey: 'class', roles: ['owner','branch admin','secretary','teacher'] },
        { name: 'PRODUCT', href: buildAppUrl(`html/${userFolder}/product.html`), icon: 'bi-box-seam', moduleKey: 'product', roles: ['owner','auditor','secretary'] },
        { name: 'CENTER', href: buildAppUrl(`html/${userFolder}/center.html`), icon: 'bi-shop', moduleKey: 'center', roles: ['owner','secretary'] },
        { name: 'SESSION', href: buildAppUrl(`html/${userFolder}/session.html`), icon: 'bi-clock', moduleKey: 'session', roles: ['owner','auditor','branch admin','secretary','student','teacher'] },
    ];

    const navList = document.createElement('ul');
    navList.className = 'sidebar-nav';

    navItems.forEach(item => {
        const defaultRoleAccess = userRole === 'owner' || item.roles.includes(userRole);
        const canAccessItem = item.restrictToRoles && !defaultRoleAccess
            ? false
            : (item.moduleKey ? canRoleAccessModule(userRole, item.moduleKey) : defaultRoleAccess);

        if (canAccessItem) {

            const li = document.createElement('li');
            li.className = 'sidebar-item';

            const a = document.createElement('a');
            a.className = 'sidebar-link';
            a.style.cursor = 'pointer';

            const icon = document.createElement('i');
            icon.className = `bi ${item.icon} sidebar-icon`;

            const label = document.createElement('span');
            label.className = 'sidebar-label';
            label.textContent = item.name;

            a.appendChild(icon);
            a.appendChild(label);
            li.appendChild(a);

            // ✅ IF HAS CHILDREN → MAKE ACCORDION
            if (item.children) {
                const subMenu = document.createElement('ul');
                subMenu.className = 'submenu';
                subMenu.style.display = 'none';

                const visibleChildren = item.children.filter(child => {
                    if (!child.moduleKey || !child.permissionKey) {
                        return true;
                    }

                    return getRbacModulePermission(userRole, child.moduleKey, child.permissionKey);
                });

                if (!visibleChildren.length) {
                    return;
                }

                visibleChildren.forEach(child => {
                    const subLi = document.createElement('li');

                    const subA = document.createElement('a');
                    subA.href = child.href;
                    subA.textContent = child.name;
                    subA.className = 'submenu-link';
                    subA.addEventListener('click', () => {
                        closeSidebarOnMobile();
                    });

                    // active state
                    if (currentPath.includes(child.href.split('/').pop())) {
                        subLi.classList.add('active');
                        subMenu.style.display = 'block';
                        li.classList.add('open');
                    }

                    subLi.appendChild(subA);
                    subMenu.appendChild(subLi);
                });

                // toggle dropdown
                a.addEventListener('click', () => {
                    const isOpen = subMenu.style.display === 'block';
                    subMenu.style.display = isOpen ? 'none' : 'block';
                    li.classList.toggle('open');
                });

                li.appendChild(subMenu);
            } else {
                a.href = item.href;
                a.addEventListener('click', () => {
                    closeSidebarOnMobile();
                });

                if (currentPath.includes(item.href.split('/').pop())) {
                    li.classList.add('active');
                }
            }

            navList.appendChild(li);
        }
    });

    sidebarContainer.appendChild(navList);

    const body = document.body;
    const mainContent = document.querySelector('.main-content');

    if (mainContent) {
        body.insertBefore(sidebarContainer, mainContent);
    } else {
        body.appendChild(sidebarContainer);
    }
}
