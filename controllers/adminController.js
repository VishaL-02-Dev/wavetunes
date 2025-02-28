const User=require('../model/userModel');
const bcrypt=require('bcrypt');

const loadLogin= async(req,res)=>{
    try {
        console.log("login rendered")
        res.render('admin/login',{ error:null });
    } catch (error) {
        console.log(error);
    }
}


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
        
        req.session.admin={
            id:user._id,
            fname:user.fname,
            lname:user.lname,
            email:user.email
        };

        return res.status(200).json({
            success:true,
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

const getDashboard = async (req, res) => {
    try {
        res.render('admin/dashboard',{ currentPage: 'dashboard'})
        
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
        res.render('admin/dashboard',{currentPage: 'dashboard'})
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




const logout= async(req,res)=>{
    try {
        delete req.session.admin;
        
        req.session.save((err) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    message: "Error during logout",
                });
            }
            
            return res.status(200).json({
                success: true,
                message: "Logout successful",
                redirectUrl: '/admin/login'
            });
        });
       
    } catch (error) {
        console.log("Login error",error);
        res.status(500).json({
            success:false,
            message:"Internal Server error"
        });
    }
}



module.exports={
    loadLogin,
    login,
    // loadDashboard,
    getDashboard,
    logout,
}