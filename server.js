const cors = require("cors");
const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const SibApiV3Sdk = require("sib-api-v3-sdk");
const session = require("express-session");
const MongoStore = require("connect-mongo")(session);
require("dotenv").config();

const app = express();

/* -------------------- MIDDLEWARE -------------------- */

app.use(cors({ origin: "*" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.json({ limit: "50mb" }));
app.use(express.static(__dirname, { index: false }));

app.use(session({
  secret: process.env.SESSION_SECRET || "travelclub_secret_key",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI
  }),
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

/* -------------------- AUTH MIDDLEWARE -------------------- */

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    next();
  } else {
    res.redirect("/");
  }
}

/* -------------------- MONGODB -------------------- */

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Atlas Connected"))
  .catch(err => console.log(err));

/* -------------------- USER SCHEMA -------------------- */

const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  age: Number,
  number: String,
  image: String,
  certificateId: String
}, { versionKey: false });

const User = mongoose.model("User", userSchema);

/* -------------------- GENERATE CERT ID -------------------- */

async function generateCertificateId() {
  let id;
  let exists = true;

  while (exists) {
    id = "CERT-" + Math.random().toString(36).substr(2, 6).toUpperCase();
    exists = await User.findOne({ certificateId: id });
  }

  return id;
}

/* -------------------- CLOUDINARY -------------------- */

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "travelclub",
    allowed_formats: ["jpg", "jpeg", "png"]
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpg|jpeg|png/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    if (ext) cb(null, true);
    else cb(new Error("Only images allowed"));
  }
});

/* -------------------- BREVO API -------------------- */

const defaultClient = SibApiV3Sdk.ApiClient.instance;
defaultClient.authentications["api-key"].apiKey = process.env.BREVO_API_KEY;
const emailApi = new SibApiV3Sdk.TransactionalEmailsApi();

console.log("✅ Brevo API Ready");

/* -------------------- VALIDATION -------------------- */

function validateUser({ name, email, age, number }) {
  if (!name || name.length < 3) return "Invalid name";
  if (!email.includes("@")) return "Invalid email";
  if (age < 1 || age > 100) return "Invalid age";
  if (!/^\d{10}$/.test(number)) return "Invalid number";
  return null;
}

/* -------------------- PAGES -------------------- */

app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "login.html"))
);

app.get("/certificate", (req, res) =>
  res.sendFile(path.join(__dirname, "certificate.html"))
);

app.get("/adduser", requireAdmin, (req, res) =>
  res.sendFile(path.join(__dirname, "index.html"))
);

app.get("/userspage", requireAdmin, (req, res) =>
  res.sendFile(path.join(__dirname, "users.html"))
);

app.get("/editpage", requireAdmin, (req, res) =>
  res.sendFile(path.join(__dirname, "edit.html"))
);

/* -------------------- LOGIN -------------------- */

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (
    username === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASS
  ) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

/* -------------------- LOGOUT -------------------- */

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/");
});

/* -------------------- ADD USER -------------------- */

app.post("/submit", requireAdmin, upload.single("image"), async (req, res) => {

  const error = validateUser(req.body);
  if (error) return res.send(error);

  const certId = await generateCertificateId();

  const user = new User({
    name: req.body.name,
    email: req.body.email,
    age: Number(req.body.age),
    number: req.body.number,
    image: req.file ? req.file.path : null,
    certificateId: certId
  });

  try {
    await user.save();
  } catch (err) {
    return res.status(500).send("DB Error");
  }

  res.redirect("/userspage");
});

/* -------------------- GET USERS -------------------- */

app.get("/users", requireAdmin, async (req, res) => {
  const search = req.query.search;
  if (!search) return res.json(await User.find());

  const safe = new RegExp(search, "i");
  const users = await User.find({
    $or: [{ name: safe }, { number: safe }]
  });

  res.json(users);
});

/* -------------------- GET SINGLE -------------------- */

app.get("/user/:id", async (req, res) => {
  const user = await User.findById(req.params.id);
  res.json(user);
});

/* -------------------- UPDATE -------------------- */

app.post("/update/:id", requireAdmin, upload.single("image"), async (req, res) => {

  const error = validateUser(req.body);
  if (error) return res.send(error);

  const updateData = {
    name: req.body.name,
    email: req.body.email,
    age: Number(req.body.age),
    number: req.body.number
  };

  if (req.file) updateData.image = req.file.path;

  await User.findByIdAndUpdate(req.params.id, updateData);
  res.redirect("/userspage");
});

/* -------------------- DELETE -------------------- */

app.delete("/delete/:id", requireAdmin, async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.send("Deleted");
});

/* -------------------- SEND CERTIFICATE -------------------- */

app.post("/send-certificate", async (req, res) => {
  try {
    const { email, name, certificateId, pdfBase64 } = req.body;

    console.log("🚀 API HIT");
    console.log("TO:", email);

    await emailApi.sendTransacEmail({
      sender: { name: "The Boys Club", email: "sarathkumarsm16@gmail.com" },
      to: [{ email: email, name: name }],
      subject: `Welcome Certificate - ${name}`,
      htmlContent: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Welcome, ${name}! 🎉</h2>
          <p>Ungaloda welcome certificate PDF attach pannirukkom!</p>
          <p>Certificate ID: <strong>${certificateId}</strong></p>
          <p>Warm regards,<br/>The Boys Club Team</p>
        </div>
      `,
      attachment: [
        {
          name: `certificate-${name}.pdf`,
          content: pdfBase64
        }
      ]
    });

    console.log("✅ MAIL SENT");
    res.json({ message: "Sent" });

  } catch (err) {
    console.log("❌ MAIL ERROR:", err);
    res.status(500).send("Mail Failed");
  }
});

/* -------------------- VERIFY -------------------- */

app.get("/api/verify/:id", async (req, res) => {
  const user = await User.findOne({ certificateId: req.params.id });

  if (!user) return res.json({ valid: false });

  res.json({
    valid: true,
    name: user.name,
    email: user.email,
    certificateId: user.certificateId
  });
});

/* -------------------- SERVER -------------------- */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});