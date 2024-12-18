require('dotenv').config(); // Load environment variables from .env file

var express = require('express')
var ejs = require('ejs')
var bodyParser = require('body-parser');
var mysql = require('mysql');
var session = require('express-session');
var multer = require('multer');
var path = require('path');
var axios = require('axios');
var bcrypt = require('bcrypt');
var Paystack = require('paystack')('sk_test_18f7439965d26efa61b524c6c6a719a824d41105'); // Correct authorization format
var punycode = require('punycode'); // Using the userland module instead of the built-in

var app = express();

// Define the sql connection at the top
var con = mysql.createConnection({
    host:"localhost",
    user:"root",
    password:"",
    database:"node_project"
});

con.connect((err) => { 
    if (err) { 
        console.error('Error connecting to MySQL:', err); 
        return; 
    } 
    console.log('Connected to MySQL');
});

// Example values for insertion
const vendorId = 1;
const productId = 10;
const quantity = 10;
const amount = 100.00;
const saleDate = '2024-12-12 12:00:00';

// Query to insert values into sales_history
const insertQuery = 'INSERT INTO sales_history (vendor_id, product_id, quantity, amount, sale_date) VALUES (?, ?, ?, ?, ?)';
con.query(insertQuery, [vendorId, productId, quantity, amount, saleDate], (err, result) => {
  if (err) {
    console.error('Error inserting sales history:', err);
  } else {
    console.log('Inserted sales history successfully:', result);
  }
});



//set view engine and views directory //localhost:8080
app.set('view engine','ejs');
app.set('views', path.join(__dirname, 'views'));


// Middleware to parse JSON and URL-encoded data 
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));


app.use(express.static(path.join(__dirname, 'public')));

