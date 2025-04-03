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
        // console.log('found ', addresses)
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

//Edit Profile
const editProfile = async(req,res)=>{
    const token=req.cookies.jwt;
    try {
        const decoded=jwt.verify(token,process.env.JWT_SECRET);
        const user=await User.findById(decoded.id);

        if(!user){
            return res.status(404).json({
                success:fasle,
                message:'User not found'
            });
        }

        const {fname, lname, email, phone}=req.body;

        if (email !== user.email) {
            const existingUser = await User.findOne({ email });
            if (existingUser) {
                return res.status(400).json({ success: false, message: 'Email already in use' });
            }
        }

        user.fname=fname;
        user.lname=lname;
        user.email=email;
        user.phone=phone;

        await user.save();

        return res.status(200).json({
            success:true,
            message:'Profile updated successfully'
        })
    } catch (error) {
        console.log("Profile update error:", error);
        return res.status(500).json({ 
            success: false,
            message: 'An error occurred while updating your profile' 
        });
    }
}

module.exports={
    loadProfile,
    editProfile
}