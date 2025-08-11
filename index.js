// index.js
require('dotenv').config();
require('./src/js/bootstrapAll');

const { startRebalancer } = require('./src/js/rebalancer');
startRebalancer();
