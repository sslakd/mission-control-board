const canvas = document.querySelector("#gameCanvas");
const ctx = canvas.getContext("2d", { alpha: true });
const card = document.querySelector("#gameCard");

const UI = Object.fromEntries([
  "levelLabel", "scoreLabel", "rescuedLabel", "targetLabel", "shotsLabel", "toast", "combo",
  "startOverlay", "pauseOverlay", "resultOverlay", "playButton", "newGameButton", "pauseButton",
  "resumeButton", "restartButton", "soundButton", "nextButton", "pausedLevel", "pausedScore",
  "resultTitle", "resultText", "resultStars", "saveNote", "powerButton", "powerIcon",
  "powerName", "powerOverlay", "powerChoices", "powerSummary"
].map(id => [id, document.querySelector(`#${id}`)]));

const STORAGE_KEY = "bamboo-pop-save-v1";
const TAU = Math.PI * 2;
const storage = {
  get() {
    try { return localStorage.getItem(STORAGE_KEY); }
    catch { return null; }
  },
  set(value) {
    try { localStorage.setItem(STORAGE_KEY, value); }
    catch { /* The game remains playable when file:// storage is unavailable. */ }
  },
  remove() {
    try { localStorage.removeItem(STORAGE_KEY); }
    catch { /* No saved state to remove. */ }
  }
};
const COLORS = [
  { main: "#ff665c", light: "#ffd0b6", dark: "#bd3737" },
  { main: "#ffcf48", light: "#fff5a5", dark: "#d28a26" },
  { main: "#57c879", light: "#c7f6a7", dark: "#278652" },
  { main: "#56bfea", light: "#caf4ff", dark: "#2879ae" },
  { main: "#a979e9", light: "#e5cfff", dark: "#6542a9" },
  { main: "#f18fc3", light: "#ffd9ed", dark: "#b74f87" }
];

const POWER_UPS = {
  bomb: { icon: "✹", name: "Bom tre", description: "Nổ mọi bóng và đá trong bán kính 2 ô." },
  rainbow: { icon: "◉", name: "Cầu vồng", description: "Bóng kế tiếp tự khớp màu khi va chạm." },
  pierce: { icon: "➹", name: "Tia xuyên", description: "Xuyên và phá 2 bóng trên đường bay." },
  breaker: { icon: "◆", name: "Phá đá", description: "Phá toàn bộ đá quanh điểm va chạm." },
  guide: { icon: "⌁", name: "Ngắm chuẩn", description: "Hiện đường ngắm dài đến điểm va chạm." },
  color: { icon: "⬢", name: "Đổi màu", description: "Đổi bóng hiện tại sang màu có lợi nhất." },
  storm: { icon: "ϟ", name: "Gió xoáy", description: "Xóa toàn bộ bóng cùng màu bị bắn trúng." },
  freeze: { icon: "❄", name: "Đóng băng", description: "Chặn hạ trần trong toàn bộ màn này." },
  extra: { icon: "+3", name: "Thêm lượt", description: "Nhận ngay 3 lượt bắn bổ sung." },
  assist: { icon: "◎", name: "Panda trợ giúp", description: "Tự ngắm và bắn vào cụm màu tốt nhất." }
};

function freshMetrics() {
  return {
    shotsFired: 0, successfulShots: 0, directHits: 0, misses: 0,
    activeTime: 0, largestCombo: 0, rescuedPandas: 0
  };
}

const state = {
  width: 540, height: 960, dpr: 1, radius: 23, rowH: 39.8, cols: 11,
  level: 1, score: 0, levelScore: 0, rescued: 0, target: 1, shots: 8,
  maxShots: 8, colors: 4, misses: 0, pressureEvery: 6, grid: [], particles: [], floaters: [], falling: [],
  shooter: { x: 270, y: 866, angle: -Math.PI / 2, color: 0, next: 1 },
  projectile: null, aiming: false, pointer: { x: 270, y: 300 },
  playing: false, paused: false, resolving: false, sound: true, combo: 0,
  screenShake: 0, elapsed: 0, lastTime: 0, savedSnapshot: null,
  skillRating: 35, lastPerformance: 35, difficulty: 0, metrics: freshMetrics(),
  currentPowerUp: null, lastSelectedPowerUp: null, powerUsed: false, powerArmed: null,
  frozen: false, pendingNextLevel: null, powerChoices: []
};

let audioContext;

function resize() {
  const rect = card.getBoundingClientRect();
  state.dpr = Math.min(devicePixelRatio || 1, 2);
  state.width = rect.width;
  state.height = rect.height;
  canvas.width = Math.round(rect.width * state.dpr);
  canvas.height = Math.round(rect.height * state.dpr);
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  state.radius = Math.max(18, Math.min(24, state.width / 22.7));
  state.rowH = state.radius * 1.72;
  state.cols = Math.max(9, Math.floor((state.width - state.radius * 1.5) / (state.radius * 2)));
  state.shooter.x = state.width / 2;
  state.shooter.y = state.height - Math.max(83, state.height * .092);
}

function seededRandom(seed) {
  let x = Math.sin(seed * 999.71 + state.level * 78.23) * 43758.5453;
  return x - Math.floor(x);
}

function cellPosition(row, col) {
  const offset = row % 2 ? state.radius : 0;
  return {
    x: state.radius + 5 + offset + col * state.radius * 2,
    y: 111 + row * state.rowH
  };
}

function key(row, col) { return `${row},${col}`; }
function getCell(row, col) { return state.grid.find(b => b.row === row && b.col === col); }

