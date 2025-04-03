const User = require('../model/userModel');
const Address = require('../model/addressModel')
const jwt = require('jsonwebtoken');


//Add address
const addAddress = async (req, res) => {
    const token = req.cookies.jwt;
    const { type, address, city, state, district, pinCode, phone, isDefault} = req.body;
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'User not found'
            });
        }

        let addressType = type;
        if (addressType === 'Home') addressType = 'Home';
        if (addressType === 'Work') addressType = 'Work';
        if (addressType === 'Other') addressType = 'Other';
        
        

        const newAddress = new Address({
            userId: user._id,
            addressType:addressType,
            address,
            city,
            state,
            district,
            pinCode,
            phone,
            isDefault: isDefault || false
        });

        if (isDefault) {
            await Address.updateMany(
                { userId: user._id, isDefault: true },
                { $set: { isDefault: false } }
            );
        }

        console.log('Address', newAddress);

        const savedAddress=await newAddress.save();

        if(!user.addresses){
            user.addresses=[];
        }
        
        user.addresses.push(savedAddress._id);
        await user.save();

        return res.status(200).json({
            success: true,
            message: 'Address added successfully',
            address: savedAddress
        });

    } catch (error) {
        console.error('Error adding address: ', error);
        return res.status(500).json({
            success: false,
            message: 'Error adding address'
        });
    }
};
//Get Address
const getAddress= async(req,res)=>{
    const token=req.cookies.jwt;
    const addressIndex=parseInt(req.params.index);

    try {
        const decoded=jwt.verify(token, process.env.JWT_SECRET);
        const user= await User.findById(decoded.id);

        if(!user){
            return res.status(401).json({
                success:false,
                message:'User not found'
            });
        }

        const addresses= await Address.find({userId: user._id});
        if(!addresses || addressIndex<0 || addressIndex>= addresses.length){
            return res.status(404).json({
                success:false,
                message:'Address not found'
            });
        }

        const address=addresses[addressIndex];
        console.log('Returning address: ',address);
        return res.status(200).json(address);
    } catch (error) {
        console.error('Error fetching address: ',error);
        return res.status(500).json({
            success:false,
            message:'Error fetching address'
        });
    }
}

//Edit Address
const editAddress=async(req,res)=>{
    const token=req.cookies.jwt;
    const { type, address, city, state, district, pinCode, phone, isDefault } = req.body;
    const addressIndex=req.params.index;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);
     
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'User not found'
            });
        }

        const addresses= await Address.find({userId: user._id});
        
        if(!addresses || addressIndex<0 || addressIndex>=addresses.length){
            return res.status(404).json({
                success:false,
                message:'Address not found'
            });
        }
        
        let updatedAddress=addresses[addressIndex];

        updatedAddress.address=address;
        updatedAddress.city=city;
        updatedAddress.state=state;
        updatedAddress.district=district;
        updatedAddress.pinCode=pinCode;
        updatedAddress.phone=phone;
        updatedAddress.addressType=type;
        updatedAddress.isDefault=isDefault;

        await updatedAddress.save();

        return res.status(200).json({
            success:true,
            message:'Address updated'
        });

    } catch (error) {
        console.error('Error in updation',error);
        return res.status(500).json({
            success:false,
            message:'Error updating address'
        });
    }
}

//Set the default address
const setDefault=async(req,res)=>{
    const token=req.cookies.jwt;
    const {addressIndex}=req.body;

    try {
        const decoded=jwt.verify(token, process.env.JWT_SECRET);
        const user= await User.findById(decoded.id);

        if(!user){
            return res.status(401).json({
                success:false,
                message:'User not found'
            });
        }

        const addresses= await Address.find({userId: user._id});

        if(!addresses|| addressIndex<0 || addressIndex>=addresses.length){
            return res.status(404).json({
                success:false,
                message:'Address not found'
            });
        }

        const index = parseInt(addressIndex, 10);
        if (isNaN(index) || index < 0 || index >= addresses.length) {
            return res.status(404).json({
                success: false,
                message: 'Invalid address index'
            });
        }

        const address=addresses[index];

        await Address.updateMany(
            {userId:user._id,_id:{$ne:address._id}, isDefault:true},
            {$set:{isDefault:false}}
        );

        address.isDefault=true;
        await address.save();

        return res.status(200).json({
            success:true,
            message:'Default address set'
        });
    } catch (error) {
        console.error('Error setting default address: ',error);
        return res.status(500).json({
            success:false,
            message:'Error setting default address'
        });
    }
}

//Delete the given address
const deleteAddress=async(req,res)=>{
    const token= req.cookies.jwt;
    const { addressIndex }=req.body;

    try {
        const decoded=jwt.verify(token, process.env.JWT_SECRET);
        const user= await User.findById(decoded.id);

        if(!user){
            return res.status(401).json({
                success:false,
                message:'User not found'
            });
        }

        const addresses=await Address.find({userId:user._id});
        const index=parseInt(addressIndex,10);
        if(isNaN(index) || !addresses || addressIndex<0 || addressIndex>=addresses.length){
            return res.status(404).json({
                success:false,
                message:'Address not found'
            })
        }

        const addressToDelete= addresses[index];
        await Address.findByIdAndDelete(addressToDelete._id);

        // await user.save();

        return res.status(200).json({
            success:true,
            message:'Address deleted'
        });

    } catch (error) {
        console.error('Error deleting address: ',error);
        return res.status(500).json({
            success:false,
            message:'Error deleting address'
        });
    }
}


module.exports = {
    addAddress,
    getAddress,
    editAddress,
    setDefault,
    deleteAddress
}