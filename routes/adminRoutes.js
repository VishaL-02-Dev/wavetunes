const express=require('express');
const router=express.Router();
const adminController=require('../controllers/adminController');
const { protect, authorize, optionalProtect }=require('../middleware/auth')
const customerController=require('../controllers/customerController');
const categoryController=require('../controllers/categoriesController');
const productController=require('../controllers/productController');
const orderController=require('../controllers/orderController');
const couponController=require('../controllers/couponController');
const upload=require('../middleware/uploadMiddleware');

router.use(express.static('public'));
router.use(express.json());

//Login
router.get('/login',optionalProtect,adminController.loadLogin);
router.post('/login',optionalProtect,adminController.login);
router.get('/dashboard', protect,authorize('admin'),adminController.getDashboard);
router.get('/logout',protect,authorize('admin'),adminController.logout);
router.get('/customers',protect,authorize('admin'),customerController.getCustomers);
router.post('/customers/:id',protect,authorize('admin'),customerController.userStatus);

//Sales report
router.get('/sales-report',protect,authorize('admin'), adminController.getSalesReport);
router.get('/sales-report-details', protect,authorize('admin'),adminController.getSalesReportDetails);
router.get('/top-products', protect,authorize('admin'),adminController.getTopProducts);
//Categories
router.get('/categories',protect,authorize('admin'),categoryController.loadCategory);
router.post('/categories',protect,authorize('admin'),categoryController.addCategory);
router.patch('/categories',protect,authorize('admin'),categoryController.toggleCategoryStatus);
router.put('/categories',protect,authorize('admin'),categoryController.editCategory);

//Products
router.get('/products',protect,authorize('admin'),productController.adminProduct);
router.get('/products/:id', protect,authorize('admin'),productController.getProduct);
router.post('/products',protect,authorize('admin'),upload.array('images',4),productController.createProduct);
router.patch('/products/edit/:id',protect,authorize('admin'),upload.array('images',4),productController.updateProduct);
router.patch('/products/:id',protect,authorize('admin'), productController.toggleProductStatus);

//Orders
router.get('/orders',protect,authorize('admin'),orderController.adminGetOrders);
router.get('/orders/:id',protect,authorize('admin'),orderController.adminGetOrderDetails);
router.get('/orders/:id/items',protect,authorize('admin'),orderController.adminGetOrderItems);
router.patch('/orders/:id/status',protect,authorize('admin'),orderController.adminUpdateOrderStatus);
router.patch('/orders/:orderId/item/:itemId/status',protect,authorize('admin'),orderController.adminUpdateOrderItemStatus);

//Coupons
router.get('/coupons',protect,authorize('admin'),couponController.getCoupon);
router.post('/coupons',protect,authorize('admin'),couponController.createCoupon);
router.get('/coupons/:id',protect,authorize('admin'),couponController.getCouponDetails);
router.put('/coupons/:id',protect,authorize('admin'),couponController.updateCoupon);
router.patch('/coupons/:id/toggle-status',protect,authorize('admin'),couponController.toggleCouponStatus);

//Return Request
router.get('/return-requests',protect,authorize('admin'),orderController.getReturnRequests);
router.post('/return-requests/:orderId/approve',protect,authorize('admin'), orderController.adminApproveReturn);
router.post('/return-requests/:orderId/items/:itemId/approve',protect,authorize('admin'), orderController.adminApproveReturn);


module.exports=router;