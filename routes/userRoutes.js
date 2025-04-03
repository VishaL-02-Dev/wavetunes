const express=require('express');
const router=express.Router();
const userController=require('../controllers/userController');
const verifyToken =require('../middleware/auth');
const productController=require('../controllers/productController');
const profileController=require('../controllers/profileController');
const passport = require('passport');
const jwt=require('jsonwebtoken');
const addressController=require('../controllers/addressController');
const wishlistController=require('../controllers/wishlistController');
const cartController=require('../controllers/cartController');
const orderController=require('../controllers/orderController');

router.use(express.static('public'));
router.use(express.json());
router.use(express.urlencoded({extended:true}));


router.get('/login',userController.loadLogin);
router.post('/login',userController.login);
router.get('/signup',userController.signup);
router.post('/signup',userController.addUser);
router.get('/logout',userController.logout);
router.get('/auth/google',passport.authenticate('google',{scope:['profile','email']}))
router.get('/auth/google/callback',passport.authenticate('google',{failureRedirect:'/signup'}),(req,res)=>{
   const token = jwt.sign(
    { id:req.user._id, 
        email:req.user.email,
        fname:req.user.fname,
        lname:req.user.lname
    },
    process.env.JWT_SECRET,
    {expiresIn:'3d'}
   );
    res.cookie('jwt',token,{httpOnly: true, secure:false});
    res.redirect('/');
});

//Forgot Password routes
router.get('/forgotPassword',userController.loadForgotPassword);
router.post('/forgotPassword',userController.forgotPassword);
router.get('/verifyResetOtp',userController.loadVerifyResetOtp);
router.post('/verifyResetOtp',userController.verifyResetOtp);
router.post('/verifyResetOtp',userController.resendResetOtp);
router.get('/resetPassword',userController.loadResetPassword);
router.post('/resetPassword',userController.resetPassword);


//For OTP verification page
router.get('/otpverify', userController.loadOtp);  
router.post('/otpverify', userController.verifyOtp);
router.post('/otpverify/resendotp', userController.resendOtp);

//Product Page
router.get('/products',productController.displayProduct);
router.get('/products/:categorySlug',productController.getCategoryProducts);
router.get('/product/:id',productController.getProductById);  
router.get('/wishlist',wishlistController.getWishlist);
router.delete('/wishlist/removeItem',wishlistController.removeItem);
router.post('/product/addToWishlist',wishlistController.addToWishlist);


//Cart
router.get('/cart',cartController.loadCart);
router.post('/cart/add',cartController.addToCart);
router.put('/cart/updateQuantity',cartController.updateQuantity);
router.delete('/cart/removeItem',cartController.removeFromCart)


//Checkout
router.get('/checkout',orderController.loadCheckout);
router.post('/checkout/addAddress',addressController.addAddress);
router.post('/placeOrder',orderController.placeOrder);
router.get('/myOrders',orderController.loadMyOrders);
router.get('/orders/:id',orderController.loadOrderDetails);
router.post('/orders/:id/cancel',orderController.cancelOrder);

//Profile Management
router.get('/profile',profileController.loadProfile);
router.patch('/profile/editProfile',profileController.editProfile);
router.post('/profile/addAddress',addressController.addAddress);
router.get('/profile/getAddress/:index',addressController.getAddress);
router.post('/profile/editAddress/:index',addressController.editAddress);
router.post('/profile/setDefault',addressController.setDefault);
router.delete('/profile/deleteAddress',addressController.deleteAddress);


module.exports=router;