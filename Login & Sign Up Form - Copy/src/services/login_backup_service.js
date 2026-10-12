const config = require('../config/environment');

/**
 * Best-effort copy of a completed sign-in to Supabase. Authentication stays
 * available if the backup destination is temporarily unreachable.
 */
async function recordSuccessfulLogin(user) {
  if (!config.SUPABASE_KEY) {
    console.error('[LOGIN BACKUP] Supabase logging is not configured (SUPABASE_KEY is missing).');
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${config.SUPABASE_URL}/rest/v1/login_events`, {
      method: 'POST',
      headers: {
        apikey: config.SUPABASE_KEY,
        Authorization: `Bearer ${config.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        user_id: user.id,
        name: user.display_name || user.displayName,
        role: user.role
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const details = await response.text();
      console.error(`[LOGIN BACKUP] Supabase insert failed (${response.status}): ${details}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error('[LOGIN BACKUP] Could not write login event to Supabase:', error.message);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { recordSuccessfulLogin };