function neighbors(row, col) {
  const dirs = row % 2
    ? [[0,-1],[0,1],[-1,0],[-1,1],[1,0],[1,1]]
    : [[0,-1],[0,1],[-1,-1],[-1,0],[1,-1],[1,0]];
  return dirs.map(([dr, dc]) => [row + dr, col + dc]);
}

function availableColors() {
  const set = [...new Set(state.grid.filter(b => !b.stone).map(b => b.color))];
  return set.length ? set : Array.from({ length: state.colors }, (_, i) => i);
}

function randomColor() {
  const colors = availableColors();
  return colors[Math.floor(Math.random() * colors.length)];
}

function levelConfig(level) {
  const skill = Math.max(0, Math.min(1, state.skillRating / 100));
  const postCap = Math.max(0, level - 15);
  const adaptive = skill * (2.2 + level * .055);
  const target = Math.min(10, 1 + Math.floor((level - 1) * 9 / 14));
  return {
    rows: Math.min(8 + Math.floor(level / 4) + Math.floor(adaptive / 2), 14),
    colors: Math.min(3 + Math.floor((level + adaptive) / 5), 6),
    target,
    shots: Math.max(6, target * 2 + 7 - Math.floor(adaptive * .7) - Math.floor(postCap / 12)),
    stoneChance: Math.min(.035 + level * .005 + adaptive * .012 + postCap * .002, .38),
    gapChance: Math.min(.07 + level * .002 + skill * .035, .19),
    pressureEvery: Math.max(1, 7 - Math.floor((level + adaptive * 2 + postCap) / 10)),
    protection: Math.min(1 + Math.floor((level + adaptive * 3 + postCap) / 9), 5),
    adaptive
  };
}

function createLevel(level, keepScore = true) {
  const config = levelConfig(level);
  state.level = level;
  state.colors = config.colors;
  state.target = config.target;
  state.rescued = 0;
  state.shots = config.shots;
  state.maxShots = config.shots;
  state.misses = 0;
  state.pressureEvery = config.pressureEvery;
  state.levelScore = 0;
  state.difficulty = config.adaptive;
  state.metrics = freshMetrics();
  state.powerUsed = false;
  state.powerArmed = null;
  state.frozen = false;
  state.grid = [];
  state.particles = [];
  state.falling = [];
  state.floaters = [];
  state.projectile = null;
  state.combo = 0;
  state.resolving = false;
  if (!keepScore) state.score = 0;

  let babiesPlaced = 0;
  for (let row = 0; row < config.rows; row++) {
    for (let col = 0; col < state.cols; col++) {
      if (cellPosition(row, col).x > state.width - state.radius - 4) continue;
      const rand = seededRandom(row * 31 + col * 17 + level * 101);
      if (row > 1 && rand < config.gapChance) continue;
      const babyCandidate = row > 2 && babiesPlaced < config.target &&
        ((row * state.cols + col + level * 3) % Math.max(8, Math.floor(state.cols * config.rows / config.target)) === 3);
      const stone = level >= 4 && !babyCandidate && row > 1 &&
        seededRandom(row * 83 + col * 47 + level) < config.stoneChance;
      state.grid.push({
        row, col,
        color: Math.floor(seededRandom(row * 13 + col * 29 + level * 7) * config.colors),
        stone,
        baby: babyCandidate,
        pulse: Math.random() * TAU
      });
      if (babyCandidate) babiesPlaced++;
    }
  }

  while (babiesPlaced < config.target) {
    const candidates = state.grid.filter(b => !b.stone && !b.baby && b.row > 2);
    const chosen = candidates[Math.floor(seededRandom(babiesPlaced * 777 + level) * candidates.length)];
    if (!chosen) break;
    chosen.baby = true;
    babiesPlaced++;
  }

  protectPandas(config);
  state.shooter.color = randomColor();
  state.shooter.next = randomColor();
  updateUI();
  saveGame();
}

function protectPandas(config) {
  const pandas = state.grid.filter(b => b.baby);
  for (const panda of pandas) {
    let protectedCount = 0;
    for (const [row, col] of neighbors(panda.row, panda.col)) {
      if (protectedCount >= config.protection) break;
      const neighbor = getCell(row, col);
      if (!neighbor || neighbor.baby || row < 1) continue;
      if (seededRandom(row * 137 + col * 61 + panda.row * 19) < .62 + config.adaptive * .02) {
        neighbor.stone = true;
        protectedCount++;
      }
    }
  }
}

function updateUI() {
  UI.levelLabel.textContent = state.level;
  UI.scoreLabel.textContent = state.score.toLocaleString("vi-VN");
  UI.rescuedLabel.textContent = state.rescued;
  UI.targetLabel.textContent = state.target;
  UI.shotsLabel.textContent = state.shots;
  UI.pausedLevel.textContent = state.level;
  UI.pausedScore.textContent = state.score.toLocaleString("vi-VN");
  updatePowerUI();
}

function updatePowerUI() {
  const power = POWER_UPS[state.currentPowerUp];
  UI.powerButton.classList.toggle("hidden", !power || state.powerUsed);
  UI.powerButton.classList.toggle("used", state.powerUsed);
  UI.powerButton.classList.toggle("armed", Boolean(state.powerArmed));
  if (!power) return;
  UI.powerIcon.textContent = power.icon;
  UI.powerName.textContent = power.name;
}

