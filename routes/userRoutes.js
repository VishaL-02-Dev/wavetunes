const express=require('express');
const router=express.Router();
const userController=require('../controllers/userController');
const verifyToken =require('../middleware/auth');
const productController=require('../controllers/productController');
const profileController=require('../controllers/profileController');
const passport = require('passport');
const jwt=require('jsonwebtoken');
const addressController=require('../controllers/addressController');

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
    { userId:req.user._id, email:req.user.email},
    process.env.JWT_SECRET,
    {expiresIn:'7d'}
   );
    res.cookie('authToken',token,{httpOnly: true, secure:false});
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


//Profile Management
router.get('/profile',profileController.loadProfile);
router.post('/profile/addAddress',addressController.addAddress);
router.get('/profile/getAddress/:index',addressController.getAddress);
router.post('/profile/editAddress/:index',addressController.editAddress);
router.patch('/profile/setDefault',addressController.setDefault);
router.delete('/profile/deleteAddress',addressController.deleteAddress);

module.exports=router;