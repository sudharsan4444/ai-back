const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');

// GET /api/users/profile
router.get('/profile', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .select('-password')
            .populate('facultyHead', 'name email department subjects');
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// GET /api/users/teacher/:id — public teacher info for student profile
router.get('/teacher/:id', protect, async (req, res) => {
    try {
        const teacher = await User.findById(req.params.id).select('name email department subjects');
        if (!teacher) return res.status(404).json({ message: 'Teacher not found' });
        res.json(teacher);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// GET /api/users/classmates
router.get('/classmates', protect, async (req, res) => {
    try {
        const student = await User.findById(req.user.id);
        if (!student || student.role !== 'STUDENT') {
            return res.status(403).json({ message: 'Only students can access classmate network' });
        }
        const classmates = await User.find({
            role: 'STUDENT',
            department: student.department,
            _id: { $ne: student._id }
        }).select('name email department year rollNumber gpa overallGrade');
        res.json(classmates);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

module.exports = router;
