const passport = require('passport');
const googleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../model/userModel');
const env = require('dotenv').config();

passport.use(new googleStrategy({
    clientID:process.env.GOOGLE_CLIENT_ID,
        clientSecret:process.env.GOOGLE_CLIENT_SECRET,
        callbackURL:process.env.CALLBACK_URI
},

async (accessToken,refreshToken,profile,done)=>{
    try {
        let user = await User.findOne({googleId:profile.id});

        if(user){
            return done(null,user);
        }else{
            const nameParts = profile.displayName.split(" ");
            const fname = nameParts[0];  // First Name
            const lname = nameParts.slice(1).join(" ");  // Last Name

            user = new User({
                fname:fname,
                lname:lname,
                email:profile.emails[0].value,
                googleId:profile.id,
            });
            await user.save();
            return done(null,user);
        }


    } catch (error) {
        return done(error,null);
    }
}
));

passport.serializeUser((user,done)=>{
    done(null,user.id);
});

passport.deserializeUser(async (id,done)=>{
    try {
        const user= await User.findById(id);
        done(null,user);
    } catch (error) {
        done(error,null);
    }
})

module.exports = passport;