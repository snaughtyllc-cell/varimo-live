import type { DrivePick } from "@/components/studio/DrivePickerModal";
import type { CaptionSource } from "@/components/studio/StudioCaptionsBox";

/** Studio caption boxes: local files get a blob thumb; Drive picks have no local file. */
export function studioCaptionSources(files: File[], drivePicks: DrivePick[]): CaptionSource[] {
  return [
    ...files.map((file, i) => ({ key: `file-${i}-${file.name}`, name: file.name, file })),
    ...drivePicks.map((pick) => ({
      key: `drive-${pick.id}`,
      name: pick.name,
    })),
  ];
}
