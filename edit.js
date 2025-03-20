categoryController
_______________________________________

const { query } = require("express");
const Category = require("../../models/categorySchema.js");
const { MongoCryptCreateDataKeyError } = require("mongodb");



const categoryInfo = async (req, res) => {
    try {
        let search = req.query.search || '';
        const page = parseInt(req.query.page) || 1;
        const limit = 3;
        const skip = (page - 1) * limit;

        const categoryData = await Category.find({
            $or: [
                { name: { $regex: "." + search + ".", $options: "i" } },
                { description: { $regex: "." + search + ".", $options: "i" } }
            ]
        })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const totalCategories = await Category.countDocuments({
            $or: [
                { name: { $regex: "." + search + ".", $options: "i" } },
                { description: { $regex: "." + search + ".", $options: "i" } }
            ]
        });

        const totalPages = Math.ceil(totalCategories / limit);
        
        res.render("category", {
            cat: categoryData,
            currentPage: page,
            totalPages: totalPages,
            totalCategories: totalCategories
        });

    } catch (error) {
        console.error(error);
        res.redirect("/pageError"); 
    }
};


const addCategory = async (req,res)=>{
    console.log(req.body)
    const {name,description} = req.body;
    try {
        const normalizedName = name.trim().toLowerCase();
        const existingCategory = await Category.findOne({name:normalizedName});
        //const existingCategory = await Category.findOne({name});
        if(existingCategory){
            return res.status(400).json({error:"Category already exists"})
        }
        const newCategory = new Category({
            name:normalizedName,
            //name,
            description,
        })
        await newCategory.save();
        return res.json({message:"Category added successfully"})
    } catch (error) {
        return res.status(500).json({error:"Internal Server Error"})
    }
};

const getEditCategory= async (req,res)=>{
    try {
        const id = req.query.id;
        const category= await Category.findOne({_id:id});
        
        res.render("editCategory",{category:category});

    } catch (error) {
        
        res.redirect("/pageerror")
    }
};




const editCategory = async (req,res)=>{
    try {
        const id=req.params.id;
        const {categoryName,description}=req.body;

        const normalizedCategoryName = categoryName.trim().toLowerCase();

        const existingCategory = await Category.findOne({name:normalizedCategoryName,_id: { $ne: id } });


        if(existingCategory){
            return res.status(400).json({error:"Category exists, please choose another name"})
        }

        const updatedCategory = await Category.findByIdAndUpdate(id,{
            name:normalizedCategoryName,
            description:description,
        },{new:true,runValidators:true});

        if(!updatedCategory){
            return res.status(404).json({success:false,message:'Category not found'});
        }

        res.json({ success: true, message: 'Category updated successfully' });
  
    } catch (error) {
        res.status(500).json({error:"Internal server error"})
    }

}


// const getListCategory = async (req,res)=>{
//     try {
//         let id = req.query.id;
//         await Category.updateOne({_id:id},{$set:{isListed:false}});
//         res.redirect("/admin/category");
       
//     } catch (error) {
//         res.redirect("/pageerror");
//     }
// };

// const getUnlistCategory = async (req,res)=>{
//     try {
//         let id = req.query.id;
//         await Category.updateOne({_id:id},{$set:{isListed:true}});
//         res.redirect("/admin/category")
       
//     } catch (error) {
//         res.redirect("/pageerror");
//     }
// }

const getListCategory = async (req, res) => {
    try {
        let id = req.query.id;
        await Category.updateOne({ _id: id }, { $set: { isListed: true } });
        res.json({ success: true, message: "Category unlisted successfully" }); 
    } catch (error) {
        console.error("Error unlisting category:", error);
        res.status(500).json({ success: false, message: "Something went wrong" });
    }
};

const getUnlistCategory = async (req, res) => {
    try {
        let id = req.query.id;
        await Category.updateOne({ _id: id }, { $set: { isListed: false } });
        res.json({ success: true, message: "Category listed successfully" });  
    } catch (error) {
        console.error("Error listing category:", error);
        res.status(500).json({ success: false, message: "Something went wrong" });
    }
};


