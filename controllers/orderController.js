const User = require('../model/userModel');
const Product = require('../model/productModel');
const Address = require('../model/addressModel');
const Cart = require('../model/cartModel');
const Order = require('../model/orderModel');
const Coupon = require('../model/couponsModel');
const jwt = require('jsonwebtoken');
const { instance } = require('../config/razorpay')
const crypto = require('crypto');
const WalletService = require('./walletService');


//Load Checkout
const loadCheckout = async (req, res) => {
    const token = req.cookies.jwt;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        // Fetch user addresses
        let addresses = await Address.find({ userId }).sort({ isDefault: -1 });

        // Fetch cart with populated products
        let cart = await Cart.findOne({ user: userId }).populate({
            path: 'items.product',
            select: 'name price offerPercentage images stock'
        });

        if (!cart || !cart.items || cart.items.length === 0) {
            return res.redirect('/user/cart');
        }

        // Calculate totals using discounted prices
        cart.subtotal = cart.items.reduce((sum, item) => {
            const price = item.product.offerPercentage > 0
                ? item.product.price * (1 - item.product.offerPercentage / 100)
                : item.product.price;
            return sum + (price * item.quantity);
        }, 0);

        cart.shipping = cart.subtotal > 0 ? 10 : 0;
        cart.tax = 0; // 0% tax as per current logic
        cart.total = cart.subtotal + cart.shipping + cart.tax;

        // Fetch active coupons
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

        // Find user's cart
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

        // Calculate original and discounted subtotal
        const originalSubtotal = cart.items.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
        const discountedSubtotal = cart.items.reduce((sum, item) => {
            const price = item.product.offerPercentage > 0
                ? item.product.price * (1 - item.product.offerPercentage / 100)
                : item.product.price;
            return sum + (price * item.quantity);
        }, 0);
        const offerDiscount = originalSubtotal - discountedSubtotal;
        const shipping = discountedSubtotal > 0 ? 10 : 0;
        const tax = 0;

        let couponDiscount = 0;
        let coupon = null;
        let discountType = 'offer';

        if (couponCode) {
            // Find the coupon
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

            // Check minimum purchase requirement
            if (discountedSubtotal < coupon.minimumPurchase) {
                return res.status(400).json({
                    success: false,
                    message: `Minimum purchase of ₹${coupon.minimumPurchase} required for this coupon`
                });
            }

            // Check if coupon has reached max uses
            if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
                return res.status(400).json({
                    success: false,
                    message: 'Coupon has reached maximum usage limit'
                });
            }

            // Calculate coupon discount on original subtotal
            if (coupon.discountType === 'percentage') {
                couponDiscount = (originalSubtotal * coupon.discountAmount) / 100;
                if (coupon.maxDiscount && couponDiscount > coupon.maxDiscount) {
                    couponDiscount = coupon.maxDiscount;
                }
            } else {
                couponDiscount = coupon.discountAmount;
            }
        }

        // Compare discounts
        let discount = offerDiscount;
        if (couponDiscount > offerDiscount) {
            discount = couponDiscount;
            discountType = 'coupon';
        }

        const total = discountedSubtotal + shipping + tax - (discountType === 'coupon' ? couponDiscount : 0);

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
            subtotal: discountedSubtotal,
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



