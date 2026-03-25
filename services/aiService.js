const groqService = require('./groqService');
const embeddingService = require('./embeddingService');

// Default to Groq for logic, local for embeddings
const provider = groqService;

console.log('Using AI Provider: Groq (logic) & Transformers.js (embeddings)');

module.exports = {
    getEmbedding: embeddingService.getEmbedding,
    generateContent: provider.generateContent,
    generateQuiz: provider.generateQuiz,
    evaluateSubmission: provider.evaluateSubmission
};
