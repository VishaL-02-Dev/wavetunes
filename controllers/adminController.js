const User = require('../model/userModel');
const Order = require('../model/orderModel');
const Product = require('../model/productModel');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const moment = require('moment-timezone');

// Load login page
const loadLogin = async (req, res) => {
    try {
        // console.log("login rendered");
        res.render('admin/login', { error: null });
    } catch (error) {
        console.log(error);
    }
};

// Login
const login = async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    try {
        if (!user.isAdmin) {
            return res.status(400).json({
                success: false,
                message: "Access denied!"
            });
        }

        const matchPass = await bcrypt.compare(password, user.password);
        if (!matchPass) {
            return res.status(401).json({
                success: false,
                message: "Invalid mail or password"
            });
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
};

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

        // Calculate total revenue for the default period (monthly)
        const now = moment().tz('Asia/Kolkata');
        const dateFilter = {
            $gte: now.clone().subtract(12, 'months').startOf('month').toDate(),
            $lte: now.endOf('month').toDate()
        };

        totalRevenue = await Order.aggregate([
            {
                $match: {
                    status: { $nin: ['cancelled', 'returned'] },
                    paymentMethod: { $ne: 'COD' },
                    createdAt: dateFilter
                }
            },
            {
                $unwind: { path: '$items', preserveNullAndEmptyArrays: true }
            },
            {
                $match: {
                    'items.status': { $nin: ['cancelled', 'returned'] }
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$totalAmount' }
                }
            }
        ]);

        recentOrders = await Order.find()
            .sort({ createdAt: -1 })
            .limit(5)
            .populate('userId', 'fname lname')
            .lean();

        // console.log('getDashboard - Total Revenue:', totalRevenue[0]?.total || 0);

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
                    status: { $nin: ['cancelled', 'returned'] },
                    paymentMethod: { $ne: 'COD' }
                }
            },
            {
                $unwind: { path: '$items', preserveNullAndEmptyArrays: true }
            },
            {
                $match: {
                    'items.status': { $nin: ['cancelled', 'returned'] }
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

        // console.log(`getSalesReport (${period}) - Sales Data:`, JSON.stringify(salesData, null, 2));

        if (period === 'daily') {
            const today = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
            const todayStr = new Date(today).toISOString().split('T')[0];
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

// Sales Report Details (for PDF)
const getSalesReportDetails = async (req, res) => {
    const { period } = req.query;

    try {
        let groupBy, dateFormat, dateFilter;
        const now = moment().tz('Asia/Kolkata');

        switch (period) {
            case 'daily':
                groupBy = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } };
                dateFormat = '%Y-%m-%d';
                dateFilter = {
                    $gte: now.clone().subtract(30, 'days').startOf('day').toDate(),
                    $lte: now.endOf('day').toDate()
                };
                break;
            case 'weekly':
                groupBy = {
                    $concat: [
                        { $toString: { $year: { date: '$createdAt', timezone: 'Asia/Kolkata' } } },
                        '-Wk',
                        { $toString: { $week: { date: '$createdAt', timezone: 'Asia/Kolkata' } } }
                    ]
                };
                dateFormat = 'YYYY-WW';
                dateFilter = {
                    $gte: now.clone().subtract(12, 'weeks').startOf('week').toDate(),
                    $lte: now.endOf('week').toDate()
                };
                break;
            case 'monthly':
            default:
                groupBy = { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'Asia/Kolkata' } };
                dateFormat = '%Y-%m';
                dateFilter = {
                    $gte: now.clone().subtract(12, 'months').startOf('month').toDate(),
                    $lte: now.endOf('month').toDate()
                };
                break;
        }

        // console.log(`getSalesReportDetails (${period}) - Date Filter:`, {
        //     start: dateFilter.$gte,
        //     end: dateFilter.$lte
        // });

        const salesData = await Order.aggregate([
            {
                $match: {
                    status: { $nin: ['cancelled', 'returned'] },
                    paymentMethod: { $ne: 'COD' },
                    createdAt: dateFilter
                }
            },
            {
                $unwind: { path: '$items', preserveNullAndEmptyArrays: true }
            },
            {
                $match: {
                    'items.status': { $nin: ['cancelled', 'returned'] }
                }
            },
            {
                $group: {
                    _id: groupBy,
                    totalSales: { $sum: '$totalAmount' },
                    orderCount: { $sum: 1 }
                }
            },
            {
                $sort: { _id: 1 }
            },
            {
                $project: {
                    date: '$_id',
                    totalSales: 1,
                    orderCount: 1,
                    _id: 0
                }
            }
        ]);

        // console.log(`getSalesReportDetails (${period}) - Sales Data:`, JSON.stringify(salesData, null, 2));

        const orders = await Order.find({
            createdAt: dateFilter
        })
            .populate('userId', 'fname lname')
            .lean()
            .select('orderId userId totalAmount status createdAt');

        // console.log(`getSalesReportDetails (${period}) - Orders Count:`, orders.length);
        if (orders.length > 0) {
            console.log(`getSalesReportDetails (${period}) - Sample Order:`, JSON.stringify(orders[0], null, 2));
        }

        const formattedSalesData = salesData.map(item => ({
            date: item.date,
            totalSales: item.totalSales,
            orderCount: item.orderCount
        }));

        res.json({
            success: true,
            salesData: formattedSalesData,
            orders
        });
    } catch (error) {
        console.error('Sales Report Details Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch sales report details',
            error: error.message
        });
    }
};

// Logout
const logout = async (req, res) => {
    try {
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
    getSalesReportDetails,
    logout
};