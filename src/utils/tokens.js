const jwt = require("jsonwebtoken");
const db = require("../config/knex");

let _cachedExpiry = null;
let _cacheExpiresAt = 0;
const CACHE_TTL_MS = 60_000; // re-read DB at most once per minute

async function getAccessTokenExpiry() {
  const now = Date.now();
  if (_cachedExpiry !== null && now < _cacheExpiresAt) {
    return _cachedExpiry;
  }
  try {
    const setting = await db('systemsetting')
      .where({ key: 'security.token_expiry_hours' })
      .first();
    if (setting?.value) {
      const hours = Number(setting.value);
      if (!isNaN(hours) && hours > 0) {
        _cachedExpiry = `${hours}h`;
        _cacheExpiresAt = now + CACHE_TTL_MS;
        return _cachedExpiry;
      }
    }
  } catch (_) { /* fall through to env/default */ }
  // Fallback: env var or hardcoded default
  _cachedExpiry = process.env.JWT_EXPIRES_IN || "3d";
  _cacheExpiresAt = now + CACHE_TTL_MS;
  return _cachedExpiry;
}

exports.createTokens = async (userId) => {
  const accessExpiresIn = await getAccessTokenExpiry();
  const accessToken = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: accessExpiresIn });
  const refreshToken = jwt.sign({ userId }, process.env.JWT_REFRESH, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d" });
  return { accessToken, refreshToken };
};
