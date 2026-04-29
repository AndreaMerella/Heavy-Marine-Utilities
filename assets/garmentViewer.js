/**
 * garmentViewer.js
 * Inspection Mode — Heavy Marine Utility
 * Handles: modal mount, zoom/pan, mouse parallax, HUD overlay, model-viewer AR, fallback
 */

const GarmentViewer = (() => {

  const UNITS = {
    'UNIT_1301': {
      name: 'THE CAMALLO SASH-SLING',
      location: 'GENOVA, IT',
      material: 'WEATHERED BONE DACRON',
      img: 'assets/images/products/unit_01_camallo_sling.png',
      glb: null
    },
    'UNIT_1402': {
      name: 'THE MERSEY MANTLE',
      location: 'LIVERPOOL, UK',
      material: 'RIGID KEVLAR / MYLAR',
      img: 'assets/images/products/unit_02_mersey_mantle_docks.png',
      glb: null
    },
    'UNIT_1503': {
      name: 'AMSTERDAM SHIPYARD SLIDES',
      location: 'AMSTERDAM, NL',
      material: 'RECLAIMED SAILCLOTH / EVA',
      img: 'assets/images/products/unit_03_amsterdam_slides.png',
      glb: null
    }
  };

  let activeUnit = null;
  let isDragging = false;
  let startX = 0, startY = 0, panX = 0, panY = 0;
  let currentScale = 1;
  const MAX_SCALE = 4;
  const MIN_SCALE = 1;

  // ─── BUILD MODAL ───────────────────────────────────────────────────────────
  function buildModal() {
    const modal = document.createElement('div');
    modal.id = 'inspection-modal';
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('role', 'dialog');
    modal.innerHTML = `
      <div class="insp-backdrop"></div>
      <div class="insp-container">

        <div class="insp-hud">
          <div class="insp-hud-row insp-hud-top">
            <div class="insp-unit-id">—</div>
            <button class="insp-close" aria-label="Close inspection">[ CLOSE ]</button>
          </div>
          <div class="insp-data-grid">
            <div class="insp-data-cell">
              <span class="hud-label">UNIT</span>
              <span class="hud-value insp-name">—</span>
            </div>
            <div class="insp-data-cell">
              <span class="hud-label">PORT OF ORIGIN</span>
              <span class="hud-value insp-location">—</span>
            </div>
            <div class="insp-data-cell">
              <span class="hud-label">MATERIAL</span>
              <span class="hud-value insp-material">—</span>
            </div>
            <div class="insp-data-cell">
              <span class="hud-label">STATUS</span>
              <span class="hud-value hud-accent">INSPECTION ACTIVE</span>
            </div>
          </div>
        </div>

        <div class="insp-viewport" id="insp-viewport">
          <img id="insp-img" src="" alt="" draggable="false">
          <div id="model-container" style="display:none;width:100%;height:100%;"></div>
          <div class="insp-zoom-hint" id="insp-zoom-hint">SCROLL TO ZOOM &nbsp;·&nbsp; DRAG TO PAN</div>
        </div>

        <div class="insp-footer">
          <div class="insp-zoom-level"><span id="zoom-display">100</span>%</div>
          <button class="deploy-btn" id="deploy-btn">
            <span class="deploy-label">DEPLOY IN FIELD</span>
            <span class="deploy-sub">// FIELD INSPECTION INTERFACE</span>
          </button>
          <div class="insp-nfc">NFC: <span class="hud-accent">NTAG213 ✓</span></div>
        </div>

      </div>
    `;
    document.body.appendChild(modal);
    bindModalEvents(modal);
  }

  // ─── BIND EVENTS ──────────────────────────────────────────────────────────
  function bindModalEvents(modal) {
    modal.querySelector('.insp-backdrop').addEventListener('click', close);
    modal.querySelector('.insp-close').addEventListener('click', close);

    const viewport = document.getElementById('insp-viewport');

    // Zoom via scroll
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      currentScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, currentScale + delta));
      applyTransform();
      document.getElementById('zoom-display').textContent = Math.round(currentScale * 100);
    }, { passive: false });

    // Pan via drag
    viewport.addEventListener('mousedown', (e) => {
      if (currentScale <= 1) return;
      isDragging = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
      viewport.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      applyTransform();
    });
    window.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      viewport.style.cursor = currentScale > 1 ? 'grab' : 'default';
    });

    // Mouse parallax (only at base scale)
    const img = document.getElementById('insp-img');
    viewport.addEventListener('mousemove', (e) => {
      if (isDragging || currentScale > 1) return;
      const rect = viewport.getBoundingClientRect();
      const cx = (e.clientX - rect.left) / rect.width - 0.5;
      const cy = (e.clientY - rect.top) / rect.height - 0.5;
      img.style.transform = `translate(${cx * -14}px, ${cy * -10}px) scale(1.05)`;
    });
    viewport.addEventListener('mouseleave', () => {
      if (currentScale <= 1) img.style.transform = '';
    });

    // Deploy in Field
    document.getElementById('deploy-btn').addEventListener('click', deployInField);

    // ESC to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('active')) close();
    });
  }

  function bindTriggers() {
    document.querySelectorAll('[data-inspect]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        open(btn.dataset.inspect);
      });
    });
  }

  // ─── OPEN / CLOSE ─────────────────────────────────────────────────────────
  function open(unitId) {
    activeUnit = UNITS[unitId];
    if (!activeUnit) return;

    const modal = document.getElementById('inspection-modal');
    const img = document.getElementById('insp-img');
    const modelContainer = document.getElementById('model-container');

    // Populate HUD
    modal.querySelector('.insp-unit-id').textContent = unitId;
    modal.querySelector('.insp-name').textContent = activeUnit.name;
    modal.querySelector('.insp-location').textContent = activeUnit.location;
    modal.querySelector('.insp-material').textContent = activeUnit.material;

    // Reset deploy button
    const deployBtn = document.getElementById('deploy-btn');
    deployBtn.querySelector('.deploy-label').textContent = 'DEPLOY IN FIELD';
    deployBtn.querySelector('.deploy-sub').textContent = '// FIELD INSPECTION INTERFACE';
    deployBtn.disabled = false;

    if (activeUnit.glb) {
      img.style.display = 'none';
      modelContainer.style.display = 'block';
      loadModelViewer(modelContainer, activeUnit.glb);
    } else {
      modelContainer.style.display = 'none';
      modelContainer.innerHTML = '';
      img.style.display = 'block';
      img.src = activeUnit.img;
      img.alt = activeUnit.name;
    }

    // Reset state
    currentScale = 1;
    panX = 0;
    panY = 0;
    img.style.transform = '';
    document.getElementById('zoom-display').textContent = '100';

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Hide hint after a moment
    const hint = document.getElementById('insp-zoom-hint');
    hint.style.opacity = '1';
    setTimeout(() => { hint.style.opacity = '0'; }, 3000);
  }

  function close() {
    const modal = document.getElementById('inspection-modal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
    activeUnit = null;
    isDragging = false;
    panX = 0; panY = 0; currentScale = 1;
  }

  // ─── TRANSFORM ────────────────────────────────────────────────────────────
  function applyTransform() {
    const img = document.getElementById('insp-img');
    img.style.transform = `translate(${panX}px, ${panY}px) scale(${currentScale})`;
    const viewport = document.getElementById('insp-viewport');
    viewport.style.cursor = currentScale > 1 ? 'grab' : 'default';
  }

  // ─── DEPLOY IN FIELD ──────────────────────────────────────────────────────
  function deployInField() {
    if (!activeUnit) return;

    const btn = document.getElementById('deploy-btn');

    if (!activeUnit.glb) {
      btn.disabled = true;
      btn.querySelector('.deploy-label').textContent = '3D UNIT NOT YET DEPLOYED';
      btn.querySelector('.deploy-sub').textContent = '// IMAGE INSPECTION ACTIVE';
      setTimeout(() => {
        btn.querySelector('.deploy-label').textContent = 'DEPLOY IN FIELD';
        btn.querySelector('.deploy-sub').textContent = '// FIELD INSPECTION INTERFACE';
        btn.disabled = false;
      }, 2500);
      return;
    }

    const mv = document.querySelector('model-viewer');
    if (mv && typeof mv.activateAR === 'function') {
      mv.activateAR();
    }
  }

  // ─── MODEL VIEWER (LAZY) ──────────────────────────────────────────────────
  function loadModelViewer(container, glbSrc) {
    if (!document.querySelector('script[src*="model-viewer"]')) {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.3.0/model-viewer.min.js';
      document.head.appendChild(script);
    }
    container.innerHTML = `
      <model-viewer
        src="${glbSrc}"
        ar
        ar-modes="webxr scene-viewer quick-look"
        camera-controls
        auto-rotate
        shadow-intensity="1"
        style="width:100%;height:100%;background:transparent;">
      </model-viewer>
    `;
  }

  // ─── INIT ─────────────────────────────────────────────────────────────────
  function mount() {
    buildModal();
    bindTriggers();
  }

  return { mount, open, close };

})();

document.addEventListener('DOMContentLoaded', () => GarmentViewer.mount());
