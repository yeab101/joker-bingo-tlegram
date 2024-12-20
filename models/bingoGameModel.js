const mongoose = require('mongoose');

// Function to generate an array of 75 unique random numbers
const generateRandomNumbers = () => {
  const numbers = [];
  while (numbers.length < 75) {
    const randomNumber = Math.floor(Math.random() * 75) + 1;
    if (!numbers.includes(randomNumber)) {
      numbers.push(randomNumber);
    }
  }
  return numbers;
};

const bingoGameSchema = new mongoose.Schema({
  gameId: {
    type: Number 
  },
  selectedCartela: [{
    type: Number
  }],
  playerCartelas: [{
    chatId: Number,
    cartela: Number
  }],
  stake: {
    type: Number, 
    default: 10,
    enum: [0, 10, 20, 50, 100]
  },
  cutPercentage: {
    type: Number 
  },
  winAmount: {
    type: Number, 
  },
  profitAmount: {
    type: Number, 
  },
  randomNumbers: {
    type: [Number],
    default: generateRandomNumbers 
  }, 
  winnerCartela: {
    type: Number
  },
  winnerUser: {
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User'
  },
  gameStatus: {
    type: String,
    default: "waiting",
    enum: ["waiting", "started", "finished"]
  }, 
  calledNumbers: { 
    type: [Number]
  },
  markedCardKey: {
    type: [String]
  }, 
  winningPatterns: {
    type: [String],
    default: ["n3"]
  },
  preBoughtCartelas: [{
    chatId: Number,
    cartela: Number
  }]
}, {
  timestamps: true
});

bingoGameSchema.pre('save', async function(next) {
  if (this.isNew) {
    const lastGame = await this.constructor.findOne({}, {}, { sort: { 'createdAt': -1 } });
    this.gameId = lastGame ? lastGame.gameId + 1 : 1;
  }
  next();
});

const BingoGame = mongoose.model('BingoGame', bingoGameSchema);

module.exports = BingoGame;
