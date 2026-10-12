const crypto = require('crypto');
const { argon2id } = require('hash-wasm');
const config = require('../config/environment');

// Enforce Pepper presence
function getPepper() {
  if (!config.PEPPER_SECRET || typeof config.PEPPER_SECRET !== 'string' || config.PEPPER_SECRET.length < 16) {
    throw new Error('[SECURITY FATAL] Cryptographic pepper is missing or insufficient length. System halted.');
  }
  return config.PEPPER_SECRET;
}

/**
 * Preprocess password with high-entropy server pepper using HMAC-SHA256
 */
function applyPepper(password) {
  const pepper = getPepper();
  return crypto.createHmac('sha256', pepper).update(password, 'utf8').digest('hex');
}

/**
 * Hash password using Argon2id with unique CSPRNG salt and server-side pepper
 */
async function hashPassword(plainPassword) {
  validatePasswordStrength(plainPassword);
  const pepperedPassword = applyPepper(plainPassword);
  const salt = crypto.randomBytes(16);

  const hash = await argon2id({
    password: pepperedPassword,
    salt: salt,
    parallelism: 1,
    iterations: 2,
    memorySize: 32768, // 32 MB
    hashLength: 32,
    outputType: 'encoded'
  });

  return hash;
}

/**
 * Verify a plaintext password against stored Argon2id hash using pepper
 */
async function verifyPassword(plainPassword, storedHash) {
  if (!plainPassword || !storedHash) return false;

  try {
    const pepperedPassword = applyPepper(plainPassword);
    
    // Parse stored Argon2 encoded string: $argon2id$v=19$m=32768,t=2,p=1$<salt_b64>$<hash_b64>
    const parts = storedHash.split('$');
    if (parts.length < 6 || parts[1] !== 'argon2id') {
      return false;
    }

    const paramsStr = parts[3]; // e.g. m=32768,t=2,p=1
    const saltB64 = parts[4];
    const salt = Buffer.from(saltB64, 'base64');

    // Parse parameters
    let memorySize = 32768;
    let iterations = 2;
    let parallelism = 1;

    paramsStr.split(',').forEach(p => {
      const [k, v] = p.split('=');
      if (k === 'm') memorySize = parseInt(v, 10);
      if (k === 't') iterations = parseInt(v, 10);
      if (k === 'p') parallelism = parseInt(v, 10);
    });

    const computedHash = await argon2id({
      password: pepperedPassword,
      salt: salt,
      parallelism: parallelism,
      iterations: iterations,
      memorySize: memorySize,
      hashLength: 32,
      outputType: 'encoded'
    });

    // Constant-time buffer comparison to prevent timing attacks
    const bufA = Buffer.from(computedHash);
    const bufB = Buffer.from(storedHash);
    if (bufA.length !== bufB.length) return false;

    return crypto.timingSafeEqual(bufA, bufB);
  } catch (err) {
    return false;
  }
}

/**
 * NIST SP 800-63B compliant password strength policy
 */
function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Password must be at least 12 characters in length.');
  }
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  if (!hasUpper || !hasLower || !hasDigit || !hasSpecial) {
    throw new Error('Password must include uppercase, lowercase, numbers, and special symbols.');
  }
}

/**
 * Encrypt sensitive TOTP secret at rest using AES-256-GCM
 */
function encryptTotpSecret(secretString) {
  const key = Buffer.from(config.TOTP_ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(secretString, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encryptedSecret: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex')
  };
}

/**
 * Decrypt TOTP secret using AES-256-GCM
 */
function decryptTotpSecret(encryptedHex, ivHex, tagHex) {
  const key = Buffer.from(config.TOTP_ENCRYPTION_KEY, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Hash single-use recovery code with SHA-256
 */
function hashRecoveryCode(code) {
  const normalized = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Verify recovery code in constant time
 */
function verifyRecoveryCode(candidateCode, storedHash) {
  const candidateHash = hashRecoveryCode(candidateCode);
  const bufA = Buffer.from(candidateHash, 'hex');
  const bufB = Buffer.from(storedHash, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  encryptTotpSecret,
  decryptTotpSecret,
  hashRecoveryCode,
  verifyRecoveryCode
};
