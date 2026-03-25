const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Material = require('../models/Material');
const { protect, authorize } = require('../middleware/authMiddleware');
const { indexDocument } = require('../services/ragService');

// Configure Multer Storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const filetypes = /pdf|mp4/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);

        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('Only PDFs and MP4s are allowed!'));
        }
    }
});

// @route   POST /api/upload
// @desc    Upload material (PDF/Video) and index it
// @access  Private (Teacher/Admin)
router.post('/', protect, authorize('TEACHER', 'ADMIN'), upload.single('file'), async (req, res) => {
    const { title, description, unit, type, youtubeUrl } = req.body;

    if (type !== 'YOUTUBE' && !req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
    }

    try {
        const material = await Material.create({
            title,
            description,
            type: type || 'PDF',
            url: type === 'YOUTUBE' ? youtubeUrl : `/uploads/${req.file.filename}`,
            unit,
            subject: req.body.subject || 'Uncategorized',
            department: req.body.department || req.user.department || 'General',
            uploadedBy: req.user.id
        });

        console.log(`[UPLOAD] 📥 Received file: ${req.file.originalname} (Type: ${type || 'PDF'})`);
        const isPdf = path.extname(req.file.originalname).toLowerCase() === '.pdf';
        console.log(`[UPLOAD] 📥 Is PDF? ${isPdf}. File Path: ${req.file.path}`);

        // If PDF, index it for RAG — run in BACKGROUND (non-blocking)
        if (type !== 'YOUTUBE' && req.file && isPdf) {
            console.log(`[UPLOAD] 🚀 Triggering RAG indexing for: ${material.title}`);
            indexDocument(req.file.path, material._id)
                .then(() => console.log(`[RAG] Background indexing complete for: ${material.title}`))
                .catch(err => {
                    console.error(`[RAG] ❌ Background indexing FAILED for ${material._id}:`, err);
                    // Explicitly log stack trace for better debugging
                    if (err.stack) console.error(err.stack);
                });
        } else {
            console.log(`[UPLOAD] ⚠️ RAG Indexing skipped. Reason: ${type === 'YOUTUBE' ? 'Youtube material' : !req.file ? 'No file' : 'Not a PDF'}`);
        }

        res.status(201).json({ ...material.toObject(), indexing: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error during upload/indexing' });
    }
});

// @route   GET /api/upload
// @desc    Get all materials
// @access  Private
router.get('/', protect, async (req, res) => {
    try {
        const materials = await Material.find()
            .populate('uploadedBy', 'name email role')
            .sort({ createdAt: -1 });
        res.json(materials);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});

// @route   PUT /api/upload/:id
// @desc    Update material details (Admin only for full control, or owner for basics)
// @access  Private
router.put('/:id', protect, authorize('TEACHER', 'ADMIN'), async (req, res) => {
    try {
        const material = await Material.findById(req.params.id);
        if (!material) return res.status(404).json({ message: 'Material not found' });

        // Access control: admins can edit anything, teachers can only edit their own
        if (req.user.role !== 'ADMIN' && material.uploadedBy.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized to update this material' });
        }

        const { title, description, unit, uploadedBy } = req.body;

        if (title) material.title = title;
        if (description) material.description = description;
        if (unit) material.unit = unit;
        
        // Only admins can change the uploader
        if (uploadedBy && req.user.role === 'ADMIN') {
            material.uploadedBy = uploadedBy;
        }

        await material.save();
        res.json(material);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @route   DELETE /api/upload/:id
// @desc    Delete a material (Admin can delete any, teacher can delete their own)
// @access  Private (Teacher/Admin)
router.delete('/:id', protect, authorize('TEACHER', 'ADMIN'), async (req, res) => {
    try {
        const material = await Material.findById(req.params.id);
        if (!material) return res.status(404).json({ message: 'Material not found' });

        // Access control: only admin or the uploader can delete
        if (req.user.role !== 'ADMIN' && material.uploadedBy.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized to delete this material' });
        }

        // 1. Delete vectors from Pinecone
        const { deleteMaterialVectors } = require('../services/ragService');
        await deleteMaterialVectors(req.params.id);

        // 2. Delete material from DB
        await material.deleteOne();
        res.json({ message: 'Material and its AI index deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

module.exports = router;

