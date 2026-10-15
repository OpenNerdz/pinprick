// The player's body: walking, sprinting on a stamina bar, crouching (quiet, slow, fits crawlspaces),
// footsteps and the noise they make.

import {EYE, EYE_CROUCH, PLAYER, PLAYER_R, NOISE} from '../config.js';
import {clamp} from '../util/math.js';
import {collide} from '../world/collision.js';

const STAND_H = 1.75, CROUCH_H = 1.2;

export class Player {
  constructor(start) {
    this.x = start.x; this.z = start.z; this.yaw = start.yaw; this.pitch = 0;
    this.crouched = false; this.crouchT = 0;
    this.stamina = 1; this.staminaWait = 0; this.winded = false;
    this.sprinting = false;
    this.moveAmt = 0; this.bob = 0; this.stepAcc = 0;
    this.still = 0;              // seconds without moving, for the signal reading
    this.hidden = false;
    this.eye = EYE;
    this.probe = {x: 0, z: 0};
  }

  /** Can the player stand up here without hitting the ceiling? */
  canStand(world) {
    const p = this.probe; p.x = this.x; p.z = this.z;
    collide(world, p, PLAYER_R, STAND_H);
    return Math.hypot(p.x - this.x, p.z - this.z) < 0.01;
  }

  setCrouch(on, world) {
    if (!on && !this.canStand(world)) return false;
    this.crouched = on;
    return true;
  }

  /**
   * Advance one frame. `noise(x, z, loud)` reports sound to the creature; `sounds` plays footsteps.
   * Returns a short message when the player tried something that did not work.
   */
  update(dt, intent, world, noise, sounds, reduceMotion) {
    let msg = null;
    this.yaw += intent.lookX;
    this.pitch = clamp(this.pitch - intent.lookY, -1.35, 1.35);

    if (intent.crouch) {
      if (!this.setCrouch(!this.crouched, world)) msg = 'Too low to stand up here.';
    }
    const moving = Math.hypot(intent.moveX, intent.moveY);
    this.moveAmt = Math.min(1, moving);

    // sprint: stands you up, drains stamina, refuses while winded
    let wantSprint = intent.sprint && this.moveAmt > 0.5 && intent.moveY > 0.2 && !this.winded;
    if (wantSprint && this.crouched && !this.setCrouch(false, world)) wantSprint = false;
    this.sprinting = wantSprint;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * dt);
      this.staminaWait = PLAYER.staminaDelay;
      if (this.stamina === 0) { this.winded = true; sounds.breathe(); }
    } else if ((this.staminaWait -= dt) <= 0) {
      this.stamina = Math.min(1, this.stamina + PLAYER.staminaRegen * dt);
      if (this.winded && this.stamina > 0.35) this.winded = false;
    }

    const speed = this.crouched ? PLAYER.crouch : this.sprinting ? PLAYER.sprint : PLAYER.walk;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), sp = speed * dt;
    this.x += (sy * intent.moveY + cy * intent.moveX) * sp;
    this.z += (-cy * intent.moveY + sy * intent.moveX) * sp;
    collide(world, this, PLAYER_R, this.crouched ? CROUCH_H : STAND_H);

    // footsteps: a sound for you, a noise for it
    if (this.moveAmt > 0.15) {
      this.still = 0;
      const pace = speed / PLAYER.walk;
      this.bob += dt * 8.5 * this.moveAmt * Math.sqrt(pace);
      this.stepAcc += dt * this.moveAmt * pace;
      if (this.stepAcc > PLAYER.stepEvery) {
        this.stepAcc = 0;
        const kind = this.crouched ? 'crouch' : this.sprinting ? 'sprint' : 'walk';
        sounds.step(kind);
        noise(this.x, this.z, kind === 'crouch' ? NOISE.crouchStep : kind === 'sprint' ? NOISE.sprintStep : NOISE.step, false);
      }
    } else this.still += dt;

    this.crouchT += ((this.crouched ? 1 : 0) - this.crouchT) * Math.min(1, dt * 10);
    this.eye = EYE + (EYE_CROUCH - EYE) * this.crouchT;
    if (!reduceMotion) this.eye += Math.sin(this.bob * 2) * 0.025 * this.moveAmt;
    return msg;
  }
}
