const Cart=require('../model/cartModel');
const User=require('../model/userModel');
const Product=require('../model/productModel');
const Wishlist=require('../model/wishlistModel');
const jwt=require('jsonwebtoken');


const loadCart=async(req,res)=>{
    const token=req.cookies.jwt;
    try {
        const decoded=jwt.verify(token, process.env.JWT_SECRET);
        const userId=decoded.id;

    let cart= await Cart.findOne({user:userId}).populate({
        path:'items.product',
        select:'name price images stock'
    });
        if(!cart){
            cart={
                items:[],
                subtotal:0,
                shipping:0,
                tax:0,
                total:0
            };
            
        }else{
            cart.subtotal=cart.items.reduce((sum,item)=>{
                return sum  +(item.product.price* item.quantity);
            },0);

            cart.shipping=cart.subtotal>0 ? 10 : 0;

            cart.tax=cart.subtotal*0.00;

            cart.total=cart.subtotal+cart.shipping+ cart.tax;
        }

        res.render('user/cart',{cart});
    } catch (error) {
        console.log('Something went wrong.',error);
    }
}

//Add item to cart
const addToCart= async(req,res)=>{
    const token=req.cookies.jwt;
    try {
        const decoded=jwt.verify(token, process.env.JWT_SECRET);
        const user= await User.findById(decoded.id);

        if(!user){
            res.status(404).json({
                success:false,
                message:'User not found'
            });
        }

        const {productId, quantity=1}=req.body;
        if(!productId){
            return res.status(404).json({
                success:false,
                message:'Product not found'
            });
        }

        const product=await Product.findById(productId);
        if(product.stock< quantity){
            return res.status(200).json({
                success:false,
                message:'Product out of stock'
            });
        }

        let cart= await Cart.findOne({user:user._id});

        if(!cart){
            cart = new Cart({
                user:user._id,
                items:[],
            });
        }

        if(!Array.isArray(cart.items)){
            cart.items=[];
        }

        const existingItemIndex=cart.items.findIndex(
            item=>item.product.toString()===productId
        );

        if(existingItemIndex > -1){
            const totalQuantity = cart.items[existingItemIndex].quantity + quantity;

            if(totalQuantity > product.stock){
                return res.status(400).json({
                    success:false,
                    message:'Cannot exceed availablle stock'
                });
            }
            cart.items[existingItemIndex].quantity=totalQuantity;
        }else{
            cart.items.push({
                product:productId,
                quantity:quantity
            });
        }
        await cart.save();

        product.stock-=quantity;
        await product.save();

        res.status(200).json({
            success:true,
            message:'Items added to the cart'
        });

    } catch (error) {
        console.error('Error adding to cart:', error);
        res.status(500).json({ 
            success:false,
            message: 'Server error while adding to cart',
            error: error.message 
        });
    }
}


//Remove from Cart
const removeFromCart=async(req,res)=>{
    const token=req.cookies.jwt;

    try {
        const decoded=jwt.verify(token, process.env.JWT_SECRET);
        const userId=decoded.id;
        const {productId}=req.body;

        const cart=await Cart.findOne({user:userId});

        if(!cart){
            return res.status(404).json({
                success:false,
                message:'Cart not found'
            });
        }

        const itemIndex = cart.items.findIndex(item=>
            item.product.toString() === productId
        );

        if(itemIndex === -1){
            return res.statsu(404).json({
                success:false,
                message:'Item not in cart'
            })
        }

        cart.items.splice(itemIndex,1);
        await cart.save();
        
        return res.status(200).json({
            success:true,
            message:'Item removed from cart'
        });

    } catch (error) {
        console.error('Error removing from cart:',error);
        return res.status(500).json({
            success:false,
            message:'Server error while removing from cart',
            error:error.message
        });
    }
}

//Update quantity
const updateQuantity= async(req,res)=>{
    const token=req.cookies.jwt;

    try {
        const decoded= jwt.verify(token,process.env.JWT_SECRET);
        const userId=decoded.id;
        const {productId, quantityChange}=req.body;

        const cart=await Cart.findOne({user:userId});

        if(!cart){
            return res.status(404).json({
                success:false,
                message:'CArt not found'
            });
        }

        const itemIndex=cart.items.findIndex(item=>
            item.product.toString()===productId
        );

        if(itemIndex === -1){
            return res.status(404).json({
                success:false,
                message:'Item not in cart'
            });
        }

        const product = await Product.findById(productId);

        const newQuantity=cart.items[itemIndex].quantity+parseInt(quantityChange);

        if(newQuantity<=0){
            cart.items.splice(itemIndex,1);
        }else if(newQuantity > product.stock){
            return res.status(404).json({
                success:false,
                message:'Cannot exceed available stock'
            });
        }else{
            cart.items[itemIndex].quantity=newQuantity;
        }

        await cart.save();

        return res.status(200).json({
            success:true,
            message:'Cart updated successfully'
        });
    } catch (error) {
        console.error('Error updating cart:',error);
        return res.status(500).json({
            success:false,
            message:'Server error while updating cart',
            error:error.message
        });
    }
}

module.exports={
    loadCart,
    addToCart,
    updateQuantity,
    removeFromCart
}