#!/bin/bash
# Test PWA configuration

echo "======================================"
echo "Hue Dashboard PWA Configuration Test"
echo "======================================"
echo ""

# Check if server is running
echo "1. Checking if server is running..."
if curl -s http://localhost:3000 > /dev/null; then
    echo "   ✓ Server is running"
else
    echo "   ✗ Server is not running (start with: npm start)"
    exit 1
fi

# Check manifest.json
echo ""
echo "2. Checking manifest.json..."
if curl -s http://localhost:3000/manifest.json | grep -q "Hue Temperature Dashboard"; then
    echo "   ✓ Manifest is accessible"
else
    echo "   ✗ Manifest not found"
fi

# Check service worker
echo ""
echo "3. Checking service-worker.js..."
if curl -s http://localhost:3000/service-worker.js | grep -q "Service Worker"; then
    echo "   ✓ Service worker is accessible"
else
    echo "   ✗ Service worker not found"
fi

# Check icons
echo ""
echo "4. Checking app icons..."
icon_count=0
for size in 72 96 128 144 152 192 384 512; do
    if curl -s -I http://localhost:3000/icons/icon-${size}x${size}.png | grep -q "200 OK"; then
        ((icon_count++))
    fi
done
echo "   ✓ Found $icon_count/8 icons"

# Check HTML meta tags
echo ""
echo "5. Checking PWA meta tags..."
if curl -s http://localhost:3000 | grep -q "apple-mobile-web-app-capable"; then
    echo "   ✓ iOS meta tags present"
else
    echo "   ✗ iOS meta tags missing"
fi

if curl -s http://localhost:3000 | grep -q 'rel="manifest"'; then
    echo "   ✓ Manifest link present"
else
    echo "   ✗ Manifest link missing"
fi

echo ""
echo "======================================"
echo "PWA Configuration Complete!"
echo "======================================"
echo ""
echo "To install:"
echo ""
echo "iOS/iPadOS:"
echo "  1. Open Safari: http://10.0.18.93:3000"
echo "  2. Tap Share → Add to Home Screen"
echo ""
echo "Android:"
echo "  1. Open Chrome: http://10.0.18.93:3000"
echo "  2. Tap menu → Install app"
echo ""
echo "Desktop:"
echo "  1. Open Chrome/Edge: http://10.0.18.93:3000"
echo "  2. Click install icon in address bar"
echo ""
echo "See PWA-INSTALL.md for detailed instructions"
echo ""
