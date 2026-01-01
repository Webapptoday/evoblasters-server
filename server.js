import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Room } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";

/* =========================
   STATE
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
      p.name = String(data?.name ?? "Player").slice(0, 16);
    });
  }

  onJoin(client, options) {
    console.log("Client joined:", client.sessionId);

    const p = new Player();
    p.x = 100 + Math.random() * 400;
    p.y = 100 + Math.random() * 300;
    p.name = options?.name ?? "Player";

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

const port = Number(process.env.PORT || 2567);

const gameServer = new Server({
  transport: new WebSocketTransport({
    pingInterval: 5000,
    pingMaxRetries: 3,
  }),
});

gameServer.define("battle", BattleRoom);

gameServer.listen(port);

console.log(`🚀 Colyseus listening on port ${port}`);
