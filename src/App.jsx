import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Tween, Group, Easing } from "@tweenjs/tween.js";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import { CSS3DRenderer, CSS3DObject } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import "./App.css";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SHEET_ID = import.meta.env.VITE_SHEET_ID;
const RANGE = import.meta.env.VITE_SHEET_RANGE || "Sheet1!A1:F";

function parseNetWorth(s) {
  if (!s) return 0;
  return Number(String(s).replace(/[^0-9.]/g, "")) || 0;
}
function colorByWorth(w) {
  if (w < 100000) return "rgba(255,60,60,0.85)";
  if (w < 200000) return "rgba(255,165,0,0.85)";
  return "rgba(60,220,120,0.85)";
}

function buildTile(person) {
  const name = person["Name"] ?? "";
  const photo = person["Photo"] ?? "";
  const age = person["Age"] ?? "";
  const country = person["Country"] ?? "";
  const interest = person["Interest"] ?? "";
  const netWorthStr = person["Net Worth"] ?? "";
  const worth = parseNetWorth(netWorthStr);

  const el = document.createElement("div");
  el.className = "element";
  el.style.background = colorByWorth(worth);

  const img = document.createElement("img");
  img.className = "photo";
  img.src = photo;
  img.alt = name;
  el.appendChild(img);

  const nm = document.createElement("div");
  nm.className = "name";
  nm.textContent = name;
  el.appendChild(nm);

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.innerHTML = `
    <div>${country} • Age ${age}</div>
    <div>${interest}</div>
  `;
  el.appendChild(meta);

  const w = document.createElement("div");
  w.className = "worth";
  w.textContent = netWorthStr || `$${worth.toLocaleString()}`;
  el.appendChild(w);

  return el;
}

async function fetchSheetRows(accessToken) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(
    RANGE
  )}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) throw new Error("Failed to read sheet: " + (await res.text()));

  const data = await res.json();
  const values = data.values || [];
  if (values.length === 0) return [];

  const headers = values[0].map((h) => String(h).trim());
  return values.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = r[i] ?? ""));
    return obj;
  });
}

export default function App() {
  const tweenGroupRef = useRef(new Group());
  const mountRef = useRef(null);
  const tokenClientRef = useRef(null);
  const [accessToken, setAccessToken] = useState(null);
  const [error, setError] = useState("");

  const cameraRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const rafRef = useRef(null);

  const objectsRef = useRef([]);
  const targetsRef = useRef({ table: [], sphere: [], helix: [], grid: [] });

  // ---------- Google Login ----------
  useEffect(() => {
    const timer = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(timer);

        tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
          callback: (resp) => {
            if (resp?.access_token) setAccessToken(resp.access_token);
            else setError("Failed to get access token");
          },
        });
      }
    }, 100);

    return () => clearInterval(timer);
  }, []);

  const signInWithGoogle = () => {
    setError("");
    if (!tokenClientRef.current) {
      setError("Google not ready yet. Please refresh.");
      return;
    }
    tokenClientRef.current.requestAccessToken({ prompt: "" });
  };

  // ---------- Three init ----------
  const initThree = () => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const camera = new THREE.PerspectiveCamera(40, width / height, 1, 10000);
    camera.position.set(0, 0, 2500);

    const scene = new THREE.Scene();

    const renderer = new CSS3DRenderer();
    renderer.setSize(width, height);
    renderer.domElement.className = "css3d";
    mount.appendChild(renderer.domElement);

    const controls = new TrackballControls(camera, renderer.domElement);
    controls.minDistance = 500;
    controls.maxDistance = 6000;

    cameraRef.current = camera;
    sceneRef.current = scene;
    rendererRef.current = renderer;
    controlsRef.current = controls;

    const onResize = () => {
      const m = mountRef.current;
      const c = cameraRef.current;
      const r = rendererRef.current;
      if (!m || !c || !r) return;

      const w = m.clientWidth;
      const h = m.clientHeight;
      c.aspect = w / h;
      c.updateProjectionMatrix();
      r.setSize(w, h);
      r.render(scene, camera);
    };

    window.addEventListener("resize", onResize);
    initThree._onResize = onResize;

    const animate = (time) => {
      rafRef.current = requestAnimationFrame(animate);
      tweenGroupRef.current.update(time);
      controls.update();
      renderer.render(scene, camera);
    };
    rafRef.current = requestAnimationFrame(animate);
  };

  const cleanupThree = () => {
    cancelAnimationFrame(rafRef.current);
    if (initThree._onResize) window.removeEventListener("resize", initThree._onResize);

    if (rendererRef.current?.domElement && mountRef.current) {
      mountRef.current.removeChild(rendererRef.current.domElement);
    }

    objectsRef.current = [];
    targetsRef.current = { table: [], sphere: [], helix: [], grid: [] };
    cameraRef.current = null;
    sceneRef.current = null;
    rendererRef.current = null;
    controlsRef.current = null;
  };

  // ---------- Layout targets ----------
  const computeTargets = (count) => {
    const targets = { table: [], sphere: [], helix: [], grid: [] };

    // TABLE
    const cols = 20;
    const rows = 10;
    const spacingX = 140;
    const spacingY = 180;

    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);

      const o = new THREE.Object3D();
      o.position.set(
        (col - (cols / 2 - 0.5)) * spacingX,
        (-(row) + (rows / 2 - 0.5)) * spacingY,
        0
      );
      targets.table.push(o);
    }

    // SPHERE
    const vector = new THREE.Vector3();
    const radius = 900;
    for (let i = 0; i < count; i++) {
      const phi = Math.acos(-1 + (2 * i) / count);
      const theta = Math.sqrt(count * Math.PI) * phi;
      const o = new THREE.Object3D();
      o.position.setFromSphericalCoords(radius, phi, theta);
      vector.copy(o.position).multiplyScalar(2);
      o.lookAt(vector);
      targets.sphere.push(o);
    }

    // HELIX
    const helixRadius = 550;
    const separation = 30;
    const turns = 10;

    for (let i = 0; i < count; i++) {
      const t = i / count;
      const angle = t * turns * Math.PI * 2;
      const offset = i % 2 === 0 ? 0 : Math.PI;

      const o = new THREE.Object3D();
      o.position.set(
        Math.cos(angle + offset) * helixRadius,
        (t - 0.5) * count * separation,
        Math.sin(angle + offset) * helixRadius
      );

      vector.set(o.position.x * 2, o.position.y, o.position.z * 2);
      o.lookAt(vector);
      targets.helix.push(o);
    }

    // GRID
    const sizeX = 5, sizeY = 4, sizeZ = 10;
    const spacing = 320;

    for (let i = 0; i < count; i++) {
      const x = i % sizeX;
      const y = Math.floor(i / sizeX) % sizeY;
      const z = Math.floor(i / (sizeX * sizeY));

      const o = new THREE.Object3D();
      o.position.set(
        (x - (sizeX / 2 - 0.5)) * spacing,
        (-(y) + (sizeY / 2 - 0.5)) * spacing,
        (z - (sizeZ / 2 - 0.5)) * spacing
      );
      targets.grid.push(o);
    }

    targetsRef.current = targets;
  };

  const transform = (targetsArr, duration = 1200) => {
    const objects = objectsRef.current;
    if (!targetsArr?.length || !objects?.length) return;

    tweenGroupRef.current.removeAll();

    for (let i = 0; i < objects.length; i++) {
      const object = objects[i];
      const target = targetsArr[i];
      if (!target) continue;

      tweenGroupRef.current.add(
        new Tween(object.position, tweenGroupRef.current)
          .to(
            { x: target.position.x, y: target.position.y, z: target.position.z },
            duration
          )
          .easing(Easing.Exponential.InOut)
          .start()
      );

      tweenGroupRef.current.add(
        new Tween(object.rotation, tweenGroupRef.current)
          .to(
            {
              x: target.rotation.x || 0,
              y: target.rotation.y || 0,
              z: target.rotation.z || 0,
            },
            duration
          )
          .easing(Easing.Exponential.InOut)
          .start()
      );
    }
  };

  // ---------- Build scene after login ----------