app.use(bodyParser.urlencoded({extended:true}));
app.use('/uploads', express.static('uploads'));
app.use(session({
    secret: "secret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));


app.listen(8080, () =>{
    console.log('Server running on port 8080');
});


// Configure multer storage 
const storage = multer.diskStorage({ 
    destination: function (req, file, cb) { 
        cb(null, 'uploads/'); 
    }, 
    filename: function (req, file, cb) { 
        cb(null, file.fieldname + '-' + Date.now() + '.jpeg'); 
    }
});


const upload = multer({ storage: storage });



function isProductInCart(cart,id){

    for(let i=0; i<cart.length; i++){
        if(cart[i].id == id){
            return true;
        }
    }

    return false;
}


// Function to add product to cart
function addProductToCart(userId, productId, res) {
    // Example query to add product to cart
    const addProductQuery = "INSERT INTO cart (user_id, product_id, quantity) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE quantity = quantity + 1";
    con.query(addProductQuery, [userId, productId], (err, result) => {
        if (err) {
            console.error('Error adding product to cart:', err);
            return res.status(500).send('Error adding product to cart');
        }
        res.redirect('/main-homepage');
    });
}



// Function to update cart totals
function updateCartTotals(userId, res) {
    const cartTotalQuery = `
        SELECT SUM(p.price * c.quantity) AS total
        FROM cart c
        JOIN products p ON c.product_id = p.id
        WHERE c.user_id = ?
    `;
    con.query(cartTotalQuery, [userId], (err, result) => {
        if (err) {
            console.error('Error calculating cart total:', err);
            return res.status(500).send('Error calculating cart total');
        }
        const cartTotal = result[0].total || 0;
        console.log('Updated cart total:', cartTotal);
        res.redirect('/main-homepage');
    });
}

// Authentication middleware
function authMiddleware(req, res, next) { 
    if (!req.session.user) { 
        return res.redirect('/login'); 
    } 
    next();
 }

// Vendor Middleware
function vendorMiddleware(req, res, next) {
    if (req.session.user && req.session.user.role === 'vendor') {
        next();
    } else {
        res.redirect('/customer-homepage');
    }
}

// Customer Middleware
function customerMiddleware(req, res, next) {
    if (req.session.user && req.session.user.role === 'customer') {
        next();
    } else {
        res.redirect('/vendor-homepage');
    }
}



// Function to update sales history whenever a user checks out
function updateSalesHistory(cart, userId) {
    // Create the sales data from the cart
    const salesData = cart.map(item => {
        return {
            vendor_id: item.vendor_id,     // Vendor ID from cart item
            product_id: item.product_id,   // Product ID from cart item
            quantity: item.quantity,       // Quantity of product being purchased
            amount: item.price * item.quantity, // Total amount for the product
            sale_date: new Date().toISOString().slice(0, 19).replace('T', ' ') // Current date and time
        };
    });

    // Loop through the salesData and insert each record into the sales_history table
    salesData.forEach(sale => {
        const query = `
            INSERT INTO sales_history (vendor_id, product_id, quantity, amount, sale_date) 
            VALUES (${sale.vendor_id}, ${sale.product_id}, ${sale.quantity}, ${sale.amount}, '${sale.sale_date}')
        `;
        
        // Execute the query
        db.query(query, (err, result) => {
            if (err) {
                console.error("Error updating sales history:", err);
                return;
            }
            console.log("Sales history updated for product:", sale.product_id);
        });
    });

    // After updating sales history, you can clear the cart
    clearUserCart(userId);
}

// Function to clear the user's cart after checkout
function clearUserCart(userId) {
    const query = `DELETE FROM cart WHERE user_id = ${userId}`;
    
    db.query(query, (err, result) => {
        if (err) {
            console.error("Error clearing cart:", err);
            return;
        }
        console.log("Cart cleared for user:", userId);
    });
}

// Function to generate a payment reference
function generatePaymentReference() {
    return 'PAY-' + Math.random().toString(36).substr(2, 9).toUpperCase();
}





app.get('/', (req, res) => {
    var query = "SELECT * FROM products";
    con.query(query, (err, result) => {
        if (err) {
            console.error('Error fetching products:', err);
            return res.status(500).send('Error fetching products');
        }
        res.render('pages/index', { 
            products: result, // Pass the products as 'result' to the view
            searchQuery: "", // Default to an empty string for the homepage
            user: req.session.user // Optional: Pass user session to show personalized content
        });
    });
});



// Add to cart route
app.post('/add-to-cart', authMiddleware, customerMiddleware, (req, res) => {
    const productId = req.body.productId;
    const quantity = parseInt(req.body.quantity, 10);
    const cart = req.session.cart || [];
    const total = req.session.total || 0;

    const productQuery = "SELECT * FROM products WHERE id = ?";
    con.query(productQuery, [productId], (err, products) => {
        if (err) {
            console.error('Error fetching product:', err);
            return res.status(500).send('Error fetching product');
        }

        if (products.length === 0) {
            return res.status(404).send('Product not found');
        }

        const product = products[0];
        const existingItem = cart.find(item => item.product_id === productId);

        if (existingItem) {
            existingItem.quantity += quantity;
        } else {
            cart.push({
                product_id: productId,
                product_name: product.name,
                product_price: product.price,
                quantity: quantity
            });
        }

        req.session.cart = cart;
        req.session.total = cart.reduce((sum, item) => sum + item.product_price * item.quantity, 0);

        res.redirect('/main-homepage');
    });
});





app.get('/cart', authMiddleware, customerMiddleware, (req, res) => {
    const cart = req.session.cart || [];
    const total = req.session.total || 0;
    res.render('pages/cart', { cart: cart, total: total });
});


// Route to handle unlogged users clicking on a product
app.get('/add-to-cart/:productId', (req, res) => {
    const productId = req.params.productId;

    // If the user is not logged in, store the productId in the session and redirect to login
    if (!req.session.user) {
        req.session.productToAdd = productId;
        return res.redirect('/login');
    }

    // If the user is logged in, add the product directly to the cart
    addProductToCart(req.session.user.id, productId, res);
});


// Increase quantity route
app.post('/cart/increase/:id', (req, res) => {
    const cartId = req.params.id;
    const query = "UPDATE cart SET quantity = quantity + 1 WHERE id = ?";
    con.query(query, [cartId], (err, result) => {
        if (err) {
            console.error('Error increasing quantity:', err);
            return res.status(500).send('Error increasing quantity');
        }
        updateCartTotals(req.session.user.id, res);
    });
});


// Decrease quantity route
app.post('/cart/decrease/:id', (req, res) => {
    const cartId = req.params.id;
    const query = "UPDATE cart SET quantity = quantity - 1 WHERE id = ? AND quantity > 1";
    con.query(query, [cartId], (err, result) => {
        if (err) {
            console.error('Error decreasing quantity:', err);
            return res.status(500).send('Error decreasing quantity');
        }
        updateCartTotals(req.session.user.id, res);
    });
});

// Remove item route
app.post('/cart/remove/:id', (req, res) => {
    const cartId = req.params.id;
    const query = "DELETE FROM cart WHERE id = ?";
    con.query(query, [cartId], (err, result) => {
        if (err) {
            console.error('Error removing item:', err);
            return res.status(500).send('Error removing item');
        }
        updateCartTotals(req.session.user.id, res);
    });
});


app.get('/confirm-order', authMiddleware, customerMiddleware, (req, res) => {
    const cart = req.session.cart || [];
    const total = req.session.total || 0;

    if (cart.length === 0) {
        const fetchCartQuery = `
            SELECT cart.product_id, cart.quantity, products.name AS product_name, products.price AS product_price
            FROM cart
            INNER JOIN products ON cart.product_id = products.id
            WHERE cart.user_id = ?
        `;
        con.query(fetchCartQuery, [req.session.user.id], (err, dbCart) => {
            if (err) {
                console.error('Error fetching cart:', err);
                return res.status(500).send('Error loading confirm order page');
            }

            // Rebuild session cart
            req.session.cart = dbCart.map(item => ({
                product_id: item.product_id,
                product_name: item.product_name,
                product_price: item.product_price,
                quantity: item.quantity,
            }));
            req.session.total = dbCart.reduce((sum, item) => sum + item.product_price * item.quantity, 0);

            // Render the page with updated cart
            return res.render('pages/confirm_order', { cart: req.session.cart, total: req.session.total });
        });
    } else {
        res.render('pages/confirm_order', { cart: cart, total: total });
    }
});





// Display delivery details form
app.get('/delivery_details', authMiddleware, customerMiddleware, (req, res) => {
    const cart = req.session.cart || [];
    const total = req.session.total || 0;

    if (cart.length === 0) {
        return res.redirect('/cart?error=Your cart is empty.');
    }

    res.render('pages/delivery_details', { cart: cart, total: total });
});


// Submit delivery details
app.post('/delivery-details', authMiddleware, customerMiddleware, (req, res) => {
    const userId = req.session.user.id;
    const { fullName, phone, address, city, state, postalCode } = req.body;

    if (!fullName || !phone || !address) {
        return res.status(400).send('Full Name, Phone, and Address are required.');
    }

    console.log('Received delivery details:', req.body); // Log the received form data

    const cart = req.session.cart || [];
    const total = req.session.total || 0;

    if (cart.length === 0) {
        return res.status(400).send('Cart is empty');
    }

    const currentDate = new Date();

    // Start transaction for saving order and delivery details
    con.beginTransaction((err) => {
        if (err) {
            console.error('Error starting transaction:', err);
            return res.status(500).send('Error during checkout');
        }

        // Insert order data
        const orderValues = cart.map(item => [userId, item.product_id, item.quantity, currentDate]);
        const insertOrdersQuery = "INSERT INTO orders (user_id, product_id, quantity, order_date) VALUES ?";
        con.query(insertOrdersQuery, [orderValues], (err, result) => {
            if (err) {
                console.error('Error inserting orders:', err);
                return con.rollback(() => {
                    res.status(500).send('Error during checkout');
                });
            }

            const orderId = result.insertId;

            // Insert delivery details
            const insertDeliveryDetailsQuery = `
                INSERT INTO delivery_details (user_id, order_id, full_name, phone, address, city, state, postal_code)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;
            con.query(insertDeliveryDetailsQuery, [userId, orderId, fullName, phone, address, city, state, postalCode], (err, result) => {
                if (err) {
                    console.error('Error inserting delivery details:', err);
                    return con.rollback(() => {
                        res.status(500).send('Error during checkout');
                    });
                }

                // Commit the transaction and move to payment
                con.commit((err) => {
                    if (err) {
                        console.error('Error committing transaction:', err);
                        return con.rollback(() => {
                            res.status(500).send('Error during checkout');
                        });
                    }

                    // Redirect to checkout page
                    res.redirect(`/checkout?order_id=${orderId}`);
                });
            });
        });
    });
});




// Checkout route
app.get('/checkout', authMiddleware, customerMiddleware, (req, res) => {
    const orderId = req.query.order_id;
    const userId = req.session.user.id;

    const fetchOrderDetailsQuery = `
        SELECT o.id AS order_id, p.name AS product_name, o.quantity, p.price AS product_price
        FROM orders o
        INNER JOIN products p ON o.product_id = p.id
        WHERE o.user_id = ? AND o.id = ?
    `;
    con.query(fetchOrderDetailsQuery, [userId, orderId], (err, orders) => {
        if (err) {
            console.error('Error fetching order details:', err);
            return res.status(500).send('Error fetching order details');
        }

        if (!orders.length) {
            return res.status(400).send('Order not found');
        }

        const fetchDeliveryDetailsQuery = `
            SELECT * FROM delivery_details WHERE user_id = ? AND order_id = ?
        `;
        con.query(fetchDeliveryDetailsQuery, [userId, orderId], (err, deliveryDetails) => {
            if (err) {
                console.error('Error fetching delivery details:', err);
                return res.status(500).send('Error fetching delivery details');
            }

            const total = orders.reduce((sum, order) => sum + order.product_price * order.quantity, 0); // Calculate total amount
            const paymentReference = generatePaymentReference(); // Generate a payment reference

            // Store the payment reference in the session
            req.session.paymentReference = paymentReference;

            // Generate Paystack payment link
            const paymentData = {
                email: req.session.user.email,
                amount: total * 100, // Amount in kobo
                reference: paymentReference,
                callback_url: `http://yourdomain.com/payment/callback?order_id=${orderId}`
            };

            Paystack.transaction.initialize(paymentData, (error, body) => {
                if (error) {
                    console.error('Error initializing transaction:', error);
                    return res.status(500).send('Error initializing payment');
                }

                const paymentLink = body.data.authorization_url;

                res.render('pages/checkout', { orders, deliveryDetails, paymentLink });
            });
        });
    });
});

// Submit delivery details route
app.post('/checkout', authMiddleware, customerMiddleware, (req, res) => {
    const userId = req.session.user.id;
    const { fullName, phone, address, city, state, postalCode } = req.body;

    if (!fullName || !phone || !address) {
        return res.status(400).send('Full Name, Phone, and Address are required.');
    }

    console.log('Received delivery details:', req.body); // Log the received form data

    const cart = req.session.cart || [];
    const total = req.session.total || 0;

    if (cart.length === 0) {
        return res.status(400).send('Cart is empty');
    }

    const currentDate = new Date();

    // Start transaction
    con.beginTransaction((err) => {
        if (err) {
            console.error('Error starting transaction:', err);
            return res.status(500).send('Error during checkout');
        }

        // Insert order
        const orderValues = cart.map(item => [userId, item.product_id, item.quantity, currentDate]);
        const insertOrdersQuery = "INSERT INTO orders (user_id, product_id, quantity, order_date) VALUES ?";
        con.query(insertOrdersQuery, [orderValues], (err, result) => {
            if (err) {
                console.error('Error inserting orders:', err);
                return con.rollback(() => {
                    res.status(500).send('Error during checkout');
                });
            }

            const orderId = result.insertId;

            // Insert delivery details
            const insertDeliveryDetailsQuery = `
                INSERT INTO delivery_details (user_id, order_id, full_name, phone, address, city, state, postal_code)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;
            con.query(insertDeliveryDetailsQuery, [userId, orderId, fullName, phone, address, city, state, postalCode], (err, result) => {
                if (err) {
                    console.error('Error inserting delivery details:', err);
                    return con.rollback(() => {
                        res.status(500).send('Error during checkout');
                    });
                }

                // Commit transaction
                con.commit((err) => {
                    if (err) {
                        console.error('Error committing transaction:', err);
                        return con.rollback(() => {
                            res.status(500).send('Error during checkout');
                        });
                    }

                    // Redirect to checkout page
                    res.redirect(`/checkout?order_id=${orderId}`);
                });
            });
        });
    });
});



// Payment callback route
app.get('/payment/callback', authMiddleware, (req, res) => {
    const reference = req.query.reference;
    const orderId = req.query.order_id;
    const userId = req.session.user.id;

    // Verify that the reference matches the one stored in the session
    if (reference !== req.session.paymentReference) {
        return res.status(400).send('Invalid payment reference');
    }

    Paystack.transaction.verify(reference, (error, body) => {
        if (error) {
            console.error('Error verifying transaction:', error);
            return res.status(500).send('Error verifying payment');
        }

        console.log('Paystack API response:', body); // Log the full response

        if (body && body.data && body.data.status === 'success') {
            const fetchCartQuery = `
                SELECT cart.product_id, cart.quantity, products.name AS product_name, products.price AS product_price, products.vendor_id
                FROM cart
                INNER JOIN products ON cart.product_id = products.id
                WHERE cart.user_id = ?
            `;
            con.query(fetchCartQuery, [userId], (err, cart) => {
                if (err) {
                    console.error('Error fetching cart:', err);
                    return res.status(500).send('Error during payment');
                }

                if (!cart.length) {
                    return res.status(400).send('Cart is empty');
                }

                const currentDate = new Date();

                // Start transaction
                con.beginTransaction((err) => {
                    if (err) {
                        console.error('Error starting transaction:', err);
                        return res.status(500).send('Error during payment');
                    }

                    // Insert orders and update sales history
                    const orderValues = cart.map(item => [userId, item.product_id, item.quantity, currentDate]);
                    const salesHistoryValues = cart.map(item => [item.vendor_id, item.product_id, item.product_name, item.quantity, item.product_price, currentDate]);

                    const insertOrdersQuery = "INSERT INTO orders (user_id, product_id, quantity, order_date) VALUES ?";
                    const updateSalesHistoryQuery = "INSERT INTO sales_history (vendor_id, product_id, product_name, quantity, amount, sale_date) VALUES ?";

                    con.query(insertOrdersQuery, [orderValues], (err, result) => {
                        if (err) {
                            console.error('Error inserting orders:', err);
                            return con.rollback(() => {
                                res.status(500).send('Error during payment');
                            });
                        }

                        con.query(updateSalesHistoryQuery, [salesHistoryValues], (err, result) => {
                            if (err) {
                                console.error('Error updating sales history:', err);
                                return con.rollback(() => {
                                    res.status(500).send('Error during payment');
                                });
                            }

                            // Clear the cart
                            const clearCartQuery = "DELETE FROM cart WHERE user_id = ?";
                            con.query(clearCartQuery, [userId], (err, result) => {
                                if (err) {
                                    console.error('Error clearing cart:', err);
                                    return con.rollback(() => {
                                        res.status(500).send('Error during payment');
                                    });
                                }

                                // Commit transaction
                                con.commit((err) => {
                                    if (err) {
                                        console.error('Error committing transaction:', err);
                                        return con.rollback(() => {
                                            res.status(500).send('Error during payment');
                                        });
                                    }

                                    // Redirect to main homepage
                                    res.redirect('/main_homepage');
                                });
                            });
                        });
                    });
                });
            });
        } else {
            res.send('Payment failed. Please try again.');
        }
    });
});


// Payment route
app.get('/payment', authMiddleware, customerMiddleware, (req, res) => {
    const orderId = req.query.order_id;
    const userId = req.session.user.id;

    const fetchOrderDetailsQuery = `
        SELECT o.id AS order_id, p.name AS product_name, o.quantity, p.price AS product_price
        FROM orders o
        INNER JOIN products p ON o.product_id = p.id
        WHERE o.user_id = ? AND o.id = ?
    `;
    con.query(fetchOrderDetailsQuery, [userId, orderId], (err, orders) => {
        if (err) {
            console.error('Error fetching order details:', err);
            return res.status(500).send('Error fetching order details');
        }

        if (!orders.length) {
            return res.status(400).send('Order not found');
        }

        const fetchDeliveryDetailsQuery = `
            SELECT * FROM delivery_details WHERE user_id = ? AND order_id = ?
        `;
        con.query(fetchDeliveryDetailsQuery, [userId, orderId], (err, deliveryDetails) => {
            if (err) {
                console.error('Error fetching delivery details:', err);
                return res.status(500).send('Error fetching delivery details');
            }

            const paymentReference = generatePaymentReference(); // Generate a payment reference

            res.render('pages/payment', { orders, deliveryDetails, paymentReference });
        });
    });
});


// Handle Payment (POST)
app.post('/payment', authMiddleware, (req, res) => {
    const userId = req.session.user.id;
    const { paymentMethod } = req.body;

    const fetchCartQuery = `
        SELECT cart.product_id, cart.quantity, products.price AS product_price
        FROM cart
        INNER JOIN products ON cart.product_id = products.id
        WHERE cart.user_id = ?
    `;
    con.query(fetchCartQuery, [userId], (err, cart) => {
        if (err) {
            console.error('Error fetching cart:', err);
            return res.status(500).send('Error during payment');
        }

        if (!cart.length) {
            return res.status(400).send('Cart is empty');
        }

        const currentDate = new Date();

        // Start transaction
        con.beginTransaction((err) => {
            if (err) {
                console.error('Error starting transaction:', err);
                return res.status(500).send('Error during payment');
            }

            // Insert order data
            const orderValues = cart.map(item => [userId, item.product_id, item.quantity, currentDate]);
            const insertOrdersQuery = "INSERT INTO orders (user_id, product_id, quantity, order_date) VALUES ?";
            con.query(insertOrdersQuery, [orderValues], (err, result) => {
                if (err) {
                    console.error('Error inserting orders:', err);
                    return con.rollback(() => {
                        res.status(500).send('Error during payment');
                    });
                }

                const orderId = result.insertId;

                // Insert delivery details
                const insertDeliveryDetailsQuery = `
                    INSERT INTO delivery_details (user_id, order_id, full_name, phone, address, city, state, postal_code)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `;
                con.query(insertDeliveryDetailsQuery, [userId, orderId, fullName, phone, address, city, state, postalCode], (err, result) => {
                    if (err) {
                        console.error('Error inserting delivery details:', err);
                        return con.rollback(() => {
                            res.status(500).send('Error during payment');
                        });
                    }

                    // Commit transaction and create Paystack payment
                    con.commit((err) => {
                        if (err) {
                            console.error('Error committing transaction:', err);
                            return con.rollback(() => {
                                res.status(500).send('Error during payment');
                            });
                        }

                        const totalAmount = cart.reduce((sum, item) => sum + item.product_price * item.quantity, 0);
                        const transactionParams = {
                            amount: totalAmount * 100, // amount in kobo (1 KES = 100 kobo)
                            email: req.session.user.email,
                            currency: 'KES',
                            callback_url: `http://localhost:8080/payment/callback?order_id=${orderId}`,
                        };

                        Paystack.transaction.initialize(transactionParams, (error, body) => {
                            if (error) {
                                console.error('Error initializing transaction:', error);
                                return res.status(500).send('Error initializing payment');
                            }

                            res.redirect(body.data.authorization_url);
                        });
                    });
                });
            });
        });
    });
});