function saveGame() {
  if (!state.playing) return;
  const save = {
    version: 2,
    level: state.level, score: state.score, levelScore: state.levelScore,
    rescued: state.rescued, target: state.target, shots: state.shots, maxShots: state.maxShots,
    colors: state.colors, misses: state.misses, pressureEvery: state.pressureEvery, grid: state.grid, shooter: {
      color: state.shooter.color, next: state.shooter.next
    }, sound: state.sound, savedAt: Date.now(), skillRating: state.skillRating,
    lastPerformance: state.lastPerformance, difficulty: state.difficulty, metrics: state.metrics,
    currentPowerUp: state.currentPowerUp, lastSelectedPowerUp: state.lastSelectedPowerUp,
    powerUsed: state.powerUsed, powerArmed: state.powerArmed, frozen: state.frozen
  };
  storage.set(JSON.stringify(save));
}

function loadGame() {
  try {
    const save = JSON.parse(storage.get());
    if (!save?.grid?.length || !Number.isFinite(save.level)) return false;
    Object.assign(state, {
      level: save.level, score: save.score || 0, levelScore: save.levelScore || 0,
      rescued: save.rescued || 0, target: save.target || 1, shots: save.shots,
      maxShots: save.maxShots, colors: save.colors, grid: save.grid, sound: save.sound !== false
    });
    state.misses = save.misses || 0;
    state.pressureEvery = save.pressureEvery || levelConfig(save.level).pressureEvery;
    state.skillRating = Number.isFinite(save.skillRating) ? save.skillRating : 35;
    state.lastPerformance = Number.isFinite(save.lastPerformance) ? save.lastPerformance : state.skillRating;
    state.difficulty = save.difficulty || 0;
    state.metrics = { ...freshMetrics(), ...save.metrics };
    state.currentPowerUp = save.currentPowerUp || null;
    state.lastSelectedPowerUp = save.lastSelectedPowerUp || null;
    state.powerUsed = Boolean(save.powerUsed);
    state.powerArmed = save.powerArmed || null;
    state.frozen = Boolean(save.frozen);
    state.shooter.color = save.shooter.color;
    state.shooter.next = save.shooter.next;
    state.savedSnapshot = structuredClone(save);
    updateUI();
    return true;
  } catch {
    storage.remove();
    return false;
  }
}

function restoreSnapshot() {
  const save = state.savedSnapshot;
  if (!save) return createLevel(state.level, true);
  Object.assign(state, structuredClone(save));
  state.shooter = { ...state.shooter, x: state.width / 2, y: state.height - Math.max(83, state.height * .092), angle: -Math.PI / 2 };
  state.projectile = null;
  state.particles = [];
  state.falling = [];
  state.floaters = [];
  state.resolving = false;
  state.playing = true;
  state.metrics = { ...freshMetrics(), ...state.metrics };
  updateUI();
}

function snapshotState() {
  return structuredClone({
    level: state.level, score: state.score, levelScore: state.levelScore, rescued: state.rescued,
    target: state.target, shots: state.shots, maxShots: state.maxShots, colors: state.colors,
    misses: state.misses, pressureEvery: state.pressureEvery, difficulty: state.difficulty,
    grid: state.grid, shooter: { color: state.shooter.color, next: state.shooter.next },
    sound: state.sound, skillRating: state.skillRating, lastPerformance: state.lastPerformance,
    metrics: state.metrics, currentPowerUp: state.currentPowerUp,
    lastSelectedPowerUp: state.lastSelectedPowerUp, powerUsed: state.powerUsed,
    powerArmed: state.powerArmed, frozen: state.frozen
  });
}

function playSound(type) {
  if (!state.sound) return;
  audioContext ||= new AudioContext();
  if (audioContext.state === "suspended") audioContext.resume();
  const now = audioContext.currentTime;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.connect(gain).connect(audioContext.destination);
  const presets = {
    shoot: [420, 260, .08, "sine"], pop: [650, 980, .13, "sine"],
    drop: [310, 170, .25, "triangle"], win: [520, 1050, .42, "sine"],
    lose: [260, 120, .45, "triangle"], swap: [360, 520, .08, "sine"]
  };
  const [start, end, duration, wave] = presets[type] || presets.pop;
  osc.type = wave;
  osc.frequency.setValueAtTime(start, now);
  osc.frequency.exponentialRampToValueAtTime(end, now + duration);
  gain.gain.setValueAtTime(.12, now);
  gain.gain.exponentialRampToValueAtTime(.001, now + duration);
  osc.start(now);
  osc.stop(now + duration);
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  const p = event.touches?.[0] || event;
  return { x: p.clientX - rect.left, y: p.clientY - rect.top };
}

function setAim(point) {
  const dx = point.x - state.shooter.x;
  const dy = point.y - state.shooter.y;
  state.shooter.angle = Math.max(-Math.PI + .17, Math.min(-.17, Math.atan2(dy, dx)));
  state.pointer = point;
}

function shoot() {
  if (!state.playing || state.paused || state.projectile || state.resolving) return;
  const angle = state.shooter.angle;
  if (Math.sin(angle) > -.12) return;
  const speed = Math.max(650, state.height * .78);
  state.projectile = {
    x: state.shooter.x, y: state.shooter.y - 34, color: state.shooter.color,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, trail: [],
    power: state.powerArmed, pierceLeft: state.powerArmed === "pierce" ? 2 : 0
  };
  state.metrics.shotsFired++;
  state.powerArmed = null;
  state.shooter.color = state.shooter.next;
  state.shooter.next = randomColor();
  updatePowerUI();
  playSound("shoot");
}

