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
const {loadLanding} = require('./controllers/userController')
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


app.get('/', loadLanding);


const userRoute = require('./routes/userRoutes');
app.use('/user', userRoute);

const adminRoute = require('./routes/adminRoutes');
app.use('/admin', adminRoute);


app.listen(3002, () => {
  console.log("Server running at port 3002");
});