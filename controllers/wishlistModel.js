const mongoose=require('mongoose');
const wishlistSchema=new mongoose.Schema({
    userId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'User',
        required:true
    },
    product:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'Product',
        required:true
    }
},
{timestamps:true});

module.exports.model('Wishlist',wishlistSchema);