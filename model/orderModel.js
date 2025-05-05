const mongoose=require('mongoose');

const orderItemSchema=new mongoose.Schema({
    productId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'Product',
        required:true
    },quantity: {
        type: Number,
        required: true,
        min: 1
      },
      price:{
        type:Number,
        required: true,
        min: 0
      },
      discount: {
        type: Number,
        default: 0
      },
    status:{
        type:String,
        enum:['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'return_requested', 'returned', 'payment_failed'],
    },
    refunded:{
        type:Boolean,
        default:false
    },
    refundAmount:{
        type:Number,
        default:0
    },
    refundDate:{
        type:Date
    },
    returnReason:{
        type:String,
        default:''
    },
});

const orderSchema= new mongoose.Schema({
    orderId:{
        type:String,
        unique:true
    },
    userId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'User',
        required:true
    },
    addressId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'Address',
        required:true
    },
    items:[orderItemSchema],
    status: {
        type: String,
        enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'return_requested', 'returned', 'payment_failed'],
        default: 'pending',
      },
    totalAmount:{
        type:Number,
        required:true
    },
    date:{
        type:Date,
        default:Date.now
    },
    paymentMethod:{
        type:String,
        enum:['Credit Card','Razorpay','COD','Wallet'],
        required:true
    },
    refundStatus: {
        type: String,
        enum: ['none', 'partial', 'full'],
        default: 'none'
    },
    returnReason:{
        type:String,
        default:''
    },
},
{timestamps:true});

module.exports=mongoose.model('Order',orderSchema);