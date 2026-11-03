# Login security changes

This change protects account management and authenticated APIs, and replaces
predictable initial passwords with one-use activation links.

## Deployment

- Configure `APP_BASE_URL` to the public HTTPS application URL. Activation
  emails use it to construct links. Do not allow an untrusted Host header to
  determine emailed links in production.
- Keep `uploads/.htaccess` deployed and verify that the web server blocks
  script execution in `uploads/`. On XAMPP, Apache has `AllowOverride All` for
  the document root. Other web servers need an equivalent deny rule.
- Enable the PHP GD extension to re-encode profile pictures and remove
  metadata. If GD is unavailable, images are still checked by content and
  stored with a generated image extension under the upload deny rule.
- The `account_activations` table is created automatically by the activation
  service. The database user needs `CREATE TABLE` permission for the first run.
- Existing login sessions do not contain the new account security stamp, so
  everyone must sign in again after deployment.
- Deploy the root `.htaccess` rules. They reject non-local HTTP traffic,
  set HSTS on HTTPS responses, and enforce a Content Security Policy on
  the login, password recovery, and activation pages. Configure HTTPS through
  to Apache, including between a reverse proxy and Apache, and set
  `SESSION_COOKIE_SECURE=1` in production.
- Authenticated API writes require the `X-CSRF-Token` header, populated by
  `js/utilities/csrf.js` from a session-bound Strict cookie. Any custom client
  that writes to these APIs must send that header with its session cookie.
- Existing accounts using old predictable temporary passwords cannot sign in
  until they use password recovery or staff resend an activation link. Staff
  may POST JSON to `api/resend_activation.php` with `type` (`student` or
  `employee`) and `user_id`. This also replaces the old password hash with an
  unguessable placeholder. The new link expires in 24 hours.
- Previously emailed schedule confirmation and reschedule links do not contain
  the new 48-hour signature and must be reissued. Authenticated students can
  still confirm and reschedule from their account.

## Behavior

- Self-service password and email changes require the current password.
- Employee and student account changes check the authenticated role and target
  account on the server. Branch admins are restricted to their branch where
  account lookup is available.
- Sessions have a ten-minute idle limit and an eight-hour absolute limit.
  Every protected API checks the live account password, status, role, branch,
  and email against the login-time stamp. A change revokes other sessions.
- Activation tokens are stored as hashes, expire after 24 hours, and are
  consumed once. The public signup form routes visitors to enrollment.
- Password creation and changes require at least 12 characters, an uppercase
  letter, a number, and a symbol. Public API wildcard CORS headers were
  removed, and authenticated GET requests cannot use write-operation names.

## Verification

Run `C:\xampp\php\php.exe tests\LoginSecurityTest.php`,
`tests\PasswordExpirationTest.php`, `tests\AuthGuardUnitTest.php`, and
`tests\AccountActivationTest.php`. The activation test uses a transaction and
rolls back its test account changes. Check that an anonymous request to
`api/admin/employee.php?operation=getEmployees` returns HTTP 401 and public
landing/enrollment lookups still return HTTP 200.
