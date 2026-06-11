// middleware/auditLog.middleware.js
//
// Global baseline audit logging for mutating requests. Runs on res 'finish' so
// it can read res.statusCode and the per-route req.user without adding latency.
//
// De-dup contract (shared with services/audit.service.js):
//   If an instrumented controller already called audit.fromRequest(req, ...) it
//   set req._auditCaptured = true; this middleware then skips the request, so
//   instrumented endpoints get ONE rich row (source:'service') and everything
//   else mutating gets ONE baseline row (source:'middleware', changes:null).
const audit = require('../services/audit.service');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Skip noisy / irrelevant paths.
function isSkippedPath(p) {
  if (!p) return true;
  if (p === '/' || p === '/api/version') return true;
  if (p.startsWith('/uploads')) return true;
  if (p.startsWith('/push')) return true;
  if (p.startsWith('/health')) return true;
  if (p === '/auth/refresh') return true;
  return false;
}

// Derive a coarse entityType from the first meaningful path segments.
function deriveEntityType(segments) {
  const [a, b] = segments;
  if (a === 'payments' && b === 'rent') return 'rent_payment';
  if (a === 'payments') return 'rent_payment';
  if (a === 'houses') return 'house';
  if (a === 'flats') return 'flat';
  if (a === 'renters' || a === 'renter') return 'renter';
  if (a && a.startsWith('loan')) return 'house_loan';
  if (a === 'permissions' || b === 'permissions') return 'staffpermission';
  if (a === 'app-fees' || a === 'appfees') return 'app_fee_payment';
  if (a === 'financial' || a === 'finance') return 'financial';
  if (a === 'notices' || a === 'notice') return 'notice';
  if (a === 'caretakers' || a === 'caretaker') return 'caretaker';
  if (a === 'auth') return 'user';
  return a || 'unknown';
}

// Find a plausible entity id: explicit route param, else a trailing numeric segment.
function deriveEntityId(req, segments) {
  if (req.params && req.params.id != null) return String(req.params.id);
  for (let i = segments.length - 1; i >= 0; i--) {
    if (/^\d+$/.test(segments[i])) return segments[i];
  }
  return null;
}

function deriveAction(method) {
  switch (method) {
    case 'POST': return 'create';
    case 'PUT':
    case 'PATCH': return 'update';
    case 'DELETE': return 'delete';
    default: return 'mutation';
  }
}

module.exports = function auditLogMiddleware(req, res, next) {
  const method = req.method;
  if (!MUTATING.has(method)) return next();

  // req.path excludes the query string; use originalUrl path for skip checks.
  const rawPath = req.path || req.originalUrl || '';
  if (isSkippedPath(rawPath)) return next();

  res.on('finish', () => {
    try {
      // An instrumented endpoint already logged a richer row — skip baseline.
      if (req._auditCaptured) return;

      const segments = rawPath.split('/').filter(Boolean);
      const user = req.user || {};
      const ip =
        req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null;

      audit.log({
        actorId: user.id != null ? user.id : null,
        actorRole: user.role?.slug || 'anonymous',
        actorName: user.name || null,
        actorEmail: user.email || null,
        entityType: deriveEntityType(segments),
        entityId: deriveEntityId(req, segments),
        action: deriveAction(method),
        actionCategory: 'mutation',
        changes: null,
        metadata: audit._redact({
          method,
          path: rawPath,
          statusCode: res.statusCode,
          query: req.query,
          body: req.body,
          source: 'middleware',
        }),
        ip,
        userAgent: req.headers?.['user-agent'] || null,
        status: res.statusCode < 400 ? 'success' : 'failure',
      });
    } catch (err) {
      console.error('[audit] middleware error:', err.message);
    }
  });

  next();
};
