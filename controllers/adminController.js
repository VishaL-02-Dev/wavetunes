const User=require('../model/userModel');
const Order= require('../model/orderModel');
const Product= require('../model/productModel');
const bcrypt=require('bcrypt');
const jwt=require('jsonwebtoken');


// Load login page
const loadLogin= async(req,res)=>{
    try {
        console.log("login rendered")
        res.render('admin/login',{ error:null });
    } catch (error) {
        console.log(error);
    }
}

// Login 
const login=async(req,res)=>{
    const {email, password} = req.body;
    const user= await User.findOne({email});

    try {
        if(!user.isAdmin){
            return res.status(400).json({
                success: false,
                message:"Access denied!"
            })
        }
    
        const matchPass=await bcrypt.compare(password, user.password);
        if(!matchPass){
            return res.status(401).json({
                success:false,
                message:"Invalid mail or password"
            })
        }
       
        const token = jwt.sign(
            { 
                id: user._id, 
                email: user.email, 
                fname: user.fname, 
                lname: user.lname, 
                role: 'admin' 
            },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );
        
        // console.log('Token generated',token);
        
        // Set the JWT as a cookie
        res.cookie('jwt', token, {
            httpOnly: true,
            secure: false, // Set to true in production with HTTPS
            maxAge: 24 * 60 * 60 * 1000 // 1 day
        });
       
        return res.status(200).json({
            success:true,
            token,
            message:"Login successful",
            redirectUrl:'/admin/dashboard'
        });

    } catch (error) {
        console.log("Login error",error);
        res.status(500).json({
            success:false,
            message:"Internal Server error"
        });
    }

}


// Dashboard
const getDashboard = async (req, res) => {
    let totalUsers = 0;
    let totalOrders = 0;
    let totalProducts = 0;
    let totalRevenue = 0;
    let months = [];
    let sales = [];
    let topProducts = { labels: [], data: [] };
    let recentOrders = [];
    
    try {

         totalUsers= await User.countDocuments({isAdmin: false});
         totalOrders= await Order.countDocuments();
         totalProducts= await Product.countDocuments();
         totalRevenue= await Order.aggregate([
            {$match: {status:{$ne: 'canceled'}}},
            {$group:{_id:null, total: {$sum:'$totalAmount'}}}
        ]);

        const salesData= await Order.aggregate([
            {$match: {status:{$ne:'canceled'}}},
            {$group: {
                _id: {
                    month:{$month: '$createdAt'},
                    year:{$year: '$createdAt'}
                },
                totalSales:{$sum: '$totalAmount'}
            }
        },
        {$sort: {'_id.year':1, '_id.month': 1}},
        {$limit: 12}
        ]);

        months= salesData.map(data=>{
            const date = new Date(data._id.year, data._id.month -1 );
            return date.toLocaleString('default', {month:'short', year: 'numeric'})
        });
        sales= salesData.map(data=> data.totalSales);

        recentOrders= await Order.find()
            .sort({createdAt: -1})
            .limit(5)
            .populate('userId', 'fname lname');

        res.render('admin/dashboard',{ 
            currentPage: 'dashboard',
            admin:req.user,
            stats:{
                totalUsers,
                totalProducts: totalProducts || 0,
                totalOrders,
                totalRevenue: totalRevenue[0]?.total || 0
            },
            chartData:{
                months,
                sales
            },
            recentOrders
        })

    } catch (error) {
        console.error('Dashboard Error:', error);
        res.render('admin/dashboard',{
            currentPage: 'dashboard',
            admin:req.user,
            stats:{
                totalUsers,
                totalProducts: totalProducts || 0,
                totalOrders,
                totalRevenue: totalRevenue[0]?.total || 0
            },
            chartData:{
                months,
                sales
            },
            recentOrders
        })
     
    }
};

// Helper function to get status color for badges
// const getStatusColor = (status) => {
//     switch (status.toLowerCase()) {
//         case 'completed':
//             return 'success';
//         case 'pending':
//             return 'warning';
//         case 'cancelled':
//             return 'danger';
//         default:
//             return 'secondary';
//     }
// };




// Logout 
const logout = async (req, res) => {
    try {
        // Clear the JWT cookie
        res.clearCookie('jwt');
        
        return res.status(200).json({
            success: true,
            message: "Logout successful",
            redirectUrl: '/admin/login'
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
    // loadDashboard,
    getDashboard,
    logout,
}