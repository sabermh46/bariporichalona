// src/services/auditLog.service.js
// Read-only query layer for the admin audit-log viewer.
const db = require('../config/knex');
const { parsePagination } = require('../utils/pagination');

function safeParse(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return value;
  }
}

function formatRow(row) {
  if (!row) return row;
  return {
    ...row,
    changes: safeParse(row.changes),
    metadata: safeParse(row.metadata),
  };
}

class AuditLogService {
  _applyFilters(query, f) {
    if (f.actorId) query.where('actorId', String(f.actorId));
    if (f.actorEmail) query.where('actorEmail', 'like', `%${f.actorEmail}%`);
    if (f.entityType) query.where('entityType', f.entityType);
    if (f.entityId) query.where('entityId', String(f.entityId));
    if (f.action) query.where('action', f.action);
    if (f.actionCategory) query.where('actionCategory', f.actionCategory);
    if (f.status) query.where('status', f.status);
    if (f.startDate) query.where('createdAt', '>=', new Date(f.startDate));
    if (f.endDate) query.where('createdAt', '<=', new Date(f.endDate));
    return query;
  }

  async list(filters = {}) {
    const { page, limit, offset } = parsePagination(filters.page, filters.limit, 20);

    const base = this._applyFilters(db('auditlog'), filters);

    const countQuery = base.clone().clearSelect().clearOrder().count('* as total').first();
    const rowsQuery = base
      .clone()
      .select('*')
      .orderBy('createdAt', 'desc')
      .offset(offset)
      .limit(limit);

    const [countResult, rows] = await Promise.all([countQuery, rowsQuery]);
    const total = parseInt(countResult.total, 10) || 0;

    return {
      data: rows.map(formatRow),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getOne(id) {
    const row = await db('auditlog').where('id', id).first();
    return row ? formatRow(row) : null;
  }

  async getFacets() {
    const [entityTypes, actions, categories] = await Promise.all([
      db('auditlog').distinct('entityType').orderBy('entityType').pluck('entityType'),
      db('auditlog').distinct('action').orderBy('action').pluck('action'),
      db('auditlog').distinct('actionCategory').orderBy('actionCategory').pluck('actionCategory'),
    ]);
    return { entityTypes, actions, categories };
  }
}

module.exports = new AuditLogService();
