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

        let addresses = await Address.find({ userId: userId }).sort({ isDefault: -1 });

        let cart = await Cart.findOne({ user: userId }).populate({
            path: 'items.product',
            select: 'name price images stock'
        });

        if (!cart || !cart.items || cart.items.length === 0) {
            return res.redirect('/user/cart');
        }

        cart.subtotal = cart.items.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
        cart.shipping = cart.subtotal > 0 ? 10 : 0;
        cart.tax = cart.subtotal * 0.00;
        cart.total = cart.subtotal + cart.shipping + cart.tax;

        const currentDate = new Date();
        const coupons = await Coupon.find({
            isActive: true,
            startDate: { $lte: currentDate },
            endDate: { $gte: currentDate },
            minimumPurchase: { $lte: cart.subtotal }
        })

        const user = await User.findById(userId);
        res.render('user/checkout', { cart, user, addresses, coupons });

    } catch (error) {
        console.log('Something went wrong.', error);
        // res.redirect('/us');
    }
}


// Apply Coupon
const applyCoupon = async (req, res) => {
    const token = req.cookies.jwt;
    const { couponCode } = req.body;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        // Find the coupon
        const coupon = await Coupon.findOne({
            code: couponCode,
            isActive: true,
            startDate: { $lte: new Date() },
            endDate: { $gte: new Date() }
        });

        if (!coupon) {
            return res.status(404).json({
                success: false,
                message: "Coupon not found or expired"
            });
        }

        // Find user's cart
        const cart = await Cart.findOne({ user: userId }).populate({
            path: 'items.product',
            select: 'name price images stock'
        });
        if (!cart) {
            return res.status(404).json({
                success: false,
                message: "Cart not found"
            });
        }

        // Calculate cart subtotal
        const subtotal = cart.items.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
        const shipping = subtotal > 0 ? 10 : 0;
        const tax = subtotal * 0.00;

        // Check minimum purchase requirement
        if (subtotal < coupon.minimumPurchase) {
            return res.status(400).json({
                success: false,
                message: `Minimum purchase of ₹${coupon.minimumPurchase} required for this coupon`
            });
        }

        // Check if coupon has reached max uses
        if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
            return res.status(400).json({
                success: false,
                message: "Coupon has reached maximum usage limit"
            });
        }

        let discount = 0;
        if (coupon.discountType === 'percentage') {
            discount = (subtotal * coupon.discountAmount) / 100;
            if (coupon.maxDiscount && discount > coupon.maxDiscount) {
                discount = coupon.maxDiscount;
            }
        } else {
            discount = coupon.discountAmount;
        }

        const total = subtotal + shipping + tax - discount;

        return res.status(200).json({
            success: true,
            message: "Coupon applied",
            coupon: {
                code: coupon.code,
                discountType: coupon.discountType,
                discountAmount: coupon.discountAmount,
                maxDiscount: coupon.maxDiscount
            },
            discount,
            total,
            subtotal,
            shipping,
            tax
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
    const { addressId, paymentMethod, couponCode } = req.body;
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
            select: 'name price images stock'
        });

        let totalAmount = 0;
        const orderItems = cart.items
            .filter(item => item.product)
            .map(item => {
                const product = item.product;
                const price = Number(product.price);
                const quantity = Number(item.quantity);

                const itemTotal = price * quantity;
                totalAmount += itemTotal;
                return {
                    productId: product._id,
                    name: product.name,
                    price: price,
                    quantity: quantity,
                    image: product.images && product.images.length > 0 ? product.images[0] : null, // Use the first image or null
                    status: 'pending'
                };
            });
        const validPaymentMethods = { "cod": "COD", "credit card": "Credit Card", "paypal": "Paypal" };
        const selectedPaymentMethod = validPaymentMethods[paymentMethod.toLowerCase()];
        if (!selectedPaymentMethod) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment method selected"
            });
        }

        let discount = 0;
        let coupon = null;
        if (couponCode) {
            coupon = await Coupon.findOne({
                code: couponCode,
                isActive: true,
                startDate: { $lte: new Date() },
                endDate: { $gte: new Date() }
            });

            if (coupon) {
                if (totalAmount >= coupon.minimumPurchase && (coupon.maxUses === 0 || coupon.usedCount < coupon.maxUses)) {
                    if (coupon.discountType === 'percentage') {
                        discount = (totalAmount * coupon.discountAmount) / 100;
                        if (coupon.maxDiscount && discount > coupon.maxDiscount) {
                            discount = coupon.maxDiscount;
                        }
                    } else {
                        discount = coupon.discountAmount;
                    }
                    await Coupon.findByIdAndUpdate(coupon._id, { $inc: { usedCount: 1 } });
                } else {
                    coupon = null; // Ignore invalid coupon
                }
            }
        }

        totalAmount += 10 + (totalAmount * 0.00) - (discount || 0);

        const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

        const newOrder = new Order({
            orderId,
            userId: user._id,
            addressId: address._id,
            items: orderItems,
            status: 'pending',
            totalAmount,
            paymentMethod: selectedPaymentMethod,
            date: new Date(),
            coupon: coupon ? { code: coupon.code, discountType: coupon.discountType, discountAmount: coupon.discountAmount, maxDiscount: coupon.maxDiscount } : null,
            discount: discount || 0
        });

        const savedOrder = await newOrder.save();
        await Cart.findOneAndDelete({ user: user._id });

        const completeOrder = await Order.findById(savedOrder._id)
            .populate('addressId')
            .populate({
                path: 'items.productId',
                select: 'name price images'
            });

        return res.render('user/orderConfirm', {
            order: completeOrder,
            user,
            address
        });

    } catch (error) {
        console.error('Error placing order:', error);
        return res.status(500).json({
            success: false,
            message: 'Error placing order',
            error: error.message
        });
    }
}
const processWalletPayment = async (req, res) => {
    const { addressId, couponCode, amount } = req.body;
    const token = req.cookies.jwt;

    try {
        // Verify user
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Fetch and validate address
        const address = await Address.findOne({ _id: addressId, userId });
        if (!address) {
            return res.status(400).json({
                success: false,
                message: 'Invalid address selected'
            });
        }

        // Get cart
        const cart = await Cart.findOne({ user: userId }).populate('items.product');
        if (!cart || !cart.items.length) {
            return res.status(400).json({
                success: false,
                message: 'Cart is empty'
            });
        }

        // Calculate totals
        let subtotal = 0;
        cart.items.forEach(item => {
            if (!item.product || !item.product.price) {
                throw new Error(`Invalid product data for item ${item._id}`);
            }
            subtotal += item.product.price * item.quantity;
        });
        const shipping = cart.shipping || 0;
        const tax = cart.tax || 0;
        let discount = 0;

        // Apply coupon if provided
        if (couponCode) {
            const coupon = await Coupon.findOne({ code: couponCode, isActive: true });
            if (!coupon) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid or inactive coupon'
                });
            }

            if (coupon.discountType === 'percentage') {
                discount = (subtotal * coupon.discountAmount) / 100;
                if (coupon.maxDiscount && discount > coupon.maxDiscount) {
                    discount = coupon.maxDiscount;
                }
            } else {
                discount = coupon.discountAmount;
            }

            if (discount > subtotal) {
                discount = subtotal;
            }
        }

        const total = subtotal + shipping + tax - discount;

        // Validate amount matches
        // if (Math.abs(total - amount) > 0.01) {
        //     return res.status(400).json({
        //         success: false,
        //         message: 'Order total mismatch'
        //     });
        // }

        // Check wallet balance
        const wallet = await WalletService.getWallet(userId);
        if (wallet.balance < total) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient wallet balance'
            });
        }

        // Deduct funds from wallet
        await WalletService.deductFunds(
            userId,
            total,
            `Payment for order`,
            null // No orderId yet, will be updated after order creation
        );

        // Create order items
        const orderItems = cart.items.map(item => {
            if (!item.product || !item.product._id) {
                throw new Error(`Invalid product ID for item ${item._id}`);
            }
            return {
                productId: item.product._id, // Use productId as per schema
                quantity: item.quantity,
                price: item.product.price,
                status: 'pending'
            };
        });

        // Generate a unique order ID
        const generateOrderId = () => {
            return 'ORD' + Math.random().toString(36).substr(2, 9).toUpperCase();
        };

        // Create order
        const order = new Order({
            orderId: generateOrderId(),
            userId,
            totalAmount: total, 
            addressId, // Use addressId as per schema
            items: orderItems,
            paymentMethod: 'Wallet',
            subtotal,
            shipping,
            tax,
            discount,
            status: 'pending',
            couponCode: couponCode || null
        });

        // Log order for debugging
        // console.log('Order to be saved:', JSON.stringify(order, null, 2));

        await order.save();

        // Update wallet transaction with orderId
        // await WalletService.updateTransactionOrderId(userId, total, order._id);

        // Clear cart
        await Cart.findOneAndUpdate(
            { userId },
            { items: [], subtotal: 0, shipping: 0, tax: 0, total: 0 }
        );

        return res.status(200).json({
            success: true,
            message: 'Order placed successfully',
            orderId: order._id
        });
    } catch (error) {
        console.error('Error processing wallet payment:', error);
        return res.status(500).json({
            success: false,
            message: 'Error processing wallet payment',
            error: error.message
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
    const { addressId } = req.body;

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
            select: 'name price images stock'
        });

        if (!cart || !cart.items || cart.items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Your cart is empty'
            });
        }
        let subtotal = cart.items.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
        let shipping = subtotal > 0 ? 10 : 0;
        let tax = subtotal * 0.00;
        let total = subtotal + shipping + tax;


        let discount = 0;
        const couponCode = req.body.couponCode;
        if (couponCode) {
            const coupon = await Coupon.findOne({
                code: couponCode,
                isActive: true,
                startDate: { $lte: new Date() },
                endDate: { $gte: new Date() }
            });

            if (coupon && subtotal >= coupon.minimumPurchase) {
                if (coupon.discountType === 'percentage') {
                    discount = (subtotal * coupon.discountAmount) / 100;
                    if (coupon.maxDiscount && discount > coupon.maxDiscount) {
                        discount = coupon.maxDiscount;
                    }
                } else {
                    discount = coupon.discountAmount;
                }
                total -= discount;
            }
        }

        const amount = Math.round(total * 100);
        const options = {
            amount: amount,
            currency: 'INR',
            receipt: 'order_reciept_' + Date.now(),
            notes: {
                userId: user._id.toString(),
                addressId: addressId,
                couponCode: couponCode || ''
            }
        };

        const razorpayOrder = await instance.orders.create(options);

        res.status(200).json({
            success: true,
            order: razorpayOrder,
            key: process.env.RAZORPAY_KEY_ID,
            amount: amount,
            userInfo: {
                name: user.fname + ' ' + user.lname,
                email: user.email,
                contact: user.phone || '',
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
}

//Razorpay verification
const verifyRazorpay = async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    try {
        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_SECRET)
            .update(body.toString())
            .digest('hex');

        const isAuthentic = expectedSignature === razorpay_signature;

        if (!isAuthentic) {
            return res.status(400).json({
                success: false,
                messge: 'Invalid payment signature'
            });
        }

        const razorpayOrder = await instance.orders.fetch(razorpay_order_id);

        const userId = razorpayOrder.notes.userId;
        const addressId = razorpayOrder.notes.addressId;
        const couponCode = razorpayOrder.notes.couponCode;

        const user = await User.findById(userId);
        const cart = await Cart.findOne({ user: userId }).populate({
            path: 'items.product',
            select: 'name price images stock'
        });

        let totalAmount = 0;
        const orderItems = cart.items
            .filter(item => item.product)
            .map(item => {
                const product = item.product;
                const price = Number(product.price);
                const quantity = Number(item.quantity);

                const itemTotal = price * quantity;
                totalAmount += itemTotal;
                return {
                    productId: product._id,
                    name: product.name,
                    price: price,
                    quantity: quantity,
                    image: product.images && product.images.length > 0 ? product.images[0] : null,
                    status: 'processing' // Since payment is completed
                };
            });

        // Apply coupon discount if any
        let discount = 0;
        let coupon = null;
        if (couponCode) {
            coupon = await Coupon.findOne({
                code: couponCode,
                isActive: true,
                startDate: { $lte: new Date() },
                endDate: { $gte: new Date() }
            });

            if (coupon) {
                if (totalAmount >= coupon.minimumPurchase && (coupon.maxUses === 0 || coupon.usedCount < coupon.maxUses)) {
                    if (coupon.discountType === 'percentage') {
                        discount = (totalAmount * coupon.discountAmount) / 100;
                        if (coupon.maxDiscount && discount > coupon.maxDiscount) {
                            discount = coupon.maxDiscount;
                        }
                    } else {
                        discount = coupon.discountAmount;
                    }
                    await Coupon.findByIdAndUpdate(coupon._id, { $inc: { usedCount: 1 } });
                }
            }
        }

        // Calculate final amount
        totalAmount += 10 + (totalAmount * 0.00) - (discount || 0);

        // Create order in database
        const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

        const newOrder = new Order({
            orderId,
            userId: user._id,
            addressId: addressId,
            items: orderItems,
            status: 'processing', // Payment has been completed
            totalAmount,
            paymentMethod: 'Razorpay',
            paymentDetails: {
                transactionId: razorpay_payment_id,
                orderId: razorpay_order_id
            },
            date: new Date(),
            coupon: coupon ? {
                code: coupon.code,
                discountType: coupon.discountType,
                discountAmount: coupon.discountAmount,
                maxDiscount: coupon.maxDiscount
            } : null,
            discount: discount || 0
        });

        const savedOrder = await newOrder.save();
        // console.log('order saved', savedOrder._id);

        // Clear cart
        await Cart.findOneAndDelete({ user: user._id });

        // Fetch complete order with populated fields
        const completeOrder = await Order.findById(savedOrder._id)
            .populate('addressId')
            .populate({
                path: 'items.productId',
                select: 'name price images'
            });

        const address = await Address.findById(addressId);
        // console.log('Rendering orderConfirm.....');

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

        return res.render('user/orderConfirm', {
            order: completeOrder,
            user,
            address,
            redirectUrl: '/user/placeOrder'
        });

    } catch (error) {
        // console.error('Error verifying Razorpay payment:', error);
        res.status(500).json({
            success: false,
            message: 'Error verifying payment',
            error: error.message
        });
    }
}

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
                select: 'name price images'
            });

        if (!order) {
            return res.redirect('/user/orders');
        }

        // For the cancel order functionality
        const canCancel = order.status === 'pending';

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
                `Redund for cancelled order #${order.orderId}`
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

        const item = order.items.id(itemId);
        if (!item || item.status !== 'pending') {
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

        const itemSubtotal = item.price * item.quantity;
        let refundAmount;
        if (order.items.length === 1) {
            // Single-item order: refund the full order.totalAmount
            refundAmount = order.totalAmount;
        } else {
            // Multi-item order: prorate the discount
            if (order.discount > 0) {
                const totalSubtotal = order.items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
                const discountRatio = order.discount / totalSubtotal;
                refundAmount = itemSubtotal * (1 - discountRatio);
            } else {
                refundAmount = itemSubtotal;
            }
        }

        item.status = 'cancelled';

        if (order.paymentMethod !== 'COD') {
            item.refunded = true;
            item.refundAmount = refundAmount;
            item.refundDate = new Date();

            // console.log(`Refunding ${refundAmount} for cancelled item in order #${order.orderId}`);
            await refundToWallet(
                userId,
                refundAmount,
                order._id,
                `Refund for cancelled item in order #${order.orderId}`
            );
        }

        // Update order total and status
        const activeItems = order.items.filter(i => i.status !== 'cancelled');
        if (activeItems.length === 0) {
            order.status = 'cancelled';
            order.refundStatus = order.paymentMethod !== 'COD' ? 'full' : 'none';
        } else {
            order.totalAmount = activeItems.reduce((sum, i) => sum + (i.price * i.quantity), 0);
            order.totalAmount += 10; // Add shipping
            order.totalAmount -= order.discount || 0; // Reapply discount
            order.refundStatus = order.paymentMethod !== 'COD' ? 'partial' : 'none';
        }

        await order.save();

        return res.status(200).json({
            success: true,
            message: 'Item cancelled successfully',
            order
        });
    } catch (error) {
        console.error('Error cancelling item:', error);
        return res.status(500).json({
            success: false,
            message: 'Error cancelling item',
            error: error.message
        });
    }
}

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

                refundAmount = Math.max(0, Number(refundAmount.toFixed(2))); // Ensure non-negative and rounded
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