//Place Order
const placeOrder = async (req, res) => {
    const token = req.cookies.jwt;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;
        const { addressId, paymentMethod, couponCode, discountType } = req.body;

        const cart = await Cart.findOne({ user: userId }).populate('items.product');
        if (!cart || !cart.items.length) {
            return res.status(400).json({ success: false, message: 'Cart is empty' });
        }

        const address = await Address.findById(addressId);
        if (!address) {
            return res.status(400).json({ success: false, message: 'Invalid address' });
        }

        // Log cart items to debug product data
        // console.log('Cart items for order:', JSON.stringify(cart.items.map(item => ({
        //     productId: item.product._id,
        //     name: item.product.name,
        //     price: item.product.price,
        //     offerPercentage: item.product.offerPercentage,
        //     offerEndDate: item.product.offerEndDate,
        //     quantity: item.quantity
        // })), null, 2));

        let discount = 0;
        if (couponCode && discountType === 'coupon') {
            const coupon = await Coupon.findOne({ code: couponCode, isActive: true });
            if (coupon) {
                discount = calculateCouponDiscount(cart, coupon);
            }
        }

        const currentDate = new Date();
        const orderItems = cart.items.map(item => {
            // Ensure product has price
            const originalPrice = item.product.price || 0;
            let offerPercentage = item.product.offerPercentage || 0;
            const offerEndDate = item.product.offerEndDate;

            // Check if offer is active (offerEndDate is null or in the future)
            if (offerEndDate && new Date(offerEndDate) < currentDate) {
                offerPercentage = 0; // Offer expired
            }

            // Calculate discounted price and discount amount
            const discountedPrice = offerPercentage > 0
                ? originalPrice * (1 - offerPercentage / 100)
                : originalPrice;
            const discountAmount = originalPrice - discountedPrice;

            return {
                productId: item.product._id,
                quantity: item.quantity,
                price: discountedPrice,
                discount: discountAmount,
                status: 'pending',
                refunded: false,
                refundAmount: 0
            };
        });

        // Log order items to verify
        console.log('Order items created:', JSON.stringify(orderItems.map(item => ({
            productId: item.productId,
            price: item.price,
            discount: item.discount,
            quantity: item.quantity
        })), null, 2));

        const subtotal = orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const shipping = subtotal > 0 ? 10 : 0;
        const tax = 0;
        const totalAmount = subtotal + shipping + tax - discount;

        const order = new Order({
            user: userId,
            orderId: `ORD-${Date.now()}`,
            items: orderItems,
            address: address._id,
            paymentMethod,
            subtotal,
            shipping,
            tax,
            totalAmount,
            discount,
            status: 'pending',
            date: new Date(),
            refundStatus: 'none'
        });

        await order.save();
        await Cart.findOneAndUpdate({ user: userId }, { items: [], subtotal: 0, shipping: 0, tax: 0, total: 0 });

        res.redirect(`/user/order/confirmation/${order._id}`);
    } catch (error) {
        console.error('Error placing order:', error);
        res.status(500).json({ success: false, message: 'Error placing order' });
    }
};
//Wallet Payment Method
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

        // Calculate totals
        let subtotal = 0;
        let originalSubtotal = 0;
        const orderItems = cart.items.map(item => {
            if (!item.product || !item.product.price) {
                throw new Error(`Invalid product data for item ${item._id}`);
            }
            const originalPrice = Number(item.product.price);
            const discountedPrice = item.product.offerPercentage > 0
                ? originalPrice * (1 - item.product.offerPercentage / 100)
                : originalPrice;
            const quantity = Number(item.quantity);

            originalSubtotal += originalPrice * quantity;
            subtotal += discountedPrice * quantity;

            return {
                productId: item.product._id,
                name: item.product.name,
                price: discountedPrice,
                originalPrice: originalPrice,
                offerPercentage: item.product.offerPercentage || 0,
                quantity: quantity,
                discountApplied: item.product.offerPercentage > 0 ? 'offer' : 'none',
                image: item.product.images && item.product.images.length > 0 ? item.product.images[0] : null,
                status: 'processing'
            };
        });

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

        // Validate amount
        if (Math.abs(total - amount) > 0.01) {
            return res.status(400).json({
                success: false,
                message: 'Invalid order amount'
            });
        }

        // Check wallet balance
        const wallet = await WalletService.getWallet(userId);
        if (wallet.balance < total) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient wallet balance'
            });
        }

        // Decrement stock
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

        // Generate a unique order ID
        const generateOrderId = () => {
            return `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        };

        // Create order
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

        // Deduct funds from wallet
        await WalletService.deductFunds(
            userId,
            total,
            `Payment for order ${order.orderId}`,
            order._id
        );

        // Clear cart
        await Cart.findOneAndDelete({ user: userId });

        // Fetch complete order details for rendering
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

//RazorPay order
const razorpayOrder = async (req, res) => {
    try {
        const amount = req.body.amount * 100;

        const options = {
            amount: amount,
            currency: 'INR',
            receipit: 'receipt_order_' + Date.now()
        };

        const order = await instance.orders.create(options);
        res.json({
            success: true,
            order
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: 'Error creating razorpay order'
        });
    }
}


//Initiate razorpay payment
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

        let subtotal = 0;
        let originalSubtotal = 0;
        cart.items.forEach(item => {
            const originalPrice = Number(item.product.price);
            const discountedPrice = item.product.offerPercentage > 0
                ? originalPrice * (1 - item.product.offerPercentage / 100)
                : originalPrice;
            const quantity = Number(item.quantity);

            originalSubtotal += originalPrice * quantity;
            subtotal += discountedPrice * quantity;
        });

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

        const amount = Math.round(total * 100);
        const options = {
            amount: amount,
            currency: 'INR',
            receipt: `order_receipt_${Date.now()}`,
            notes: {
                userId: user._id.toString(),
                addressId: addressId,
                couponCode: couponCode || '',
                discountType: discountType || 'offer'
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
            }
        });

    } catch (error) {
        console.error('Error creating Razorpay order:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating Razorpay order',
            error: error.message
        });
    }
};

//Razorpay verification
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

        const razorpayOrder = await instance.orders.fetch(razorpay_order_id);
        const userId = razorpayOrder.notes.userId;
        const addressId = razorpayOrder.notes.addressId;
        const couponCode = razorpayOrder.notes.couponCode;

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

        let subtotal = 0;
        let originalSubtotal = 0;
        const orderItems = cart.items.map(item => {
            const originalPrice = Number(item.product.price);
            const discountedPrice = item.product.offerPercentage > 0
                ? originalPrice * (1 - item.product.offerPercentage / 100)
                : originalPrice;
            const quantity = Number(item.quantity);

            originalSubtotal += originalPrice * quantity;
            subtotal += discountedPrice * quantity;

            return {
                productId: item.product._id,
                name: item.product.name,
                price: discountedPrice,
                originalPrice: originalPrice,
                offerPercentage: item.product.offerPercentage || 0,
                quantity: quantity,
                discountApplied: item.product.offerPercentage > 0 ? 'offer' : 'none',
                // image: item.product.images && item.images.length > 0 ? item.product.images[0] : null,
                status: 'processing'
            };
        });

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
                await Coupon.findByIdAndUpdate(coupon._id, { $inc: { usedCount: 1 } });
            }
        } else {
            discount = originalSubtotal - subtotal;
        }

        const total = subtotal + shipping + tax - (discountType === 'coupon' ? discount : 0);

        // Decrement stock
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

        const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

        const order = new Order({
            orderId,
            userId,
            totalAmount: total,
            addressId,
            items: orderItems,
            paymentMethod: 'Razorpay',
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
        console.error('Error verifying Razorpay payment:', error);
        return res.status(500).json({
            success: false,
            message: 'Error verifying payment',
            error: error.message
        });
    }
};

//Load the orders
const loadMyOrders = async (req, res) => {
    const token = req.cookies.jwt;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        //PAgination
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
        const skip = (page - 1) * limit;

        //Filter
        const status = req.query.status || '';
        const search = req.query.search || '';
        const sortOrder = req.query.sort || 'desc';


        // Build query
        let query = { userId: userId };

        // Add status filter if provided
        if (status) {
            query.status = status;
        }

        // Add search filter if provided (search in orderId)
        if (search) {
            query.orderId = { $regex: search, $options: 'i' };
        }

        const sortOptions = sortOrder === 'asc' ? { date: 1 } : { date: -1 };

        // Count total orders for pagination
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

        let processedOrders = [];
        if (orders && orders.length > 0) {
            processedOrders = orders.map(order => {
                return {
                    _id: order._id,
                    orderId: order.orderId,
                    date: order.date,
                    status: order.status,
                    totalAmount: order.totalAmount,
                    paymentMethod: order.paymentMethod,
                    items: order.items ? order.items.map(item => ({
                        productId: item.productId || null,
                        quantity: item.quantity || 0
                    })) : [],
                    shippingAddress: order.addressId || {}
                };
            });
        }

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
        console.log('Error loading orders:', error);
        res.redirect('/');
    }
}


//Load order details
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

        // For the cancel order functionality
        const canCancel = order.status !== 'delivered' && order.status !== 'cancelled' && order.status !== 'returned' &&
        order.items.some(item => item.status !== 'delivered' && item.status !== 'cancelled' && item.status !== 'returned');

        //log order for check
        // console.log(order);

        res.render('user/orderDetails', {
            order,
            address: order.addressId,
            canCancel
        });

    } catch (error) {
        console.log('Error loading order details:', error);
        res.redirect('/user/orders');
    }
};


//Cancel Order
const cancelOrder = async (req, res) => {
    const token = req.cookies.jwt;
    const orderId = req.params.id;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;


        const order = await Order.findOne(
            {
                _id: orderId,
                userId: userId,
                status: { $in: ['pending', 'processing'] }
            }
        );

        if (!order) {

            return res.status(404).json({
                success: fasle,
                message: 'Order not found or cannot cancel'
            });
        }

        if (order.items && order.items.length > 0) {
            for (const item of order.items) {
                // Find the product and update its stock
                await Product.findByIdAndUpdate(
                    item.productId,
                    { $inc: { stock: item.quantity || 0 } },
                    { new: true }
                );
                item.status = 'cancelled';

                if (order.paymentMethod !== 'COD') {
                    item.refunded = true;
                    item.refundAmount = item.price * item.quantity;
                    item.refundDate = new Date();
                }

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
        console.log('Error cancelling order:', error);
        return res.status(500).json({
            success: false,
            message: 'Error cancelling order',
            error: error.message
        });
    }
}


//Cancel specific item
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

        // console.log('Canceling item:', JSON.stringify(item, null, 2));
        // console.log('Order discount:', order.discount);

        // Validate price and quantity
        if (!item.price || item.price <= 0 || !item.quantity || item.quantity <= 0) {
            throw new Error(`Invalid price or quantity for item ${item._id}`);
        }

        // Restore product stock
        await Product.findByIdAndUpdate(
            item.productId,
            { $inc: { stock: item.quantity || 0 } },
            { new: true }
        );

        // Calculate refund amount
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
            // console.log('Discount calculation:', { totalSubtotal, discount: order.discount, discountRatio, refundAmount });
        } else {
            refundAmount = itemSubtotal;
            // console.log('No discount applied, refundAmount equals itemSubtotal:', refundAmount);
        }

        refundAmount = Math.max(0, Number(refundAmount.toFixed(2)));
        // console.log('Final refund amount:', refundAmount, 'for item subtotal:', itemSubtotal);

        // Update item status and refund details
        item.status = 'cancelled';
        if (order.paymentMethod !== 'COD') {
            item.refunded = true;
            item.refundAmount = refundAmount;
            item.refundDate = new Date();

            try {
                await refundToWallet(
                    userId,
                    refundAmount,
                    order._id,
                    `Refund for cancelled item in order #${order.orderId}`
                );
                // console.log('Refund processed to wallet:', refundAmount);
            } catch (walletError) {
                // console.error('Wallet refund failed:', walletError);
                throw new Error('Failed to process refund to wallet');
            }
        }

        // Update order total and status
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
            order.totalAmount += 10; // Add shipping
            order.totalAmount -= Number(order.discount || 0); // Reapply discount
            order.totalAmount = Math.max(0, Number(order.totalAmount.toFixed(2)));
            order.refundStatus = order.paymentMethod !== 'COD' ? 'partial' : 'none';
        }

        // console.log('Updated order totalAmount:', order.totalAmount, 'refundStatus:', order.refundStatus);

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

