(function () {
  const TWO_PI = Math.PI * 2;
  const WHEEL_SIZE = 220;
  const WHEEL_RADIUS = WHEEL_SIZE / 2;

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
  }

  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    return result
      ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
      : { r: 255, g: 255, b: 255 };
  }

  function hsvToRgb(h, s, v) {
    const hh = ((h % 360) + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs((hh / 60) % 2 - 1));
    const m = v - c;
    let r = 0;
    let g = 0;
    let b = 0;

    if (hh < 60) { r = c; g = x; }
    else if (hh < 120) { r = x; g = c; }
    else if (hh < 180) { g = c; b = x; }
    else if (hh < 240) { g = x; b = c; }
    else if (hh < 300) { r = x; b = c; }
    else { r = c; b = x; }

    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255)
    };
  }

  function rgbToHsv(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;
    let h = 0;

    if (delta > 0) {
      if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
      else if (max === gn) h = 60 * (((bn - rn) / delta) + 2);
      else h = 60 * (((rn - gn) / delta) + 4);
    }
    if (h < 0) h += 360;

    const s = max === 0 ? 0 : delta / max;
    const v = max;
    return { h, s, v };
  }

  function drawWheel(canvas) {
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(WHEEL_SIZE, WHEEL_SIZE);
    const data = image.data;
    const center = WHEEL_SIZE / 2;

    for (let y = 0; y < WHEEL_SIZE; y += 1) {
      for (let x = 0; x < WHEEL_SIZE; x += 1) {
        const dx = x + 0.5 - center;
        const dy = y + 0.5 - center;
        const dist = Math.sqrt((dx * dx) + (dy * dy));
        const idx = (y * WHEEL_SIZE + x) * 4;

        if (dist > WHEEL_RADIUS) {
          data[idx + 3] = 0;
          continue;
        }

        const hue = ((Math.atan2(dy, dx) + TWO_PI) % TWO_PI) / TWO_PI * 360;
        const sat = clamp(dist / WHEEL_RADIUS, 0, 1);
        const rgb = hsvToRgb(hue, sat, 1);
        data[idx] = rgb.r;
        data[idx + 1] = rgb.g;
        data[idx + 2] = rgb.b;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(image, 0, 0);
  }

  function createCircleColorPicker() {
    const popup = document.createElement('div');
    popup.className = 'color-wheel-popup';
    popup.innerHTML = `
      <div class="color-wheel-panel">
        <canvas class="color-wheel-canvas" width="${WHEEL_SIZE}" height="${WHEEL_SIZE}"></canvas>
        <div class="color-wheel-marker"></div>
      </div>
    `;
    document.body.appendChild(popup);

    const panel = popup.querySelector('.color-wheel-panel');
    const canvas = popup.querySelector('.color-wheel-canvas');
    const marker = popup.querySelector('.color-wheel-marker');
    drawWheel(canvas);

    let activeInput = null;
    let activeTrigger = null;
    let startValue = '#ffffff';
    let dragging = false;
    let changed = false;

    function setMarkerFromPolar(angle, distance) {
      const x = 6 + WHEEL_RADIUS + Math.cos(angle) * distance;
      const y = 6 + WHEEL_RADIUS + Math.sin(angle) * distance;
      marker.style.left = `${x}px`;
      marker.style.top = `${y}px`;
    }

    function setMarkerFromHex(hex) {
      const rgb = hexToRgb(hex);
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      const angle = (hsv.h / 360) * TWO_PI;
      const distance = clamp(hsv.s, 0, 1) * WHEEL_RADIUS;
      setMarkerFromPolar(angle, distance);
    }

    function pointToHex(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const dx = x - WHEEL_RADIUS;
      const dy = y - WHEEL_RADIUS;
      const angle = Math.atan2(dy, dx);
      const distance = clamp(Math.sqrt((dx * dx) + (dy * dy)), 0, WHEEL_RADIUS);
      const sat = distance / WHEEL_RADIUS;
      const hue = ((angle + TWO_PI) % TWO_PI) / TWO_PI * 360;
      const rgb = hsvToRgb(hue, sat, 1);
      setMarkerFromPolar(angle, distance);
      return rgbToHex(rgb.r, rgb.g, rgb.b);
    }

    function emitInput(hex) {
      if (!activeInput) return;
      if (activeInput.value !== hex) {
        activeInput.value = hex;
        activeInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      changed = true;
    }

    function handleMove(e) {
      if (!dragging || !activeInput) return;
      emitInput(pointToHex(e.clientX, e.clientY));
    }

    function handleUp() {
      dragging = false;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    }

    function positionPopup() {
      if (!activeTrigger) return;
      const triggerRect = activeTrigger.getBoundingClientRect();
      const popupRect = panel.getBoundingClientRect();
      let left = triggerRect.left + (triggerRect.width / 2) - (popupRect.width / 2);
      let top = triggerRect.bottom + 10;

      const margin = 8;
      left = clamp(left, margin, window.innerWidth - popupRect.width - margin);
      if (top + popupRect.height > window.innerHeight - margin) {
        top = triggerRect.top - popupRect.height - 10;
      }
      top = clamp(top, margin, window.innerHeight - popupRect.height - margin);

      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
    }

    function handleOutsidePointer(e) {
      if (!popup.classList.contains('active')) return;
      const target = e.target;
      if (popup.contains(target)) return;
      if (activeTrigger && activeTrigger.contains(target)) return;
      api.close();
    }

    function handleEscape(e) {
      if (e.key === 'Escape') api.close();
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (!activeInput) return;
      e.preventDefault();
      dragging = true;
      emitInput(pointToHex(e.clientX, e.clientY));
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    });

    const api = {
      open(triggerEl, inputEl) {
        if (!triggerEl || !inputEl || inputEl.disabled) return;
        if (popup.classList.contains('active')) this.close();
        activeTrigger = triggerEl;
        activeInput = inputEl;
        startValue = inputEl.value || '#ffffff';
        changed = false;

        popup.classList.add('active');
        setMarkerFromHex(startValue);
        positionPopup();

        document.addEventListener('pointerdown', handleOutsidePointer, true);
        document.addEventListener('keydown', handleEscape);
        window.addEventListener('resize', positionPopup);
      },
      close() {
        if (!popup.classList.contains('active')) return;
        popup.classList.remove('active');
        handleUp();
        document.removeEventListener('pointerdown', handleOutsidePointer, true);
        document.removeEventListener('keydown', handleEscape);
        window.removeEventListener('resize', positionPopup);
        if (activeInput && (changed || activeInput.value !== startValue)) {
          activeInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        activeInput = null;
        activeTrigger = null;
      }
    };

    return api;
  }

  window.createCircleColorPicker = createCircleColorPicker;
})();
