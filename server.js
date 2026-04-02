const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const fs = require('fs');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const APP_NAME = process.env.APP_NAME || 'FocusBoard';
const SECRET = process.env.JWT_SECRET || 'focusboard-v13-secret';
const PUBLIC_DIR = path.join(__dirname, 'public');
const LEGACY_DB_FILE = path.join(__dirname, 'data', 'db.json');

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

// Logging Middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const log = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      userId: req.auth ? req.auth.userId : 'anonymous',
      status: res.statusCode,
      responseTime_ms: duration,
      error: res.statusCode >= 400 ? res.statusMessage : null
    };
    console.log(`[REQ] ${JSON.stringify(log)}`);
  });
  next();
});

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  }
}

function sanitizeUser(user) {
  const obj = user.toObject ? user.toObject() : user;
  const { passwordHash, __v, ...safe } = obj;
  return safe;
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    req.auth = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function str(v, max = 300) {
  return String(v || '').trim().slice(0, max);
}

function int(v, min = 0, max = 100000) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return Math.round(n);
}

function date(v) {
  const s = str(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function validateStudy(payload = {}) {
  const out = {
    date: date(payload.date),
    topic: str(payload.topic, 120),
    minutes: int(payload.minutes, 1, 600),
    problemsSolved: int(payload.problemsSolved, 0, 10000),
    notes: str(payload.notes, 800)
  };
  if (!out.date || !out.topic || out.minutes === null || out.problemsSolved === null) return null;
  return out;
}

function validateWorkout(payload = {}) {
  const out = {
    date: date(payload.date),
    day: str(payload.day, 120),
    duration: int(payload.duration, 1, 300),
    notes: str(payload.notes, 800)
  };
  if (!out.date || !out.day || out.duration === null) return null;
  return out;
}

function validateProject(payload = {}) {
  const status = str(payload.status, 40);
  const out = {
    title: str(payload.title, 140),
    status: ['Planned', 'Building', 'Done', 'On Hold'].includes(status) ? status : 'Planned',
    stack: str(payload.stack, 180),
    link: str(payload.link, 400),
    notes: str(payload.notes, 1200)
  };
  if (!out.title) return null;
  return out;
}

function validateMilestone(payload = {}) {
  const out = {
    title: str(payload.title, 160),
    date: date(payload.date)
  };
  if (!out.title || !out.date) return null;
  return out;
}

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    plan: { type: String, default: 'free' },
    theme: { type: String, default: 'cyan' },
    headline: { type: String, default: 'Personal workspace for study, projects, and fitness tracking' },
    focus: { type: [String], default: ['Study', 'Projects', 'Fitness'] },
    settings: {
      compactMode: { type: Boolean, default: false }
    },
    streak: { type: Number, default: 0 },
    streakDate: { type: String, default: '' }, // YYYY-MM-DD
    longestStreak: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const dailyGoalSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD
    goals: [{
      type: { type: String, enum: ['study', 'workout', 'project'], required: true },
      target: { type: Number, required: true }, // min (1-600)
      completed: { type: Number, default: 0 },
      priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' }
    }]
  },
  { timestamps: true }
);

const baseRef = {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'User',
  required: true,
  index: true
};

const studySchema = new mongoose.Schema(
  {
    userId: baseRef,
    date: { type: String, required: true },
    topic: { type: String, required: true, trim: true },
    minutes: { type: Number, required: true },
    problemsSolved: { type: Number, default: 0 },
    notes: { type: String, default: '' }
  },
  { timestamps: true }
);

const workoutSchema = new mongoose.Schema(
  {
    userId: baseRef,
    date: { type: String, required: true },
    day: { type: String, required: true, trim: true },
    duration: { type: Number, required: true },
    notes: { type: String, default: '' }
  },
  { timestamps: true }
);

const projectSchema = new mongoose.Schema(
  {
    userId: baseRef,
    title: { type: String, required: true, trim: true },
    status: { type: String, enum: ['Planned', 'Building', 'Done', 'On Hold'], default: 'Planned' },
    stack: { type: String, default: '' },
    link: { type: String, default: '' },
    notes: { type: String, default: '' }
  },
  { timestamps: true }
);