//Refund to wallet
const refundToWallet = async (userId, amount, orderId, descrioption) => {
    try {
        return await WalletService.addFunds(userId, amount, descrioption, orderId);
    } catch (error) {
        console.log('Error refunding to wallet:', error);
        throw error;
    }
}


//Return order
const returnOrder = async (req, res) => {
    const token = req.cookies.jwt;
    const orderId = req.params.id;
    const { reason } = req.body;

    // console.log(`Received returnOrder request for orderId: ${orderId}`);

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;
        // console.log(`UserId from JWT: ${userId}`); 

        const order = await Order.findOne({
            orderId: orderId,
            userId: userId,
            status: 'delivered'
        });

        // console.log(`Order query result: ${JSON.stringify(order)}`); 

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
        console.log('Error processing return:', error);
        return res.status(500).json({
            success: false,
            message: 'Error processing return',
            error: error.message
        });
    }
}


//Return item in an order
const returnOrderItem = async (req, res) => {
    const token = req.cookies.jwt;
    const { orderId, itemId } = req.params;
    const { reason } = req.body;

    // console.log(`Received returnOrderItem request for orderId: ${orderId}, itemId: ${itemId}`);

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;
        // console.log(`UserId from JWT: ${userId}`); 

        const order = await Order.findOne({
            orderId: orderId,
            userId: userId,
            status: 'delivered'
        });

        // console.log(`Order query result: ${JSON.stringify(order)}`);

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
}

