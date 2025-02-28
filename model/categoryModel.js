const mongoose=require('mongoose');
const categorySchema= new mongoose.Schema({

    name:{
        type:String,
        required:true
    },

    description:{
        type:String,
        required:true
    },

    categoryOffer:{
        type:Number,
        default:0
    },

    status:{
        type:String,
        default:'Listed'
    }

},
{timestamps: true});

module.exports=mongoose.model('Category',categorySchema);