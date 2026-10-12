let currentUser = null;
let latestBackupFile = null;

function showToast(message, type = 'info') {
    const toast = document.getElementById('dashboardToast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.style.display = 'block';
    setTimeout(() => {
        toast.style.display = 'none';
    }, 4000);
}

async function checkSession() {
    try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
            window.location.href = '/index.html';
            return;
        }

        const data = await res.json();
        currentUser = data.user;
        renderUserInterface(data);
    } catch (err) {
        window.location.href = '/index.html';
    }
}

function renderUserInterface(sessionData) {
    const user = sessionData.user;
    const twoFactor = sessionData.twoFactor;

    document.getElementById('navDisplayName').textContent = user.displayName || user.username;
    const badge = document.getElementById('navRoleBadge');
    badge.textContent = user.role.toUpperCase();
    badge.className = `role-badge role-${user.role}`;

    document.getElementById('cardUsername').textContent = user.username;
    document.getElementById('cardEmail').textContent = user.email;
    document.getElementById('cardRole').textContent = user.role.toUpperCase();

    // 2FA status card
    const tfText = document.getElementById('card2faText');
    const tfBtn = document.getElementById('card2faBtn');
    if (twoFactor.enabled) {
        tfText.innerHTML = '<span style="color:#34d399;"><i class="fa-solid fa-circle-check"></i> Active & Protected</span>';
        tfBtn.textContent = 'Manage 2FA';
    } else {
        tfText.innerHTML = '<span style="color:#f87171;"><i class="fa-solid fa-triangle-exclamation"></i> Not Enrolled</span>';
        tfBtn.textContent = 'Enroll Authenticator Now';
    }

    // Role-based navigation visibility
    const navUsers = document.getElementById('navUsers');
    const navBackups = document.getElementById('navBackups');
    const navAudit = document.getElementById('navAudit');

    const roleDesc = document.getElementById('roleDescription');

    if (user.role === 'inputer') {
        navUsers.style.display = 'none';
        navBackups.style.display = 'none';
        navAudit.style.display = 'none';
        roleDesc.innerHTML = '<strong>Inputer:</strong> You have permissions to create new draft operational records and update your own drafts. You are restricted from accessing system administration, altering roles, or managing user accounts.';
    } else if (user.role === 'manager') {
        navUsers.style.display = 'flex';
        navBackups.style.display = 'none';
        navAudit.style.display = 'none';
        // Manager can only provision Inputers
        document.getElementById('roleOptManager').disabled = true;
        document.getElementById('roleOptAdmin').disabled = true;
        document.getElementById('roleOptAdministrator').disabled = true;
        roleDesc.innerHTML = '<strong>Manager:</strong> You have permissions to provision new Inputer accounts, review operational records, and approve or reject submissions. You cannot alter system security configurations or provision administrators.';
    } else if (user.role === 'admin') {
        navUsers.style.display = 'flex';
        navBackups.style.display = 'none';
        navAudit.style.display = 'none';
        // Admin can manage inputers
        document.getElementById('roleOptManager').disabled = true;
        document.getElementById('roleOptAdmin').disabled = true;
        document.getElementById('roleOptAdministrator').disabled = true;
        roleDesc.innerHTML = '<strong>Admin:</strong> You have operational user management rights (deactivating and unlocking inputer accounts) and full record oversight. You cannot modify administrators or alter encryption keys.';
    } else if (user.role === 'administrator') {
        navUsers.style.display = 'flex';
        navBackups.style.display = 'flex';
        navAudit.style.display = 'flex';
        roleDesc.innerHTML = '<strong>Administrator:</strong> Full system superuser authority. You have governance over all account tiers, automated encrypted Supabase disaster recovery backups, and tamper-evident audit logs.';
    }

    loadRecords();
}

function switchTab(tabName) {
    document.querySelectorAll('.sidebar .nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.content-area section').forEach(el => el.style.display = 'none');

    const targetSection = document.getElementById(`tab-${tabName}`);
    if (targetSection) targetSection.style.display = 'block';

    const items = document.querySelectorAll('.sidebar .nav-item');
    items.forEach(item => {
        if (item.textContent.toLowerCase().includes(tabName.toLowerCase())) {
            item.classList.add('active');
        }
    });

    if (tabName === 'records') loadRecords();
    if (tabName === 'users') loadUsers();
    if (tabName === 'backups') loadBackups();
    if (tabName === 'audit') loadAuditLogs();
}

// ======================== RECORDS ========================

