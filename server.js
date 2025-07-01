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

// Generate random maze parameters
function getRandomMazeParams() {
  const difficulties = [
    { size: [9, 7], extraPaths: 0.01, deadEnds: 0.01, falsePaths: 0, name: "Tiny" },
    { size: [11, 9], extraPaths: 0.02, deadEnds: 0.01, falsePaths: 0, name: "Small" },
    { size: [13, 9], extraPaths: 0.03, deadEnds: 0.02, falsePaths: 0, name: "Medium" },
    { size: [17, 13], extraPaths: 0.04, deadEnds: 0.03, falsePaths: 0, name: "Large" }
  ];
  
  return difficulties[Math.floor(Math.random() * difficulties.length)];
}

// Enhanced maze generation with variable difficulty
function generateMaze(params = null) {
  if (!params) params = getRandomMazeParams();
  
  const [width, height] = params.size;
  const maze = Array.from({ length: height }, () => Array(width).fill(1)); // 1=wall, 0=path
  function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } }
  
  // Random corner positions
  const corners = [
    { start: [1, 1], end: [width-2, height-2] }, // top-left to bottom-right
    { start: [width-2, 1], end: [1, height-2] }, // top-right to bottom-left
    { start: [1, height-2], end: [width-2, 1] }, // bottom-left to top-right
    { start: [width-2, height-2], end: [1, 1] }  // bottom-right to top-left
  ];
  const selectedCorners = corners[Math.floor(Math.random() * corners.length)];
  const [startX, startY] = selectedCorners.start;
  const [endX, endY] = selectedCorners.end;
  
  // Initial DFS carving
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
  
  carve(startX, startY);
  maze[startY][startX] = 0; // Start
  maze[endY][endX] = 0; // End
  
  // Store start/end positions for later use
  params.startPos = [startX, startY];
  params.endPos = [endX, endY];
  
  // Add additional complexity based on difficulty
  const extraPaths = Math.floor((width * height) * params.extraPaths);
  for (let i = 0; i < extraPaths; i++) {
    const x = Math.floor(Math.random() * (width - 2)) + 1;
    const y = Math.floor(Math.random() * (height - 2)) + 1;
    
    if (maze[y][x] === 1) {
      let pathNeighbors = 0;
      const dirs = [[0,1], [1,0], [0,-1], [-1,0]];
      for (const [dx, dy] of dirs) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && maze[ny][nx] === 0) {
          pathNeighbors++;
        }
      }
      if (pathNeighbors >= 1 && pathNeighbors <= 3) {
        maze[y][x] = 0;
      }
    }
  }
  
  // Add dead ends based on difficulty
  const deadEnds = Math.floor((width * height) * params.deadEnds);
  for (let i = 0; i < deadEnds; i++) {
    const x = Math.floor(Math.random() * (width - 4)) + 2;
    const y = Math.floor(Math.random() * (height - 4)) + 2;
    
    if (maze[y][x] === 1) {
      const dirs = [[0,1], [1,0], [0,-1], [-1,0]];
      const connectDir = dirs[Math.floor(Math.random() * dirs.length)];
      const [dx, dy] = connectDir;
      
      if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height && maze[y + dy][x + dx] === 0) {
        maze[y][x] = 0;
        
        const length = Math.floor(Math.random() * 3) + 2;
        let currentX = x, currentY = y;
        
        for (let j = 1; j <= length; j++) {
          const possibleDirs = dirs.filter(([ndx, ndy]) => {
            const newX = currentX + ndx, newY = currentY + ndy;
            return newX > 0 && newX < width - 1 && newY > 0 && newY < height - 1 && maze[newY][newX] === 1;
          });
          
          if (possibleDirs.length > 0) {
            const [ndx, ndy] = possibleDirs[Math.floor(Math.random() * possibleDirs.length)];
            currentX += ndx;
            currentY += ndy;
            maze[currentY][currentX] = 0;
          } else {
            break;
          }
        }
      }
    }
  }
  
  // Add false paths based on difficulty
  const falsePaths = Math.floor((width * height) * params.falsePaths);
  for (let i = 0; i < falsePaths; i++) {
    const x = Math.floor(Math.random() * (width - 6)) + 3;
    const y = Math.floor(Math.random() * (height - 6)) + 3;
    
    if (maze[y][x] === 1) {
      const pathLength = Math.floor(Math.random() * 4) + 3;
      let currentX = x, currentY = y;
      maze[currentY][currentX] = 0;
      
      for (let j = 0; j < pathLength; j++) {
        const dirs = [[0,1], [1,0], [0,-1], [-1,0]];
        const validDirs = dirs.filter(([dx, dy]) => {
          const newX = currentX + dx, newY = currentY + dy;
          return newX > 1 && newX < width - 2 && newY > 1 && newY < height - 2;
        });
        
        if (validDirs.length > 0) {
          const [dx, dy] = validDirs[Math.floor(Math.random() * validDirs.length)];
          currentX += dx;
          currentY += dy;
          if (maze[currentY][currentX] === 1) {
            maze[currentY][currentX] = 0;
          }
        }
      }
    }
  }
  
  return { maze, params };
}

let mazeData = generateMaze(); // Generate random maze
let maze = mazeData.maze;
let currentDifficulty = mazeData.params;
const MAZE_CELL_SIZE = 30;

// Collision point offset (relative to sprite center)
const collisionOffsetX = 5; // Try changing these values to move the collision point
const collisionOffsetY = 5;

function broadcastMaze() {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ 
        type: 'maze', 
        maze, 
        cellSize: MAZE_CELL_SIZE,
        difficulty: currentDifficulty.name,
        size: `${currentDifficulty.size[0]}x${currentDifficulty.size[1]}`,
        startPos: currentDifficulty.startPos,
        endPos: currentDifficulty.endPos
      }));
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

      const [startX, startY] = currentDifficulty.startPos;
      users[data.username] = {
        x: startX * MAZE_CELL_SIZE + 8, // Spawn at dynamic maze start
        y: startY * MAZE_CELL_SIZE + 8,
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
      // Win check (use collision point and dynamic end position)
      const winCellX = Math.floor(centerX / MAZE_CELL_SIZE);
      const winCellY = Math.floor(centerY / MAZE_CELL_SIZE);
      const [endX, endY] = currentDifficulty.endPos;
      if (winCellX === endX && winCellY === endY) {
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ 
              type: 'winner', 
              username: currentUser,
              sprite: users[currentUser].sprite,
              difficulty: currentDifficulty.name,
              size: `${currentDifficulty.size[0]}x${currentDifficulty.size[1]}`
            }));
          }
        });
        // Generate new random maze with different difficulty
        mazeData = generateMaze();
        maze = mazeData.maze;
        currentDifficulty = mazeData.params;
        console.log(`New ${currentDifficulty.name} maze generated (${currentDifficulty.size[0]}x${currentDifficulty.size[1]})`);
        broadcastMaze();
        const [startX, startY] = currentDifficulty.startPos;
        Object.values(users).forEach(u => { 
          u.x = startX * MAZE_CELL_SIZE + 8; 
          u.y = startY * MAZE_CELL_SIZE + 8; 
        });
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
