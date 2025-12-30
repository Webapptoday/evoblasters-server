const express = require("express");
const { createServer } = require("http");

const { Server, Room } = require("colyseus");
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

  onJoin(client) {
    const p = new Player();
    p.x = 100 + Math.floor(Math.random() * 500);
    p.y = 100 + Math.floor(Math.random() * 300);
    this.state.players.set(client.sessionId, p);
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
  }
}

const app = express();
app.use(express.json());

app.get("/", (_, res) => res.send("EvoBlasters server running"));

const httpServer = createServer(app);

// ✅ Recommended Colyseus setup
const gameServer = new Server({
  server: httpServer,
});

gameServer.define("battle", BattleRoom);

const PORT = process.env.PORT || 2567;
gameServer.listen(PORT);

console.log("listening on", PORT);
