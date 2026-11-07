const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Process error safety
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Directories
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ===================== AUTH (LOGIN) ===================== //
// Akun disimpan di server/data/users.json (password di-hash dengan scrypt),
// sesi login disimpan di server/data/sessions.json dan dikirim lewat cookie HttpOnly.
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SESSION_COOKIE = 'sid';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari

function readJsonFile(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.error('Error reading ' + path.basename(file) + ':', err);
    return fallback;
  }
}

function writeJsonFile(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error writing ' + path.basename(file) + ':', err);
    return false;
  }
}

function getUsers() {
  const data = readJsonFile(USERS_FILE, { users: [] });
  return Array.isArray(data.users) ? data.users : [];
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const known = Buffer.from(hash, 'hex');
    const test = crypto.scryptSync(password, salt, known.length);
    return crypto.timingSafeEqual(known, test);
  } catch (_) {
    return false;
  }
}

// Hash palsu untuk menyamakan waktu respons saat username tidak ditemukan
const DUMMY_HASH = hashPassword('dummy-password');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Sesi disimpan di memori + file agar tidak logout saat server di-restart
let sessions = readJsonFile(SESSIONS_FILE, {});

function pruneSessions() {
  const now = Date.now();
  let changed = false;
  for (const key of Object.keys(sessions)) {
    if (!sessions[key] || sessions[key].expiresAt < now) {
      delete sessions[key];
      changed = true;
    }
  }
  return changed;
}

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  pruneSessions();
  sessions[hashToken(token)] = { username, expiresAt: Date.now() + SESSION_TTL_MS };
  writeJsonFile(SESSIONS_FILE, sessions);
  return token;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch (_) {}
    }
  });
  return out;
}

function getSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const session = sessions[hashToken(token)];
  if (!session || session.expiresAt < Date.now()) return null;
  return session;
}

