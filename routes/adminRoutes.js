const express=require('express');
const router=express.Router();
const adminController=require('../controllers/adminController');
const { verifyAdmin }=require('../middleware/auth')
const customerController=require('../controllers/customerController');
const categoryController=require('../controllers/categoriesController');
const productController=require('../controllers/productController');
const orderController=require('../controllers/orderController');
const couponController=require('../controllers/couponController');
const upload=require('../middleware/uploadMiddleware');

router.use(express.static('public'));
router.use(express.json());

//Login
router.get('/login',adminController.loadLogin);
router.post('/login',adminController.login);
router.get('/dashboard',verifyAdmin,adminController.getDashboard);
router.get('/logout',verifyAdmin,adminController.logout);
router.get('/customers',verifyAdmin,customerController.getCustomers);
router.post('/customers/:id',customerController.userStatus);

//Sales report
router.get('/sales-report', adminController.getSalesReport);

//Categories
router.get('/categories',verifyAdmin,categoryController.loadCategory);
router.post('/categories',categoryController.addCategory);
router.patch('/categories',categoryController.toggleCategoryStatus);
router.put('/categories',categoryController.editCategory);

//Products
router.get('/products',verifyAdmin,productController.adminProduct);
router.get('/products/:id',verifyAdmin, productController.getProduct);
router.post('/products',upload.array('images',4),productController.createProduct);
router.patch('/products/edit/:id',upload.array('images',4),productController.updateProduct);
router.delete('/products/:id', productController.deleteProduct);

//Orders
router.get('/orders',verifyAdmin,orderController.adminGetOrders);
router.get('/orders/:id',verifyAdmin,orderController.adminGetOrderDetails);
router.get('/orders/:id/items',verifyAdmin,orderController.adminGetOrderItems);
router.patch('/orders/:id/status',verifyAdmin,orderController.adminUpdateOrderStatus);
router.patch('/orders/:orderId/item/:itemId/status',verifyAdmin,orderController.adminUpdateOrderItemStatus);

//Coupons
router.get('/coupons',verifyAdmin,couponController.getCoupon);
router.post('/coupons',verifyAdmin,couponController.createCoupon);
router.get('/coupons/:id',verifyAdmin,couponController.getCouponDetails);
router.put('/coupons/:id',verifyAdmin,couponController.updateCoupon);
router.patch('/coupons/:id/toggle-status',verifyAdmin,couponController.toggleCouponStatus);

//Return Request
router.get('/return-requests', verifyAdmin, orderController.getReturnRequests);
router.post('/return-requests/:orderId/approve', orderController.adminApproveReturn);
router.post('/return-requests/:orderId/items/:itemId/approve', orderController.adminApproveReturn);


module.exports=router;