// Cancel order route
app.post('/cancel-order', authMiddleware, (req, res) => {
    const userId = req.session.user.id;
    const { order_id } = req.body;

    // Check if the order is within 24 hours
    const checkOrderQuery = `
        SELECT * FROM orders 
        WHERE id = ? AND user_id = ? AND order_date >= NOW() - INTERVAL 1 DAY
    `;
    con.query(checkOrderQuery, [order_id, userId], (err, orders) => {
        if (err) {
            console.error('Error checking order:', err);
            return res.status(500).send('Error processing cancellation');
        }

        if (orders.length > 0) {
            // Cancel the order
            const cancelOrderQuery = "UPDATE orders SET status = 'cancelled' WHERE id = ?";
            con.query(cancelOrderQuery, [order_id], (err, result) => {
                if (err) {
                    console.error('Error cancelling order:', err);
                    return res.status(500).send('Error processing cancellation');
                }

                // Adjust sales history
                const updateSalesHistoryQuery = `
                    UPDATE sales_history 
                    SET status = 'cancelled' 
                    WHERE product_name = (SELECT name FROM products WHERE id = ?) 
                    AND vendor_id = (SELECT vendor_id FROM products WHERE id = ?)
                `;
                con.query(updateSalesHistoryQuery, [orders[0].product_id, orders[0].product_id], (err, result) => {
                    if (err) {
                        console.error('Error updating sales history:', err);
                        return res.status(500).send('Error processing cancellation');
                    }

                    res.redirect('/orders?cancelled=true');
                });
            });
        } else {
            res.redirect('/orders?cancelled=false');
        }
    });
});



