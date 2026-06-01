const AppFeePaymentController = require('../controllers/appFeePayment.controller');

// Per-owner cache with 5-minute TTL to avoid a DB hit on every request
const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function _getStatus(houseOwnerId) {
  const hit = _cache.get(houseOwnerId);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.status;
  const status = await AppFeePaymentController.getAppFeeStatus(houseOwnerId);
  _cache.set(houseOwnerId, { status, at: Date.now() });
  return status;
}

// Paths that must stay accessible even when the subscription is blocked
const SKIP_PREFIXES = [
  '/app-fees',
  '/auth',
  '/api/public',
  '/api/version',
  '/uploads',
  '/push',
];

async function subscriptionMiddleware(req, res, next) {
  const user = req.user;
  if (!user) return next();

  const role = user.role?.slug;
  // Only house_owner is the billing entity; staff/web_owner/developer are never blocked
  if (role !== 'house_owner') return next();

  const url = req.originalUrl;
  if (SKIP_PREFIXES.some(p => url.startsWith(p))) return next();

  try {
    const status = await _getStatus(Number(user.id));
    if (status?.isBlocked) {
      return res.status(402).json({
        success: false,
        code: 'SUBSCRIPTION_EXPIRED',
        error: 'Subscription expired. Please renew your app fee to continue.||সদস্যপদ মেয়াদ শেষ। অ্যাক্সেস পুনরায় পেতে অ্যাপ ফি পরিশোধ করুন।',
      });
    }
    next();
  } catch (err) {
    console.error('subscriptionMiddleware error:', err);
    next(); // never block on unexpected error
  }
}

// Call this when a payment is confirmed so the cache doesn't serve stale data
function invalidateSubscriptionCache(houseOwnerId) {
  _cache.delete(Number(houseOwnerId));
}

module.exports = { subscriptionMiddleware, invalidateSubscriptionCache };
