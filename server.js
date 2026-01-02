const http = require("http");
const express = require("express");
const { Server, Room } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const { Schema, type, MapSchema } = require("@colyseus/schema");

/* =========================
   SCHEMAS
========================= */

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

/* =========================
   MATCHMAKING ROOM (Lobby)
========================= */

class MatchmakingRoom extends Room {
  onCreate(options) {
    console.log("[MATCHMAKING] Room created");
    this.maxClients = 1000;
    
    this.queue = [];
    this.waitingPlayers = new Map();
    this.pendingMatches = new Map();

    this.onMessage("join_queue", (client, data) => {
      console.log("[MATCHMAKING] Player", client.sessionId, "joining queue:", data.name);
      
      this.waitingPlayers.set(client.sessionId, {
        id: client.sessionId,
        name: data.name || "Player",
        joinedAt: Date.now(),
      });

      this.queue.push(client.sessionId);
      console.log("[MATCHMAKING] Queue size:", this.queue.length);
      this.tryCreateMatch();
    });

    this.onMessage("match_accepted", (client, data) => {
      const { matchId } = data;
      console.log("[MATCHMAKING] Player", client.sessionId, "accepted match", matchId);
      
      if (!this.pendingMatches.has(matchId)) {
        console.log("[MATCHMAKING] Match", matchId, "not found");
        return;
      }

      const match = this.pendingMatches.get(matchId);
      match.acceptedCount = (match.acceptedCount || 0) + 1;

      console.log("[MATCHMAKING] Match", matchId, "accepted:", match.acceptedCount, "/2");

      if (match.acceptedCount === 2) {
        console.log("[MATCHMAKING] ✅ Both players accepted! Sending game_start");
        this.send(match.p1Id, "game_start", { matchId });
        this.send(match.p2Id, "game_start", { matchId });
        this.pendingMatches.delete(matchId);
        this.waitingPlayers.delete(match.p1Id);
        this.waitingPlayers.delete(match.p2Id);
      }
    });
  }

  tryCreateMatch() {
    if (this.queue.length >= 2) {
      const p1Id = this.queue.shift();
      const p2Id = this.queue.shift();
      const p1 = this.waitingPlayers.get(p1Id);
      const p2 = this.waitingPlayers.get(p2Id);

      if (!p1 || !p2) {
        console.log("[MATCHMAKING] ERROR: Player missing from waiting list");
        return;
      }

      const matchId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      this.pendingMatches.set(matchId, {
        matchId,
        p1Id,
        p2Id,
        p1Name: p1.name,
        p2Name: p2.name,
        createdAt: Date.now(),
        acceptedCount: 0,
      });

      console.log("[MATCHMAKING] ✅ Match found!", p1.name, "vs", p2.name, "ID:", matchId);

      this.send(p1Id, "match_found", { 
        matchId, 
        opponent: p2.name,
        opponentId: p2Id,
      });
      this.send(p2Id, "match_found", { 
        matchId, 
        opponent: p1.name,
        opponentId: p1Id,
      });

      this.clock.setTimeout(() => {
        if (this.pendingMatches.has(matchId)) {
          console.log("[MATCHMAKING] Match", matchId, "timed out (no acceptance)");
          const m = this.pendingMatches.get(matchId);
          this.pendingMatches.delete(matchId);
          
          if (this.clients.find(c => c.sessionId === m.p1Id)) {
            this.waitingPlayers.set(m.p1Id, { id: m.p1Id, name: m.p1Name, joinedAt: Date.now() });
            this.queue.push(m.p1Id);
          }
          if (this.clients.find(c => c.sessionId === m.p2Id)) {
            this.waitingPlayers.set(m.p2Id, { id: m.p2Id, name: m.p2Name, joinedAt: Date.now() });
            this.queue.push(m.p2Id);
          }
          this.tryCreateMatch();
        }
      }, 30000);
    }
  }

  onLeave(client) {
    console.log("[MATCHMAKING] Player left:", client.sessionId);
    this.queue = this.queue.filter(id => id !== client.sessionId);
    this.waitingPlayers.delete(client.sessionId);
    
    for (const [matchId, match] of this.pendingMatches.entries()) {
      if (match.p1Id === client.sessionId || match.p2Id === client.sessionId) {
        console.log("[MATCHMAKING] Removing player from pending match", matchId);
        this.pendingMatches.delete(matchId);
      }
    }
  }
}

/* =========================
   ROOM
========================= */

