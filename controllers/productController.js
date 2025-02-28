const mongoose=require('mongoose');
const Product = require("../model/productModel");
const Category = require("../model/categoryModel");
const User = require("../model/userModel")

//Load Product Page for admin
const adminProduct = async (req, res) => {
    try {
        const products = await Product.find().populate("category", "name");

        // Convert image buffer to base64 for rendering
        const updatedProducts = products.map(product => {
            let firstImage = "";
            if (product.images.length > 0) {
                firstImage = `data:${product.images[0].contentType};base64,${product.images[0].data.toString('base64')}`;
            }
            return { ...product.toObject(), firstImage };
        });

        const categories = await Category.find();
        res.render('admin/product', {
            products: updatedProducts,
            currentPage: 'products',
            categories,
        });
    } catch (error) {
        console.error('Error occurred', error);
        res.status(500).send("Internal Server Error");
    }
};

//Create Product
const createProduct = async (req, res) => {
    try {
        const { name, brand, description, specifications, price, category, stock } = req.body;

        // Basic field validation
        if (!name || !description || !price || !category || stock == null) {
            return res.status(400).json({ 
                success: false, 
                message: "All fields are required." 
            });
        }

        // Validate price and stock are positive numbers
        if (price <= 0 || stock < 0) {
            return res.status(400).json({
                success: false,
                message: "Price must be greater than 0 and stock must be non-negative."
            });
        }

        // Image validation - check req.files for multer
        if (!req.files && (!req.body.images || req.body.images.length === 0)) {
            return res.status(400).json({
                success: false,
                message: "At least one product image is required."
            });
        }

        // Handle the images based on how they're uploaded
        let images = [];
        
        if (req.files) {
            // If using multer middleware
            images = req.files.map(file => ({
                data: file.buffer,
                contentType: file.mimetype
            }));
        } else if (req.body.images) {
            // If images were sent in request body (base64 strings)
            const imageArray = Array.isArray(req.body.images) ? req.body.images : [req.body.images];
            images = imageArray.map(img => {
                // Parse the base64 image
                const matches = img.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                if (!matches || matches.length !== 3) {
                    throw new Error('Invalid image format');
                }
                
                const contentType = matches[1];
                const buffer = Buffer.from(matches[2], 'base64');
                
                return {
                    data: buffer,
                    contentType
                };
            });
        }
        
        if (images.length > 4) {
            return res.status(400).json({
                success: false,
                message: "Maximum 4 images allowed per product."
            });
        }

        // Create and save the product
        const newProduct = new Product({
            name,
            brand,
            description,
            specifications,
            price,
            category,
            stock,
            images
        });

        await newProduct.save();

        // Return the new product with populated category
        const product = await Product.findById(newProduct._id)
            .populate("category", "name");
            
        return res.status(201).json({
            success: true,
            message: "Product added successfully",
            product
        });

    } catch (error) {
        console.error('Product creation error:', error);
        
        // Handle specific errors
        if (error.message.includes('Invalid')) {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        // Handle mongoose validation errors
        if (error.name === 'ValidationError') {
            return res.status(400).json({
                success: false,
                message: Object.values(error.errors).map(err => err.message).join(', ')
            });
        }

        res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};

// Update Product
const updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        if(req.files && req.files.length>0){
            updates.images = req.files.map(file=>({
                data:file.buffer,
                contentType:file.mimetype,
            })); 
        }

        const updatedProduct = await Product.findByIdAndUpdate(id, updates, { new: true }).populate('category');

        if (!updatedProduct) {
            return res.status(404).json({ 
                success: false, 
                message: "Product not found" 
            });
        }

        res.status(200).json({ 
            success: true, 
            message: "Product updated successfully", 
            product: updatedProduct 
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ 
            success: false, 
            message: "Internal server error" 
        });
    }
}


// Delete Product
const deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;

        const deletedProduct = await Product.findByIdAndDelete(id);

        if (!deletedProduct) {
            return res.status(404).json({ 
                success: false, 
                message: "Product not found" 
            });
        }

        res.status(200).json({ 
            success: true, 
            message: "Product deleted successfully" 
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ 
            success: false, 
            message: "Internal server error" 
        });
    }
}

//Admin side 
const getProduct = async (req, res) => {
    try {
        const { id } = req.params;
        
        const product = await Product.findById(id).populate("category");
        
        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }
        
        // Convert image buffer to base64 for frontend display if needed
        const productWithImages = {
            ...product.toObject(),
            images: product.images.map(img => ({
                ...img,
                data: img.data ? `data:${img.contentType};base64,${img.data.toString('base64')}` : null
            }))
        };
        
        res.status(200).json({
            success: true,
            product: productWithImages
        });
        
    } catch (error) {
        console.error('Error fetching product:', error);
        res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};

