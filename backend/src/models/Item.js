const mongoose = require('mongoose');

const CATEGORIES = [
  'Electronics',
  'IDs & Cards',
  'Bags',
  'Books & Notes',
  'Bottles',
  'Keys & Accessories',
  'Clothing',
  'Other'
];

const LOCATIONS = [
  'Library',
  'Main Block',
  'Canteen',
  'Hostel A',
  'Hostel B',
  'Sports Complex',
  'Auditorium',
  'Parking',
  'Other'
];

const itemSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Item name is required'],
      trim: true,
      maxlength: [120, 'Item name cannot exceed 120 characters']
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters']
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      enum: { values: CATEGORIES, message: 'Invalid category' }
    },
    // When category is "Other" the user must describe it here
    customCategory: {
      type: String,
      trim: true,
      maxlength: [60, 'Custom category cannot exceed 60 characters']
    },
    location: {
      type: String,
      required: [true, 'Campus location is required'],
      enum: { values: LOCATIONS, message: 'Invalid location' }
    },
    customLocation: { type: String, trim: true, maxlength: 60 },
    date: {
      type: Date,
      required: [true, 'Date is required']
    },
    type: {
      type: String,
      required: [true, 'Listing type is required'],
      enum: { values: ['lost', 'found'], message: 'Type must be lost or found' }
    },
    status: {
      type: String,
      enum: ['open', 'claimed', 'returned', 'closed'],
      default: 'open'
    },
    // Optional image: a URL or a small base64 data URL
    imageUrl: { type: String, trim: true, maxlength: 500000, default: '' },
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  { timestamps: true }
);

// Indexes for the search and filter features
itemSchema.index({ title: 'text', description: 'text' });
itemSchema.index({ category: 1, type: 1 });
itemSchema.index({ location: 1 });
itemSchema.index({ date: -1 });

module.exports = mongoose.model('Item', itemSchema);
module.exports.CATEGORIES = CATEGORIES;
module.exports.LOCATIONS = LOCATIONS;
