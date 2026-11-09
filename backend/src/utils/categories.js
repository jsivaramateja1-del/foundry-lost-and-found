/**
 * The category tree.
 *
 * The keys are the main categories stored on a listing; the values are the
 * subcategories the form offers once that category is chosen. A listing stores
 * both, so search and filters can work at either level.
 *
 * "Other" is deliberately absent: a listing in "Other" carries a free-text
 * customCategory instead, which is why it has no fixed subcategories.
 */
const CATEGORY_TREE = {
  Electronics: [
    'Mobile Phones', 'Earphones', 'Headphones', 'Chargers',
    'Laptops', 'Tablets', 'Smartwatches', 'Other Electronics'
  ],
  'IDs & Cards': ['Student ID', 'Debit/Credit Card', 'Driving Licence', 'Access Card', 'Other'],
  Bags: ['Backpack', 'Laptop Bag', 'Handbag', 'Wallet', 'Other'],
  'Books & Notes': ['Textbooks', 'Notebooks', 'Printed Notes', 'Stationery', 'Other'],
  Bottles: ['Water Bottle', 'Flask', 'Tumbler', 'Other'],
  'Keys & Accessories': ['Keys', 'Keychains', 'Spectacles', 'Umbrellas', 'Other'],
  Clothing: ['Shirts', 'Jackets', 'Shoes', 'Accessories', 'Other'],
  Other: []
};

const CATEGORIES = Object.keys(CATEGORY_TREE);

const LOCATIONS = [
  'AB1',
  'AB2',
  'Sai Baba Temple',
  'Girls Hostel',
  'Lords',
  'Animal Planet',
  'Guruvayur',
  'Mamatha',
  'Harihar',
  'Football Ground',
  'Cricket Nets',
  'Volleyball Courts',
  'Tennis Court',
  'Basketball Court',
  'Outside Campus'
];

/** The subcategories offered for one category (empty array when there are none). */
const subcategoriesFor = (category) => CATEGORY_TREE[category] || [];

/**
 * A subcategory is optional, but when it is given it has to belong to the
 * chosen category — otherwise the stored pair would be nonsense.
 */
const isValidSubcategory = (category, subcategory) => {
  if (subcategory === undefined || subcategory === null || subcategory === '') return true;
  return subcategoriesFor(category).includes(String(subcategory));
};

module.exports = {
  CATEGORY_TREE,
  CATEGORIES,
  LOCATIONS,
  subcategoriesFor,
  isValidSubcategory
};
