// The scout rover, built in the browser from the CAD export (cad/scout.json + cad/meshes/*.stl).
// Nothing about the rover's shape or joints is written here: change robot/cad/scout.py and rebuild.
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const FINISH = {
  paint: { metalness: 0.15, roughness: 0.5 },
  metal: { metalness: 0.88, roughness: 0.4 },
  plastic: { metalness: 0, roughness: 0.62 },
  rubber: { metalness: 0, roughness: 0.94 },
  carbon: { metalness: 0.3, roughness: 0.36 },
  glass: { metalness: 0.7, roughness: 0.08 },
  glow: { metalness: 0, roughness: 0.4 },
};

export async function loadRover(base = 'cad/') {
  const spec = await (await fetch(base + 'scout.json')).json();
  const loader = new STLLoader();
  const geos = {};
  await Promise.all([...new Set(spec.parts.map(p => p.mesh))].map(async f => {
    geos[f] = toCreasedNormals(await loader.loadAsync(base + f), 0.62);
  }));
  return new Rover(spec, geos);
}

export class Rover {
  constructor(spec, geos) {
    this.spec = spec;
    this.object = new THREE.Group();          // metres, Y up: where the rover stands and which way it faces
    this.cad = new THREE.Group();             // millimetres, Z up: the CAD's own frame
    this.cad.rotation.x = -Math.PI / 2;
    this.cad.scale.setScalar(0.001);
    this.object.add(this.cad);

    this.links = {}; this.joints = {}; this.q = {};
    for (const [name, L] of Object.entries(spec.links)) {
      const g = new THREE.Group(); g.name = name; g.position.set(...L.origin);
      this.links[name] = g;
      if (L.joint) { this.joints[L.joint.name] = { ...L.joint, link: name, axisV: new THREE.Vector3(...L.joint.axis) }; this.q[L.joint.name] = 0; }
    }
    for (const [name, L] of Object.entries(spec.links)) (L.parent ? this.links[L.parent] : this.cad).add(this.links[name]);

    this.meshes = []; this.edges = []; this.glow = {};
    const edgeGeo = {}, edgeMat = new THREE.LineBasicMaterial({ color: 0x0b0c0d, transparent: true, opacity: 0.42 });
    for (const p of spec.parts) {
      const f = FINISH[p.finish] || FINISH.plastic;
      const mat = new THREE.MeshStandardMaterial({ color: p.color, metalness: f.metalness, roughness: f.roughness });
      if (p.finish === 'glow') { mat.emissive.set(p.color); mat.emissiveIntensity = 0.4; (this.glow[p.bom] ||= []).push(mat); }
      const m = new THREE.Mesh(geos[p.mesh], mat);
      m.castShadow = true; m.receiveShadow = true;
      m.position.set(...p.xyz); m.rotation.z = THREE.MathUtils.degToRad(p.yaw);
      m.userData = { bom: p.bom, home: new THREE.Vector3(...p.xyz), ex: new THREE.Vector3(...p.explode), link: p.link, finish: p.finish };
      edgeGeo[p.mesh] ||= new THREE.EdgesGeometry(geos[p.mesh], 32);
      const e = new THREE.LineSegments(edgeGeo[p.mesh], edgeMat); e.raycast = () => {};
      m.add(e); this.edges.push(e);
      this.links[p.link].add(m); this.meshes.push(m);
    }

    // geometry the suspension solver needs, in metres, read from the link origins
    const o = n => spec.links[n].origin, mm = 0.001;
    this.geo = {
      r: spec.drive.wheel_radius_m,
      F: { x: o('wheel_FL')[0] * mm, z: o('wheel_FL')[2] * mm },
      B: { x: o('bogie_L')[0] * mm, z: o('bogie_L')[2] * mm },
      M: { x: o('wheel_ML')[0] * mm, z: o('wheel_ML')[2] * mm },
      R: { x: o('wheel_RL')[0] * mm, z: o('wheel_RL')[2] * mm },
      pivotY: o('rocker_L')[1] * mm, trackY: spec.size.track * mm / 2, pivotZ: o('base')[2] * mm,
    };
    this.sus = { L: { zp: this.geo.pivotZ, tr: 0, tb: 0 }, R: { zp: this.geo.pivotZ, tr: 0, tb: 0 } };
    this.slope = { L: [0, 0, 0], R: [0, 0, 0] };   // ground slope under the front, middle and rear wheel
    this.pitch = 0; this.roll = 0; this.height = this.geo.pivotZ;

    // the head's two lamps, as one spotlight with a faint visible beam
    const head = this.links.head;
    this.lamp = new THREE.SpotLight(0xfff0d2, 0, 26, 0.56, 0.7, 1.6);
    this.lamp.position.set(44, 0, 4);
    this.lamp.target.position.set(1044, 0, -160);
    this.lamp.castShadow = true; this.lamp.shadow.mapSize.set(1024, 1024);
    this.lamp.shadow.camera.near = 0.12; this.lamp.shadow.camera.far = 24; this.lamp.shadow.bias = -0.0015;
    head.add(this.lamp, this.lamp.target);
    const cone = new THREE.ConeGeometry(3300, 7000, 28, 1, true);
    cone.translate(0, -3500, 0); cone.rotateZ(Math.PI / 2);              // tip at the lamp, opening toward +X
    const pos = cone.attributes.position, col = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) { const a = Math.max(0, 1 - pos.getX(i) / 7000); col.set([1, 0.95, 0.82, a * a * a], i * 4); }
    cone.setAttribute('color', new THREE.BufferAttribute(col, 4));
    this.beam = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.beam.material.opacity = 0.055;
    this.beam.position.set(44, 0, 4); this.beam.rotation.y = 0.16; this.beam.visible = false; this.beam.raycast = () => {};
    head.add(this.beam);
    // the camera in the head looks along the head's +X. It is kept outside the millimetre-scaled CAD group
    // (a scaled camera would scale every light distance), and copies the mount's pose each frame.
    this.eye = new THREE.PerspectiveCamera(74, 16 / 10, 0.05, 80);
    this.eyeMount = new THREE.Group(); this.eyeMount.position.set(48, 0, 4);
    this.eyeMount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0)));
    head.add(this.eyeMount);
    this.beaconLight = new THREE.PointLight(0xff9a1f, 0, 5, 2);
    this.beaconLight.position.set(-190, -45, 95); this.links.base.add(this.beaconLight);

    this.setLamps(false);
  }

  setJoint(name, angle) {
    const j = this.joints[name]; if (!j) return;
    if (j.type === 'revolute') angle = Math.min(j.upper, Math.max(j.lower, angle));
    this.q[name] = angle;
    this.links[j.link].quaternion.setFromAxisAngle(j.axisV, angle);
  }
  spin(name, d) { this.setJoint(name, (this.q[name] + d) % (Math.PI * 2)); }
  // 0 = mast upright, 1 = folded forward; the head tilts back by the same angle so it keeps looking ahead
  setMast(fold, look = 0) { this.setJoint('mast_fold', fold * Math.PI / 2); this.setJoint('head_tilt', -fold * Math.PI / 2 + look); }
  setLamps(on, power = 1) {
    this.lamp.intensity = on ? 190 * power : 0; this.beam.visible = on;
    for (const m of this.glow.lamps || []) m.emissiveIntensity = on ? 4 : 0.25;
  }
  setBeacon(v) { for (const m of this.glow.beacon || []) m.emissiveIntensity = 0.3 + 3.2 * v; this.beaconLight.intensity = 3.5 * v; }
  setRelayLight(v) { for (const m of this.glow.relay || []) m.emissiveIntensity = 0.3 + 3 * v; }
  setExplode(t) { for (const m of this.meshes) m.position.copy(m.userData.home).addScaledVector(m.userData.ex, t); }
  setEdges(on) { this.edgesOn = on; for (const m of this.meshes) m.children[0].visible = on && !m.material.transparent; }
  setEnv(v) { for (const m of this.meshes) m.material.envMapIntensity = v; }
  updateEye() { this.eyeMount.getWorldPosition(this.eye.position); this.eyeMount.getWorldQuaternion(this.eye.quaternion); }
  // show one bill-of-materials line solid and ghost the rest; with no line, xray ghosts the outer shell
  setFocus(bom, xray = false) {
    const shell = new Set(['chassis', 'lid', 'relay']);
    for (const m of this.meshes) {
      const ghost = bom ? m.userData.bom !== bom : xray && shell.has(m.userData.bom);
      if (m.material.transparent !== ghost) m.material.needsUpdate = true; // the OPAQUE define is compiled in
      m.material.transparent = ghost; m.material.opacity = ghost ? (bom ? 0.1 : 0.16) : 1; m.material.depthWrite = !ghost;
      m.children[0].visible = !ghost && this.edgesOn !== false;
      m.renderOrder = ghost ? 2 : 0;
    }
  }

  // Stand the rover on a ground-height function (metres, y = ground(x, z)): solve where each wheel touches,
  // then the rocker and bogie angles, then the body from the two rockers through the differential.
  poseOnGround(ground, px, pz, psi) {
    const g = this.geo, c = Math.cos(psi), s = Math.sin(psi);
    const fwd = { x: c, z: -s }, left = { x: -s, z: -c };
    for (const side of ['L', 'R']) {
      const st = this.sus[side], sy = side === 'L' ? 1 : -1;
      const ox = px + left.x * g.trackY * sy, oz = pz + left.z * g.trackY * sy;
      const centre = f => {                     // height of a wheel's centre when it rests on the ground at f metres ahead
        let best = -1e9;
        for (let k = -3; k <= 3; k++) {
          const dx = k / 3 * g.r * 0.96, h = ground(ox + (f + dx) * fwd.x, oz + (f + dx) * fwd.z) + Math.sqrt(g.r * g.r - dx * dx);
          if (h > best) best = h;
        }
        return best;
      };
      let fx = 0, mx = 0, rx = 0;
      for (let it = 0; it < 10; it++) {
        const cr = Math.cos(st.tr), sr = Math.sin(st.tr), cb = Math.cos(st.tb), sb = Math.sin(st.tb);
        fx = g.F.x * cr + g.F.z * sr; const fz = -g.F.x * sr + g.F.z * cr;
        const bx = g.B.x * cr + g.B.z * sr, bz = -g.B.x * sr + g.B.z * cr;
        mx = bx + g.M.x * cb + g.M.z * sb; const mz = bz - g.M.x * sb + g.M.z * cb;
        rx = bx + g.R.x * cb + g.R.z * sb; const rz = bz - g.R.x * sb + g.R.z * cb;
        const eF = st.zp + fz - centre(fx), eM = st.zp + mz - centre(mx), eR = st.zp + rz - centre(rx);
        st.tb += 0.85 * (eM - eR) / (g.M.x - g.R.x);
        const eB = (eM + eR) / 2, span = g.F.x - g.B.x;
        st.tr += 0.85 * (eF - eB) / span;
        st.zp -= 0.85 * (eF * -g.B.x + eB * g.F.x) / span;
      }
      const sl = f => (ground(ox + (f + 0.05) * fwd.x, oz + (f + 0.05) * fwd.z) - ground(ox + (f - 0.05) * fwd.x, oz + (f - 0.05) * fwd.z)) / 0.1;
      this.slope[side] = [sl(fx), sl(mx), sl(rx)];
    }
    const L = this.sus.L, R = this.sus.R;
    this.pitch = (L.tr + R.tr) / 2;
    this.roll = Math.atan2(L.zp - R.zp, 2 * g.pivotY);
    this.height = (L.zp + R.zp) / 2;
    this.object.position.set(px, 0, pz); this.object.rotation.y = psi;
    const base = this.links.base;
    base.position.set(0, 0, this.height * 1000);
    base.quaternion.setFromEuler(new THREE.Euler(this.roll, this.pitch, 0, 'XYZ'));
    this.setJoint('rocker_left', L.tr - this.pitch); this.setJoint('rocker_right', R.tr - this.pitch);
    this.setJoint('bogie_left', L.tb - L.tr); this.setJoint('bogie_right', R.tb - R.tr);
  }
  // roll the wheels for a move of `left` and `right` metres along each side
  roll_(left, right) {
    const r = this.geo.r;
    for (const w of ['front', 'mid', 'rear']) { this.spin(`drive_${w}_left`, left / r); this.spin(`drive_${w}_right`, right / r); }
  }
  // back to the CAD's rest pose on a flat floor
  rest() {
    this.sus.L = { zp: this.geo.pivotZ, tr: 0, tb: 0 }; this.sus.R = { zp: this.geo.pivotZ, tr: 0, tb: 0 };
    this.links.base.position.set(0, 0, this.geo.pivotZ * 1000); this.links.base.quaternion.identity();
    for (const n of ['rocker_left', 'rocker_right', 'bogie_left', 'bogie_right']) this.setJoint(n, 0);
    this.pitch = this.roll = 0;
  }
  // a point given in a link's own millimetres, as a world position
  point(link, x, y, z, out = new THREE.Vector3()) { return this.links[link].localToWorld(out.set(x, y, z)); }

  // What the motors are doing at this speed on this ground. A simple DC motor model:
  // torque to hold the wheel's share of the weight against rolling drag and slope, current in proportion.
  motors(speed, extraDrag = 0) {
    const d = this.spec.drive, a = this.spec.actuators.drive, share = this.spec.mass_g / 1000 * 9.81 / 6, out = [];
    for (const side of ['L', 'R']) for (let i = 0; i < 3; i++) {
      const th = Math.atan(this.slope[side][i]);
      const torque = speed === 0 ? 0 : share * d.wheel_radius_m * (d.rolling_resistance + extraDrag + Math.sin(th) * Math.sign(speed));
      const amps = speed === 0 ? 0 : Math.max(0.12, a.no_load_a + torque / a.stall_torque_nm * (a.stall_a - a.no_load_a));
      out.push({ torque, amps });
    }
    return out;
  }
}
