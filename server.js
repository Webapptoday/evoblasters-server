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
  onCreate() {
    console.log("BattleRoom created");

    this.setState(new State());

    this.onMessage("move", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      p.x = data.x;
      p.y = data.y;
    });

    this.onMessage("set_name", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      p.name = String(data?.name || "Player").slice(0, 16);
    });
  }

  onJoin(client) {
    console.log("Client joined:", client.sessionId);

    const p = new Player();
    p.x = 100 + Math.floor(Math.random() * 400);
    p.y = 100 + Math.floor(Math.random() * 300);
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
app.get("/", (_, res) => res.send("EvoBlasters server running"));

const server = http.createServer(app);

/**
 * 🚨 CRITICAL FIX
 * Explicit WebSocket path prevents Railway seat-reservation mismatch
 */
const gameServer = new Server({
  transport: new WebSocketTransport({
    server,
    path: "/ws",
  }),
});

gameServer.define("battle", BattleRoom);

const PORT = process.env.PORT || 2567;
server.listen(PORT, () => {
  console.log(`Colyseus listening on port ${PORT}`);
});
