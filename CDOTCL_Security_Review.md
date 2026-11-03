# CDO Tutorial Management System — Authentication Security Review

**Repository:** https://github.com/PauL-E93/cdotcl  
**Reviewed branch / commit:** `main` / `d1d0988da4afde632dce013b06c6e1eaebc4aca5` (October 23, 2026)  
**Review type:** Read-only, static source-code review. No live exploitation or penetration testing was performed.

> **Important:** Severity reflects potential consequences. A code-level weakness does not prove a successful attack. Confirm whether the reviewed commit matches the deployed version before acting on deployment-specific assumptions.

## Executive summary

The application's `api/login.php` uses several good authentication practices: PDO prepared statements, `password_hash()`/`password_verify()`, session ID regeneration after login, a single-use server-side math CAPTCHA, a 10-minute inactivity check, and checks for inactive employee accounts. However, some **account-management endpoints lack visible server-side authorization checks**, permitting potentially serious account creation and takeover paths. An SMTP application password was also committed directly to a public repository and should be revoked immediately.

## Findings at a glance

| ID | Finding | Priority | Main location |
|---|---|---|---|
| F-01 | Employee signup does not visibly authenticate or authorize the caller | Critical | `api/admin/employee.php` — `signup()` and operation dispatcher |
| F-02 | Student password update trusts supplied student ID without visible authorization | Critical | `api/admin/student.php` — `updateStudentPassword()` |
| F-03 | Employee credentials update trusts supplied employee ID without visible authorization | Critical | `api/admin/employee.php` — `updateEmployeePassword()` |
| F-04 | Gmail SMTP application password embedded in public source code | Immediate / Critical | `api/forgetpassword.php` — `sendEmail()` |
| F-05 | No server-side failed-login rate limiter found | High | `api/login.php` — `login()` |
| F-06 | Session-related token copied into browser `localStorage` | High hardening priority | `js/modules/login.js` — `persistAuthSession()` |
| F-07 | UI RBAC depends in part on browser-stored role; backend checks must be verified per endpoint | High / audit required | `js/modules/session_rbac.js`; relevant API endpoints |
| F-08 | No visible failed-OTP attempt limit; account-enumerating reset response | High | `api/forgetpassword.php` — `sendOtp()` / `verifyOtp()` |
| F-09 | SMTP TLS peer verification explicitly disabled | High | `api/forgetpassword.php` — `sendEmail()` |

## F-01 — Unauthorized employee registration

**Evidence:** `api/admin/employee.php` `signup()` accepts a caller-provided `role`, looks up that role in the `role` table, and inserts an active employee. The operation dispatcher routes `signup` without an apparent authorization gate.

**In simple terms:** Someone may be able to request an employee account with a privileged role without signing in as the owner first.

**Impact:** Potential creation of a privileged employee account, subject to the roles present in the database and any external server controls.

**Fix:** On every employee-creation request, verify an authenticated PHP session, a current active employee account, an authorized role, and which roles that administrator is allowed to assign. Reject by default with HTTP 403. Apply CSRF protection for browser-cookie-authenticated state changes. Hiding the signup button in JavaScript is insufficient.

## F-02 — Unauthorized student password changes

**Evidence:** `api/admin/student.php` `updateStudentPassword()` reads `student_id`, `username`, and `new_password` from request data, then updates the matching student row without a visible check of requester identity or permissions.

**In simple terms:** A request that names another student's ID may be able to change that account's password.

**Impact:** Potential student account takeover and denial of access.

**Fix:** For self-service changes, derive the account ID from `$_SESSION`, require the current password (or a completed trusted recovery process), and validate the new password. For administrative resets, check explicit reset permission and branch scope on the server. Record an audit event and revoke affected sessions after credential changes.

## F-03 — Unauthorized employee credential changes

**Evidence:** `api/admin/employee.php` `updateEmployeePassword()` accepts `employee_id`, new password and email, and updates credentials without a visible check that the caller owns the account or is authorized to reset it.

**Impact:** Potential takeover of employee or administrator accounts.

**Fix:** Authenticate and authorize every credential-changing operation. Require the current password for self-service changes; administrative resets need narrowly scoped permissions, CSRF defense, and audit logs. Do not trust client-supplied employee IDs for account ownership.

## F-04 — SMTP application password in source control

**Evidence:** `api/forgetpassword.php` contains a Gmail SMTP username and app password hardcoded in `sendEmail()`.

**Risk:** Anyone who obtained the password from the public repository or its history could potentially use the account's SMTP authorization to send mail. This does not necessarily grant full access to the Google account.

**Immediate actions:**

1. Revoke the exposed app password in Google Account security settings **before** other clean-up.
2. Review account activity and SMTP usage for anomalies.
3. Create a replacement only if needed, storing it in server-side environment variables or a secrets manager.
4. Remove the credential from current code and clean relevant Git history; assume old clones may still contain it.
5. Never paste or publish the replacement credential.

Example credential loading (environment configured securely on the server):

```php
$mail->Username = getenv('SMTP_USERNAME');
$mail->Password = getenv('SMTP_APP_PASSWORD');
```

## F-05 — Missing failed-login throttling

**Evidence:** `api/login.php` validates a one-time CAPTCHA but does not visibly count or throttle unsuccessful passwords by account, IP or other risk signals.

**Risk:** Automated guessing may still be possible, because basic arithmetic CAPTCHA can be solved by a script.

**Fix:** Rate-limit attempts per account and network origin, use escalating delays and monitoring, and avoid permanent lockouts that enable denial of service. Return generic login errors. Apply appropriate rate limiting to CAPTCHA generation as well.

## F-06 — Session token in `localStorage`

**Evidence:** `js/modules/login.js` saves both `user` and `session_token` in browser `localStorage`.

