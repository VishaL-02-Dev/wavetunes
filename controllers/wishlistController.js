const Wishlist=require('../model/wishlistModel');
const User=require('../model/userModel');
const Product=require('../model/productModel');
const jwt=require('jsonwebtoken');


//Add to wishlist
const addToWishlist=async(req,res)=>{
    const token=req.cookies.jwt;

    try {
        if(!token){
            return res.status(401).json({
                success:false,
                message:'Autheentication required. Please login',
                redirectUrl:'/user/login'
            });
        }

        const decoded= jwt.verify(token, process.env.JWT_SECRET);

        const user=await User.findById(decoded.id);
        if(!user){
            return res.status(404).json({
                success:false,
                message:'User not found'
            });
        }

        const { productId }=req.body;
        if(!productId){
            return res.status(404).json({
                success:false,
                message:'Product ID is required'
            });
        }

        const product= await Product.findById(productId);
        if(product.stock <=0){
            return res.status(404).json({
                success:false,
                message:'Product out of stock'
            })
        }

        const existingWishlistItem = await Wishlist.findOne({
            userId: user._id,
            product: productId
        });

        if (existingWishlistItem) {
            return res.status(400).json({ 
                message: 'Product already exists in wishlist' 
            });
        }

        const wishlistItem= new Wishlist({
            userId: user._id,
            product: productId
        });

        await wishlistItem.save();

        res.status(200).json({
            success:true,
            message:'Product added to wishlist successfully',
            wishlistItem
        });
    } catch (error) {
        console.error('Error adding to wishlist:', error);
        res.status(500).json({ 
            success:false,
            message: 'Server error while adding to wishlist',
            error: error.message 
        });
    }
}


//Get wishlist page
const getWishlist=async(req,res)=>{
    const token=req.cookies.jwt;

    try {
        if(!token){
            return res.status(401).json({
                success:false,
                message:'Authentication required. Please login.',
                redirectUrl:'/user/login'
            });
        }

        const decoded=jwt.verify(token, process.env.JWT_SECRET);

        const user=await User.findById(decoded.id);

        if(!user){
            return res.status(404).json({
                success:false,
                message:'User not found'
            });
        }

        const wishlist=await Wishlist.find({ userId: user._id})
            .populate('product')
            .sort({createdAt: -1});

        return res.render('user/wishlist',{ wishlist });
    } catch (error) {
        console.error('Error fetching wishlist:', error);
        res.status(500).json({ 
            message: 'Server error while fetching wishlist',
            error: error.message 
        });
    }
}

//Remove item from wishlist
const removeItem=async(req,res)=>{
    const token= req.cookies.jwt;
    try {
        const decoded = jwt.verify(token,process.env.JWT_SECRET);
        const user =await User.findById(decoded.id);

        if(!user){
            return res.status(404).json({
                success:false,
                message:'User not found'
            });
        }

        const {productId}=req.body;
        if(!productId){
            return res.status(404).json({
                success:false,
                message:'Product ID is required'
            });
        }

        const wishlistItem= await Wishlist.findOneAndDelete({
            userId:user._id,
            product:productId
        });

        if(!wishlistItem){
            return res.status(404).json({
                success:false,
                message:'Wishlist item not found'
            });
        }

        return res.status(200).json({
            success:true,
            message:'Product removed from wishlist successfully',
            productId: productId
        });
    } catch (error) {
        console.error('Error removing from wishlist:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while removing from wishlist',
            error: error.message
        });
    }
}

module.exports={
    addToWishlist,
    getWishlist,
    removeItem
}