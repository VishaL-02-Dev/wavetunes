const WalletService = require('./walletService');
const User = require('../model/userModel');
const jwt = require('jsonwebtoken');
const { instance } = require('../config/razorpay');
const crypto = require('crypto');

// Get wallet balance
const getWalletBalance = async (req, res) => {
    const token = req.cookies.jwt;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        const wallet = await WalletService.getWallet(userId);
        return res.status(200).json({
            success: true,
            balance: wallet.balance
        });
    } catch (error) {
        console.error('Error fetching wallet balance:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching wallet balance',
            error: error.message
        });
    }
};

// Add funds to wallet (manual or refund)
const addFunds = async (req, res) => {
    const token = req.cookies.jwt;
    const { amount, description } = req.body;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid amount provided'
            });
        }

        const wallet = await WalletService.addFunds(userId, amount, description || 'Funds added to wallet');
        return res.status(200).json({
            success: true,
            message: 'Funds added successfully',
            balance: wallet.balance
        });
    } catch (error) {
        console.error('Error adding funds:', error);
        return res.status(500).json({
            success: false,
            message: 'Error adding funds',
            error: error.message
        });
    }
};

// Deduct funds from wallet
const deductFunds = async (req, res) => {
    const token = req.cookies.jwt;
    const { amount, description, orderId } = req.body;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid amount provided'
            });
        }

        const wallet = await WalletService.deductFunds(userId, amount, description || 'Funds deducted from wallet', orderId);
        return res.status(200).json({
            success: true,
            message: 'Funds deducted successfully',
            balance: wallet.balance
        });
    } catch (error) {
        console.error('Error deducting funds:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Error deducting funds',
            error: error.message
        });
    }
};

// Get wallet transaction history
const getTransactionHistory = async (req, res) => {
    const token = req.cookies.jwt;
    const { page = 1, limit = 10, startDate, endDate } = req.query;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        const wallet = await WalletService.getWallet(userId);
        let transactions = wallet.transactions;

        // Apply date filters if provided
        if (startDate || endDate) {
            transactions = transactions.filter(transaction => {
                const transactionDate = new Date(transaction.date);
                const start = startDate ? new Date(startDate) : new Date(0);
                const end = endDate ? new Date(endDate) : new Date();
                return transactionDate >= start && transactionDate <= end;
            });
        }

        // Pagination
        const totalTransactions = transactions.length;
        const totalPages = Math.ceil(totalTransactions / limit);
        const startIndex = (page - 1) * limit;
        const paginatedTransactions = transactions.slice(startIndex, startIndex + parseInt(limit));

        return res.status(200).json({
            success: true,
            transactions: paginatedTransactions,
            pagination: {
                currentPage: parseInt(page),
                totalPages,
                totalTransactions,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Error fetching transaction history:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching transaction history',
            error: error.message
        });
    }
};

//User Wallet render
const getUserWallet = async (req, res) => {
    const token = req.cookies.jwt;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id; // Assuming user is available in request from auth middleware

        // Get query parameters with defaults
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const type = req.query.type || '';
        const search = req.query.search || '';
        const sortOrder = req.query.sort || 'desc';

        // Get wallet data
        const wallet = await WalletService.getWallet(userId);

        // Filter transactions based on type and search
        let filteredTransactions = wallet.transactions;

        if (type) {
            filteredTransactions = filteredTransactions.filter(t => t.type === type);
        }

        if (search) {
            const searchLower = search.toLowerCase();
            filteredTransactions = filteredTransactions.filter(t =>
                t.description.toLowerCase().includes(searchLower) ||
                t.amount.toString().includes(searchLower)
            );
        }

        // Sort transactions
        filteredTransactions.sort((a, b) => {
            if (sortOrder === 'asc') {
                return new Date(a.date) - new Date(b.date);
            } else {
                return new Date(b.date) - new Date(a.date);
            }
        });

        // Calculate pagination
        const totalTransactions = filteredTransactions.length;
        const totalPages = Math.ceil(totalTransactions / limit);
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;

        // Get paginated transactions
        const paginatedTransactions = filteredTransactions.slice(startIndex, endIndex);

        // Create wallet object with paginated transactions
        const walletWithPagination = {
            ...wallet.toObject(),
            transactions: paginatedTransactions
        };

        res.render('user/wallet', {
            wallet: walletWithPagination,
            currentPage: page,
            totalPages,
            limit,
            type,
            search,
            sortOrder,
            user: req.user // Pass user for header/footer templates
        });
    } catch (error) {
        console.error('Error fetching wallet:', error);
        req.flash('error', 'Failed to load wallet information');
        res.redirect('/dashboard');
    }
};


// Initiate Razorpay payment for wallet top-up
const initiateRazorpayForWallet = async (req, res) => {
    const token = req.cookies.jwt;
    const { amount } = req.body;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid amount provided'
            });
        }

        const razorpayAmount = Math.round(amount * 100); // Convert to paise
        const options = {
            amount: razorpayAmount,
            currency: 'INR',
            receipt: `wallet_topup_${Date.now()}`,
            notes: {
                userId: user._id.toString(),
                type: 'wallet_topup'
            }
        };

        const razorpayOrder = await instance.orders.create(options);

        res.status(200).json({
            success: true,
            order: razorpayOrder,
            key: process.env.RAZORPAY_KEY_ID,
            amount: razorpayAmount,
            userInfo: {
                name: `${user.fname} ${user.lname}`,
                email: user.email,
                contact: user.phone || ''
            }
        });
    } catch (error) {
        console.error('Error creating Razorpay order for wallet:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating Razorpay order',
            error: error.message
        });
    }
};

// Verify Razorpay payment for wallet top-up
const verifyRazorpayForWallet = async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const token = req.cookies.jwt;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Verify payment signature
        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_SECRET)
            .update(body.toString())
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: 'Invalid payment signature'
            });
        }

        // Fetch Razorpay order details
        const razorpayOrder = await instance.orders.fetch(razorpay_order_id);
        const amount = razorpayOrder.amount / 100; // Convert paise to INR

        // Add funds to wallet
        await WalletService.addFunds(
            userId,
            amount,
            `Wallet top-up via Razorpay (Payment ID: ${razorpay_payment_id})`,
            null
        );

        res.status(200).json({
            success: true,
            message: 'Wallet top-up successful',
            balance: (await WalletService.getWallet(userId)).balance
        });
    } catch (error) {
        console.error('Error verifying Razorpay payment for wallet:', error);
        res.status(500).json({
            success: false,
            message: 'Error verifying payment',
            error: error.message
        });
    }
};

module.exports = {
    getWalletBalance,
    addFunds,
    deductFunds,
    getTransactionHistory,
    getUserWallet,
    initiateRazorpayForWallet,
    verifyRazorpayForWallet
};