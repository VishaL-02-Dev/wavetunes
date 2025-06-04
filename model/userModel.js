const mongoose = require("mongoose");
const userSchema= new mongoose.Schema({
    fname:{
        type:String,
        required:true
    },
    lname:{
        type:String,
        required:true
    },
    email:{
        type:String,
        required:true,
        unique:true
    },
    phone:{
        type:String,
        required:false,
        sparse:true,
        default:null,
    },
    googleId:{
        type:String,
    },
    password:{
        type:String,
        required:false,
    },
    isAdmin:{
        type:Boolean,
        default:false
    },
    status:{
        type:String,
        default:"Unblocked"
    },
    wallet:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'Wallet'
    },
    referralCode:{
        type:String,
        required:true
    },
}, 
{timestamps:true});

module.exports= mongoose.model('User',userSchema);