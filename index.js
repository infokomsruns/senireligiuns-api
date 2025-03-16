import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

dotenv.config();

const SECRET_KEY = process.env.SECRET_KEY;
const prisma = new PrismaClient();

const app = express();
app.use(cors());
app.use(express.json());

// Supabase configuration
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);
const BUCKET_NAME = "uploads"; // Replace with your Supabase storage bucket name

// Configure multer (no need for local disk storage)
const upload = multer({ storage: multer.memoryStorage() });

// Upload file to Supabase
const uploadToSupabase = async (file) => {
  const uniqueFilename = `${Date.now()}-${file.originalname}`;
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(uniqueFilename, file.buffer, {
      contentType: file.mimetype,
    });

  if (error) {
    console.error("Supabase upload error:", error);
    throw new Error("Failed to upload file to Supabase");
  }

  // Dapatkan URL publik
  return supabase.storage.from(BUCKET_NAME).getPublicUrl(uniqueFilename).data
    .publicUrl;
};

// Hapus file dari Supabase
const deleteFromSupabase = async (fileUrl) => {
  const decodedFileUrl = decodeURIComponent(fileUrl); // Decode URL untuk menangani spasi
  const filePath = decodedFileUrl.replace(
    `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/`,
    ""
  );
  console.log("File Path to be deleted:", filePath);
  const { error } = await supabase.storage.from(BUCKET_NAME).remove([filePath]);

  if (error) {
    console.error("Supabase delete error:", error);
    throw new Error("Failed to delete file from Supabase");
  }
};

const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access denied" });
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);

    // Check token expiration
    if (decoded.exp * 1000 < Date.now()) {
      return res.status(403).json({ error: "Token expired, please log in again" });
    }

    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ error: "Invalid token" });
  }
};

app.get("/api/admin/secure-data", authenticateToken, async (req, res) => {
  res.json({ message: "This is secured data for admin" });
});

// Login admin
app.post("/admin/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const admin = await prisma.admin.findUnique({
      where: { username },
    });

    if (!admin) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const isValidPassword = await bcrypt.compare(password, admin.password);

    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = jwt.sign({ id: admin.id }, SECRET_KEY, { expiresIn: "1h" });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: "An error occurred during login" });
  }
});

// Endpoint to ensure server is running
app.get("/", (req, res) => {
  res.send("Backend server is running");
});

// Get all news
app.get("/api/news", async (req, res) => {
  const news = await prisma.news.findMany();
  res.json(news);
});

// Get news by ID
app.get("/api/news/:id", async (req, res) => {
  const { id } = req.params;
  const newsItem = await prisma.news.findUnique({
    where: { id: parseInt(id) },
  });
  res.json(newsItem);
});

// Add news with image upload
app.post("/api/news", upload.single("image"), async (req, res) => {
  const { title, description, publishedAt } = req.body;

  try {
    const image = req.file 
      ? await uploadToSupabase(req.file) 
      : null;

    const newNews = await prisma.news.create({
      data: {
        title,
        description,
        image,
        publishedAt: new Date(publishedAt),
      },
    });
    res.json(newNews);
  } catch (error) {
    console.error("Error creating news:", error);
    res
      .status(500)
      .json({ error: "Failed to create news", details: error.message });
  }
});

// Endpoint to update news with image upload
app.put("/api/news/:id", upload.single("image"), async (req, res) => {
  const { id } = req.params;
  const { title, description, publishedAt } = req.body;

  try {
    // Fetch existing news
    const existingNews = await prisma.news.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingNews) {
      return res.status(404).json({ error: "News not found" });
    }

    // If new file is uploaded, handle image update
    let newImage = null;
    if (req.file) {
      newImage = await uploadToSupabase(req.file);

      // Delete old image file if it exists
      if (existingNews.image) {
        await deleteFromSupabase(existingNews.image);
      }
    }

    // Update news data
    const updatedNews = await prisma.news.update({
      where: { id: parseInt(id) },
      data: {
        title,
        description,
        image: newImage || existingNews.image,
        publishedAt: new Date(publishedAt),
      },
    });
    res.json(updatedNews);
  } catch (error) {
    console.error("Error updating news:", error);
    res
      .status(500)
      .json({ error: "Failed to update news", details: error.message });
  }
});

