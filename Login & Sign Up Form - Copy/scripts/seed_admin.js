const crypto = require('crypto');
const { getDatabase, closeDatabase } = require('../src/database/database');
const cryptoService = require('../src/security/crypto_service');
const { logEvent } = require('../src/security/audit_logger');

async function seedAdmin() {
  const args = process.argv.slice(2);
  const username = args[0] || 'admin';
  const email = args[1] || 'admin@saams.corp';
  const password = args[2] || `AdminPass_${crypto.randomBytes(6).toString('hex')}!`;
  const fullName = args[3] || 'System Administrator';

  console.log('================================================================');
  console.log('SAAMS: INITIAL ADMINISTRATOR PROVISIONING TOOL');
  console.log('================================================================');

  try {
    cryptoService.validatePasswordStrength(password);
  } catch (err) {
    console.error('Password error:', err.message);
    process.exit(1);
  }

  const db = getDatabase();
  const existing = db.prepare('SELECT id, username, role FROM users WHERE username = ? OR email = ?').get(username, email);

  if (existing) {
    console.log(`[NOTICE] Account with username "${username}" or email "${email}" already exists.`);
    console.log(`User ID: ${existing.id} | Role: ${existing.role}`);
    closeDatabase();
    process.exit(0);
  }

  console.log('Hashing administrator password with Argon2id, per-user salt, and server pepper...');
  const passwordHash = await cryptoService.hashPassword(password);
  const adminId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (id, username, email, display_name, password_hash, role, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'administrator', 'active', ?)
  `).run(adminId, username.toLowerCase(), email.toLowerCase(), fullName, passwordHash, now);

  logEvent({
    actorId: adminId,
    actorUsername: username,
    actorRole: 'administrator',
    eventType: 'ADMIN_PROVISIONED',
    targetId: adminId,
    action: 'INITIAL_ADMIN_SEED',
    outcome: 'SUCCESS',
    metadata: { username, email }
  });

  console.log('\n[SUCCESS] Administrator account successfully provisioned:');
  console.log(`  User ID:      ${adminId}`);
  console.log(`  Username:     ${username}`);
  console.log(`  Email:        ${email}`);
  console.log(`  Password:     ${password}`);
  console.log(`  Role:         administrator`);
  console.log(`  Status:       active`);
  console.log('\nIMPORTANT SECURITY ADVICE:');
  console.log('1. Use these credentials to sign in at http://127.0.0.1:3000');
  console.log('2. Immediately navigate to Security Settings and ENROLL 2FA via Authenticator app.');
  console.log('3. Save your generated single-use emergency recovery codes safely.');
  console.log('================================================================\n');

  closeDatabase();
}

seedAdmin().catch(err => {
  console.error('[PROVISIONING ERROR]', err);
  process.exit(1);
});