//Admin get orders
const adminGetOrders = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const itemsPerPage = 5;
        const skip = (page - 1) * itemsPerPage;

        // Get search, status, and date filter parameters
        const search = req.query.search || '';
        const status = req.query.status || '';
        const dateFilter = req.query.dateFilter || '';

        // Build query object
        let query = {};

        // Apply search filter
        if (search) {
            query.$or = [
                { orderId: { $regex: search, $options: 'i' } }
            ];
        }

        // Apply status filter
        if (status) {
            query.status = status;
        }

        // Apply date filter
        if (dateFilter) {
            const now = new Date();
            let startDate;

            if (dateFilter === 'today') {
                startDate = new Date(now.setHours(0, 0, 0, 0));
            } else if (dateFilter === 'week') {
                const day = now.getDay();
                const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
                startDate = new Date(now.setDate(diff));
                startDate.setHours(0, 0, 0, 0);
            } else if (dateFilter === 'month') {
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            }

            if (startDate) {
                query.date = { $gte: startDate };
            }
        }

        // Get total count for pagination
        const totalCount = await Order.countDocuments(query);
        const totalPages = Math.ceil(totalCount / itemsPerPage);

        // Get orders with pagination and populate necessary fields
        const orders = await Order.find(query)
            .populate('userId', 'name email phone')
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

