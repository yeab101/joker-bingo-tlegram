const User = require("../models/userModel");  
const Transaction = require("../models/transactionModel");   
const bankList = require('./banklist.json');
const { initializeTransaction, initiateWithdraw } = require('./chapa');

const getValidInput = async (bot, chatId, prompt, validator) => {
    while (true) {
        try {
            await bot.sendMessage(chatId, prompt);
            const response = await new Promise((resolve, reject) => {
                const messageHandler = (msg) => {
                    if (msg.chat.id === chatId) {
                        bot.removeListener('message', messageHandler);
                        resolve(msg);
                    }
                };
                bot.on('message', messageHandler);
                setTimeout(() => {
                    bot.removeListener('message', messageHandler);
                    reject(new Error('Response timeout'));
                }, 60000);
            });

            if (validator(response.text)) {
                return response.text;
            } else {
                await bot.sendMessage(chatId, "Invalid input. Please try again.");
            }
        } catch (error) {
            console.error('Error getting input:', error);
            await bot.sendMessage(chatId, "Something went wrong. Please try again.");
        }
    }
}; 
 
const transactionHandlers = {
    deposit: async (chatId, bot) => {
        try {
            const user = await User.findOne({ chatId });
            if (!user) {
                await bot.sendMessage(chatId, "Please register first to make a deposit.");
                return;
            }

            const first_name = user.username;
            const phone_number = user.phoneNumber;

            if (!first_name || !phone_number) {
                await bot.sendMessage(chatId, "Please set a username and phone number in your Telegram settings and try again.");
                return;
            }

            const amount = await getValidInput(
                bot,
                chatId,
                "Enter amount to deposit (10 ETB - 1000 ETB):",
                (text) => {
                    const num = parseFloat(text);
                    return !isNaN(num) && num >= 10 && num <= 1000;
                }
            );

            // await bot.sendMessage(
            //     chatId,
            //     `${first_name} is trying to deposit ${amount} ETB`
            // );
            
            await initializeTransaction(amount, first_name, phone_number, chatId, bot);

        } catch (error) {
            console.error("Error initiating deposit:", error);
            await bot.sendMessage(chatId, "An unexpected error occurred. Please try again later.");
        }
    },

    withdraw: async (chatId, bot) => {
        try {
            // 1. Check if user is registered
            const user = await User.findOne({ chatId });
            if (!user) {
                await bot.sendMessage(chatId, "Please register first to withdraw funds.");
                return;
            }

            // 2. Get withdrawal amount
            const amount = await getValidInput(
                bot,
                chatId,
                "Enter amount to withdraw (25 ETB - 1000 ETB):",
                (text) => {
                    const num = parseFloat(text);
                    return !isNaN(num) && num >= 9 && num <= 1000;
                }
            );

            // 3. Check balance
            if (user.balance < parseFloat(amount)) {
                await bot.sendMessage(chatId, "Insufficient balance for this withdrawal.");
                return;
            }

            // 4. Create bank selection buttons from banklist.json
            const bankButtons = bankList.banks.map(bank => [{
                text: bank.name,
                callback_data: `bank_${bank.id}`
            }]);

            // 5. Get bank selection
            const bankSelection = await new Promise((resolve, reject) => {
                bot.sendMessage(chatId, "Select your wallet type:", {
                    reply_markup: {
                        inline_keyboard: bankButtons
                    }
                });

                const callbackQueryHandler = async (callbackQuery) => {
                    if (callbackQuery.message.chat.id === chatId) {
                        // Answer the callback query to remove the loading state
                        await bot.answerCallbackQuery(callbackQuery.id);
                        
                        // Remove the keyboard after selection
                        await bot.editMessageReplyMarkup(
                            { inline_keyboard: [] },
                            {
                                chat_id: chatId,
                                message_id: callbackQuery.message.message_id
                            }
                        );

                        bot.removeListener('callback_query', callbackQueryHandler);
                        resolve(callbackQuery.data);
                    }
                };

                bot.on('callback_query', callbackQueryHandler);

                // Add timeout
                setTimeout(() => {
                    bot.removeListener('callback_query', callbackQueryHandler);
                    reject(new Error('Selection timeout'));
                }, 60000); // 1 minute timeout
            });

            const bankId = parseInt(bankSelection.split('_')[1]);
            const selectedBank = bankList.banks.find(bank => bank.id === bankId);

            // 6. Get wallet number
            const walletNumber = await getValidInput(
                bot,
                chatId,
                `Enter your ${selectedBank.name} wallet number:`,
                (text) => /^(09|07)\d{8}$/.test(text) // Validates Ethiopian phone numbers
            );

            // 7. Get account name
            const accountName = await getValidInput(
                bot,
                chatId,
                "Enter the account holder's full name:",
                (text) => text.length >= 3 && /^[a-zA-Z\s]+$/.test(text) // At least 3 chars, letters and spaces only
            );

            try {
                // 8. Initiate withdrawal through Chapa with correct bank code
                await initiateWithdraw(
                    amount,
                    accountName,  // Use provided account name instead of username
                    walletNumber,
                    chatId,
                    bot,
                    user._id,
                    selectedBank.id
                );

            } catch (withdrawError) {
                console.error("Withdrawal initiation error:", withdrawError);
                await bot.sendMessage(
                    chatId, 
                    "Failed to process withdrawal. Please try again or contact support."
                );
            }

        } catch (error) {
            console.error("Error handling withdrawal:", error);
            await bot.sendMessage(chatId, "Error processing withdrawal. Please try again.");
        }
    },

    transfer: async (chatId, bot) => {
        try {
            const sender = await User.findOne({ chatId });
            if (!sender) {
                await bot.sendMessage(chatId, "Please register first to transfer funds.");
                return;
            }

            const amount = await getValidInput(
                bot,
                chatId,
                "Enter amount to transfer (10 ETB - 10000 ETB):",
                (text) => {
                    const num = parseFloat(text);
                    return !isNaN(num) && num >= 10 && num <= 10000;
                }
            );

            // Check if sender has sufficient balance
            if (sender.balance < parseFloat(amount)) {
                await bot.sendMessage(chatId, "Insufficient balance for this transfer.");
                return;
            }

            const recipientPhone = await getValidInput(
                bot,
                chatId,
                "Enter recipient's phone number (format: 09xxxxxxxx):",
                (text) => /^09\d{8}$/.test(text)
            );

            // Find recipient by phone number
            const recipient = await User.findOne({ phoneNumber: recipientPhone });
            if (!recipient) {
                await bot.sendMessage(chatId, "Recipient not found. Please check the phone number and try again.");
                return;
            }

            // Prevent self-transfer
            if (recipient.chatId === chatId) {
                await bot.sendMessage(chatId, "You cannot transfer to yourself.");
                return;
            }

            // Generate transaction ID
            const transactionId = `TR${Date.now()}${Math.random().toString(36).substr(2, 4)}`;

            // Create transfer transaction record
            await new Transaction({
                transactionId,
                chatId,
                recipientChatId: recipient.chatId,
                amount: parseFloat(amount),
                status: 'completed',
                type: 'transfer'
            }).save();

            // Update balances
            sender.balance -= parseFloat(amount);
            recipient.balance += parseFloat(amount);
            await sender.save();
            await recipient.save();

            // Notify both parties
            await bot.sendMessage(
                chatId,
                `Transfer successful!\nAmount: ${amount} ETB\nTo: ${recipientPhone}\nTransaction ID: ${transactionId}`
            );
            await bot.sendMessage(
                recipient.chatId,
                `You received ${amount} ETB from ${sender.phoneNumber}\nTransaction ID: ${transactionId}`
            );

        } catch (error) {
            console.error("Error handling transfer:", error);
            await bot.sendMessage(chatId, "Error processing transfer. Please try again. /transfer");
        }
    },

};

module.exports = transactionHandlers; 