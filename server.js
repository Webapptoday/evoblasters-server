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

class State extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
  }
}
type({ map: Player })(State.prototype, "players");

class BattleRoom extends Room {
  onCreate() {
    console.log("[BattleRoom] Created - roomId:", this.roomId);
    this.maxClients = 2;
    this.setState(new State());
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

      const x = Number(data?.x);
      const y = Number(data?.y);
      const dx = Number(data?.dx);
      const dy = Number(data?.dy);

      if (![x, y, dx, dy].every(Number.isFinite)) return;

      const len = Math.hypot(dx, dy) || 1;
      const dirx = dx / len;
      const diry = dy / len;

      const MAX_RANGE = 700;
      const HIT_RADIUS = 22;
      const BULLET_DAMAGE = 10;

      let hitId = null;
      let hitHp = null;

      for (const [id, p] of this.state.players.entries()) {
        if (id === client.sessionId) continue;
        if (!p.alive) continue;

        const vx = p.x - x;
        const vy = p.y - y;
        const t = vx * dirx + vy * diry;

        if (t < 0 || t > MAX_RANGE) continue;

        const px = x + dirx * t;
        const py = y + diry * t;
        const dist = Math.hypot(p.x - px, p.y - py);

        if (dist <= HIT_RADIUS) {
          hitId = id;
          p.hp = Math.max(0, p.hp - BULLET_DAMAGE);
          hitHp = p.hp;
          
          console.log(`[SHOT] ${client.sessionId.slice(0, 8)} hit ${hitId.slice(0, 8)} hp=${hitHp}`);

          if (p.hp <= 0) {
            p.alive = false;
            this.clock.setTimeout(() => {
              p.hp = 100;
              p.alive = true;
              p.x = 100 + Math.random() * 500;
              p.y = 100 + Math.random() * 300;
              console.log(`[RESPAWN] ${hitId.slice(0, 8)}`);
            }, 2000);
          }
          break;
        }
      }

      this.broadcast("shot", {
        fromId: client.sessionId,
        x, y, dx: dirx, dy: diry,
        hitId, hitHp,
      });
    });
  }

  onJoin(client, options) {
    console.log(`[JOIN] Client ${client.sessionId.slice(0, 8)} joining...`);
    
    const name = String(options?.name || "Player").slice(0, 16) || "Player";
    
    const p = new Player();
    p.name = name;
    p.x = 100 + Math.random() * 500;
    p.y = 100 + Math.random() * 300;
    p.hp = 100;
    p.alive = true;

    this.state.players.set(client.sessionId, p);
    
    console.log(`[JOIN] ${client.sessionId.slice(0, 8)} (${name}) - total: ${this.state.players.size}/2`);

    this.broadcast("player_joined", { id: client.sessionId, name });

    if (this.state.players.size === 2) {
      console.log("[MATCH_START] Both players in room");
      this.broadcast("match_start", { timestamp: Date.now() });
      this.locked = true;
    }
  }

  onLeave(client) {
    console.log(`[LEAVE] ${client.sessionId.slice(0, 8)}`);
    this.state.players.delete(client.sessionId);

    this.broadcast("player_left", { id: client.sessionId });

    if (this.state.players.size < 2) {
      this.locked = false;
      console.log("[WAITING] Awaiting opponent...");
      this.broadcast("waiting_for_opponent", {});
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

const PORT = Number(process.env.PORT || 2567);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[SERVER] ✅ EvoBlasters 1v1 listening on port ${PORT}`);
  console.log(`[SERVER] WebSocket: wss://evoblasters-server-production.up.railway.app`);
  console.log(`[SERVER] Health check: GET http://localhost:${PORT}/health`);
});
