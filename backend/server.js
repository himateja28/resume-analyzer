// server.js
const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const upload = multer({ dest: '/tmp/' }); // use /tmp for Vercel
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Extract text from file
async function extractTextFromFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const buffer = fs.readFileSync(file.path);
  try {
    if (ext === '.pdf') {
      const data = await pdfParse(buffer);
      return data.text || '';
    } else if (ext === '.docx' || ext === '.doc') {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    } else {
      return buffer.toString('utf8');
    }
  } finally {
    try { fs.unlinkSync(file.path); } catch (e) {}
  }
}

// POST /api/analyze
app.post('/api/analyze', upload.single('resume'), async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  try {
    const jdText = (req.body.jd || '').trim();
    if (!req.file) return res.status(400).json({ error: 'No resume uploaded.' });

    const resumeTextFull = await extractTextFromFile(req.file);
    const resumeText = resumeTextFull.slice(0, 4500);

    const prompt = `
You are an expert recruiting/ATS evaluator. Compare the RESUME and the JOB DESCRIPTION (JD) below.

RESUME:
${resumeText}

JD:
${jdText}

Return ONLY valid JSON (no commentary, no markdown, nothing else). The JSON must contain the following keys:
- "atsScore": integer 0-100
- "matchedKeywords": array of strings
- "missingKeywords": array of strings
- "summary": short string
- "strengths": array of strings
- "suggestions": array of strings
`;

    let aiRaw = '';
    let aiParsed = null;
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
      const result = await model.generateContent(prompt);
      aiRaw = result.response.text();

      try {
        aiParsed = JSON.parse(aiRaw);
      } catch {
        const firstBrace = aiRaw.indexOf('{');
        const lastBrace = aiRaw.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
          const maybe = aiRaw.slice(firstBrace, lastBrace + 1);
          try { aiParsed = JSON.parse(maybe); } catch {}
        }
      }
    } catch (e) {
      console.error('Gemini call failed:', e?.message || e);
      aiRaw = 'AI analysis not available: ' + (e?.message || 'unknown error');
    }

    return res.json({
      aiRaw,
      aiParsed,
      atsScore: aiParsed?.atsScore ?? null,
      matchedKeywords: aiParsed?.matchedKeywords ?? [],
      missingKeywords: aiParsed?.missingKeywords ?? [],
      summary: aiParsed?.summary ?? '',
      strengths: aiParsed?.strengths ?? [],
      suggestions: aiParsed?.suggestions ?? []
    });
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error', details: err?.message || String(err) });
  }
});
app.options('/api/analyze', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});

// ✅ Local run only
if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`Server running on ${PORT}`));
}

module.exports = app; // export app for Vercel
