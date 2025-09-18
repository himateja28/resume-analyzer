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

const upload = multer({ dest: 'uploads/' });
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Gemini client (use env var)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.warn('Warning: GEMINI_API_KEY not set in environment. Gemini calls will fail.');
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Basic text extractor
async function extractTextFromFile(file){
  const ext = path.extname(file.originalname).toLowerCase();
  const buffer = fs.readFileSync(file.path);
  try{
    if(ext === '.pdf'){
      const data = await pdfParse(buffer);
      return data.text || '';
    } else if(ext === '.docx' || ext === '.doc'){
      const result = await mammoth.extractRawText({buffer});
      return result.value || '';
    } else {
      return buffer.toString('utf8');
    }
  } finally {
    try{ fs.unlinkSync(file.path); }catch(e){}
  }
}

// POST /api/analyze
app.post('/api/analyze', upload.single('resume'), async (req, res) => {
  try {
    const jdText = (req.body.jd || '').trim();
    if (!req.file) return res.status(400).json({ error: 'No resume uploaded.' });

    const resumeTextFull = await extractTextFromFile(req.file);
    // limit length to avoid hitting context limits
    const resumeText = resumeTextFull.slice(0, 4500);

    // Build precise prompt asking for JSON only
    const prompt = `
You are an expert recruiting/ATS evaluator. Compare the RESUME and the JOB DESCRIPTION (JD) below.

RESUME:
${resumeText}

JD:
${jdText}

Return ONLY valid JSON (no commentary, no markdown, nothing else). The JSON must contain the following keys:
- "atsScore": integer 0-100 (how well the resume would score against this JD).
- "matchedKeywords": array of strings (skills/keywords present in resume relevant to JD, up to 40 items).
- "missingKeywords": array of strings (important JD skills/keywords not found in resume, up to 40).
- "summary": short string (1-3 sentences summarizing overall fit).
- "strengths": array of short strings (top 3-6 strengths found in resume).
- "suggestions": array of short strings (4-8 actionable suggestions to improve resume for this JD).

Rules:
1. Use the JD to determine which keywords matter most. Prioritize technical skills, role titles, tools, years/levels, and certifications.
2. If a concept appears in the resume in a paraphrased form, consider it a match and include it in "matchedKeywords".
3. If uncertain, be conservative: only include a "matchedKeyword" if reasonably supported by the resume text.
4. Output compact JSON. Example valid output:
{"atsScore":72,"matchedKeywords":["spring boot","java","aws"],"missingKeywords":["kubernetes","docker"],"summary":"...","strengths":["..."],"suggestions":["..."]}

Now produce the JSON for the input above.
`;

    // Call Gemini model
    let aiRaw = '';
    let aiParsed = null;
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(prompt);
      // result.response.text() returns the text body
      aiRaw = result.response.text();

      // Try to parse JSON from aiRaw
      try {
        aiParsed = JSON.parse(aiRaw);
      } catch(parseErr) {
        // Try to extract a JSON substring (best-effort)
        const firstBrace = aiRaw.indexOf('{');
        const lastBrace = aiRaw.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          const maybe = aiRaw.slice(firstBrace, lastBrace + 1);
          try { aiParsed = JSON.parse(maybe); } catch(_) { aiParsed = null; }
        }
      }
    } catch(e) {
      console.error('Gemini call failed:', e?.message || e);
      aiRaw = 'AI analysis not available: ' + (e?.message || 'unknown error');
    }

    // If AI returned parsed JSON, use its fields; otherwise fall back to minimal response
    const responsePayload = {
      aiRaw,
      aiParsed,
      atsScore: aiParsed && Number.isInteger(aiParsed.atsScore) ? aiParsed.atsScore : null,
      matchedKeywords: aiParsed && Array.isArray(aiParsed.matchedKeywords) ? aiParsed.matchedKeywords : [],
      missingKeywords: aiParsed && Array.isArray(aiParsed.missingKeywords) ? aiParsed.missingKeywords : [],
      summary: aiParsed && typeof aiParsed.summary === 'string' ? aiParsed.summary : '',
      strengths: aiParsed && Array.isArray(aiParsed.strengths) ? aiParsed.strengths : [],
      suggestions: aiParsed && Array.isArray(aiParsed.suggestions) ? aiParsed.suggestions : []
    };

    return res.json(responsePayload);
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error', details: err?.message || String(err) });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
