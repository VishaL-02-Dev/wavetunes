const checkAdmin=(req,res,next)=>{ 
    cons
    if(user.isAdmin){
        console.log("The user is an admin");
    }
    else{
        console.log("The user is not an admin");
    }
    next();
}

module.exports=checkAdmin;