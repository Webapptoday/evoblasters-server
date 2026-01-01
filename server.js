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
   ROOM
========================= */

class BattleRoom extends Room {
  onCreate(options) {
    console.log("BattleRoom created");
    this.setState(new State());

    // smoother updates
    this.setPatchRate(50);

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

    /* ---- shooting ---- */
    this.onMessage("shoot", (client, data) => {
      const shooter = this.state.players.get(client.sessionId);
      if (!shooter || !shooter.alive) return;

      const x = Number(data?.x);
      const y = Number(data?.y);
      const dx = Number(data?.dx);
      const dy = Number(data?.dy);

      if (![x, y, dx, dy].every(Number.isFinite)) return;

      // normalize direction
      const len = Math.hypot(dx, dy) || 1;
      const dirx = dx / len;
      const diry = dy / len;

      const MAX_RANGE = 700;
      const HIT_RADIUS = 22;
      const DAMAGE = 10;

      let hitId = null;
      let bestT = Infinity;

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

        if (target.hp <= 0) {
          target.alive = false;

          // respawn after 2s
          this.clock.setTimeout(() => {
            target.hp = 100;
            target.alive = true;
            target.x = 100 + Math.random() * 500;
            target.y = 100 + Math.random() * 300;
          }, 2000);
        }
      }

      // broadcast for visuals
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
    console.log("Client joined:", client.sessionId);

    const p = new Player();

    const clean = String(options?.name ?? "Player").trim().slice(0, 16);
    p.name = clean || "Player";

    p.x = 100 + Math.random() * 500;
    p.y = 100 + Math.random() * 300;

    this.state.players.set(client.sessionId, p);
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

app.get("/", (_, res) => res.status(200).send("EvoBlasters server running"));
app.get("/health", (_, res) => res.status(200).json({ ok: true }));

const server = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server }),
});

gameServer.define("battle", BattleRoom);

const PORT = Number(process.env.PORT || 2567);

server.listen(PORT, "0.0.0.0", () => {
  console.log("listening on", PORT);
});
