// server.js
const WebSocket = require('ws');
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: port });
console.log(`Maze Race WebSocket server started on ws://localhost:${port}`);

const users = {}; // username: { x, y, color, ws, ip, sprite }
const DOT_SIZE = 48;
const OVERLAY_WIDTH = 1920;
const OVERLAY_HEIGHT = 1080;
const ipUserCounts = {}; // { ip: count }
const MAX_USERS_PER_IP = 2;

// List of sprite filenames
const SPRITES = [
  'sprites/sprite1.png',
  'sprites/sprite2.png',
  'sprites/sprite3.png',
  'sprites/sprite4.png',
  'sprites/sprite5.png',
  'sprites/sprite6.png',
  'sprites/sprite7.png',
  'sprites/sprite8.png',
  'sprites/sprite9.png',
  'sprites/sprite10.png',
  'sprites/sprite11.png',
  'sprites/sprite12.png',
  'sprites/sprite13.png',
  'sprites/sprite14.png',
  'sprites/sprite15.png',
  'sprites/sprite16.png',
  'sprites/sprite17.gif'
];

const assignedSprites = {}; // username -> sprite
let availableSprites = [...SPRITES];

function getIP(ws) {
  return ws._socket.remoteAddress;
}

// Maze generation (simple DFS)
function generateMaze(width, height) {
  const maze = Array.from({ length: height }, () => Array(width).fill(1)); // 1=wall, 0=path
  function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } }
  function carve(x, y) {
    maze[y][x] = 0;
    const dirs = [ [0,1], [1,0], [0,-1], [-1,0] ];
    shuffle(dirs);
    for (const [dx, dy] of dirs) {
      const nx = x + dx*2, ny = y + dy*2;
      if (ny >= 0 && ny < height && nx >= 0 && nx < width && maze[ny][nx] === 1) {
        maze[y+dy][x+dx] = 0;
        carve(nx, ny);
      }
    }
  }
  carve(1,1);
  maze[1][1] = 0; // Start
  maze[height-2][width-2] = 0; // End
  return maze;
}

let maze = generateMaze(21, 15); // Odd sizes for proper walls
const MAZE_CELL_SIZE = 30;

// Collision point offset (relative to sprite center)
const collisionOffsetX = 5; // Try changing these values to move the collision point
const collisionOffsetY = 5;

function broadcastMaze() {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'maze', maze, cellSize: MAZE_CELL_SIZE }));
    }
  });
}

function broadcastState() {
  const state = Object.entries(users).map(([username, u]) => {
    // Calculate collision point for this user
    const spriteSize = MAZE_CELL_SIZE * 0.05; // 5% of cell size
    const collisionX = u.x + (u.collisionOffsetX || 0);
    const collisionY = u.y + (u.collisionOffsetY || 0);
    return {
      username,
      x: u.x,
      y: u.y,
      color: u.color,
      sprite: u.sprite,
      collisionX,
      collisionY,
      glow: u.glow
    };
  });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'state', users: state }));
    }
  });
}

// Broadcast state and maze every 30ms (about 33fps)
setInterval(() => {
  broadcastState();
  broadcastMaze();
}, 30);

wss.on('connection', ws => {
  let currentUser = null;
  ws.send(JSON.stringify({ type: 'maze', maze, cellSize: MAZE_CELL_SIZE })); // Send maze on connect

  ws.on('message', message => {
    let data;
    try { data = JSON.parse(message); } catch { return; }

    if (data.type === 'join') {
      const ip = getIP(ws);
      ipUserCounts[ip] = ipUserCounts[ip] || 0;

      if (ipUserCounts[ip] >= MAX_USERS_PER_IP) {
        ws.send(JSON.stringify({ type: 'error', message: `Only ${MAX_USERS_PER_IP} users allowed per IP.` }));
        return;
      }

      if (users[data.username]) {
        ws.send(JSON.stringify({ type: 'error', message: 'Username already taken.' }));
        return;
      }

      // Assign a unique sprite
      if (availableSprites.length === 0) {
        // Recycle: all sprites are used, reset the pool
        availableSprites = [...SPRITES];
      }
      const sprite = availableSprites.splice(Math.floor(Math.random() * availableSprites.length), 1)[0];
      assignedSprites[data.username] = sprite;

      users[data.username] = {
        x: MAZE_CELL_SIZE + 8, // Spawn at maze start
        y: MAZE_CELL_SIZE + 8,
        color: data.color,
        ws,
        ip,
        sprite: assignedSprites[data.username],
        glow: data.glow || data.color
      };
      ipUserCounts[ip]++;
      currentUser = data.username;
    }
    if (data.type === 'move' && currentUser && users[currentUser]) {
      const speed = 10 * (data.force || 1);
      let prevX = users[currentUser].x;
      let prevY = users[currentUser].y;
      let angleDeg = data.direction;
      let nextX = users[currentUser].x;
      let nextY = users[currentUser].y;
      if (typeof angleDeg === 'string') {
        if (angleDeg === 'up') nextY -= speed;
        else if (angleDeg === 'down') nextY += speed;
        else if (angleDeg === 'left') nextX -= speed;
        else if (angleDeg === 'right') nextX += speed;
      } else if (typeof angleDeg === 'number') {
        const angleRad = angleDeg * Math.PI / 180;
        nextX += Math.cos(angleRad) * speed;
        nextY -= Math.sin(angleRad) * speed;
      }
      const spriteSize = MAZE_CELL_SIZE * 0.05; // 5% of cell size
      // Center the bounding box on the sprite's center, then apply offset
      const centerX = nextX + collisionOffsetX;
      const centerY = nextY + collisionOffsetY;
      const minX = centerX - spriteSize / 2;
      const minY = centerY - spriteSize / 2;
      const maxX = centerX + spriteSize / 2;
      const maxY = centerY + spriteSize / 2;
      const corners = [
        [minX, minY],
        [maxX, minY],
        [minX, maxY],
        [maxX, maxY]
      ];
      let canMove = true;
      for (const [cx, cy] of corners) {
        const cellX = Math.floor(cx / MAZE_CELL_SIZE);
        const cellY = Math.floor(cy / MAZE_CELL_SIZE);
        if (!maze[cellY] || maze[cellY][cellX] !== 0) {
          canMove = false;
          break;
        }
      }
      if (canMove) {
        users[currentUser].x = nextX;
        users[currentUser].y = nextY;
      }
      // Win check (use collision point)
      const winCellX = Math.floor(centerX / MAZE_CELL_SIZE);
      const winCellY = Math.floor(centerY / MAZE_CELL_SIZE);
      if (winCellX === maze[0].length-2 && winCellY === maze.length-2) {
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'winner', username: currentUser }));
          }
        });
        maze = generateMaze(21, 15);
        broadcastMaze();
        Object.values(users).forEach(u => { u.x = MAZE_CELL_SIZE + 8; u.y = MAZE_CELL_SIZE + 8; });
      }
    }
  });

  ws.on('close', () => {
    if (currentUser && users[currentUser]) {
      const ip = users[currentUser].ip;
      // Release sprite
      if (assignedSprites[currentUser]) {
        availableSprites.push(assignedSprites[currentUser]);
        delete assignedSprites[currentUser];
      }
      delete users[currentUser];
      if (ip && ipUserCounts[ip]) {
        ipUserCounts[ip]--;
        if (ipUserCounts[ip] <= 0)
          delete ipUserCounts[ip];
      }
    }
  });
});
