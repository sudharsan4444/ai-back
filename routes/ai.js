const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { generateContent, generateQuiz, evaluateSubmission } = require('../services/aiService');
const { queryContext } = require('../services/ragService');
const Submission = require('../models/Submission');
const Assessment = require('../models/Assessment');

// @route   POST /api/ai/chat
// @desc    Chat with AI (RAG enabled)
// @access  Private
router.post('/chat', protect, async (req, res) => {
    const { message, materialId } = req.body;

    try {
        // INTEGRITY CHECK: Block AI chat during active quiz
        if (req.user.role === 'STUDENT') {
            const activeQuiz = await Submission.findOne({
                studentId: req.user.id,
                status: 'IN_PROGRESS'
            });

            if (activeQuiz) {
                return res.status(403).json({
                    message: 'AI Chat is disabled during an active assessment.',
                    integrityBlock: true
                });
            }
        }

        // Use materialId if and only if it's provided (Contextual Chat)
        const context = await queryContext(message, 5, materialId);

        let sysPrompt = "You are a helpful AI Teaching Assistant.";
        if (context) {
            sysPrompt += `\nUse the following context to answer the student's question:\n${context}`;
        }

        // The provided snippet seems to be for an AI service function, not directly for this route handler.
        // Assuming the intent is to add logging around the generateContent call in this route.
        // If the user intended to replace generateContent with a direct call to Groq,
        // that would require importing callGroq and changing the logic significantly.
        // Sticking to adding logging around the existing generateContent call as it's the most faithful interpretation for this file.

        const prompt = `${sysPrompt}\n\nUser: ${message}`;
        console.log(`[AI-ROUTE] Sending Chat Prompt (length: ${prompt.length})...`);
        const response = await generateContent(prompt);
        console.log(`[AI-ROUTE] Received Chat Response.`);
        res.json({ reply: response });
    } catch (error) {
        console.error(`[AI-ROUTE] AI Chat Error:`, error);
        res.status(500).json({ message: 'AI Chat Error' });
    }
});

// @route   POST /api/ai/generate-quiz
// @desc    Generate quiz questions based on selected material
// @access  Private (Teacher/Admin) — ALL teachers can use ANY material (including admin-uploaded)
router.post('/generate-quiz', protect, authorize('TEACHER', 'ADMIN'), async (req, res) => {
    const { materialId, count, difficulty } = req.body;
    console.log(`[AI-ROUTE] Generate Quiz Request: Material=${materialId}, Count=${count}, Diff=${difficulty}`);
    
    try {
        if (!materialId) {
            console.error('[AI-ROUTE] ❌ Missing Material ID');
            return res.status(400).json({ message: 'Material ID is required' });
        }

        const Material = require('../models/Material');
        let material;
        try {
            material = await Material.findById(materialId);
        } catch (dbErr) {
            console.error(`[AI-ROUTE] ❌ Database Error finding material: ${dbErr.message}`);
            return res.status(500).json({ message: 'Database error while fetching material', error: dbErr.message });
        }

        if (!material) {
            console.error(`[AI-ROUTE] ❌ Material not found: ${materialId}`);
            return res.status(404).json({ message: 'Material not found.' });
        }

        console.log(`[AI-ROUTE] Found Material: ${material.title}. Fetching context...`);
        const topic = material.title;
        let contextText = "";
        try {
            console.log(`[AI-ROUTE] Querying context for Material: ${materialId} (topK: 50)`);
            contextText = await queryContext(topic, 50, materialId);
            
            if (!contextText || contextText.trim().length < 100) {
                console.warn(`[AI-ROUTE] ⚠️ Topic-based RAG found little context. Trying broad fallback...`);
                contextText = await queryContext("The", 30, materialId);
            }
        } catch (ctxErr) {
            console.error(`[AI-ROUTE] ❌ Context Query Failed:`, ctxErr);
            throw new Error(`Failed to retrieve material context: ${ctxErr.message}`);
        }
        
        console.log(`[AI-ROUTE] Calling AI Generation...`);
        try {
            const { questions, answerKey } = await generateQuiz(topic, count, difficulty, contextText);
            console.log(`[AI-ROUTE] ✅ Success! Generated ${questions?.length} questions.`);
            res.json({ questions, answerKey, topic, materialId });
        } catch (aiErr) {
            console.error(`[AI-ROUTE] ❌ AI Generation Logic Error:`, aiErr);
            // If it's a strict mode context error, return 400 Bad Request
            const isContextError = aiErr.message.includes('STRICT MODE') || aiErr.message.includes('context') || aiErr.message.includes('educational');
            res.status(isContextError ? 400 : 500).json({ 
                message: isContextError ? 'Material Context Insufficient' : 'AI failed to generate quiz content', 
                error: aiErr.message,
                stack: aiErr.stack
            });
        }
    } catch (error) {
        console.error('[AI-ROUTE] 💥 Critical Uncaught Error:', error);
        res.status(500).json({ message: 'Critical Server Error during quiz generation', error: error.message });
    }
});

module.exports = router;