class BattleRoom extends Room {
  onCreate(options) {
    console.log("[BATTLEROOM] Created, matchId:", options?.matchId);
    this.maxClients = 2;
    this.matchId = options?.matchId || "unknown";
    this.readyPlayers = new Set();
    this.gameStarted = false;
    
    this.setState(new State());
    this.setPatchRate(50);

    this.onMessage("game_ready", (client, data) => {
      console.log("[BATTLEROOM]", this.matchId, "Player", client.sessionId, "ready");
      this.readyPlayers.add(client.sessionId);
      
      if (this.readyPlayers.size === 2 && !this.gameStarted) {
        console.log("[BATTLEROOM]", this.matchId, "Both ready, starting game!");
        this.gameStarted = true;
        this.broadcast("game_can_start", { timestamp: Date.now() });
      }
    });

    /* ---- movement ---- */
    this.onMessage("move", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive) return;
      if (typeof data?.x === "number") p.x = data.x;
      if (typeof data?.y === "number") p.y = data.y;
    });

    /* ---- set name ---- */
    this.onMessage("set_name", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      const clean = String(data?.name ?? "Player").trim().slice(0, 16);
      p.name = clean || "Player";
    });

    /* ---- hit detection (client-side hitscan validation) ---- */
    this.onMessage("hit", (client, data) => {
      console.log("[SERVER] Hit message from", client.sessionId, "data:", data);
      const shooter = this.state.players.get(client.sessionId);
      const target = this.state.players.get(data?.targetId);

      if (!shooter || !target || !shooter.alive || !target.alive) {
        console.log("[SERVER] Invalid hit (shooter or target dead/missing)");
        return;
      }

      const dmg = Math.max(1, Math.min(50, data?.dmg || 10));
      target.hp = Math.max(0, target.hp - dmg);
      console.log("[SERVER] Hit! Target", data.targetId, "took", dmg, "damage, HP now:", target.hp);

      if (target.hp <= 0) {
        target.alive = false;
        console.log("[SERVER] Target died, respawning in 2s");

        // respawn after 2s
        this.clock.setTimeout(() => {
          target.hp = 100;
          target.alive = true;
          target.x = 100 + Math.random() * 500;
          target.y = 100 + Math.random() * 300;
          console.log("[SERVER] Target respawned");
        }, 2000);
      }

      // Broadcast hit to all clients for visual feedback
      this.broadcast("hit_result", {
        targetId: data.targetId,
        dmg: dmg,
        newHp: target.hp,
      });
    });

    /* ---- game start validation (must have 2+ players) ---- */
    this.onMessage("start_game", (client, data) => {
      const playerCount = this.state.players.size;
      console.log("[SERVER] Game start requested by", client.sessionId, "players:", playerCount);

      if (playerCount < 2) {
        console.log("[SERVER] ❌ BLOCKED - Cannot start with", playerCount, "player(s). Need 2+");
        this.send(client, "start_blocked", { 
          message: `Need 2 players to start. Currently: ${playerCount}` 
        });
        return;
      }

      console.log("[SERVER] ✅ APPROVED - Starting game with", playerCount, "players");
      this.broadcast("game_start", { timestamp: Date.now() });
    });

    /* ---- shooting ---- */
    this.onMessage("shoot", (client, data) => {
      console.log("[SERVER] Received shoot from", client.sessionId, "data:", data);
      const shooter = this.state.players.get(client.sessionId);
      if (!shooter || !shooter.alive) {
        console.log("[SERVER] Shooter not found or not alive");
        return;
      }

      const x = Number(data?.x);
      const y = Number(data?.y);
      const dx = Number(data?.dx);
      const dy = Number(data?.dy);

      console.log("[SERVER] Shoot values:", { x, y, dx, dy }, "All finite?", [x, y, dx, dy].every(Number.isFinite));
      if (![x, y, dx, dy].every(Number.isFinite)) {
        console.log("[SERVER] Invalid shoot data, returning");
        return;
      }

      // normalize direction
      const len = Math.hypot(dx, dy) || 1;
      const dirx = dx / len;
      const diry = dy / len;

      const MAX_RANGE = 700;
      const HIT_RADIUS = 22;
      const DAMAGE = 10;

      let hitId = null;
      let bestT = Infinity;

      console.log("[SERVER] Checking", this.state.players.size - 1, "other players for hit");
      // simple hitscan ray
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

        console.log("[SERVER] Player", id, "dist:", dist, "t:", t, "HIT?", dist <= HIT_RADIUS && t < bestT);

        if (dist <= HIT_RADIUS && t < bestT) {
          bestT = t;
          hitId = id;
        }
      }

      let hitHp = null;

      if (hitId) {
        const target = this.state.players.get(hitId);
        target.hp = Math.max(0, target.hp - DAMAGE);
        hitHp = target.hp;
        console.log("[SERVER] HIT! Target", hitId, "HP now:", hitHp);

        if (target.hp <= 0) {
          target.alive = false;
          console.log("[SERVER] Target", hitId, "is dead, respawning in 2s");

          // respawn after 2s
          this.clock.setTimeout(() => {
            target.hp = 100;
            target.alive = true;
            target.x = 100 + Math.random() * 500;
            target.y = 100 + Math.random() * 300;
            console.log("[SERVER] Respawned", hitId);
          }, 2000);
        }
      } else {
        console.log("[SERVER] No hit detected");
      }

      // broadcast for visuals
      console.log("[SERVER] Broadcasting shot to all players");
      this.broadcast("shot", {
        fromId: client.sessionId,
        x,
        y,
        dx: dirx,
        dy: diry,
        hitId,
        hitHp,
      });
    });
  }

  onJoin(client, options) {
    console.log("[BATTLEROOM]", this.matchId, "Client joined:", client.sessionId);

    const p = new Player();
    const clean = String(options?.name ?? "Player").trim().slice(0, 16);
    p.name = clean || "Player";

    p.x = 100 + Math.random() * 500;
    p.y = 100 + Math.random() * 300;

    this.state.players.set(client.sessionId, p);
    
    console.log("[BATTLEROOM]", this.matchId, "Players in room:", this.state.players.size, "Expected: 2");
  }

  onLeave(client) {
    console.log("Client left:", client.sessionId);
    this.state.players.delete(client.sessionId);
  }
}

/* =========================
   SERVER
========================= */

const app = express();
app.set("trust proxy", true);

// ✅ Enable CORS for all origins
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.get("/", (_, res) => res.status(200).send("EvoBlasters server running"));
app.get("/health", (_, res) => res.status(200).json({ ok: true }));

const server = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server }),
});

gameServer.define("matchmaking", MatchmakingRoom);
gameServer.define("battle", BattleRoom);

const PORT = Number(process.env.PORT || 2567);

server.listen(PORT, "0.0.0.0", () => {
  console.log("listening on", PORT);
});