const milestoneSchema = new mongoose.Schema(
  {
    userId: baseRef,
    title: { type: String, required: true, trim: true },
    date: { type: String, required: true }
  },
  { timestamps: true }
);

const User = mongoose.model('User', userSchema);
const DailyGoal = mongoose.model('DailyGoal', dailyGoalSchema);
const Study = mongoose.model('Study', studySchema);
const Workout = mongoose.model('Workout', workoutSchema);
const Project = mongoose.model('Project', projectSchema);
const Milestone = mongoose.model('Milestone', milestoneSchema);

async function summarize(userId) {
  const [studySessions, workouts, projects, milestones] = await Promise.all([
    Study.find({ userId }),
    Workout.find({ userId }),
    Project.find({ userId }),
    Milestone.find({ userId })
  ]);

  const totalStudyMinutes = studySessions.reduce((a, s) => a + Number(s.minutes || 0), 0);
  const totalProblems = studySessions.reduce((a, s) => a + Number(s.problemsSolved || 0), 0);
  const totalWorkoutMinutes = workouts.reduce((a, w) => a + Number(w.duration || 0), 0);

  return {
    totalStudyMinutes,
    totalProblems,
    totalWorkoutMinutes,
    totalProjects: projects.length,
    activeProjects: projects.filter(p => p.status !== 'Done').length,
    completedProjects: projects.filter(p => p.status === 'Done').length,
    milestones: milestones.length,
    studySessions: studySessions.length,
    workouts: workouts.length
  };
}

async function updateStreakIfNeeded(userId) {
  const user = await User.findById(userId);
  if (!user) return;

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  if (user.streakDate === today) return;

  if (user.streakDate === yesterday) {
    user.streak += 1;
  } else {
    user.streak = 1;
  }

  user.streakDate = today;
  if (user.streak > (user.longestStreak || 0)) {
    user.longestStreak = user.streak;
  }
  await user.save();
}

async function getTodayData(userId) {
  const date = new Date().toISOString().split('T')[0];
  let daily = await DailyGoal.findOne({ userId, date });
  if (!daily) {
    daily = await DailyGoal.create({
      userId,
      date,
      goals: [
        { type: 'study', target: 120, priority: 'high' },
        { type: 'workout', target: 45, priority: 'medium' },
        { type: 'project', target: 60, priority: 'low' }
      ]
    });
  }
  const totalTarget = daily.goals.reduce((a, g) => a + g.target, 0);
  const totalCompleted = daily.goals.reduce((a, g) => a + Math.min(g.completed, g.target), 0);
  const completionPercentage = totalTarget > 0 ? Math.round((totalCompleted / totalTarget) * 100) : 0;

  return {
    date: daily.date,
    goals: daily.goals,
    completionPercentage
  };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: APP_NAME, version: 'P-1.1' });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const name = str(req.body.name, 80);
    const email = str(req.body.email, 160).toLowerCase();
    const password = String(req.body.password || '');

    if (!name || !email || password.length < 8) {
      return res.status(400).json({ error: 'Name, email, and password (8+ chars) are required' });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      passwordHash,
      plan: 'free',
      theme: 'cyan',
      headline: 'Personal workspace for study, projects, and fitness tracking',
      focus: ['Study', 'Projects', 'Fitness'],
      settings: { compactMode: false }
    });

    const token = jwt.sign({ userId: user._id.toString(), email: user.email }, SECRET, { expiresIn: '7d' });
    res.json({ token, user: sanitizeUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = str(req.body.email, 160).toLowerCase();
    const password = String(req.body.password || '');

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ userId: user._id.toString(), email: user.email }, SECRET, { expiresIn: '7d' });
    res.json({ token, user: sanitizeUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.auth.userId);
    if (!user) return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });

    const [stats, today, recentActivities] = await Promise.all([
      summarize(user._id),
      getTodayData(user._id),
      Study.find({ userId: user._id }).sort({ createdAt: -1 }).limit(10)
    ]);

    res.json({
      user: sanitizeUser(user),
      stats,
      today,
      recentActivities
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch core data', code: 'DB_ERROR' });
  }
});

