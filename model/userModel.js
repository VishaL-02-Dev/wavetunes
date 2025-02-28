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
        unique:true,
        sparse:true,
        default:null,
    },
    googleId:{
        type:String,
        unique:true,
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
    }
}
, {timestamps:true});

module.exports= mongoose.model('User',userSchema);