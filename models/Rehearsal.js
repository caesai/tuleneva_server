const mongoose = require('mongoose');

// Define the schema for a single time slot booking
const bookedHourSchema = new mongoose.Schema({
    hour: { type: String, required: true }, // e.g., '10:00'
    userId: { type: String, required: true },
    username: { type: String, required: true },
    band_name: { type: String, required: true },
}, { _id: false });

// Define the main Rehearsal schema
const rehearsalSchema = new mongoose.Schema(
    {
        date: {
            type: Date,
            required: true,
            unique: true, // One document per day
        },
        hours: {
            type: [bookedHourSchema], // An array of booked time slots
            default: [],
        },
    },
    {
        timestamps: true,
    }
);

const Rehearsal = mongoose.model('Rehearsal', rehearsalSchema);
module.exports = Rehearsal;
