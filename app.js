// server
const mongoose = require('mongoose')
const express = require('express');
const app = express();
// const session=require('express-session');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const db = require('./config/db');
// const { checkSession }=require('./middleware/userAuth');
const passport = require('./config/passport');
const nocache = require('nocache');
const Product = require('./model/productModel');
const Category = require('./model/categoryModel');
db();
const cookieParser = require('cookie-parser');
app.use(express.static('node_modules/xlsx/dist'));
const session = require('express-session');

app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

app.use(express.json({ limit: '50mb' }));
app.use(nocache());
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

app.use(cookieParser());
app.use(passport.initialize());


//JWT token middleware
app.use((req, res, next) => {
  const token = req.cookies?.jwt || req.headers.authorization?.split(" ")[1]; // Get token from cookies or header
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      res.locals.user = decoded; // Store user data in res.locals for templates
      req.user = decoded; // Attach user data to req.user for route handlers
      // console.log("User authenticated:", decoded.fname);
      // console.log('Decoded user in the middleware ',decoded)
      if (decoded.role === 'admin') {
        res.locals.admin = decoded;
      }

    } catch (err) {
      console.log("JWT verification error:", err.message);
      res.locals.user = null;
      res.locals.admin = null;
      req.user = null;
    }
  } else {
    res.locals.user = null;
    res.locals.admin = null;
    req.user = null;
  }
  next();
});

const path = require('path');
app.set('view engine', 'ejs');
app.set('views', [path.join(__dirname, 'views'), path.join(__dirname, 'views/admin')]);


app.get('/', async (req, res) => {
  try {
    // Fetch listed categories
    const listedCategories = await Category.find({ status: "Listed" }).select('_id');
    const listedCategoryIds = listedCategories.map(category => category._id);

    // Fetch products with stock > 1, in listed categories, sorted by newest, limited to 8
    let products = await Product.find({
      stock: { $gt: 1 },
      isActive:true,
      category: { $in: listedCategoryIds },
      $or: [
        { offerEndDate: { $gte: new Date() } }, // Offers that are still valid
        { offerEndDate: null }, // Offers without an end date
        { offerPercentage: 0 } // Products without offers
      ]
    })
      .sort({ createdAt: -1 })
      .limit(8);

    // Add offerPrice to each product
    const productsWithOfferPrice = products.map(product => {
      const productObj = product.toObject();
      if (product.offerPercentage && product.offerPercentage > 0 && (product.offerEndDate === null || product.offerEndDate >= new Date())) {
        productObj.offerPrice = Math.round(product.price * (1 - product.offerPercentage / 100));
      }
      return productObj;
    });

    res.render('home', {
      products: productsWithOfferPrice,
      user: req.user || res.locals.user
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.render('home', { products: [], user: req.user || res.locals.user });
  }
});


const userRoute = require('./routes/userRoutes');
app.use('/user', userRoute);

const adminRoute = require('./routes/adminRoutes');
app.use('/admin', adminRoute);


app.listen(3002, () => {
  console.log("Server running at port 3002");
});