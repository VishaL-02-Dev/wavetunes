const bcrypt=require('bcrypt');
const User=require('../model/userModel');
const nodemailer=require('nodemailer');
const env=require('dotenv').config(); 
const jwt = require("jsonwebtoken");
require('dotenv').config();

 
//Password hashing
const sPass= async(password)=>{
    try {
        const hashPass= await bcrypt.hash(password,10);
        return hashPass;
    } catch (error) {
        console.log(error.message);
    }
}

//Sign up page
const signup=async(req,res)=>{
    try {
        console.log("Signup rendered")
        res.render('user/signup');
    } catch (error) {
        console.log(error);
    }
}


//Adding user to the DB
const addUser=async(req,res)=>{
    try {
        // console.log("Incoming Signup Request:", req.body); // Debugging

        if (!req.body) {
            console.log("No data received!");
            return res.status(400).json({ error: "No data received" });
        }

        const { fname, lname, email, phone, password } = req.body;

        if (!fname || !lname || !email || !phone || !password) {
            console.log("Missing Fields!");
            return res.status(400).json({ error: "All fields are required" });
        }

        const nameRegex = /^[A-Za-z\s]+$/;
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/;
        const phoneRegex = /^[0-9]{10}$/;

        if (!nameRegex.test(fname) || !nameRegex.test(lname)) {
            return res.status(400).json({ error: "Invalid name format" });
        }

        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: "Invalid email format" });
        }

        if (!phoneRegex.test(phone)) {
            return res.status(400).json({ error: "Invalid phone number" });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: "Password must be at least 6 characters" });
        }

        const existUser = await User.findOne({ email });
        if (existUser) {
            console.log("User already exists!");
            return res.status(400).json({ error: "User already exists" });
        }

        // Generate OTP and store it in session
        const otp = generateOtp();
        const emailSent = await sendVerificationEmail(email, otp);

        if (!emailSent) {
           
            return res.status(400).json({ error: "Failed to send OTP. Try again" });

        }

        req.session.userOtp = otp;
        req.session.userData = { 
            fname,
            lname,
            phone, 
            email, 
            password 
        };

        console.log("Session stored",req.session.userData);
       
        console.log("OTP sent successfully:", otp);
        return res.status(200).json({ 
            message: "OTP sent successfully",
            redirectUrl: "/user/otpverify"
        });
        
    } catch (error) {
        console.log('catch invoked');
        console.log(error);
        return res.status(500).json({error: "Internal server error"})
    }
};

// Verify OTP
const verifyOtp = async (req, res) => {
    try {
        const { otp } = req.body;
        const userData=req.session.userData;
        console.log(userData);

        console.log("Received OTP:", otp);
        console.log("Stored OTP:", req.session.userOtp);

        if(!otp){
            return res.status(400).json({success:false,message:"OTP is required"})
        }

        if (!req.session.userOtp) {
            return res.status(400).json({ 
                success: false, 
                message: "Expired OTP" 
            });
        }

        if(req.session.userOtp !== otp){
            return res.status(400).json({
                success:false,
                message:"Invalid OTP"
            })
        }

        if (!userData) {
            return res.status(400).json({ 
                success: false, 
                message: "User data not found in session" 
            });
        }


        // console.log('req.session.userdata ethi');

        // Retrieve user data from session and hash the password
        const sPassword=await sPass(userData.password);
        const newUser= new User({
            fname:userData.fname,
            lname:userData.lname,
            email:userData.email,
            phone:userData.phone,
            password:sPassword,
            status:'Unblocked',
        });

        const savedUser= await newUser.save();
        console.log("User created");

        const token = jwt.sign(
            { id: savedUser._id, email: savedUser.email, role: "user" },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        // req.session.user = {
        //     _id: savedUser._id.toString(),
        //     fname: savedUser.fname,
        //     lname:savedUser.lname,
        //     email: savedUser.email
        // };

        // Clear session
        delete req.session.userOtp;
        delete req.session.userData;
        
        // req.session.save();

        return res.status(200).json({ 
            success: true, 
            message:"User registration successful" ,
            token, 
            redirectUrl: "/user/login" });

    } catch (error) {
        console.error("Error verifying OTP:", error);
        return res.json({ success: false, message: "Server error, try again" });
    }
};

// Generate a 6-digit OTP
const generateOtp = () => {
    return String(Math.floor(100000 + Math.random() * 900000)); // Ensures it's always a 6-digit string
};

// Send OTP via Email
const sendVerificationEmail = async (email, otp) => {
    try {
        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.NODEMAILER_EMAIL,
                pass: process.env.NODEMAILER_PASSWORD,
            },
        });

        const info = await transporter.sendMail({
            from: process.env.NODEMAILER_EMAIL,
            to: email,
            subject: "Verify Your Account",
            text: `Your OTP is ${otp}`,
        });

        return info.accepted.length > 0;
    } catch (error) {
        console.error("Error sending email:", error);
        return false;
    }
};

