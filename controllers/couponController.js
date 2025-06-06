const Coupon=require('../model/couponsModel');

//Get coupons
const getCoupon=async(req,res)=>{
    try {
        const {page=1, search, status, dateFilter}=req.query;
        const itemsPerPage=5;
        const skip=(page-1)*itemsPerPage;

        let query={};

        if(search){
            query.code={$regex:search, $options:'i'};
        }

        if(status==='active'){
            query.isActive=true;
        }else if(status==='inactive'){
            query.isActive=false;
        }

        const now=new Date();
        if(dateFilter==='upcoming'){
            query.startDate={$gt:now};
        }else if(dateFilter==='active'){
            query.startDate={$lt:now};
            query.endDate={$gte:now};
            query.isActive=true;
        }else if(dateFilter==='expired'){
            query.endDate={$lt:now};
        }

        const totalCount= await Coupon.countDocuments(query)
        const coupons= await Coupon.find(query)
            .sort({createdAt:-1})
            .skip(skip)
            .limit(itemsPerPage);

            const totalPages= Math.ceil(totalCount/itemsPerPage);

            res.render('admin/coupon',{
                coupons,
                totalCount,
                page,
                totalPages,
                search,
                status,
                dateFilter,
                itemsPerPage,
                currentPage:'coupons'
            });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            success:false,
            message:'Server error'
        });
    }
}

//Create Coupon
const createCoupon= async(req,res)=>{
    try {
        const {
            code,
            discountType,
            discountAmount,
            minimumPurchase,
            maxDiscount,
            startDate,
            endDate,
            maxUses,
            isActive
        }=req.body;

        if(discountType === 'percentage' && discountAmount>100){
            return res.status(400).json({
                success:false,
                message:'Discount percentage cannot not exceed 100%'
            });
        }

        if(new Date(startDate) > new Date(endDate)){
            return res.status(400).json({
                success:false,
                message:'End date must be after start date'
            });
        }

        const existingCoupon= await Coupon.findOne({code: code.toUpperCase()});
        if(existingCoupon){
            return res.status(400).json({
                success:false,
                message:'Coupon code already exists'
            });
        }

        const coupon = new Coupon({
            code:code.toUpperCase(),
            discountType,
            discountAmount,
            minimumPurchase:minimumPurchase,
            maxDiscount:maxDiscount || undefined,
            startDate,
            endDate,
            maxUses: maxUses || 0,
            isActive,
        });

        await coupon.save();
        return res.status(200).json({
            success:true, message:'Coupon created successfully'
        });

    } catch (error) {
        console.error(error);
        res.status(404).json({
            success:false,
            message:'Server error'
        });
    }
}


//Get coupon details
const getCouponDetails= async(req,res)=>{
    try {
        const coupon=await Coupon.findById(req.params.id);
        if(!coupon){
            return res.status(404).json({
                success:false,
                message:'Coupon not found'
            });
        }
        res.status(200).json({
            success:true,
            coupon
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success:false,
            message:'Server error'
        })
    }
};

//Update Coupon
const updateCoupon = async(req,res)=>{
    try {
        const couponId =req.params.id;
        const {
            code,
            discountType,
            discountAmount,
            minimumPurchase,
            maxDiscount,
            startDate,
            endDate,
            maxUses,
            isActive
        }=req.body;

        if(discountType === 'percentage' && discountAmount > 100){
            return res.status(400).json({
                success:false,
                messaage:'Discount percentage cannot exceed 100%'
            });
        }

        if(new Date(startDate) > new Date(endDate)){
            return res.status(400).json({
                success:false,
                message:'End date must be after start date'
            });
        }

        const existingCoupon= await Coupon.findOne({
            cose:code.toUpperCase(),
            _id:{$ne:couponId}
        });

        if(existingCoupon){
            return res.status(400).json({
                success:false,
                message:'Coupon code already exists'
            });
        }

        const updatedCoupon = await Coupon.findByIdAndUpdate(
            couponId,
            {
                code: code.toUpperCase(),
                discountType,
                discountAmount,
                minimumPurchase,
                maxDiscount: maxDiscount || undefined,
                startDate,
                endDate,
                maxUses: maxUses || 0,
                isActive
            },
            { new: true}
        );

        if(!updatedCoupon){
            return res.status(404).json({
                success:false,
                message:'Coupon not found'
            });
        }

        return res.status(200).json({
            success:true,
            message:'Couppon updated successfully',
            coupon:updatedCoupon
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success:fasle,
            messaage:'Server error'
        });
    }
}

// Toggle coupon status (activate/deactivate)
const toggleCouponStatus = async(req, res) => {
    try {
        const couponId = req.params.id;
        const { isActive } = req.body;

        const updatedCoupon = await Coupon.findByIdAndUpdate(
            couponId,
            { isActive },
            { new: true }
        );

        if(!updatedCoupon) {
            return res.status(404).json({
                success: false,
                message: 'Coupon not found'
            });
        }

        return res.status(200).json({
            success: true,
            message: `Coupon ${isActive ? 'activated' : 'deactivated'} successfully`,
            coupon: updatedCoupon
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};


module.exports={
    getCoupon,
    createCoupon,
    getCouponDetails,
    updateCoupon,
    toggleCouponStatus
}