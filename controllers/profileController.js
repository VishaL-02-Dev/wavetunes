const User=require('../model/userModel');
const Address=require('../model/addressModel');
const jwt=require('jsonwebtoken');

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
        
        const addresses= await Address.find({userId: user._id});
        console.log('found ', addresses)
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

module.exports={
    loadProfile,
}