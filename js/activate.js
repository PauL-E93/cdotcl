document.getElementById('activation-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = document.getElementById('status');
    const params = new URLSearchParams(location.search);
    const password = document.getElementById('password').value;
    const confirm_password = document.getElementById('confirm-password').value;
    if (password !== confirm_password) { status.textContent = 'Passwords do not match.'; return; }
    status.textContent = 'Activating account…';
    try {
        const response = await fetch('api/activate.php', { method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({type: params.get('type'), token: params.get('token'), password, confirm_password}) });
        const result = await response.json();
        status.textContent = result.message || 'Unable to activate account.';
        if (result.status === 'success') {
            history.replaceState(null, '', location.pathname);
            document.getElementById('activation-form').remove();
        }
    } catch (_) { status.textContent = 'Unable to activate account. Please try again.'; }
});
