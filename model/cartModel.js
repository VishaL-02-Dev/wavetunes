const mongoose= require('mongoose');
const cartSchema=new mongoose.Schem({
    userId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'User',
        required:true
    },
    product:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'Product',
        required:true
    },
    quantity:{
        type:Number,
        required:true
    },
},
{timestamps:true});

module.exports.model('Cart',cartSchema);