const mongoose = require('mongoose');
const User = require('../model/userModel');
const Product = require('../model/productModel');
const Address = require('../model/addressModel');
const Cart = require('../model/cartModel');
const Order = require('../model/orderModel');
const Coupon = require('../model/couponsModel');
const jwt = require('jsonwebtoken');
const { instance } = require('../config/razorpay');
const crypto = require('crypto');
const WalletService = require('./walletService');
const PDFDocument = require('pdfkit');
const axios = require('axios');

// Helper function to create order items
const createOrderItems = (cartItems, currentDate, paymentMethod) => {
    let subtotal = 0;
    let originalSubtotal = 0;

    const orderItems = cartItems.map(item => {
        if (!item.product) {
            return {
                productId: item.productId || null,
                quantity: item.quantity,
                price: 0,
                discount: 0,
                status: paymentMethod === 'COD' ? 'pending' : 'processing',
                refunded: false,
                refundAmount: 0
            };
        }

        const originalPrice = Number(item.product.price) || 0;
        let offerPercentage = Number(item.product.offerPercentage) || 0;
        const offerEndDate = item.product.offerEndDate;

        if (offerEndDate && new Date(offerEndDate) < currentDate) {
            offerPercentage = 0;
        }

        const discountedPrice = offerPercentage > 0
            ? originalPrice * (1 - offerPercentage / 100)
            : originalPrice;
        const discountAmount = originalPrice - discountedPrice;

        subtotal += discountedPrice * item.quantity;
        originalSubtotal += originalPrice * item.quantity;

        return {
            productId: item.product._id,
            name: item.product.name,
            price: discountedPrice,
            discount: discountAmount,
            originalPrice,
            offerPercentage: offerPercentage,
            quantity: item.quantity,
            discountApplied: offerPercentage > 0 ? 'offer' : 'none',
            image: item.product.images && item.product.images.length > 0 ? item.product.images[0] : null,
            status: paymentMethod === 'COD' ? 'pending' : 'processing',
            refunded: false,
            refundAmount: 0
        };
    });

    return { orderItems, subtotal, originalSubtotal };
};


// Load Checkout
const loadCheckout = async (req, res) => {
    const token = req.cookies.jwt;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        let addresses = await Address.find({ userId }).sort({ isDefault: -1 });
        let cart = await Cart.findOne({ user: userId }).populate({
            path: 'items.product',
            select: 'name price offerPercentage images stock isActive'
        });

        if (!cart || !cart.items || cart.items.length === 0) {
            return res.redirect('/user/cart');
        }

        const activeItems = cart.items.filter(item => item.product && item.product.isActive);
        if (activeItems.length === 0) {
            cart.items = [];
            await cart.save();
            return res.redirect('/user/cart');
        }

        // Update cart with active items only
        if (activeItems.length < cart.items.length) {
            cart.items = activeItems;
            await cart.save();
        }

        cart.subtotal = cart.items.reduce((sum, item) => {
            const price = item.product.offerPercentage > 0
                ? item.product.price * (1 - item.product.offerPercentage / 100)
                : item.product.price;
            return sum + (price * item.quantity);
        }, 0);

        cart.shipping = cart.subtotal > 0 ? 10 : 0;
        cart.tax = 0;
        cart.total = cart.subtotal + cart.shipping + cart.tax;

        const currentDate = new Date();
        const coupons = await Coupon.find({
            isActive: true,
            startDate: { $lte: currentDate },
            endDate: { $gte: currentDate },
            minimumPurchase: { $lte: cart.subtotal }
        });

        const user = await User.findById(userId);
        res.render('user/checkout', { cart, user, addresses, coupons });

    } catch (error) {
        console.error('Error loading checkout:', error);
        res.redirect('/user/cart');
    }
};


// Apply Coupon
const applyCoupon = async (req, res) => {
    const token = req.cookies.jwt;
    const { couponCode } = req.body;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        const cart = await Cart.findOne({ user: userId }).populate({
            path: 'items.product',
            select: 'name price offerPercentage images stock'
        });
        if (!cart) {
            return res.status(404).json({
                success: false,
                message: 'Cart not found'
            });
        }

        const { subtotal, originalSubtotal } = createOrderItems(cart.items, new Date());
        const offerDiscount = originalSubtotal - subtotal;
        const shipping = subtotal > 0 ? 10 : 0;
        const tax = 0;

        let couponDiscount = 0;
        let coupon = null;
        let discountType = 'offer';

        if (couponCode) {
            coupon = await Coupon.findOne({
                code: couponCode,
                isActive: true,
                startDate: { $lte: new Date() },
                endDate: { $gte: new Date() }
            });

            if (!coupon) {
                return res.status(404).json({
                    success: false,
                    message: 'Coupon not found or expired'
                });
            }

            if (subtotal < coupon.minimumPurchase) {
                return res.status(400).json({
                    success: false,
                    message: `Minimum purchase of ₹${coupon.minimumPurchase} required`
                });
            }

            if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
                return res.status(400).json({
                    success: false,
                    message: 'Coupon has reached maximum usage limit'
                });
            }

            if (coupon.discountType === 'percentage') {
                couponDiscount = (originalSubtotal * coupon.discountAmount) / 100;
                if (coupon.maxDiscount && couponDiscount > coupon.maxDiscount) {
                    couponDiscount = coupon.maxDiscount;
                }
            } else {
                couponDiscount = coupon.discountAmount;
            }
        }

        let discount = offerDiscount;
        if (couponDiscount > offerDiscount) {
            discount = couponDiscount;
            discountType = 'coupon';
        }

        const total = subtotal + shipping + tax - (discountType === 'coupon' ? couponDiscount : 0);

        return res.status(200).json({
            success: true,
            message: `${discountType === 'offer' ? 'Offer' : 'Coupon'} applied`,
            coupon: coupon ? {
                code: coupon.code,
                discountType: coupon.discountType,
                discountAmount: coupon.discountAmount,
                maxDiscount: coupon.maxDiscount || 0
            } : null,
            discount,
            total,
            subtotal,
            shipping,
            tax,
            discountType
        });

    } catch (error) {
        console.error('Error applying coupon:', error);
        return res.status(500).json({
            success: false,
            message: 'Error applying coupon',
            error: error.message
        });
    }
};


