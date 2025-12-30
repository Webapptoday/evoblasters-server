const express = require("express");
const { Server } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");

const { Room } = require("colyseus");
const { Schema, type, MapSchema } = require("@colyseus/schema");

/* =======================
   Schema
======================= */
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

/* =======================
   Room
======================= */
class BattleRoom extends Room {
  onCreate() {
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
      const clean = String(data?.name ?? "Player").slice(0, 16);
      p.name = clean || "Player";
    });
  }

  onJoin(client, options) {
    const p = new Player();
    p.x = 100 + Math.floor(Math.random() * 500);
    p.y = 100 + Math.floor(Math.random() * 300);

    // allow name passed during joinOrCreate({name})
    if (options && typeof options.name === "string") {
      const clean = options.name.slice(0, 16);
      p.name = clean || "Player";
    }

    this.state.players.set(client.sessionId, p);
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
  }
}

/* =======================
   Server (IMPORTANT PART)
======================= */
const app = express();

const gameServer = new Server({
  transport: new WebSocketTransport({
    // Let Colyseus create/start the HTTP server via gameServer.listen
    app,
  }),
});

gameServer.define("battle", BattleRoom);

// Health check
app.get("/", (_, res) => res.send("EvoBlasters server running"));

// ✅ This is the key fix:
const PORT = process.env.PORT || 2567;
gameServer.listen(PORT);

console.log("Colyseus listening on", PORT);
