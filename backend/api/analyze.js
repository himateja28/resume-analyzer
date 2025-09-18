// api/analyze.js
const serverless = require('serverless-http');
const app = require('../server'); // import the Express app
module.exports = app;
module.exports.handler = serverless(app);
