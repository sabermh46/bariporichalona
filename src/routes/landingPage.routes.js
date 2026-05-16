const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const landingPageService = require('../services/landingPage.service');
const authMiddleware = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');

// ── Image upload setup ────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'landing');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const landingImageUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
        filename: (_req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
    }),
    fileFilter: (_req, file, cb) => {
        const ok = /jpeg|jpg|png|gif|webp/.test(path.extname(file.originalname).toLowerCase())
            && /image\//.test(file.mimetype);
        cb(ok ? null : new Error('Only image files are allowed'), ok);
    },
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
}).single('image');

// ── Public router ─────────────────────────────────────────────────────────────
const publicRouter = express.Router();

// GET /api/public/landing  — returns all sections, no auth required
publicRouter.get('/landing', (req, res) => {
    try {
        const data = landingPageService.getAll();
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error fetching landing page data:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch landing page data.' });
    }
});

// ── Admin router ──────────────────────────────────────────────────────────────
const adminRouter = express.Router();
adminRouter.use(authMiddleware);
adminRouter.use(roleMiddleware(['web_owner', 'developer']));

// POST /admin/landing-config/upload-image  — upload a slide image
// Must be before /:section routes so it isn't caught as a section name
adminRouter.post('/upload-image', (req, res) => {
    landingImageUpload(req, res, (err) => {
        if (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No image file provided.' });
        }
        const imageUrl = `/uploads/landing/${req.file.filename}`;
        res.json({ success: true, url: imageUrl });
    });
});

// GET /admin/landing-config  — all sections with metadata
adminRouter.get('/', (req, res) => {
    try {
        const data = landingPageService.getAll();
        const defaults = landingPageService.getDefaults();
        res.json({ success: true, data, defaults });
    } catch (error) {
        console.error('Error fetching landing config:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch landing config.' });
    }
});

// GET /admin/landing-config/:section  — single section
adminRouter.get('/:section', (req, res) => {
    try {
        const { section } = req.params;
        const data = landingPageService.getSection(section);
        if (!data) {
            return res.status(404).json({ success: false, error: `Section "${section}" not found.` });
        }
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error fetching landing section:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch section.' });
    }
});

// PUT /admin/landing-config/:section  — update section
adminRouter.put('/:section', (req, res) => {
    try {
        const { section } = req.params;
        const updatedBy = req.user?.id ? String(req.user.id) : null;
        const data = landingPageService.updateSection(section, req.body, updatedBy);
        res.json({ success: true, data, message: 'Section updated successfully.' });
    } catch (error) {
        console.error('Error updating landing section:', error);
        if (error.message?.startsWith('Unknown section')) {
            return res.status(400).json({ success: false, error: error.message });
        }
        res.status(500).json({ success: false, error: 'Failed to update section.' });
    }
});

// POST /admin/landing-config/:section/reset  — reset section to built-in defaults
adminRouter.post('/:section/reset', (req, res) => {
    try {
        const { section } = req.params;
        const data = landingPageService.resetSection(section);
        res.json({ success: true, data, message: 'Section reset to defaults.' });
    } catch (error) {
        console.error('Error resetting landing section:', error);
        if (error.message?.startsWith('No default')) {
            return res.status(400).json({ success: false, error: error.message });
        }
        res.status(500).json({ success: false, error: 'Failed to reset section.' });
    }
});

module.exports = { publicRouter, adminRouter };