// Delete news by ID
app.delete("/api/news/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Fetch existing news
    const existingNews = await prisma.news.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingNews) {
      return res.status(404).json({ error: "News not found" });
    }

    // Delete associated image file if it exists
    if (existingNews.image) {
      await deleteFromSupabase(existingNews.image);
    }

    // Delete news from database
    await prisma.news.delete({
      where: { id: parseInt(id) },
    });
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting news:", error);
    res
      .status(500)
      .json({ error: "Failed to delete news", details: error.message });
  }
});

// Get Hero
app.get("/api/hero", async (req, res) => {
  const hero = await prisma.hero.findFirst();
  res.json(hero);
});

// Update Hero
app.put("/api/hero/:id", upload.single("image"), async (req, res) => {
  const { id } = req.params;
  const { welcomeMessage, description } = req.body;

  try {
    // Ambil data hero lama
    const existingHero = await prisma.hero.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingHero) {
      return res.status(404).json({ error: "Hero not found" });
    }

    // Jika ada file baru, simpan ke local storage
    let newImage = null;
    if (req.file) {
      newImage = await uploadToSupabase(req.file);

      // Hapus file lama jika ada
      if (existingHero.image) {
        await deleteFromSupabase(existingHero.image);
      }
    }

    // Perbarui data hero di database
    const updatedHero = await prisma.hero.update({
      where: { id: parseInt(id) },
      data: {
        welcomeMessage,
        description,
        image: newImage || existingHero.image,
      },
    });

    res.json(updatedHero);
  } catch (error) {
    console.error("Error updating hero:", error);
    res
      .status(500)
      .json({ error: "Failed to update hero", details: error.message });
  }
});

// Get all extracurriculars
app.get("/api/extracurriculars", async (req, res) => {
  const extracurriculars = await prisma.extracurricular.findMany();
  res.json(extracurriculars);
});

// Get extracurricular by ID
app.get("/api/extracurriculars/:id", async (req, res) => {
  const { id } = req.params;
  const extracurricular = await prisma.extracurricular.findUnique({
    where: { id: parseInt(id) },
  });
  res.json(extracurricular);
});

// Add extracurricular with image upload
app.post("/api/extracurriculars", upload.single("image"), async (req, res) => {
  const { name, description } = req.body;

  try {
    const image = req.file ? await uploadToSupabase(req.file) : null;

    const newExtracurricular = await prisma.extracurricular.create({
      data: {
        name,
        description,
        image,
      },
    });
    res.json(newExtracurricular);
  } catch (error) {
    console.error("Error creating extracurricular:", error);
    res
      .status(500)
      .json({ error: "Failed to create extracurricular", details: error.message });
  }
});

// Update extracurricular with image upload
app.put("/api/extracurriculars/:id", upload.single("image"), async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;

  try {
    // Fetch existing extracurricular
    const existingExtracurricular = await prisma.extracurricular.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingExtracurricular) {
      return res.status(404).json({ error: "Extracurricular not found" });
    }

    // If new file is uploaded, handle image update
    let newImage = null;
    if (req.file) {
      newImage = await uploadToSupabase(req.file);

      // Delete old image file if it exists
      if (existingExtracurricular.image) {
        await deleteFromSupabase(existingExtracurricular.image);
      }
    }

    // Update extracurricular data
    const updatedExtracurricular = await prisma.extracurricular.update({
      where: { id: parseInt(id) },
      data: {
        name,
        description,
        image: newImage || existingExtracurricular.image,
      },
    });

    res.json(updatedExtracurricular);
  } catch (error) {
    console.error("Error updating extracurricular:", error);
    res
      .status(500)
      .json({ error: "Failed to update extracurricular", details: error.message });
  }
});

// Delete extracurricular by ID
app.delete("/api/extracurriculars/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Fetch existing extracurricular
    const existingExtracurricular = await prisma.extracurricular.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingExtracurricular) {
      return res.status(404).json({ error: "Extracurricular not found" });
    }

    // Delete associated image file if it exists
    if (existingExtracurricular.image) {
      await deleteFromSupabase(existingExtracurricular.image);
    }

    // Delete extracurricular from database
    await prisma.extracurricular.delete({
      where: { id: parseInt(id) },
    });

    res.status(204).send();
  } catch (error) {
    console.error("Error deleting extracurricular:", error);
    res
      .status(500)
      .json({ error: "Failed to delete extracurricular", details: error.message });
  }
});

