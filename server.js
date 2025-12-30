const http = require("http");
const express = require("express");
const cors = require("cors");

const { Server, Room } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const { Schema, type, MapSchema } = require("@colyseus/schema");

// ---- Schema ----
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

// ---- Room ----
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

    // If client provided a name in join options, use it
    if (options && options.name) {
      const clean = String(options.name).slice(0, 16);
      p.name = clean || "Player";
    }

    this.state.players.set(client.sessionId, p);
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
  }
}

// ---- App ----
const app = express();
app.use(express.json());

// IMPORTANT for GitHub Pages -> Railway cross-origin matchmake requests
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.options("*", cors());

app.get("/", (_, res) => res.status(200).send("EvoBlasters server running"));
app.get("/health", (_, res) => res.status(200).json({ ok: true }));

const server = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server }),
});

gameServer.define("battle", BattleRoom);

// ✅ This is what exposes /matchmake/* endpoints on the same Express app
gameServer.attach({ app });

// Railway provides PORT
const PORT = Number(process.env.PORT || 2567);
server.listen(PORT, () => console.log("listening on", PORT));
