const express=require('express');
const router=express.Router();
const adminController=require('../controllers/adminController');
const {loginSession,checkSession}=require('../middleware/adminAuth')
const customerController=require('../controllers/customerController');
const categoryController=require('../controllers/categoriesController');
const productController=require('../controllers/productController');
const upload=require('../middleware/uploadMiddleware');

router.use(express.static('public'));
router.use(express.json());

router.get('/login',loginSession,adminController.loadLogin);
router.post('/login',adminController.login);
router.get('/dashboard',checkSession,adminController.getDashboard);
router.get('/logout',adminController.logout);
router.get('/customers',checkSession,customerController.getCustomers);
router.post('/customers/:id',customerController.userStatus);

router.get('/categories',checkSession,categoryController.loadCategory);
router.post('/categories',categoryController.addCategory);
router.patch('/categories',categoryController.toggleCategoryStatus);
router.put('/categories',categoryController.editCategory);


router.get('/products',checkSession,productController.adminProduct);
router.get('/products/:id', checkSession, productController.getProduct);
router.post('/products',upload.array('images',4),productController.createProduct);
router.patch('/products/edit/:id',upload.array('images',4),productController.updateProduct);


module.exports=router;