app.get('/register', function (req, res) {
    res.render('pages/register');
});

app.post('/register', function (req, res) {
    var username = req.body.username;
    var password = req.body.password;
    var email = req.body.email;
    var phone = req.body.phone;
    var role = req.body.role;

    var con = mysql.createConnection({
        host: "localhost",
        user: "root",
        password: "",
        database: "node_project"
    });

    // Encrypt the password using bcrypt
    const bcrypt = require('bcrypt');
    const saltRounds = 10;
    bcrypt.hash(password, saltRounds, function (err, hash) {
        if (err) {
            console.log(err);
        }

        // Save the user into the database
        var query = "INSERT INTO users (username, password, email, phone, role) VALUES ?";
        var values = [[username, hash, email, phone, role]];
        con.query(query, [values], function (err, result) {
            if (err) {
                console.log(err);
            } else {
                res.redirect('/login');
            }
        });
    });
});

app.get('/login', (req, res) => {
    res.render('pages/login');
});



// Login route
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();
    console.log(`Checking credentials - Username: '${trimmedUsername}', Password: '${trimmedPassword}'`);
    const query = "SELECT * FROM users WHERE username = ?";
    con.query(query, [trimmedUsername], (err, result) => {
        if (err) {
            console.error('Error during login:', err);
            return res.status(500).send('Error during login');
        }
        console.log('Database result:', result);
        if (result.length > 0) {
            const user = result[0];
            bcrypt.compare(trimmedPassword, user.password, (err, isMatch) => {
                if (err) {
                    console.error('Error comparing passwords:', err);
                    return res.status(500).send('Error during login');
                }
                if (isMatch) {
                    req.session.user = user;
                    console.log(`User logged in: ${user.username}`);
                    console.log('Session after login:', req.session); // Log session details
                    if (req.session.productToAdd) {
                        const productId = req.session.productToAdd;
                        delete req.session.productToAdd;
                        return addProductToCart(req.session.user.id, productId, res);
                    }
                    res.redirect('/main-homepage');
                } else {
                    console.log('Invalid credentials - Password mismatch');
                    res.render('pages/login', { error: 'Invalid credentials' });
                }
            });
        } else {
            console.log('Invalid credentials - User not found');
            res.render('pages/login', { error: 'Invalid credentials' });
        }
    });
});