function usePowerUp() {
  const type = state.currentPowerUp;
  if (!type || state.powerUsed || !state.playing || state.paused || state.projectile || state.resolving) return;
  state.powerUsed = true;
  if (type === "extra") {
    state.shots += 3;
    state.maxShots += 3;
    showToast("+3 lượt bắn");
  } else if (type === "freeze") {
    state.frozen = true;
    showToast("Đã đóng băng hạ trần");
  } else if (type === "color") {
    const counts = new Map();
    state.grid.filter(b => !b.stone).forEach(b => counts.set(b.color, (counts.get(b.color) || 0) + 1));
    state.shooter.color = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? state.shooter.color;
    showToast("Đã chọn màu tốt nhất");
  } else if (type === "assist") {
    const target = findAssistTarget();
    if (target) {
      const p = cellPosition(target.row, target.col);
      setAim({ x: p.x, y: p.y });
      showToast("Panda đang ngắm...");
      setTimeout(shoot, 260);
    } else {
      state.powerUsed = false;
    }
  } else {
    state.powerArmed = type;
    showToast(`${POWER_UPS[type].name} đã sẵn sàng`);
  }
  updateUI();
  saveGame();
}

function findAssistTarget() {
  let best = null;
  for (const bubble of state.grid) {
    if (bubble.stone) continue;
    const sameNeighbors = neighbors(bubble.row, bubble.col)
      .map(([r, c]) => getCell(r, c))
      .filter(b => b && !b.stone && b.color === bubble.color).length;
    const pandaBonus = bubble.baby ? 3 : neighbors(bubble.row, bubble.col)
      .some(([r, c]) => getCell(r, c)?.baby) ? 2 : 0;
    const score = sameNeighbors * 4 + pandaBonus - bubble.row * .04;
    if (!best || score > best.score) best = { ...bubble, score };
  }
  if (best) state.shooter.color = best.color;
  return best;
}

function nearestEmptyCell(x, y) {
  let row = Math.max(0, Math.round((y - 111) / state.rowH));
  let best = null;
  for (let r = Math.max(0, row - 2); r <= row + 2; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (getCell(r, c)) continue;
      const pos = cellPosition(r, c);
      if (pos.x > state.width - state.radius) continue;
      const d = Math.hypot(x - pos.x, y - pos.y);
      if (!best || d < best.d) best = { row: r, col: c, d };
    }
  }
  return best;
}

function attachProjectile(impact = null) {
  const p = state.projectile;
  const cell = nearestEmptyCell(p.x, p.y);
  if (!cell) {
    state.projectile = null;
    return;
  }
  const color = p.power === "rainbow" && impact && !impact.stone ? impact.color : p.color;
  const bubble = { row: cell.row, col: cell.col, color, stone: false, baby: false, pulse: 0 };
  const power = p.power;
  state.grid.push(bubble);
  state.projectile = null;
  resolveShot(bubble, impact, power);
}

function collectCluster(start, sameColor = true) {
  const found = [];
  const visited = new Set();
  const queue = [start];
  while (queue.length) {
    const bubble = queue.shift();
    const id = key(bubble.row, bubble.col);
    if (visited.has(id)) continue;
    visited.add(id);
    found.push(bubble);
    for (const [row, col] of neighbors(bubble.row, bubble.col)) {
      const next = getCell(row, col);
      if (!next || next.stone || visited.has(key(row, col))) continue;
      if (!sameColor || next.color === start.color) queue.push(next);
    }
  }
  return found;
}

function findDisconnected() {
  const connected = new Set();
  const queue = state.grid.filter(b => b.row === 0);
  while (queue.length) {
    const b = queue.shift();
    const id = key(b.row, b.col);
    if (connected.has(id)) continue;
    connected.add(id);
    for (const [r, c] of neighbors(b.row, b.col)) {
      const next = getCell(r, c);
      if (next && !connected.has(key(r, c))) queue.push(next);
    }
  }
  return state.grid.filter(b => !connected.has(key(b.row, b.col)));
}

function spawnBurst(bubble, color, amount = 11) {
  const p = cellPosition(bubble.row, bubble.col);
  for (let i = 0; i < amount; i++) {
    const a = Math.random() * TAU;
    const speed = 45 + Math.random() * 150;
    state.particles.push({
      x: p.x, y: p.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 30,
      life: .55 + Math.random() * .35, maxLife: .9, size: 2 + Math.random() * 5, color
    });
  }
}

function addFloater(x, y, text, color = "#fff4a8") {
  state.floaters.push({ x, y, text, color, life: 1, maxLife: 1 });
}

function removeBubbles(bubbles, dropped = false) {
  const ids = new Set(bubbles.map(b => key(b.row, b.col)));
  state.grid = state.grid.filter(b => !ids.has(key(b.row, b.col)));
  bubbles.forEach((b, i) => {
    const pos = cellPosition(b.row, b.col);
    if (b.baby) {
      state.rescued++;
      state.metrics.rescuedPandas++;
      addFloater(pos.x, pos.y, "ĐÃ CỨU!", "#fff3a1");
    }
    if (dropped) {
      state.falling.push({ ...b, x: pos.x, y: pos.y, vy: -40 - Math.random() * 80, vx: (Math.random() - .5) * 90, rot: 0 });
    } else {
      setTimeout(() => spawnBurst(b, COLORS[b.color].main), i * 18);
    }
  });
}

