const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const generateAnswerKeyPDF = async (assessment) => {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontSize = 12;

    let y = height - 50;

    // Title
    page.drawText(assessment.title, {
        x: 50,
        y,
        size: 20,
        font: boldFont,
        color: rgb(0, 0, 0),
    });
    y -= 30;

    // Subject
    page.drawText(`Subject: ${assessment.topic}`, {
        x: 50,
        y,
        size: 14,
        font,
        color: rgb(0.3, 0.3, 0.3),
    });
    y -= 40;

    // Questions
    assessment.questions.forEach((q, idx) => {
        if (y < 50) {
            // Add new page if running out of space
            // For MVP we just stop or simplistic handling.
            // Ideally: const newPage = pdfDoc.addPage(); ...
        }

        page.drawText(`${idx + 1}. ${q.prompt}`, {
            x: 50,
            y,
            size: fontSize,
            font: boldFont,
            maxWidth: width - 100,
        });
        y -= 20;

        if (q.type === 'MCQ') {
            q.options.forEach((opt, optIdx) => {
                const isCorrect = optIdx === q.correctOptionIndex;
                page.drawText(`   ${String.fromCharCode(65 + optIdx)}. ${opt} ${isCorrect ? '(Correct)' : ''}`, {
                    x: 50,
                    y,
                    size: fontSize,
                    font,
                    color: isCorrect ? rgb(0, 0.5, 0) : rgb(0, 0, 0),
                });
                y -= 15;
            });
        } else {
            const answerText = q.expectedAnswer || 'Reference answer not provided.';
            // Basic wrapping for the answer key
            const words = answerText.split(' ');
            let line = '   Answer: ';
            const maxW = width - 100;
            
            for (const word of words) {
                const testLine = `${line} ${word}`;
                if (font.widthOfTextAtSize(testLine, fontSize) > maxW) {
                    page.drawText(line, { x: 50, y, size: fontSize, font, color: rgb(0.2, 0.4, 0.2) });
                    y -= 15;
                    line = '           ' + word;
                    if (y < 50) {
                        const newPage = pdfDoc.addPage();
                        y = height - 50;
                        page = newPage;
                    }
                } else {
                    line = testLine;
                }
            }
            page.drawText(line, { x: 50, y, size: fontSize, font, color: rgb(0.2, 0.4, 0.2) });
            y -= 15;
        }
        y -= 20;
    });

    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
};