// Place Order (COD and others)
const placeOrder = async (req, res) => {
    const token = req.cookies.jwt;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;
        const { addressId, paymentMethod, couponCode, discountType } = req.body;

        const user = await User.findById(userId);

        const cart = await Cart.findOne({ user: userId }).populate('items.product');
        if (!cart || !cart.items.length) {
            return res.status(400).json({ success: false, message: 'Cart is empty' });
        }

        const address = await Address.findById(addressId);
        if (!address) {
            return res.status(400).json({ success: false, message: 'Invalid address' });
        }

        const currentDate = new Date();
        const { orderItems, subtotal, originalSubtotal } = createOrderItems(cart.items, currentDate, paymentMethod);

        let discount = 0;
        let coupon = null;
        if (couponCode && discountType === 'coupon') {
            coupon = await Coupon.findOne({ code: couponCode, isActive: true });
            if (coupon) {
                if (coupon.discountType === 'percentage') {
                    discount = (originalSubtotal * coupon.discountAmount) / 100;
                    if (coupon.maxDiscount && discount > coupon.maxDiscount) {
                        discount = coupon.maxDiscount;
                    }
                } else {
                    discount = coupon.discountAmount;
                }
                await Coupon.findByIdAndUpdate(coupon._id, { $inc: { usedCount: 1 } });
            }
        } else {
            discount = originalSubtotal - subtotal;
        }

        const shipping = subtotal > 0 ? 10 : 0;
        const tax = 0;
        const totalAmount = subtotal + shipping + tax - (discountType === 'coupon' ? discount : 0);

        const order = new Order({
            userId: userId,
            orderId: `ORD-${Date.now()}`,
            items: orderItems,
            addressId: address._id,
            paymentMethod: 'COD',
            subtotal,
            shipping,
            tax,
            totalAmount,
            discount,
            status: 'pending',
            date: new Date(),
            refundStatus: 'none',
            coupon: coupon ? {
                code: coupon.code,
                discountType: coupon.discountType,
                discountAmount: coupon.discountAmount,
                maxDiscount: coupon.maxDiscount || 0
            } : null,
            discountType: discountType || 'offer'
        });

        await order.save();
        await Cart.findOneAndUpdate({ user: userId }, { items: [], subtotal: 0, shipping: 0, tax: 0, total: 0 });

        return res.render('user/orderConfirm', {
            order: order._id,
            user,
            address: order.addressId
        });
    } catch (error) {
        console.error('Error placing order:', error);
        res.status(500).json({ success: false, message: 'Error placing order' });
    }
};


// Wallet Payment Method
const processWalletPayment = async (req, res) => {
    const { addressId, couponCode, amount, discountType } = req.body;
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

        const address = await Address.findOne({ _id: addressId, userId });
        if (!address) {
            return res.status(400).json({
                success: false,
                message: 'Invalid address selected'
            });
        }

        const cart = await Cart.findOne({ user: userId }).populate({
            path: 'items.product',
            select: 'name price offerPercentage images stock'
        });
        if (!cart || !cart.items.length) {
            return res.status(400).json({
                success: false,
                message: 'Cart is empty'
            });
        }

        const currentDate = new Date();
        const { orderItems, subtotal, originalSubtotal } = createOrderItems(cart.items, currentDate, 'Wallet');

        const shipping = subtotal > 0 ? 10 : 0;
        const tax = 0;
        let discount = 0;
        let coupon = null;

        if (couponCode && discountType === 'coupon') {
            coupon = await Coupon.findOne({ code: couponCode, isActive: true });
            if (!coupon) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid or inactive coupon'
                });
            }

            if (coupon.discountType === 'percentage') {
                discount = (originalSubtotal * coupon.discountAmount) / 100;
                if (coupon.maxDiscount && discount > coupon.maxDiscount) {
                    discount = coupon.maxDiscount;
                }
            } else {
                discount = coupon.discountAmount;
            }

            if (discount > subtotal) {
                discount = subtotal;
            }
            await Coupon.findByIdAndUpdate(coupon._id, { $inc: { usedCount: 1 } });
        } else {
            discount = originalSubtotal - subtotal;
        }

        const total = subtotal + shipping + tax - (discountType === 'coupon' ? discount : 0);

        if (Math.abs(total - amount) > 0.01) {
            return res.status(400).json({
                success: false,
                message: 'Invalid order amount'
            });
        }

        const wallet = await WalletService.getWallet(userId);
        if (wallet.balance < total) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient wallet balance'
            });
        }

        for (const item of cart.items) {
            const product = await Product.findById(item.product._id);
            if (product.stock < item.quantity) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient stock for ${item.product.name}`
                });
            }
            await Product.findByIdAndUpdate(item.product._id, {
                $inc: { stock: -item.quantity }
            });
        }

        const generateOrderId = () => `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

        const order = new Order({
            orderId: generateOrderId(),
            userId,
            totalAmount: total,
            addressId,
            items: orderItems,
            paymentMethod: 'Wallet',
            subtotal,
            shipping,
            tax,
            discount,
            status: 'processing',
            coupon: coupon ? {
                code: coupon.code,
                discountType: coupon.discountType,
                discountAmount: coupon.discountAmount,
                maxDiscount: coupon.maxDiscount || 0
            } : null,
            discountType: discountType || 'offer',
            date: new Date()
        });

        await order.save();
        await WalletService.deductFunds(
            userId,
            total,
            `Payment for order ${order.orderId}`,
            order._id
        );
        await Cart.findOneAndDelete({ user: userId });

        const completeOrder = await Order.findById(order._id)
            .populate('addressId')
            .populate({
                path: 'items.productId',
                select: 'name price images'
            });

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        return res.render('user/orderConfirm', {
            order: completeOrder,
            user,
            address: completeOrder.addressId
        });

    } catch (error) {
        console.error('Error processing wallet payment:', error);
        return res.status(500).json({
            success: false,
            message: 'Error processing wallet payment: ' + error.message
        });
    }
};