function resolveShot(placed, impact = null, power = null) {
  state.resolving = true;
  let effectRemoved = [];
  if (power === "bomb") {
    const center = cellPosition(placed.row, placed.col);
    effectRemoved = state.grid.filter(b => {
      const p = cellPosition(b.row, b.col);
      return Math.hypot(center.x - p.x, center.y - p.y) <= state.radius * 4.25;
    });
  } else if (power === "breaker") {
    effectRemoved = state.grid.filter(b => b.stone &&
      Math.abs(b.row - placed.row) <= 2 && Math.abs(b.col - placed.col) <= 2);
  } else if (power === "storm" && impact && !impact.stone) {
    effectRemoved = state.grid.filter(b => !b.stone && b.color === impact.color);
  }

  if (effectRemoved.length) {
    removeBubbles(effectRemoved);
    const bonus = effectRemoved.length * 140;
    state.score += bonus;
    state.levelScore += bonus;
    state.metrics.successfulShots++;
    state.metrics.directHits += effectRemoved.length;
    addFloater(cellPosition(placed.row, placed.col).x, cellPosition(placed.row, placed.col).y, `+${bonus}`);
    playSound("pop");
  }

  if (!state.grid.includes(placed)) {
    setTimeout(resolveDisconnectedAndFinish, 180);
    return;
  }
  const cluster = collectCluster(placed);
  if (cluster.length >= 3) {
    state.combo++;
    if (!effectRemoved.length) state.metrics.successfulShots++;
    state.metrics.directHits += cluster.length;
    state.metrics.largestCombo = Math.max(state.metrics.largestCombo, state.combo);
    removeBubbles(cluster);
    const points = cluster.length * 100 * Math.max(1, state.combo);
    state.score += points;
    state.levelScore += points;
    const p = cellPosition(placed.row, placed.col);
    addFloater(p.x, p.y, `+${points}`);
    playSound("pop");
    if (state.combo > 1) showCombo(`COMBO x${state.combo}`);
    setTimeout(resolveDisconnectedAndFinish, 190);
  } else {
    state.combo = 0;
    state.shots--;
    state.misses++;
    state.metrics.misses++;
    if (!state.frozen && state.misses % state.pressureEvery === 0) {
      state.grid.forEach(b => b.row++);
      showToast("Cụm bóng đang hạ xuống!");
      state.screenShake = 8;
    }
    finishResolution();
  }
}

function resolveDisconnectedAndFinish() {
  const loose = findDisconnected();
  if (loose.length) {
    removeBubbles(loose, true);
    const bonus = loose.length * 160;
    state.score += bonus;
    state.levelScore += bonus;
    state.metrics.directHits += loose.length;
    playSound("drop");
  }
  finishResolution();
}

function finishResolution() {
  state.resolving = false;
  updateUI();
  if (state.rescued >= state.target || !state.grid.some(b => b.baby)) {
    setTimeout(() => finishLevel(true), 600);
    return;
  }
  if (state.shots <= 0) {
    setTimeout(() => finishLevel(false), 500);
    return;
  }
  const maxY = Math.max(...state.grid.map(b => cellPosition(b.row, b.col).y), 0);
  if (maxY > state.shooter.y - 105) {
    setTimeout(() => finishLevel(false), 300);
    return;
  }
  saveGame();
}

function calculatePerformance() {
  const m = state.metrics;
  const shots = Math.max(1, m.shotsFired);
  const expectedTime = 18 + state.target * 13 + state.difficulty * 2;
  const expectedShots = state.target * 1.8 + 5;
  const accuracy = Math.min(1, m.successfulShots / shots);
  const speed = Math.min(1, expectedTime / Math.max(8, m.activeTime));
  const economy = Math.min(1, expectedShots / shots);
  const combo = Math.min(1, m.largestCombo / 4);
  return Math.round((accuracy * .4 + speed * .25 + economy * .25 + combo * .1) * 100);
}

function finishLevel(won) {
  state.playing = false;
  state.projectile = null;
  if (won) {
    state.lastPerformance = calculatePerformance();
    state.skillRating = Math.round((state.skillRating * .7 + state.lastPerformance * .3) * 10) / 10;
    const ratio = state.shots / state.maxShots;
    const stars = ratio > .62 ? 3 : ratio > .28 ? 2 : 1;
    const bonus = state.shots * 250;
    state.score += bonus;
    UI.powerSummary.textContent = `${"★".repeat(stars)}${"☆".repeat(3 - stars)} · Hiệu suất ${state.lastPerformance}% · +${bonus.toLocaleString("vi-VN")} điểm`;
    playSound("win");
    state.pendingNextLevel = state.level + 1;
    storage.set(JSON.stringify({
      version: 2, awaitingPower: true, nextLevel: state.pendingNextLevel, score: state.score,
      skillRating: state.skillRating, lastPerformance: state.lastPerformance,
      lastSelectedPowerUp: state.lastSelectedPowerUp, sound: state.sound
    }));
    updateUI();
    showPowerSelection();
    return;
  } else {
    UI.resultOverlay.classList.remove("hidden");
    requestAnimationFrame(() => UI.resultOverlay.classList.add("visible"));
    UI.resultTitle.textContent = "Chưa thành công";
    UI.resultText.textContent = "Sắp được rồi! Thử lại với một góc bắn khác nhé.";
    UI.resultStars.textContent = "☆ ☆ ☆";
    UI.nextButton.textContent = "THỬ LẠI";
    UI.nextButton.dataset.action = "retry";
    playSound("lose");
  }
  updateUI();
}

function makePowerChoices() {
  const ids = Object.keys(POWER_UPS);
  const choices = [];
  if (state.lastSelectedPowerUp && POWER_UPS[state.lastSelectedPowerUp]) {
    choices.push(state.lastSelectedPowerUp);
  }
  while (choices.length < 3) {
    const id = ids[Math.floor(Math.random() * ids.length)];
    if (!choices.includes(id)) choices.push(id);
  }
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return choices;
}

