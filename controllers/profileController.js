const User = require('../model/userModel');
const Address = require('../model/addressModel');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Load Profile Page
const loadProfile = async (req, res) => {
    const token = req.cookies.jwt;
    try {

        if (!token) {
            return res.redirect('/user/login');
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);

        if (!user) {
            return res.redirect('/user/login');
        }

        const addresses = await Address.find({ userId: user._id });
        // console.log('found ', addresses)
        // console.log('user',user);
        return res.render('user/profile', {
            user,
            addresses
        });
    } catch (error) {
        console.log("Profile loading error:", error);

        // If token is invalid or expired
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            res.clearCookie('jwt');
            return res.redirect('/user/login');
        }

        return res.status(500).json({
            message: 'An error occurred while loading your profile'
        });
    }
};

const generateOtp = () => {
    return String(Math.floor(100000 + Math.random() * 900000))
};

//Edit Profile
const editProfile = async (req, res) => {
    const token = req.cookies.jwt;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.NODEMAILER_EMAIL,
                pass: process.env.NODEMAILER_PASSWORD,
            },
        });

        const { fname, lname, email, phone } = req.body;

        // Validate email
        if (email !== user.email) {
            const existingUser = await User.findOne({ email });
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: 'Email already in use'
                });
            }

            // Generate OTP
            const otp = generateOtp();
            const otpExpiry = Date.now() + 1 * 60 * 1000;

            // Store OTP and new email in session
            req.session.pendingEmailUpdate = {
                newEmail: email,
                otp,
                otpExpiry,
                fname,
                lname,
                phone
            };

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'WaveTunes Email Verification OTP',
                text: `Your OTP for email verification is ${otp}. It is valid for 1 minute.`
            };


            await transporter.sendMail(mailOptions);
            console.log('Sent otp: ', otp);

            await new Promise((resolve, reject) => {
                req.session.save((err) => {
                    if (err) {
                        console.error('Session save error: ', err);
                        reject(err);
                    }
                    resolve();
                })
            });

            return res.status(200).json({
                success: true,
                message: 'OTP sent to your email.',
                redirect: '/user/verify-email-otp',
            });

        }

        // If email hasn't changed, update other fields directly
        user.fname = fname;
        user.lname = lname;
        user.email = email;
        user.phone = phone;

        await user.save();

        return res.status(200).json({
            success: true,
            message: 'Profile updated successfully'
        });

    } catch (error) {
        console.log("Profile update error:", error);
        return res.status(500).json({
            success: false,
            message: 'An error occurred while updating your profile'
        });
    }
};



//Load email otp verification page
const loadVerifyEmailOtp = async (req, res) => {
    try {
        if (!req.session.pendingEmailUpdate) {
            console.log('No pending email verification, redirecting to profile');
            return res.redirect('/user/profile');
        }

        // Save session
        await new Promise((resolve) => {
            req.session.save(resolve);
        });

        res.render('user/otpverify', { context: 'email-verification' });
    } catch (error) {
        console.error('Error loading email OTP page:', error);
        res.redirect('/user/profile');
    }
}

//Verify  Email 
const verifyEmailOtp = async (req, res) => {
    const { otp } = req.body;
    const token = req.cookies.jwt;

    try {
        if (!otp) {
            return res.status(400).json({
                success: false,
                message: 'OTP is required'
            });
        }

        if (!req.session.pendingEmailUpdate) {
            return res.status(400).json({
                success: false,
                message: 'No pending email update'
            });
        }

        const { newEmail, otp: storedOtp, otpExpiry, fname, lname, phone } = req.session.pendingEmailUpdate;
        if (Date.now() > otpExpiry) {
            delete req.session.pendingEmailUpdate;
            delete req.session.pendingData;
            return res.status(400).json({ success: false, message: 'OTP expired' });
        }

        if (otp !== storedOtp) {
            return res.status(400).json({ success: false, message: 'Invalid OTP' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);
        if (!user) {
            return res.status(400).json({ success: false, message: 'User not found' });
        }

        // Update user
        user.email = newEmail;
        user.fname = fname;
        user.lname = lname;
        user.phone = phone;

        await user.save();

        // Clear session
        delete req.session.pendingEmailUpdate;
        delete req.session.pendingData;

        return res.status(200).json({
            success: true,
            message: 'Email verified successfully',
            redirectUrl: '/user/profile'
        });
    } catch (error) {
        console.log("OTP verification error:", error);
        return res.status(500).json({
            success: false,
            message: 'An error occurred while verifying OTP',
        });
    }
};


// Resend OTP for Email Verification
const resendOtp = async (req, res) => {
    try {
        if (!req.session.pendingEmailUpdate || !req.session.pendingData) {
            return res.status(400).json({ success: false, message: 'No pending email' });
        }

        const { newEmail } = req.session.pendingEmailUpdate;

        // Generate new OTP
        const otp = generateOtp();
        const otpExpiry = Date.now() + 1 * 60 * 1000;

        // Update session
        req.session.pendingEmailUpdate.otp = otp;
        req.session.pendingEmailUpdate.otpExpiry = otpExpiry;

        // Save session
        await new Promise((resolve, reject) => {
            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    reject(err);
                }
                resolve();
            });
        });

        // Send OTP email
        const mailOptions = {
            from: process.env.NODEMAILER_EMAIL,
            to: newEmail,
            subject: 'WaveTunes OTP Resend',
            text: `Your new OTP is ${otp}. Valid for 10 minutes.`
        };

        await transporter.sendMail(mailOptions);
        console.log('OTP resent:', otp);

        return res.status(200).json({ success: true, message: 'New OTP sent' });
    } catch (error) {
        console.error('Resend OTP error:', error);
        return res.status(500).json({ success: false, message: 'Error resending OTP' });
    }
};


module.exports = {
    loadProfile,
    editProfile,
    loadVerifyEmailOtp,
    verifyEmailOtp,
    resendOtp
}