// Razorpay Order
const razorpayOrder = async (req, res) => {
    try {
        const amount = req.body.amount * 100;
        const options = {
            amount: amount,
            currency: 'INR',
            receipt: 'receipt_order_' + Date.now()
        };

        const order = await instance.orders.create(options);
        res.json({
            success: true,
            order
        });
    } catch (error) {
        console.error('Error creating razorpay order:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating razorpay order'
        });
    }
};


// Initiate Razorpay Order
const initiateRazorpayOrder = async (req, res) => {
    const token = req.cookies.jwt;
    const { addressId, couponCode, discountType } = req.body;

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

        const address = await Address.findById(addressId);
        if (!address || address.userId.toString() !== user._id.toString()) {
            return res.status(400).json({
                success: false,
                message: 'Invalid address selected'
            });
        }

        const cart = await Cart.findOne({ user: user._id }).populate({
            path: 'items.product',
            select: 'name price offerPercentage images stock'
        });

        if (!cart || !cart.items || cart.items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Your cart is empty'
            });
        }

        const currentDate = new Date();
        const { orderItems, subtotal, originalSubtotal } = createOrderItems(cart.items, currentDate, 'Razorpay');

        let shipping = subtotal > 0 ? 10 : 0;
        let tax = 0;
        let discount = 0;
        let coupon = null;

        if (couponCode && discountType === 'coupon') {
            coupon = await Coupon.findOne({
                code: couponCode,
                isActive: true,
                startDate: { $lte: new Date() },
                endDate: { $gte: new Date() }
            });

            if (coupon && subtotal >= coupon.minimumPurchase) {
                if (coupon.discountType === 'percentage') {
                    discount = (originalSubtotal * coupon.discountAmount) / 100;
                    if (coupon.maxDiscount && discount > coupon.maxDiscount) {
                        discount = coupon.maxDiscount;
                    }
                } else {
                    discount = coupon.discountAmount;
                }
            }
        } else {
            discount = originalSubtotal - subtotal;
        }

        const total = subtotal + shipping + tax - (discountType === 'coupon' ? discount : 0);

        // Create a pending order
        const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        const pendingOrder = new Order({
            orderId,
            userId: userId,
            totalAmount: total,
            addressId: address._id,
            items: orderItems,
            paymentMethod: 'Razorpay',
            subtotal,
            shipping,
            tax,
            discount,
            status: 'pending',
            coupon: coupon ? {
                code: coupon.code,
                discountType: coupon.discountType,
                discountAmount: coupon.discountAmount,
                maxDiscount: coupon.maxDiscount || 0
            } : null,
            discountType: discountType || 'offer',
            date: new Date()
        });

        await pendingOrder.save();

        const amount = Math.round(total * 100);
        const options = {
            amount: amount,
            currency: 'INR',
            receipt: `order_receipt_${Date.now()}`,
            notes: {
                userId: user._id.toString(),
                addressId: addressId,
                couponCode: couponCode || '',
                discountType: discountType || 'offer',
                orderId: pendingOrder.orderId
            }
        };

        const razorpayOrder = await instance.orders.create(options);

        res.status(200).json({
            success: true,
            order: razorpayOrder,
            key: process.env.RAZORPAY_KEY_ID,
            amount: amount,
            userInfo: {
                name: `${user.fname} ${user.lname}`,
                email: user.email,
                contact: user.phone || ''
            },
            pendingOrderId: pendingOrder._id
        });

    } catch (error) {
        console.error('Error initiating Razorpay order:', error);
        res.status(500).json({
            success: false,
            message: 'Error initiating Razorpay order',
            error: error.message
        });
    }
};


// Verify Razorpay Payment
const verifyRazorpay = async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, discountType } = req.body;

    try {
        const body = `${razorpay_order_id}|${razorpay_payment_id}`;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_SECRET)
            .update(body)
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: 'Invalid payment signature'
            });
        }

        // Fetch Razorpay order details
        const razorpayOrder = await instance.orders.fetch(razorpay_order_id);
        const userId = razorpayOrder.notes.userId;
        const addressId = razorpayOrder.notes.addressId;
        const couponCode = razorpayOrder.notes.couponCode;
        const orderId = razorpayOrder.notes.orderId;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const address = await Address.findById(addressId);
        if (!address || address.userId.toString() !== user._id.toString()) {
            return res.status(400).json({
                success: false,
                message: 'Invalid address selected'
            });
        }

        const pendingOrder = await Order.findOne({ orderId });
        if (!pendingOrder) {
            return res.status(400).json({
                success: false,
                message: 'Pending order not found'
            });
        }

        const cart = await Cart.findOne({ user: user._id }).populate({
            path: 'items.product',
            select: 'name price offerPercentage images stock'
        });

        if (!cart || !cart.items || cart.items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Your cart is empty'
            });
        }

        for (const item of cart.items) {
            const product = await Product.findById(item.product._id);
            if (product.stock < item.quantity) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient stock for ${item.product.name}`
                });
            }
            await Product.findByIdAndUpdate(item.product._id, {
                $inc: { stock: -item.quantity }
            });
        }

        // Update coupon usage if applicable
        let coupon = null;
        if (couponCode && discountType === 'coupon') {
            coupon = await Coupon.findOne({
                code: couponCode,
                isActive: true,
                startDate: { $lte: new Date() },
                endDate: { $gte: new Date() }
            });
            if (coupon) {
                await Coupon.findByIdAndUpdate(coupon._id, { $inc: { usedCount: 1 } });
            }
        }

        pendingOrder.status = 'processing';
        // Item statuses are already set to 'processing' in createOrderItems
        await pendingOrder.save();
        await Cart.findOneAndDelete({ user: userId });

        const completeOrder = await Order.findById(pendingOrder._id)
            .populate('addressId')
            .populate({
                path: 'items.productId',
                select: 'name price images'
            });

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        return res.render('user/orderConfirm', {
            order: completeOrder,
            user,
            address: completeOrder.addressId
        });

    } catch (error) {
        console.error('Error verifying Razorpay payment:', error);
        return res.status(500).json({
            success: false,
            message: 'Error verifying payment',
            error: error.message
        });
    }
};


// Retry Razorpay Payment
const retryRazorpayPayment = async (req, res) => {
    const token = req.cookies.jwt;
    const { orderId } = req.body;

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

        const order = await Order.findById(orderId)
            .populate('addressId')
            .populate({
                path: 'items.productId',
                select: 'name price offerPercentage images stock'
            });

        if (!order || order.status !== 'pending' || order.paymentMethod !== 'Razorpay') {
            return res.status(400).json({
                success: false,
                message: 'Invalid order or not eligible for retry'
            });
        }

        const address = order.addressId;
        if (!address) {
            return res.status(400).json({
                success: false,
                message: 'Invalid address'
            });
        }

        // Verify stock availability
        for (const item of order.items) {
            const product = await Product.findById(item.productId);
            if (!product || product.stock < item.quantity) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient stock for ${item.name}`
                });
            }
        }

        // Update item statuses to 'processing' for consistency
        order.items.forEach(item => {
            item.status = 'processing';
        });
        await order.save();

        const amount = Math.round(order.totalAmount * 100);
        const options = {
            amount: amount,
            currency: 'INR',
            receipt: `order_receipt_${Date.now()}`,
            notes: {
                userId: user._id.toString(),
                addressId: address._id.toString(),
                couponCode: order.coupon ? order.coupon.code : '',
                discountType: order.discountType,
                orderId: order.orderId
            }
        };

        const razorpayOrder = await instance.orders.create(options);

        res.status(200).json({
            success: true,
            order: razorpayOrder,
            key: process.env.RAZORPAY_KEY_ID,
            amount: amount,
            userInfo: {
                name: `${user.fname} ${user.lname}`,
                email: user.email,
                contact: user.phone || ''
            },
            pendingOrderId: order.orderId
        });

    } catch (error) {
        console.error('Error retrying Razorpay payment:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrying payment',
            error: error.message
        });
    }
};

