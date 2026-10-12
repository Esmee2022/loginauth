const OTPAuth = require('otpauth');
const QRCode = require('qrcode');
const crypto = require('crypto');
const cryptoService = require('./crypto_service');

const ISSUER = 'SAAMS Corp';

/**
 * Generate a new TOTP enrollment bundle
 */
async function generateTotpSetup(userEmail) {
  const secret = new OTPAuth.Secret({ size: 20 });
  const base32Secret = secret.base32;

  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: userEmail,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: secret
  });

  const uri = totp.toString();
  const qrCodeDataUrl = await QRCode.toDataURL(uri, {
    margin: 2,
    width: 250,
    color: {
      dark: '#1A365D',
      light: '#FFFFFF'
    }
  });

  // Generate 8 cryptographically random recovery codes
  const recoveryCodes = [];
  for (let i = 0; i < 8; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 chars
    recoveryCodes.push(`${raw.substring(0, 5)}-${raw.substring(5, 10)}`);
  }

  // Encrypt TOTP secret before returning
  const encrypted = cryptoService.encryptTotpSecret(base32Secret);

  return {
    rawSecret: base32Secret,
    encryptedSecret: encrypted.encryptedSecret,
    secretIv: encrypted.iv,
    secretTag: encrypted.tag,
    qrCodeDataUrl,
    uri,
    recoveryCodes
  };
}

/**
 * Validate a submitted 6-digit TOTP code
 */
function verifyTotpToken(decryptedSecret, token) {
  if (!decryptedSecret || !token) return false;
  const cleanToken = token.toString().trim();
  if (!/^\d{6}$/.test(cleanToken)) return false;

  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(decryptedSecret)
  });

  // window = 1 allows 1 time step drift (±30s)
  const delta = totp.validate({ token: cleanToken, window: 1 });
  return delta !== null;
}

module.exports = {
  generateTotpSetup,
  verifyTotpToken
};
