const User = require('../model/userModel');
const Order = require('../model/orderModel');
const Product = require('../model/productModel');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');


// Load login page
const loadLogin = async (req, res) => {
    try {
        console.log("login rendered")
        res.render('admin/login', { error: null });
    } catch (error) {
        console.log(error);
    }
}

// Login 
const login = async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    try {
        if (!user.isAdmin) {
            return res.status(400).json({
                success: false,
                message: "Access denied!"
            })
        }

        const matchPass = await bcrypt.compare(password, user.password);
        if (!matchPass) {
            return res.status(401).json({
                success: false,
                message: "Invalid mail or password"
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
            success: true,
            token,
            message: "Login successful",
            redirectUrl: '/admin/dashboard'
        });

    } catch (error) {
        console.log("Login error", error);
        res.status(500).json({
            success: false,
            message: "Internal Server error"
        });
    }

}


// Dashboard
const getDashboard = async (req, res) => {
    let totalUsers = 0;
    let totalOrders = 0;
    let totalProducts = 0;
    let totalRevenue = 0;
    let recentOrders = [];

    try {
        totalUsers = await User.countDocuments({ isAdmin: false });
        totalOrders = await Order.countDocuments();
        totalProducts = await Product.countDocuments();
        totalRevenue = await Order.aggregate([
            {
                $match: {
                    status: { $in: ['processing', 'shipped', 'delivered'] },
                    paymentMethod: { $ne: 'COD' } // Exclude COD orders
                }
            },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);

        recentOrders = await Order.find()
            .sort({ createdAt: -1 })
            .limit(5)
            .populate('userId', 'fname lname')
            .lean();

        res.render('admin/dashboard', {
            currentPage: 'dashboard',
            admin: req.user,
            stats: {
                totalUsers,
                totalProducts: totalProducts || 0,
                totalOrders,
                totalRevenue: totalRevenue[0]?.total || 0
            },
            recentOrders
        });
    } catch (error) {
        console.error('Dashboard Error:', error);
        res.render('admin/dashboard', {
            currentPage: 'dashboard',
            admin: req.user,
            stats: {
                totalUsers,
                totalProducts: totalProducts || 0,
                totalOrders,
                totalRevenue: totalRevenue[0]?.total || 0
            },
            recentOrders
        });
    }
};

// Sales Report
const getSalesReport = async (req, res) => {
    try {
        const { period } = req.query; // daily, weekly, monthly
        let groupBy, dateFormat, limit;

        
        const timezone = 'Asia/Kolkata';

        switch (period) {
            case 'daily':
                groupBy = {
                    year: { $year: { date: '$createdAt', timezone } },
                    month: { $month: { date: '$createdAt', timezone } },
                    day: { $dayOfMonth: { date: '$createdAt', timezone } }
                };
                dateFormat = {
                    $dateToString: {
                        format: '%Y-%m-%d',
                        date: '$createdAt',
                        timezone
                    }
                };
                limit = 30; // Last 30 days
                break;
            case 'weekly':
                groupBy = {
                    year: { $year: { date: '$createdAt', timezone } },
                    week: { $week: { date: '$createdAt', timezone } }
                };
                dateFormat = {
                    $concat: [
                        {
                            $dateToString: {
                                format: '%Y-Wk',
                                date: '$createdAt',
                                timezone
                            }
                        },
                        {
                            $toString: {
                                $week: { date: '$createdAt', timezone }
                            }
                        }
                    ]
                };
                limit = 12; // Last 12 weeks
                break;
            case 'monthly':
            default:
                groupBy = {
                    year: { $year: { date: '$createdAt', timezone } },
                    month: { $month: { date: '$createdAt', timezone } }
                };
                dateFormat = {
                    $dateToString: {
                        format: '%Y-%m',
                        date: '$createdAt',
                        timezone
                    }
                };
                limit = 12; // Last 12 months
                break;
        }

        const salesData = await Order.aggregate([
            {
                $match: {
                    status: { $in: ['processing', 'shipped', 'delivered'] },
                    paymentMethod: { $ne: 'COD' }
                }
            },
            {
                $group: {
                    _id: groupBy,
                    date: { $first: dateFormat },
                    totalSales: { $sum: '$totalAmount' },
                    orderCount: { $sum: 1 }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.week': 1 } },
            { $limit: limit },
            {
                $project: {
                    _id: 0,
                    date: 1,
                    totalSales: 1,
                    orderCount: 1
                }
            }
        ]);

        
        if (period === 'daily') {
            const today = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
            const todayStr = new Date(today).toISOString().split('T')[0]; // e.g., '2025-04-20'
            if (!salesData.some(item => item.date === todayStr)) {
                salesData.push({ date: todayStr, totalSales: 0, orderCount: 0 });
            }
        }

        const labels = salesData.map(item => item.date);
        const sales = salesData.map(item => item.totalSales.toFixed(2));
        const orderCounts = salesData.map(item => item.orderCount);

        res.status(200).json({
            success: true,
            chartData: { labels, sales, orderCounts },
            salesData
        });
    } catch (error) {
        console.error('Error fetching sales report:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching sales report',
            error: error.message
        });
    }
};


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


module.exports = {
    loadLogin,
    login,
    getSalesReport,
    getDashboard,
    logout,
}