// Get Kalender
app.get("/api/kalender", async (req, res) => {
  const kalender = await prisma.kalender.findMany();
  res.json(kalender);
});

// Update Kalender
app.put("/api/kalender/:id", upload.single("file"), async (req, res) => {
  const { id } = req.params;
  const { title } = req.body;

  try {
    const existingKalender = await prisma.kalender.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingKalender) {
      return res.status(404).json({ error: "Kalender event not found" });
    }

    let newFile = existingKalender.file;

    if (req.file) {
      newFile = await uploadToSupabase(req.file);
      if (existingKalender.file) {
        await deleteFromSupabase(existingKalender.file);
      }
    }

    const updatedKalender = await prisma.kalender.update({
      where: { id: parseInt(id) },
      data: {
        title,
        file: newFile,
      },
    });

    res.json(updatedKalender);
  } catch (error) {
    console.error("Error updating kalender:", error);
    res.status(500).json({ error: "Failed to update kalender", details: error.message });
  }
});

// Get all alumni
app.get("/api/alumni", async (req, res) => {
  const alumni = await prisma.alumni.findMany();
  res.json(alumni);
});

// Get alumni by ID
app.get("/api/alumni/:id", async (req, res) => {
  const { id } = req.params;
  const alumniItem = await prisma.alumni.findUnique({
    where: { id: parseInt(id) },
  });
  res.json(alumniItem);
});

// Add alumni with image upload
app.post("/api/alumni", upload.single("image"), async (req, res) => {
  const { title } = req.body;

  try {
    const image = req.file ? await uploadToSupabase(req.file) : null;

    const newAlumni = await prisma.alumni.create({
      data: {
        title,
        image,
      },
    });
    res.json(newAlumni);
  } catch (error) {
    console.error("Error creating alumni:", error);
    res.status(500).json({ error: "Failed to create alumni", details: error.message });
  }
});

// Update alumni with image upload
app.put("/api/alumni/:id", upload.single("image"), async (req, res) => {
  const { id } = req.params;
  const { title } = req.body;

  try {
    const existingAlumni = await prisma.alumni.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingAlumni) {
      return res.status(404).json({ error: "Alumni not found" });
    }

    let newImage = null;
    if (req.file) {
      newImage = await uploadToSupabase(req.file);

      // Delete the old image file from the server
      if (existingAlumni.image) {
        await deleteFromSupabase(existingAlumni.image);
      }
    }

    const updatedAlumni = await prisma.alumni.update({
      where: { id: parseInt(id) },
      data: {
        title,
        image: newImage || existingAlumni.image,
      },
    });
    res.json(updatedAlumni);
  } catch (error) {
    console.error("Error updating alumni:", error);
    res.status(500).json({ error: "Failed to update alumni", details: error.message });
  }
});

// Delete alumni by ID
app.delete("/api/alumni/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const existingAlumni = await prisma.alumni.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingAlumni) {
      return res.status(404).json({ error: "Alumni not found" });
    }

    // Delete the file associated with the alumni from local storage
    if (existingAlumni.image) {
      await deleteFromSupabase(existingAlumni.image);
    }

    await prisma.alumni.delete({
      where: { id: parseInt(id) },
    });
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting alumni:", error);
    res.status(500).json({ error: "Failed to delete alumni", details: error.message });
  }
});

// Get all galeri
app.get("/api/galeri", async (req, res) => {
  const galeri = await prisma.galeri.findMany();
  res.json(galeri);
});

// Get galeri by ID
app.get("/api/galeri/:id", async (req, res) => {
  const { id } = req.params;
  const galeriItem = await prisma.galeri.findUnique({
    where: { id: parseInt(id) },
  });
  res.json(galeriItem);
});

// Add galeri with local image upload
app.post("/api/galeri", upload.single("image"), async (req, res) => {
  const { title } = req.body;

  try {
    const image = req.file ? await uploadToSupabase(req.file) : null;

    const newGaleri = await prisma.galeri.create({
      data: {
        title,
        image,
      },
    });
    res.json(newGaleri);
  } catch (error) {
    console.error("Error creating galeri:", error);
    res
      .status(500)
      .json({ error: "Failed to create galeri", details: error.message });
  }
});