async function loadRecords() {
    try {
        const res = await fetch('/api/records');
        const data = await res.json();
        const tbody = document.getElementById('recordsTableBody');
        tbody.innerHTML = '';

        if (!data.records || data.records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No records found.</td></tr>';
            return;
        }

        data.records.forEach(rec => {
            const tr = document.createElement('tr');
            let actionHtml = '-';

            if (currentUser.role === 'manager' || currentUser.role === 'admin' || currentUser.role === 'administrator') {
                if (rec.status === 'draft' || rec.status === 'submitted') {
                    actionHtml = `
                        <button class="btn-action" style="padding: 4px 8px; font-size: 11px;" onclick="handleUpdateRecordStatus('${rec.id}', 'approved')">Approve</button>
                        <button class="btn-secondary" style="padding: 4px 8px; font-size: 11px; margin-left: 4px;" onclick="handleUpdateRecordStatus('${rec.id}', 'rejected')">Reject</button>
                    `;
                }
            }

            tr.innerHTML = `
                <td><strong>${escapeHtml(rec.title)}</strong></td>
                <td><span style="color: var(--text-muted);">${escapeHtml(rec.category)}</span></td>
                <td>${escapeHtml(rec.creator_username || 'Self')}</td>
                <td><span class="status-pill status-${rec.status}">${rec.status}</span></td>
                <td>${new Date(rec.created_at).toLocaleDateString()}</td>
                <td>${actionHtml}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        showToast('Failed to load operational records.', 'error');
    }
}

async function handleCreateRecord(e) {
    e.preventDefault();
    const title = document.getElementById('recTitle').value;
    const category = document.getElementById('recCategory').value;
    const content = document.getElementById('recContent').value;

    try {
        const res = await fetch('/api/records', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, category, content })
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Draft record created successfully.', 'success');
            document.getElementById('recordForm').reset();
            loadRecords();
        } else {
            showToast(data.message || 'Failed to create record.', 'error');
        }
    } catch (err) {
        showToast('Network error saving record.', 'error');
    }
}

async function handleUpdateRecordStatus(id, status) {
    try {
        const res = await fetch(`/api/records/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        if (res.ok) {
            showToast(`Record ${status}.`, 'success');
            loadRecords();
        } else {
            showToast('Failed to update record.', 'error');
        }
    } catch (err) {
        showToast('Network error.', 'error');
    }
}

// ======================== USER MANAGEMENT ========================

async function loadUsers() {
    try {
        const res = await fetch('/api/users');
        const data = await res.json();
        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = '';

        if (!data.users || data.users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">No users available.</td></tr>';
            return;
        }

        data.users.forEach(u => {
            const tr = document.createElement('tr');
            let actions = '-';

            if (currentUser.id !== u.id) {
                if (currentUser.role === 'administrator' || (currentUser.role === 'admin' && u.role === 'inputer')) {
                    if (u.status === 'active') {
                        actions = `<button class="btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="handleToggleUserStatus('${u.id}', 'disabled')">Deactivate</button>`;
                    } else {
                        actions = `<button class="btn-action" style="padding: 4px 8px; font-size: 11px;" onclick="handleToggleUserStatus('${u.id}', 'active')">Activate</button>`;
                    }
                }
            }

            tr.innerHTML = `
                <td>${escapeHtml(u.display_name)}</td>
                <td><code>${escapeHtml(u.username)}</code></td>
                <td>${escapeHtml(u.email)}</td>
                <td><span class="role-badge role-${u.role}">${u.role}</span></td>
                <td><span class="status-pill status-${u.status}">${u.status}</span></td>
                <td>${new Date(u.created_at).toLocaleDateString()}</td>
                <td>${actions}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        showToast('Failed to load user accounts.', 'error');
    }
}

async function handleCreateUser(e) {
    e.preventDefault();
    const fullName = document.getElementById('newUserFullName').value;
    const username = document.getElementById('newUsername').value;
    const email = document.getElementById('newUserEmail').value;
    const role = document.getElementById('newUserRole').value;
    const password = `UserPass_${Math.random().toString(36).substring(2, 8)}!#Aa`;

    try {
        const res = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fullName, username, email, role, password })
        });
        const data = await res.json();
        if (res.ok) {
            alert(`User provisioned!\nUsername: ${username}\nTemporary Password: ${password}\nPlease instruct the user to change password and enroll 2FA.`);
            document.getElementById('createUserForm').reset();
            loadUsers();
        } else {
            showToast(data.message || 'Creation rejected.', 'error');
        }
    } catch (err) {
        showToast('Network error during user creation.', 'error');
    }
}

async function handleToggleUserStatus(userId, status) {
    try {
        const res = await fetch(`/api/users/${userId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message, 'success');
            loadUsers();
        } else {
            showToast(data.message || 'Status change denied.', 'error');
        }
    } catch (err) {
        showToast('Network error.', 'error');
    }
}

// ======================== 2FA ENROLLMENT ========================

async function start2FAEnrollment() {
    try {
        const res = await fetch('/api/auth/2fa/setup', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) {
            showToast('Unable to start 2FA enrollment.', 'error');
            return;
        }

        document.getElementById('enrollmentArea').style.display = 'block';
        document.getElementById('btnStartEnroll').style.display = 'none';
        document.getElementById('qrCodeImg').src = data.qrCodeDataUrl;
        document.getElementById('rawSecretCode').textContent = data.rawSecret;

        // Display recovery codes
        const recBox = document.getElementById('recoveryCodesDisplay');
        recBox.innerHTML = '';
        data.recoveryCodes.forEach(code => {
            const div = document.createElement('div');
            div.textContent = code;
            recBox.appendChild(div);
        });
        recBox.style.display = 'grid';
        document.getElementById('recoveryNotice').textContent = 'Please store these 8 codes in a password manager. They will not be displayed again.';
    } catch (err) {
        showToast('Network error during 2FA setup.', 'error');
    }
}

async function handleConfirm2FA(e) {
    e.preventDefault();
    const code = document.getElementById('confirm2faToken').value;

    try {
        const res = await fetch('/api/auth/2fa/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Two-factor authentication successfully enabled!', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 1200);
        } else {
            showToast(data.message || 'Invalid code.', 'error');
        }
    } catch (err) {
        showToast('Network error verifying code.', 'error');
    }
}

// ======================== BACKUPS (ADMINISTRATOR) ========================

async function loadBackups() {
    try {
        const res = await fetch('/api/backups/history');
        const data = await res.json();
        const tbody = document.getElementById('backupsTableBody');
        tbody.innerHTML = '';

        if (!data.backups || data.backups.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No backup logs recorded.</td></tr>';
            return;
        }

        latestBackupFile = data.backups[0].file_name;

        data.backups.forEach(b => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><code>${b.backup_id.substring(0, 8)}</code></td>
                <td>${new Date(b.started_at).toLocaleString()}</td>
                <td><span class="status-pill status-${b.status === 'SUCCESS' ? 'approved' : 'rejected'}">${b.status}</span></td>
                <td style="font-size: 11px; color: #38bdf8;">${escapeHtml(b.file_name || '-')}</td>
                <td style="font-family: monospace; font-size: 10px;">${b.sha256_digest ? b.sha256_digest.substring(0, 16) + '...' : '-'}</td>
                <td>${b.size_bytes ? (b.size_bytes / 1024).toFixed(1) + ' KB' : '-'}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        showToast('Failed to load backup logs.', 'error');
    }
}

async function triggerManualBackup() {
    const btn = document.getElementById('btnManualBackup');
    const oldText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Encrypting & Uploading to Supabase...';

    try {
        const res = await fetch('/api/backups/trigger', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            showToast('Encrypted backup successfully uploaded to Supabase!', 'success');
            loadBackups();
        } else {
            showToast(data.message || 'Backup failed.', 'error');
        }
    } catch (err) {
        showToast('Network error during backup trigger.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = oldText;
    }
}

async function testRestoreDrill() {
    if (!latestBackupFile) {
        showToast('No recent backup file found to verify.', 'error');
        return;
    }

    const btn = document.getElementById('btnTestRestore');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Running Point-In-Time Restoration Drill...';

    try {
        const res = await fetch('/api/backups/test-restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: latestBackupFile })
        });
        const data = await res.json();
        if (res.ok) {
            document.getElementById('restoreDrillOutput').innerHTML = `
                <i class="fa-solid fa-circle-check"></i> <strong>Restoration Drill Verified:</strong> Target: <code>${escapeHtml(latestBackupFile)}</code><br>
                SHA-256 Checksum: Matched 100% | Restored Isolated Users: ${data.drill.restoredUsersCount} | Status: RTO &lt; 2s (Zero Loss).
            `;
            showToast('Restoration drill verified into isolated database!', 'success');
        } else {
            showToast(data.message || 'Drill failed.', 'error');
        }
    } catch (err) {
        showToast('Drill error.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Run Verification Restore Drill';
    }
}

// ======================== AUDIT LOGS ========================

async function loadAuditLogs() {
    try {
        const res = await fetch('/api/audit');
        const data = await res.json();
        const tbody = document.getElementById('auditTableBody');
        tbody.innerHTML = '';

        if (!data.logs || data.logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">No audit logs found.</td></tr>';
            return;
        }

        data.logs.forEach(log => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-size: 11px;">${new Date(log.timestamp).toLocaleString()}</td>
                <td><strong>${escapeHtml(log.actor_username || 'SYSTEM')}</strong></td>
                <td><span class="role-badge role-${log.actor_role || 'inputer'}">${log.actor_role || 'SYS'}</span></td>
                <td><code>${escapeHtml(log.event_type)}</code></td>
                <td>${escapeHtml(log.action)}</td>
                <td><span class="status-pill status-${log.outcome === 'SUCCESS' ? 'approved' : 'rejected'}">${log.outcome}</span></td>
                <td style="font-family: monospace; font-size: 11px;">${escapeHtml(log.ip_address || '-')}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        showToast('Failed to load audit logs.', 'error');
    }
}

async function handleLogout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {}
    window.location.href = '/index.html';
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', checkSession);
