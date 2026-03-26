const cors = require("cors");
const express = require("express");
const fs = require("fs");
const mongoose = require("mongoose");
const path = require("path");
const multer = require("multer");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();



/* -------------------- MIDDLEWARE -------------------- */

app.use(cors({
  origin: "*"
}));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.json({ limit: "50mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(__dirname));

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

/* -------------------- MULTER -------------------- */

const storage = multer.diskStorage({
  destination: (req, file, cb) => {

    const uploadPath = path.join(__dirname, "uploads");

    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    cb(null, uploadPath);
  },

  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
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
  res.sendFile(path.join(__dirname, "index.html"))
);

app.get("/userspage", (req, res) =>
  res.sendFile(path.join(__dirname, "users.html"))
);

app.get("/editpage", (req, res) =>
  res.sendFile(path.join(__dirname, "edit.html"))
);

app.get("/certificate", (req, res) =>
  res.sendFile(path.join(__dirname, "certificate.html"))
);

/* -------------------- ADD USER (WITH CERT ID) -------------------- */

app.post("/submit", async (req, res) => {

  const error = validateUser(req.body);
  if (error) return res.send(error);

  const certId = await generateCertificateId();

  const user = new User({
    ...req.body,
    age: Number(req.body.age),
    image: null,
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

app.get("/users", async (req, res) => {

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

app.post("/update/:id", upload.single("image"), async (req, res) => {

  const error = validateUser(req.body);
  if (error) return res.send(error);

  const updateData = {
    ...req.body,
    age: Number(req.body.age)
  };

  if (req.file) updateData.image = req.file.filename;

  await User.findByIdAndUpdate(req.params.id, updateData);

  res.redirect("/userspage");
});

// --------------------------------------------

app.delete("/delete/:id", async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.send("Deleted");
});

/* -------------------- EMAIL -------------------- */

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL,
    pass: process.env.PASS
  }
});

transporter.verify(function (error, success) {
  if (error) {
    console.log("❌ SMTP ERROR:", error);
  } else {
    console.log("✅ SMTP READY");
  }
});

app.post("/send-certificate", async (req, res) => {
  try {
    const { email, name, certificateId } = req.body;

    console.log("🚀 API HIT");
    console.log("TO:", email);

    const certificateLink = `https://travelclub-hwfv.onrender.com/certificate?id=${certificateId}`;

    await transporter.sendMail({
      from: process.env.EMAIL,
      to: email,
      subject: `Welcome Certificate - ${name}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Welcome, ${name}! 🎉</h2>
          <p>Ungaloda welcome certificate ready-a irukku!</p>
          <p>Keela irukka button-a click pannி certificate-a paakalam:</p>
          <a href="${certificateLink}" 
             style="background:#c9a227; color:white; padding:12px 24px; 
                    text-decoration:none; border-radius:6px; font-weight:bold;">
            View My Certificate
          </a>
          <br/><br/>
          <p>Certificate ID: <strong>${certificateId}</strong></p>
        </div>
      `
    });

    console.log("✅ MAIL SENT");
    res.json({ message: "Sent" });

  } catch (err) {
    console.log("❌ MAIL ERROR:", err);
    res.status(500).send("Mail Failed");
  }
});

// ---------------------------------------

app.get("/api/verify/:id", async (req, res) => {

  const user = await User.findOne({
    certificateId: req.params.id
  });

  if (!user) {
    return res.json({ valid: false });
  }

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