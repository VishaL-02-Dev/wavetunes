const jwt= require('jsonwebtoken');
const User =require('../model/userModel');
require('dotenv').config();

// //User verification
// const verifyToken = (req,res,next)=>{
//     const token = req.cookies?.jwt || 
//                   (req.headers['authorization'] ? 
//                   req.headers['authorization'].split(" ")[1] : null);

//     if (!token) {
//         return res.status(403).json({
//             success: false,
//             message: "Access denied. No token provided"
//         });
//     }

//         try {
//             const decoded = jwt.verify(token,process.env.JWT_SECRET);
//             req.user =decoded;
//             next();
//         } catch (error) {
//             return res.status(401).json({
//                 success:false,
//                 message:"Invalid token"
//             })
//         }
// }

// // For admin verification
// const verifyAdmin = (req, res, next) => {
//     verifyToken(req, res, () => {
//         if (req.user && req.user.role === 'admin') {
//             next();
//         } else {
//             return res.status(403).json({
//                 success: false,
//                 message: "Access denied. Admin privileges required"
//             });
//         }
//     });
// };

const protect = async(req,res,next)=>{
    try {
        const token = req.cookies.jwt || (req.headers.authorization?.startsWith('Bearer') ? req.headers.authorization.split(' ')[1] : null);
        
        if(!token){
            return res.status(401).json({
                success:false,
                message:'Not authorized, please login again',
                action: 'LOGOUT'
            });
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
        return res.status(403).json({
            success:false,
            message:`Access denied. ${roles.join(' or ')} role required`
        });
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
            return next(); // No token, proceed without setting user/admin
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await User.findById(decoded.id).select('-password');

        if (!user) {
            res.clearCookie('jwt');
            return res.status(401).json({
                success: false,
                message: 'User not found',
                action: 'LOGOUT'
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
        return next(); // Proceed without user/admin if token is invalid
    }
};


module.exports= {
    protect,
    authorize,
    optionalProtect
};
