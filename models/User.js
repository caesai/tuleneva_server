const mongoose = require('mongoose');

// Define the schema for the User model
const userSchema = new mongoose.Schema(
    {
        telegram_id: {
            type: Number,
            required: true,
            unique: true
        },
        first_name: {
            type: String,
            required: true
        },
        last_name: {
            type: String
        },
        username: {
            type: String
        },
        photo_url: {
            type: String
        },
        role: {
            type: String,
            enum: ['admin', 'user', 'guest'],
            default: 'user'
        }
    },
    {
        timestamps: true // Adds createdAt and updatedAt timestamps automatically
    }
);

// Create the User model from the schema
const User = mongoose.model('User', userSchema);

module.exports = User;
