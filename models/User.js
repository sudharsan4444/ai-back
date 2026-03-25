const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: {
        type: String,
        enum: ['ADMIN', 'TEACHER', 'STUDENT'],
        default: 'STUDENT'
    },
    department: { type: String },
    year: { type: Number },
    subjects: [String],
    gpa: { type: Number, default: 0 },
    overallGrade: { type: String, default: 'N/A' },
    assignedTeacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    facultyHead: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rollNumber: { type: String, unique: true, sparse: true },
    subjectTeachers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
