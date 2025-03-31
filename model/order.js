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
    status:{
        type:String,
        enum:['pending', 'shipped', 'delivered', 'cancelled', 'return_requested', 'returned', 'payment_failed'],
        default:'pending'
    }
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
        enum:['Credit Card','Paypal','COD'],
        required:true
    }    
},
{timestamps:true});

module.exports=mongoose.model('Order',orderSchema);