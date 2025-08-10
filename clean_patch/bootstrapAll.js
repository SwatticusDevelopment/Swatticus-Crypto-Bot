// bootstrapAll.js
// Starts EVM + Sol bootstraps and optional modules.
require('dotenv').config();
require('./bootstrapEvm');
require('./bootstrapSol');
require('./profitGuard');
require('./usdcRollover');
require('./multiRouterExec');
require('./flashbotsExec');