// Logout Route
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error logging out:', err);
            return res.status(500).send('Error logging out');
        }
        res.redirect('/');  // Redirect to the main page or login page
    });
});




app.get('/main-homepage', authMiddleware, (req, res) => {
    const userId = req.session.user.id;
    const productQuery = "SELECT * FROM products";
    
    con.query(productQuery, (err, products) => {
        if (err) {
            console.error('Error fetching products:', err);
            return res.status(500).send('Error fetching products');
        }

        const cartQuery = `
            SELECT cart.id, cart.product_id, cart.quantity, products.name AS product_name, products.price AS product_price 
            FROM cart 
            INNER JOIN products ON cart.product_id = products.id 
            WHERE cart.user_id = ?
        `;

        con.query(cartQuery, [userId], (err, cart) => { 
            if (err) { 
                console.error('Error fetching cart:', err); 
                return res.status(500).send('Error fetching cart'); 
            } 
            if (req.session.user.role === 'vendor') { 
                const salesQuery = "SELECT * FROM sales_history WHERE vendor_id = ? ORDER BY sale_date DESC"; 
                con.query(salesQuery, [userId], (err, sales) => { 
                    if (err) { 
                        console.error('Error fetching sales history:', err); 
                        return res.status(500).send('Error fetching sales history'); 
                    } 
                    res.render('pages/main_homepage', { user: req.session.user, products, cart, sales, page: 'home' }); 
                }); 
            } else { 
                res.render('pages/main_homepage', { user: req.session.user, products, cart, page: 'home' }); 
            } 
        });
    });
});



