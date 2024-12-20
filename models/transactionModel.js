const mongoose = require('mongoose');

// Define the Transaction schema with timestamps
const transactionSchema = new mongoose.Schema({
    transactionId: { type: String, unique: true, required: true },
    chatId: { type: String, required: true },
    recipientChatId: { type: String  },
    amount: { type: Number, required: true },
    status: { 
        type: String, 
        enum: ['success', 'failed', 'pending_withdrawal', 'completed'],
        required: true 
    },
    type: {
        type: String,
        enum: ['deposit', 'withdrawal', 'transfer'],
        required: true
    }, 
    errorMessage: { 
        type: String,
        required: function() { return this.status === 'failed'; }
    }
}, { timestamps: true });  

// Create the Transaction model
const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;