function showPowerSelection() {
  state.powerChoices = makePowerChoices();
  UI.powerChoices.replaceChildren();
  for (const id of state.powerChoices) {
    const power = POWER_UPS[id];
    const button = document.createElement("button");
    button.className = "power-card";
    button.dataset.power = id;
    button.innerHTML = `
      ${id === state.lastSelectedPowerUp ? '<span class="previous-badge">LỰA CHỌN TRƯỚC</span>' : ""}
      <span class="card-icon">${power.icon}</span>
      <strong>${power.name}</strong>
      <p>${power.description}</p>
    `;
    button.addEventListener("click", () => selectPowerUp(id));
    UI.powerChoices.append(button);
  }
  if (UI.resultOverlay.classList.contains("visible")) {
    UI.resultOverlay.classList.remove("visible");
    setTimeout(() => UI.resultOverlay.classList.add("hidden"), 220);
  }
  UI.powerOverlay.classList.remove("hidden");
  requestAnimationFrame(() => UI.powerOverlay.classList.add("visible"));
}

function selectPowerUp(id) {
  if (!POWER_UPS[id]) return;
  state.currentPowerUp = id;
  state.lastSelectedPowerUp = id;
  state.powerUsed = false;
  state.powerArmed = null;
  const nextLevel = state.pendingNextLevel || state.level + 1;
  UI.powerOverlay.classList.remove("visible");
  setTimeout(() => UI.powerOverlay.classList.add("hidden"), 220);
  createLevel(nextLevel, true);
  state.playing = true;
  state.pendingNextLevel = null;
  state.savedSnapshot = snapshotState();
  saveGame();
  showToast(`Đã nhận ${POWER_UPS[id].name}`);
}

function startSavedOrNew() {
  const raw = storage.get();
  let next = null;
  try { next = JSON.parse(raw); } catch {}
  if (next?.awaitingPower && next?.nextLevel) {
    state.score = next.score || 0;
    state.skillRating = next.skillRating || 35;
    state.lastPerformance = next.lastPerformance || state.skillRating;
    state.lastSelectedPowerUp = next.lastSelectedPowerUp || null;
    state.pendingNextLevel = next.nextLevel;
    state.playing = false;
    UI.startOverlay.classList.remove("visible");
    setTimeout(() => UI.startOverlay.classList.add("hidden"), 250);
    showPowerSelection();
    return;
  } else if (next?.nextLevel) {
    state.score = next.score || 0;
    createLevel(next.nextLevel, true);
  } else if (!state.grid.length) {
    createLevel(1, false);
  }
  state.savedSnapshot = snapshotState();
  state.playing = true;
  UI.startOverlay.classList.remove("visible");
  setTimeout(() => UI.startOverlay.classList.add("hidden"), 250);
  saveGame();
}

function togglePause(force) {
  if (!state.playing) return;
  state.paused = force ?? !state.paused;
  UI.pauseOverlay.classList.toggle("hidden", !state.paused);
  requestAnimationFrame(() => UI.pauseOverlay.classList.toggle("visible", state.paused));
  if (state.paused) saveGame();
}

function showToast(text) {
  UI.toast.textContent = text;
  UI.toast.classList.remove("show");
  void UI.toast.offsetWidth;
  UI.toast.classList.add("show");
}

function showCombo(text) {
  UI.combo.textContent = text;
  UI.combo.classList.remove("show");
  void UI.combo.offsetWidth;
  UI.combo.classList.add("show");
}

function update(dt) {
  state.elapsed += dt;
  if (state.paused) return;
  if (state.playing && !state.resolving) state.metrics.activeTime += dt;
  if (state.screenShake > 0) state.screenShake = Math.max(0, state.screenShake - dt * 18);

  const p = state.projectile;
  if (p) {
    p.trail.unshift({ x: p.x, y: p.y, life: .25 });
    p.trail = p.trail.filter(t => (t.life -= dt) > 0).slice(0, 8);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.x < state.radius) { p.x = state.radius; p.vx = Math.abs(p.vx); state.screenShake = 2; }
    if (p.x > state.width - state.radius) { p.x = state.width - state.radius; p.vx = -Math.abs(p.vx); state.screenShake = 2; }
    if (p.y <= 105 + state.radius) attachProjectile();
    else {
      for (const b of [...state.grid]) {
        const pos = cellPosition(b.row, b.col);
        if (Math.hypot(p.x - pos.x, p.y - pos.y) < state.radius * 1.84) {
          if (p.power === "pierce" && p.pierceLeft > 0 && !b.stone) {
            removeBubbles([b]);
            p.pierceLeft--;
            state.metrics.directHits++;
            if (!p.countedSuccess) {
              state.metrics.successfulShots++;
              p.countedSuccess = true;
            }
            p.y += p.vy * .018;
            continue;
          }
          attachProjectile(b);
          break;
        }
      }
    }
  }

  state.particles.forEach(particle => {
    particle.life -= dt;
    particle.vy += 280 * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
  });
  state.particles = state.particles.filter(particle => particle.life > 0);
  state.floaters.forEach(f => { f.life -= dt; f.y -= 45 * dt; });
  state.floaters = state.floaters.filter(f => f.life > 0);
  state.falling.forEach(f => {
    f.vy += 620 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += dt * 4;
  });
  state.falling = state.falling.filter(f => f.y < state.height + 80);
}

