const Cart = require('../model/cartModel');
const User = require('../model/userModel');
const Product = require('../model/productModel');
const Wishlist = require('../model/wishlistModel');
const jwt = require('jsonwebtoken');

// Load cart
const loadCart = async (req, res) => {
    const token = req.cookies.jwt;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        let cart = await Cart.findOne({ user: userId }).populate({
            path: 'items.product',
            select: 'name price offerPercentage images stock'
        });

        // Log cart items to debug offerPercentage
        // console.log('Cart items:', JSON.stringify(cart ? cart.items.map(item => ({
        //     name: item.product.name,
        //     price: item.product.price,
        //     offerPercentage: item.product.offerPercentage,
        //     discountedPrice: item.product.offerPercentage > 0 ? item.product.price * (1 - item.product.offerPercentage / 100) : item.product.price,
        //     quantity: item.quantity
        // })) : [], null, 2));

        if (!cart) {
            cart = {
                items: [],
                subtotal: 0,
                shipping: 0,
                tax: 0,
                total: 0
            };
        } else {
            cart.subtotal = cart.items.reduce((sum, item) => {
                const price = item.product.offerPercentage > 0
                    ? item.product.price * (1 - item.product.offerPercentage / 100)
                    : item.product.price;
                return sum + (price * item.quantity);
            }, 0);

            cart.shipping = cart.subtotal > 0 ? 10 : 0;
            cart.tax = cart.subtotal * 0.00;
            cart.total = cart.subtotal + cart.shipping + cart.tax;
        }

        res.render('user/cart', { cart });
    } catch (error) {
        console.error('Error loading cart:', error);
        res.status(500).render('error', { message: 'Failed to load cart' });
    }
};

// Add item to cart
const addToCart = async (req, res) => {
    const token = req.cookies.jwt;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const { productId, quantity = 1 } = req.body;
        if (!productId) {
            return res.status(400).json({
                success: false,
                message: 'Product ID is required'
            });
        }

        const product = await Product.findById(productId).select('name price offerPercentage stock images');
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        if (product.stock < quantity) {
            return res.status(400).json({
                success: false,
                message: 'Product out of stock'
            });
        }

        // Enforce max quantity of 5
        if (quantity > Math.min(product.stock, 5)) {
            return res.status(400).json({
                success: false,
                message: `Quantity cannot exceed ${Math.min(product.stock, 5)}`
            });
        }

        let cart = await Cart.findOne({ user: user._id });

        if (!cart) {
            cart = new Cart({
                user: user._id,
                items: [],
            });
        }

        if (!Array.isArray(cart.items)) {
            cart.items = [];
        }

        const existingItemIndex = cart.items.findIndex(
            item => item.product.toString() === productId
        );

        if (existingItemIndex > -1) {
            const totalQuantity = cart.items[existingItemIndex].quantity + quantity;
            if (totalQuantity > Math.min(product.stock, 5)) {
                return res.status(400).json({
                    success: false,
                    message: `Total quantity cannot exceed ${Math.min(product.stock, 5)}`
                });
            }
            cart.items[existingItemIndex].quantity = totalQuantity;
        } else {
            cart.items.push({
                product: productId,
                quantity: quantity
            });
        }

        await cart.save();

        // Remove product from wishlist if it exists
        try {
            let wishlist = await Wishlist.findOne({ user: user._id });
            if (wishlist && Array.isArray(wishlist.items)) {
                const wishlistItemIndex = wishlist.items.findIndex(
                    item => item.product.toString() === productId
                );
                if (wishlistItemIndex > -1) {
                    wishlist.items.splice(wishlistItemIndex, 1);
                    await wishlist.save();
                }
            }
        } catch (wishlistError) {
            console.error('Error removing from wishlist:', wishlistError);
            // Log the error but don't fail the cart addition
        }

        // Log product details for debugging
        // console.log('Added to cart:', {
        //     productId,
        //     name: product.name,
        //     price: product.price,
        //     offerPercentage: product.offerPercentage,
        //     discountedPrice: product.offerPercentage > 0 ? product.price * (1 - product.offerPercentage / 100) : product.price,
        //     quantity
        // });

        // Stock is NOT decremented here; it will be handled during order generation

        res.status(200).json({
            success: true,
            message: 'Item added to cart'
        });
    } catch (error) {
        console.error('Error adding to cart:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while adding to cart',
            error: error.message
        });
    }
};

// Remove from Cart
const removeFromCart = async (req, res) => {
    const token = req.cookies.jwt;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;
        const { productId } = req.body;

        const cart = await Cart.findOne({ user: userId });

        if (!cart) {
            return res.status(404).json({
                success: false,
                message: 'Cart not found'
            });
        }

        const itemIndex = cart.items.findIndex(item =>
            item.product.toString() === productId
        );

        if (itemIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Item not in cart'
            });
        }

        cart.items.splice(itemIndex, 1);
        await cart.save();

        return res.status(200).json({
            success: true,
            message: 'Item removed from cart'
        });
    } catch (error) {
        console.error('Error removing from cart:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error while removing from cart',
            error: error.message
        });
    }
};

// Update quantity
const updateQuantity = async (req, res) => {
    const token = req.cookies.jwt;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;
        const { productId, quantity } = req.body;

        if (!productId || !Number.isInteger(quantity)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid product ID or quantity'
            });
        }

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

        const itemIndex = cart.items.findIndex(item =>
            item.product.toString() === productId
        );

        if (itemIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Item not in cart'
            });
        }

        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        // Validate new quantity
        if (quantity < 1) {
            // Optionally remove item if quantity is 0 or negative
            cart.items.splice(itemIndex, 1);
        } else {
            const maxQuantity = Math.min(product.stock, 5);
            if (quantity > maxQuantity) {
                return res.status(400).json({
                    success: false,
                    message: `Quantity cannot exceed ${maxQuantity}`
                });
            }
            cart.items[itemIndex].quantity = quantity;
        }

        // Recalculate cart totals using offerPercentage
        cart.subtotal = cart.items.reduce((sum, item) => {
            const price = item.product.offerPercentage > 0
                ? item.product.price * (1 - item.product.offerPercentage / 100)
                : item.product.price;
            return sum + (item.quantity * price);
        }, 0);
        cart.shipping = cart.subtotal > 0 ? 10 : 0;
        cart.tax = cart.subtotal * 0.00;
        cart.total = cart.subtotal + cart.shipping + cart.tax;

        // Log cart totals for debugging
        // console.log('Cart totals:', {
        //     subtotal: cart.subtotal,
        //     shipping: cart.shipping,
        //     tax: cart.tax,
        //     total: cart.total
        // });

        await cart.save();

        return res.status(200).json({
            success: true,
            message: 'Cart updated successfully'
        });
    } catch (error) {
        console.error('Error updating cart:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error while updating cart',
            error: error.message
        });
    }
};

module.exports = {
    loadCart,
    addToCart,
    updateQuantity,
    removeFromCart
};