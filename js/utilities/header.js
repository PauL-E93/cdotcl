import { logout } from "../modules/login.js?v=20260809-captcha-expiry";
import { createNotificationBell } from "./notif.js";
import { buildAppUrl } from "./app_url.js";

export function createHeader() {
    const headerContainer = document.getElementById('dynamic-header');
    if (!headerContainer) {
        return;
    }

    // 1. Get current user role from localStorage
    // The role is stored inside the 'user' object as role_name
    const userData = localStorage.getItem('user');
    let userRole = 'guest';
    if (userData) {
        try {
            const user = JSON.parse(userData);
            userRole = user.role_name?.toLowerCase() || 'guest';
        } catch (e) {
        }
    }

    const currentPath = window.location.pathname;

    // Role to folder mapping
    const roleFolderMap = {
        'owner': 'owner',
        'auditor': 'auditor',
        'branch admin': 'branch_admin',
        'secretary': 'secretary',
        'student': 'student',
        'teacher': 'teacher'
    };

    const userFolder = roleFolderMap[userRole] || 'owner';

    const navLeft = document.createElement('div');
    navLeft.className = 'nav-left';

    const sidebarToggle = document.createElement('button');
    sidebarToggle.type = 'button';
    sidebarToggle.className = 'sidebar-toggle';
    sidebarToggle.title = 'Toggle navigation';
    sidebarToggle.innerHTML = '<i class="bi bi-list"></i>';

    const isSmallScreen = () => window.matchMedia('(max-width: 992px)').matches;

    sidebarToggle.addEventListener('click', () => {
        if (isSmallScreen()) {
            const opened = document.body.classList.toggle('sidebar-open');
            document.body.classList.remove('sidebar-collapsed');
            localStorage.setItem('sidebarOpen', opened ? 'true' : 'false');
        } else {
            const collapsed = document.body.classList.toggle('sidebar-collapsed');
            document.body.classList.remove('sidebar-open');
            localStorage.setItem('sidebarCollapsed', collapsed ? 'true' : 'false');
        }
    });

    const isSidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    const isSidebarOpen = localStorage.getItem('sidebarOpen') === 'true';

    if (!isSmallScreen() && isSidebarCollapsed) {
        document.body.classList.add('sidebar-collapsed');
    }

    if (isSmallScreen() && isSidebarOpen) {
        document.body.classList.add('sidebar-open');
    }

    window.addEventListener('resize', () => {
        if (!isSmallScreen()) {
            document.body.classList.remove('sidebar-open');
        }
    });

    document.addEventListener('click', (event) => {
        const sidebar = document.getElementById('sidebar');
        const clickInsideSidebar = sidebar && sidebar.contains(event.target);
        const clickOnToggle = sidebarToggle.contains(event.target);

        if (isSmallScreen() && document.body.classList.contains('sidebar-open') && !clickInsideSidebar && !clickOnToggle) {
            document.body.classList.remove('sidebar-open');
            localStorage.setItem('sidebarOpen', 'false');
        }
    });

    // Logo setup
    const logoContainer = document.createElement('div');
    logoContainer.className = 'logo-container';
    const logoImg = document.createElement('img');

    logoImg.src = '../../assist/logo.png'; 
    logoImg.alt = 'CDO LC Logo';

    logoImg.onerror = function() {
        this.style.display='none';
        logoContainer.innerText = 'CDO LOGO';
        logoContainer.style.fontWeight = 'bold';
    };
    logoContainer.appendChild(logoImg);

    // 2. No navigation items in header anymore - moved to sidebar

    // Assemble Left Section
    navLeft.appendChild(sidebarToggle);
    navLeft.appendChild(logoContainer);
    // Removed navList from header - moved to sidebar

    // 4. Create Right Section (Settings + Profile)
    const navActions = document.createElement('div');
    navActions.className = 'nav-actions';
    navActions.style.position = 'relative';

    const notificationBell = createNotificationBell();

    const profileIcon = document.createElement('i');
    profileIcon.className = 'bi bi-person-circle';
    profileIcon.style.cursor = 'pointer';

    // Dropdown menu
    const dropdownMenu = document.createElement('div');
    dropdownMenu.className = 'profile-dropdown';
    dropdownMenu.style.display = 'none';
    dropdownMenu.style.position = 'absolute';
    dropdownMenu.style.top = '100%';
    dropdownMenu.style.right = '0';
    dropdownMenu.style.backgroundColor = '#fff';
    dropdownMenu.style.border = '1px solid #ccc';
    dropdownMenu.style.borderRadius = '4px';
    dropdownMenu.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
    dropdownMenu.style.zIndex = '1000';
    dropdownMenu.style.minWidth = '150px';

    const profileOption = document.createElement('div');
    profileOption.textContent = 'Profile';
    profileOption.style.padding = '10px';
    profileOption.style.cursor = 'pointer';
    profileOption.addEventListener('click', () => {
        const profileHref = buildAppUrl(`html/${userFolder}/profile.html`);
        window.location.href = profileHref;
        dropdownMenu.style.display = 'none';
    });

    const logoutOption = document.createElement('div');
    logoutOption.textContent = 'Logout';
    logoutOption.style.padding = '10px';
    logoutOption.style.cursor = 'pointer';
    logoutOption.addEventListener('click', () => {
        logout();
        dropdownMenu.style.display = 'none';
    });

    dropdownMenu.appendChild(profileOption);
    dropdownMenu.appendChild(logoutOption);

    profileIcon.addEventListener('click', () => {
        dropdownMenu.style.display = dropdownMenu.style.display === 'none' ? 'block' : 'none';
    });

    document.addEventListener('click', (e) => {
        if (!profileIcon.contains(e.target) && !dropdownMenu.contains(e.target)) {
            dropdownMenu.style.display = 'none';
        }
    });

    navActions.appendChild(notificationBell);
    navActions.appendChild(profileIcon);
    navActions.appendChild(dropdownMenu);

    // Final Assembly
    headerContainer.innerHTML = ''; // Clear existing content before appending
    headerContainer.appendChild(navLeft);
    headerContainer.appendChild(navActions);
}
