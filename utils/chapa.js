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
    console.log(`[Verification] Starting verification for ref ${reference}`);
    
    const verifyOptions = {
        'method': 'GET',
        'url': `https://api.chapa.co/v1/transfers/verify/${reference}`,
        'headers': {
            'Authorization': `Bearer ${process.env.CHAPASECRET}`
        }
    };

    return new Promise((resolve, reject) => {
        request(verifyOptions, (error, response) => {
            if (error) {
                console.error(`[Verification] Error for ref ${reference}:`, error);
                reject(error);
                return;
            }
            
            const result = JSON.parse(response.body);
            console.log(`[Verification] Result for ref ${reference}:`, JSON.stringify(result, null, 2));
            resolve(result);
        });
    });
}

async function initiateWithdraw(amount, account_name, account_number, chatId, bot, userId, bankCode) {
    try {
        const reference = `WD${Date.now()}_${chatId}_${Math.random().toString(36).substring(2, 7)}`;
        
        // Debug bank code
        console.log(`[Withdrawal] Debug Info:`, {
            bankCode,
            typeof: typeof bankCode,
            account_number,
            amount
        });

        const transferPayload = {
            "account_name": account_name,
            "account_number": account_number,
            "amount": amount.toString(),
            "currency": "ETB",
            "reference": reference,
            "bank_code": bankCode.toString(), // Ensure bank_code is a string
            "beneficiary_name": account_name
        };

        const transferOptions = {
            'method': 'POST',
            'url': 'https://api.chapa.co/v1/transfers',
            'headers': {
                'Authorization': `Bearer ${process.env.CHAPASECRET}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(transferPayload)
        };

        // Log the exact payload being sent
        console.log(`[Withdrawal] Request payload for ref ${reference}:`, JSON.stringify(transferPayload, null, 2));

        return new Promise((resolve, reject) => {
            request(transferOptions, async function (error, response) {
                if (error) {
                    console.error(`[Withdrawal] Request error for ref ${reference}:`, error);
                    bot.sendMessage(chatId, "❌ There was an error processing your withdrawal. Please try again.");
                    reject(error);
                    return;
                }

                try {
                    const responseBody = JSON.parse(response.body);
                    console.log(`[Withdrawal] Raw Chapa response:`, response.body);
                    console.log(`[Withdrawal] Parsed Chapa response:`, responseBody);

                    if (responseBody.status === "success") {
                        try {
                            // Wait a few seconds before verifying
                            await new Promise(resolve => setTimeout(resolve, 3000));
                            
                            console.log(`[Withdrawal] Verifying transfer for ref ${reference}`);
                            const verifyResult = await verifyTransfer(reference);
                            console.log(`[Withdrawal] Verification result:`, JSON.stringify(verifyResult, null, 2));

                            if (verifyResult.status !== "success") {
                                throw new Error(`Transfer verification failed: ${verifyResult.message}`);
                            }

                            // Update user balance
                            const user = await User.findById(userId);
                            if (!user) {
                                throw new Error("User not found");
                            }

                            // Create transaction record
                            const transaction = new Transaction({
                                transactionId: reference,
                                chatId: chatId,
                                amount: amount,
                                status: verifyResult.data.status,
                                type: 'withdrawal',
                                details: {
                                    bankCode,
                                    accountNumber: account_number,
                                    accountName: account_name
                                }
                            });

                            user.balance -= Number(amount);
                            
                            await user.save();
                            await transaction.save();

                            const successMessage = 
                                `✅ Withdrawal Request Processed\n\n` +
                                `Amount: ${amount} ETB\n` +
                                `Bank: ${verifyResult.data?.bank_name || 'Not specified'}\n` +
                                `Account: ${account_number}\n` +
                                `Reference: ${reference}\n` +
                                `Status: ${verifyResult.data?.status || 'Pending'}\n` +
                                `New Balance: ${user.balance} ETB`;

                            bot.sendMessage(chatId, successMessage);
                            resolve(responseBody);

                        } catch (dbError) {
                            console.error(`[Withdrawal] Database/verification error for ref ${reference}:`, dbError);
                            bot.sendMessage(chatId, "❌ Error processing withdrawal. Please contact support.");
                            reject(dbError);
                        }
                    } else {
                        console.error(`[Withdrawal] Failed response for ref ${reference}:`, {
                            status: responseBody.status,
                            message: responseBody.message,
                            data: responseBody.data
                        });

                        let errorMessage = "❌ Withdrawal request failed.";
                        
                        if (responseBody.message === "Insufficient Balance") {
                            errorMessage = "❌ The payment service is currently unavailable. Please try again later or contact support.";
                        } else if (responseBody.message) {
                            errorMessage = `❌ Error: ${responseBody.message}`;
                        }

                        bot.sendMessage(chatId, errorMessage);
                        reject(new Error(responseBody.message || "Withdrawal failed"));
                    }
                } catch (parseError) {
                    console.error(`[Withdrawal] Parse error for ref ${reference}:`, parseError);
                    console.error("Raw response that failed parsing:", response.body);
                    bot.sendMessage(chatId, "❌ There was an error processing your withdrawal. Please try again.");
                    reject(parseError);
                }
            });
        });
    } catch (error) {
        console.error("[Withdrawal] Critical error:", error);
        bot.sendMessage(chatId, "❌ An unexpected error occurred. Please try again.");
        return Promise.reject(error);
    }
}

module.exports = {
    initializeTransaction,
    initiateWithdraw,
    verifyTransfer
};
