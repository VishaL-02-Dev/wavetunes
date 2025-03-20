const User = require('../model/userModel');

const getCustomers = async (req, res) => {
    try {

        const { search, page}=req.query;

        let filter={isAdmin: false };
        if(search){
            filter={
                isAdmin: false,
                $or:[
                    {fname:{$regex: search, $options:'i'}},
                    {lname:{$regex: search, $options:'i'}},
                    {email:{$regex: search, $options:'i'}}

                ]
            };
        }

        const itemsPerPage = 5;
        const currentPage = parseInt(page) || 1;
        let skip = (currentPage - 1) * itemsPerPage;

        const totalCount = await User.countDocuments(filter);

        const users = await User.find(filter)
            .sort({ createdAt: 1 })
            .skip(skip)
            .limit(itemsPerPage);

        res.render('admin/customers', {
            users,
            currentPage,
            totalPages: Math.ceil(totalCount / itemsPerPage),
            totalCount,
            itemsPerPage,
            errorMessasge: null,
            search
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
            errorMessage: "Failed to load customers",
            search:''
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