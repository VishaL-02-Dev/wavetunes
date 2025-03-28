const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    brand:{
        type:String,
        required:true
    },
    description: {
        type: String,
        required: true
    },
    specifications:{
        type:String,
        required:true
    },
    price: {
        type: Number,
        required: true,
        min: 0
    },
    stock: {
        type: Number,
        required: true,
        min: 0
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: true
    },
    images: [{
        public_id: { type: String, required: true },
        url: { type: String, required: true }
    }],
    ratings: {
        type: Number,
        default: 0
    },
    reviews: [
        {
            user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            rating: { type: Number, required: true },
            comment: { type: String }
        }
    ]
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);
