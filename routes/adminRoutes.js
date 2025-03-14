const express=require('express');
const router=express.Router();
const adminController=require('../controllers/adminController');
const { verifyAdmin }=require('../middleware/auth')
const customerController=require('../controllers/customerController');
const categoryController=require('../controllers/categoriesController');
const productController=require('../controllers/productController');
const upload=require('../middleware/uploadMiddleware');

router.use(express.static('public'));
router.use(express.json());

router.get('/login',adminController.loadLogin);
router.post('/login',adminController.login);
router.get('/dashboard',verifyAdmin,adminController.getDashboard);
router.get('/logout',verifyAdmin,adminController.logout);
router.get('/customers',verifyAdmin,customerController.getCustomers);
router.post('/customers/:id',customerController.userStatus);

router.get('/categories',verifyAdmin,categoryController.loadCategory);
router.post('/categories',categoryController.addCategory);
router.patch('/categories',categoryController.toggleCategoryStatus);
router.put('/categories',categoryController.editCategory);


router.get('/products',verifyAdmin,productController.adminProduct);
router.get('/products/:id',verifyAdmin, productController.getProduct);
router.post('/products',upload.array('images',4),productController.createProduct);
router.patch('/products/edit/:id',upload.array('images',4),productController.updateProduct);
router.delete('/products/:id', productController.deleteProduct);

module.exports=router;