useEffect(() => {
  if (!accessToken) return;
  if (rendererRef.current) return;

  (async () => {
    try {
      initThree();

      // 🔐 THIS is the access validation
      const rows = await fetchSheetRows(accessToken);

      const data = rows.slice(0, 200);
      if (!sceneRef.current) throw new Error("Scene not initialized.");

      computeTargets(data.length);

      for (let i = 0; i < data.length; i++) {
        const tile = buildTile(data[i]);
        const obj = new CSS3DObject(tile);

        obj.position.set(
          (i % 20) * 140 - 1400,
          -Math.floor(i / 20) * 180 + 900,
          0
        );

        sceneRef.current.add(obj);
        objectsRef.current.push(obj);
      }

      transform(targetsRef.current.table, 2000);

    } catch (e) {
      // ❌ NO ACCESS → FORCE LOGOUT
      const msg = String(e?.message || e);

      if (
        msg.includes("403") ||
        msg.includes("Forbidden") ||
        msg.includes("permission") ||
        msg.includes("not have permission")
      ) {
        setError(
          "❌ Access denied. Please sign in with a Google account that has access to this Sheet."
        );

        setAccessToken(null);   // 🔥 kick user out
        cleanupThree();         // clean scene
      } else {
        setError(msg);
      }
    }
  })();

  return () => cleanupThree();
}, [accessToken]);

  return (
    <div className="page">
      {!accessToken && (
        <div className="loginOverlay">
          <div className="loginCard">
            <h1>Sign In With Google</h1>
            <p>Use the Google account that has access to the Sheet.</p>

            <button onClick={signInWithGoogle} className="googleBtn">
              Sign in with Google
            </button>

            {error && <div className="error">{error}</div>}
          </div>
        </div>
      )}

      <div ref={mountRef} className="mount" />

      {accessToken && (
        <div className="menu">
          <button onClick={() => transform(targetsRef.current.table)}>TABLE</button>
          <button onClick={() => transform(targetsRef.current.sphere)}>SPHERE</button>
          <button onClick={() => transform(targetsRef.current.helix)}>HELIX</button>
          <button onClick={() => transform(targetsRef.current.grid)}>GRID</button>
        </div>
      )}
    </div>
  );
}
