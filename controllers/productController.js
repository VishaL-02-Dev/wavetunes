const mongoose = require('mongoose');
const Product = require("../model/productModel");
const Category = require("../model/categoryModel");
const User = require("../model/userModel")
const cloudinary = require('../config/cloudinary');



//Load Product Page for admin
const adminProduct = async (req, res) => {
    try {
        const itemsPerPage = 5;
        const page = parseInt(req.query.page) || 1;
        let skip = (page - 1) * itemsPerPage;
        const search = req.query.search || '';


        const query = {};
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: "i" } },
                { brand: { $regex: search, $options: 'i' } },
                { descriptions: { $regex: search, $options: 'i' } }
            ];
        }

        const totalCount = await Product.countDocuments();

        const products = await Product.find(query)
            .populate("category", "name")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(itemsPerPage);

        const categories = await Category.find();
        res.render('admin/product', {
            products,
            totalCount,
            totalPages: Math.ceil(totalCount / itemsPerPage),
            itemsPerPage,
            page,
            currentPage: 'products',
            categories,
            search
        });
    } catch (error) {
        console.error('Error occurred', error);
        res.status(500).send("Internal Server Error");
    }
};

//Create Product admin side
const createProduct = async (req, res) => {
    try {
        const { name, brand, description, specifications, price, category, stock, offerPercentage, offerEndDate } = req.body;

        const imageUrls = req.body.imageUrls || [];

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


        if (offerPercentage) {
            const offerPercent = parseFloat(offerPercentage);
            if (isNaN(offerPercent) || offerPercent < 0 || offerPercent > 100) {
                return res.status(400).json({
                    success: false,
                    message: 'Offer percentage must be a valid future date.'
                });
            }
        }

        if (offerEndDate) {
            const endDate = new Date(offerDate);
            if (isNaN(endDate.getTime()) || endDate <= new Date()) {
                return res.status(400).json({
                    success: false,
                    message: 'Offer end date must be a valid date.'
                });
            }
        }

        // Handle images from frontend (array of Cloudinary URLs)
        let productImages = [];
        if (imageUrls && imageUrls.length > 0) {
            const imageArray = Array.isArray(imageUrls) ? imageUrls : [imageUrls]; // Handle single or multiple images
            if (imageArray.length > 4) {
                return res.status(400).json({
                    success: false,
                    message: "Maximum 4 images allowed per product."
                });
            }
            productImages = imageArray.map(url => ({
                public_id: url.split('/').pop().split('.')[0], // Extract public_id from URL (simplified)
                url: url
            }));
        }

        if (productImages.length === 0) {
            return res.status(400).json({
                success: false,
                message: "At least one image is required."
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
            images: productImages,
            offerPercentage: offerPercentage ? parseFloat(offerPercentage) : 0,
            offerEndDate: offerEndDate || null
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

// Update Product admin side
const updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, brand, description, specifications, price, category, stock, offerPercentage, offerEndDate } = req.body;

        const imageUrls = req.body.imageUrls || [];
        const removeImages = req.body.removeImages;

        const existingProduct = await Product.findById(id);
        if (!existingProduct) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }


        if (offerPercentage) {
            const offerPercent = parseFloat(offerPercentage);
            if (isNaN(offerPercent) || offerPercent < 0 || offerPercent > 100) {
                return res.status(400).json({
                    success: false,
                    message: 'Offer percentage must be between 0 and 100'
                });
            }
        }

        if (offerEndDate) {
            const endDate = new Date(offerEndDate);
            if (isNaN(endDate.getTime()) || endDate <= new Date()) {
                return res.status(400).json({
                    success: false,
                    message: "Offer end date must be a valid future date."
                });
            }
        }

        // Prepare updated images array
        let updatedImages = [...existingProduct.images];

        // Handle removal of images
        if (removeImages) {
            const indicesToRemove = JSON.parse(removeImages);
            const imagesToDelete = updatedImages.filter((_, index) => indicesToRemove.includes(index));

            // Delete from Cloudinary
            for (const img of imagesToDelete) {
                await cloudinary.uploader.destroy(img.public_id);
            }

            // Filter out removed images
            updatedImages = updatedImages.filter((_, index) => !indicesToRemove.includes(index));
        }

        // Handle new images (Cloudinary URLs from frontend)
        if (imageUrls && imageUrls.length > 0) {
            const newImages = Array.isArray(imageUrls) ? imageUrls : [imageUrls];
            if (updatedImages.length + newImages.length > 4) {
                return res.status(400).json({
                    success: false,
                    message: "Maximum 4 images allowed per product."
                });
            }

            const newImageObjects = newImages.map(url => ({
                public_id: url.split('/').pop().split('.')[0], // Adjust based on URL structure
                url: url
            }));
            updatedImages = [...updatedImages, ...newImageObjects];
        }

        // Prepare updates object
        const updates = {
            name,
            brand,
            description,
            specifications,
            price,
            category,
            stock,
            images: updatedImages,
            offerPercentage: offerPercentage ? parseFloat(offerPercentage) : existingProduct.offerPercentage,
            offerEndDate: offerEndDate || existingProduct.offerEndDate
        };

        const updatedProduct = await Product.findByIdAndUpdate(id, updates, { new: true })
            .populate('category', 'name');

        res.status(200).json({
            success: true,
            message: "Product updated successfully",
            product: updatedProduct
        });

    } catch (error) {
        console.error('Product update error:', error);

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


// Deactivate/Activate Product admin side
const toggleProductStatus = async (req, res) => {
    try {
        const { id } = req.params;

        const product = await Product.findById(id);
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        product.isActive = !product.isActive;
        await product.save();

        res.status(200).json({
            success: true,
            message: `Product ${product.isActive ? 'activated' : 'deactivated'} successfully`,
            isActive: product.isActive
        })
    } catch (error) {
        console.error('Product status toggle error:', error);
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
        res.status(200).json({
            success: true,
            product
        });

    } catch (error) {
        console.error('Error fetching product:', error);
        res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};

//--------- User side controller functions -----------//

// Product detail page User side
const getProductById = async (req, res) => {
    try {
        const { id } = req.params;

        // Check if ID is valid
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).render('error', {
                message: 'Invalid product ID format',
                error: { status: 400 }
            });
        }

        // Fetch product with active status and listed category
        let product = await Product.findOne({ 
            _id: id, 
            isActive: true 
        }).populate({
            path: 'category',
            select: 'name status',
            match: { status: 'Listed' } // Only include listed categories
        });

        // Check if product exists and has a listed category
        if (!product || !product.category) {
            return res.status(404).render('user/product-detail', {
                errorMessage: 'Product not found, inactive, or belongs to an unlisted category.',
                product: null,
                relatedProducts: [],
                categoryName: null,
                categorySlug: null
            });
        }

        // Add offerPrice to product (uncommented and updated)
        const productObj = product.toObject();
        if (product.offerPercentage > 0 && (product.offerEndDate === null || product.offerEndDate >= new Date())) {
            productObj.offerPrice = Math.round(product.price * (1 - product.offerPercentage / 100));
        }
        // Optionally, account for categoryOffer
        const categoryOffer = product.category.categoryOffer || 0;
        if (categoryOffer > 0) {
            productObj.offerPrice = Math.round(productObj.offerPrice ? 
                productObj.offerPrice * (1 - categoryOffer / 100) : 
                product.price * (1 - categoryOffer / 100));
        }
        product = productObj;

        const categorySlugMap = {
            "Neckbands": "neckbands",
            "Over-Ear Headsets": "over-ear_headsets",
            "TWS/Earbuds": "tws"
        };

        const categorySlug = categorySlugMap[product.category.name] || "unknown";

        // Fetch related products
        let relatedProducts = [];
        if (product.category) {
            relatedProducts = await Product.find({
                category: product.category._id,
                _id: { $ne: product._id },
                isActive: true
            })
                .populate({
                    path: 'category',
                    select: 'name status',
                    match: { status: 'Listed' }
                })
                .limit(4);

            // Filter out products with unlisted categories and add offerPrice
            relatedProducts = relatedProducts
                .filter(related => related.category)
                .map(related => {
                    const relatedObj = related.toObject();
                    if (related.offerPercentage > 0 && (related.offerEndDate === null || related.offerEndDate >= new Date())) {
                        relatedObj.offerPrice = Math.round(related.price * (1 - related.offerPercentage / 100));
                    }
                    return relatedObj;
                });
        }

        // Increment view count
        product.views = (product.views || 0) + 1;
        await Product.findByIdAndUpdate(id, { views: product.views });

        // Render the product detail page
        res.render('user/product-detail', {
            product,
            relatedProducts,
            categoryName: product.category.name,
            categorySlug,
            errorMessage: null
        });

    } catch (error) {
        console.error(error);
        res.status(500).render('error', {
            message: 'Internal server error',
            error: { status: 500 }
        });
    }
};

// Display all products user side
const displayProduct = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        let category = req.query.category;
        const search = req.query.search;
        const sort = req.query.sort || 'newest';
        const categories = await Category.find({ status: 'Listed' }).select('name');

        // Build query
        const query = { isActive: true }; // Only active products
        if (category) {
            const categoryDoc = await Category.findOne({ name: category, status: 'Listed' }).select('_id');
            if (categoryDoc) {
                query.category = categoryDoc._id;
            } else {
                query.category = null; // Ensure no products are returned if category is unlisted
            }
        }
        if (search) {
            query.name = { $regex: search, $options: 'i' };
        }
        // Only show offers that are not expired
        query.$or = [
            { offerEndDate: { $gte: new Date() } },
            { offerEndDate: null },
            { offerPercentage: 0 }
        ];

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
                path: 'category',
                select: 'name status',
                match: { status: 'Listed' } // Only listed categories
            })
            .sort(sortOption)
            .skip((page - 1) * limit)
            .limit(limit);

        // Filter out products with unlisted categories
        products = products.filter(product => product.category);

        // Add offerPrice to each product, including categoryOffer
        products = products.map(product => {
            const productObj = product.toObject();
            if (product.offerPercentage > 0 && (product.offerEndDate === null || product.offerEndDate >= new Date())) {
                productObj.offerPrice = Math.round(product.price * (1 - product.offerPercentage / 100));
            }
            return productObj;
        });

        return res.render('user/products', {
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

//User-side products display according to category
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
        // Find the corresponding category ObjectId from the database
        const category = await Category.findOne({ name: categoryMap[categorySlug], status: 'Listed' });

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        const search = req.query.search || '';
        const sort = req.query.sort || 'newest';

        if (!category) {
            // return res.status(404).send("Category not found in the database");
            return res.render('user/category', {
                products: [],
                categoryName: categoryMap[categorySlug],
                categorySlug,
                currentPage: page,
                totalPages: 0,
                search,
                sort,
            });
        }

        // Use the found category's ObjectId to query products
        const filter = {
            category: category._id,
            $or: [
                { offerEndDate: { $gte: new Date() } }, // Offers that are still valid
                { offerEndDate: null }, // Offers without an end date
                { offerPercentage: 0 } // Products without offers
            ]
        };

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
        let products = await Product.find({ ...filter, isActive: true })
            .sort(sortOption)
            .limit(limit)
            .skip((page - 1) * limit);

        // Add offerPrice to each product
        products = products.map(product => {
            const productObj = product.toObject();
            if (product.offerPercentage && product.offerPercentage > 0) {
                productObj.offerPrice = Math.round(product.price * (1 - product.offerPercentage / 100));
            }
            return productObj;
        });

        res.render('user/category', {
            products,
            categoryName: categoryMap[categorySlug],
            categorySlug,
            currentPage: page,
            totalPages,
            search,
            sort,
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
    toggleProductStatus,
    getProductById,
    displayProduct,
    adminProduct,
    getCategoryProducts
};