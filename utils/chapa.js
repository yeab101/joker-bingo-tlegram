require("dotenv").config();
const request = require('request');
const crypto = require('crypto');
const User = require('../models/userModel');
const Transaction = require('../models/transactionModel');

async function initializeTransaction(amount, first_name, phone_number, chatId, bot) {
    const tx_ref = crypto.randomBytes(5).toString('hex');
    console.log(`Initializing transaction for chat ID ${chatId}:`, {
        amount,
        first_name,
        phone_number,
        tx_ref
    });

    let options = {
        'method': 'POST',
        'url': 'https://api.chapa.co/v1/transaction/initialize',
        'headers': {
            'Authorization': `Bearer ${process.env.CHAPASECRET}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            "amount": amount,
            "currency": "ETB",
            "email": "abebech_bekele@gmail.com",
            "first_name": first_name,
            "last_name": "Joker Bingo",
            "phone_number": phone_number,
            "tx_ref": tx_ref,
            "callback_url": "https://webhook.site/077164d6-29cb-40df-ba29-8a00e59a7e60",
            "return_url": "https://www.google.com/",
            "customization[title]": "Payment for my favourite merchant",
            "customization[description]": "I love online payments",
            "meta[hide_receipt]": "true"
        })
    };

    request(options, function (error, response) {
        if (error) {
            console.error("Error initializing transaction:", error);
            console.error("Transaction details:", { chatId, tx_ref, amount });
            bot.sendMessage(chatId, "There was an error processing your transaction. Please try again.");
            return;
        }

        try {
            console.log(`Raw response for tx_ref ${tx_ref}:`, response.body);
            const responseBody = JSON.parse(response.body);
            console.log(`Parsed response for tx_ref ${tx_ref}:`, responseBody);

            if (responseBody.status === "success" && responseBody.data && responseBody.data.checkout_url) {
                const checkoutUrl = responseBody.data.checkout_url;
                console.log(`Successfully generated checkout URL for tx_ref ${tx_ref}:`, checkoutUrl);
                bot.sendMessage(chatId, "Complete your payment by clicking the button below.", {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "Pay Now", url: checkoutUrl }]
                        ]
                    }
                });
            } else {
                console.error(`Invalid response for tx_ref ${tx_ref}:`, responseBody);
                bot.sendMessage(chatId, "There was an error with the transaction. Please try again.");
            }
        } catch (parseError) {
            console.error(`Parse error for tx_ref ${tx_ref}:`, parseError);
            console.error("Raw response that failed parsing:", response.body);
            bot.sendMessage(chatId, "There was an error processing your transaction. Please try again.");
        }
    });
}

async function verifyTransfer(reference) {
    const verifyOptions = {
        'method': 'GET',
        'url': `https://api.chapa.co/v1/transfers/verify/${reference}`,
        'headers': {
            'Authorization': `Bearer ${process.env.CHAPASECRET}`
        }
    };

    return new Promise((resolve, reject) => {
        request(verifyOptions, (error, response) => {
            if (error) reject(error);
            else resolve(JSON.parse(response.body));
        });
    });
}

async function initiateWithdraw(amount, account_name, account_number, chatId, bot, userId, bankCode) {
    try {
        const reference = crypto.randomBytes(8).toString('hex');
        const transferOptions = {
            'method': 'POST',
            'url': 'https://api.chapa.co/v1/transfers',
            'headers': {
                'Authorization': `Bearer ${process.env.CHAPASECRET}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                "account_name": account_name,
                "account_number": account_number,
                "amount": amount.toString(),
                "currency": "ETB",
                "reference": reference,
                "bank_code": bankCode,
                "beneficiary_name": account_name
            })
        };

        return new Promise((resolve, reject) => {
            request(transferOptions, async function (error, response) {
                if (error) {
                    console.error("Error initiating withdrawal:", error);
                    bot.sendMessage(chatId, "❌ There was an error processing your withdrawal. Please try again.");
                    reject(error);
                    return;
                }

                try {
                    const responseBody = JSON.parse(response.body);
                    console.log(`Withdrawal response for reference ${reference}:`, responseBody);

                    if (responseBody.status === "success") {
                        try {
                            // Verify the transfer
                            const verifyResult = await verifyTransfer(reference);
                            if (verifyResult.status !== "success") {
                                throw new Error("Transfer verification failed");
                            }

                            // Update user balance in database
                            const user = await User.findById(userId);
                            if (!user) {
                                bot.sendMessage(chatId, "User not found.");
                                reject(new Error("User not found"));
                                return;
                            }

                            // Create withdrawal transaction record
                            const transaction = new Transaction({
                                transactionId: reference,
                                chatId: chatId,
                                amount: amount,
                                status: verifyResult.data.status,
                                type: 'withdrawal'
                            });

                            // Deduct from user's balance
                            user.balance -= Number(amount);
                            
                            await user.save();
                            await transaction.save();

                            bot.sendMessage(chatId, 
                                `✅ Withdrawal of ${amount} ETB ${verifyResult.data.status}!\n` +
                                `Bank: ${verifyResult.data.bank_name}\n` +
                                `Account: ${account_number}\n` +
                                `Reference: ${reference}\n` +
                                `New balance: ${user.balance} ETB`
                            );
                            resolve(responseBody);
                        } catch (dbError) {
                            console.error("Database or verification error:", dbError);
                            bot.sendMessage(chatId, "❌ Error processing withdrawal. Please contact support.");
                            reject(dbError);
                        }
                    } else {
                        let errorMessage = "❌ Withdrawal request failed.";
                        if (responseBody.message === "Insufficient Balance") {
                            errorMessage = "❌ Service temporarily unavailable. Please try again later.";
                        } else if (responseBody.message) {
                            errorMessage = `❌ ${responseBody.message}`;
                        }

                        bot.sendMessage(chatId, errorMessage);
                        reject(new Error(responseBody.message || "Withdrawal failed"));
                    }
                } catch (parseError) {
                    console.error(`Parse error for reference ${reference}:`, parseError);
                    bot.sendMessage(chatId, "❌ There was an error processing your withdrawal. Please try again.");
                    reject(parseError);
                }
            });
        });
    } catch (error) {
        console.error("Withdrawal error:", error);
        bot.sendMessage(chatId, "❌ An unexpected error occurred. Please try again.");
        return Promise.reject(error);
    }
}

module.exports = {
    initializeTransaction,
    initiateWithdraw,
    verifyTransfer
};