function drawBubble(x, y, radius, colorIndex, options = {}) {
  const palette = COLORS[colorIndex] || COLORS[0];
  ctx.save();
  ctx.translate(x, y);
  if (options.rotation) ctx.rotate(options.rotation);
  const squash = options.squash || 1;
  ctx.scale(1, squash);
  ctx.shadowColor = "rgba(12,55,50,.34)";
  ctx.shadowBlur = options.shadow === false ? 0 : radius * .35;
  ctx.shadowOffsetY = radius * .18;
  const grad = ctx.createRadialGradient(-radius * .35, -radius * .45, radius * .06, 0, 0, radius);
  grad.addColorStop(0, palette.light);
  grad.addColorStop(.25, palette.main);
  grad.addColorStop(.83, palette.main);
  grad.addColorStop(1, palette.dark);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(255,255,255,.28)";
  ctx.lineWidth = Math.max(1, radius * .07);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,.72)";
  ctx.beginPath();
  ctx.ellipse(-radius * .36, -radius * .44, radius * .18, radius * .29, -.65, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawStone(x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = "rgba(0,0,0,.35)";
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 4;
  const grad = ctx.createRadialGradient(-7, -9, 1, 0, 0, r);
  grad.addColorStop(0, "#d4d0be");
  grad.addColorStop(.45, "#8d9386");
  grad.addColorStop(1, "#505d56");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "#e3dfc9";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-10, -10); ctx.lineTo(-3, -4); ctx.lineTo(-9, 4);
  ctx.moveTo(8, -12); ctx.lineTo(4, -4); ctx.lineTo(11, 2);
  ctx.stroke();
  ctx.restore();
}