// Resend OTP
const resendOtp = async (req, res) => {
    try {

        console.log("Session Data at resend: ",req.session.userData);

        if (!req.session.userData || !req.session.userData.email) {
            return res.status(400).json({ 
                success: false, 
                message: "User data not found" 
            });
        }

        //Generate and send new OTP
        const newOtp = generateOtp();
        req.session.userOtp = newOtp;

        await new Promise((resolve,reject)=>{
            req.session.save((err)=>{
                if(err){
                    console.log("Session save error: ", err);
                    reject(err);
                }else{
                    resolve();
                }
            })
        });

        const emailSent = await sendVerificationEmail(req.session.userData.email, newOtp);

        if (emailSent) {
            console.log("New OTP sent:", newOtp);
            return res.status(200).json({ success: true, message: "OTP resent successfully" });
        }

        return res.status(500).json({ 
            success: false, 
            message: "Failed to resend OTP. Try again" 
        });

    } catch (error) {
        console.error("Error resending OTP:", error);
        res.status(500).json({ 
            success: false, 
            message: "Internal server error. Try again" 
        });
    }
};

//Load OTP
const loadOtp= async(req,res)=>{
    try {
        if(!req.session.userOtp || !req.session.userData){
            return res.redirect('/user/signup');
        }

        await new Promise((resolve)=>{
            req.session.save(resolve);
        });

        res.render('user/otpverify',{ context: "registration" });
    } catch (error) {
        console.log("Error loading OTP page",error);
        res.redirect('/user/signup')
    }
}

//Login page
const loadLogin= async (req,res)=>{
    try {
        console.log("Login rendered")
        res.render('user/login');
    } catch (error) {
        console.log(error);
    }
}

//Login method 
const login = async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    //  console.log(req.body);
    //  console.log(user)
    try {
        if (!user) {
            return res.status(400).json({
                success: false,
                field: "email",  
                message: "Invalid email!"
            });
        }

        if (user.status === "Blocked") {
            return res.status(400).json({
                success: false,
                field: "general", 
                message: "User is blocked!"
            });
        }

        const matchPass = await bcrypt.compare(password, user.password);
        if (!matchPass) {
            return res.status(401).json({
                success: false,
                field: "password",  
                message: "Incorrect password!"
            });
        }

        const token = jwt.sign(
            { 
                id:user._id, 
                email:user.email, 
                fname:user.fname, 
                lname:user.lname,
                role:'user'
            },
            process.env.JWT_SECRET,
            {expiresIn:'3d'}
        );
        res.cookie('jwt',token, {
            httpOnly:true, 
            secure:false,
            maxAge:3 * 24* 60 * 60 * 1000
        });
        // res.cookie('user',user)

        return res.status(200).json({
            success: true,
            token,
            user,
            message: "Login successful",
            redirectUrl:'/'
        });

    } catch (error) {
        console.log("Login error", error);
        res.status(500).json({
            success: false,
            field: "general",  
            message: "Internal Server Error"
        });
    }
};


//Home page
const loadHome= async(req,res)=>{
    try {
        console.log("Homepage rendered")
        res.render('home');
    } catch (error) {
        console.log(error);
    }
}


//Load Forgot Password Page
const loadForgotPassword = async(req,res)=>{
    try {
        res.render('user/forgotPassword');
    } catch (error) {
        console.log('Error loading the forgot password page',error);
    }
}


//Forgot Password
const forgotPassword=async(req,res)=>{
    try {
        const { email }=req.body;
        
        const user= await User.findOne({email});

        if(!user){
            return res.status(400).json({
                success: false,
                field: "email",  
                message: "Email not found"
            });
        }

        const otp= generateOtp();
        const emailSent= await sendPasswordResetEmail(email,otp);

        if(!emailSent){
            return res.status(400).json({
                success:false,
                field:'general',
                message:'Failed to send OTP. Please try again'
            });
        }

        req.session.resetOtp=otp;
        req.session.resetEmail=email;

        console.log('Password reset OTP sent: ',otp);
        return res.status(200).json({
            success:true,
            message:"OTP sent successfully",
            
        });

    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            field: "general",
            message: "Internal server error"
        });
    }
}


//Send OTP for password Reset
const sendPasswordResetEmail= async(email,otp)=>{
    try {
        const transporter= nodemailer.createTransport({
            service:'gmail',
            auth:{
                user:process.env.NODEMAILER_EMAIL,
                pass:process.env.NODEMAILER_PASSWORD,
            },
        });

        const info= await transporter.sendMail({
            fron: process.env.NODEMAILER_EMAIL,
            to: email,
            subject:'Password Reset Request',
            text:`Your OTP for password reset is ${otp}. This otp will expire in 10 minutes`
        });
        
        return info.accepted.length>0;

    } catch (error) {
        consol.error('Error sending password reset emial: ',error);
        return false;
    }
}