// Get specific order details for admin
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

// Get order items for admin
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

// Update order status by admin
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

        const order = await Order.findByIdAndUpdate(orderId,);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        order.status = status;
        if (order.items && order.items.length > 0) {
            order.items.forEach(item => {
                item.status = status;
            });
            // Additional logic for specific status changes
            if (status === 'cancelled' && order.status !== 'cancelled') {
                // Return items to inventory
                if (order.items && order.items.length > 0) {
                    for (const item of order.items) {
                        await Product.findByIdAndUpdate(
                            item.productId,
                            { $inc: { stock: item.quantity || 0 } },
                            { new: true }
                        );
                    }
                }
            }
        }

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

// Update individual order item status by admin
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

        // Find the order
        const order = await Order.findById(orderId);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Find the specific item in the order
        const itemIndex = order.items.findIndex(item =>
            item._id.toString() === itemId || itemId === String(order.items.indexOf(item))
        );

        if (itemIndex === -1) {
            return res.status(404).json({ success: false, message: 'Item not found in order' });
        }

        // Update the specific item's status
        const previousItemStatus = order.items[itemIndex].status;
        order.items[itemIndex].status = status;

        // If all items have the same status, update the overall order status
        const allItemsHaveSameStatus = order.items.every(item => item.status === status);
        if (allItemsHaveSameStatus) {
            order.status = status;
        }

        // Handle inventory adjustments for cancelled items
        if (status === 'cancelled' && previousItemStatus !== 'cancelled') {
            // Return item to inventory
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

//Get return requests for admin
const getReturnRequests = async (req, res) => {
    try {
        // Find orders with return_requested status or items with return_requested status
        const orders = await Order.find({
            $or: [
                { status: 'return_requested' },
                { 'items.status': 'return_requested' }
            ]
        })
            .populate('userId', 'fname lname email')
            .populate('items.productId', 'name price images');

        // Process orders to create a flat list of return requests
        const returnRequests = [];
        for (const order of orders) {
            // Full order return
            if (order.status === 'return_requested') {
                returnRequests.push({
                    order: order,
                    item: null
                });
            }
            // Individual item returns
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


//Approve return request by admin
const adminApproveReturn = async (req, res) => {
    const { orderId, itemId } = req.params;

    try {
        const order = await Order.findOne({ orderId: orderId }).populate('items.productId');

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        if (itemId) {
            // Approve return for a single item
            const item = order.items.id(itemId);
            if (!item || item.status !== 'return_requested') {
                return res.status(404).json({
                    success: false,
                    message: 'Item not found or not pending return'
                });
            }

            // Validate item price
            const product = await Product.findById(item.productId);
            if (!product || !item.price) {
                // console.error(`Invalid price data for item ${itemId} in order ${orderId}`);
                return res.status(500).json({
                    success: false,
                    message: 'Invalid product price data'
                });
            }
            item.price = item.price || product.price; // Fallback to product price if item.price is missing

            item.status = 'returned';

            if (!item.refunded && order.paymentMethod !== 'COD') {
                let refundAmount;
                const itemSubtotal = Number(item.price) * Number(item.quantity);
                // console.log(`Item Subtotal: ${itemSubtotal}, Price: ${item.price}, Quantity: ${item.quantity}`);

                if (order.items.length === 1) {
                    refundAmount = Number(order.totalAmount);
                } else if (order.discount > 0) {
                    const totalSubtotal = order.items.reduce((sum, i) => sum + (Number(i.price) * Number(i.quantity)), 0);
                    if (totalSubtotal === 0) {
                        // console.error(`Total subtotal is zero for order ${orderId}`);
                        return res.status(500).json({
                            success: false,
                            message: 'Invalid order subtotal'
                        });
                    }
                    const discountRatio = Number(order.discount) / totalSubtotal;
                    refundAmount = itemSubtotal * (1 - discountRatio);
                    // console.log(`Discount Ratio: ${discountRatio}, Refund Amount: ${refundAmount}`);
                } else {
                    refundAmount = itemSubtotal;
                }

                refundAmount = Math.max(0, Number(refundAmount.toFixed(2)));
                item.refunded = true;
                item.refundAmount = refundAmount;
                item.refundDate = new Date();

                // console.log(`Refunding ${refundAmount} for returned item ${itemId} in order #${order.orderId}`);
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

            // Update order refund status
            const allItemsReturned = order.items.every(i => i.status === 'returned' || i.status === 'cancelled');
            order.refundStatus = allItemsReturned ? 'full' : 'partial';
        } else {
            // Approve return for entire order
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
                    // Validate item price
                    const product = await Product.findById(item.productId);
                    if (!product || !item.price) {
                        console.error(`Invalid price data for item ${item._id} in order ${orderId}`);
                        continue; // Skip invalid items
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
                // Use calculated totalRefund instead of adjusting with prior refunds
                totalRefund = Math.max(0, Number(totalRefund.toFixed(2)));
                // console.log(`Refunding ${totalRefund} for returned order #${order.orderId}`);
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
}

module.exports = {
    loadCheckout,
    processWalletPayment,
    placeOrder,
    razorpayOrder,
    initiateRazorpayOrder,
    verifyRazorpay,
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
}