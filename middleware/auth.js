const jwt= require('jsonwebtoken');
const User =require('../model/userModel');
require('dotenv').config();


const protect = async(req,res,next)=>{
    try {
        const token = req.cookies.jwt || (req.headers.authorization?.startsWith('Bearer') ? req.headers.authorization.split(' ')[1] : null);
        
        if(!token){
            // return res.status(401).json({
            //     success:false,
            //     message:'Not authorized, please login again',
            //     action: 'LOGOUT'
            // });
               return res.redirect('/user/login');
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const user = await User.findById(decoded.id).select('-password');

        if(!user){
            res.clearCookie('jwt');
            return res.status(401).json({
                success:false,
                message:'User not found',
                action:'LOGOUT'
            });
        }

        if (user.status === 'Blocked') {
            res.clearCookie('jwt');
            return res.status(403).json({
                success: false,
                message: 'Your account has been blocked',
                action: 'LOGOUT'
            });
        }

        req.user = {
            ...user.toObject(),
            role: user.isAdmin ? 'admin' : 'user'
        };

        next();

    } catch (error) {
        console.error('Authentication error:', error.message);
        res.clearCookie('jwt');
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired token',
            action: 'LOGOUT'
        });
    }
};


const authorize = (...roles)=>{
    return (req,res,next)=>{
    if(!req.user || !roles.includes(req.user.role)){
        // return res.status(403).json({
        //     success:false,
        //     message:`Access denied. ${roles.join(' or ')} role required`
        // });
        return res.redirect('/admin/login');
    }
        next();
    };
};

const optionalProtect = async (req, res, next) => {
    try {
        const token = req.cookies.jwt || 
                      (req.headers.authorization?.startsWith('Bearer ') 
                       ? req.headers.authorization.split(' ')[1] 
                       : null);

        if (!token) {
            return next(); // No token
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await User.findById(decoded.id).select('-password');

        if (!user) {
            res.clearCookie('jwt');
            // return res.status(401).json({
            //     success: false,
            //     message: 'User not found',
            //     action: 'LOGOUT'
            // });
            return res.redirect('/user/login');
        }

        if (user.status === 'Blocked') {
            res.clearCookie('jwt');
            return res.status(403).json({
                success: false,
                message: 'Your account has been blocked',
                action: 'LOGOUT'
            });
        }

        // Attach based on role
        const userData = {
            ...user.toObject(),
            role: user.isAdmin ? 'admin' : 'user'
        };

        if (user.isAdmin) {
            req.admin = userData;
        } else {
            req.user = userData;
        }

        next();
    } catch (error) {
        console.error('Optional authentication error:', error.message);
        res.clearCookie('jwt');
        return next(); 
    }
};


module.exports= {
    protect,
    authorize,
    optionalProtect
};
