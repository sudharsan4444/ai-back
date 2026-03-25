const express = require('express');
const router = express.Router();
const Assessment = require('../models/Assessment');
const Submission = require('../models/Submission');
const { protect, authorize } = require('../middleware/authMiddleware');
const { recalculateStudentGPA } = require('../utils/gpaUtils');

// @route   POST /api/assessments
router.post('/', protect, authorize('TEACHER', 'ADMIN'), async (req, res) => {
    try {
        const { title, topic, questions, answerKey, dueDate, materialId, department, status } = req.body;
        const assessment = await Assessment.create({
            title, topic, questions,
            answerKey: answerKey || [],
            createdBy: req.user.id,
            dueDate, materialId,
            department: department || req.user.department,
            status: status || 'DRAFT'
        });
        res.status(201).json(assessment);
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
});

// @route   GET /api/assessments
router.get('/', protect, async (req, res) => {
    try {
        let query = {};
        if (req.user.role === 'STUDENT') {
            query = { 
                status: 'PUBLISHED',
                $or: [
                    { department: req.user.department },
                    { department: 'General' },
                    { department: '' },
                    { department: null },
                    { department: { $exists: false } }
                ]
            };
        } else if (req.user.role === 'TEACHER') {
            query = { createdBy: req.user.id };
        }
        const assessments = await Assessment.find(query)
            .populate('createdBy', 'name email')
            .sort({ createdAt: -1 });
        res.json(assessments);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});

// @route   PATCH /api/assessments/:id/status
router.patch('/:id/status', protect, authorize('TEACHER', 'ADMIN'), async (req, res) => {
    try {
        const { status } = req.body;
        const assessment = await Assessment.findById(req.params.id);
        if (!assessment) return res.status(404).json({ message: 'Assessment not found' });
        assessment.status = status;
        await assessment.save();
        res.json(assessment);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});

// @route   DELETE /api/assessments/:id
// @desc    Delete assessment + submissions + recalculate GPAs for all affected students
router.delete('/:id', protect, authorize('TEACHER', 'ADMIN'), async (req, res) => {
    try {
        const assessment = await Assessment.findById(req.params.id);
        if (!assessment) return res.status(404).json({ message: 'Assessment not found' });

        if (req.user.role === 'TEACHER' && String(assessment.createdBy) !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized to delete this assessment' });
        }

        const submissions = await Submission.find({ assessmentId: req.params.id });
        const affectedStudentIds = [...new Set(submissions.map(s => String(s.studentId)))];
        await Submission.deleteMany({ assessmentId: req.params.id });
        await assessment.deleteOne();
        await Promise.all(affectedStudentIds.map(id => recalculateStudentGPA(id)));

        res.json({ message: 'Assessment deleted', affectedStudents: affectedStudentIds.length });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @route   GET /api/assessments/:id
router.get('/:id', protect, async (req, res) => {
    try {
        const assessment = await Assessment.findById(req.params.id);
        if (!assessment) return res.status(404).json({ message: 'Assessment not found' });
        res.json(assessment);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});

module.exports = router;
