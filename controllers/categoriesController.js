const Category = require('../model/categoryModel');

//Load Category page
const loadCategory = async (req, res) => {
    try {

        const { id }= req.query;

        let editCategory=null;

        if(id){
           editCategory= await Category.findById(id);
        }

        const itemsPerPage=5;
        const currentPage=parseInt(req.query.page) || 1;
        
        let skip=(currentPage - 1) * itemsPerPage;

        const totalCategories = await Category.countDocuments();
        const categories = await Category.find()
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(itemsPerPage);

        res.render('admin/category', { 
            cat: categories,
            currentPage,
            totalPages:Math.ceil(totalCategories/itemsPerPage),
            itemsPerPage,
            totalCategories,
            editCategory:editCategory 
        });
    } catch (error) {
        console.error('Internal error', error);
        res.status(500).json('Internal Server Error');
    }
}

// Get all categories
const getCategories = async (req, res) => {
    try {
        const searchQuery = req.query.search || "";
        const currentPage = parseInt(req.query.page) || 1;
        const itemsPerPage=5;
        let skip=(currentPage - 1) * itemsPerPage;

        const query = searchQuery ? { name: new RegExp(searchQuery, 'i') } : {};
        const totalCategories = await Category.countDocuments(query);
        const categories = await Category.find(query)
            .sort({createdAt: 1})
            // .skip(skip)
            .limit(itemsPerPage)

        res.render('admin/categories', {
            cat: categories,
            currentPage,
            totalPages: Math.ceil(totalCategories / itemsPerPage),
        });
    } catch (error) {
        console.error(error);
        res.status(500).send("Internal Server Error");
    }
};

// Add a new category
const addCategory = async (req, res) => {
    try {
        const { name, description } = req.body;

        if (!name || !description) {
            return res.status(400).json({ 
                success:false,
                message: "All fields are required." 
            });
        }

        const categoryExists = await Category.findOne({ name:{$regex: new RegExp(`^${name}$`,'i')} });
        if (categoryExists) {
            return res.status(400).json({ 
                success:false,
                message: "Category already exists" 
            });
        }

        const newCategory = new Category({ name, description });
        await newCategory.save();

        req.session.save((err)=>{
            if(err){
                return res.status(500).json({
                    success:false,
                    message:"Session error"
                });
            }

             res.json({ 
                success: true, 
                message: "Category added successfully." 
            });

        });
   

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success:false,
            message: "Internal server error"
            });
    }
};   


// List/Unlist a category
const toggleCategoryStatus = async (req, res) => {
    try {
        const { id } = req.query;
        const category = await Category.findById(id);

        if (!category) {
            return res.status(404).json({ 
                success:false,
                message: "Category not found." 
            });
        }

        category.status = category.status === 'Listed' ? 'Unlisted' : 'Listed';
        await category.save();

        return res.status(200).json({ 
            success: true, 
            message: `Category ${category.status} successfully.` 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// Edit category
const editCategory = async (req, res) => {
    try {
        const { id } = req.query;
        const { name, description } = req.body;

        if(!name || !description){
            return res.status(400).json({
                success:false,
                message:"Name and description required."
            });
        }

        const category = await Category.findById(id);
        if (!category) {
            return res.status(404).json({ 
                error: "Category not found." 
            });
        }

        const existingCategory = await Category.findOne({ 
            name: name.trim(), 
            _id: { $ne: id } 
        });
        
        if (existingCategory) {
            return res.status(400).json({ 
                success: false, 
                message: "Category name already exists." 
            });
        }

        category.name = name.trim();
        category.description = description.trim();
        await category.save();

        return res.status(200).json({ 
            success: true, 
            message: "Category updated successfully.",
            redirectUrl:'/admin/categories'
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ 
            success:false,
            error: "Internal Server Error" 
        });
    }
};


module.exports = {
    loadCategory,
    getCategories,
    addCategory,
    editCategory,
    toggleCategoryStatus
}