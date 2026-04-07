require("dotenv").config();

const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306
});

db.connect(err => {
    if (err) {
        console.error("Database connection error:", err);
        throw err;
    }
    console.log("Connected to DB");
});

app.get("/", (req, res) => {
    res.send("NexaDesk backend is running");
});

app.post("/register", (req, res) => {
    const { name, email, password } = req.body;

    const checkSql = "SELECT * FROM users WHERE email = ?";
    db.query(checkSql, [email], (checkErr, checkResults) => {
        if (checkErr) {
            console.error(checkErr);
            return res.status(500).send("Register failed");
        }

        if (checkResults.length > 0) {
            return res.status(400).send("An account with this email already exists");
        }

        const insertSql = "INSERT INTO users (name, email, password) VALUES (?, ?, ?)";
        db.query(insertSql, [name, email, password], (insertErr) => {
            if (insertErr) {
                console.error(insertErr);
                return res.status(500).send("Register failed");
            }

            res.send("User registered");
        });
    });
});

app.post("/login", (req, res) => {
    const { email, password } = req.body;

    const sql = "SELECT * FROM users WHERE email = ? AND password = ?";
    db.query(sql, [email, password], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Login failed");
        }

        if (results.length > 0) {
            const user = results[0];
            res.json({
                message: "Login successful",
                name: user.name,
                email: user.email,
                role: user.role
            });
        } else {
            res.status(401).send("Invalid credentials");
        }
    });
});

app.post("/tickets", (req, res) => {
    console.log("POST /tickets hit");
    console.log("Body received:", req.body);

    const { title, category, description } = req.body;

    const sql = "INSERT INTO tickets (title, category, description, status) VALUES (?, ?, ?, 'Submitted')";
    db.query(sql, [title, category, description], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Ticket creation failed");
        }
        res.send("Ticket created");
    });
});
app.get("/tickets/open", (req, res) => {
    const sql = `
        SELECT 
            tickets.id,
            tickets.title,
            tickets.category,
            tickets.description,
            tickets.status,
            tickets.status_reason,
            tickets.assigned_to,
            users.name AS assigned_name
        FROM tickets
        LEFT JOIN users ON tickets.assigned_to = users.email
        WHERE tickets.status != 'Resolved'
        GROUP BY 
            tickets.id,
            tickets.title,
            tickets.category,
            tickets.description,
            tickets.status,
            tickets.status_reason,
            tickets.assigned_to,
            users.name
        ORDER BY tickets.id DESC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Failed to load open tickets");
        }

        res.json(results);
    });
});

app.get("/tickets/:id", (req, res) => {
    const ticketId = req.params.id;

    const sql = `
        SELECT tickets.*, users.name AS assigned_name
        FROM tickets
        LEFT JOIN users ON tickets.assigned_to = users.email
        WHERE tickets.id = ?
    `;

    db.query(sql, [ticketId], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Failed to load ticket");
        }

        if (results.length === 0) {
            return res.status(404).send("Ticket not found");
        }

        res.json(results[0]);
    });
});



app.get("/tickets/:id/notes", (req, res) => {
    const ticketId = req.params.id;

    const sql = `
        SELECT
            notes.id,
            notes.ticket_id,
            notes.note_text,
            notes.author_email,
            notes.created_at,
            MAX(users.name) AS author_name
        FROM notes
        LEFT JOIN users ON notes.author_email = users.email
        WHERE notes.ticket_id = ?
        GROUP BY
            notes.id,
            notes.ticket_id,
            notes.note_text,
            notes.author_email,
            notes.created_at
        ORDER BY notes.created_at DESC
    `;

    db.query(sql, [ticketId], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Failed to load notes");
        }

        res.json(results);
    });
});


app.post("/tickets/:id/notes", (req, res) => {
    const ticketId = req.params.id;
    const { note_text, author_email } = req.body;

    const sql = "INSERT INTO notes (ticket_id, note_text, author_email) VALUES (?, ?, ?)";
    db.query(sql, [ticketId, note_text, author_email], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Failed to add note");
        }

        res.send("Note added");
    });
});


app.put("/tickets/:id/status", (req, res) => {
    const ticketId = req.params.id;
    const { status, reason, author_email } = req.body;

    if (!status || !reason || reason.trim() === "") {
        return res.status(400).send("Status and reason are required");
    }

    const updateSql = "UPDATE tickets SET status = ?, status_reason = ? WHERE id = ?";

    db.query(updateSql, [status, reason, ticketId], (err, result) => {
        if (err) {
            console.error("Status update error:", err);
            return res.status(500).send("Failed to update status");
        }

        const noteText = `Status changed to "${status}". Reason: ${reason}`;
        const noteSql = "INSERT INTO notes (ticket_id, note_text, author_email) VALUES (?, ?, ?)";

        db.query(noteSql, [ticketId, noteText, author_email], (noteErr, noteResult) => {
            if (noteErr) {
                console.error("Status note insert error:", noteErr);
                return res.status(500).send("Status updated, but failed to add note");
            }

            console.log("Status note added for ticket:", ticketId);
            res.send("Status updated and note added");
        });
    });
});

app.get("/tickets/search/:id", (req, res) => {
    const ticketId = req.params.id;

    const sql = "SELECT * FROM tickets WHERE id = ?";
    db.query(sql, [ticketId], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Search failed");
        }

        if (results.length === 0) {
            return res.status(404).send("Ticket not found");
        }

        res.json(results[0]);
    });
});

app.get("/tickets/assigned/:email", (req, res) => {
    const email = req.params.email;

    const sql = `
        SELECT 
            tickets.id,
            tickets.title,
            tickets.category,
            tickets.description,
            tickets.status,
            tickets.status_reason,
            tickets.assigned_to,
            users.name AS assigned_name
        FROM tickets
        LEFT JOIN users ON tickets.assigned_to = users.email
        WHERE tickets.assigned_to = ?
        GROUP BY 
            tickets.id,
            tickets.title,
            tickets.category,
            tickets.description,
            tickets.status,
            tickets.status_reason,
            tickets.assigned_to,
            users.name
        ORDER BY tickets.id DESC
    `;

    db.query(sql, [email], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Failed to load assigned tickets");
        }

        res.json(results);
    });
});

app.put("/tickets/:id/assign", (req, res) => {
    const ticketId = req.params.id;
    const { assigned_to } = req.body;

    if (!assigned_to || assigned_to.trim() === "") {
        return res.status(400).send("Assigned user is required");
    }

    const sql = "UPDATE tickets SET assigned_to = ? WHERE id = ?";
    db.query(sql, [assigned_to, ticketId], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Failed to assign ticket");
        }

        res.send("Ticket assigned");
    });
});
app.get("/users", (req, res) => {
    const sql = "SELECT name, email FROM users ORDER BY name ASC";
    db.query(sql, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Failed to load users");
        }

        res.json(results);
    });
});

app.get("/users/search/:term", (req, res) => {
    const term = `%${req.params.term}%`;

    const sql = `
        SELECT name, email
        FROM users
        WHERE name LIKE ? OR email LIKE ?
        ORDER BY name ASC
    `;

    db.query(sql, [term, term], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Search failed");
        }

        res.json(results);
    });
});





const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
