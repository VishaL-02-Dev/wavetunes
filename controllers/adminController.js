const User=require('../model/userModel');
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
        
        console.log('Token generated',token);
        
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


// const loadDashboard= async(req,res)=>{
//     try {
//         console.log("Dashboard rendered");
//         res.render('dashboard');
//     } catch (error) {
//         console.log(error);
//     }
// }

// Dashboard
const getDashboard = async (req, res) => {
    try {
        res.render('admin/dashboard',{ 
            currentPage: 'dashboard',
            admin:req.user
        })
        
        // , {
        //     currentPage: 'dashboard',
        //     stats,
        //     chartData: {
        //         months,
        //         sales
        //     },
        //     topProducts: {
        //         labels: topProducts.map(p => p.productInfo[0].name),
        //         data: topProducts.map(p => p.count)
        //     },
        //     recentOrders: formattedOrders
        // });

    } catch (error) {
        console.error('Dashboard Error:', error);
        res.render('admin/dashboard',{
            currentPage: 'dashboard',
            admin:req.user
        })
        // , {
        //     currentPage: 'dashboard',
        //     stats: {
        //         totalUsers: 0,
        //         totalProducts: 0,
        //         totalOrders: 0,
        //         totalRevenue: 0
        //     },
        //     chartData: {
        //         months: [],
        //         sales: []
        //     },
        //     topProducts: {
        //         labels: [],
        //         data: []
        //     },
        //     recentOrders: [],
        //     error: 'Failed to load dashboard data'
        // });
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




// const logout= async(req,res)=>{
//     try {
//         delete req.session.admin;
        
//         req.session.save((err) => {
//             if (err) {
//                 return res.status(500).json({
//                     success: false,
//                     message: "Error during logout",
//                 });
//             }
            
//             return res.status(200).json({
//                 success: true,
//                 message: "Logout successful",
//                 redirectUrl: '/admin/login'
//             });
//         });
       
//     } catch (error) {
//         console.log("Login error",error);
//         res.status(500).json({
//             success:false,
//             message:"Internal Server error"
//         });
//     }
// }

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