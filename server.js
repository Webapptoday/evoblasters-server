const http = require("http");
const express = require("express");
const { Server, Room } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const { Schema, type, MapSchema } = require("@colyseus/schema");

class Player extends Schema {
  constructor() {
    super();
    this.x = 100;
    this.y = 100;
    this.hp = 100;
    this.alive = true;
    this.name = "Player";
  }
}
type("number")(Player.prototype, "x");
type("number")(Player.prototype, "y");
type("number")(Player.prototype, "hp");
type("boolean")(Player.prototype, "alive");
type("string")(Player.prototype, "name");

class Bullet extends Schema {
  constructor() {
    super();
    this.id = "";
    this.owner = "";
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.alive = true;
  }
}
type("string")(Bullet.prototype, "id");
type("string")(Bullet.prototype, "owner");
type("number")(Bullet.prototype, "x");
type("number")(Bullet.prototype, "y");
type("number")(Bullet.prototype, "vx");
type("number")(Bullet.prototype, "vy");
type("boolean")(Bullet.prototype, "alive");

class State extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
    this.bullets = new MapSchema();
  }
}
type({ map: Player })(State.prototype, "players");
type({ map: Bullet })(State.prototype, "bullets");

let waitingRoomId = null;

class BattleRoom extends Room {
  onCreate() {
    console.log("[BattleRoom] Created - roomId:", this.roomId);
    this.setState(new State());
    this.maxClients = 2;
    this.setPatchRate(50);

    this.onMessage("move", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive) return;
      if (typeof data?.x === "number") p.x = data.x;
      if (typeof data?.y === "number") p.y = data.y;
    });

    this.onMessage("shoot", (client, data) => {
      const shooter = this.state.players.get(client.sessionId);
      if (!shooter || !shooter.alive) return;

      const dirx = Number(data?.dirx);
      const diry = Number(data?.diry);

      if (!Number.isFinite(dirx) || !Number.isFinite(diry)) return;

      const len = Math.hypot(dirx, diry) || 1;
      const nx = dirx / len;
      const ny = diry / len;

      const speed = 900;
      const b = new Bullet();
      b.id = `${client.sessionId.slice(0, 8)}_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
      b.owner = client.sessionId;
      b.x = shooter.x;
      b.y = shooter.y;
      b.vx = nx * speed;
      b.vy = ny * speed;
      b.alive = true;

      this.state.bullets.set(b.id, b);
      console.log(`[SHOOT] ${client.sessionId.slice(0, 8)} fired bullet ${b.id.slice(0, 12)}`);
    });

    const dt = 1 / 60;
    this.setSimulationInterval(() => this.step(dt), 1000 / 60);
  }

  onJoin(client, options) {
    console.log(`[JOIN] ${client.sessionId.slice(0, 8)} joining...`);
    
    const p = new Player();
    p.x = 100 + Math.floor(Math.random() * 500);
    p.y = 100 + Math.floor(Math.random() * 300);
    p.hp = 100;
    p.alive = true;

    const clean = String(options?.name ?? "Player").trim().slice(0, 16);
    p.name = clean || "Player";

    this.state.players.set(client.sessionId, p);

    console.log(`[JOIN] ${client.sessionId.slice(0, 8)} (${p.name}) - total: ${this.clients.length}/2`);

    if (this.clients.length >= 2) {
      console.log("[MATCH_START] Both players in room");
      this.lock();
    }
  }

  onLeave(client) {
    console.log(`[LEAVE] ${client.sessionId.slice(0, 8)}`);
    this.state.players.delete(client.sessionId);

    // Only end room if BOTH players were in it and one left (match in progress)
    // Don't disconnect if waiting for second player
    if (this.clients.length === 0) {
      console.log("[ROOM_ENDING] Room empty - all players left");
      this.disconnect();
    }
  }

  step(dt) {
    if (!this.state || !this.state.bullets) return;

    const bulletsToDelete = [];

    this.state.bullets.forEach((b, bid) => {
      if (!b || !b.alive) {
        bulletsToDelete.push(bid);
        return;
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (b.x < -200 || b.x > 2800 || b.y < -200 || b.y > 2000) {
        bulletsToDelete.push(bid);
        return;
      }

      const hitRadius = 22;
      if (this.state.players) {
        this.state.players.forEach((p, pid) => {
          if (!p || !p.alive) return;
          if (pid === b.owner) return;

          const dx = p.x - b.x;
          const dy = p.y - b.y;
          if (dx * dx + dy * dy <= hitRadius * hitRadius) {
            p.hp = Math.max(0, p.hp - 10);
            if (p.hp <= 0) {
              p.alive = false;
              console.log(`[HIT] ${b.owner.slice(0, 8)} → ${pid.slice(0, 8)} hp=${p.hp}`);
              this.clock.setTimeout(() => {
                if (p) {
                  p.hp = 100;
                  p.alive = true;
                  p.x = 100 + Math.floor(Math.random() * 500);
                  p.y = 100 + Math.floor(Math.random() * 300);
                  console.log(`[RESPAWN] ${pid.slice(0, 8)}`);
                }
              }, 2000);
            }
            bulletsToDelete.push(bid);
          }
        });
      }
    });

    for (const id of bulletsToDelete) {
      this.state.bullets.delete(id);
    }
  }
}

const app = express();
app.set("trust proxy", true);

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.get("/", (_, res) => res.status(200).send("EvoBlasters 1v1 server running"));
app.get("/health", (_, res) => res.status(200).json({ ok: true }));

const server = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server }),
});

gameServer.define("battle", BattleRoom);

app.get("/matchmake", async (req, res) => {
  try {
    // Check if we have a waiting room that's still valid
    if (waitingRoomId) {
      try {
        const room = gameServer.rooms.get(waitingRoomId);
        if (room && room.clients && room.clients.length < 2 && !room.locked) {
          console.log(`[MATCHMAKE] Reusing waiting room ${waitingRoomId.slice(0, 8)} (clients: ${room.clients.length})`);
          const id = waitingRoomId;
          // Don't reset waitingRoomId yet - let the second player get it
          return res.json({ roomId: id });
        }
      } catch (e) {
        console.log(`[MATCHMAKE] Waiting room ${waitingRoomId.slice(0, 8)} no longer valid, creating new`);
      }
      waitingRoomId = null;
    }

    // Create a new waiting room
    const room = await gameServer.createRoom("battle", {});
    waitingRoomId = room.roomId;
    console.log(`[MATCHMAKE] Created new waiting room: ${room.roomId.slice(0, 8)}`);
    
    return res.json({ roomId: room.roomId });
  } catch (e) {
    console.error("[MATCHMAKE_ERROR]", e.message);
    return res.status(500).json({ error: "matchmake_failed" });
  }
});

const PORT = Number(process.env.PORT || 2567);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[SERVER] ✅ EvoBlasters 1v1 listening on port ${PORT}`);
});
