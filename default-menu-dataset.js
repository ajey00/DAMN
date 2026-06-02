// default-menu-dataset.js
// Default menu dataset for Restaurant QR Ordering System

const DEFAULT_MENU = [
{ id: 1, name: "Paneer Tikka", price: 220, category: "Starters", type: "veg", image: "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=400&h=300&fit=crop", available: true },
{ id: 2, name: "Hara Bhara Kebab", price: 180, category: "Starters", type: "veg", image: "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=400&h=300&fit=crop", available: true },
{ id: 3, name: "Veg Manchurian", price: 200, category: "Starters", type: "veg", image: "https://images.unsplash.com/photo-1626074353765-517a681e40be?w=400&h=300&fit=crop", available: true },
{ id: 4, name: "Chilli Paneer", price: 240, category: "Starters", type: "veg", image: "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=400&h=300&fit=crop", available: true },
{ id: 5, name: "Chicken Tikka", price: 280, category: "Starters", type: "nonveg", image: "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=400&h=300&fit=crop", available: true },
{ id: 6, name: "Chicken 65", price: 260, category: "Starters", type: "nonveg", image: "https://images.unsplash.com/photo-1610057099443-fde8c4d50f91?w=400&h=300&fit=crop", available: true },
{ id: 7, name: "Tandoori Chicken", price: 320, category: "Starters", type: "nonveg", image: "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=400&h=300&fit=crop", available: true },
{ id: 8, name: "Fish Amritsari", price: 340, category: "Starters", type: "nonveg", image: "https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?w=400&h=300&fit=crop", available: true },

{ id: 11, name: "Butter Chicken", price: 350, category: "Main Course", type: "nonveg", image: "https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=400&h=300&fit=crop", available: true },
{ id: 12, name: "Chicken Curry", price: 320, category: "Main Course", type: "nonveg", image: "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=400&h=300&fit=crop", available: true },
{ id: 15, name: "Paneer Butter Masala", price: 280, category: "Main Course", type: "veg", image: "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=400&h=300&fit=crop", available: true },
{ id: 16, name: "Kadai Paneer", price: 270, category: "Main Course", type: "veg", image: "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=400&h=300&fit=crop", available: true },
{ id: 18, name: "Dal Tadka", price: 180, category: "Main Course", type: "veg", image: "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=400&h=300&fit=crop", available: true },
{ id: 19, name: "Dal Makhani", price: 220, category: "Main Course", type: "veg", image: "https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=400&h=300&fit=crop", available: true },

{ id: 23, name: "Butter Naan", price: 50, category: "Indian Breads", type: "veg", image: "https://images.unsplash.com/photo-1619870802883-25fd7c562f8a?w=400&h=300&fit=crop", available: true },
{ id: 24, name: "Garlic Naan", price: 60, category: "Indian Breads", type: "veg", image: "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=400&h=300&fit=crop", available: true },
{ id: 25, name: "Tandoori Roti", price: 35, category: "Indian Breads", type: "veg", image: "https://images.unsplash.com/photo-1628840042765-356cda07504e?w=400&h=300&fit=crop", available: true },

{ id: 30, name: "Jeera Rice", price: 150, category: "Rice", type: "veg", image: "https://images.unsplash.com/photo-1596560548464-f010549b84d7?w=400&h=300&fit=crop", available: true },
{ id: 31, name: "Veg Pulao", price: 180, category: "Rice", type: "veg", image: "https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=400&h=300&fit=crop", available: true },
{ id: 33, name: "Chicken Biryani", price: 320, category: "Rice", type: "nonveg", image: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=400&h=300&fit=crop", available: true },

{ id: 37, name: "Samosa", price: 40, category: "Snacks", type: "veg", image: "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=400&h=300&fit=crop", available: true },
{ id: 38, name: "Pav Bhaji", price: 120, category: "Snacks", type: "veg", image: "https://images.unsplash.com/photo-1606491956689-2ea866880c84?w=400&h=300&fit=crop", available: true },
{ id: 40, name: "Masala Dosa", price: 100, category: "Snacks", type: "veg", image: "https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=400&h=300&fit=crop", available: true },

{ id: 44, name: "Gulab Jamun", price: 80, category: "Desserts", type: "veg", image: "https://images.unsplash.com/photo-1589301773859-cb853794e9ca?w=400&h=300&fit=crop", available: true },
{ id: 45, name: "Rasmalai", price: 100, category: "Desserts", type: "veg", image: "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=400&h=300&fit=crop", available: true },
{ id: 48, name: "Kulfi", price: 60, category: "Desserts", type: "veg", image: "https://images.unsplash.com/photo-1582716401301-b2407dc7563d?w=400&h=300&fit=crop", available: true },

{ id: 51, name: "Mango Lassi", price: 80, category: "Drinks", type: "veg", image: "https://images.unsplash.com/photo-1505252585461-04db1eb84625?w=400&h=300&fit=crop", available: true },
{ id: 54, name: "Cold Coffee", price: 90, category: "Drinks", type: "veg", image: "https://images.unsplash.com/photo-1517487881594-2787fef5ebf7?w=400&h=300&fit=crop", available: true },
{ id: 56, name: "Chocolate Milkshake", price: 100, category: "Drinks", type: "veg", image: "https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=400&h=300&fit=crop", available: true }
];
