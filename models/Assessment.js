const mongoose = require('mongoose');

const answerKeySchema = new mongoose.Schema({
    questionId: String,
    questionIndex: Number,
    type: { type: String, enum: ['MCQ', 'DESCRIPTIVE'] },
    correctAnswer: String,       // For MCQ: the correct option text
    correctOptionIndex: Number,  // For MCQ: correct index
    keyPoints: [String],         // For DESCRIPTIVE: key concepts to look for
    fullAnswer: String,          // Full model answer for DESCRIPTIVE
    maxPoints: Number
}, { _id: false });

const questionSchema = new mongoose.Schema({
    id: String,
    type: { type: String, enum: ['MCQ', 'DESCRIPTIVE'] },
    prompt: String,
    options: [String],
    correctOptionIndex: Number,
    expectedAnswer: String,      // Model answer for DESCRIPTIVE questions
    keyPoints: [String],         // Key concepts for partial marking
    difficulty: String,
    topic: String,
    maxPoints: Number
});

const assessmentSchema = new mongoose.Schema({
    title: { type: String, required: true },
    topic: { type: String, required: true },
    questions: [questionSchema],
    answerKey: [answerKeySchema],   // AI-generated answer key
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material' },
    department: { type: String },
    createdAt: { type: Date, default: Date.now },
    dueDate: Date,
    status: { type: String, enum: ['DRAFT', 'PUBLISHED', 'CLOSED'], default: 'DRAFT' }
});

module.exports = mongoose.model('Assessment', assessmentSchema);
