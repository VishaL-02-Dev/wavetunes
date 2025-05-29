const express=require('express');
const router=express.Router();
const userController=require('../controllers/userController');
const {protect, optionalProtect} =require('../middleware/auth');
const productController=require('../controllers/productController');
const profileController=require('../controllers/profileController');
const passport = require('passport');
const jwt=require('jsonwebtoken');
const addressController=require('../controllers/addressController');
const wishlistController=require('../controllers/wishlistController');
const cartController=require('../controllers/cartController');
const orderController=require('../controllers/orderController');
const walletController = require('../controllers/walletController');

router.use(express.static('public'));
router.use(express.json());
router.use(express.urlencoded({extended:true}));


router.get('/login',optionalProtect,userController.loadLogin);
router.post('/login',optionalProtect,userController.login);
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
router.get('/forgotPassword',optionalProtect,userController.loadForgotPassword);
router.post('/forgotPassword',optionalProtect,userController.forgotPassword);
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
router.get('/products',optionalProtect,productController.displayProduct);
router.get('/products/:categorySlug',optionalProtect,productController.getCategoryProducts);
router.get('/product/:id',optionalProtect,productController.getProductById);  

//Wishlist
router.get('/wishlist',protect,wishlistController.getWishlist);
router.delete('/wishlist/removeItem',protect,wishlistController.removeItem);
router.post('/product/addToWishlist',protect,wishlistController.addToWishlist);


//Cart
router.get('/cart',protect,cartController.loadCart);
router.post('/cart/add',protect,cartController.addToCart);
router.put('/cart/updateQuantity',protect,cartController.updateQuantity);
router.delete('/cart/removeItem',protect,cartController.removeFromCart)


//Checkout
router.get('/checkout',protect,orderController.loadCheckout);
router.post('/checkout/initiate-razorpay',protect, orderController.initiateRazorpayOrder);
router.post('/checkout/verify-razorpay',protect, orderController.verifyRazorpay);
router.post('/checkout/retryRazorpayPayment',protect,orderController.retryRazorpayPayment);
router.post('/checkout/addAddress',protect,addressController.addAddress);
router.post('/checkout/apply-coupon',protect,orderController.applyCoupon);
router.post('/placeOrder',protect,orderController.placeOrder);
router.post('/checkout/process-wallet-payment',protect,orderController.processWalletPayment);
router.get('/myOrders',protect,orderController.loadMyOrders);
router.get('/orders/:id',protect,orderController.loadOrderDetails);
router.get('/orders/:id/invoice',protect,orderController.generateInvoice);
router.post('/orders/:id/cancel',protect,orderController.cancelOrder);
router.post('/orders/:orderId/items/:itemId/cancel',protect,orderController.cancelOrderItem);

//Wallet
router.get('/wallet',protect,walletController.getUserWallet);
router.get('/wallet/balance',protect,walletController.getWalletBalance);
router.post('/wallet/add-funds',protect, walletController.addFunds);
router.post('/wallet/deduct-funds',protect,walletController.deductFunds);
router.get('/wallet/transactions',protect, walletController.getTransactionHistory);
router.post('/wallet/initiate-razorpay',protect,walletController.initiateRazorpayForWallet);
router.post('/wallet/verify-razorpay',protect, walletController.verifyRazorpayForWallet);

//Return
router.post('/orders/:id/return',protect,orderController.returnOrder);
router.post('/orders/:orderId/items/:itemId/return',protect,orderController.returnOrderItem);

//Profile Management
router.get('/profile',optionalProtect,profileController.loadProfile);
router.patch('/profile/editProfile',protect,profileController.editProfile);
router.post('/profile/addAddress',protect,addressController.addAddress);
router.get('/profile/getAddress/:index',protect,addressController.getAddress);
router.post('/profile/editAddress/:index',protect,addressController.editAddress);
router.post('/profile/setDefault',protect,addressController.setDefault);
router.delete('/profile/deleteAddress',protect,addressController.deleteAddress);


module.exports=router;