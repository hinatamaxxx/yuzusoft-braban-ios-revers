// Port of KAGEX world.ks (KAGEnvironment) on top of Render sprites.
(function () {
  const BOTH = 1, BU = 2, CLEAR = 3, FACE = 4, INVISIBLE = 5;
  const XPOSITION = 1, LEVEL = 2, DISPPOSITION = 3, YPOSITION = 4;
  const transitionName = new Set(["universal", "crossfade", "scroll", "wave", "mosaic", "turn", "rotatezoom", "rotatevanish", "rotateswap", "ripple"]);
  const transitionParam = new Set(["time", "rule", "vague", "from", "stay", "wavetype", "maxh", "maxomega", "bgcolor1", "bgcolor2", "maxsize", "turn", "bgcolor", "factor", "accel", "twistaccel", "twist", "centerx", "centery", "rwidth", "roundness", "speed", "maxdrift", "msgoff", "transwait"]);
  const actionParam = new Set(["delay", "x", "y", "toptime", "vibration", "waittime", "cycle", "distance", "falltime", "angvel", "angle", "showtime", "hidetime", "intime", "outtime"]);

  const getTo = (v) => { v = String(v); const p = v.indexOf(":"); return p > 0 ? v.slice(0, p) : p === 0 ? undefined : v; };
  const getFrom = (v) => { v = String(v); const p = v.indexOf(":"); return p >= 0 ? v.slice(p + 1) : undefined; };
  const num = (v) => (v === undefined || v === null || v === true ? undefined : +v);
  const Z_EVENT = 550000, LEVEL_Z = 100000;

  let env = null;
  const skip = () => VM.isSkip();

  // ---------------- common image base ----------------
  class EnvImage {
    constructor() {
      this.disp = CLEAR; this.redraw = false; this.resetFlag = false; this.fadeTime = undefined;
      this.opacity = this.opacityFrom = this.opacityTime = undefined;
      this.rotate = this.rotateFrom = this.rotateTime = undefined;
      this.zoom = this.zoomFrom = this.zoomTime = undefined;
      this.afx = this.afy = undefined; this.type = undefined;
      this.actionList = []; this.syncMode = false; this.trans = undefined;
    }
    setDisp(v) {
      if (v === undefined) return;
      if (v < CLEAR && this.disp >= CLEAR && this.opacity === undefined) this.opacity = 255;
      this.disp = v; this.redraw = true;
    }
    isShowBU() { return this.disp <= BU; }
    isShowFace() { return this.disp === BOTH || this.disp === FACE; }
    get fadeValue() { return env.fadeValue; }

    setAction(name, elm) {
      const info = env.actions[name];
      const copyParams = (a) => { for (const [k, v] of Object.entries(elm || {})) if (actionParam.has(k)) a[k] = v; return a; };
      if (info) { this.actionList.push(copyParams(Object.assign({}, info))); return true; }
      if (elm && String(name).startsWith("Layer")) {
        const a = copyParams({ module: name });
        if (elm.time !== undefined) a.time = elm.time;
        this.actionList.push(a);
        return true;
      }
      return false;
    }
    setTrans(name, elm) {
      const copy = (tr) => { for (const [k, v] of Object.entries(elm || {})) if (transitionParam.has(k)) tr[k] = v; return tr; };
      const info = env.transitions[name];
      if (info) {
        if (!skip()) { this.trans = copy(Object.assign({}, info)); this.redraw = true; }
        return true;
      }
      if (elm && (transitionName.has(name) || String(name).startsWith("trans"))) {
        if (!skip()) { this.trans = copy({ method: name }); this.redraw = true; }
        return true;
      }
      return false;
    }
    baseCommand(cmd, param, elm) {
      switch (cmd) {
        case "tagname": case "time": return true;
        case "type": this.type = param; return true;
        case "opacity": this.opacityFrom = num(getFrom(param)); this.opacity = num(getTo(param)); this.opacityTime = skip() ? 0 : num(elm.time); return true;
        case "fade": this.fadeTime = skip() ? undefined : param; return true;
        case "rotate": this.rotateFrom = num(getFrom(param)); this.rotate = num(getTo(param)); this.rotateTime = skip() ? 0 : num(elm.time); return true;
        case "zoom": this.zoomFrom = num(getFrom(param)); this.zoom = num(getTo(param)); this.zoomTime = skip() ? 0 : num(elm.time); return true;
        case "afx": this.afx = param; return true;
        case "afy": this.afy = param; return true;
        case "reset": this.resetFlag = true; return true;
        case "trans": this.setTrans(param, elm); return true;
        case "action": this.setAction(param, elm); return true;
        case "sync": if (param) this.syncMode = true; return true;
        case "show": this.setDisp(BOTH); return true;
        case "hide": this.setDisp(CLEAR); return true;
        case "visible": this.setDisp(param && param !== "false" ? BOTH : CLEAR); return true;
      }
      if (actionParam.has(cmd) || transitionParam.has(cmd)) return true;
      return false;
    }
    // apply state to sprite (KAGEnvImage.updateLayer)
    updateLayer(sp) {
      if (this.resetFlag) {
        this.type = this.opacity = this.rotate = this.zoom = this.afx = this.afy = undefined;
        this.actionList = [];
        sp.stopActions(); sp.opacity = 255; sp.zoom = 100; sp.rotate = 0; sp.afx = sp.afy = null;
        this.resetFlag = false; this.fadeTime = undefined;
      } else {
        if (this.redraw) {
          if (this.isShowBU()) {
            if (this.fadeTime !== undefined) {
              this.opacityFrom = 0;
              if (this.opacity === undefined) this.opacity = 255;
              this.opacityTime = this.fadeTime > 1 ? +this.fadeTime : this.fadeValue;
            }
            sp.visible = true;
          } else if (this.disp === FACE) {
            sp.visible = false;
          } else if (this.fadeTime !== undefined) {
            this.opacityFrom = undefined;
            if (this.opacity === undefined) this.opacity = 0;
            this.opacityTime = this.fadeTime > 1 ? +this.fadeTime : this.fadeValue;
            const target = sp;
            const ms = this.opacityTime;
            setTimeout(() => { if (target.opacity <= 0) target.visible = false; }, (skip() ? 0 : ms) + 30);
          } else {
            sp.visible = false;
          }
        }
        this.fadeTime = undefined;
        if (this.afx !== undefined) { sp.afx = this.afx === "center" ? null : +this.afx; this.afx = undefined; }
        if (this.afy !== undefined) { sp.afy = this.afy === "center" ? null : +this.afy; this.afy = undefined; }
        if (this.opacity !== undefined) { sp.tween("opacity", this.opacityFrom, this.opacity, this.opacityTime); this.opacity = this.opacityFrom = undefined; }
        if (this.rotate !== undefined) { sp.tween("rotate", this.rotateFrom, this.rotate, this.rotateTime); this.rotate = this.rotateFrom = undefined; }
        if (this.zoom !== undefined) { sp.tween("zoom", this.zoomFrom, this.zoom, this.zoomTime); this.zoom = this.zoomFrom = undefined; }
        for (const a of this.actionList) sp.beginAction(a);
        this.actionList = [];
        if (skip()) sp.stopActions();
      }
      if (this.syncMode) { this.syncMode = false; return waitSprite(sp); }
    }
    hideMessage(elm) {
      if ((this.trans && this.trans.msgoff) || (elm && elm.msgoff)) UI.hideWindowTemp();
    }
    // KAGEnvImage.updateImage for children (chars / layers / event)
    async updateImage(base) {
      if (this.redraw) {
        if (!base && this.trans && !env.transMode) {
          const tr = this.trans;
          this.trans = undefined;
          await this.prepare();
          Render.freeze();
          await this.drawLayer();
          this.calcPosition();
          this.updateLayer(this.sprite);
          await beginTransition(tr);
        } else if (!base && !env.transMode && this.fadeTime !== undefined && this.isShowBU() && this.sprite.visible && this.sprite.opacity > 0) {
          const ms = this.fadeTime > 1 ? +this.fadeTime : this.fadeValue;
          this.fadeTime = undefined;
          await this.prepare();
          Render.freeze();
          await this.drawLayer();
          this.calcPosition();
          this.updateLayer(this.sprite);
          await beginTransition({ method: "crossfade", time: ms });
        } else {
          await this.drawLayer();
          this.calcPosition();
          const w = this.updateLayer(this.sprite);
          if (w) await w;
        }
        this.redraw = false;
      } else {
        this.calcPosition();
        const w = this.updateLayer(this.sprite);
        if (w) await w;
      }
      this.trans = undefined;
    }
    async prepare() {}
    calcPosition() {}
    async drawLayer() {}
    store() {
      return { disp: this.disp };
    }
    restore(o) { this.disp = o.disp; this.redraw = true; }
  }

  function waitSprite(sp) {
    return new Promise((res) => {
      const chk = () => (sp.busy() && !skip() ? setTimeout(chk, 30) : res());
      chk();
    });
  }

  async function beginTransition(tr) {
    const p = Render.transition(tr);
    if (tr.transwait !== undefined) await VM.waitTime((+tr.time || 0) + (+tr.transwait || 0), true);
    else await VM.waitTransition(p);
  }

  // ---------------- simple layer (newlay) / event ----------------
  class EnvLayer extends EnvImage {
    constructor() { super(); this.imageFile = undefined; }
    layerCommand(cmd, param, elm) { return false; }
    doCommand(cmd, param, elm) {
      if (this.baseCommand(cmd, param, elm)) return true;
      if (cmd === "file") { this.setImageFile(param); this.setDisp(BOTH); return true; }
      if (this.layerCommand(cmd, param, elm)) return true;
      let find = this.setAction(cmd, elm);
      if (!find) find = this.setTrans(cmd, elm);
      if (!find) { this.setImageFile(cmd); this.setDisp(BOTH); }
      return find;
    }
    setImageFile(v) { this.imageFile = v; }
    async prepare() { if (this.imageFile !== undefined) await Assets.image(this.imageFile); }
    async drawLayer() {
      if (this.imageFile !== undefined) {
        const im = await Assets.image(this.imageFile);
        this.sprite.setImage(im, this.imageFile);
      }
    }
    async tagfunc(elm, list) {
      for (const [k, v] of list) this.doCommand(k, v, elm);
      this.hideMessage(elm);
      await this.updateImage();
    }
    store() { return Object.assign(super.store(), { imageFile: this.imageFile }); }
    restore(o) { super.restore(o); this.imageFile = o.imageFile; }
  }

  class EventLayer extends EnvLayer {
    constructor() { super(); this.sprite = new Render.Sprite(Z_EVENT); }
    setImageFile(v) {
      if (v !== undefined && v !== true) { VM.sf["cg_" + String(v).toUpperCase()] = true; VM.markSf(); }
      this.imageFile = v;
    }
    calcPosition() { /* event images are full screen at 0,0 */ }
  }

  class LevelMixin {
    static init(o, layerId) {
      o.layerId = layerId; o.level = undefined; o.xpos = 0; o.ypos = 0;
      o.xposFrom = o.yposFrom = o.moveTime = o.moveAccel = undefined; o.reposition = true;
    }
  }

  class SimpleLayer extends EnvLayer {
    constructor(name, layerId) {
      super();
      this.name = name;
      LevelMixin.init(this, layerId);
      this.sprite = new Render.Sprite(0);
      this.updateZ();
    }
    updateZ() { const lv = this.level === undefined ? env.defaultLevel : +this.level; this.sprite.z = 1000 + lv * LEVEL_Z + this.layerId * 10; }
    layerCommand(cmd, param, elm) {
      switch (cmd) {
        case "xpos": this.setXPos(param, elm); return true;
        case "ypos": this.setYPos(param, elm); return true;
        case "front": case "back": return true;
        case "level": this.level = param; this.updateZ(); return true;
        case "accel": return true;
      }
      return false;
    }
    setXPos(cmd, elm) {
      this.xposFrom = getFrom(cmd); this.xpos = getTo(cmd);
      if (this.xposFrom !== undefined && this.moveTime === undefined) { this.moveTime = num(elm.time); this.moveAccel = num(elm.accel); }
      this.reposition = true;
    }
    setYPos(cmd, elm) {
      this.yposFrom = getFrom(cmd); this.ypos = getTo(cmd);
      if (this.yposFrom !== undefined && this.moveTime === undefined) { this.moveTime = num(elm.time); this.moveAccel = num(elm.accel); }
      this.reposition = true;
    }
    calcPosition() {
      const sp = this.sprite;
      this.updateZ();
      if (!this.reposition || !sp.img) return;
      const l = 400 + (+this.xpos || 0) - sp.w / 2;
      const t = 300 + (+this.ypos || 0) - sp.h / 2;
      if (this.moveTime > 0 && !skip()) {
        if (this.xposFrom !== undefined || this.yposFrom !== undefined) {
          sp.x = this.xposFrom !== undefined ? 400 + +this.xposFrom - sp.w / 2 : l;
          sp.y = this.yposFrom !== undefined ? 300 + +this.yposFrom - sp.h / 2 : t;
        }
        sp.moveTo(l, t, this.moveTime, this.moveAccel || 0);
      } else sp.moveTo(l, t, 0);
      this.xposFrom = this.yposFrom = this.moveTime = undefined;
      this.reposition = false;
    }
    store() {
      return Object.assign(super.store(), { name: this.name, layerId: this.layerId, level: this.level, xpos: this.xpos, ypos: this.ypos });
    }
    restore(o) { super.restore(o); this.level = o.level; this.xpos = o.xpos; this.ypos = o.ypos; this.reposition = true; }
  }

  // ---------------- character ----------------
  class Character extends EnvImage {
    constructor(name, initName, init, layerId) {
      super();
      this.name = name; this.initName = initName; this.init = init || {};
      this.poses = this.init.poses;
      LevelMixin.init(this, layerId);
      this._pose = undefined; this.dress = undefined; this.face = undefined;
      this.voice = undefined; this.strVoice = undefined;
      this.sprite = new Render.Sprite(0);
      this.updateZ();
    }
    get fadeValue() {
      if (this.init.fadeValue !== undefined) return this.init.fadeValue;
      if (env.info.charFadeValue !== undefined) return env.info.charFadeValue;
      return env.fadeValue;
    }
    get pose() { return this._pose !== undefined ? this._pose : this.init.defaultPose !== undefined ? this.init.defaultPose : "通常"; }
    set pose(v) { this._pose = v; }
    updateZ() { const lv = this.level === undefined ? env.defaultLevel : +this.level; this.sprite.z = 1000 + lv * LEVEL_Z + this.layerId * 10; }

    setPose(poseName) {
      const info = this.poses && this.poses[poseName];
      if (info) {
        if (poseName !== this.pose || this.disp === CLEAR) {
          this.pose = poseName;
          if (this.disp === CLEAR) this.disp = BOTH;
          this.redraw = true;
        }
        if (this.dress !== undefined && !(info.dresses && info.dresses[this.dress] !== undefined)) this.dress = undefined;
        if (this.face !== undefined && !(info.faces && info.faces[this.face] !== undefined)) this.face = undefined;
      }
      this.ypos = 0;
    }
    setDress(n) { if (n !== this.dress || this.disp === CLEAR) { this.dress = n; if (this.disp === CLEAR) this.setDisp(BOTH); this.redraw = true; } }
    setFace(n) { if (n !== this.face || this.disp === CLEAR) { this.face = n; if (this.disp === CLEAR) this.setDisp(BOTH); this.redraw = true; } }
    setPosition(cmd, elm) {
      const posName = getTo(cmd);
      const info = env.positions[posName];
      if (!info) return;
      switch (info.type) {
        case XPOSITION: {
          this.moveTime = skip() ? 0 : num(elm.time);
          this.moveAccel = elm.accel === undefined ? 0 : +elm.accel;
          const from = getFrom(cmd), fi = from !== undefined ? env.positions[from] : undefined;
          this.xpos = info.xpos;
          if (fi) this.xposFrom = fi.xpos;
          this.reposition = true;
          if (this.disp === CLEAR) this.setDisp(BOTH);
          break;
        }
        case YPOSITION: {
          this.moveTime = skip() ? 0 : num(elm.time);
          this.moveAccel = elm.accel === undefined ? 0 : +elm.accel;
          const from = getFrom(cmd), fi = from !== undefined ? env.positions[from] : undefined;
          this.ypos = info.ypos;
          if (fi) this.yposFrom = fi.ypos;
          this.reposition = true;
          break;
        }
        case DISPPOSITION: this.setDisp(info.disp); this.redraw = true; break;
        case LEVEL: this.level = info.level; this.redraw = true; this.reposition = true; this.updateZ(); break;
      }
    }
    setXPos(cmd, elm) { SimpleLayer.prototype.setXPos.call(this, cmd, elm); }
    setYPos(cmd, elm) { SimpleLayer.prototype.setYPos.call(this, cmd, elm); }
    setVoice(param) {
      if (typeof param === "number") { this.voice = param; this.strVoice = undefined; }
      else if (typeof param === "string") {
        if (/^[0-9]+$/.test(param)) { this.voice = parseInt(param, 10); this.strVoice = undefined; }
        else this.strVoice = param;
      } else { this.voice = this.strVoice = undefined; }
    }
    doCommand(cmd, param, elm) {
      if (this.baseCommand(cmd, param, elm)) return true;
      switch (cmd) {
        case "pose": this.setPose(param); return true;
        case "dress": this.setDress(param); return true;
        case "face": this.setFace(param); return true;
        case "pos": this.setPosition(param, elm); return true;
        case "emotion": return true;
        case "xpos": this.setXPos(param, elm); return true;
        case "ypos": this.setYPos(param, elm); return true;
        case "front": case "back": return true;
        case "level": this.level = param; this.updateZ(); return true;
        case "voice": this.setVoice(param); return true;
        case "clearvoice": this.voice = undefined; return true;
        case "playvoice": this.playVoice(this.getVoice(/^[0-9]+$/.test(param) ? parseInt(param, 10) : param)); return true;
        case "waitvoice": this._waitVoice = true; return true;
        case "facewin": this.disp = FACE; return true;
      }
      let find = false;
      if (this.poses) {
        if (this.poses[cmd] !== undefined) { find = true; this.setPose(cmd); }
        else {
          const pi = this.poses[this.pose];
          if (pi) {
            if (pi.dresses && pi.dresses[cmd] !== undefined) { find = true; this.setDress(cmd); }
            else if (pi.faces && pi.faces[cmd] !== undefined) { find = true; this.setFace(cmd); }
          }
        }
      }
      if (!find && env.positions[getTo(cmd)] !== undefined) { this.setPosition(cmd, elm); find = true; }
      if (!find) find = this.setAction(cmd, elm);
      if (!find) find = this.setTrans(cmd, elm);
      return find;
    }
    imageName(levelName) {
      const pi = this.poses && this.poses[this.pose];
      if (!pi) return null;
      let n = String(pi.image).replace("LEVEL", levelName);
      const dn = this.dress !== undefined ? pi.dresses[this.dress] : pi.defaultDress;
      const fn = this.face !== undefined ? pi.faces[this.face] : pi.defaultFace;
      if (dn !== undefined) n = n.replace("DRESS", dn);
      if (fn !== undefined) n = n.replace("FACE", fn);
      return n;
    }
    levelName() {
      const li = env.levels[this.level === undefined ? env.defaultLevel : this.level];
      return li && li.name !== undefined ? li.name : String(this.level);
    }
    async prepare() { const n = this.imageName(this.levelName()); if (n) await Assets.image(n); }
    async drawLayer() {
      const n = this.imageName(this.levelName());
      if (!n) return;
      let im = await Assets.image(n);
      if (!im) { console.warn("character image missing", n); return; }
      im = Render.tinted(im, n, env.currentTime());
      this.sprite.setImage(im, n);
    }
    async faceImage() {
      if (env.faceLevelName === undefined || !this.poses) return null;
      const n = this.imageName(env.faceLevelName);
      return n ? Assets.image(n) : null;
    }
    calcPosition() {
      const sp = this.sprite;
      this.updateZ();
      if (!this.reposition || !sp.img) return;
      const li = env.levels[this.level === undefined ? env.defaultLevel : this.level];
      const zoom = li && li.zoom !== undefined ? li.zoom : 100;
      const l = 400 + ((+this.xpos || 0) * zoom) / 100 - sp.w / 2;
      const t = 300 + ((env.yoffset - (+this.ypos || 0)) * zoom) / 100 - sp.h;
      if (this.moveTime && !skip()) {
        if (this.xposFrom !== undefined || this.yposFrom !== undefined) {
          sp.x = this.xposFrom !== undefined ? 400 + +this.xposFrom - sp.w / 2 : l;
          sp.y = this.yposFrom !== undefined ? 300 + (env.yoffset - +this.yposFrom) - sp.h : t;
        }
        sp.moveTo(l, t, this.moveTime, this.moveAccel);
      } else sp.moveTo(l, t, 0);
      this.xposFrom = this.yposFrom = this.moveTime = undefined;
      this.reposition = false;
    }
    async tagfunc(elm, list) {
      this._waitVoice = false;
      for (const [k, v] of list) this.doCommand(k, v, elm);
      this.hideMessage(elm);
      await this.updateImage();
      if (this._waitVoice) await VM.waitVoice();
    }
    setTime() { if (this.sprite.visible) this.redraw = true; }
    getVoice(voice) {
      if (typeof voice === "number") {
        const vf = this.init.voiceFile;
        if (vf === undefined) return undefined;
        const fmt = (sfx) => vf.replace("%06d", String(voice).padStart(6, "0")).replace("%s", sfx);
        if (VM.f.name !== VM.sf.defaultName || VM.f.family !== VM.sf.defaultFamily) {
          const nn = fmt("N");
          if (Assets.exists(nn)) return nn;
        }
        return fmt("");
      }
      if (typeof voice === "string") return voice;
      return undefined;
    }
    currentVoice() { return this.getVoice(this.strVoice !== undefined ? this.strVoice : this.voice); }
    playVoice(voicename) {
      if (voicename === undefined) {
        voicename = this.currentVoice();
        if (this.strVoice !== undefined) this.strVoice = undefined;
        else if (typeof this.voice === "number") this.voice++;
        else this.voice = undefined;
      }
      if (voicename === undefined || !VM.voiceOn(this.init.voiceName)) return 0;
      env.stopAllVoice();
      if (skip()) return 0;
      return Sound.voices.play(voicename);
    }
    store() {
      return Object.assign(super.store(), { name: this.name, initName: this.initName, layerId: this.layerId, level: this.level, xpos: this.xpos, ypos: this.ypos,
        pose: this._pose, dress: this.dress, face: this.face, voice: this.voice, strVoice: this.strVoice });
    }
    restore(o) {
      super.restore(o);
      this.level = o.level; this.xpos = o.xpos; this.ypos = o.ypos; this._pose = o.pose; this.dress = o.dress; this.face = o.face;
      this.voice = o.voice; this.strVoice = o.strVoice; this.reposition = true; this.updateZ();
    }
  }

  // ---------------- environment ----------------
  class Environment extends EnvImage {
    constructor(info) {
      super();
      env = this;
      this.info = info;
      this.times = info.times || {}; this.stages = info.stages || {}; this.positions = info.positions || {};
      this.actions = info.actions || {}; this.transitions = info.transitions || {};
      this.defaultTime = info.defaultTime; this.yoffset = +info.yoffset || 0; this.defaultLevel = info.defaultLevel ?? 1;
      this.levels = info.levels || []; this.faceLevelName = info.faceLevelName;
      this.characterInits = info.characters || {};
      this.chars = new Map(); this.layers = new Map();
      this.layerCount = 0;
      this.stageSprite = new Render.Sprite(-10);
      this.event = new EventLayer();
      this.time = undefined; this.stage = undefined; this.transMode = false;
    }
    get fadeValue() { return this.info.fadeValue !== undefined ? +this.info.fadeValue : 500; }
    currentTime() { return this.time !== undefined ? this.times[this.time] : undefined; }

    init() {
      this.time = this.stage = undefined;
      this.disp = CLEAR; this.event.disp = CLEAR;
      for (const c of this.chars.values()) c.sprite.destroy();
      for (const l of this.layers.values()) l.sprite.destroy();
      this.chars.clear(); this.layers.clear();
      this.layerCount = 0; this.transMode = false; this.trans = undefined;
      this.stageSprite.clear(); this.event.sprite.clear();
    }
    hideCharacters() { for (const c of this.chars.values()) c.disp = CLEAR, c.redraw = true; }
    hideLayers() { for (const l of this.layers.values()) l.disp = CLEAR, l.redraw = true; }
    hideAll() { this.hideCharacters(); this.hideLayers(); }
    setStage(n) { if (n !== this.stage || this.disp === CLEAR) { this.stage = n; this.setDisp(BOTH); } this.event.setDisp(CLEAR); }
    setTime(n) {
      if (n !== this.time || this.disp === CLEAR) {
        this.time = n; this.setDisp(BOTH);
        for (const c of this.chars.values()) c.setTime();
      }
      this.event.setDisp(CLEAR);
    }
    doCommand(cmd, param, elm) {
      if (this.baseCommand(cmd, param, elm)) return true;
      switch (cmd) {
        case "init": this.init(); return true;
        case "stage": this.setStage(param); return true;
        case "stime": this.setTime(param); return true;
        case "hidecharacters": this.hideCharacters(); return true;
        case "hidelayers": this.hideLayers(); return true;
        case "hideall": this.hideAll(); return true;
        case "stopallvoice": this.stopAllVoice(); return true;
      }
      let find = false;
      if (this.times[cmd] !== undefined) { this.setTime(cmd); find = true; }
      else if (this.stages[cmd] !== undefined) { this.setStage(cmd); find = true; }
      if (!find) find = this.setAction(cmd, elm);
      if (!find) find = this.setTrans(cmd, elm);
      return find;
    }
    async drawStage() {
      const sp = this.stageSprite;
      if (this.stage === undefined || !this.stages[this.stage]) { sp.clear(); return; }
      if (this.time === undefined) this.time = this.defaultTime;
      const base = String(this.stages[this.stage].image);
      const t = this.times[this.time] || {};
      let im = await Assets.image(base.replace("TIME", t.prefix || ""));
      if (!im) {
        const dt = this.times[this.defaultTime] || {};
        im = await Assets.image(base.replace("TIME", dt.prefix || ""));
        if (im && (t.lightColor !== undefined || t.brightness !== undefined)) {
          im = Render.tinted(im, base, { prefix: "bg" + this.time, charLightColor: t.lightColor, charBrightness: t.brightness, charContrast: t.contrast });
        }
      }
      sp.setImage(im, base);
      if (im) { sp.x = 400 - im.width / 2; sp.y = 300 - im.height / 2; }
    }
    async prepareAll() {
      if (this.stage !== undefined && this.stages[this.stage]) {
        const t = this.times[this.time ?? this.defaultTime] || {};
        await Assets.image(String(this.stages[this.stage].image).replace("TIME", t.prefix || ""));
      }
      for (const c of this.chars.values()) if (c.redraw) await c.prepare();
      for (const l of this.layers.values()) if (l.redraw) await l.prepare();
      if (this.event.redraw) await this.event.prepare();
    }
    async drawAll(base) {
      await this.drawStage();
      for (const c of this.chars.values()) await c.updateImage(true);
      for (const l of this.layers.values()) await l.updateImage(true);
      await this.event.updateImage(true);
      this.updateLayer(this.stageSprite);
    }
    async updateImage() {
      if (this.redraw) {
        if (this.trans && !this.transMode) {
          const tr = Object.assign({}, this.trans);
          this.trans = undefined;
          await this.prepareAll();
          Render.freeze();
          await this.drawAll(true);
          await beginTransition(tr);
        } else if (!this.transMode && this.fadeTime !== undefined && this.isShowBU() && this.stageSprite.visible) {
          const ms = this.fadeTime > 1 ? +this.fadeTime : this.fadeValue;
          this.fadeTime = undefined;
          await this.prepareAll();
          Render.freeze();
          await this.drawAll(true);
          await beginTransition({ method: "crossfade", time: ms });
        } else {
          await this.drawAll();
        }
        this.redraw = false;
      } else {
        this.updateLayer(this.stageSprite);
      }
      this.trans = undefined;
    }
    beginTrans() {
      Render.freeze();
      this.transMode = true;
    }
    async endTrans(elm) {
      const name = elm.trans;
      let tr = {};
      const info = this.transitions[name];
      const copy = () => { for (const [k, v] of Object.entries(elm)) if (transitionParam.has(k)) tr[k] = v; };
      if (info) { tr = Object.assign({}, info); copy(); }
      else if (name && (transitionName.has(name) || String(name).startsWith("trans"))) { copy(); tr.method = name; }
      else copy();
      if (!tr.method && !tr.rule) tr.method = "crossfade";
      if (tr.time === undefined) tr.time = 1000;
      if (tr.msgoff) UI.hideWindowTemp();
      this.transMode = false;
      if (skip()) tr.time = 0;
      await beginTransition(tr);
    }
    getLayerId(id) {
      if (id !== undefined) { if (id >= this.layerCount) this.layerCount = id + 1; return id; }
      return this.layerCount++;
    }
    getCharacter(name, initName, layerId) {
      let ch = this.chars.get(name);
      if (!ch) {
        const init = this.characterInits[initName || name];
        if (init !== undefined) {
          ch = new Character(name, initName || name, init, this.getLayerId(layerId));
          this.chars.set(name, ch);
        }
      }
      return ch;
    }
    getEnvLayer(name, create, layerId) {
      let l = this.layers.get(name);
      if (!l && create) { l = new SimpleLayer(name, this.getLayerId(layerId)); this.layers.set(name, l); }
      return l;
    }
    async newLayer(elm, list) {
      const l = this.getEnvLayer(elm.name, true);
      await l.tagfunc(elm, list.filter(([k]) => k !== "name"));
    }
    stopAllVoice() { Sound.voices.stop(); }
    async tagfunc(elm, list) {
      for (const [k, v] of list) this.doCommand(k, v, elm);
      this.hideMessage(elm);
      await this.updateImage();
    }
    // returns true if handled
    async unknown(tagName, elm, list) {
      if (this.doCommand(tagName, true, elm)) {
        for (const [k, v] of list) this.doCommand(k, v, elm);
        this.hideMessage(elm);
        await this.updateImage();
        return true;
      }
      if (tagName === "event" || tagName === "ev") { await this.event.tagfunc(elm, list); return true; }
      const ch = this.getCharacter(tagName);
      if (ch) { await ch.tagfunc(elm, list); return true; }
      const l = this.getEnvLayer(tagName);
      if (l) { await l.tagfunc(elm, list); return true; }
      return false;
    }
    stopAction(name) {
      const o = this.chars.get(name) || this.layers.get(name);
      if (o) o.sprite.stopActions();
      else if (!name) { for (const c of this.chars.values()) c.sprite.stopActions(); for (const l of this.layers.values()) l.sprite.stopActions(); }
    }
    // dispname handler; returns voice duration (ms) or 0
    async dispname(name, disp) {
      if (VM.sf.voicecut) this.stopAllVoice();
      if (!name) { UI.setName(""); UI.setFace(null); return { voice: null, dur: 0 }; }
      const ch = this.getCharacter(name);
      let dispName;
      if (disp) dispName = disp;
      else if (ch && ch.init.nameAlias !== undefined) dispName = VM.evalExp(ch.init.nameAlias) || name;
      else dispName = name;
      UI.setName(dispName);
      if (this.faceLevelName !== undefined) {
        if (ch && ch.isShowFace() && ch.poses) UI.setFace(await ch.faceImage());
        else UI.setFace(null);
      }
      let voice = null, dur = 0;
      if (ch) {
        voice = ch.currentVoice() || null;
        const p = ch.playVoice();
        dur = p && p.then ? await Promise.race([p, new Promise((r) => setTimeout(() => r(0), 1500))]) : p;
      }
      return { voice, dur, dispName };
    }
    // clearlayers: wipe sprites and mark everything cleared
    clearLayers() {
      this.stageSprite.clear(); this.event.sprite.clear();
      this.disp = CLEAR; this.event.disp = CLEAR; this.event.imageFile = undefined;
      for (const c of this.chars.values()) { c.sprite.clear(); c.disp = CLEAR; }
      for (const l of this.layers.values()) { l.sprite.clear(); l.disp = CLEAR; }
    }
    store() {
      const chars = {}, layers = {};
      for (const [k, c] of this.chars) chars[k] = c.store();
      for (const [k, l] of this.layers) layers[k] = l.store();
      return { time: this.time, stage: this.stage, disp: this.disp, chars, layers, event: this.event.store(), layerCount: this.layerCount };
    }
    async restore(o) {
      this.init();
      this.time = o.time; this.stage = o.stage; this.disp = o.disp; this.redraw = true;
      for (const v of Object.values(o.chars || {})) { const c = this.getCharacter(v.name, v.initName, v.layerId); if (c) c.restore(v); }
      for (const v of Object.values(o.layers || {})) { const l = this.getEnvLayer(v.name, true, v.layerId); l.restore(v); }
      this.layerCount = Math.max(this.layerCount, o.layerCount || 0);
      this.event.restore(o.event || { disp: CLEAR });
      if (this.disp === BOTH) await this.drawStage(); else this.stageSprite.clear();
      this.stageSprite.visible = this.disp <= BU;
      for (const c of this.chars.values()) { await c.drawLayer(); c.calcPosition(); c.sprite.visible = c.isShowBU(); c.sprite.opacity = 255; c.redraw = false; }
      for (const l of this.layers.values()) { await l.drawLayer(); l.calcPosition(); l.sprite.visible = l.isShowBU(); l.sprite.opacity = 255; l.redraw = false; }
      await this.event.drawLayer(); this.event.sprite.visible = this.event.isShowBU() && !!this.event.imageFile; this.event.sprite.opacity = 255; this.event.redraw = false;
      this.redraw = false;
    }
  }

  window.Env = { Environment, get env() { return env; } };
})();