// Load My Orders
const loadMyOrders = async (req, res) => {
    const token = req.cookies.jwt;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
        const skip = (page - 1) * limit;

        const status = req.query.status || '';
        const search = req.query.search || '';
        const sortOrder = req.query.sort || 'desc';

        let query = { userId: userId };
        if (status) query.status = status;
        if (search) query.orderId = { $regex: search, $options: 'i' };

        const sortOptions = sortOrder === 'asc' ? { date: 1 } : { date: -1 };

        const totalOrders = await Order.countDocuments(query);
        const totalPages = Math.ceil(totalOrders / limit);

        const orders = await Order.find(query)
            .populate('addressId', 'addressType address city district state pinCode phone')
            .populate({
                path: 'items.productId',
                select: 'name price images'
            })
            .sort(sortOptions)
            .skip(skip)
            .limit(limit);

        const processedOrders = orders.map(order => ({
            _id: order._id,
            orderId: order.orderId,
            date: order.date,
            status: order.status,
            totalAmount: order.totalAmount,
            paymentMethod: order.paymentMethod,
            items: order.items.map(item => ({
                productId: item.productId || null,
                quantity: item.quantity || 0
            })),
            shippingAddress: order.addressId || {}
        }));

        const user = await User.findById(userId);

        res.render('user/myOrders', {
            orders: processedOrders,
            user,
            currentPage: page,
            totalPages,
            totalOrders,
            status,
            search,
            sortOrder,
            limit
        });

    } catch (error) {
        console.error('Error loading orders:', error);
        res.redirect('/');
    }
};

// Load Order Details
const loadOrderDetails = async (req, res) => {
    const token = req.cookies.jwt;
    const orderId = req.params.id;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        const order = await Order.findOne({
            _id: orderId,
            userId: userId
        })
            .populate('addressId')
            .populate({
                path: 'items.productId',
                select: 'name price images discount'
            });

        if (!order) {
            return res.redirect('/user/myOrders');
        }

        const canCancel = order.status !== 'delivered' && order.status !== 'cancelled' && order.status !== 'returned' &&
            order.items.some(item => item.status !== 'delivered' && item.status !== 'cancelled' && item.status !== 'returned');

        res.render('user/orderDetails', {
            order,
            address: order.addressId,
            canCancel
        });

    } catch (error) {
        console.error('Error loading order details:', error);
        res.redirect('/user/orders');
    }
};


