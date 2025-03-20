const mongoose=require('mongoose');
const Product = require("../model/productModel");
const Category = require("../model/categoryModel");
const User = require("../model/userModel")
const cloudinary= require('../config/cloudinary');



//Load Product Page for admin
const adminProduct = async (req, res) => {
    try {
        const itemsPerPage= 5;
        const currentPage=parseInt(req.query.page) || 1;
        let skip=(currentPage - 1) * itemsPerPage;
        const search=req.query.search || '';
       

        const query={};
        if(search){
            query.$or=[
                {name: {$regex: search, $options: "i"}},
                {brand:{$regex: search, $options: 'i'}},
                {descriptions:{$regex:search, $options:'i'}}
            ];
        }
        
        const totalCount= await Product.countDocuments();
        
        const products = await Product.find(query)
        .populate("category", "name")
        .sort({createdAt:-1})
        .skip(skip)
        .limit(itemsPerPage);
        
        const categories = await Category.find();
        res.render('admin/product', {
            products,
            totalCount,
            totalPages:Math.ceil(totalCount/itemsPerPage),
            itemsPerPage,
            currentPage,
            categories,
            search
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

        const imageUrls=req.body.imageUrls || [];

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

        // Handle images from frontend (array of Cloudinary URLs)
        let productImages = [];
        if (imageUrls && imageUrls.length>0) {
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
            images: productImages
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

// Update Product
const updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, brand, description, specifications, price, category, stock } = req.body;

        const imageUrls=req.body.imageUrls || [];
        const removeImages=req.body.removeImages;

        const existingProduct = await Product.findById(id);
        if (!existingProduct) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
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
        if (imageUrls && imageUrls.length>0) {
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
            images: updatedImages
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


// Delete Product
const deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;

        const product = await Product.findById(id);
        if (!product) {
            return res.status(404).json({ 
                success: false, 
                message: "Product not found" 
            });
        }

        
        // for (const img of product.images) {
        //     await cloudinary.uploader.destroy(img.public_id);
        // }

        // Delete the product from the database
        await Product.findByIdAndDelete(id);

        // Delete images from Cloudinary
        try {
            for (const img of product.images) {
                if (img && img.public_id) {
                    await cloudinary.uploader.destroy(img?.public_id);
                }
            }
        } catch (cloudinaryError) {
            console.error('Cloudinary error:', cloudinaryError);
        }


        res.status(200).json({ 
            success: true, 
            message: "Product deleted successfully" 
        });

    } catch (error) {
        console.error('Product deletion error:', error);
        res.status(500).json({ 
            success: false, 
            message: "Internal server error" 
        });
    }
};

//Admin side 
const getProduct = async (req, res) => {
    try {
        const { id } = req.params;
        
        const products = await Product.find().populate("category");
        
        if (!products) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }
        res.status(200).json({
            success: true,
            products
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

        // if (product.images && product.images.length > 0) {
        //     product.imageBase64 = product.images.map(img => 
        //         `data:${img.contentType};base64,${img.data.toString('base64')}`
        //     );
        // } else {
        //     product.imageBase64 = [];
        // }


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
        //  Find the corresponding category ObjectId from the database
        const category = await Category.findOne({ name: categoryMap[categorySlug],status:'Listed'});

        if (!category) {
            return res.status(404).send("Category not found in the database");
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        const search = req.query.search || '';
        const sort = req.query.sort || 'newest';

        // Use the found category's ObjectId to query products
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

            // products = products.map(product => {
            //     return {
            //         ...product.toObject(),
            //         images: product.images.map(img => 
            //             `data:${img.contentType};base64,${img.data.toString('base64')}`
            //         )
            //     };
            // });

            // console.log('products passed',products);

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
    deleteProduct,
    getProductById,
    displayProduct,
    adminProduct,
    getCategoryProducts
};