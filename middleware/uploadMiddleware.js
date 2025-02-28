const multer = require("multer");

// Configure Multer storage to store images in memory as buffer
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Export Multer upload middleware to be used in routes
module.exports = upload;