//Generate Invoice
const generateInvoice = async (req, res) => {
    const token = req.cookies.jwt;
    const orderId = req.params.id;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        const order = await Order.findOne({
            _id: orderId,
            userId: userId
        })
            .populate('addressId')
            .populate({
                path: 'items.productId',
                select: 'name price images'
            });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Create a new PDF document
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=invoice_${order.orderId}.pdf`);
        doc.pipe(res);

        // Header
        doc.font('Helvetica-Bold').fontSize(20).text('Invoice', 50, 50, { align: 'center' });
        doc.font('Helvetica').fontSize(12);
        doc.text('WaveTunes', 50, 80, { align: 'center' });
        doc.text('123 Business Street, Commerce City, India - 400001', 50, 95, { align: 'center' });
        doc.text('Email: support@wavetunes.com', 50, 110, { align: 'center' });
        doc.moveDown(2);

        // Order and Customer Details (Two-column layout)
        doc.fontSize(10);
        const leftColumnX = 50;
        const rightColumnX = 300;
        doc.font('Helvetica-Bold').text('Billed To:', leftColumnX, doc.y);
        doc.font('Helvetica').text(`${order.addressId.addressType} Address`, leftColumnX, doc.y + 15);
        doc.text(`${order.addressId.address}`, leftColumnX, doc.y);
        doc.text(`${order.addressId.city}, ${order.addressId.district}, ${order.addressId.state} - ${order.addressId.pinCode}`, leftColumnX, doc.y);
        doc.text(`Phone: ${order.addressId.phone}`, leftColumnX, doc.y);

        doc.font('Helvetica-Bold').text('Invoice Details:', rightColumnX, doc.y - 60);
        doc.font('Helvetica').text(`Order Number: ${order.orderId}`, rightColumnX, doc.y + 15);
        doc.text(`Order Date: ${new Date(order.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, rightColumnX, doc.y);
        doc.text(`Payment Method: ${order.paymentMethod}`, rightColumnX, doc.y);
        doc.text(`Order Status: ${order.status.charAt(0).toUpperCase() + order.status.slice(1)}`, rightColumnX, doc.y);
        doc.moveDown(3);

        // Items Table
        doc.font('Helvetica-Bold').fontSize(12).text('Order Items', 50);
        doc.moveDown(0.5);

        // Table Setup
        const tableLeft = 50;
        const colWidths = { image: 50, product: 200, qty: 50, unitPrice: 80, discount: 80, total: 80 };
        const tableWidth = Object.values(colWidths).reduce((sum, w) => sum + w, 0);
        const rowHeight = 50;
        const headerHeight = 20;

        // Table Header
        const tableTop = doc.y;
        doc.fontSize(10).font('Helvetica-Bold');
        const headers = [
            { text: 'Image', x: tableLeft, width: colWidths.image, align: 'center' },
            { text: 'Product', x: tableLeft + colWidths.image, width: colWidths.product, align: 'left' },
            { text: 'Qty', x: tableLeft + colWidths.image + colWidths.product, width: colWidths.qty, align: 'right' },
            { text: 'Unit Price (Rs)', x: tableLeft + colWidths.image + colWidths.product + colWidths.qty, width: colWidths.unitPrice, align: 'right' },
            { text: 'Discount (Rs)', x: tableLeft + colWidths.image + colWidths.product + colWidths.qty + colWidths.unitPrice, width: colWidths.discount, align: 'right' },
            { text: 'Total (Rs)', x: tableLeft + colWidths.image + colWidths.product + colWidths.qty + colWidths.unitPrice + colWidths.discount, width: colWidths.total, align: 'right' }
        ];

        headers.forEach(header => {
            doc.text(header.text, header.x, tableTop, { width: header.width, align: header.align });
        });

        // Draw Table Header Grid
        doc.lineWidth(0.5);
        doc.rect(tableLeft, tableTop - 5, tableWidth, headerHeight).stroke();
        headers.forEach((header, i) => {
            if (i < headers.length - 1) {
                const x = header.x + header.width;
                doc.moveTo(x, tableTop - 5).lineTo(x, tableTop + headerHeight - 5).stroke();
            }
        });
        doc.moveTo(tableLeft, tableTop + headerHeight - 5).lineTo(tableLeft + tableWidth, tableTop + headerHeight - 5).stroke();

        // Table Rows
        doc.font('Helvetica');
        let currentY = tableTop + headerHeight;
        for (const item of order.items) {
            const originalPrice = (item.price + (item.discount || 0)).toFixed(2);
            const discount = (item.discount || 0).toFixed(2);
            const total = (item.price * item.quantity).toFixed(2);
            const rowTop = currentY;

            // Image (if available)
            if (item.productId && item.productId.images && item.productId.images.length > 0) {
                const imageUrl = item.productId.images[0].url;
                // console.log(`Fetching image: ${imageUrl}`); // Debug log
                try {
                    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                    if (response.status === 200) {
                        const imageBuffer = Buffer.from(response.data);
                        doc.image(imageBuffer, tableLeft + 5, rowTop + 5, { width: colWidths.image - 10, height: 40 });
                    } else {
                        console.error(`Failed to fetch image from ${imageUrl}: Status ${response.status}`);
                    }
                } catch (err) {
                    console.error(`Error fetching image from ${imageUrl}:`, err.message);
                }
            } else {
                console.log(`No image available for product: ${item.productId ? item.productId.name : 'Unknown'}`);
            }

            // Text Columns
            const rowData = [
                { text: '', x: tableLeft, width: colWidths.image, align: 'center' },
                { text: item.productId ? item.productId.name : 'Unknown Product', x: tableLeft + colWidths.image, width: colWidths.product, align: 'left' },
                { text: item.quantity.toString(), x: tableLeft + colWidths.image + colWidths.product, width: colWidths.qty, align: 'right' },
                { text: originalPrice, x: tableLeft + colWidths.image + colWidths.product + colWidths.qty, width: colWidths.unitPrice, align: 'right' },
                { text: discount, x: tableLeft + colWidths.image + colWidths.product + colWidths.qty + colWidths.unitPrice, width: colWidths.discount, align: 'right' },
                { text: total, x: tableLeft + colWidths.image + colWidths.product + colWidths.qty + colWidths.unitPrice + colWidths.discount, width: colWidths.total, align: 'right' }
            ];

            rowData.forEach(cell => {
                if (cell.text) {
                    doc.text(cell.text, cell.x + 5, rowTop + 15, { width: cell.width - 10, align: cell.align });
                }
            });

            // Draw Row Grid
            doc.rect(tableLeft, rowTop, tableWidth, rowHeight).stroke();
            headers.forEach((header, i) => {
                if (i < headers.length - 1) {
                    const x = header.x + header.width;
                    doc.moveTo(x, rowTop).lineTo(x, rowTop + rowHeight).stroke();
                }
            });
            doc.moveTo(tableLeft, rowTop + rowHeight).lineTo(tableLeft + tableWidth, rowTop + rowHeight).stroke();

            currentY += rowHeight;
            doc.y = currentY;
        }

        // Total Amount
        doc.moveDown(2);
        doc.font('Helvetica-Bold').fontSize(12).text(`Total Amount: Rs${order.totalAmount.toFixed(2)}`, 50, doc.y, { align: 'right' });

        // Footer
        doc.moveDown(2);
        doc.font('Helvetica').fontSize(10);
        doc.text('Thank you for shopping with WaveTunes!', 50, doc.y, { align: 'center', lineBreak: false });
        doc.text('For any queries, please contact us at support@wavetunes.com', 50, doc.y + 15, { align: 'center', lineBreak: false });

        // Finalize PDF
        doc.end();

    } catch (error) {
        console.error('Error generating invoice:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating invoice',
            error: error.message
        });
    }
};


