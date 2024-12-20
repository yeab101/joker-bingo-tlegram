const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const userSchema = new Schema({
  chatId: {
    type: Number,
    required: true,
    unique: true,  
  },
  phoneNumber: {  
    type: String,  
    // required: true,
    unique: true, 
  },
  username: {
    type: String,
    required: true,
  },
  balance: {
    type: Number,
    default: 10,
  },
  firstname: {
    type: String,
  }
}, {
  timestamps: true,  
});

const User = mongoose.model("User", userSchema);

module.exports = User;
