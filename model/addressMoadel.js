const mongoose = require("mongoose");
const addressSchema = new mongoose.Schema({
    address:{
        type:String,
        required:true
    },
    pinCode:{
        type:Number,
        required:true,
    },
    state:{
        type:String,
        required:true
    },
    district:{
        type:String,
        required:true
    },
    addressType:{
        type:String,
        enum:['Home','Work'],
        required:true
    },
    userId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    phone:{
        type:Number,
        required:true
    }
},
{timestamps:true});

module.exports=mongoose.model('Address',addressSchema);