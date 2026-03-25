const Groq = require("groq-sdk");
const embeddingService = require("./embeddingService");

const rawKey = process.env.GROQ_API_KEY || "";
const groq = new Groq({ apiKey: rawKey.trim() });

if (rawKey) {
    console.log(`AI Service initialized with key: ${rawKey.trim().substring(0, 7)}...${rawKey.trim().slice(-4)}`);
} else {
    console.error("GROQ_API_KEY is missing from environment variables!");
}

const getEmbedding = async (text) => {
    return await embeddingService.getEmbedding(text);
};

const callGroq = async (options) => {
    try {
        return await groq.chat.completions.create(options);
    } catch (error) {
        if (error.status === 401) {
            throw new Error("Invalid Groq API Key. Please check your backend/.env file and get a new key from https://console.groq.com/keys");
        }
        throw error;
    }
};

const generateContent = async (prompt) => {
    const response = await callGroq({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
    });
    return response.choices[0].message.content;
};

/**
 * Generate a quiz STRAIGHT from the provided material context.
 * Returns: { questions: [...], answerKey: [...] }
 */
const generateQuiz = async (materialTitle, count, difficulty, context = "", usedQuestions = []) => {
    const mcqCount = Math.round(count * 0.6);
    const descCount = count - mcqCount;

    const avoidList = usedQuestions.length > 0
        ? `\n\nPREVIOUSLY USED QUESTIONS (avoid repeating):\n${usedQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
        : '';

    if (!context || context.trim().length < 50) {
        throw new Error("STRICT MODE: No educational context found in the uploaded material. Please ensure the PDF contains extractable text before generating a quiz.");
    }

    const contextBlock = `SOURCE MATERIAL CONTEXT (STRICT SOURCE):\n"${context}"`;

    const difficultyGuide = {
        Easy: 'conceptual recall and basic understanding questions',
        Medium: 'application and analysis questions requiring detail',
        Hard: 'higher-order evaluation and synthesis questions'
    }[difficulty] || 'mixed level questions';

    const prompt = `You are a Senior University Professor and head of the academic examination board.
    
    GOAL: Generate a high-stakes, professional university-level assessment derived from the provided SOURCE MATERIAL CONTEXT.
    
    CRITICAL RULES (STRICT ENFORCEMENT):
    1. EXAM BRANDING: The questions must look like they were created for a final degree examination. 
    2. PHRASE BLACKLIST: ABSOLUTELY DO NOT use phrases like:
       - "based on the provided PDF"
       - "as mentioned in the material"
       - "from the above passage"
       - "according to the source text"
       - "in the context of the document"
    3. NO PDF MENTIONS: Never mention "PDF", "document", "material", or "source" inside any question.
    4. PEDAGOGY: Test deep understanding, application of concepts, and critical analysis, NOT just verbatim recall of sentences.
    5. TOPIC COVERAGE: Carefully identify all major definitions, formulas, and concepts. Each question should target a distinct important topic.
    6. NO DUPLICATION: Ensure zero thematic overlap between questions.
    
    SOURCE MATERIAL CONTEXT (READ CAREFULLY):
    "${context}"
    
    Topic: ${materialTitle}
    Difficulty: ${difficulty} (${difficultyGuide})
    ${avoidList}

    ASSESSMENT STRUCTURE:
    - CATEGORY: ${difficulty} Level University Exam
    - MCQ COUNT: ${mcqCount} (Weight: 1 pt each)
    - DESCRIPTIVE COUNT: ${descCount} (Weight: 3-5 pts each)

RESPOND WITH VALID JSON ONLY:
{
  "questions": [
    {
      "type": "MCQ",
      "prompt": "Professional exam question without any source citations",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctOptionIndex": 0,
      "difficulty": "${difficulty}",
      "topic": "Specific sub-topic name",
      "maxPoints": 1
    },
    {
      "type": "DESCRIPTIVE",
      "prompt": "Rigorous analytical or descriptive question",
      "expectedAnswer": "Comprehensive model answer for grading",
      "keyPoints": ["Technical Point 1", "Technical Point 2", "Technical Point 3"],
      "difficulty": "${difficulty}",
      "topic": "Specific sub-topic name",
      "maxPoints": 5
    }
  ],
  "answerKey": [
    {
      "questionIndex": 1,
      "type": "MCQ",
      "correctAnswer": "Exact text of the correct option",
      "correctOptionIndex": 0,
      "maxPoints": 1
    },
    {
      "questionIndex": 2,
      "type": "DESCRIPTIVE",
      "fullAnswer": "Detailed grading rubric answer",
      "keyPoints": ["Point 1", "Point 2", "Point 3"],
      "maxPoints": 5
    }
  ]
}

Ensure exactly ${mcqCount} MCQs and ${descCount} DESCRIPTIVE questions.`;

    console.log(`[GROQ-SERVICE] Sending Quiz Generation Request (RAG context size: ${context.length} chars)`);
    let response;
    try {
        response = await callGroq({
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: "You are a professional university examination board JSON generator. You must respond ONLY with valid JSON exactly matching the requested schema." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" }
        });
    } catch (apiErr) {
        console.error(`[GROQ-SERVICE] Groq API Error:`, apiErr);
        // Fallback: try without json_object mode if it fails
        if (apiErr.status === 400) {
            console.log(`[GROQ-SERVICE] JSON mode failed. Retrying in standard mode...`);
            response = await callGroq({
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: prompt + "\n\nRespond with a plain JSON object only." }]
            });
        } else {
            throw apiErr;
        }
    }

    let content;
    const rawContent = response.choices[0]?.message?.content;
    console.log(`[GROQ-SERVICE] Received Raw Content Length: ${rawContent?.length || 0}`);
    
    if (!rawContent) {
        console.error("Groq Empty Response Choice:", JSON.stringify(response, null, 2));
        throw new Error("AI service returned an empty response. Please try again.");
    }

    try {
        // Strip any potential markdown code blocks if the AI includes them despite json_object mode
        const cleanedContent = rawContent.replace(/```json\n?|\n?```/g, '').trim();
        content = JSON.parse(cleanedContent);
    } catch (parseError) {
        console.error("JSON Parse Error. Raw Content:", rawContent);
        console.error("Attempting regex recovery...");
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                content = JSON.parse(jsonMatch[0]);
            } catch (innerError) {
                console.error("Regex recovery failed:", innerError);
                throw new Error("AI generated an unparseable response. Please check backend logs or try again.");
            }
        } else {
            throw new Error("AI response did not contain valid JSON metadata.");
        }
    }

    const rawQuestions = content.questions || content.quiz || (Array.isArray(content) ? content : []);
    const answerKey = content.answerKey || [];

    if (rawQuestions.length === 0) {
        throw new Error("AI failed to generate any questions for this topic.");
    }

    const questions = rawQuestions.map((q, i) => ({ 
        ...q, 
        id: `q_${Date.now()}_${i}`,
        maxPoints: q.maxPoints || (q.type === 'MCQ' ? 1 : 3)
    }));

    // Link answerKey questionId to actual generated question ids
    const finalAnswerKey = answerKey.map((ak, i) => {
        if (questions[i]) return { ...ak, questionId: questions[i].id };
        return ak;
    });

    return { questions, answerKey: finalAnswerKey };
};

const evaluateSubmission = async (assessmentTitle, questions, studentAnswers) => {
    try {
        const evaluations = [];
        let totalScore = 0;

        // Separate MCQs for programmatic grading and descriptive for AI grading
        const descriptiveQuestionsToEvaluate = [];

        questions.forEach((q, idx) => {
            const studentAns = studentAnswers[q.id];

            if (q.type === 'MCQ') {
                const isCorrect = String(studentAns) === String(q.correctOptionIndex);
                const score = isCorrect ? (q.maxPoints || 1) : 0;
                totalScore += score;
                evaluations.push({
                    questionId: q.id,
                    questionIndex: idx + 1,
                    pointsAwarded: score,
                    maxPoints: q.maxPoints || 1,
                    correct: isCorrect,
                    feedback: isCorrect ? "Correct answer!" : `Incorrect. The correct answer was: ${q.options[q.correctOptionIndex]}`,
                    keyConcepts: [],
                    referenceAnswer: q.options[q.correctOptionIndex]
                });
            } else {
                descriptiveQuestionsToEvaluate.push({
                    index: idx,
                    question: q,
                    studentAnswer: studentAns || "—"
                });
            }
        });

        if (descriptiveQuestionsToEvaluate.length > 0) {
                  const prompt = `
      You are an expert academic evaluator. Conduct a comprehensive evaluation of the student's submission for "${assessmentTitle}".
      
      ### EVALUATION CRITERIA:
      1. For each question: Compare Student Answer vs Reference Answer.
      2. Award marks (partial marks allowed) based on conceptual accuracy.
      3. For DESCRIPTIVE answers: Identify specific strengths and technical gaps in the explanation.
      
      ### OVERALL PEDAGOGICAL FEEDBACK (CRITICAL):
      Provide a deep analysis of the student's performance across the entire assessment. 
      - Identify the specific topics/sub-concepts where the student is exceptionally strong.
      - Pinpoint exactly where they lag or exhibit misconceptions.
      - Provide a concrete "Path to Mastery": specific areas they must focus on to improve.
      - DO NOT use generic phrases. Be specific to the answers provided.
      - OVERALL FEEDBACK LENGTH: STRICTLY 4 to 5 lines maximum. Be concise but impactful.
      - The feedback must be encouraging yet rigorously honest.

      ### Questions to Evaluate:
      ${descriptiveQuestionsToEvaluate.map((item, i) => `
      ITEM ${i + 1}:
      Prompt: ${item.question.prompt}
      Max Marks: ${item.question.maxPoints}
      Reference Answer: ${item.question.expectedAnswer}
      Student Answer: "${item.studentAnswer}"
      `).join('\n')}

      ### OUTPUT FORMAT (JSON ONLY):
      {
        "evaluations": [
          {
            "score": number,
            "feedback": "Deep analysis of this specific answer highlighting strengths/gaps",
            "conceptsCovered": ["concept 1"],
            "conceptsMissing": ["missing concept 1"],
            "referenceAnswerUsed": "The model answer used for benchmarking"
          }
        ],
        "overallFeedback": "Extensive yet concise pedagogical analysis (strictly 4-5 lines) of strengths, lags, and the path to mastery."
      }
    `;

            const response = await callGroq({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: "You are an expert academic evaluator. Respond ONLY with valid JSON matching the requested schema." },
                    { role: "user", content: prompt }
                ],
                response_format: { type: "json_object" }
            });

            const aiResult = JSON.parse(response.choices[0].message.content);
            const aiEvals = aiResult.evaluations || [];
            const aiOverall = aiResult.overallFeedback || "Comprehensive evaluation recorded.";

            descriptiveQuestionsToEvaluate.forEach((item, i) => {
                const aiEval = aiEvals[i] || { score: 0, feedback: "Evaluation unavailable", conceptsCovered: [], referenceAnswerUsed: item.question.expectedAnswer };
                const score = parseFloat(aiEval.score) || 0;
                totalScore += score;
                evaluations.push({
                    questionId: item.question.id,
                    questionIndex: item.index + 1,
                    pointsAwarded: score,
                    maxPoints: item.question.maxPoints,
                    correct: score === item.question.maxPoints,
                    feedback: aiEval.feedback,
                    keyConcepts: aiEval.conceptsCovered,
                    referenceAnswer: aiEval.referenceAnswerUsed || item.question.expectedAnswer
                });
            });

            return {
                score: totalScore,
                feedback: aiOverall,
                breakdown: evaluations
            };
        }

        // Programmatic sort and return for MCQ-only or mixed
        evaluations.sort((a, b) => a.questionIndex - b.questionIndex);

        return {
            score: totalScore,
            feedback: "Automated grading completed successfully.",
            breakdown: evaluations
        };

    } catch (error) {
        console.error("Evaluation Error:", error);
        throw error;
    }
};

module.exports = {
    getEmbedding,
    generateContent,
    generateQuiz,
    evaluateSubmission
};