function isHttps(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function setSessionCookie(req, res, token) {
  let cookie = `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
  if (isHttps(req)) cookie += '; Secure';
  res.setHeader('Set-Cookie', cookie);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

// Batasi percobaan login salah (5x per 15 menit per IP + username)
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;

function attemptKey(req, username) {
  return (req.ip || 'ip') + '|' + String(username || '').toLowerCase();
}

function isLocked(key) {
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (entry.resetAt < Date.now()) {
    loginAttempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(key) {
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt < Date.now()) {
    loginAttempts.set(key, { count: 1, resetAt: Date.now() + LOCK_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
  }
  req.user = session.username;
  next();
}

// Semua /api wajib login, kecuali health check dan endpoint /api/auth
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/auth/')) return next();
  return requireAuth(req, res, next);
});

app.get('/api/auth/status', (req, res) => {
  const session = getSession(req);
  res.json({
    hasUsers: getUsers().length > 0,
    authenticated: Boolean(session),
    username: session ? session.username : null
  });
});

// Pendaftaran hanya dibuka untuk akun pertama (setup awal)
app.post('/api/auth/register', (req, res) => {
  if (getUsers().length > 0) {
    return res.status(403).json({ error: 'Akun sudah dibuat. Silakan login.' });
  }

  const username = String((req.body && req.body.username) || '').trim();
  const password = String((req.body && req.body.password) || '');

  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
    return res.status(400).json({ error: 'Username 3-30 karakter (huruf, angka, titik, strip, atau garis bawah)' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password minimal 6 karakter' });
  }

  writeJsonFile(USERS_FILE, {
    users: [{ username, passwordHash: hashPassword(password), createdAt: new Date().toISOString() }]
  });

  const token = createSession(username);
  setSessionCookie(req, res, token);
  res.status(201).json({ username });
});

app.post('/api/auth/login', (req, res) => {
  const username = String((req.body && req.body.username) || '').trim();
  const password = String((req.body && req.body.password) || '');
  const key = attemptKey(req, username);

  if (isLocked(key)) {
    return res.status(429).json({ error: 'Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.' });
  }

  const user = getUsers().find((u) => u.username.toLowerCase() === username.toLowerCase());
  // Tetap hitung hash walau user tidak ada, agar waktu respons seragam
  const ok = user
    ? verifyPassword(password, user.passwordHash)
    : (verifyPassword(password, DUMMY_HASH), false);

  if (!ok) {
    recordFailure(key);
    return res.status(401).json({ error: 'Username atau password salah' });
  }

  loginAttempts.delete(key);
  const token = createSession(user.username);
  setSessionCookie(req, res, token);
  res.json({ username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token && sessions[hashToken(token)]) {
    delete sessions[hashToken(token)];
    writeJsonFile(SESSIONS_FILE, sessions);
  }
  clearSessionCookie(res);
  res.json({ message: 'Berhasil logout' });
});

// Serve uploaded files statically (wajib login)
app.use('/uploads', requireAuth, express.static(UPLOADS_DIR));

// Database Helper
function getDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return { courses: [], tasks: [], materials: [] };
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading db.json:', err);
    return { courses: [], tasks: [], materials: [] };
  }
}

function saveDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error saving db.json:', err);
    return false;
  }
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const sanitizedOriginal = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, uniqueSuffix + '-' + sanitizedOriginal);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// ===================== ROUTES ===================== //

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// File Upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Tidak ada file yang diunggah' });
  }

  const fileData = {
    fileName: req.file.originalname,
    storedName: req.file.filename,
    fileUrl: `/uploads/${req.file.filename}`,
    size: req.file.size,
    mimeType: req.file.mimetype,
    uploadedAt: new Date().toISOString()
  };

  res.json(fileData);
});

// ===================== COURSES API ===================== //

app.get('/api/courses', (req, res) => {
  const db = getDb();
  // enrich courses with counts
  const enriched = db.courses.map(course => {
    const courseTasks = db.tasks.filter(t => t.courseId === course.id);
    const mandiri = courseTasks.filter(t => t.type === 'mandiri');
    const kelompok = courseTasks.filter(t => t.type === 'kelompok');
    const completed = courseTasks.filter(t => t.status === 'completed');
    const materials = db.materials.filter(m => m.courseId === course.id);

    return {
      ...course,
      totalTasks: courseTasks.length,
      mandiriCount: mandiri.length,
      kelompokCount: kelompok.length,
      completedCount: completed.length,
      progressPercent: courseTasks.length > 0 ? Math.round((completed.length / courseTasks.length) * 100) : 0,
      materialCount: materials.length
    };
  });

  res.json(enriched);
});

app.get('/api/courses/:id', (req, res) => {
  const db = getDb();
  const course = db.courses.find(c => c.id === req.params.id);
  if (!course) {
    return res.status(404).json({ error: 'Mata kuliah tidak ditemukan' });
  }

  const tasks = db.tasks.filter(t => t.courseId === course.id);
  const materials = db.materials.filter(m => m.courseId === course.id);

  res.json({
    ...course,
    tasks,
    materials
  });
});

app.post('/api/courses', (req, res) => {
  const db = getDb();
  const { name, code, lecturer, lecturerContact, credits, semester, day, time, room, color, description } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Nama mata kuliah wajib diisi' });
  }

  const newCourse = {
    id: 'c_' + Date.now(),
    code: code ? code.trim().toUpperCase() : 'MK' + Math.floor(1000 + Math.random() * 9000),
    name: name.trim(),
    lecturer: lecturer ? lecturer.trim() : '',
    lecturerContact: lecturerContact ? lecturerContact.trim() : '',
    credits: Number(credits) || 2,
    semester: Number(semester) || 1,
    day: day || 'Senin',
    time: time || '08:00 - 10:00',
    room: room || 'R. Kelas',
    color: color || 'indigo',
    description: description || ''
  };

  db.courses.push(newCourse);
  saveDb(db);

  res.status(201).json(newCourse);
});

app.put('/api/courses/:id', (req, res) => {
  const db = getDb();
  const idx = db.courses.findIndex(c => c.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Mata kuliah tidak ditemukan' });
  }

  const { name, code, lecturer, lecturerContact, credits, semester, day, time, room, color, description } = req.body;

  db.courses[idx] = {
    ...db.courses[idx],
    name: name !== undefined ? name.trim() : db.courses[idx].name,
    code: code !== undefined ? code.trim().toUpperCase() : db.courses[idx].code,
    lecturer: lecturer !== undefined ? lecturer.trim() : db.courses[idx].lecturer,
    lecturerContact: lecturerContact !== undefined ? lecturerContact.trim() : db.courses[idx].lecturerContact,
    credits: credits !== undefined ? Number(credits) : db.courses[idx].credits,
    semester: semester !== undefined ? Number(semester) : db.courses[idx].semester,
    day: day !== undefined ? day : db.courses[idx].day,
    time: time !== undefined ? time : db.courses[idx].time,
    room: room !== undefined ? room : db.courses[idx].room,
    color: color !== undefined ? color : db.courses[idx].color,
    description: description !== undefined ? description : db.courses[idx].description
  };

  saveDb(db);
  res.json(db.courses[idx]);
});

app.delete('/api/courses/:id', (req, res) => {
  const db = getDb();
  const courseId = req.params.id;

  const exists = db.courses.some(c => c.id === courseId);
  if (!exists) {
    return res.status(404).json({ error: 'Mata kuliah tidak ditemukan' });
  }

  // Cascade delete
  db.courses = db.courses.filter(c => c.id !== courseId);
  db.tasks = db.tasks.filter(t => t.courseId !== courseId);
  db.materials = db.materials.filter(m => m.courseId !== courseId);

  saveDb(db);
  res.json({ message: 'Mata kuliah beserta tugas dan materi terkait berhasil dihapus' });
});

// ===================== TASKS API ===================== //

app.get('/api/tasks', (req, res) => {
  const db = getDb();
  let tasks = [...db.tasks];

  const { courseId, type, status, search } = req.query;

  if (courseId) {
    tasks = tasks.filter(t => t.courseId === courseId);
  }
  if (type) {
    tasks = tasks.filter(t => t.type === type);
  }
  if (status) {
    tasks = tasks.filter(t => t.status === status);
  }
  if (search) {
    const q = search.toLowerCase();
    tasks = tasks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      (t.description && t.description.toLowerCase().includes(q)) ||
      (t.groupName && t.groupName.toLowerCase().includes(q))
    );
  }

  // attach course info for convenience
  const courseMap = new Map(db.courses.map(c => [c.id, c]));
  const enriched = tasks.map(t => ({
    ...t,
    course: courseMap.get(t.courseId) || null
  }));

  res.json(enriched);
});

app.post('/api/tasks', (req, res) => {
  const db = getDb();
  const {
    courseId,
    title,
    type, // 'mandiri' or 'kelompok'
    description,
    deadline,
    priority, // 'rendah', 'sedang', 'tinggi'
    status, // 'todo', 'in_progress', 'completed'
    submissionLink,
    groupName,
    groupMembers,
    attachments
  } = req.body;

  if (!courseId) {
    return res.status(400).json({ error: 'Mata kuliah wajib dipilih' });
  }
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Judul tugas wajib diisi' });
  }

  const newTask = {
    id: 't_' + Date.now(),
    courseId,
    title: title.trim(),
    type: type === 'kelompok' ? 'kelompok' : 'mandiri',
    description: description ? description.trim() : '',
    deadline: deadline || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16),
    priority: priority || 'sedang',
    status: status || 'todo',
    submissionLink: submissionLink ? submissionLink.trim() : '',
    groupName: type === 'kelompok' ? (groupName || 'Kelompok') : '',
    groupMembers: Array.isArray(groupMembers) ? groupMembers.map((m, idx) => ({
      id: m.id || 'm_' + (Date.now() + idx),
      name: m.name ? m.name.trim() : `Anggota ${idx + 1}`,
      role: m.role ? m.role.trim() : 'Anggota',
      done: Boolean(m.done)
    })) : [],
    attachments: Array.isArray(attachments) ? attachments : [],
    createdAt: new Date().toISOString()
  };

  db.tasks.push(newTask);
  saveDb(db);

  const course = db.courses.find(c => c.id === courseId);
  res.status(201).json({ ...newTask, course });
});

app.put('/api/tasks/:id', (req, res) => {
  const db = getDb();
  const idx = db.tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Tugas tidak ditemukan' });
  }

  const old = db.tasks[idx];
  const {
    courseId,
    title,
    type,
    description,
    deadline,
    priority,
    status,
    submissionLink,
    groupName,
    groupMembers,
    attachments
  } = req.body;

  db.tasks[idx] = {
    ...old,
    courseId: courseId !== undefined ? courseId : old.courseId,
    title: title !== undefined ? title.trim() : old.title,
    type: type !== undefined ? type : old.type,
    description: description !== undefined ? description.trim() : old.description,
    deadline: deadline !== undefined ? deadline : old.deadline,
    priority: priority !== undefined ? priority : old.priority,
    status: status !== undefined ? status : old.status,
    submissionLink: submissionLink !== undefined ? submissionLink.trim() : old.submissionLink,
    groupName: groupName !== undefined ? groupName.trim() : old.groupName,
    groupMembers: Array.isArray(groupMembers) ? groupMembers.map((m, i) => ({
      id: m.id || 'm_' + (Date.now() + i),
      name: m.name ? m.name.trim() : `Anggota ${i + 1}`,
      role: m.role ? m.role.trim() : '',
      done: Boolean(m.done)
    })) : old.groupMembers,
    attachments: Array.isArray(attachments) ? attachments : old.attachments,
    updatedAt: new Date().toISOString()
  };

  saveDb(db);
  const course = db.courses.find(c => c.id === db.tasks[idx].courseId);
  res.json({ ...db.tasks[idx], course });
});

app.patch('/api/tasks/:id/status', (req, res) => {
  const db = getDb();
  const task = db.tasks.find(t => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Tugas tidak ditemukan' });
  }

  const { status } = req.body;
  if (!['todo', 'in_progress', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Status tidak valid' });
  }

  task.status = status;
  task.updatedAt = new Date().toISOString();
  saveDb(db);

  const course = db.courses.find(c => c.id === task.courseId);
  res.json({ ...task, course });
});

app.patch('/api/tasks/:id/checklist/:memberId', (req, res) => {
  const db = getDb();
  const task = db.tasks.find(t => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Tugas tidak ditemukan' });
  }

  if (!Array.isArray(task.groupMembers)) {
    task.groupMembers = [];
  }

  const member = task.groupMembers.find(m => m.id === req.params.memberId);
  if (!member) {
    return res.status(404).json({ error: 'Anggota kelompok tidak ditemukan' });
  }

  member.done = !member.done;
  task.updatedAt = new Date().toISOString();
  saveDb(db);

  const course = db.courses.find(c => c.id === task.courseId);
  res.json({ ...task, course });
});

app.delete('/api/tasks/:id', (req, res) => {
  const db = getDb();
  const exists = db.tasks.some(t => t.id === req.params.id);
  if (!exists) {
    return res.status(404).json({ error: 'Tugas tidak ditemukan' });
  }

  db.tasks = db.tasks.filter(t => t.id !== req.params.id);
  saveDb(db);
  res.json({ message: 'Tugas berhasil dihapus' });
});

// ===================== MATERIALS API ===================== //

app.get('/api/materials', (req, res) => {
  const db = getDb();
  let materials = [...db.materials];

  const { courseId, category, search } = req.query;

  if (courseId) {
    materials = materials.filter(m => m.courseId === courseId);
  }
  if (category) {
    materials = materials.filter(m => m.category === category);
  }
  if (search) {
    const q = search.toLowerCase();
    materials = materials.filter(m =>
      m.title.toLowerCase().includes(q) ||
      (m.description && m.description.toLowerCase().includes(q))
    );
  }

  // Sort by meeting number ascending
  materials.sort((a, b) => (Number(a.meeting) || 0) - (Number(b.meeting) || 0));

  const courseMap = new Map(db.courses.map(c => [c.id, c]));
  const enriched = materials.map(m => ({
    ...m,
    course: courseMap.get(m.courseId) || null
  }));

  res.json(enriched);
});

app.post('/api/materials', (req, res) => {
  const db = getDb();
  const { courseId, meeting, title, category, description, fileUrl, fileName, externalLink } = req.body;

  if (!courseId) {
    return res.status(400).json({ error: 'Mata kuliah wajib dipilih' });
  }
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Judul materi wajib diisi' });
  }

  const newMaterial = {
    id: 'mat_' + Date.now(),
    courseId,
    meeting: Number(meeting) || 1,
    title: title.trim(),
    category: category || 'slide', // slide, modul, catatan, video, link
    description: description ? description.trim() : '',
    fileUrl: fileUrl || '',
    fileName: fileName || '',
    externalLink: externalLink ? externalLink.trim() : '',
    createdAt: new Date().toISOString()
  };

  db.materials.push(newMaterial);
  saveDb(db);

  const course = db.courses.find(c => c.id === courseId);
  res.status(201).json({ ...newMaterial, course });
});

app.put('/api/materials/:id', (req, res) => {
  const db = getDb();
  const idx = db.materials.findIndex(m => m.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Materi tidak ditemukan' });
  }

  const old = db.materials[idx];
  const { courseId, meeting, title, category, description, fileUrl, fileName, externalLink } = req.body;

  db.materials[idx] = {
    ...old,
    courseId: courseId !== undefined ? courseId : old.courseId,
    meeting: meeting !== undefined ? Number(meeting) : old.meeting,
    title: title !== undefined ? title.trim() : old.title,
    category: category !== undefined ? category : old.category,
    description: description !== undefined ? description.trim() : old.description,
    fileUrl: fileUrl !== undefined ? fileUrl : old.fileUrl,
    fileName: fileName !== undefined ? fileName : old.fileName,
    externalLink: externalLink !== undefined ? externalLink.trim() : old.externalLink,
    updatedAt: new Date().toISOString()
  };

  saveDb(db);
  const course = db.courses.find(c => c.id === db.materials[idx].courseId);
  res.json({ ...db.materials[idx], course });
});

app.delete('/api/materials/:id', (req, res) => {
  const db = getDb();
  const exists = db.materials.some(m => m.id === req.params.id);
  if (!exists) {
    return res.status(404).json({ error: 'Materi tidak ditemukan' });
  }

  db.materials = db.materials.filter(m => m.id !== req.params.id);
  saveDb(db);
  res.json({ message: 'Materi berhasil dihapus' });
});

// ===================== DASHBOARD / OVERVIEW API ===================== //

app.get('/api/dashboard', (req, res) => {
  const db = getDb();
  const courseMap = new Map(db.courses.map(c => [c.id, c]));

  const enrichedTasks = db.tasks.map(t => ({
    ...t,
    course: courseMap.get(t.courseId) || null
  }));

  const now = new Date();

  // Upcoming non-completed tasks sorted by deadline
  const upcomingTasks = enrichedTasks
    .filter(t => t.status !== 'completed' && new Date(t.deadline) >= now)
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

  // Overdue tasks: past deadline and not completed
  const overdueTasks = enrichedTasks
    .filter(t => t.status !== 'completed' && new Date(t.deadline) < now)
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

  // Counts
  const mandiriTasks = db.tasks.filter(t => t.type === 'mandiri');
  const kelompokTasks = db.tasks.filter(t => t.type === 'kelompok');

  const stats = {
    totalCourses: db.courses.length,
    totalTasks: db.tasks.length,
    mandiriTotal: mandiriTasks.length,
    mandiriCompleted: mandiriTasks.filter(t => t.status === 'completed').length,
    mandiriPending: mandiriTasks.filter(t => t.status !== 'completed').length,
    kelompokTotal: kelompokTasks.length,
    kelompokCompleted: kelompokTasks.filter(t => t.status === 'completed').length,
    kelompokPending: kelompokTasks.filter(t => t.status !== 'completed').length,
    totalCompleted: db.tasks.filter(t => t.status === 'completed').length,
    totalMaterials: db.materials.length,
    upcomingCount: upcomingTasks.length,
    overdueCount: overdueTasks.length
  };

  // Recent materials
  const recentMaterials = [...db.materials]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 5)
    .map(m => ({ ...m, course: courseMap.get(m.courseId) || null }));

  res.json({
    stats,
    upcomingTasks: upcomingTasks.slice(0, 6),
    overdueTasks,
    recentMaterials
  });
});

// ===================== BACKUP & EXPORT/IMPORT API ===================== //

app.get('/api/backup/export', (req, res) => {
  const db = getDb();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="backup-tugas-kuliah.json"');
  res.json(db);
});

app.post('/api/backup/import', (req, res) => {
  const data = req.body;
  if (!data || !Array.isArray(data.courses) || !Array.isArray(data.tasks)) {
    return res.status(400).json({ error: 'Format file JSON backup tidak valid' });
  }

  saveDb({
    courses: data.courses || [],
    tasks: data.tasks || [],
    materials: data.materials || []
  });

  res.json({ message: 'Data berhasil dipulihkan dari backup!' });
});

// ===================== PRODUCTION FRONTEND SERVE ===================== //
const CLIENT_DIST = path.join(__dirname, '../client/dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server Tugas Kuliah berjalan pada port ${PORT}`);
  console.log(`API URL: http://localhost:${PORT}/api`);
});
