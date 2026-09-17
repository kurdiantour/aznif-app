import { expect, test } from "@jest/globals";
import { createOkeyResponsiveLayout } from "../OkeyResponsiveLayoutProvider";

const viewports = [
  {
    name: "small Android landscape",
    width: 640,
    height: 320,
    insets: { left: 24, right: 24, bottom: 16 },
    expected: "compact",
  },
  {
    name: "regular phone landscape",
    width: 844,
    height: 390,
    insets: { left: 0, right: 0, bottom: 12 },
    expected: "regular",
  },
  {
    name: "large phone landscape",
    width: 932,
    height: 430,
    insets: { left: 44, right: 44, bottom: 12 },
    expected: "regular",
  },
  {
    name: "tablet landscape",
    width: 1280,
    height: 800,
    insets: {
      top: 24,
      left: 20,
      right: 20,
      bottom: 24,
    },
    expected: "tablet",
  },
] as const;

test.each(viewports)(
  "$name produces a bounded $expected layout",
  ({ width, height, insets, expected }) => {
    const layout = createOkeyResponsiveLayout({
      width,
      height,
      insets,
    });

    expect(layout.layoutClass).toBe(expected);
    expect(layout.usableWidth).toBe(
      width - insets.left - insets.right,
    );
    expect(layout.usableHeight).toBe(
      height -
        ("top" in insets ? insets.top : 0) -
        insets.bottom,
    );

    const rackBottom = Number(layout.rackWrap.bottom);
    const rackHeight = Number(layout.rackWrap.height);
    const playerRackWidth = Number(layout.playerRack.width);
    const playerRackHeight = Number(layout.playerRack.height);

    expect(rackBottom).toBe(82 + insets.bottom);
    expect(playerRackWidth).toBeLessThanOrEqual(layout.usableWidth);
    expect(playerRackHeight).toBe(Math.round(playerRackWidth / (2351 / 533)));
    expect(rackHeight).toBe(playerRackHeight);

    if (expected === "regular") {
      expect(playerRackWidth).toBeLessThanOrEqual(595);
      expect(playerRackWidth).toBeGreaterThanOrEqual(575);
    } else if (expected === "tablet") {
      expect(playerRackWidth).toBeLessThanOrEqual(820);
      expect(playerRackWidth).toBeGreaterThan(760);
    }

    expect(
      Number(layout.meldAreas.bottom.bottom),
    ).toBeGreaterThanOrEqual(0);

    expect(
      Number(layout.centerPiles.gap),
    ).toBeGreaterThanOrEqual(30);
  },
);

test.each(viewports)(
  "$name keeps both meld columns inside their half of the table",
  ({ width, height, insets }) => {
    const layout = createOkeyResponsiveLayout({
      width,
      height,
      insets,
    });

    const halfTable = layout.usableWidth / 2;

    expect(
      Number(layout.meldAreas.left.left) +
        Number(layout.meldAreas.left.width),
    ).toBeLessThanOrEqual(halfTable);

    expect(
      Number(layout.meldAreas.right.right) +
        Number(layout.meldAreas.right.width),
    ).toBeLessThanOrEqual(halfTable);
  },
);

test(
  "safe-area insets move controls inward without changing their ordering",
  () => {
    const plain = createOkeyResponsiveLayout({
      width: 844,
      height: 390,
    });

    const inset = createOkeyResponsiveLayout({
      width: 844,
      height: 390,
      insets: {
        top: 18,
        right: 32,
        bottom: 12,
        left: 32,
      },
    });

    expect(Number(inset.topActions.top)).toBeGreaterThan(
      Number(plain.topActions.top),
    );

    expect(Number(inset.topActions.right)).toBeGreaterThan(
      Number(plain.topActions.right),
    );

    expect(Number(inset.scoreBoard.left)).toBeGreaterThan(
      Number(plain.scoreBoard.left),
    );

    expect(Number(inset.screen.paddingBottom)).toBeGreaterThan(
      Number(plain.screen.paddingBottom),
    );
  },
);

test("negative insets are sanitized", () => {
  const layout = createOkeyResponsiveLayout({
    width: 700,
    height: 360,
    insets: {
      top: -20,
      left: -5,
    },
  });

  expect(layout.usableWidth).toBe(700);
  expect(layout.usableHeight).toBe(360);

  expect(
    Number(layout.screen.paddingTop),
  ).toBeGreaterThanOrEqual(8);

  expect(
    Number(layout.screen.paddingLeft),
  ).toBeGreaterThanOrEqual(8);
});