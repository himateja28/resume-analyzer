// api/analyze.js
const serverless = require('serverless-http');
const app = require('../server'); // import the Express app
const cors = require("cors");

app.use(cors({
  origin: [
    "http://localhost:5173",                       // local dev
    "https://resume-analyzer-gpsm.vercel.app/",     // your frontend domain
    /\.vercel\.app$/                               // allow all vercel.app subdomains (mobile included)
  ],
  methods: ["GET", "POST"],
  credentials: true
}));
module.exports = app;
module.exports.handler = serverless(app);