app.put('/api/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.auth.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.name = str(req.body.name, 80) || user.name;
    user.headline = str(req.body.headline, 160) || user.headline;
    user.focus = Array.isArray(req.body.focus)
      ? req.body.focus.map(v => str(v, 40)).filter(Boolean).slice(0, 6)
      : user.focus;

    if (['cyan', 'green', 'purple', 'amber'].includes(req.body.theme)) {
      user.theme = req.body.theme;
    }

    user.settings.compactMode = Boolean(req.body.compactMode);
    await user.save();

    res.json({ user: sanitizeUser(user), stats: await summarize(user._id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

app.get('/api/studySessions', auth, async (req, res) => {
  try {
    const items = await Study.find({ userId: req.auth.userId }).sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch study sessions' });
  }
});

app.get('/api/workouts', auth, async (req, res) => {
  try {
    const items = await Workout.find({ userId: req.auth.userId }).sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch workouts' });
  }
});

app.get('/api/projects', auth, async (req, res) => {
  try {
    const items = await Project.find({ userId: req.auth.userId }).sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

app.get('/api/milestones', auth, async (req, res) => {
  try {
    const items = await Milestone.find({ userId: req.auth.userId }).sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch milestones' });
  }
});

app.post('/api/studySessions', auth, async (req, res) => {
  try {
    const entry = validateStudy(req.body);
    if (!entry) return res.status(400).json({ error: 'Invalid study payload', code: 'INVALID_INPUT' });
    const item = await Study.create({ userId: req.auth.userId, ...entry });
    await updateStreakIfNeeded(req.auth.userId);
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create study session', code: 'DB_ERROR' });
  }
});

app.put('/api/studySessions/:id', auth, async (req, res) => {
  try {
    const entry = validateStudy(req.body);
    if (!entry) return res.status(400).json({ error: 'Invalid study payload' });

    const item = await Study.findOneAndUpdate(
      { _id: req.params.id, userId: req.auth.userId },
      entry,
      { new: true }
    );

    if (!item) return res.status(404).json({ error: 'Study session not found' });
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update study session' });
  }
});

app.delete('/api/studySessions/:id', auth, async (req, res) => {
  try {
    const item = await Study.findOneAndDelete({ _id: req.params.id, userId: req.auth.userId });
    if (!item) return res.status(404).json({ error: 'Study session not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete study session' });
  }
});

app.post('/api/workouts', auth, async (req, res) => {
  try {
    const entry = validateWorkout(req.body);
    if (!entry) return res.status(400).json({ error: 'Invalid workout payload', code: 'INVALID_INPUT' });
    const item = await Workout.create({ userId: req.auth.userId, ...entry });
    await updateStreakIfNeeded(req.auth.userId);
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create workout', code: 'DB_ERROR' });
  }
});

app.put('/api/workouts/:id', auth, async (req, res) => {
  try {
    const entry = validateWorkout(req.body);
    if (!entry) return res.status(400).json({ error: 'Invalid workout payload' });

    const item = await Workout.findOneAndUpdate(
      { _id: req.params.id, userId: req.auth.userId },
      entry,
      { new: true }
    );

    if (!item) return res.status(404).json({ error: 'Workout not found' });
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update workout' });
  }
});

app.delete('/api/workouts/:id', auth, async (req, res) => {
  try {
    const item = await Workout.findOneAndDelete({ _id: req.params.id, userId: req.auth.userId });
    if (!item) return res.status(404).json({ error: 'Workout not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete workout' });
  }
});

app.post('/api/projects', auth, async (req, res) => {
  try {
    const entry = validateProject(req.body);
    if (!entry) return res.status(400).json({ error: 'Invalid project payload', code: 'INVALID_INPUT' });
    const item = await Project.create({ userId: req.auth.userId, ...entry });
    await updateStreakIfNeeded(req.auth.userId);
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create project', code: 'DB_ERROR' });
  }
});

app.put('/api/projects/:id', auth, async (req, res) => {
  try {
    const entry = validateProject(req.body);
    if (!entry) return res.status(400).json({ error: 'Invalid project payload' });

    const item = await Project.findOneAndUpdate(
      { _id: req.params.id, userId: req.auth.userId },
      entry,
      { new: true }
    );

    if (!item) return res.status(404).json({ error: 'Project not found' });
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

app.delete('/api/projects/:id', auth, async (req, res) => {
  try {
    const item = await Project.findOneAndDelete({ _id: req.params.id, userId: req.auth.userId });
    if (!item) return res.status(404).json({ error: 'Project not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

app.post('/api/milestones', auth, async (req, res) => {
  try {
    const entry = validateMilestone(req.body);
    if (!entry) return res.status(400).json({ error: 'Invalid milestone payload' });
    const item = await Milestone.create({ userId: req.auth.userId, ...entry });
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create milestone' });
  }
});

app.put('/api/milestones/:id', auth, async (req, res) => {
  try {
    const entry = validateMilestone(req.body);
    if (!entry) return res.status(400).json({ error: 'Invalid milestone payload' });

    const item = await Milestone.findOneAndUpdate(
      { _id: req.params.id, userId: req.auth.userId },
      entry,
      { new: true }
    );

    if (!item) return res.status(404).json({ error: 'Milestone not found' });
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update milestone' });
  }
});

app.delete('/api/milestones/:id', auth, async (req, res) => {
  try {
    const item = await Milestone.findOneAndDelete({ _id: req.params.id, userId: req.auth.userId });
    if (!item) return res.status(404).json({ error: 'Milestone not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete milestone' });
  }
});

app.post('/api/today/goals', auth, async (req, res) => {
  try {
    const { goals } = req.body;
    if (!Array.isArray(goals)) return res.status(400).json({ error: 'Invalid goals format', code: 'INVALID_INPUT' });

    const date = new Date().toISOString().split('T')[0];
    let daily = await DailyGoal.findOne({ userId: req.auth.userId, date });

    const sanitized = goals.map(g => ({
      type: str(g.type),
      target: int(g.target, 1, 600) || 60,
      priority: ['high', 'medium', 'low'].includes(g.priority) ? g.priority : 'medium',
      completed: 0
    })).filter(g => ['study', 'workout', 'project'].includes(g.type));

    if (daily) {
      daily.goals = sanitized;
      await daily.save();
    } else {
      daily = await DailyGoal.create({ userId: req.auth.userId, date, goals: sanitized });
    }

    res.json({ success: true, goals: daily.goals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save goals', code: 'DB_ERROR' });
  }
});

app.patch('/api/today/goals/:type', auth, async (req, res) => {
  try {
    const { type } = req.params;
    const completed = int(req.body.completed, 0, 600);
    if (completed === null) return res.status(400).json({ error: 'Invalid completion value', code: 'INVALID_INPUT' });

    const date = new Date().toISOString().split('T')[0];
    const daily = await DailyGoal.findOne({ userId: req.auth.userId, date });
    if (!daily) return res.status(404).json({ error: 'No goals set for today', code: 'NOT_FOUND' });

    const goal = daily.goals.find(g => g.type === type);
    if (!goal) return res.status(404).json({ error: 'Goal type not found', code: 'NOT_FOUND' });

    goal.completed = completed;
    await daily.save();

    res.json({
      success: true,
      updated: {
        type: goal.type,
        completed: goal.completed,
        target: goal.target,
        percentage: Math.round((goal.completed / goal.target) * 100)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update goal', code: 'DB_ERROR' });
  }
});

app.get('/api/dashboard', auth, async (req, res) => {
  try {
    const user = await User.findById(req.auth.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const [milestones, studySessions, workouts, projects, stats] = await Promise.all([
      Milestone.find({ userId: user._id }).sort({ createdAt: -1 }).limit(5),
      Study.find({ userId: user._id }).sort({ createdAt: -1 }).limit(5),
      Workout.find({ userId: user._id }).sort({ createdAt: -1 }).limit(5),
      Project.find({ userId: user._id }).sort({ createdAt: -1 }).limit(5),
      summarize(user._id)
    ]);

    res.json({ user: sanitizeUser(user), stats, milestones, studySessions, workouts, projects });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

app.get('/api/analytics', auth, async (req, res) => {
  try {
    const user = await User.findById(req.auth.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const [studySessions, workouts, stats] = await Promise.all([
      Study.find({ userId: user._id }).sort({ date: 1 }),
      Workout.find({ userId: user._id }).sort({ date: 1 }),
      summarize(user._id)
    ]);

    res.json({
      studyByDate: studySessions.map(s => ({ date: s.date, value: Number(s.minutes || 0) })),
      problemsByDate: studySessions.map(s => ({ date: s.date, value: Number(s.problemsSolved || 0) })),
      workoutsByDate: workouts.map(w => ({ date: w.date, value: Number(w.duration || 0) })),
      stats
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

app.get('/api/export', auth, async (req, res) => {
  try {
    const user = await User.findById(req.auth.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const [studySessions, workouts, projects, milestones] = await Promise.all([
      Study.find({ userId: user._id }).sort({ createdAt: -1 }),
      Workout.find({ userId: user._id }).sort({ createdAt: -1 }),
      Project.find({ userId: user._id }).sort({ createdAt: -1 }),
      Milestone.find({ userId: user._id }).sort({ createdAt: -1 })
    ]);

    res.setHeader('Content-Disposition', `attachment; filename="focusboard-backup-${user._id}.json"`);
    res.json({ user: sanitizeUser(user), studySessions, workouts, projects, milestones });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Optional one-time migration route for legacy db.json
app.post('/api/admin/migrate-legacy', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!process.env.ADMIN_MIGRATE_KEY || adminKey !== process.env.ADMIN_MIGRATE_KEY) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (!fs.existsSync(LEGACY_DB_FILE)) {
      return res.status(404).json({ error: 'Legacy db.json not found' });
    }

    const raw = fs.readFileSync(LEGACY_DB_FILE, 'utf8');
    const db = JSON.parse(raw || '{}');
    const users = Array.isArray(db.users) ? db.users : [];
    let migratedUsers = 0;

    for (const oldUser of users) {
      const email = String(oldUser.email || '').toLowerCase().trim();
      if (!email) continue;

      let user = await User.findOne({ email });
      if (!user) {
        user = await User.create({
          name: oldUser.name || 'User',
          email,
          passwordHash: oldUser.passwordHash || await bcrypt.hash('changeme123', 10),
          plan: oldUser.plan || 'free',
          theme: oldUser.theme || 'cyan',
          headline: oldUser.headline || 'Personal workspace for study, projects, and fitness tracking',
          focus: Array.isArray(oldUser.focus) ? oldUser.focus : ['Study', 'Projects', 'Fitness'],
          settings: oldUser.settings || { compactMode: false }
        });
      }

      const oldStudies = Array.isArray(oldUser.studySessions) ? oldUser.studySessions : [];
      const oldWorkouts = Array.isArray(oldUser.workouts) ? oldUser.workouts : [];
      const oldProjects = Array.isArray(oldUser.projects) ? oldUser.projects : [];
      const oldMilestones = Array.isArray(oldUser.milestones) ? oldUser.milestones : [];

      if (oldStudies.length) {
        await Study.insertMany(oldStudies.map(s => ({
          userId: user._id,
          date: s.date || '2026-01-01',
          topic: s.topic || 'Untitled',
          minutes: Number(s.minutes || 0),
          problemsSolved: Number(s.problemsSolved || 0),
          notes: s.notes || ''
        })));
      }

      if (oldWorkouts.length) {
        await Workout.insertMany(oldWorkouts.map(w => ({
          userId: user._id,
          date: w.date || '2026-01-01',
          day: w.day || 'Workout',
          duration: Number(w.duration || 0),
          notes: w.notes || ''
        })));
      }

      if (oldProjects.length) {
        await Project.insertMany(oldProjects.map(p => ({
          userId: user._id,
          title: p.title || 'Untitled',
          status: ['Planned', 'Building', 'Done', 'On Hold'].includes(p.status) ? p.status : 'Planned',
          stack: p.stack || '',
          link: p.link || '',
          notes: p.notes || ''
        })));
      }

      if (oldMilestones.length) {
        await Milestone.insertMany(oldMilestones.map(m => ({
          userId: user._id,
          title: m.title || 'Untitled',
          date: m.date || '2026-01-01'
        })));
      }

      migratedUsers += 1;
    }

    res.json({ ok: true, migratedUsers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Legacy migration failed' });
  }
});

// Standardized Error Handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(err.status || 500).json({
    error: err.message || 'An unexpected error occurred',
    code: err.code || 'INTERNAL_ERROR',
    timestamp: new Date().toISOString(),
    path: req.path
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`${APP_NAME} P-1.1 running on http://localhost:${PORT}`);
  });
});