const generateSubmissionReportPDF = async (submission, assessment) => {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const PAGE_W = 595, PAGE_H = 842, MARGIN = 50, LINE_H = 16;
    let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    const addPage = () => {
        page = pdfDoc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
    };

    const checkY = (needed = 60) => { if (y < MARGIN + needed) addPage(); };

    const drawText = (text, { x = MARGIN, size = 10, f = font, color = rgb(0,0,0), maxW = PAGE_W - MARGIN * 2 } = {}) => {
        // Handle newline characters properly
        const paragraphs = String(text || '').split('\n');
        
        for (const paragraph of paragraphs) {
            const words = paragraph.split(' ');
            let line = '';
            for (const word of words) {
                const test = line ? `${line} ${word}` : word;
                if (f.widthOfTextAtSize(test, size) > maxW && line) {
                    checkY();
                    page.drawText(line, { x, y, size, font: f, color });
                    y -= LINE_H;
                    line = word;
                } else {
                    line = test;
                }
            }
            if (line) {
                checkY();
                page.drawText(line, { x, y, size, font: f, color });
                y -= LINE_H;
            }
            // Additional gap between paragraphs if needed, or just regular newline
        }
    };

    const drawHRule = () => {
        checkY(20);
        page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
        y -= 12;
    };

    // ── Header ──
    const finalScore = submission.teacherOverrideScore !== undefined ? submission.teacherOverrideScore : (submission.score || 0);
    const maxScore = submission.maxScore || 0;
    const pct = maxScore > 0 ? Math.round((finalScore / maxScore) * 100) : 0;

    drawText('STUDENT EVALUATION REPORT', { size: 18, f: boldFont });
    y -= 4;
    drawText(`Assessment: ${assessment.title}`, { size: 13, f: boldFont });
    drawText(`Student: ${submission.studentId?.name || 'Student'} | Roll: ${submission.studentId?.rollNumber || 'N/A'}`, { size: 10 });
    drawText(`Score: ${finalScore} / ${maxScore}  (${pct}%)  | Grade: ${submission.grade || 'N/A'} | Submitted: ${new Date(submission.submittedAt).toLocaleDateString()}`, { size: 10 });

    drawHRule();

    // ── AI Overall Feedback ──
    const overallFeedback = submission.aiFeedbackBreakdown?.overallFeedback || submission.feedback;
    if (overallFeedback) {
        drawText('AI PEDAGOGICAL ANALYSIS:', { size: 11, f: boldFont, color: rgb(0.25, 0.25, 0.8) });
        drawText(overallFeedback, { size: 10 });
        y -= 4;
    }

    // ── Teacher Feedback ──
    if (submission.teacherFeedback) {
        drawText('FACULTY REMARKS:', { size: 11, f: boldFont, color: rgb(0, 0.5, 0.25) });
        drawText(submission.teacherFeedback, { size: 10 });
        y -= 4;
    }

    drawHRule();

    // ── Per-question breakdown ──
    const breakdown = submission.aiFeedbackBreakdown?.breakdown || submission.breakdown || [];
    drawText('QUESTION BREAKDOWN:', { size: 12, f: boldFont });
    y -= 4;

    assessment.questions.forEach((q, idx) => {
        checkY(80);

        const evalData = breakdown.find(b => b.questionId === q.id || b.questionIndex === idx + 1) || {};
        const awarded = evalData.pointsAwarded ?? 0;
        const maxPts = q.maxPoints || 1;
        const studentAns = (submission.answers instanceof Map) ? submission.answers.get(q.id) : submission.answers?.[q.id];

        let studentAnsText = '(No answer)';
        let correctAnsText = 'N/A';

        if (q.type === 'MCQ') {
            const sIdx = parseInt(studentAns);
            studentAnsText = !isNaN(sIdx) && q.options ? `${String.fromCharCode(65 + sIdx)}. ${q.options[sIdx] || ''}` : '(No answer)';
            const cIdx = q.correctOptionIndex;
            correctAnsText = q.options ? `${String.fromCharCode(65 + cIdx)}. ${q.options[cIdx]}` : 'N/A';
        } else {
            studentAnsText = typeof studentAns === 'string' ? studentAns : '(No answer)';
            // Ensure we use expectedAnswer or suggest checking the answer key if it's missing
            correctAnsText = q.expectedAnswer || '(Reference Answer not provided - See Answer Key)';
        }

        const qColor = awarded >= maxPts ? rgb(0, 0.45, 0.1) : awarded > 0 ? rgb(0.7, 0.5, 0) : rgb(0.75, 0, 0);

        drawText(`Q${idx + 1}. ${q.prompt}`, { f: boldFont, size: 11 });
        drawText(`  Marks: ${awarded} / ${maxPts}  | Type: ${q.type}`, { size: 9, color: qColor });

        drawText(`  STUDENT ANSWER:`, { size: 9, f: boldFont, x: MARGIN + 6 });
        drawText(`  ${studentAnsText}`, { size: 9, x: MARGIN + 6, maxW: PAGE_W - MARGIN * 2 - 12 });

        drawText(`  REFERENCE / MODEL ANSWER:`, { size: 9, f: boldFont, x: MARGIN + 6, color: rgb(0, 0.4, 0) });
        drawText(`  ${correctAnsText}`, { size: 9, x: MARGIN + 6, maxW: PAGE_W - MARGIN * 2 - 12, color: rgb(0, 0.3, 0) });

        // Add Key Points if descriptive
        if (q.type === 'DESCRIPTIVE' && q.keyPoints?.length > 0) {
            drawText(`  KEY EVALUATION CONCEPTS:`, { size: 8, f: boldFont, x: MARGIN + 12, color: rgb(0, 0.35, 0.2) });
            const kpText = q.keyPoints.join(' • ');
            drawText(`  ${kpText}`, { size: 8, x: MARGIN + 12, color: rgb(0, 0.4, 0.3), maxW: PAGE_W - MARGIN * 2 - 20 });
        }

        if (evalData.feedback) {
            drawText(`  EVALUATOR AI FEEDBACK:`, { size: 9, f: boldFont, x: MARGIN + 6, color: rgb(0, 0, 0.6) });
            drawText(`  ${evalData.feedback}`, { size: 9, x: MARGIN + 6, color: rgb(0.2, 0.2, 0.7), maxW: PAGE_W - MARGIN * 2 - 12 });
        }
        y -= 8;
        drawHRule();
    });

    // ── Footer ──
    page.drawText(`Generated on ${new Date().toLocaleString()} | AI Teaching Assistant`, {
        x: MARGIN, y: MARGIN / 2, size: 8, font, color: rgb(0.6, 0.6, 0.6)
    });

    return await pdfDoc.save();
};


module.exports = { generateAnswerKeyPDF, generateSubmissionReportPDF };
