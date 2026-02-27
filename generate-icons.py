#!/usr/bin/python3
"""
Generate PWA icons for Hue Temperature Dashboard
Creates simple gradient icons with app initials
"""

try:
    from PIL import Image, ImageDraw, ImageFont
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    print("PIL/Pillow not available. Creating placeholder instructions instead.")

import os

def create_icon(size, output_path):
    """Create a simple gradient icon with 'HT' text."""
    if not PIL_AVAILABLE:
        return False

    # Create image with gradient background
    img = Image.new('RGB', (size, size))
    draw = ImageDraw.Draw(img)

    # Draw gradient (purple to blue)
    for y in range(size):
        ratio = y / size
        r = int(102 + (118 - 102) * ratio)
        g = int(126 + (75 - 126) * ratio)
        b = int(234 + (162 - 234) * ratio)
        draw.rectangle([(0, y), (size, y + 1)], fill=(r, g, b))

    # Draw white circle for better text visibility
    circle_size = int(size * 0.7)
    circle_pos = (size - circle_size) // 2
    draw.ellipse(
        [circle_pos, circle_pos, circle_pos + circle_size, circle_pos + circle_size],
        fill=(255, 255, 255, 240)
    )

    # Try to load a font, fallback to default
    try:
        font_size = int(size * 0.4)
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
    except:
        font = ImageFont.load_default()

    # Draw "HT" text
    text = "HT"
    # Get text bounding box
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    text_x = (size - text_width) // 2
    text_y = (size - text_height) // 2 - int(size * 0.05)  # Adjust for optical centering

    # Draw text shadow
    shadow_offset = max(2, size // 100)
    draw.text((text_x + shadow_offset, text_y + shadow_offset), text,
              fill=(0, 0, 0, 50), font=font)

    # Draw main text
    draw.text((text_x, text_y), text, fill=(102, 126, 234), font=font)

    # Save
    img.save(output_path, 'PNG')
    return True

def main():
    """Generate all required icon sizes."""
    icons_dir = 'public/icons'
    os.makedirs(icons_dir, exist_ok=True)

    sizes = [72, 96, 128, 144, 152, 192, 384, 512]

    if PIL_AVAILABLE:
        print("Generating PWA icons...")
        for size in sizes:
            output_path = os.path.join(icons_dir, f'icon-{size}x{size}.png')
            if create_icon(size, output_path):
                print(f"  ✓ Created {size}x{size} icon")
            else:
                print(f"  ✗ Failed to create {size}x{size} icon")
        print("\nIcons generated successfully!")
        print("You can replace these with custom designs if desired.")
    else:
        print("\nPillow library not installed.")
        print("\nTo generate icons automatically:")
        print("  pip3 install Pillow")
        print("  python3 generate-icons.py")
        print("\nOr create icons manually:")
        print("  - Create PNG images in public/icons/")
        print("  - Sizes needed: 72x72, 96x96, 128x128, 144x144, 152x152, 192x192, 384x384, 512x512")
        print("  - Use your app logo or design")
        print("\nOr use an online tool:")
        print("  - https://realfavicongenerator.net/")
        print("  - Upload one image, it generates all sizes")

if __name__ == '__main__':
    main()
