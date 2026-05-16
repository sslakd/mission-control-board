const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(cors());
app.use(express.json());

// Helper: read data
function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

// Helper: write data
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// GET /api/tasks — list all tasks
app.get('/api/tasks', (req, res) => {
  const data = readData();
  res.json(data.tasks);
});

// GET /api/tasks/:id — single task + file content
app.get('/api/tasks/:id', (req, res) => {
  const data = readData();
  const task = data.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  // Try to read markdown file if exists
  let fileContent = null;
  if (task.filePath && fs.existsSync(task.filePath)) {
    fileContent = fs.readFileSync(task.filePath, 'utf8').slice(0, 5000); // first 5000 chars
  }

  res.json({ ...task, fileContent });
});

// PATCH /api/tasks/:id — update task fields
app.patch('/api/tasks/:id', (req, res) => {
  const data = readData();
  const idx = data.tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });

  const allowed = ['progress', 'progressText', 'deadline', 'priority', 'status', 'done', 'description'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      data.tasks[idx][key] = req.body[key];
    }
  }

  // Update details subtasks
  if (req.body.details) {
    data.tasks[idx].details = req.body.details;
  }

  writeData(data);
  res.json(data.tasks[idx]);
});

// POST /api/tasks/:id/toggle — toggle done status
app.post('/api/tasks/:id/toggle', (req, res) => {
  const data = readData();
  const task = data.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  task.done = !task.done;
  if (task.done) {
    task.status = 'done';
    task.progress = 100;
  } else {
    task.status = 'in-progress';
  }

  writeData(data);
  res.json(task);
});

// POST /api/tasks/:id/subtask/:subIdx/toggle — toggle subtask
app.post('/api/tasks/:id/subtask/:subIdx/toggle', (req, res) => {
  const data = readData();
  const task = data.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const subIdx = parseInt(req.params.subIdx);
  if (!task.details || !task.details[subIdx]) {
    return res.status(404).json({ error: 'Subtask not found' });
  }

  task.details[subIdx].done = !task.details[subIdx].done;
  
  // Recalculate progress
  if (task.details && task.details.length > 0) {
    const done = task.details.filter(s => s.done).length;
    task.progress = Math.round((done / task.details.length) * 100);
    task.progressText = `${task.progress}% (${done}/${task.details.length})`;
  }

  writeData(data);
  res.json(task);
});

// GET /api/file — read a markdown file
app.get('/api/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'No file path' });
  
  // Security: only allow paths under workspace
  const workspace = path.resolve('/Users/sonnguyen/.openclaw/workspace');
  const target = path.resolve(filePath);
  
  if (!target.startsWith(workspace)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(target)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const content = fs.readFileSync(target, 'utf8');
  res.json({ 
    filename: path.basename(target),
    content: content.slice(0, 10000) 
  });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 MC Board API running on http://127.0.0.1:${PORT}`);
});