// Update galeri with local image upload
app.put("/api/galeri/:id", upload.single("image"), async (req, res) => {
  const { id } = req.params;
  const { title } = req.body;

  try {
    const existingGaleri = await prisma.galeri.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingGaleri) {
      return res.status(404).json({ error: "Galeri not found" });
    }

    let newImage = existingGaleri.image;
    if (req.file) {
      newImage = await uploadToSupabase(req.file);
      if (existingGaleri.image) {
        await deleteFromSupabase(existingGaleri.image);
      }
    }

    const updatedGaleri = await prisma.galeri.update({
      where: { id: parseInt(id) },
      data: {
        title,
        image: newImage,
      },
    });

    res.json(updatedGaleri);
  } catch (error) {
    console.error("Error updating galeri:", error);
    res
      .status(500)
      .json({ error: "Failed to update galeri", details: error.message });
  }
});

// Delete galeri by ID
app.delete("/api/galeri/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const existingGaleri = await prisma.galeri.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingGaleri) {
      return res.status(404).json({ error: "Galeri not found" });
    }

    if (existingGaleri.image) {
      await deleteFromSupabase(existingGaleri.image);
    }

    await prisma.galeri.delete({
      where: { id: parseInt(id) },
    });

    res.status(204).send();
  } catch (error) {
    console.error("Error deleting galeri:", error);
    res
      .status(500)
      .json({ error: "Failed to delete galeri", details: error.message });
  }
});

app.get("/api/sarana", async (req, res) => {
  const sarana = await prisma.sarana.findMany();
  res.json(sarana);
});

app.get("/api/sarana/:id", async (req, res) => {
  const { id } = req.params;
  const saranaItem = await prisma.sarana.findUnique({
    where: { id: parseInt(id) },
  });
  res.json(saranaItem);
});

app.post("/api/sarana", upload.single("image"), async (req, res) => {
  const { name, description } = req.body;

  try {
    const image = req.file ? await uploadToSupabase(req.file) : null;

    const newSarana = await prisma.sarana.create({
      data: {
        name,
        description,
        image,
      },
    });
    res.json(newSarana);
  } catch (error) {
    console.error("Error creating sarana:", error);
    res.status(500).json({ error: "Failed to create sarana", details: error.message });
  }
});

app.put("/api/sarana/:id", upload.single("image"), async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;

  try {
    const existingSarana = await prisma.sarana.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingSarana) {
      return res.status(404).json({ error: "Sarana not found" });
    }

    let newImage = null;
    if (req.file) {
      newImage = await uploadToSupabase(req.file);
      if (existingSarana.image) {
        await deleteFromSupabase(existingSarana.image);
      }
    }

    const updatedSarana = await prisma.sarana.update({
      where: { id: parseInt(id) },
      data: {
        name,
        description,
        image: newImage || existingSarana.image,
      },
    });
    res.json(updatedSarana);
  } catch (error) {
    console.error("Error updating sarana:", error);
    res.status(500).json({ error: "Failed to update sarana", details: error.message });
  }
});

app.delete("/api/sarana/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const existingSarana = await prisma.sarana.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingSarana) {
      return res.status(404).json({ error: "Sarana not found" });
    }

    if (existingSarana.image) {
      await deleteFromSupabase(existingSarana.image);
    }

    await prisma.sarana.delete({
      where: { id: parseInt(id) },
    });
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting sarana:", error);
    res.status(500).json({ error: "Failed to delete sarana", details: error.message });
  }
});

// Get Headmaster Message
app.get("/api/headmaster-message", async (req, res) => {
  const headmasterMessage = await prisma.headmasterMessage.findFirst();
  res.json(headmasterMessage);
});

