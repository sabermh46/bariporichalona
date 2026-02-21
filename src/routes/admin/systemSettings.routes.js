// routes/admin/systemSettings.js
const express = require('express');
const db = require('../../config/knex');
const router = express.Router();
const authMiddleware = require('../../middleware/auth.middleware');
const roleMiddleware = require('../../middleware/role.middleware');
const EmailService = require('../../services/email.service');

// Apply authentication and admin role middleware to all routes
router.use(authMiddleware);
router.use(roleMiddleware(['web_owner', 'developer']));

// Email queue stats (must be before /:key)
router.get('/email-stats', (req, res) => {
    try {
        const queueStats = EmailService.getQueueStats();
        const workerStats = EmailService.getWorkerStats();
        res.json({
            success: true,
            queue: queueStats,
            workers: workerStats,
        });
    } catch (error) {
        console.error('Error fetching email stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch email queue stats.',
        });
    }
});

// Get all system settings
router.get('/', async (req, res) => {
    try {
        const systemSettings = await db('systemsetting')
            .select('*')
            .orderBy('category', 'asc')
            .orderBy('key', 'asc');
        
        res.json({
            success: true,
            data: systemSettings
        });
    } catch (error) {
        console.error("Error fetching system settings:", error);
        res.status(500).json({
            success: false,
            error: "An error occurred while fetching system settings."
        });
    }
});

// Get system setting by key
router.get('/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const setting = await db('systemsetting')
            .where({ key })
            .first();
        
        if (!setting) {
            return res.status(404).json({
                success: false,
                error: "System setting not found."
            });
        }
        
        res.json({
            success: true,
            data: setting
        });
    } catch (error) {
        console.error("Error fetching system setting:", error);
        res.status(500).json({
            success: false,
            error: "An error occurred while fetching system setting."
        });
    }
});

// Update system setting
router.patch('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { value, type, category, isPublic } = req.body;
        
        // Validate the input
        if (value === undefined) {
            return res.status(400).json({
                success: false,
                error: "Value is required for update."
            });
        }
        
        // Parse value based on type
        let parsedValue;
        try {
            if (type === 'boolean') {
                parsedValue = Boolean(value);
            } else if (type === 'number') {
                parsedValue = Number(value);
                if (isNaN(parsedValue)) {
                    throw new Error("Invalid number");
                }
            } else if (type === 'array' || type === 'object') {
                parsedValue = JSON.parse(value);
            } else {
                parsedValue = String(value);
            }
        } catch (parseError) {
            return res.status(400).json({
                success: false,
                error: `Invalid value for type ${type}. Error: ${parseError.message}`
            });
        }

        // Check if setting exists
        const existingSetting = await db('systemsetting')
            .where({ id: BigInt(id) })
            .first();

        if (!existingSetting) {
            return res.status(404).json({
                success: false,
                error: "System setting not found."
            });
        }
        
        const updateData = {
            value: parsedValue,
            updatedAt: new Date()
        };

        if (type) updateData.type = type;
        if (category) updateData.category = category;
        if (isPublic !== undefined) updateData.isPublic = isPublic;

        await db('systemsetting')
            .where({ id: BigInt(id) })
            .update(updateData);

        const updatedSetting = await db('systemsetting')
            .where({ id: BigInt(id) })
            .first();
        
        res.json({
            success: true,
            data: updatedSetting,
            message: "System setting updated successfully."
        });
    } catch (error) {
        console.error("Error updating system setting:", error);
        
        if (error.code === 'ER_BAD_FIELD_ERROR') {
            return res.status(404).json({
                success: false,
                error: "System setting not found."
            });
        }
        
        res.status(500).json({
            success: false,
            error: "An error occurred while updating system setting."
        });
    }
});

// Create new system setting
router.post('/', async (req, res) => {
    try {
        const { key, value, type = 'string', category = 'general', isPublic = false } = req.body;

        if (!key || value === undefined) {
            return res.status(400).json({
                success: false,
                error: "Key and value are required."
            });
        }

        // Check if setting already exists
        const existingSetting = await db('systemsetting')
            .where({ key })
            .first();

        if (existingSetting) {
            return res.status(400).json({
                success: false,
                error: "System setting with this key already exists."
            });
        }

        const [id] = await db('systemsetting').insert({
            key,
            value,
            type,
            category,
            isPublic,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        const newSetting = await db('systemsetting')
            .where({ id })
            .first();

        res.status(201).json({
            success: true,
            data: newSetting,
            message: "System setting created successfully."
        });
    } catch (error) {
        console.error("Error creating system setting:", error);
        res.status(500).json({
            success: false,
            error: "An error occurred while creating system setting."
        });
    }
});

// Delete system setting
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Check if setting exists
        const existingSetting = await db('systemsetting')
            .where({ id: BigInt(id) })
            .first();

        if (!existingSetting) {
            return res.status(404).json({
                success: false,
                error: "System setting not found."
            });
        }

        await db('systemsetting')
            .where({ id: BigInt(id) })
            .delete();
        
        res.json({
            success: true,
            message: "System setting deleted successfully."
        });
    } catch (error) {
        console.error("Error deleting system setting:", error);
        
        if (error.code === 'ER_BAD_FIELD_ERROR') {
            return res.status(404).json({
                success: false,
                error: "System setting not found."
            });
        }
        
        res.status(500).json({
            success: false,
            error: "An error occurred while deleting system setting."
        });
    }
});

module.exports = router;