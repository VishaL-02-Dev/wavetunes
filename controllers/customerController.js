const User = require('../model/userModel');

const getCustomers = async (req, res) => {
    try {
        const itemsPerPage = 5;
        const currentPage = parseInt(req.query.page) || 1;

        // let page=parseInt(req.query.page)||1;
        // let limit=5;
        let skip = (currentPage - 1) * itemsPerPage;

        const totalCount = await User.countDocuments({ isAdmin: false });

        const users = await User.find({ isAdmin: false })
            .sort({ createdAt: 1 })
            .skip(skip)
            .limit(itemsPerPage);

        res.render('admin/customers', {
            users,
            currentPage,
            totalPages: Math.ceil(totalCount / itemsPerPage),
            totalCount,
            itemsPerPage,
            errorMessasge: null
        });
        // console.log('Customers page rendered');
    } catch (error) {
        console.error("Error fetching users", error);
        // res.status(500).json({message:"Internal error"});

        res.render('admin/customers', {
            users: [],
            currentPage: 1,
            totalPages: 1,
            totalCount: 1,
            itemsPerPage: 5,
            errorMessage: "Failed to load customers"
        });

    }
}

const userStatus = async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await User.findById(userId);

        if(!user){
            return res.status(404).json({
                success:false,
                message:"User not found"
            });
        }

        user.status = user.status === "Blocked" ? "Unblocked" : "Blocked";
        await user.save();
        
        return res.status(200).json({
            success:true,
            message:`User has been ${user.status} successfully`
        });
 
    } catch (error) {
        console.error("Error toggling user status: ",error);
        res.status(500).json({
            success:false,
            message:"Internal server error",
        });
    }
}


module.exports = {
    getCustomers,
    userStatus,
}