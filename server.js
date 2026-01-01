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
  onCreate(options) {
    this.setState(new State());

    // (Optional) makes state updates snappier
    this.setPatchRate(50);

    this.onMessage("move", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      if (typeof data?.x === "number") p.x = data.x;
      if (typeof data?.y === "number") p.y = data.y;
    });

    this.onMessage("set_name", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      const clean = String(data?.name ?? "Player").trim().slice(0, 16);
      p.name = clean || "Player";
    });
  }

  onJoin(client, options) {
    const p = new Player();

    // name can be passed in joinOrCreate options from client
    const clean = String(options?.name ?? "Player").trim().slice(0, 16);
    p.name = clean || "Player";

    p.x = 100 + Math.floor(Math.random() * 500);
    p.y = 100 + Math.floor(Math.random() * 300);

    this.state.players.set(client.sessionId, p);
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
  }
}

const app = express();
app.set("trust proxy", true);

// health check
app.get("/", (_, res) => res.status(200).send("EvoBlasters server running"));
app.get("/health", (_, res) => res.status(200).json({ ok: true }));

const server = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({
    server,
    // NOTE: do NOT set "path" unless your client also uses the same path
  }),
});

// Define your room
gameServer.define("battle", BattleRoom);

// IMPORTANT: Railway provides PORT
const PORT = Number(process.env.PORT || 2567);

// Listen on all interfaces (Railway-safe)
server.listen(PORT, "0.0.0.0", () => {
  console.log("listening on", PORT);
});
