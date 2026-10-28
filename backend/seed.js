/**
 * Seeds the database with demo users and 12 sample listings.
 * Run with:  npm run seed
 * WARNING: this deletes all existing items, claims and users.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('./src/config/db');
const User = require('./src/models/User');
const Item = require('./src/models/Item');
const Claim = require('./src/models/Claim');

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

const ITEMS = [
  { title: 'Black Wireless Earbuds', description: 'Boat earbuds in a black case, left on a table near the reading room window. The case has a small scratch on the lid.', category: 'Electronics', location: 'Library', type: 'found', days: 1 },
  { title: 'Student ID Card - CSE 2nd Year', description: 'Found an ID card near the canteen counter. Name partly worn off. Contact the office to verify ownership.', category: 'IDs & Cards', location: 'Canteen', type: 'found', days: 1 },
  { title: 'Blue Nike Backpack', description: 'Lost my navy blue backpack with a laptop sleeve. Contains a maths notebook and a calculator. Please contact if found.', category: 'Bags', location: 'Main Block', type: 'lost', days: 2 },
  { title: 'Data Structures Textbook', description: 'Cormen CLRS hardcover left in the third floor study area. Has my name written inside the front cover.', category: 'Books & Notes', location: 'Library', type: 'lost', days: 2 },
  { title: 'Steel Water Bottle', description: 'Silver Milton bottle with a dented base, found on a bench outside the sports complex.', category: 'Bottles', location: 'Sports Complex', type: 'found', days: 3 },
  { title: 'Bunch of Hostel Keys', description: 'Three keys on a red keychain with a small torch. Found near the Hostel A gate.', category: 'Keys & Accessories', location: 'Hostel A', type: 'found', days: 3 },
  { title: 'Black Umbrella', description: 'Left a plain black umbrella in the auditorium after the seminar on Tuesday.', category: 'Other', customCategory: 'Umbrella', location: 'Auditorium', type: 'lost', days: 4 },
  { title: 'Casio FX-991 Calculator', description: 'Found a scientific calculator in the parking area. Display works fine. Owner should describe the sticker on the back.', category: 'Electronics', location: 'Parking', type: 'found', days: 4 },
  { title: 'Grey Hoodie', description: 'Lost a grey hoodie with a small tear on the left sleeve, probably in the canteen.', category: 'Clothing', location: 'Canteen', type: 'lost', days: 5 },
  { title: 'Spiral Physics Notes', description: 'Handwritten physics notes in a green spiral notebook, first semester topics. Found in Main Block room 204.', category: 'Books & Notes', location: 'Main Block', type: 'found', days: 6 },
  { title: 'Apple Charger 20W', description: 'White Apple charging brick left plugged in near the library charging point. Cable not included.', category: 'Electronics', location: 'Library', type: 'found', days: 7 },
  { title: 'Hostel B Room Key', description: 'Single key with a blue plastic tag, lost somewhere between the mess and Hostel B.', category: 'Keys & Accessories', location: 'Hostel B', type: 'lost', days: 8 }
];

(async () => {
  try {
    await connectDB();

    await Promise.all([Item.deleteMany({}), Claim.deleteMany({}), User.deleteMany({})]);
    console.log('Cleared existing data');

    const admin = await User.create({
      name: 'Campus Admin',
      email: 'admin@saiuniversity.edu.in',
      password: 'admin123',
      role: 'admin'
    });
    const student = await User.create({
      name: 'Demo Student',
      email: 'student@saiuniversity.edu.in',
      password: 'student123',
      role: 'student'
    });
    const finder = await User.create({
      name: 'Priya Nair',
      email: 'priya@saiuniversity.edu.in',
      password: 'priya123',
      role: 'student',
      points: 20,
      returns: 2
    });

    const reporters = [student, finder, admin];
    const docs = ITEMS.map((it, i) => ({
      title: it.title,
      description: it.description,
      category: it.category,
      customCategory: it.customCategory,
      location: it.location,
      date: daysAgo(it.days),
      type: it.type,
      status: 'open',
      reportedBy: reporters[i % reporters.length]._id
    }));

    const created = await Item.insertMany(docs);
    console.log(`Inserted ${created.length} sample items`);

    // One pending claim so the review screen has something to show
    const foundItem = created.find((c) => c.type === 'found' && c.reportedBy.toString() !== student._id.toString());
    if (foundItem) {
      await Claim.create({
        item: foundItem._id,
        claimant: student._id,
        message: 'I think this is mine. It has a small scratch on the lid - happy to describe it in person.'
      });
      console.log('Inserted 1 sample claim');
    }

    console.log('\nDemo accounts:');
    console.log('  admin   admin@saiuniversity.edu.in   / admin123');
    console.log('  student student@saiuniversity.edu.in / student123');
    console.log('\nSeed complete.');
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  }
})();
