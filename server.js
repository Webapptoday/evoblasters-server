class BattleRoom extends Room {
  onCreate(options) {
    console.log("[BATTLEROOM] 🎮 Created with roomId:", this.roomId, "matchId:", options?.matchId);
    this.maxClients = 2;
    this.matchId = options?.matchId || this.roomId;
    this.readyPlayers = new Set();
    this.gameStarted = false;
    this.playersEntered = 0;
    
    this.setState(new State());
    this.setPatchRate(50);
    
    // ✅ CRITICAL: Set strict timeout - if 2nd player doesn't join within 10 seconds, destroy room
    console.log("[BATTLEROOM]", this.matchId, "⏱️ Starting 10s timeout for 2nd player...");
    this.secondPlayerTimeout = this.clock.setTimeout(() => {
      console.log("[BATTLEROOM]", this.matchId, "❌ TIMEOUT: 2nd player never arrived, destroying room");
      // Disconnect any players in this room
      this.clients.forEach(client => {
        console.log("[BATTLEROOM]", this.matchId, "Disconnecting client:", client.sessionId);
        client.leave();
      });
      this.disconnect();
    }, 10000);
    
    // ✅ Room locked for new players once 2 join
    this.onStateChange(() => {
      if (this.state.players.size === 2) {
        this.locked = true;
        // Cancel timeout since both players are here
        if (this.secondPlayerTimeout) {
          this.clock.clear(this.secondPlayerTimeout);
          this.secondPlayerTimeout = null;
          console.log("[BATTLEROOM]", this.matchId, "🔒 Room locked - both players present!");
        }
      }
    });

    this.onMessage("game_ready", (client, data) => {
      console.log("[BATTLEROOM]", this.matchId, "Player", client.sessionId, "ready");
      console.log("[BATTLEROOM]", this.matchId, "Current players in room:", this.state.players.size);
      this.readyPlayers.add(client.sessionId);
      
      // ✅ Validate: Must have EXACTLY 2 players in the room AND both ready
      const playerCount = this.state.players.size;
      if (playerCount !== 2) {
        console.log("[BATTLEROOM]", this.matchId, "❌ Cannot start - player count is", playerCount, "expected 2");
        return;
      }
      
      if (this.readyPlayers.size === 2 && !this.gameStarted) {
        console.log("[BATTLEROOM]", this.matchId, "✅ Both players ready (confirmed", playerCount, 'in room), starting game!');
        this.gameStarted = true;
        this.broadcast("game_can_start", { timestamp: Date.now() });
      } else {
        console.log("[BATTLEROOM]", this.matchId, "Waiting for second player... Ready:", this.readyPlayers.size, '/2');
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
    this.playersEntered += 1;
    console.log("[BATTLEROOM]", this.matchId, "👤 Player", this.playersEntered, "joined:", client.sessionId);

    const p = new Player();
    const clean = String(options?.name ?? "Player").trim().slice(0, 16);
    p.name = clean || "Player";

    p.x = 100 + Math.random() * 500;
    p.y = 100 + Math.random() * 300;

    this.state.players.set(client.sessionId, p);
    
    console.log("[BATTLEROOM]", this.matchId, "📊 Total players in room now:", this.state.players.size, "/ 2");
  }

  onLeave(client) {
    console.log("[BATTLEROOM]", this.matchId, "👋 Client left:", client.sessionId);
    this.state.players.delete(client.sessionId);
    this.readyPlayers.delete(client.sessionId);
    console.log("[BATTLEROOM]", this.matchId, "📊 Remaining players:", this.state.players.size);
  }
}
