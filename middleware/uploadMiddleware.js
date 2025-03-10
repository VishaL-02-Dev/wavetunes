const multer = require("multer");
const { db } = require("../model/productModel");

// Configure Multer storage to store images in memory as buffer
const storage = multer.memoryStorage();

const fileFilter=(req,file,cb)=>{
    if(file.mimetype.startsWith('image/')){
        cb(null,true);
    }else{
        cb(new Error('Not an image! Please upload only images'),false);
    }
}

const upload= multer({
    storage:storage,
    limits:{
        fileSize: 5 * 1024 * 1024
    },
    fileFilter:fileFilter
});

// Export Multer upload middleware to be used in routes
module.exports = upload;