// Cancel Order
const cancelOrder = async (req, res) => {
    const token = req.cookies.jwt;
    const orderId = req.params.id;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        const order = await Order.findOne({
            _id: orderId,
            userId: userId,
            status: { $in: ['pending', 'processing'] }
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found or cannot cancel'
            });
        }

        if (order.items && order.items.length > 0) {
            for (const item of order.items) {
                await Product.findByIdAndUpdate(
                    item.productId,
                    { $inc: { stock: item.quantity || 0 } },
                    { new: true }
                );
                item.status = 'cancelled';
            }
        }

        order.status = 'cancelled';
        if (order.paymentMethod !== 'COD') {
            order.refundStatus = 'full';
            await refundToWallet(
                userId,
                order.totalAmount,
                order._id,
                `Refund for cancelled order #${order.orderId}`
            );
        }

        await order.save();

        return res.status(200).json({
            success: true,
            message: 'Order cancelled successfully'
        });

    } catch (error) {
        console.error('Error cancelling order:', error);
        return res.status(500).json({
            success: false,
            message: 'Error cancelling order',
            error: error.message
        });
    }
};

// Cancel Specific Item
const cancelOrderItem = async (req, res) => {
    const token = req.cookies.jwt;
    const { orderId, itemId } = req.params;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        const order = await Order.findOne({
            _id: orderId,
            userId: userId,
            status: { $in: ['pending', 'processing'] }
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found or cannot be cancelled'
            });
        }

        const item = order.items.find(
            item => item._id.toString() === itemId || item.productId.toString() === itemId
        );

        if (!item || !['pending', 'processing'].includes(item.status)) {
            return res.status(404).json({
                success: false,
                message: 'Item not found or cannot be cancelled'
            });
        }

        await Product.findByIdAndUpdate(
            item.productId,
            { $inc: { stock: item.quantity || 0 } },
            { new: true }
        );

        const itemSubtotal = Number(item.price) * Number(item.quantity);
        let refundAmount;

        if (order.items.length === 1) {
            refundAmount = Number(order.totalAmount);
        } else if (order.discount > 0) {
            const totalSubtotal = order.items.reduce(
                (sum, i) => sum + (Number(i.price) * Number(i.quantity)),
                0
            );
            if (totalSubtotal === 0) {
                throw new Error('Invalid total subtotal for discount calculation');
            }
            const discountRatio = Number(order.discount) / totalSubtotal;
            refundAmount = itemSubtotal * (1 - discountRatio);
        } else {
            refundAmount = itemSubtotal;
        }

        refundAmount = Math.max(0, Number(refundAmount.toFixed(2)));

        item.status = 'cancelled';
        if (order.paymentMethod !== 'COD') {
            item.refunded = true;
            item.refundAmount = refundAmount;
            item.refundDate = new Date();
            await refundToWallet(
                userId,
                refundAmount,
                order._id,
                `Refund for cancelled item in order #${order.orderId}`
            );
        }

        const activeItems = order.items.filter(i => i.status !== 'cancelled');
        if (activeItems.length === 0) {
            order.status = 'cancelled';
            order.refundStatus = order.paymentMethod !== 'COD' ? 'full' : 'none';
            order.totalAmount = 0;
        } else {
            order.totalAmount = activeItems.reduce(
                (sum, i) => sum + (Number(i.price) * Number(i.quantity)),
                0
            );
            order.totalAmount += 10;
            order.totalAmount -= Number(order.discount || 0);
            order.totalAmount = Math.max(0, Number(order.totalAmount.toFixed(2)));
            order.refundStatus = order.paymentMethod !== 'COD' ? 'partial' : 'none';
        }

        await order.save();

        const updatedOrder = await Order.findById(order._id)
            .populate('addressId')
            .populate({
                path: 'items.productId',
                select: 'name price images'
            });

        return res.status(200).json({
            success: true,
            message: 'Item cancelled successfully',
            order: updatedOrder
        });
    } catch (error) {
        console.error('Error cancelling item:', error);
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token'
            });
        }
        return res.status(500).json({
            success: false,
            message: 'Error cancelling item',
            error: error.message
        });
    }
};

// Refund to Wallet
const refundToWallet = async (userId, amount, orderId, description) => {
    try {
        return await WalletService.addFunds(userId, amount, description, orderId);
    } catch (error) {
        console.error('Error refunding to wallet:', error);
        throw error;
    }
};

// Return Order
const returnOrder = async (req, res) => {
    const token = req.cookies.jwt;
    const orderId = req.params.id;
    const { reason } = req.body;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        const order = await Order.findOne({
            orderId: orderId,
            userId: userId,
            status: 'delivered'
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found or cannot be returned'
            });
        }

        const deliveryDate = new Date(order.updatedAt);
        const currentDate = new Date();
        const daysDifference = Math.floor((currentDate - deliveryDate) / (1000 * 60 * 60 * 24));

        if (daysDifference > 7) {
            return res.status(400).json({
                success: false,
                message: 'Return period expired'
            });
        }

        order.status = 'return_requested';
        order.returnReason = reason || 'Not specified';

        if (order.items && order.items.length > 0) {
            for (const item of order.items) {
                if (item.status === 'delivered') {
                    item.status = 'return_requested';
                    item.returnReason = reason || 'Not specified';
                }
            }
        }

        await order.save();

        return res.status(200).json({
            success: true,
            message: 'Return request submitted successfully'
        });
    } catch (error) {
        console.error('Error processing return:', error);
        return res.status(500).json({
            success: false,
            message: 'Error processing return',
            error: error.message
        });
    }
};