app.get('/protected', authMiddleware, function (req, res) { 
    res.send('This is a protected route. You are authenticated.'); 
});


// Vendor Homepage Route
app.get('/vendor', authMiddleware, (req, res) => {
    const vendorId = req.session.user.id;

    const salesQuery = "SELECT * FROM sales_history WHERE vendor_id = ? ORDER BY sale_date DESC";
    const productsQuery = "SELECT * FROM products WHERE vendor_id = ? ORDER BY name";

    // Execute both queries in parallel
    con.query(salesQuery, [vendorId], (err, sales) => {
        if (err) {
            console.error('Error fetching sales history:', err);
            return res.status(500).send('Error fetching sales history');
        }

        con.query(productsQuery, [vendorId], (err, products) => {
            if (err) {
                console.error('Error fetching products:', err);
                return res.status(500).send('Error fetching products');
            }

            // Render vendor page with sales and products data
            res.render('pages/vendor', { user: req.session.user, sales, products });
        });
    });
});




// Customer Homepage Route 
app.get('/customer-homepage', authMiddleware, customerMiddleware, (req, res) => {
    const productQuery = "SELECT * FROM products";
    con.query(productQuery, (err, products) => {
        if (err) {
            console.error('Error fetching products:', err);
            return res.status(500).send('Error fetching products');
        }

        const cartQuery = "SELECT * FROM cart WHERE user_id = ?";
        con.query(cartQuery, [req.session.user.id], (err, cart) => {
            if (err) {
                console.error('Error fetching cart:', err);
                return res.status(500).send('Error fetching cart');
            }
            res.render('pages/customer', { products, cart: cart || [] });  // Ensure cart is passed
        });
    });
});


