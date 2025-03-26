const mongoose = require("mongoose");
const addressSchema = new mongoose.Schema({
    userId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required:true
    },
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
    city:{
        type:String,
        required:true
    },
    district:{
        type:String,
        required:true
    },
    addressType:{
        type:String,
        enum:['Home','Work', 'Other'],
        required:true
    },
    phone:{
        type:Number,
        required:true
    },
    isDefault: {
        type: Boolean,
        default: false
    }
},
{timestamps:true});

module.exports=mongoose.model('Address',addressSchema);