// Return Item in an Order
const returnOrderItem = async (req, res) => {
    const token = req.cookies.jwt;
    const { orderId, itemId } = req.params;
    const { reason } = req.body;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        const order = await Order.findOne({
            orderId: orderId,
            userId: userId,
            status: 'delivered'
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found or cannot be returned'
            });
        }

        const item = order.items.id(itemId);
        if (!item || item.status !== 'delivered') {
            return res.status(404).json({
                success: false,
                message: 'Item not found or not eligible for return'
            });
        }

        const deliveryDate = new Date(order.updatedAt);
        const currentDate = new Date();
        const daysDifference = Math.floor((currentDate - deliveryDate) / (1000 * 60 * 60 * 24));

        if (daysDifference > 7) {
            return res.status(400).json({
                success: false,
                message: 'Return period expired (7 days from delivery)'
            });
        }

        item.status = 'return_requested';
        item.returnReason = reason || 'Not specified';

        // Check if all items are either 'returned', 'return_requested', or 'cancelled'
        const allItemsProcessed = order.items.every(i =>
            i.status === 'returned' || i.status === 'cancelled' || i.status === 'return_requested'
        );

        // If all items are processed, set order status to 'return_requested'
        if (allItemsProcessed) {
            order.status = 'return_requested';
        }

        await order.save();

        return res.status(200).json({
            success: true,
            message: 'Item return request submitted successfully'
        });
    } catch (error) {
        console.error('Error processing item return:', error);
        return res.status(500).json({
            success: false,
            message: 'Error processing item return',
            error: error.message
        });
    }
};

// Admin Get Orders
const adminGetOrders = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const itemsPerPage = 10;
        const skip = (page - 1) * itemsPerPage;

        const search = req.query.search || '';
        const status = req.query.status || '';
        const dateFilter = req.query.dateFilter || '';

        let query = {};

        if (search) {
            // Find users with matching email
            const matchingUsers = await User.find({
                email: { $regex: search, $options: 'i' }
            }).select('_id');
            const userIds = matchingUsers.map(user => user._id);

            // Search by orderId or userId (from matching emails)
            query.$or = [
                { orderId: { $regex: search, $options: 'i' } },
                { userId: { $in: userIds } }
            ];
        }

        if (status) {
            query.status = status;
        }

        if (dateFilter) {
            const now = new Date();
            let startDate;

            if (dateFilter === 'today') {
                startDate = new Date(now.setHours(0, 0, 0, 0));
            } else if (dateFilter === 'week') {
                const day = now.getDay();
                const diff = now.getDate() - day + (day === 0 ? -6 : 1);
                startDate = new Date(now.setDate(diff));
                startDate.setHours(0, 0, 0, 0);
            } else if (dateFilter === 'month') {
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            }

            if (startDate) {
                query.date = { $gte: startDate };
            }
        }

        const totalCount = await Order.countDocuments(query);
        const totalPages = Math.ceil(totalCount / itemsPerPage);

        const orders = await Order.find(query)
            .populate('userId', 'fname email phone')
            .populate('items.productId', 'name price images')
            .sort({ date: -1 })
            .skip(skip)
            .limit(itemsPerPage);

        res.render('admin/orders', {
            orders,
            page,
            currentPage: 'orders',
            totalPages,
            itemsPerPage,
            totalCount,
            search,
            status,
            dateFilter,
            getStatusBadgeClass
        });
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).render('error', {
            message: 'Error fetching orders',
            error
        });
    }
};

