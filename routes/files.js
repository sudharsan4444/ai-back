const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const Assessment = require('../models/Assessment');
const Submission = require('../models/Submission'); // If we want to allow students to download their own results
const { generateAnswerKeyPDF } = require('../services/pdfService');

// @route   GET /api/files/assessment/:id/answer-key
// @desc    Download Answer Key PDF
// @access  Private (Teacher Only, or Student if submitted?)
//          Requirement: "Teachers: Can download... Students: after submission"
router.get('/assessment/:id/answer-key', protect, async (req, res) => {
    try {
        const assessment = await Assessment.findById(req.params.id);
        if (!assessment) return res.status(404).json({ message: 'Assessment not found' });

        // Authorization Check
        if (req.user.role === 'STUDENT') {
            // Check if student has submitted
            const submission = await Submission.findOne({
                assessmentId: assessment._id,
                studentId: req.user.id,
                status: { $in: ['SUBMITTED', 'GRADED'] }
            });
            if (!submission) {
                return res.status(403).json({ message: 'You must complete the assessment first.' });
            }
        }

        const pdfBytes = await generateAnswerKeyPDF(assessment);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="answer-key-${assessment.title}.pdf"`);
        res.send(Buffer.from(pdfBytes));

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @route   GET /api/files/submission/:id/pdf
// @desc    Download Submission Report PDF
// @access  Private (Teacher or Admin)
router.get('/submission/:id/pdf', protect, authorize('TEACHER', 'ADMIN'), async (req, res) => {
    try {
        const submission = await Submission.findById(req.params.id)
            .populate('studentId', 'name rollNumber')
            .populate('assessmentId');
            
        if (!submission) return res.status(404).json({ message: 'Submission not found' });
        
        // Use require dynamically or add require at top
        const { generateSubmissionReportPDF } = require('../services/pdfService');
        const pdfBytes = await generateSubmissionReportPDF(submission, submission.assessmentId);

        const studentName = submission.studentId?.name || 'Student';
        const sanitizedName = studentName.replace(/\s+/g, '_');

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${sanitizedName}_Evaluation.pdf"`);
        res.send(Buffer.from(pdfBytes));

    } catch (error) {
        console.error('PDF Generation Error:', error);
        res.status(500).json({ message: 'Server Error generating PDF' });
    }
});

module.exports = router;
