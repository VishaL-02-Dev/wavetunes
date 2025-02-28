const checkSession = (req,res,next)=>{
    if(req.session.user || req.isAuthenticated()){
        next();
    }
    else{
        res.redirect('/');
    }
}

const loginSession = (req,res,next)=>{
    if(req.session.user || req.isAuthenticated()){
        res.redirect('/user/home');
    }
    else{
        next();
    }
}

module.exports={
    checkSession,
    loginSession
}
