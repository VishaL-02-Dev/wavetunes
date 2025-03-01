const mongoose=require('mongoose')
const express= require('express');
const app= express();
const session=require('express-session');
const dotenv=require('dotenv').config();
const db= require('./config/db');
const { checkSession }=require('./middleware/userAuth');
const passport = require('./config/passport');
const nocache=require('nocache');
const Product=require('./model/productModel');
db();

app.use(express.json({limit:'50mb'}));
app.use(nocache());
app.use(express.urlencoded({ limit:'50mb',extended: true }));
app.use(express.static('public'));
app.use(session({
    secret:process.env.SESSION_SECRET,
    resave:false,
    saveUninitialized:true,
    cookie:{secure:false, httpOnly:true, maxAge:72 * 60 * 60 * 1000}
}));


app.use(passport.initialize());
app.use(passport.session());
app.use((req, res, next) => {
    if (req.isAuthenticated()) {
        req.session.user = req.user;
    }
    next();
});

app.use((req, res, next) => {
    res.locals.user = req.session.user || req.user ||  null;
    next();
});


const path=require('path');
app.set('view engine','ejs');
app.set('views',[path.join(__dirname,'views'),path.join(__dirname,'views/admin')]);

// app.get('/',(req,res)=>{
//     res.render('home');
// });

app.get('/', async (req, res) => {
    try {
      let products = await Product.find({ inStock: true }).sort({ createdAt: -1 }).limit(12);

      let latestProducts= await Product.find().sort({createdAt:-1}).limit(8);

      products = products.map(product => {
        return {
            ...product.toObject(),
            images: product.images.map(img => 
                `data:${img.contentType};base64,${img.data.toString('base64')}`
            )
        };
    });

        
      latestProducts = latestProducts.map(product => {
        return {
            ...product.toObject(),
            images: product.images.map(img => 
                `data:${img.contentType};base64,${img.data.toString('base64')}`
            )
        };
    });

      res.render('home', { 
        products,
        latestProducts 
    });
    } catch (error) {
      console.error('Error fetching products:', error);
      res.render('home', { products: [] });
    }
  });


const userRoute=require('./routes/userRoutes');
app.use('/user',userRoute);

const adminRoute=require('./routes/adminRoutes');
app.use('/admin',adminRoute);


app.listen(3002,()=>{
    console.log("Server running at port 3002");
});