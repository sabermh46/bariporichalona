// src/services/audit.service.js
//
// Non-blocking audit-log pipeline. Events are buffered in memory and flushed in
// batches to a dedicated worker thread (see utils/workers/audit.worker.js), so
// audit writes NEVER block or fail a request.
//
// De-dup contract (shared with middleware/auditLog.middleware.js):
//   Calling `fromRequest(req, ...)` sets `req._auditCaptured = true`. The global
//   mutation-logging middleware skips any request where that flag is set, so an
//   instrumented endpoint produces exactly ONE rich row (source:'service') while
//   every other mutating request produces ONE baseline row (source:'middleware').
const crypto = require('crypto');
const { getAuditWorkerPool } = require('../utils/auditWorkerPool');

const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 2000;
const MAX_QUEUE_SIZE = 5000; // backpressure: drop + count if the buffer explodes
const MAX_RETRIES = 3;
const USER_AGENT_MAX = 512;

const REDACT_RE = /password|passwordHash|salt|token|secret|authorization|refreshToken|newPassword|oldPassword/i;

class AuditService {
  constructor() {
    this.buffer = [];
    this.stats = { enqueued: 0, inserted: 0, dropped: 0, failedBatches: 0 };
    this._timer = setInterval(() => this._flush(), FLUSH_INTERVAL_MS);
    if (this._timer.unref) this._timer.unref(); // don't keep the process alive
  }

  // ---- redaction -----------------------------------------------------------
  _redact(value) {
    if (value == null) return value;
    if (Array.isArray(value)) return value.map((v) => this._redact(v));
    if (typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = REDACT_RE.test(k) ? '[REDACTED]' : this._redact(v);
      }
      return out;
    }
    return value;
  }

  // ---- row construction ----------------------------------------------------
  _toStringId(v) {
    if (v == null) return null;
    return typeof v === 'bigint' ? v.toString() : String(v);
  }

  _stringifyJson(obj) {
    if (obj == null) return null;
    try {
      return JSON.stringify(obj, (_key, val) =>
        typeof val === 'bigint' ? val.toString() : val
      );
    } catch (_) {
      return null;
    }
  }

  _buildRow(evt) {
    return {
      uuid: crypto.randomUUID(),
      actorId: evt.actorId != null ? this._toStringId(evt.actorId) : null,
      actorRole: evt.actorRole || null,
      actorName: evt.actorName || null,
      actorEmail: evt.actorEmail || null,
      entityType: String(evt.entityType || 'unknown').slice(0, 64),
      entityId: evt.entityId != null ? this._toStringId(evt.entityId).slice(0, 64) : null,
      action: String(evt.action || 'unknown').slice(0, 64),
      actionCategory: String(evt.actionCategory || 'mutation').slice(0, 32),
      // Redact at the row-build layer so EVERY caller of log() is safe, even if
      // they pass raw objects (middleware/diff already redact — idempotent).
      changes: this._stringifyJson(this._redact(evt.changes)),
      reason: evt.reason != null ? String(evt.reason) : null,
      metadata: this._stringifyJson(this._redact(evt.metadata)),
      ipAddress: evt.ip ? String(evt.ip).slice(0, 45) : null,
      userAgent: evt.userAgent ? String(evt.userAgent).slice(0, USER_AGENT_MAX) : null,
      status: evt.status === 'failure' ? 'failure' : 'success',
      createdAt: new Date(),
    };
  }

  // ---- public API (fire-and-forget) ---------------------------------------
  /**
   * Enqueue an audit event. Never throws, never blocks the request path.
   */
  log(evt) {
    try {
      if (this.buffer.length >= MAX_QUEUE_SIZE) {
        this.stats.dropped++;
        return;
      }
      this.buffer.push(this._buildRow(evt));
      this.stats.enqueued++;
      if (this.buffer.length >= BATCH_SIZE) this._flush();
    } catch (err) {
      // Logging must never break the caller.
      console.error('[audit] log() error:', err.message);
    }
  }

  /**
   * Convenience wrapper that pulls actor/ip/userAgent from the request and
   * marks the request as captured (so the global middleware skips it).
   */
  fromRequest(req, opts = {}) {
    try {
      if (req) req._auditCaptured = true;
      const user = req && req.user ? req.user : {};
      const ip =
        (req && (req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.ip)) || null;
      const userAgent = (req && req.headers?.['user-agent']) || null;
      this.log({
        actorId: user.id != null ? user.id : null,
        actorRole: user.role?.slug || null,
        actorName: user.name || null,
        actorEmail: user.email || null,
        ip,
        userAgent,
        ...opts,
      });
    } catch (err) {
      console.error('[audit] fromRequest() error:', err.message);
    }
  }

  /**
   * Build a redacted { before, after } diff containing only changed keys.
   */
  diff(before, after) {
    const b = before || {};
    const a = after || {};
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    const beforeOut = {};
    const afterOut = {};
    for (const k of keys) {
      const bv = b[k];
      const av = a[k];
      if (JSON.stringify(bv) !== JSON.stringify(av)) {
        beforeOut[k] = bv;
        afterOut[k] = av;
      }
    }
    return this._redact({ before: beforeOut, after: afterOut });
  }

  // ---- flushing ------------------------------------------------------------
  async _flush() {
    if (this.buffer.length === 0) return;
    const rows = this.buffer;
    this.buffer = [];
    await this._dispatch(rows, 0);
  }

  async _dispatch(rows, attempt) {
    try {
      await getAuditWorkerPool().execute('insertAuditBatch', { rows });
      this.stats.inserted += rows.length;
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        return this._dispatch(rows, attempt + 1);
      }
      this.stats.failedBatches++;
      this.stats.dropped += rows.length;
      console.error(`[audit] batch insert failed after ${MAX_RETRIES} retries:`, err.message);
    }
  }

  getStats() {
    return { ...this.stats, buffered: this.buffer.length };
  }

  /**
   * Flush remaining events and terminate the worker. Called by the graceful
   * shutdown coordinator in server.js.
   */
  async shutdown() {
    if (this._timer) clearInterval(this._timer);
    try {
      if (this.buffer.length > 0) {
        const rows = this.buffer;
        this.buffer = [];
        await getAuditWorkerPool().execute('insertAuditBatch', { rows });
        this.stats.inserted += rows.length;
      }
    } catch (err) {
      console.error('[audit] shutdown flush failed:', err.message);
    }
    try {
      await getAuditWorkerPool().terminate();
    } catch (_) {}
  }
}

module.exports = new AuditService();
