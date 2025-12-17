// routes/systemSettings.js
const express = require('express');
const prisma = require('../../config/prisma');
const router = express.Router();
const authMiddleware = require('../../middleware/auth.middleware');
const roleMiddleware = require('../../middleware/role.middleware');
// Apply authentication and admin role middleware to all routes
router.use(authMiddleware);
router.use(roleMiddleware(['web_owner', 'developer']));

// Get all system settings
router.get('/', async (req, res) => {
    try {
        const systemSettings = await prisma.systemSetting.findMany({
            orderBy: {
                category: 'asc',
            }
        });
        
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
        const setting = await prisma.systemSetting.findUnique({
            where: { key }
        });
        
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
        
        const updatedSetting = await prisma.systemSetting.update({
            where: { id: BigInt(id) },
            data: {
                value: parsedValue,
                ...(type && { type }),
                ...(category && { category }),
                ...(isPublic !== undefined && { isPublic })
            }
        });
        
        res.json({
            success: true,
            data: updatedSetting,
            message: "System setting updated successfully."
        });
    } catch (error) {
        console.error("Error updating system setting:", error);
        
        if (error.code === 'P2025') {
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

// Delete system setting
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        await prisma.systemSetting.delete({
            where: { id: BigInt(id) }
        });
        
        res.json({
            success: true,
            message: "System setting deleted successfully."
        });
    } catch (error) {
        console.error("Error deleting system setting:", error);
        
        if (error.code === 'P2025') {
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