// Get Specific Order Details for Admin
const adminGetOrderDetails = async (req, res) => {
    try {
        const orderId = req.params.id;

        const order = await Order.findById(orderId)
            .populate('userId', 'fname lname email phone')
            .populate('addressId')
            .populate('items.productId', 'name');

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        res.json({ success: true, order });
    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get Order Items for Admin
const adminGetOrderItems = async (req, res) => {
    try {
        const orderId = req.params.id;

        const order = await Order.findById(orderId)
            .populate('items.productId', 'name price images');

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        res.json({ success: true, items: order.items });
    } catch (error) {
        console.error('Error fetching order items:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Update Order Status by Admin
const adminUpdateOrderStatus = async (req, res) => {
    try {
        const orderId = req.params.id;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ success: false, message: 'Status is required' });
        }

        const validStatuses = [
            'pending', 'processing', 'shipped', 'delivered',
            'cancelled', 'return_requested', 'returned', 'payment_failed'
        ];

        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const order = await Order.findById(orderId);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // order.status = status;
    if(order.items && order.items.length>0){
        for(const item of order.items){
            if(item.status!=='cancelled'){
                if(status==='cancelled' && item.status !=='cancelled' ){
                    await Product.findByIdAndUpdate(
                        item.productId,
                        {$inc: {stock:item.quantity || 0}},
                        {new:true}
                    );
                }
            }
        }
    }

    const itemStatuses= order.items.map(item=>item.status);
    const uniqueStatuses = [...new Set(itemStatuses)];
    if (uniqueStatuses.length === 1) {
            // All items have the same status
            order.status = uniqueStatuses[0];
        } else if (uniqueStatuses.includes('cancelled') && uniqueStatuses.length === 2 && itemStatuses.every(s => s === 'cancelled' || s === status)) {
            // All items are either cancelled or the new status
            order.status = status;
        } else {
            // Mixed statuses, set order to 'processing' unless all cancelled
            order.status = itemStatuses.every(s => s === 'cancelled') ? 'cancelled' : 'processing';
        }

        await order.save();

        res.json({ success: true, order });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Helper function to get badge class based on status
function getStatusBadgeClass(status) {
    switch (status) {
        case 'pending':
            return 'bg-warning';
        case 'processing':
            return 'bg-info';
        case 'shipped':
            return 'bg-primary';
        case 'delivered':
            return 'bg-success';
        case 'cancelled':
            return 'bg-danger';
        case 'return_requested':
            return 'bg-secondary';
        case 'returned':
            return 'bg-dark';
        case 'payment_failed':
            return 'bg-danger';
        default:
            return 'bg-secondary';
    }
}

// Update Individual Order Item Status by Admin
const adminUpdateOrderItemStatus = async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const itemId = req.params.itemId;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ success: false, message: 'Status is required' });
        }

        const validStatuses = [
            'pending', 'processing', 'shipped', 'delivered',
            'cancelled', 'return_requested', 'returned', 'payment_failed'
        ];

        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const order = await Order.findById(orderId);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const itemIndex = order.items.findIndex(item =>
            item._id.toString() === itemId || itemId === String(order.items.indexOf(item))
        );

        if (itemIndex === -1) {
            return res.status(404).json({ success: false, message: 'Item not found in order' });
        }

        const previousItemStatus = order.items[itemIndex].status;
        order.items[itemIndex].status = status;

        const allItemsHaveSameStatus = order.items.every(item => item.status === status);
        if (allItemsHaveSameStatus) {
            order.status = status;
        }

        if (status === 'cancelled' && previousItemStatus !== 'cancelled') {
            await Product.findByIdAndUpdate(
                order.items[itemIndex].productId,
                { $inc: { stock: order.items[itemIndex].quantity || 0 } },
                { new: true }
            );
        }

        await order.save();

        res.json({ success: true, order });
    } catch (error) {
        console.error('Error updating item status:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get Return Requests for Admin
const getReturnRequests = async (req, res) => {
    try {
        const orders = await Order.find({
            $or: [
                { status: 'return_requested' },
                { 'items.status': 'return_requested' }
            ]
        })
            .populate('userId', 'fname lname email')
            .populate('items.productId', 'name price images');

        const returnRequests = [];
        for (const order of orders) {
            if (order.status === 'return_requested') {
                returnRequests.push({
                    order: order,
                    item: null
                });
            }
            for (const item of order.items) {
                if (item.status === 'return_requested') {
                    returnRequests.push({
                        order: order,
                        item: item
                    });
                }
            }
        }

        res.render('admin/returnRequests', {
            returnRequests,
            currentPage: 'return-requests'
        });
    } catch (error) {
        console.error('Error fetching return requests:', error);
        res.status(500).render('error', {
            message: 'Error fetching return requests',
            error
        });
    }
};

// Approve Return Request by Admin
const adminApproveReturn = async (req, res) => {
    const { orderId, itemId } = req.params;

    try {
        const order = await Order.findOne({ orderId }).populate('items.productId');
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        if (itemId) {
            const item = order.items.id(itemId);
            if (!item || item.status !== 'return_requested') {
                return res.status(404).json({
                    success: false,
                    message: 'Item not found or not pending return'
                });
            }

            const product = await Product.findById(item.productId);
            if (!product || !item.price) {
                return res.status(500).json({
                    success: false,
                    message: 'Invalid product price data'
                });
            }
            item.price = item.price || product.price;

            item.status = 'returned';

            if (!item.refunded && order.paymentMethod !== 'COD') {
                let refundAmount;
                const itemSubtotal = Number(item.price) * Number(item.quantity);

                if (order.items.length === 1) {
                    refundAmount = Number(order.totalAmount);
                } else if (order.discount > 0) {
                    const totalSubtotal = order.items.reduce((sum, i) => sum + (Number(i.price) * Number(i.quantity)), 0);
                    if (totalSubtotal === 0) {
                        return res.status(500).json({
                            success: false,
                            message: 'Invalid order subtotal'
                        });
                    }
                    const discountRatio = Number(order.discount) / totalSubtotal;
                    refundAmount = itemSubtotal * (1 - discountRatio);
                } else {
                    refundAmount = itemSubtotal;
                }

                refundAmount = Math.max(0, Number(refundAmount.toFixed(2)));
                item.refunded = true;
                item.refundAmount = refundAmount;
                item.refundDate = new Date();

                await refundToWallet(
                    order.userId,
                    refundAmount,
                    order._id,
                    `Refund for returned item in order #${order.orderId}`
                );

                await Product.findByIdAndUpdate(
                    item.productId,
                    { $inc: { stock: item.quantity || 0 } },
                    { new: true }
                );
            }

            // Check if all items are returned or cancelled
            const allItemsProcessed = order.items.every(i => i.status === 'returned' || i.status === 'cancelled');
            if (allItemsProcessed) {
                order.status = 'returned';
                order.refundStatus = order.paymentMethod !== 'COD' ? 'full' : 'none';
            } else {
                order.refundStatus = order.paymentMethod !== 'COD' ? 'partial' : 'none';
            }
        } else {
            if (order.status !== 'return_requested') {
                return res.status(400).json({
                    success: false,
                    message: 'Order is not pending return'
                });
            }

            order.status = 'returned';
            let totalRefund = 0;

            for (const item of order.items) {
                if (item.status === 'return_requested' && !item.refunded && order.paymentMethod !== 'COD') {
                    const product = await Product.findById(item.productId);
                    if (!product || !item.price) {
                        console.error(`Invalid price data for item ${item._id} in order ${orderId}`);
                        continue;
                    }
                    item.price = item.price || product.price;

                    item.status = 'returned';
                    const itemRefund = Number(item.price) * Number(item.quantity);
                    totalRefund += itemRefund;

                    item.refunded = true;
                    item.refundAmount = itemRefund;
                    item.refundDate = new Date();

                    await Product.findByIdAndUpdate(
                        item.productId,
                        { $inc: { stock: item.quantity || 0 } },
                        { new: true }
                    );
                }
            }

            if (totalRefund > 0 && order.paymentMethod !== 'COD') {
                totalRefund = Math.max(0, Number(totalRefund.toFixed(2)));
                await refundToWallet(
                    order.userId,
                    totalRefund,
                    order._id,
                    `Refund for returned order #${order.orderId}`
                );
                order.refundStatus = 'full';
            }
        }

        await order.save();

        return res.status(200).json({
            success: true,
            message: 'Return approved and refund processed',
            order
        });
    } catch (error) {
        console.error('Error approving return:', error);
        return res.status(500).json({
            success: false,
            message: 'Error approving return',
            error: error.message
        });
    }
};

module.exports = {
    loadCheckout,
    processWalletPayment,
    placeOrder,
    razorpayOrder,
    initiateRazorpayOrder,
    verifyRazorpay,
    retryRazorpayPayment,
    generateInvoice,
    applyCoupon,
    loadMyOrders,
    loadOrderDetails,
    cancelOrder,
    cancelOrderItem,
    returnOrder,
    returnOrderItem,
    getReturnRequests,
    adminApproveReturn,
    adminGetOrders,
    adminGetOrderItems,
    adminGetOrderDetails,
    adminUpdateOrderStatus,
    adminUpdateOrderItemStatus
};