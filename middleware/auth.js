const jwt= require('jsonwebtoken');
require('dotenv').config();

const verifyToken = (req,res,next)=>{
    const token = req.cookies?.jwt || 
                  (req.headers['authorization'] ? 
                  req.headers['authorization'].split(" ")[1] : null);

    if (!token) {
        return res.status(403).json({
            success: false,
            message: "Access denied. No token provided"
        });
    }

        try {
            const decoded = jwt.verify(token,process.env.JWT_SECRET);
            req.user =decoded;
            next();
        } catch (error) {
            return res.status(401).json({
                success:false,
                message:"Invalid token"
            })
        }
}

// For admin verification
const verifyAdmin = (req, res, next) => {
    verifyToken(req, res, () => {
        if (req.user && req.user.role === 'admin') {
            next();
        } else {
            return res.status(403).json({
                success: false,
                message: "Access denied. Admin privileges required"
            });
        }
    });
};

module.exports= {
    verifyToken,
    verifyAdmin
};
