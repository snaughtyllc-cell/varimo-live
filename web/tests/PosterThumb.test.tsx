import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PosterThumb } from "@/components/common/PosterThumb";

describe("PosterThumb", () => {
  it("renders an img, never a video", () => {
    const { container } = render(<PosterThumb src="/api/look/s1/look_v01.jpg" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/api/look/s1/look_v01.jpg");
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("[data-poster]")).toBeTruthy();
  });
});