// Update Headmaster Message
app.put("/api/headmaster-message/:id", upload.single("image"), async (req, res) => {
  const { id } = req.params;
  const { message, description, headmasterName } = req.body;

  try {
    // Ambil data Headmaster Message lama
    const existingMessage = await prisma.headmasterMessage.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingMessage) {
      return res.status(404).json({ error: "Headmaster Message not found" });
    }

    // Jika ada gambar baru, unggah ke penyimpanan lokal
    let newImage = null;
    if (req.file) {
      newImage = await uploadToSupabase(req.file);

      // Hapus gambar lama dari penyimpanan lokal jika ada
      if (existingMessage.image) {
        await deleteFromSupabase(existingMessage.image);
      }
    }

    // Perbarui Headmaster Message
    const updatedHeadmasterMessage = await prisma.headmasterMessage.update({
      where: { id: parseInt(id) },
      data: {
        message,
        description,
        image: newImage || existingMessage.image, // Gunakan gambar baru jika ada
        headmasterName,
      },
    });

    res.json(updatedHeadmasterMessage);
  } catch (error) {
    console.error("Error updating headmaster message:", error);
    res.status(500).json({ error: "Failed to update headmaster message" });
  }
});

// Get all Sejarah slides
app.get("/api/sejarah", async (req, res) => {
  const sejarah = await prisma.sejarah.findMany();
  res.json(sejarah);
});

// Create a new Sejarah slide
app.post("/api/sejarah", upload.single("image"), async (req, res) => {
  const { period, text } = req.body;
  let imageUrl = null;
  if (req.file) {
    imageUrl = await uploadToSupabase(req.file);
  }
  const newSejarah = await prisma.sejarah.create({
    data: { period, text, image: imageUrl },
  });
  res.json(newSejarah);
});

// Update Sejarah slide
app.put("/api/sejarah/:id", upload.single("image"), async (req, res) => {
  const { id } = req.params;
  const { period, text } = req.body;
  const existingSejarah = await prisma.sejarah.findUnique({
    where: { id: parseInt(id) },
  });
  if (!existingSejarah) {
    return res.status(404).json({ error: "Sejarah not found" });
  }
  let imageUrl = existingSejarah.image;
  if (req.file) {
    imageUrl = await uploadToSupabase(req.file);
    if (existingSejarah.image) {
      await deleteFromSupabase(existingSejarah.image);
    }
  }
  const updatedSejarah = await prisma.sejarah.update({
    where: { id: parseInt(id) },
    data: { period, text, image: imageUrl },
  });
  res.json(updatedSejarah);
});

// Delete Sejarah slide
app.delete("/api/sejarah/:id", async (req, res) => {
  const { id } = req.params;
  const existingSejarah = await prisma.sejarah.findUnique({
    where: { id: parseInt(id) },
  });
  if (!existingSejarah) {
    return res.status(404).json({ error: "Sejarah not found" });
  }
  // Hapus file gambar dari penyimpanan lokal jika ada
  if (existingSejarah.image) {
    await deleteFromSupabase(existingSejarah.image);
  }
  await prisma.sejarah.delete({
    where: { id: parseInt(id) },
  });
  res.json({ message: "Slide sejarah berhasil dihapus" });
});

// Get Visi Misi
app.get("/api/visi-misi", async (req, res) => {
  const visiMisi = await prisma.visiMisi.findFirst();
  res.json(visiMisi);
});

// Update Visi Misi
app.put("/api/visi-misi/:id", async (req, res) => {
  const { id } = req.params;
  const { visi, misi } = req.body;

  const updatedVisiMisi = await prisma.visiMisi.update({
    where: { id: parseInt(id) },
    data: {
      visi,
      misi,
    },
  });

  res.json(updatedVisiMisi);
});

// Create a new contact message
app.post("/api/contacts", async (req, res) => {
  const { name, email, phone, message } = req.body;

  try {
    const newContact = await prisma.contact.create({
      data: {
        name,
        email,
        phone,
        message,
      },
    });
    res.status(201).json(newContact);
  } catch (error) {
    console.error("Error creating contact:", error);
    res.status(500).json({ error: "Failed to create contact message" });
  }
});

// Get all contact messages
app.get("/api/contacts", async (req, res) => {
  try {
    const contacts = await prisma.contact.findMany();
    res.json(contacts);
  } catch (error) {
    console.error("Error fetching contacts:", error);
    res.status(500).json({ error: "Failed to fetch contact messages" });
  }
});

// Backend: Delete a contact message by ID
app.delete("/api/contacts/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Delete the contact message by its ID
    const deletedContact = await prisma.contact.delete({
      where: { id: parseInt(id) }, // Assuming id is an integer
    });
    res.status(200).json(deletedContact);
  } catch (error) {
    console.error("Error deleting contact:", error);
    res.status(404).json({ error: "Contact not found or failed to delete" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