const loadVerifyResetOtp= async(req,res)=>{
    try {
        if(!req.session.resetOtp || !req.session.resetEmail){
            return res.redirect('/user/forgotPassword');
        }

        await new Promise((resolve)=>{
            req.session.save(resolve);
        });

        res.render('user/otpVerify',{ context: "passwordReset" });

    } catch (error) {
        console.log('Error loading reset OTP page',error);
        res.redirect('/user/forgoPassword');
    }
};


const verifyResetOtp= async(req,res)=>{
    try {
        const {otp} = req.body;

        console.log("Recieved OTP: ",otp);
        console.log('Stored Reset OTP: ',req.session.resetOtp);

        if(!otp){
            return res.status(400).json({
                success:false,
                message:"OTP is required"
            });
        }

        if(!req.session.resetOtp){
            return res.status(400).json({
                success:false,
                message:'Expired OTP'
            });
        }

        if(req.session.resetOtp !=otp){
            return res.status(400).json({
                success:false,
                message:'Invalid OTP'
            });   
        }

        if(!req.session.resetEmail){
            return res.status(400).json({
                success:false,
                message:'User data not found in session'
            });
        }

        const resetToken=jwt.sign(
            {email:req.session.resetEmail},
            process.env.JWT_SECRET,
            {expiresIn:'10m'}
        );

        delete req.session.resetOtp;

        return res.status(200).json({
            success:true,
            message:'OTP verified successfully',
            token:resetToken,
            // redirectUrl:`/user/resetPassword`,
            redirectUrl: `/user/resetPassword?token=${resetToken}`
        });


    } catch (error) {
        console.error('Error verifying reset OTP:',error );
        return res.status(500).json({
            success:false,
            message:'Server error, try again'
        });
    }
}


const resendResetOtp= async(req,res)=>{
    try {
        if(!req.session.resetEmail){
            return res.status(400).json({
                success:false,
                message:'User data not found'
            });
        }

        const newOtp=generateOtp();
        req.session.resetOtp= newOtp();

        await new Promise((resolve, reject)=>{
            req.session.save((err)=>{
                if(err){
                    console.log('Session save error:', err);
                    reject(err);
                }else{
                    resolve();
                }
            });
        });
         
        const emailSent= await sendPasswordResetEmail(req.session.resetEmail, newOtp);

        if(emailSent){
            console.log('New reset OTP sent:',newOtp);
            return res.status(200).json({
                success:true,
                message:'OTP resent successfully'
            });
        }

        return res.status(500).json({
            success:false,
            message:'OTP resent succesfully'
        });

    } catch (error) {
        console.error('Error resending reset OTP. Tr again'.error);
        res.status(500).json({
            success:false,
            message:'Internal server error. Try again'
        });
    }
}

//Load the reset password page
const loadResetPassword = async(req,res)=>{
    try {
        const{token}=req.query;
        res.render('user/resetPassword',{token});
    } catch (error) {
        console.log('Error loading the reset password page', error);
        res.redirect('/user/forgotPassword');
    }
};

//Reset password
const resetPassword= async(req,res)=>{
    try {
        const {token,password}= req.body;

        if(!token || !password){
            return res.status(400).json({
                success:false,
                field:'general',
                message:'Missing required fields'
            });
        }

        if(password.length<6){
            return res.status(400).json({
                success:false,
                field:'password',
                message:'Password must be at least 6 characters'
            });
        }

        let decodedToken;
        try {
            decodedToken=jwt.verify(token,process.env.JWT_SECRET);
        } catch (error) {
            return res.status(400).json({
                succss:false,
                field:'general',
                message:'Invalid or expired reset OTP'
            });
        }

        const email=decodedToken.email;

        const user= await User.findOne({email});

        if(!user){
            return res.status(400).json({
                success:false,
                field:'general',
                message:'User not found'
            });
        }
        
        const hashedPassword= await sPass(password);

        user.password=hashedPassword;
        await user.save();

        delete req.session.resetEmail;
        
        return res.status(200).json({
            success:true,
            message:'Password reset successful',
            redirectUrl:'/user/login'
        });

    } catch (error) {
        console.log("Reset password error:", error);
        return res.status(500).json({
            success: false,
            field: "general",
            message: "Internal server error"
        });
    }
}

//Logout
const logout = async (req, res) => {
    try {
        //Clear the JWT cookie
        res.clearCookie('jwt');
        return res.status(200).json({
            success: true,
            message: "Logout successful",
            redirectUrl: '/'
        });
    } catch (error) {
        console.log("Logout error", error);
        res.status(500).json({
            success: false,
            message: "Internal Server error"
        });
    }
};

module.exports={
    loadLogin,
    login,
    loadHome,
    logout,
    signup,
    addUser,
    loadOtp,
    verifyOtp,
    resendOtp,
    loadForgotPassword,
    forgotPassword,
    loadVerifyResetOtp,
    verifyResetOtp,
    resendResetOtp,
    loadResetPassword,
    resetPassword,
}

