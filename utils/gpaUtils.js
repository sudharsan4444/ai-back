const Submission = require('../models/Submission');
const User = require('../models/User');

/**
 * Maps percentage to Indian standard grade points (UGC/CBCS 10-point scale)
 * @param {number} percentage - The score percentage (0-100)
 * @returns {number} Grade points (0-10)
 */
const getGradePoints = (percentage) => {
    if (percentage >= 90) return 10;
    if (percentage >= 80) return 9;
    if (percentage >= 70) return 8;
    if (percentage >= 60) return 7;
    if (percentage >= 50) return 6;
    if (percentage >= 40) return 5;
    if (percentage >= 35) return 4;
    return 0;
};

/**
 * Recalculates aggregate GPA for a specific teacher based on their assigned students
 * @param {string} teacherId - The ID of the teacher
 */
const recalculateTeacherGPA = async (teacherId) => {
    try {
        if (!teacherId) return;

        const assignedStudents = await User.find({
            $or: [{ assignedTeacher: teacherId }, { facultyHead: teacherId }],
            role: 'STUDENT'
        });

        if (assignedStudents.length === 0) {
            await User.findByIdAndUpdate(teacherId, { gpa: 0 });
            return;
        }

        const validGpas = assignedStudents.map(s => s.gpa).filter(g => g !== undefined && g !== null);

        if (validGpas.length === 0) {
            await User.findByIdAndUpdate(teacherId, { gpa: 0 });
            return;
        }

        const avgGpa = validGpas.reduce((a, b) => a + b, 0) / validGpas.length;
        await User.findByIdAndUpdate(teacherId, { gpa: Math.round(avgGpa * 100) / 100 });
    } catch (err) {
        console.error('GPA recalculation error for teacher:', teacherId, err);
    }
};

/**
 * Recalculates GPA for a specific student based on published assessments
 * @param {string} studentId - The ID of the student
 */
const recalculateStudentGPA = async (studentId) => {
    try {
        const student = await User.findById(studentId);
        if (!student) return;

        const publishedSubmissions = await Submission.find({ studentId, status: 'GRADED' })
            .populate({
                path: 'assessmentId',
                match: { status: 'PUBLISHED' }
            });

        // Filter out submissions where assessmentId is null (meaning it's not published)
        const validSubmissions = publishedSubmissions.filter(s => s.assessmentId);

        let finalGpa = 0;
        let overallGrade = 'N/A';

        if (validSubmissions.length > 0) {
            let totalPoints = 0;
            validSubmissions.forEach(sub => {
                const score = parseFloat(sub.teacherOverrideScore ?? sub.score) || 0;
                const maxScore = parseFloat(sub.maxScore) || 1;
                const percentage = (score / maxScore) * 100;
                totalPoints += getGradePoints(percentage);
            });
            finalGpa = Math.round((totalPoints / validSubmissions.length) * 100) / 100;

            // Map final GPA back to a letter grade for the profile
            if (finalGpa >= 9) overallGrade = 'A+';
            else if (finalGpa >= 8) overallGrade = 'A';
            else if (finalGpa >= 7) overallGrade = 'B';
            else if (finalGpa >= 6) overallGrade = 'C';
            else if (finalGpa >= 5) overallGrade = 'D';
            else overallGrade = 'F';
        }

        await User.findByIdAndUpdate(studentId, { 
            gpa: finalGpa,
            overallGrade: overallGrade 
        });

        // Trigger teacher GPA recalculation
        if (student.assignedTeacher) await recalculateTeacherGPA(student.assignedTeacher);
        if (student.facultyHead && student.facultyHead.toString() !== student.assignedTeacher?.toString()) {
            await recalculateTeacherGPA(student.facultyHead);
        }
    } catch (err) {
        console.error('GPA recalculation error for student:', studentId, err);
    }
};

module.exports = {
    getGradePoints,
    recalculateStudentGPA,
    recalculateTeacherGPA
};