module.exports ={
    categoryInfo,
    addCategory,
    getEditCategory,
    editCategory,
    getListCategory,
    getUnlistCategory,
};


 // Global variables for image handling
 let imagesToRemove = [];

 document.getElementById("addProductForm").addEventListener("submit", async function (event) {
     event.preventDefault();

     const formData = new FormData(this);
     const files = document.getElementById("productImages").files;

     if (files.length === 0) {
         Swal.fire("Error", "Please add at least one product image", "error");
         return;
     }

     try {
         // Upload images to Cloudinary
         const uploadedImages = await uploadImagesToCloudinary(files);
         uploadedImages.forEach((imageUrl, index) => {
             formData.append('images', imageUrl);
         });

         const response = await fetch("/admin/products", {
             method: "POST",
             body: formData,
         });

         const result = await response.json();
         if (result.success) {
             Swal.fire("Success", "Product added successfully!", "success")
                 .then(() => window.location.reload());
         } else {
             Swal.fire("Error", result.message, "error");
         }
     } catch (error) {
         Swal.fire("Error", "Something went wrong!", "error");
     }
 });

 // Helper function to upload images to Cloudinary
 // Add these logs to your uploadImagesToCloudinary function
 async function uploadImagesToCloudinary(files) {
     console.log("Starting upload to Cloudinary with files:", files);
     
     const uploadPromises = Array.from(files).map(file => {
         console.log("Preparing to upload file:", file.name);
         const formData = new FormData();
         formData.append("file", file);
         formData.append("upload_preset", "my_upload_preset"); // Make sure this is correct
         
         return fetch(`https://api.cloudinary.com/v1_1/drdggqz62/image/upload`, {
             method: "POST",
             body: formData,
         })
         .then(response => {
             console.log("Cloudinary response status:", response.status);
             return response.json();
         })
         .then(data => {
             console.log("Cloudinary response data:", data);
             return data.secure_url;
         })
         .catch(error => {
             console.error("Error uploading to Cloudinary:", error);
             throw error;
         });
     });

     return Promise.all(uploadPromises);
 }

 // Handle image selection and preview (no cropping)
 document.getElementById('productImages').addEventListener('change', function (e) {
     const files = e.target.files;

     if (files.length > 4) {
         Swal.fire("Error", "Maximum 4 images allowed", "error");
         this.value = '';
         return;
     }

     const previewContainer = document.getElementById('croppedImagesPreviews');
     previewContainer.innerHTML = '';

     Array.from(files).forEach((file, index) => {
         const reader = new FileReader();
         reader.onload = function (e) {
             const previewDiv = document.createElement('div');
             previewDiv.className = 'preview-item position-relative m-1';
             previewDiv.innerHTML = `
         <img src="${e.target.result}" alt="Preview image ${index + 1}" 
              style="width: 80px; height: 80px; object-fit: cover;">
         <button type="button" class="btn btn-danger btn-sm position-absolute" 
                 style="top: 0; right: 0; padding: 0 5px;" 
                 onclick="removeImage(${index})">×</button>
     `;
             previewContainer.appendChild(previewDiv);
         };
         reader.readAsDataURL(file);
     });
 });

 // Function to remove a preview image
 function removeImage(index) {
     const previewContainer = document.getElementById('croppedImagesPreviews');
     previewContainer.children[index].remove();
 }

 // Delete Product
 async function deleteProduct(productId) {
     Swal.fire({
         title: "Are you sure?",
         text: "This action cannot be undone!",
         icon: "warning",
         showCancelButton: true,
         confirmButtonText: "Yes, delete!",
         cancelButtonText: "Cancel"
     }).then(async (result) => {
         if (result.isConfirmed) {
             try {
                 const response = await fetch(`/admin/products/${productId}`, {
                     method: "DELETE",
                     headers: { 'Content-Type': 'application/json' },
                 });

                 const data = await response.json();
                 if (data.success) {
                     Swal.fire("Deleted!", "Product has been removed.", "success")
                         .then(() => window.location.reload());
                 } else {
                     Swal.fire("Error", data.message, "error");
                 }
             } catch (error) {
                 Swal.fire("Error", "Something went wrong!", "error");
             }
         }
     });
 }

 // Edit Product (Fetch and display product data)
 async function editProduct(productId) {
     try {
         const response = await fetch(`/admin/products/${productId}`);
         if (!response.ok) throw new Error(`Failed to fetch product: ${response.statusText}`);

         const data = await response.json();
         const product = data.product;

         document.getElementById("editProductId").value = product._id;
         document.getElementById("editProductName").value = product.name;
         document.getElementById("editProductBrand").value = product.brand;
         document.getElementById("editProductDescription").value = product.description;
         document.getElementById("editProductSpecification").value = typeof product.specifications === 'string' ? product.specifications : JSON.stringify(product.specifications);
         document.getElementById("editProductPrice").value = product.price;
         document.getElementById("editProductStock").value = product.stock;
         document.getElementById("editProductCategory").value = product.category._id;

         document.getElementById('editExistingImagesContainer').innerHTML = '';
         product.images.forEach((img, index) => {
             const imgContainer = document.createElement('div');
             imgContainer.classList.add("position-relative", "m-2");

             const image = document.createElement("img");
             image.src = img; // Assuming img is a Cloudinary URL
             image.classList.add("existing-image", "img-thumbnail");
             image.style.maxWidth = "100px";
             imgContainer.appendChild(image);

             const removeButton = document.createElement("button");
             removeButton.classList.add("btn", "btn-danger", "btn-sm", "position-absolute", "top-0", "end-0");
             removeButton.innerText = "X";
             removeButton.onclick = function () {
                 removeExistingImage(index);
             };

             imgContainer.appendChild(removeButton);
             document.getElementById("editExistingImagesContainer").appendChild(imgContainer);
         });

         function removeExistingImage(index) {
             imagesToRemove.push(index);
             document.getElementById("editExistingImagesContainer").children[index].style.display = "none";
         }

         const editModal = new bootstrap.Modal(document.getElementById('editProductModal'));
         editModal.show();
     } catch (error) {
         Swal.fire("Error", "Failed to fetch product details", "error");
     }
 }

 // Submit Edit Product Form
 document.getElementById("editProductForm").addEventListener("submit", async function (event) {
     event.preventDefault();

     const productId = document.getElementById("editProductId").value;
     const formData = new FormData(this);
     const files = document.getElementById("editProductImages").files;

     if (files.length > 0) {
         const uploadedImages = await uploadImagesToCloudinary(files);
         uploadedImages.forEach(url => formData.append("images", url));
     }

     if (imagesToRemove.length > 0) {
         formData.append("removeImages", JSON.stringify(imagesToRemove));
     }

     try {
         const response = await fetch(`/admin/products/edit/${productId}`, {
             method: "PATCH",
             body: formData,
         });

         const data = await response.json();
         if (data.success) {
             Swal.fire("Success", "Product updated successfully!", "success")
                 .then(() => location.reload());
         } else {
             Swal.fire("Error", data.message || "Update failed", "error");
         }
     } catch (error) {
         Swal.fire("Error", "Something went wrong while updating the product", "error");
     }
 });

 // Handle image selection and preview for edit
 document.getElementById('editProductImages').addEventListener('change', function (e) {
     const files = e.target.files;

     if (files.length > 4) {
         Swal.fire("Error", "Maximum 4 images allowed", "error");
         this.value = '';
         return;
     }

     const previewContainer = document.getElementById('editCroppedImagesPreviews');
     previewContainer.innerHTML = '';

     Array.from(files).forEach((file, index) => {
         const reader = new FileReader();
         reader.onload = function (e) {
             const previewDiv = document.createElement('div');
             previewDiv.className = 'preview-item position-relative m-1';
             previewDiv.innerHTML = `
         <img src="${e.target.result}" alt="Preview image ${index + 1}" 
              style="width: 80px; height: 80px; object-fit: cover;">
         <button type="button" class="btn btn-danger btn-sm position-absolute" 
                 style="top: 0; right: 0; padding: 0 5px;" 
                 onclick="removeEditImage(${index})">×</button>
     `;
             previewContainer.appendChild(previewDiv);
         };
         reader.readAsDataURL(file);
     });
 });

 // Function to remove a cropped edit image preview
 function removeEditImage(index) {
     const previewContainer = document.getElementById('editCroppedImagesPreviews');
     previewContainer.children[index].remove();
 }