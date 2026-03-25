const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Submission = require('../models/Submission');
const Assessment = require('../models/Assessment');
const { protect, authorize } = require('../middleware/authMiddleware');

// Helper to generate Roll Number
async function generateRollNumber(department, year) {
    const deptCodes = {
        'computer science': 'CS',
        'electronics': 'EC',
        'electronics & communication': 'EC',
        'electrical & electronics': 'EE',
        'mechanical engineering': 'ME',
        'mechanical': 'ME',
        'civil engineering': 'CV',
        'civil': 'CV',
        'automobile engineering': 'AE',
        'aerospace engineering': 'AS',
        'biotechnology': 'BT',
        'chemical engineering': 'CH',
        'data science': 'DS',
        'artificial intelligence': 'AI',
        'ai&datascience': 'ADS',
        'ai & ds': 'ADS',
        'ai&machinelearning': 'AML',
        'ai & ml': 'AML',
        'information technology': 'IT'
    };

    const searchDept = (department || '').toLowerCase().trim();
    const deptCode = (deptCodes[searchDept])
        ? deptCodes[searchDept]
        : (searchDept)
            ? searchDept.split(' ').map(word => word[0]).join('').toUpperCase().slice(0, 3)
            : 'XX';
    
    // Prefix is just Year + DeptCode
    const prefix = `${year}${deptCode}`;
    console.log(`Generating roll number for prefix: ${prefix} (Dept: ${department}, Year: ${year})`);

    // Find the latest roll number with this prefix
    const lastUser = await User.findOne({ rollNumber: new RegExp(`^${prefix}`) })
        .sort({ rollNumber: -1 });

    let nextIndex = 101;
    if (lastUser && lastUser.rollNumber) {
        // Extract the trailing number from the last roll number
        const match = lastUser.rollNumber.match(/\d+$/);
        if (match) {
            nextIndex = parseInt(match[0]) + 1;
        }
    }

    const finalRoll = `${prefix}${nextIndex}`;
    console.log(`Generated Roll Number: ${finalRoll}`);
    return finalRoll;
}

// @route   POST /api/admin/create-user
// @desc    Admin creates a new user, or Teacher creates a Student
// @access  Private (Admin/Teacher)
router.post('/create-user', protect, authorize('ADMIN', 'TEACHER'), async (req, res) => {
    let { name, email: rawEmail, password, role, department, year, subjects, gpa, overallGrade, assignedTeacher, rollNumber, facultyHead, subjectTeachers } = req.body;
    const normalizedEmail = rawEmail?.toLowerCase();

    try {
        console.log(`Create User Attempt: ${normalizedEmail} | Role: ${role} | Year: ${year} | Dept: ${department}`);

        // Teacher can ONLY create STUDENTS
        if (req.user.role === 'TEACHER' && role !== 'STUDENT') {
            return res.status(403).json({ message: 'Teachers can only create students.' });
        }

        const userExists = await User.findOne({ email: normalizedEmail });
        if (userExists) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Fetch requester's profile to get their official department
        const requester = await User.findById(req.user.id);

        // Teacher context: fallback department to teacher's dept if not provided
        if (req.user.role === 'TEACHER' && role === 'STUDENT' && (!department || department.trim() === '')) {
            department = requester?.department;
        }

        // Auto-generate Roll Number for Students if not provided
        if (role === 'STUDENT' && !rollNumber) {
            if (department && year) {
                rollNumber = await generateRollNumber(department, year);
            } else {
                console.warn(`Cannot auto-generate roll number: Missing Dept or Year. Dept: ${department}, Year: ${year}`);
            }
        }

        // If Teacher is creating student, auto-assign
        if (req.user.role === 'TEACHER' && role === 'STUDENT') {
            assignedTeacher = req.user.id;
            facultyHead = req.user.id;
        }

        // Sanitize Roll Number: convert empty string to undefined for sparse index
        if (typeof rollNumber === 'string') {
            if (rollNumber.trim() === '') rollNumber = undefined;
        } else if (!rollNumber) {
            rollNumber = undefined;
        }

        // Sanitize ObjectId fields: Convert empty strings to undefined
        if (assignedTeacher === '') assignedTeacher = undefined;
        if (facultyHead === '') facultyHead = undefined;

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = await User.create({
            name,
            email: normalizedEmail,
            password: hashedPassword,
            role: role || 'STUDENT',
            department,
            year: (year && !isNaN(year)) ? year : undefined,
            subjects: subjects || [],
            gpa,
            overallGrade,
            assignedTeacher,
            rollNumber,
            facultyHead,
            subjectTeachers: subjectTeachers || []
        });

        console.log(`User created successfully: ${user.email} | Roll: ${user.rollNumber}`);

        res.status(201).json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            rollNumber: user.rollNumber,
            message: 'User created successfully'
        });
    } catch (error) {
        console.error('User Creation Error:', error);
        res.status(500).json({
            message: 'Server error',
            error: error.message,
            details: error.errors ? Object.keys(error.errors).map(key => error.errors[key].message) : []
        });
    }
});

