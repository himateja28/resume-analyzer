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

// Use /tmp directory (Vercel compatible)
const upload = multer({ dest: '/tmp/' });

// Initialize app
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Extract raw text from uploaded files (PDF, DOCX, DOC, TXT).
 */
async function extractTextFromFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const buffer = fs.readFileSync(file.path);

  try {
    if (ext === ".pdf") {
      const data = await pdfParse(buffer);
      return data.text || "";
    }

    if (ext === ".docx" || ext === ".doc") {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || "";
    }

    return buffer.toString("utf8");
  } finally {
    // Cleanup temp file
    try {
      fs.unlinkSync(file.path);
    } catch {}
  }
}

/**
 * Analyze endpoint
 */
app.post("/api/analyze", upload.single("resume"), async (req, res) => {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");

    const jdText = (req.body.jd || "").trim();
    if (!req.file) {
      return res.status(400).json({ error: "No resume uploaded." });
    }

    const resumeTextFull = await extractTextFromFile(req.file);
    const resumeText = resumeTextFull.slice(0, 4500); // Prevent overflow

    const prompt = `
You are an expert ATS evaluator. Compare the following RESUME and JOB DESCRIPTION.

RESUME:
${resumeText}

JOB DESCRIPTION:
${jdText}

Return ONLY valid JSON with:
{
  "atsScore": number,
  "matchedKeywords": [],
  "missingKeywords": [],
  "summary": "",
  "strengths": [],
  "suggestions": []
}
`;

    let aiRaw = "";
    let aiParsed = null;

    try {
      const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash-latest",
      });

      const result = await model.generateContent(prompt);
      aiRaw = result.response.text().trim();

      // Try direct parsing
      try {
        aiParsed = JSON.parse(aiRaw);
      } catch {
        // Fallback: extract the JSON part only
        const first = aiRaw.indexOf("{");
        const last = aiRaw.lastIndexOf("}");
        if (first !== -1 && last !== -1) {
          const jsonPart = aiRaw.substring(first, last + 1);
          try {
            aiParsed = JSON.parse(jsonPart);
          } catch {}
        }
      }
    } catch (e) {
      console.error("Gemini API error:", e.message);
      aiRaw = "AI analysis failed: " + e.message;
    }

    return res.json({
      aiRaw,
      aiParsed,
      atsScore: aiParsed?.atsScore ?? null,
      matchedKeywords: aiParsed?.matchedKeywords ?? [],
      missingKeywords: aiParsed?.missingKeywords ?? [],
      summary: aiParsed?.summary ?? "",
      strengths: aiParsed?.strengths ?? [],
      suggestions: aiParsed?.suggestions ?? [],
    });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      error: "Server error",
      details: err.message,
    });
  }
});

/**
 * Preflight CORS (OPTIONS)
 */
app.options("/api/analyze", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(200);
});

// Run locally
if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
