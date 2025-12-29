import http from "http";
import express from "express";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Room, Client } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";

class Player extends Schema {
  @type("number") x = 100;
  @type("number") y = 100;
  @type("number") hp = 100;
  @type("boolean") alive = true;
  @type("string") name = "Player";
}

class State extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}

class BattleRoom extends Room<State> {
  onCreate() {
    this.setState(new State());

    this.onMessage("move", (client, data: { x: number; y: number }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      p.x = data.x;
      p.y = data.y;
    });

    this.onMessage("hit", (client, data: { targetId: string; dmg: number }) => {
      // simple authoritative damage example (we'll tighten anti-cheat later)
      const t = this.state.players.get(data.targetId);
      if (!t || !t.alive) return;
      t.hp = Math.max(0, t.hp - Math.max(1, Math.min(50, data.dmg || 10)));
      if (t.hp === 0) t.alive = false;
    });

    this.onMessage("set_name", (client, data: { name: string }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      const clean = String(data?.name ?? "Player").slice(0, 16);
      p.name = clean || "Player";
    });
  }

  onJoin(client: Client) {
    const p = new Player();
    // random-ish spawn
    p.x = 100 + Math.floor(Math.random() * 500);
    p.y = 100 + Math.floor(Math.random() * 300);
    this.state.players.set(client.sessionId, p);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
  }
}

const app = express();
app.get("/", (_, res) => res.send("EvoBlasters Colyseus server running"));

const server = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server }),
});

gameServer.define("battle", BattleRoom);

const PORT = Number(process.env.PORT || 2567);
server.listen(PORT, () => console.log(`Listening on :${PORT}`));