// @route   GET /api/admin/users
// @desc    Get all users (Admin) or Assigned Students (Teacher)
// @access  Private (Admin/Teacher)
router.get('/users', protect, authorize('ADMIN', 'TEACHER'), async (req, res) => {
    try {
        let query = {};

        // Data Isolation: Teachers only see their assigned students
        if (req.user.role === 'TEACHER') {
            query = {
                role: 'STUDENT',
                $or: [
                    { assignedTeacher: req.user.id },
                    { facultyHead: req.user.id }
                ]
            };
        }

        const users = await User.find(query).select('-password');
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/admin/users/:id
// @desc    Get single user profile
// @access  Private (Admin/Teacher)
router.get('/users/:id', protect, authorize('ADMIN', 'TEACHER'), async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password');
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/admin/users/:id
// @desc    Update user details (Admin or assigned Teacher)
// @access  Private
router.put('/users/:id', protect, async (req, res) => {
    try {
        const userToUpdate = await User.findById(req.params.id);
        if (!userToUpdate) return res.status(404).json({ message: 'User not found' });

        // Authorization: Admin or the Teacher who is assigned to this student
        const isAdmin = req.user.role === 'ADMIN';
        const isAssignedTeacher = req.user.role === 'TEACHER' &&
            (userToUpdate.assignedTeacher?.toString() === req.user.id ||
                userToUpdate.facultyHead?.toString() === req.user.id);

        if (!isAdmin && !isAssignedTeacher) {
            return res.status(403).json({ message: 'Not authorized to manage this student' });
        }

        const { name, email, department, year, subjects, rollNumber, facultyHead, assignedTeacher, gpa } = req.body;

        if (name) userToUpdate.name = name;
        if (email) userToUpdate.email = email;
        if (department) userToUpdate.department = department;
        if (year) userToUpdate.year = year;
        if (subjects) userToUpdate.subjects = subjects;
        if (rollNumber) userToUpdate.rollNumber = rollNumber;
        if (gpa !== undefined) userToUpdate.gpa = gpa;

        // Special handling for assignments (allowing unassignment)
        if (facultyHead !== undefined) {
            userToUpdate.facultyHead = (facultyHead === '' || facultyHead === null) ? null : facultyHead;
        }
        if (assignedTeacher !== undefined) {
            userToUpdate.assignedTeacher = (assignedTeacher === '' || assignedTeacher === null) ? null : assignedTeacher;
        }

        await userToUpdate.save();

        // 🚨 Trigger GPA recalculation if student info was updated
        if (userToUpdate.role === 'STUDENT') {
            const { recalculateStudentGPA } = require('../utils/gpaUtils');
            await recalculateStudentGPA(userToUpdate._id);
        }

        res.json(userToUpdate);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// @route   DELETE /api/admin/users/:id
// @desc    Delete a user
// @access  Private (Admin or Assigned Teacher for Student)
router.delete('/users/:id', protect, authorize('ADMIN', 'TEACHER'), async (req, res) => {
    try {
        const userToDelete = await User.findById(req.params.id);
        if (!userToDelete) return res.status(404).json({ message: 'User not found' });

        // Authorization check
        const isAdmin = req.user.role === 'ADMIN';
        const isAssignedTeacher = req.user.role === 'TEACHER' && 
            userToDelete.role === 'STUDENT' &&
            (userToDelete.assignedTeacher?.toString() === req.user.id || 
             userToDelete.facultyHead?.toString() === req.user.id);

        if (!isAdmin && !isAssignedTeacher) {
            return res.status(403).json({ message: 'Not authorized to delete this user' });
        }

        // If the deleted user is a teacher, clear references in student records (Admin only context usually)
        if (userToDelete.role === 'TEACHER') {
            await User.updateMany(
                { $or: [{ assignedTeacher: userToDelete._id }, { facultyHead: userToDelete._id }] },
                { $unset: { assignedTeacher: "", facultyHead: "" } }
            );
        }

        await User.findByIdAndDelete(req.params.id);
        res.json({ message: 'User removed successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   DELETE /api/admin/cleanup-assessments
// @desc    Clear all assessments and submissions (Marks/Feedback)
// @access  Private (Admin Only)
router.delete('/cleanup-assessments', protect, authorize('ADMIN'), async (req, res) => {
    try {
        const Assessment = require('../models/Assessment');
        const Submission = require('../models/Submission');

        await Assessment.deleteMany({});
        await Submission.deleteMany({});

        res.json({ message: 'All assessments and submissions have been cleared successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Cleanup failed', error: error.message });
    }
});


// @route   POST /api/admin/system/cleanup
// @desc    Wipe all assessment records and submissions ONLY. User profiles are preserved.
// @access  Private (Admin)
router.post('/system/cleanup', protect, authorize('ADMIN'), async (req, res) => {
    try {
        console.log('--- FACTORY RESET INITIATED (User profiles protected) ---');

        // 1. Delete all submissions (grades, CGPA data)
        const submissionResult = await Submission.deleteMany({});
        console.log(`Deleted ${submissionResult.deletedCount} submissions`);

        // 2. Delete all assessments and AI generated questions
        const assessmentResult = await Assessment.deleteMany({});
        console.log(`Deleted ${assessmentResult.deletedCount} assessments`);

        // NOTE: User profiles (faculty, students, admins) are NOT deleted.
        // GPA fields on users will naturally reflect 0 after submissions are wiped.

        res.json({
            message: 'Factory reset complete. Assessments & results cleared. All user profiles preserved.',
            details: {
                submissionsDeleted: submissionResult.deletedCount,
                assessmentsDeleted: assessmentResult.deletedCount,
            }
        });
    } catch (error) {
        console.error('System Cleanup Error:', error);
        res.status(500).json({ message: 'Cleanup Failed', error: error.message });
    }
});

module.exports = router;