const getProductById = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Check if ID is valid
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(404).render('error', { 
                message: 'Invalid product ID format',
                error: { status: 400 }
            });
        }
        
        let product = await Product.findById(id).populate('category');

        if (!product) {
            return res.status(404).render('error', { 
                message: 'Product not found',
                error: { status: 404 }
            });
        }

        if (product.images && product.images.length > 0) {
            product.imageBase64 = product.images.map(img => 
                `data:${img.contentType};base64,${img.data.toString('base64')}`
            );
        } else {
            product.imageBase64 = [];
        }


        const categorySlugMap = {
            "Neckbands": "neckbands",
            "Over-Ear Headsets": "over-ear_headsets",
            "TWS/Earbuds": "tws"
        };

        const categorySlug = categorySlugMap[product.category.name] || "unknown";


        // Fetch related products (optional)
        let relatedProducts = [];
        if (product.category) {
            relatedProducts = await Product.find({
                category: product.category._id,
                _id: { $ne: product._id } // Exclude current product
            }).limit(4);
        }
        
        // Increment view count (optional)
        product.views = (product.views || 0) + 1;
        await product.save();

        // Render the product detail page
        res.render('user/product-detail', { 
            product,
            relatedProducts,
            categoryName: product.category.name, 
            categorySlug
        });

    } catch (error) {
        console.error(error);
        res.status(500).render('error', { 
            message: 'Internal server error',
            error: { status: 500 }
        });
    }
};

const loadProduct = async (req, res) => {
    try {
        
        const categories = await Category.find().select('name');
        const products = await Product.find().limit(12); 
        console.log("Fetched products: ", products);
        
        res.render('user/products', {
            categories,   
            products      
        });

    } catch (error) {
        console.error('Error loading products:', error);
        res.status(500).send('Server error while loading products');
    }
};


const displayProduct=async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        let category = req.query.category;
        const search = req.query.search;
        const sort = req.query.sort || 'newest'; // sorting option
        const categories = await Category.find({status:{$ne:'Unlisted'}}).select('name');

        // Build query
        const query = {};
        if (category) {
            const categoryDoc = await Category.findOne({name: category, status:{$ne:'Unlisted'}}).select('_id');
            if(categoryDoc){
                query.category = categoryDoc._id;
            }
        }
            if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        // Build sort options
        let sortOption = {};
        switch (sort) {
            case 'price-low':
                sortOption = { price: 1 };
                break;
            case 'price-high':
                sortOption = { price: -1 };
                break;
            case 'rating':
                sortOption = { ratings: -1 };
                break;
            default:
                sortOption = { createdAt: -1 };
        }

        // Execute query with pagination
        const totalProducts = await Product.countDocuments(query);
        const totalPages = Math.ceil(totalProducts / limit);

        let products = await Product.find(query)
            .populate({
                path:'category',
                match:{status:{$ne:'Unlisted'}},
                select:'name'
            })
            .sort(sortOption)
            .skip((page - 1) * limit)
            .limit(limit);

            products = products.map(product => {
                return {
                    ...product.toObject(),
                    images: product.images.map(img => 
                        `data:${img.contentType};base64,${img.data.toString('base64')}`
                    )
                };
            });

            console.log('products passed');

        return res.render('user/products',{
            products,
            categories,
            currentPage: page,
            totalPages,
            totalProducts,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
            category,
            search,
            sort
        });

    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ message: 'Error fetching products' });
    }
};


const getCategoryProducts = async (req, res) => {
    const { categorySlug } = req.params;
    const categoryMap = {
        'neckbands': 'Neckbands',
        'over-ear_headsets': 'Over-Ear Headsets',
        'tws': 'TWS/Earbuds'
    };

    if (!categoryMap[categorySlug]) {
        return res.status(404).send("Category not found");
    }

    try {
        // 🔹 Find the corresponding category ObjectId from the database
        const category = await Category.findOne({ name: categoryMap[categorySlug] });

        if (!category) {
            return res.status(404).send("Category not found in the database");
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        const search = req.query.search || '';
        const sort = req.query.sort || 'newest';

        // 🔹 Use the found category's ObjectId to query products
        const filter = { category: category._id };

        if (search) {
            filter.name = { $regex: search, $options: 'i' };
        }

        let sortOption = {};
        switch (sort) {
            case 'price-low':
                sortOption = { price: 1 };
                break;
            case 'price-high':
                sortOption = { price: -1 };
                break;
            case 'rating':
                sortOption = { ratings: -1 };
                break;
            default:
                sortOption = { createdAt: -1 };
        }

        const totalProducts = await Product.countDocuments(filter);
        const totalPages = Math.ceil(totalProducts / limit);
        let products = await Product.find(filter)
            .sort(sortOption)
            .limit(limit)
            .skip((page - 1) * limit);

            products = products.map(product => {
                return {
                    ...product.toObject(),
                    images: product.images.map(img => 
                        `data:${img.contentType};base64,${img.data.toString('base64')}`
                    )
                };
            });

            console.log('products passed');

        res.render('user/category', {
            products,
            categoryName: categoryMap[categorySlug],
            categorySlug,
            currentPage: page,
            totalPages,
            search,
            sort,
            user: req.session.user || null
        });
    } catch (error) {
        console.error(`Error fetching ${categoryMap[categorySlug]} products:`, error);
        res.status(500).send(`Error fetching ${categoryMap[categorySlug]} products`);
    }
};


module.exports = {
    createProduct,
    getProduct,
    updateProduct,
    deleteProduct,
    loadProduct,
    getProductById,
    displayProduct,
    adminProduct,
    getCategoryProducts
};