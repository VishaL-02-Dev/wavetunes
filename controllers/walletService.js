const Wallet = require('../model/walletModel');
const User = require('../model/userModel');

class WalletService {
    static async createWallet(userId){
        try {
            const wallet = new Wallet({ userId, balance: 0});
            const savedWallet = await wallet.save();

            await User.findByIdAndUpdate(userId, {wallet: savedWallet._id});

            return savedWallet;
        } catch (error) {
            console.error('Error creating wallet:',error);
            throw error;
        }
    }

    static async getWallet(userId){
        try {
            let wallet = await Wallet.findOne({userId});

            if(!wallet){
                wallet = await this.createWallet(userId);
            }
            
            return wallet;

        } catch (error) {
            console.error('Error getting wallet:',error);
            throw error;
        }
    }

    static async addFunds(userId,amount,description,orderId = null){
        try {
            const wallet = await this.getWallet(userId);

            wallet.balance+=amount;
            wallet.transactions.push({
                amount,
                type:'credit',
                description,
                orderId: orderId || null
            });

            await wallet.save();
            return wallet;
        } catch (error) {
            console.log('Error adding funds to wallet:',error);
            throw error;
        }
    }

    static async deductFunds(userId,amount,description,orderId = null){
        try {
            const wallet = await this.getWallet(userId);

            if(wallet.balance<amount){
                throw new Error('Insufficient funds');
            }
            
            wallet.balance -= amount;
            wallet.transactions.push({
                amount,
                type:'debit',
                description,
                orderId
            });

            return wallet;
        } catch (error) {
            console.error('Error deducting funds from wallet:',error);
            throw error;
        }
    }
}

module.exports=WalletService;