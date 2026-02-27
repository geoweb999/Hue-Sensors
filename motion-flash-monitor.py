#!/usr/bin/python3
"""
Hue Motion Flash Monitor
Monitors the Hue Temperature Dashboard API and flashes the screen when motion is detected.
"""

import requests
import time
import subprocess
import sys
from datetime import datetime

# Configuration
API_URL = "http://10.0.18.93:3000/api/rooms"
POLL_INTERVAL = 2  # seconds between API checks
FLASH_DURATION = 0.2  # seconds (how long the inversion lasts)


class MotionFlashMonitor:
    def __init__(self):
        # Track previous motion states
        self.previous_motion_states = {}

        # Status
        self.running = True
        self.last_check = None
        self.error_count = 0

        print("=" * 60)
        print("Hue Motion Flash Monitor")
        print("=" * 60)
        print(f"API Endpoint: {API_URL}")
        print(f"Poll Interval: {POLL_INTERVAL} seconds")
        print(f"Flash Duration: {FLASH_DURATION}s")
        print(f"Flash Method: Display Inversion (Cmd+Opt+Ctrl+8)")
        print("=" * 60)
        print("\nMonitoring for motion... (Press Ctrl+C to stop)")
        print("Note: Flash uses macOS display inversion feature\n")

    def trigger_flash(self):
        """Flash the screen by inverting colors briefly."""
        try:
            # Use macOS built-in display inversion as a flash effect
            # This is accessibility feature, very reliable

            # Invert colors (white flash effect)
            subprocess.run([
                'osascript', '-e',
                'tell application "System Events"\n'
                'key code 28 using {control down, option down, command down}\n'
                'end tell'
            ], timeout=1)

            # Wait
            time.sleep(FLASH_DURATION)

            # Restore (toggle back)
            subprocess.run([
                'osascript', '-e',
                'tell application "System Events"\n'
                'key code 28 using {control down, option down, command down}\n'
                'end tell'
            ], timeout=1)

        except Exception as e:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] ⚠️  Flash error: {e}")

    def check_motion(self):
        """Check API for motion and trigger flash if detected."""
        try:
            response = requests.get(API_URL, timeout=5)
            response.raise_for_status()
            data = response.json()

            if not data.get('success'):
                print(f"[{datetime.now().strftime('%H:%M:%S')}] API returned error")
                return

            rooms = data.get('rooms', [])
            new_motion_detected = False
            motion_rooms = []

            # Check each room for new motion
            for room in rooms:
                room_id = room.get('id')
                room_name = room.get('name')
                motion_detected = room.get('motionDetected', False)

                # Check if this is NEW motion (wasn't detected before, is detected now)
                if motion_detected and not self.previous_motion_states.get(room_id, False):
                    new_motion_detected = True
                    motion_rooms.append(room_name)

                # Update previous state
                self.previous_motion_states[room_id] = motion_detected

            # Trigger flash if new motion detected
            if new_motion_detected:
                timestamp = datetime.now().strftime('%H:%M:%S')
                rooms_str = ", ".join(motion_rooms)
                print(f"[{timestamp}] 🟢 MOTION DETECTED: {rooms_str}")
                self.trigger_flash()

            self.last_check = datetime.now()
            self.error_count = 0  # Reset error count on success

        except requests.exceptions.ConnectionError:
            self.error_count += 1
            if self.error_count == 1:  # Only print first error
                print(f"[{datetime.now().strftime('%H:%M:%S')}] ⚠️  Cannot connect to {API_URL}")
                print("    Make sure the Hue dashboard server is running (npm start)")
        except requests.exceptions.Timeout:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] ⚠️  Request timeout")
        except Exception as e:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] ❌ Error: {e}")

    def start(self):
        """Start the monitor."""
        try:
            while self.running:
                self.check_motion()
                time.sleep(POLL_INTERVAL)
        except KeyboardInterrupt:
            self.stop()

    def stop(self):
        """Stop the monitor."""
        print("\n\nStopping monitor...")
        self.running = False


def main():
    """Main entry point."""
    try:
        monitor = MotionFlashMonitor()
        monitor.start()
    except KeyboardInterrupt:
        print("\n\nExiting...")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
