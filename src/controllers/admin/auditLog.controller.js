// src/controllers/admin/auditLog.controller.js
const auditLogService = require('../../services/auditLog.service');
const { serializeBigInt } = require('../../utils/serializer');

class AuditLogController {
  async list(req, res) {
    try {
      const {
        actorId, actorEmail, entityType, entityId,
        action, actionCategory, status, startDate, endDate,
        page, limit,
      } = req.query;

      const result = await auditLogService.list({
        actorId, actorEmail, entityType, entityId,
        action, actionCategory, status, startDate, endDate,
        page, limit,
      });

      res.json(serializeBigInt({
        success: true,
        data: result.data,
        pagination: result.pagination,
      }));
    } catch (error) {
      console.error('Audit log list error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch audit logs||অডিট লগ আনতে ব্যর্থ হয়েছে',
      });
    }
  }

  async getFacets(req, res) {
    try {
      const facets = await auditLogService.getFacets();
      res.json(serializeBigInt({ success: true, data: facets }));
    } catch (error) {
      console.error('Audit log facets error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch audit log facets||অডিট লগ ফিল্টার আনতে ব্যর্থ হয়েছে',
      });
    }
  }

  async getOne(req, res) {
    try {
      const row = await auditLogService.getOne(req.params.id);
      if (!row) {
        return res.status(404).json({
          success: false,
          error: 'Audit log not found||অডিট লগ খুঁজে পাওয়া যায়নি',
        });
      }
      res.json(serializeBigInt({ success: true, data: row }));
    } catch (error) {
      console.error('Audit log getOne error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch audit log||অডিট লগ আনতে ব্যর্থ হয়েছে',
      });
    }
  }
}

module.exports = new AuditLogController();
