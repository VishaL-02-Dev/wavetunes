const User = require('../model/userModel');
const Product = require('../model/productModel');
const Address = require('../model/addressModel');
const Cart = require('../model/cartModel');
const Order = require('../model/order');
const Coupon = require('../model/coupons');
const jwt = require('jsonwebtoken');


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

        const total=subtotal + shipping + tax - discount;

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

//Load the orders
const loadMyOrders = async (req, res) => {
    const token = req.cookies.jwt;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        //PAgination
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
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
            sortOrder
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
                status: 'pending'
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
            }
        }

        order.status='cancelled';
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
const cancelOrderItem=async(req,res)=>{
    const token = req.cookies.jwt;
    const {orderId, itemId} = req.params;

    try {
        const decoded=jwt.verify(token, process.env.JWT_SECRET);
        const userId= decoded.id;

        const order= await Order.findOne({
            _id:orderId,
            userId: userId,
            status:'pending'
        });

        if(!order){
            return res.status(404).json({
                success:false,
                message:'Order not found or cannot be cancelled'
            });
        }

        const item = order.items.id(itemId);
        if(!item || item.status !== 'pending'){
            return res.status(404).json({
                success:false,
                meesssge:'Item not found or cannot be cancelled'
            });
        }

        await Product.findByIdAndUpdate(
            item.productId,
            {$inc:{stock: item.quantity || 0}},
            {new: true},
        )
        item.status = 'cancelled';

        const activeItems = order.items.filter(i => i.status !== 'cancelled');
        if(activeItems.length > 0){
            order.totalAmount = activeItems.reduce((sum,i)=>{
                const itemPrice= i.price ||0;
                return sum + (itemPrice * i.quantity);
            },0 ) + 10;
        } else{
            order.status= 'cancelled';
            order.totalAmount = 0;
        }

        await order.save();

        return res.status(200).json({
            success:true,
            message:'Item cancelled successfully',
            order
        });

    } catch (error) {
        console.error('Error cancelling item', error);
        return res.status(500).json({
            success:false,
            message: 'Error cancelling item',
            error:error.message
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
            .populate('userId', 'name email phone')
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

        const order = await Order.findByIdAndUpdate(
            orderId,
            { status },
            { new: true }
        );

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Additional logic for specific status changes
        if (status === 'cancelled') {
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
        order.items[itemIndex].status = status;

        // If all items have the same status, update the overall order status
        const allItemsHaveSameStatus = order.items.every(item => item.status === status);
        if (allItemsHaveSameStatus) {
            order.status = status;
        }

        // Handle inventory adjustments for cancelled items
        if (status === 'cancelled' && order.items[itemIndex].status !== 'cancelled') {
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

module.exports = {
    loadCheckout,
    placeOrder,
    applyCoupon,
    loadMyOrders,
    loadOrderDetails,
    cancelOrder,
    cancelOrderItem,
    adminGetOrders,
    adminGetOrderItems,
    adminGetOrderDetails,
    adminUpdateOrderStatus,
    adminUpdateOrderItemStatus
}