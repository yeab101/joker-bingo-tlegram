const Transaction = require("../models/transactionModel");

const historyHandlers = {
    showHistory: async (chatId, bot) => {
        try {
            const transactions = await Transaction.find({
                $or: [
                    { chatId: chatId },
                    { recipientChatId: chatId }
                ]
            })
                .sort({ updatedAt: -1 })
                .limit(10);

            if (!transactions || transactions.length === 0) {
                await bot.sendMessage(chatId, "No transaction history found.");
                return;
            }

            await bot.sendMessage(chatId, "Last 10 Transactions:");

            // Send each transaction as a separate message
            for (const [index, transaction] of transactions.entries()) {
                const date = new Date(transaction.createdAt).toLocaleDateString();
                const type = transaction?.type?.toUpperCase();
                const amount = transaction?.amount;
                const status = transaction?.status?.toUpperCase();

                let details = '';
                if (transaction?.type === 'withdrawal') {
                    details = ` \n ${transaction?.bankType} - ${transaction?.bankNumber}`;
                } else if (transaction?.type === 'transfer') {
                    details = transaction?.chatId === chatId
                        ? ` \n To: ${transaction?.recipientChatId}`
                        : ` \n From: ${transaction?.chatId}`;
                }

                if (transaction?.status === 'failed') {
                    details += ` \n Error: ${transaction?.errorMessage}`;
                }

                const message = `${index + 1}. ${date} \n ${type} \n Amount: ${amount} Birr \n Status: ${status}${details}`;

                // Add a small delay to prevent flooding
                await new Promise(resolve => setTimeout(resolve, 100));
                await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
            }
        } catch (error) {
            console.error("Error fetching history:", error);
            await bot.sendMessage(chatId, "Error fetching transaction history. Please try again.");
        }
    }
};

module.exports = historyHandlers;
