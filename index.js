const express = require('express')
const app = express();
const cors = require('cors');
const port = 3000;
const { Telegraf } = require('telegraf');
const { message } = require('telegraf/filters');
const moment = require('moment');
const mongoose = require('mongoose');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
require("dotenv").config();


// Import the User model
const User = require('./models/User');
const Rehearsal = require('./models/Rehearsal'); // Adjust path as necessary

mongoose.connect("mongodb://localhost:27017")
    .then(() => console.log('MongoDB connection established successfully!'))
    .catch(err => console.error('MongoDB connection failed:', err.message));
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

const BOT_START_MESSAGE = `
    *Бот студии Тюленва 25:*\n чтобы посмотреть расписание студии и забронировать репетицию\n запустите мини аппку по кнопке
`
bot.start((ctx) => ctx.reply(BOT_START_MESSAGE, { parse_mode: 'MARKDOWN' }));
bot.launch().then();
const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://127.0.0.1:443'); // Replace with your frontend's origin
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

app.get('/', (req, res) => {
    res.send('Hello World!');
});

// USERS

// USER Authentication
app.get('/api/users/auth', async (req, res) => {

});

// GET all users
app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find();
        res.json(users);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// POST a new user
app.post('/api/users/new', async (req, res) => {
    const user = new User({
        telegram_id: req.body.telegram_id,
        first_name: req.body.first_name,
        last_name: req.body.last_name,
        username: req.body.username,
        photo_url: req.body.photo_url,
        role: req.body.role
    });

    try {
        const newUser = await user.save();
        res.status(201).json(newUser);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// BOOKING REHEARSALS

app.post('/api/book', async (req, res) => {
    try {
        const { date, hours, username, band_name } = req.body;
        // The userId should ideally come from an authenticated user session
        // For this example, we'll use a placeholder.
        const userId = 'placeholder_user_id';

        // 1. Input Validation
        if (!date || !hours || !Array.isArray(hours) || hours.length === 0 || !username || !band_name || !userId) {
            return res.status(400).json({ error: 'Missing or invalid booking data.' });
        }

        const dateMoment = moment.utc(date, 'DD/MM/YYYY');
        if (!dateMoment.isValid()) {
            return res.status(400).json({ error: 'Invalid date format. Please use DD/MM/YYYY.' });
        }
        const bookingDate = dateMoment.startOf('day').toDate();

        // 2. Find the document for the day
        const rehearsalDoc = await Rehearsal.findOne({ date: bookingDate });

        // 3. Check for conflicts
        const conflictingHours = [];
        if (rehearsalDoc) {
            const bookedHours = rehearsalDoc.hours.map(slot => slot.hour);
            for (const hour of hours) {
                if (bookedHours.includes(hour)) {
                    conflictingHours.push(hour);
                }
            }
        }

        if (conflictingHours.length > 0) {
            return res.status(409).json({
                error: 'Some hours are already booked.',
                conflictingHours,
            });
        }

        // 4. Create the new booking sub-documents
        const newBookings = hours.map(hour => ({
            hour,
            userId,
            username,
            band_name
        }));

        // 5. Atomically push new hours to the document
        // Use findOneAndUpdate with $push to add new hours and upsert: true to create if needed
        const updatedRehearsal = await Rehearsal.findOneAndUpdate(
            { date: bookingDate },
            { $push: { hours: { $each: newBookings } } },
            { new: true, upsert: true } // Return updated doc, create if not exists
        );
        console.log('username: ', username, date, hours.join(','))
        const BOOK_MESSAGE = `
            ${username} забронировал репетицию ${date} ${hours.join(',')}
        `
        await bot.telegram.sendMessage(TELEGRAM_ADMIN_ID, BOOK_MESSAGE);
        return res.status(201).json(updatedRehearsal);
    } catch (err) {
        console.error('An error occurred during booking:', err);
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
});

app.delete('/api/cancel', async (req, res) => {
    try {
        const { date, hours, userId, username } = req.body;
        const isAdmin = false;
        // 1. Input Validation
        if (!date || !hours || !Array.isArray(hours) || hours.length === 0 || !userId) {
            return res.status(400).json({ error: 'Missing or invalid cancellation data.' });
        }

        const dateMoment = moment.utc(date, 'DD/MM/YYYY');
        if (!dateMoment.isValid()) {
            return res.status(400).json({ error: 'Invalid date format. Expected DD/MM/YYYY.' });
        }

        const bookingDate = dateMoment.startOf('day').toDate();
        // 2. Calculate the month's start and end dates
        const dateFrom = dateMoment.startOf('month').toDate();
        const dateTo = dateMoment.endOf('month').toDate();
        // 1. Find the document first to perform authorization checks.
        const rehearsalDoc = await Rehearsal.findOne({
            date: {
                $gte: dateFrom,
                $lte: dateTo,
            }
        });

        if (!rehearsalDoc) {
            return res.status(404).json({ error: 'No bookings found for this day.' });
        }
        // 2. Filter out hours the user is not authorized to cancel.
        const hoursToCancel = hours.filter(hour => {
            const booking = rehearsalDoc.hours.find(h => h.hour === hour);
            return booking && booking.userId === userId;
        });
        // 3. If no hours are authorized for cancellation, return an error.
        if (hoursToCancel.length === 0) {
            return res.status(403).json({ error: 'You are not authorized to cancel any of the selected bookings or they do not exist.' });
        }
        // 4. Perform the atomic update with a specific filter.
        const updatedRehearsal = await Rehearsal.findOneAndUpdate(
            // Use the _id to ensure you update the correct document.
            { _id: rehearsalDoc._id },
            // Use a specific $pull condition based on the user and hours to cancel.
            {
                $pull: {
                    hours: {
                        hour: { $in: hoursToCancel },
                        // For non-admins, ensure the userId matches. Admins can pull any hour.
                        ...(isAdmin ? {} : { userId: userId })
                    }
                }
            },
            { new: true }
        );
        const CANCEL_MESSAGE = `
            ${username} отменил репетицию ${date} ${hours.join(',')}
        `
        // 3. Handle the deletion if the hours array is now empty
        if (updatedRehearsal && updatedRehearsal.hours.length === 0) {
            await Rehearsal.deleteOne({ _id: updatedRehearsal._id });
            await bot.telegram.sendMessage(TELEGRAM_ADMIN_ID, CANCEL_MESSAGE);
            return res.status(200).json({ message: 'All bookings for this day canceled, document deleted.' });
        }

        // 4. Handle other outcomes
        if (!updatedRehearsal) {
            return res.status(404).json({ error: 'Booking not found or already canceled.' });
        }
        await bot.telegram.sendMessage(TELEGRAM_ADMIN_ID, CANCEL_MESSAGE);
        res.status(200).json({
            message: 'Bookings canceled successfully.',
            rehearsal: updatedRehearsal
        });

    } catch (err) {
        console.error('An error occurred during cancellation:', err);
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
});

app.get('/api/timetable', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');

    try {
        const { date } = req.query;
        // 1. Input Validation
        if (!date) {
            return res.status(400).json({ error: 'Missing or invalid booking date.' });
        }
        const dateMoment = moment(date, 'DD/MM/YYYY');
        if (!dateMoment.isValid()) {
            return res.status(400).json({ error: 'Invalid date format. Please use DD/MM/YYYY.' });
        }

        // 2. Calculate the month's start and end dates
        const dateFrom = dateMoment.startOf('month').toDate();
        const dateTo = dateMoment.endOf('month').toDate();

        // 3. Find all rehearsals with at least one booked hour in the month
        // $ne: [] finds all documents where the 'hours' array is not empty.
        const searchResults = await Rehearsal.find({
            date: {
                $gte: dateFrom,
                $lte: dateTo,
            },
            hours: { $ne: [] }
        });

        // 4. Extract and format the dates
        const datesToHighlight = searchResults.map(doc => moment(doc.date).format('DD/MM/YYYY'));

        res.status(200).json({ result: datesToHighlight });
    } catch (err) {
        console.error('An error occurred while fetching booked hours:', err);
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
});

app.get('/api/hours', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');

    try {
        // 1. Get the date string from query parameters
        const { date } = req.query; // Expected format, e.g., '29/10/2025'

        // Handle case where date is not provided
        if (!date) {
            return res.status(400).json({ message: 'Date query parameter is required.' });
        }

        // 2. Parse the date string using the correct format, and specify UTC
        const dateMoment = moment.utc(date, 'DD/MM/YYYY');

        // Check for an invalid date after parsing
        if (!dateMoment.isValid()) {
            return res.status(400).json({ message: 'Invalid date format. Expected DD/MM/YYYY.' });
        }

        // 3. Create the start and end of day in UTC for the database query
        const startOfDay = dateMoment.startOf('day').toDate();
        const endOfDay = dateMoment.endOf('day').toDate();

        // 4. Query the database
        const rehearsalRecord = await Rehearsal.findOne({
            date: {
                $gte: startOfDay,
                $lte: endOfDay
            }
        });

        // 5. Handle found vs. not found record and return the correct data
        if (!rehearsalRecord) {
            // Return an empty array if no record for that day was found
            return res.status(200).json({ hours: [] });
        }

        // Return the hours array from the found record
        return res.status(200).json({ hours: rehearsalRecord.hours });

    } catch (error) {
        console.error('Error fetching hours:', error);
        return res.status(500).json({ message: 'Server error' });
    }
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
});
