const express = require('express');
const router = express.Router();
const Submission = require('../models/Submission');
const Assessment = require('../models/Assessment');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/authMiddleware');
const { evaluateSubmission } = require('../services/aiService');
const { recalculateStudentGPA } = require('../utils/gpaUtils');
const { generateSubmissionReportPDF } = require('../services/pdfService');

// @route   POST /api/submissions/start
// @desc    Start an assessment (Create IN_PROGRESS submission)
// @access  Private (Student)
router.post('/start', protect, authorize('STUDENT'), async (req, res) => {
    try {
        const { assessmentId } = req.body;

        const assessment = await Assessment.findById(assessmentId);
        if (!assessment) return res.status(404).json({ message: 'Assessment not found' });

        // Check if already submitted (not in progress)
        const existing = await Submission.findOne({
            assessmentId,
            studentId: req.user.id
        });

        if (existing && existing.status !== 'IN_PROGRESS') {
            return res.status(400).json({ message: 'Assessment already submitted' });
        }

        if (existing && existing.status === 'IN_PROGRESS') {
            return res.json(existing);
        }

        const submission = await Submission.create({
            assessmentId,
            studentId: req.user.id,
            maxScore: assessment.questions.reduce((sum, q) => sum + (q.maxPoints || 0), 0),
            status: 'IN_PROGRESS'
        });

        res.status(201).json(submission);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @route   POST /api/submissions/:id/submit
// @desc    Submit answers and get AI grading
// @access  Private (Student)
router.post('/:id/submit', protect, authorize('STUDENT'), async (req, res) => {
    try {
        const submission = await Submission.findOne({
            _id: req.params.id,
            studentId: req.user.id
        });

        if (!submission) return res.status(404).json({ message: 'Submission not found' });
        if (submission.status !== 'IN_PROGRESS') return res.status(400).json({ message: 'Already submitted' });

        const { answers, timeTaken, malpractice, malpracticeReason } = req.body;
        submission.answers = answers || {};
        submission.timeTaken = timeTaken;
        submission.submittedAt = Date.now();

        // ─── Malpractice: instant Grade F, no AI evaluation ───
        if (malpractice) {
            submission.score = 0;
            submission.grade = 'F';
            submission.malpractice = true;
            submission.malpracticeReason = malpracticeReason || 'Academic integrity violation detected.';
            submission.feedback = `⚠️ MALPRACTICE DETECTED: ${malpracticeReason || 'Academic integrity violation.'}. Assessment auto-closed with Grade F. This incident has been recorded.`;
            submission.status = 'GRADED';
            await submission.save();
            await recalculateStudentGPA(submission.studentId);
            return res.json(submission);
        }

        submission.status = 'SUBMITTED';

        // AI Grading
        const assessment = await Assessment.findById(submission.assessmentId);
        if (assessment) {
            try {
                const evaluation = await evaluateSubmission(assessment.title, assessment.questions, answers || {});
                submission.score = evaluation.totalScore || evaluation.score || 0;
                submission.feedback = evaluation.overallFeedback || evaluation.generalFeedback || evaluation.feedback || "Submission received.";
                submission.breakdown = evaluation.questionBreakdown || evaluation.breakdown || [];
                submission.aiFeedbackBreakdown = {
                    breakdown: evaluation.questionBreakdown || evaluation.breakdown || [],
                    overallFeedback: evaluation.overallFeedback || evaluation.generalFeedback || evaluation.feedback
                };
                submission.grade = evaluation.suggestedGrade || 'N/A';
                submission.status = 'GRADED';
            } catch (aiErr) {
                console.error("AI Evaluation failed:", aiErr);
                submission.status = 'SUBMITTED'; // Fallback to manual
            }
        }

        await submission.save();

        if (submission.status === 'GRADED') {
            await recalculateStudentGPA(submission.studentId);
        }

        res.json(submission);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @route   GET /api/submissions/my
// @desc    Get current user's submissions
// @access  Private
router.get('/my', protect, async (req, res) => {
    try {
        const submissions = await Submission.find({ studentId: req.user.id }).sort({ submittedAt: -1 });
        res.json(submissions);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});

// @route   GET /api/submissions
// @desc    Get filtered submissions (Teacher sees assigned students)
// @access  Private (Teacher/Admin)
router.get('/', protect, authorize('TEACHER', 'ADMIN'), async (req, res) => {
    try {
        let query = {};
        if (req.user.role === 'TEACHER') {
            // Only show submissions for this teacher's own assessments
            const myAssessmentIds = await Assessment.find({ createdBy: req.user.id }).distinct('_id');
            query = { assessmentId: { $in: myAssessmentIds } };
        }

        const submissions = await Submission.find(query)
            .populate('studentId', 'name email department rollNumber')
            .sort({ submittedAt: -1 });
        res.json(submissions);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});

// @route   PUT /api/submissions/:id
// @desc    Teacher override score/feedback
// @access  Private (Teacher Only)
router.put('/:id', protect, authorize('TEACHER', 'ADMIN'), async (req, res) => {
    try {
        const { score, feedback, teacherFeedback, teacherOverrideScore, grade, aiFeedbackBreakdown } = req.body;
        const submission = await Submission.findById(req.params.id);

        if (!submission) return res.status(404).json({ message: 'Submission not found' });

        if (teacherOverrideScore !== undefined) submission.teacherOverrideScore = teacherOverrideScore;
        if (teacherFeedback !== undefined) submission.teacherFeedback = teacherFeedback;
        if (grade !== undefined) submission.grade = grade;
        
        // Persist teacher-edited AI feedback breakdown
        if (aiFeedbackBreakdown !== undefined) {
            submission.aiFeedbackBreakdown = aiFeedbackBreakdown;
            // Also sync the top-level feedback if overall changed
            if (aiFeedbackBreakdown.overallFeedback) {
                submission.feedback = aiFeedbackBreakdown.overallFeedback;
            }
        }

        // Also allow legacy updates
        if (score !== undefined) submission.score = score;
        if (feedback !== undefined) submission.feedback = feedback;

        await submission.save();

        // 🚨 CRITICAL: Sync GPA after teacher override
        await recalculateStudentGPA(submission.studentId);

        res.json(submission);
    } catch (error) {
        console.error("Manual evaluation update failed:", error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @route   GET /api/submissions/:id/report
// @desc    Download submission PDF report
// @access  Private
router.get('/:id/report', protect, async (req, res) => {
    try {
        const submission = await Submission.findById(req.params.id).populate('studentId', 'name email rollNumber');
        if (!submission) return res.status(404).json({ message: 'Submission not found' });

        // Ensure user can access this submission
        if (req.user.role === 'STUDENT' && submission.studentId._id.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const assessment = await Assessment.findById(submission.assessmentId);
        if (!assessment) return res.status(404).json({ message: 'Assessment not found' });

        const pdfBytes = await generateSubmissionReportPDF(submission, assessment);

        res.contentType('application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="report_${submission._id}.pdf"`);
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error('PDF Generation Error:', error);
        res.status(500).json({ message: 'Server Error generating PDF' });
    }
});

module.exports = router;