**Risk:** Any script running in the same origin, including code introduced by an XSS vulnerability, can read those values. This review **did not establish** that the stored token is accepted by an API as an authentication bearer token; therefore, token theft causing login bypass is a **conditional risk**, not a confirmed exploit.

**Fix:** Prefer server-managed PHP sessions carried by `Secure`, `HttpOnly`, and appropriately configured `SameSite` cookies over exposing session secrets to JavaScript. Keep `localStorage` limited to nonsensitive UI preferences. Protect against XSS and CSRF.

Example production session-cookie setup (must execute *before* `session_start()`; HTTPS required):

```php
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => true,
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();
```

## F-07 — RBAC must be enforced server-side

**Evidence:** `js/modules/session_rbac.js` reads a browser-stored `user` object and controls access to UI actions based on frontend role/permissions. Some PHP files, such as `api/owner/dashboard.php`, do contain server-side role checks; **not all APIs can be treated as equally unprotected**.

**Risk:** Modifying browser storage or directly calling an API can bypass UI-only restrictions wherever matching backend authorization is missing.

**Fix:** Centralize authorization in PHP. For each endpoint, check signed-in user, active status, role/module operation, and record/branch scope. Deny by default; never accept the browser role as authority. Audit endpoints method by method instead of assuming all are vulnerable.

## F-08 — Weak password-reset OTP retry controls

**Evidence:** `api/forgetpassword.php` creates a cryptographically random six-digit OTP that expires in ten minutes. `verifyOtp()` checks the OTP but does not visibly count unsuccessful attempts. `sendOtp()` reports whether the requested email is registered.

**Risk:** Repeated OTP guesses during an active reset session and user enumeration via distinct responses.

**Fix:** Cap OTP verification attempts, limit OTP issuance per account/IP, invalidate codes when used or exceeded, ensure one-time reset, and return a generic response such as “If an account exists, instructions have been sent.” Require appropriately long passwords and invalidate relevant prior login sessions after a reset.

## F-09 — SMTP TLS validation disabled

**Evidence:** `sendEmail()` configures SMTP options to disable `verify_peer` and `verify_peer_name` and permits self-signed certificates.

**Risk:** This weakens authentication of the remote SMTP service and may facilitate interception on a compromised network.

**Fix:** Restore normal certificate validation and repair the server's trusted CA certificates instead of bypassing verification.

## Protections already implemented

- PDO prepared statements in the reviewed login queries reduce classic SQL injection risk.
- `password_hash()` and `password_verify()` protect stored login passwords better than plaintext storage.
- `session_regenerate_id(true)` is called after successful login.
- CAPTCHA is verified on the server and is single-use with a time-to-live.
- An idle session timeout is implemented in the reviewed login API.
- Inactive employee accounts are rejected by the reviewed login path.

**Limit:** These do not compensate for missing authorization on separate API routes.

## Proposed role-control policy (adapt to actual business rules)

| Operation | Minimum recommended enforcement |
|---|---|
| Create employee | Owner or expressly delegated administrator, with role-assignment restrictions |
| Change employee roles | Owner or an explicitly authorized administrator |
| Reset employee password | Account owner via verified process, or authorized reset administrator |
| Change student password | Authenticated student for own account, or authorized staff within permitted scope |
| View student records | Authorized staff with branch and record scope |
| Manage billing | Authorized finance or management roles; audit all changes |
| Reverse payment | Explicit permission and auditable reversal rather than silent deletion |
| View audit logs | Owner or designated auditor |

## Recommended remediation order

- [ ] **Immediate:** Revoke exposed SMTP app password; inspect account activity.
- [ ] **Critical:** Add server-side authorization to employee signup and constrain role assignment.
- [ ] **Critical:** Protect student password updates with ownership/administrator checks.
- [ ] **Critical:** Protect employee password updates with ownership/administrator checks.
- [ ] **High:** Audit and enforce server-side permission checks on every sensitive API operation.
- [ ] **High:** Implement password-login and OTP rate limits.
- [ ] **High:** Harden sessions and cookies; remove sensitive tokens from browser storage.
- [ ] **High:** Restore SMTP TLS certificate verification.
- [ ] **Important:** Add CSRF defenses, security audit logs, secure password-reset handling, and regression tests.
- [ ] **Important:** Check supported PHP runtime versions and apply vendor security patches on production hosts.

## Safe validation plan

Test on a staging copy with dummy accounts and records. Verify that unauthenticated requests and users with inappropriate roles receive HTTP 401/403 for employee signup, password changes, role changes, record retrieval, and billing operations. Confirm that an allowed owner can still perform legitimate actions. Test branch isolation, OTP attempt ceilings, session expiration, and credential-change session invalidation. **Do not test these actions against real user accounts or production records.**

## Source locations

- [api/login.php](https://github.com/PauL-E93/cdotcl/blob/main/api/login.php)
- [api/admin/employee.php](https://github.com/PauL-E93/cdotcl/blob/main/api/admin/employee.php)
- [api/admin/student.php](https://github.com/PauL-E93/cdotcl/blob/main/api/admin/student.php)
- [api/forgetpassword.php](https://github.com/PauL-E93/cdotcl/blob/main/api/forgetpassword.php)
- [js/modules/login.js](https://github.com/PauL-E93/cdotcl/blob/main/js/modules/login.js)
- [js/modules/session_rbac.js](https://github.com/PauL-E93/cdotcl/blob/main/js/modules/session_rbac.js)
- [Reviewed commit](https://github.com/PauL-E93/cdotcl/commit/d1d0988da4afde632dce013b06c6e1eaebc4aca5)

**Note:** The source links point to `main`, which can change as the repository is updated. Use the reviewed commit SHA to reproduce this review's code version.
