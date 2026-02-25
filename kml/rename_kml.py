import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime

VALID_NAME_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}-\d{4}-[A-Z0-9]{1,2}-[A-Z0-9]{2,5}\.kml$"
)

renamed_count = 0
skipped_formatted_count = 0
skipped_exists_count = 0
error_count = 0


def extract_registration(text):
    match = re.search(r"\b[A-Z0-9]{1,2}-[A-Z0-9]{2,5}\b", text)
    return match.group(0) if match else None


def process_kml(file_path):
    global renamed_count, skipped_formatted_count
    global skipped_exists_count, error_count

    filename = os.path.basename(file_path)

    # Skip if already correctly formatted
    if VALID_NAME_PATTERN.match(filename):
        skipped_formatted_count += 1
        print(f"⏩ Already formatted, skipping: {filename}")
        return

    try:
        tree = ET.parse(file_path)
        root = tree.getroot()
        ns = {'kml': 'http://www.opengis.net/kml/2.2'}

        when_elements = root.findall(".//kml:when", ns)
        if not when_elements:
            error_count += 1
            print(f"❌ No timestamp: {filename}")
            return

        first_time_str = when_elements[0].text
        dt = datetime.fromisoformat(first_time_str.replace("Z", "+00:00"))

        date_part = dt.strftime("%Y-%m-%d")
        time_part = dt.strftime("%H%M")

        full_text = ET.tostring(root, encoding="unicode")
        registration = extract_registration(full_text)

        if not registration:
            error_count += 1
            print(f"❌ No registration: {filename}")
            return

        new_filename = f"{date_part}-{time_part}-{registration}.kml"
        new_path = os.path.join(os.path.dirname(file_path), new_filename)

        if os.path.exists(new_path):
            skipped_exists_count += 1
            print(f"⚠️ Target exists, skipping: {new_filename}")
            return

        os.rename(file_path, new_path)
        renamed_count += 1
        print(f"✅ Renamed → {new_filename}")

    except Exception as e:
        error_count += 1
        print(f"❌ Error processing {filename}: {e}")


if __name__ == "__main__":
    folder = os.getcwd()

    for filename in os.listdir(folder):
        if filename.lower().endswith(".kml"):
            full_path = os.path.join(folder, filename)
            process_kml(full_path)

    print("\n===== SUMMARY =====")
    print(f"Renamed: {renamed_count}")
    print(f"Skipped (already formatted): {skipped_formatted_count}")
    print(f"Skipped (target exists): {skipped_exists_count}")
    print(f"Errors: {error_count}")
    print("===================")