app.get('/contact', function (req, res) {
    res.render('pages/contact');
});

app.post('/contact', function (req, res) {
    var name = req.body.name;
    var email = req.body.email;
    var message = req.body.message;

    // Here you can handle the contact form submission, e.g., save it to the database or send an email
    console.log('Contact form submitted:', { name, email, message });
    res.send('Thank you for contacting us!');
});


// Product Upload Route 
app.post('/vendor/upload', authMiddleware, vendorMiddleware, upload.single('image'), (req, res) => { 
    const { name, description, price } = req.body; 
    const vendorId = req.session.user.id; 
    const image = `/uploads/${req.file.filename}`; 
    const query = "INSERT INTO products (vendor_id, name, description, price, image) VALUES (?, ?, ?, ?, ?)"; con.query(query, [vendorId, name, description, price, image], (err) => { 
        if (err) { 
            console.error('Error uploading product:', err); 
            return res.status(500).send('Failed to upload product'); 
        } 
        console.log('Product uploaded successfully');
        res.redirect('/main-homepage'); 
    }); 
});


// Delete Product Route 
app.post('/vendor/delete/:id', authMiddleware, vendorMiddleware, (req, res) => { 
    const productId = req.params.id; 
    const query = "DELETE FROM products WHERE id = ?"; 
    con.query(query, [productId], (err) => { 
        if (err) { 
            console.error('Error deleting product:', err); 
            return res.status(500).send('Failed to delete product'); 
        } 
        console.log('Product deleted successfully');
        res.redirect('/main-homepage'); 
    }); 
});


// Edit Product Route 
app.post('/vendor/edit/:id', authMiddleware, vendorMiddleware, (req, res) => { 
    const { name, description, price } = req.body; 
    const productId = req.params.id; 
    const query = "UPDATE products SET name = ?, description = ?, price = ? WHERE id = ?"; 
    con.query(query, [name, description, price, productId], (err) => { 
        if (err) { 
            console.error('Error updating product:', err); 
            return res.status(500).send('Error updating product'); 
        } 
        res.redirect('/main-homepage'); 
    });
});


// Route to fetch products 
app.get('/products', (req, res) => {
    console.log('Rendering products page...');
    console.log('Views directory:', app.get('views'));

    var query = "SELECT * FROM products";
    con.query(query, (err, results) => {
        if (err) {
            console.log('Error fetching products:', err);
            return res.status(500).send('Error fetching products');
        } else {
            res.render('pages/products', { products: results });
        }
    });
});


// Customer route to buy a product 
app.post('/customer/buy', authMiddleware, customerMiddleware, (req, res) => { 
    const { product_id, customer_name } = req.body; 

    if (!req.session.user) {
        // Redirect to login if the user is not logged in
        return res.redirect('/login');
    }

    const sql = 'INSERT INTO orders (product_id, customer_name) VALUES (?, ?)'; 
    con.query(sql, [product_id, customer_name], (err, result) => { 
        if (err) throw err; 
        res.send('Product purchased successfully'); 
    }); 
});


// Customer Order History Route
app.get('/orders', authMiddleware, (req, res) => {
    const userId = req.session.user.id;
    const success = req.query.success || false;
    const cancelled = req.query.cancelled || false;

    // Updated query to include vendor information and rating data
    const orderQuery = `
        SELECT 
            orders.id AS order_id, 
            orders.product_id, 
            orders.quantity, 
            orders.order_date, 
            products.name AS product_name, 
            products.price AS product_price, 
            vendors.id AS vendor_id, 
            vendors.name AS vendor_name,
            IFNULL(vendor_ratings.rating, 0) AS vendor_rating, 
            IFNULL(vendor_ratings.review, '') AS vendor_review,
            vendor_ratings.id AS rating_id
        FROM orders
        INNER JOIN products ON orders.product_id = products.id
        INNER JOIN vendors ON products.vendor_id = vendors.id
        LEFT JOIN vendor_ratings ON vendor_ratings.vendor_id = vendors.id AND vendor_ratings.user_id = ?
        WHERE orders.user_id = ?
        ORDER BY orders.order_date DESC
    `;

    con.query(orderQuery, [userId, userId], (err, orders) => {
        if (err) {
            console.error('Error fetching orders:', err);
            return res.status(500).send('Error fetching orders');
        }

        // Pass the orders data, which now includes vendor rating information
        res.render('pages/orders', { user: req.session.user, orders, success, cancelled, page: 'orders' });
    });
});