function drawBaby(x, y, r, t = 0) {
  ctx.save();
  ctx.translate(x, y + Math.sin(t * 3) * 1.5);
  ctx.fillStyle = "#263d3a";
  ctx.beginPath(); ctx.arc(-r * .66, -r * .65, r * .38, 0, TAU); ctx.arc(r * .66, -r * .65, r * .38, 0, TAU); ctx.fill();
  ctx.fillStyle = "#fff8df";
  ctx.beginPath(); ctx.arc(0, 0, r * .9, 0, TAU); ctx.fill();
  ctx.fillStyle = "#263d3a";
  ctx.save(); ctx.rotate(.25);
  ctx.beginPath(); ctx.ellipse(-r * .34, -r * .12, r * .24, r * .34, 0, 0, TAU); ctx.fill();
  ctx.restore();
  ctx.save(); ctx.rotate(-.25);
  ctx.beginPath(); ctx.ellipse(r * .34, -r * .12, r * .24, r * .34, 0, 0, TAU); ctx.fill();
  ctx.restore();
  ctx.fillStyle = "white";
  ctx.beginPath(); ctx.arc(-r * .29, -r * .18, r * .075, 0, TAU); ctx.arc(r * .29, -r * .18, r * .075, 0, TAU); ctx.fill();
  ctx.fillStyle = "#263d3a";
  ctx.beginPath(); ctx.ellipse(0, r * .19, r * .13, r * .1, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawShooter() {
  const { x, y, angle, color, next } = state.shooter;
  ctx.save();
  ctx.translate(x, y + 30);
  ctx.fillStyle = "rgba(23,69,56,.28)";
  ctx.beginPath(); ctx.ellipse(0, 23, 75, 18, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "#263d3a";
  ctx.beginPath(); ctx.arc(-35, -4, 26, 0, TAU); ctx.arc(35, -4, 26, 0, TAU); ctx.fill();
  ctx.fillStyle = "#fff7dd";
  ctx.beginPath(); ctx.ellipse(0, 7, 56, 48, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "#263d3a";
  ctx.beginPath(); ctx.ellipse(-22, 3, 15, 21, -.45, 0, TAU); ctx.ellipse(22, 3, 15, 21, .45, 0, TAU); ctx.fill();
  ctx.fillStyle = "white";
  ctx.beginPath(); ctx.arc(-18, 1, 5, 0, TAU); ctx.arc(18, 1, 5, 0, TAU); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(x, y - 4);
  ctx.rotate(angle + Math.PI / 2);
  ctx.fillStyle = "#98713c";
  ctx.beginPath();
  ctx.roundRect(-18, -8, 36, 56, 15);
  ctx.fill();
  ctx.fillStyle = "#d9b86d";
  ctx.beginPath(); ctx.roundRect(-12, -8, 24, 48, 10); ctx.fill();
  ctx.restore();
  if (!state.projectile) drawBubble(x + Math.cos(angle) * 32, y - 4 + Math.sin(angle) * 32, state.radius * .94, color);
  drawBubble(x + 64, y + 31, state.radius * .56, next, { shadow: false });
  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.font = `700 ${Math.max(9, state.radius * .45)}px "Baloo 2"`;
  ctx.textAlign = "center";
  ctx.fillText("SAU", x + 64, y + 66);
}

function drawAimGuide() {
  if (!state.aiming || state.projectile || state.paused) return;
  const { x, y, angle } = state.shooter;
  let px = x + Math.cos(angle) * 46;
  let py = y - 4 + Math.sin(angle) * 46;
  let vx = Math.cos(angle) * 17;
  let vy = Math.sin(angle) * 17;
  ctx.save();
  const guideSteps = state.powerArmed === "guide" ? 70 : 28;
  for (let i = 0; i < guideSteps; i++) {
    px += vx; py += vy;
    if (px < state.radius || px > state.width - state.radius) vx *= -1;
    if (py < 105) break;
    const hit = state.grid.some(b => {
      const pos = cellPosition(b.row, b.col);
      return Math.hypot(px - pos.x, py - pos.y) < state.radius * 1.7;
    });
    if (hit) break;
    if (i % 2 === 0) {
      ctx.globalAlpha = Math.max(.12, .7 - i * .018);
      ctx.fillStyle = "white";
      ctx.beginPath(); ctx.arc(px, py, Math.max(2, state.radius * .11), 0, TAU); ctx.fill();
    }
  }
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, state.width, state.height);
  ctx.save();
  if (state.screenShake) ctx.translate((Math.random() - .5) * state.screenShake, (Math.random() - .5) * state.screenShake);

  const ceiling = ctx.createLinearGradient(0, 96, 0, 128);
  ceiling.addColorStop(0, "rgba(26,82,71,.86)");
  ceiling.addColorStop(1, "rgba(42,112,92,.22)");
  ctx.fillStyle = ceiling;
  ctx.fillRect(0, 96, state.width, 34);

  for (const b of state.grid) {
    const p = cellPosition(b.row, b.col);
    if (b.stone) drawStone(p.x, p.y, state.radius);
    else drawBubble(p.x, p.y, state.radius, b.color);
    if (b.baby) {
      ctx.fillStyle = "rgba(255,244,179,.38)";
      ctx.beginPath(); ctx.arc(p.x, p.y, state.radius * .75, 0, TAU); ctx.fill();
      drawBaby(p.x, p.y, state.radius * .55, state.elapsed + b.pulse);
    }
  }

  for (const f of state.falling) {
    if (f.stone) drawStone(f.x, f.y, state.radius);
    else drawBubble(f.x, f.y, state.radius, f.color, { rotation: f.rot });
    if (f.baby) drawBaby(f.x, f.y, state.radius * .55, state.elapsed);
  }

  drawAimGuide();
  if (state.projectile) {
    state.projectile.trail.forEach((t, i) => {
      ctx.globalAlpha = t.life * 1.8;
      drawBubble(t.x, t.y, state.radius * Math.max(.2, .55 - i * .04), state.projectile.color, { shadow: false });
    });
    ctx.globalAlpha = 1;
    drawBubble(state.projectile.x, state.projectile.y, state.radius, state.projectile.color);
  }
  drawShooter();

  state.particles.forEach(p => {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
  });
  ctx.globalAlpha = 1;
  state.floaters.forEach(f => {
    ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
    ctx.fillStyle = f.color;
    ctx.strokeStyle = "rgba(38,84,64,.7)";
    ctx.lineWidth = 4;
    ctx.font = `800 ${Math.max(18, state.radius)}px "Baloo 2"`;
    ctx.textAlign = "center";
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillText(f.text, f.x, f.y);
  });
  ctx.restore();
  ctx.globalAlpha = 1;
}

function frame(time) {
  const dt = Math.min((time - state.lastTime) / 1000 || 0, .025);
  state.lastTime = time;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

canvas.addEventListener("pointerdown", event => {
  if (!state.playing || state.paused) return;
  state.aiming = true;
  setAim(pointerPosition(event));
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", event => {
  if (state.aiming) setAim(pointerPosition(event));
});
canvas.addEventListener("pointerup", event => {
  if (!state.aiming) return;
  setAim(pointerPosition(event));
  state.aiming = false;
  shoot();
});
canvas.addEventListener("pointercancel", () => { state.aiming = false; });

canvas.addEventListener("dblclick", event => {
  event.preventDefault();
  if (!state.projectile && state.playing) {
    [state.shooter.color, state.shooter.next] = [state.shooter.next, state.shooter.color];
    playSound("swap");
    showToast("Đã đổi bóng");
  }
});

UI.playButton.addEventListener("click", startSavedOrNew);
UI.newGameButton.addEventListener("click", () => {
  storage.remove();
  state.grid = [];
  state.score = 0;
  startSavedOrNew();
});
UI.pauseButton.addEventListener("click", () => togglePause(true));
UI.resumeButton.addEventListener("click", () => togglePause(false));
UI.restartButton.addEventListener("click", () => {
  restoreSnapshot();
  togglePause(false);
  showToast("Màn đã khởi động lại");
});
UI.soundButton.addEventListener("click", () => {
  state.sound = !state.sound;
  UI.soundButton.textContent = `Âm thanh: ${state.sound ? "Bật" : "Tắt"}`;
  saveGame();
});
UI.powerButton.addEventListener("click", usePowerUp);
UI.nextButton.addEventListener("click", () => {
  UI.resultOverlay.classList.remove("visible");
  setTimeout(() => UI.resultOverlay.classList.add("hidden"), 240);
  restoreSnapshot();
  state.playing = true;
  saveGame();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.playing && !state.paused) togglePause(true);
});
window.addEventListener("resize", resize);

window.BambooPop = {
  powerUpIds: Object.keys(POWER_UPS),
  getState: () => structuredClone({
    level: state.level, target: state.target, shots: state.shots, maxShots: state.maxShots,
    skillRating: state.skillRating, difficulty: state.difficulty, pressureEvery: state.pressureEvery,
    currentPowerUp: state.currentPowerUp, lastSelectedPowerUp: state.lastSelectedPowerUp,
    powerUsed: state.powerUsed, powerArmed: state.powerArmed, frozen: state.frozen,
    metrics: state.metrics, stoneCount: state.grid.filter(b => b.stone).length
  })
};

resize();
const hasSave = loadGame();
if (hasSave) {
  UI.playButton.textContent = `TIẾP TỤC MÀN ${state.level}`;
  UI.newGameButton.classList.remove("hidden");
  UI.saveNote.textContent = "Đã tìm thấy tiến trình trước đó";
} else {
  const raw = storage.get();
  try {
    const save = JSON.parse(raw);
    if (save?.nextLevel) {
      UI.playButton.textContent = save.awaitingPower ? "CHỌN POWER-UP" : `CHƠI MÀN ${save.nextLevel}`;
      UI.newGameButton.classList.remove("hidden");
    }
  } catch {}
}
requestAnimationFrame(frame);