// Refund request route
app.post('/refund', authMiddleware, (req, res) => {
    const userId = req.session.user.id;
    const { order_id, product_id } = req.body;

    // Check if the order belongs to the user and is within 24 hours
    const checkOrderQuery = `
        SELECT * FROM orders 
        WHERE id = ? AND user_id = ? AND order_date >= NOW() - INTERVAL 1 DAY
    `;
    con.query(checkOrderQuery, [order_id, userId], (err, orders) => {
        if (err) {
            console.error('Error checking order:', err);
            return res.status(500).send('Error processing refund');
        }

        if (orders.length > 0) {
            // Process the refund logic here
            const refundQuery = "UPDATE orders SET status = 'refunded' WHERE id = ?";
            con.query(refundQuery, [order_id], (err, result) => {
                if (err) {
                    console.error('Error updating order status:', err);
                    return res.status(500).send('Error processing refund');
                }

                // Adjust sales history
                const updateSalesHistoryQuery = `
                    UPDATE sales_history 
                    SET status = 'refunded' 
                    WHERE product_name = (SELECT name FROM products WHERE id = ?) 
                    AND vendor_id = (SELECT vendor_id FROM products WHERE id = ?)
                `;
                con.query(updateSalesHistoryQuery, [product_id, product_id], (err, result) => {
                    if (err) {
                        console.error('Error updating sales history:', err);
                        return res.status(500).send('Error processing refund');
                    }

                    res.redirect('/orders?success=true');
                });
            });
        } else {
            res.redirect('/orders?success=false');
        }
    });
});



// Vendor rating route
app.post('/rate-vendor', authMiddleware, (req, res) => {
    const userId = req.session.user.id;
    const { vendor_id, rating, review } = req.body;

    // Check if the user has purchased from this vendor
    const checkPurchaseQuery = `
        SELECT * FROM orders 
        WHERE user_id = ? AND product_id IN (SELECT id FROM products WHERE vendor_id = ?)
    `;
    
    con.query(checkPurchaseQuery, [userId, vendor_id], (err, result) => {
        if (err) {
            console.error('Error checking purchase:', err);
            return res.status(500).send('Error processing rating');
        }

        if (result.length > 0) {
            // User has purchased from the vendor, so save the rating
            const insertRatingQuery = `
                INSERT INTO vendor_ratings (vendor_id, user_id, rating, review)
                VALUES (?, ?, ?, ?)
            `;
            
            con.query(insertRatingQuery, [vendor_id, userId, rating, review], (err, result) => {
                if (err) {
                    console.error('Error submitting rating:', err);
                    return res.status(500).send('Error submitting rating');
                }

                res.redirect('/orders?success=true');
            });
        } else {
            res.status(400).send('You can only rate vendors you have purchased from');
        }
    });
});


// Handle product rating submission
app.post('/products/rate', authMiddleware, (req, res) => {
    const { product_id, rating } = req.body;
    const userId = req.session.user.id;

    // Check if the rating is valid
    if (rating < 1 || rating > 5) {
        return res.status(400).send('Invalid rating. Rating should be between 1 and 5.');
    }

    // Insert the rating into the database
    const insertRatingQuery = `
        INSERT INTO vendor_ratings (vendor_id, user_id, rating)
        VALUES ((SELECT vendor_id FROM products WHERE id = ?), ?, ?)
    `;
    
    con.query(insertRatingQuery, [product_id, userId, rating], (err, result) => {
        if (err) {
            console.error('Error inserting rating:', err);
            return res.status(500).send('Error submitting rating.');
        }
        res.json({ message: 'Rating submitted successfully!' });
    });
});


// Fetch the vendor's sales history
app.get('/vendor/sales-history', authMiddleware, (req, res) => {
    const vendorId = req.session.user.id;

    const salesHistoryQuery = `
        SELECT products.name AS product_name, sales_history.status, sales_history.sale_date
        FROM sales_history
        INNER JOIN products ON sales_history.product_id = products.id
        WHERE sales_history.vendor_id = ?
        ORDER BY sales_history.sale_date DESC
    `;

    con.query(salesHistoryQuery, [vendorId], (err, salesHistory) => {
        if (err) {
            console.error('Error fetching sales history:', err);
            return res.status(500).send('Error fetching sales history');
        }

        // Check if salesHistory is empty
        if (salesHistory.length === 0) {
            return res.render('vendor/sales-history', { message: 'No sales history available.' });
        }

        res.render('vendor/sales-history', { salesHistory });
    });
});

app.post('/update-sales-history', async (req, res) => {
    const salesData = req.body; // Assuming the frontend sends sales data in the request body
    try {
        await updateSalesHistory(salesData); // Pass dynamic sales data
        res.status(200).send('Sales history updated successfully');
    } catch (err) {
        console.error('Error updating sales history:', err);
        res.status(500).send('Failed to update sales history');
    }
});



// Define a route to handle search functionality
app.get('/search', (req, res) => {
    const searchQuery = req.query.q || ""; // Get the query parameter (e.g., ?q=laptop)

    // Modify the SQL query to filter products
    const query = "SELECT * FROM products WHERE name LIKE ?";
    const params = [`%${searchQuery}%`]; // Use wildcards for the LIKE query

    con.query(query, params, (err, result) => {
        if (err) {
            console.error('Error fetching products:', err);
            return res.status(500).send('Error fetching products');
        }

        res.render('pages/index', { 
            products: result, // Pass the filtered products
            searchQuery: searchQuery, // Pass the search query to the view
            user: req.session.user // Optional: Pass user session
        });
    });
});

























